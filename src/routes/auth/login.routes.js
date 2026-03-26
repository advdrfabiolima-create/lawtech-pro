const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const axios = require('axios');
const { sign: jwtSign, verify: jwtVerify } = require('../../config/jwt');
const pool = require('../../config/db');
const { registrarAudit, dadosReq } = require('../../utils/auditLog');
const authMiddleware = require('../../middlewares/authMiddleware');
const rateLimit = require('express-rate-limit');
const logger = require('../../utils/logger');
const cache = require('../../utils/cache');

const limiterReenvio = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: { ok: false, erro: 'Muitas tentativas. Aguarde 1 hora.' }
});

/* ======================================================
   ROTA DE LOGIN
===================================================== */

router.post('/login', async (req, res) => {
    try {
        const { email, senha } = req.body;

        logger.info(`🔍 [LOGIN] Tentativa de login: ${email}`);

        if (!email || !senha) {
            return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
        }

        const result = await pool.query(
            `SELECT u.id, u.nome, u.email, u.senha, u.role, u.escritorio_id, u.is_master,
                    u.totp_ativo,
                    e.plano_id, e.trial_expira_em, e.plano_financeiro_status,
                    e.ultimo_pagamento, e.proxima_cobranca,
                    p.nome AS plano_nome, p.preco_mensal
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             LEFT JOIN planos p ON e.plano_id = p.id
             WHERE u.email = $1`,
            [email.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ erro: 'Email ou senha incorretos' });
        }

        const usuario = result.rows[0];

        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) {
            return res.status(401).json({ erro: 'Email ou senha incorretos' });
        }

        logger.info(`📊 [LOGIN] Usuário: ${usuario.email, '| Escritório:', usuario.escritorio_id}`);
        logger.info(`📊 [LOGIN] Status: ${usuario.plano_financeiro_status, '| Trial expira em:', usuario.trial_expira_em}`);

        const ehMaster = usuario.is_master === true || usuario.email === process.env.MASTER_EMAIL;

        let diasRestantes = 0;
        if (usuario.trial_expira_em) {
            const hoje = new Date();
            const expiracao = new Date(usuario.trial_expira_em);
            diasRestantes = Math.ceil((expiracao - hoje) / (1000 * 60 * 60 * 24));
            logger.info(`📊 [LOGIN] Dias restantes do trial: ${diasRestantes}`);
        } else if (usuario.plano_financeiro_status === 'trial') {
            // trial_expira_em = NULL + status 'trial' = cron zerou o campo sem concluir cobrança
            diasRestantes = -999;
        }

        // ⚠️ BLOQUEIA LOGIN SE TRIAL EXPIROU (grace period de 3 dias)
        if (!ehMaster) {
            if (diasRestantes < -3 &&
                !['pago', 'ativo'].includes(usuario.plano_financeiro_status)) {

                logger.info(`⚠️ [LOGIN BLOQUEADO] Trial expirado: ${usuario.email}`);
                registrarAudit({ usuario_id: usuario.id, email: usuario.email, escritorio_id: usuario.escritorio_id, acao: 'LOGIN_BLOQUEADO', descricao: 'Trial expirado', metadata: { dias_restantes: diasRestantes, status: usuario.plano_financeiro_status }, ...dadosReq(req) });

                return res.status(402).json({
                    erro: 'Período de teste expirado',
                    detalhe: 'Seu trial de 7 dias chegou ao fim. Realize o pagamento para liberar o acesso total.',
                    dias_restantes: diasRestantes,
                    status: usuario.plano_financeiro_status,
                    redirect: '/planos-page?action=pay',
                    plano: {
                        nome: usuario.plano_nome || 'Básico',
                        valor: parseFloat(usuario.preco_mensal) || 97
                    }
                });
            }
        }

        // Verificar se 2FA está ativo
        if (usuario.totp_ativo) {
            const tempToken = jwtSign(
                { id: usuario.id, scope: '2fa' },
                { expiresIn: '5m' }
            );
            return res.json({ ok: true, requer_2fa: true, temp_token: tempToken });
        }

        const token = jwtSign({
                id: usuario.id,
                email: usuario.email,
                escritorio_id: usuario.escritorio_id,
                role: usuario.role
            });

        logger.info(`✅ [LOGIN] Login bem-sucedido: ${usuario.email}`);
        registrarAudit({ usuario_id: usuario.id, email: usuario.email, escritorio_id: usuario.escritorio_id, acao: 'LOGIN', descricao: 'Login bem-sucedido', ...dadosReq(req) });

        res.json({
            ok: true,
            token: token,
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                role: usuario.role,
                escritorio_id: usuario.escritorio_id,
                plano_id: usuario.plano_id,
                plano_financeiro_status: usuario.plano_financeiro_status,
                ultimo_pagamento: usuario.ultimo_pagamento,
                proxima_cobranca: usuario.proxima_cobranca,
                dias_restantes: diasRestantes
            }
        });

    } catch (err) {
        logger.error(`❌ [LOGIN] Erro: ${err.message}`);
        res.status(500).json({ erro: 'Erro ao processar login' });
    }
});

/* ======================================================
   ROTA PARA VERIFICAR TOKEN
===================================================== */

router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ ok: false, erro: 'Token não fornecido' });

        const [, token] = authHeader.split(' ');
        const decoded = jwtVerify(token);

        const result = await pool.query(
            `SELECT u.id, u.nome, u.email, u.role, u.escritorio_id, u.is_master,
                    u.tour_desativado, u.data_criacao, u.primeiro_acesso,
                    e.plano_id, e.trial_expira_em, e.plano_financeiro_status,
                    e.ultimo_pagamento, e.proxima_cobranca
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             WHERE u.id = $1`,
            [decoded.id]
        );

        if (result.rows.length === 0) return res.status(401).json({ ok: false, erro: 'Usuário não encontrado' });

        const usuario = result.rows[0];

        let diasRestantes = 0;
        if (usuario.trial_expira_em) {
            const hoje = new Date();
            const expiracao = new Date(usuario.trial_expira_em);
            diasRestantes = Math.ceil((expiracao - hoje) / (1000 * 60 * 60 * 24));
        } else if (usuario.plano_financeiro_status === 'trial') {
            diasRestantes = -999;
        }

        const ehMaster = usuario.is_master === true || usuario.email === process.env.MASTER_EMAIL;
        if (!ehMaster && diasRestantes < -3 && !['pago', 'ativo'].includes(usuario.plano_financeiro_status)) {
            return res.status(402).json({
                ok: false,
                erro: 'Trial expirado',
                dias_restantes: diasRestantes,
                trial_expira_em: usuario.trial_expira_em
            });
        }

        res.json({
            ok: true,
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                role: usuario.role,
                escritorio_id: usuario.escritorio_id,
                tour_desativado: usuario.tour_desativado,
                data_criacao: usuario.data_criacao,
                primeiro_acesso: usuario.primeiro_acesso,
                plano_id: usuario.plano_id,
                plano_financeiro_status: usuario.plano_financeiro_status,
                ultimo_pagamento: usuario.ultimo_pagamento,
                proxima_cobranca: usuario.proxima_cobranca,
                dias_restantes: diasRestantes
            }
        });
    } catch (err) {
        return res.status(401).json({ ok: false, erro: 'Token inválido' });
    }
});

/* ======================================================
   ROTA PÚBLICA — FORMULÁRIO DE CONTATO DO SITE
   POST /api/auth/contato
===================================================== */

router.post('/contato', async (req, res) => {
    try {
        const { nome, email, telefone, motivo, mensagem } = req.body;

        if (!nome || !email || !mensagem) {
            return res.status(400).json({ ok: false, erro: 'Nome, e-mail e mensagem são obrigatórios' });
        }

        const motivoLabel = {
            suporte: 'Suporte Técnico',
            comercial: 'Comercial / Vendas',
            financeiro: 'Financeiro',
            outro: 'Outro'
        }[motivo] || motivo || 'Não informado';

        logger.info(`📬 [CONTATO] Recebido de ${email} — Motivo: ${motivoLabel}`);

        if (process.env.BREVO_API_KEY && process.env.BREVO_SENDER) {
            const html = `
            <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafb;">
                <div style="background:#1E3A5F;padding:32px 24px;text-align:center;">
                    <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:200px;height:auto;margin:0 auto 12px;display:block;" />
                    <p style="color:rgba(255,255,255,0.8);margin:0;font-size:14px;">Sistema Jurídico Inteligente</p>
                </div>
                <div style="padding:32px 24px;background:white;">
                    <h2 style="color:#1E3A5F;margin:0 0 20px;font-size:20px;">📬 Nova mensagem de contato</h2>
                    <table style="width:100%;border-collapse:collapse;">
                        <tr><td style="padding:8px 0;color:#7B8794;font-size:13px;width:110px;">Nome</td><td style="padding:8px 0;font-weight:600;color:#2D3748;">${nome}</td></tr>
                        <tr><td style="padding:8px 0;color:#7B8794;font-size:13px;">E-mail</td><td style="padding:8px 0;font-weight:600;"><a href="mailto:${email}" style="color:#4A90E2;">${email}</a></td></tr>
                        <tr><td style="padding:8px 0;color:#7B8794;font-size:13px;">Telefone</td><td style="padding:8px 0;font-weight:600;color:#2D3748;">${telefone || 'Não informado'}</td></tr>
                        <tr><td style="padding:8px 0;color:#7B8794;font-size:13px;">Motivo</td><td style="padding:8px 0;font-weight:600;color:#2D3748;">${motivoLabel}</td></tr>
                    </table>
                    <div style="margin-top:20px;padding:16px;background:#f8fafb;border-radius:8px;border:1px solid #e2e8f0;">
                        <p style="margin:0 0 8px;color:#7B8794;font-size:13px;">Mensagem:</p>
                        <p style="margin:0;color:#2D3748;font-size:14px;line-height:1.7;">${mensagem.replace(/\n/g, '<br>')}</p>
                    </div>
                </div>
                <div style="padding:20px 24px;text-align:center;background:#f8fafb;border-top:1px solid #e2e8f0;">
                    <p style="color:#7B8794;font-size:11px;margin:0;">LawTech Pro — Sistema Jurídico Inteligente</p>
                    <p style="color:#A0AEC0;font-size:10px;margin:4px 0 0;">Mensagem recebida pelo formulário de contato do site.</p>
                </div>
            </div>`;

            await axios.post('https://api.brevo.com/v3/smtp/email', {
                sender: { name: 'LawTech Pro', email: process.env.BREVO_SENDER },
                to: [{ email: 'contato@lawtechpro.com.br' }],
                replyTo: { email, name: nome },
                subject: `📬 Contato via site: ${motivoLabel} — ${nome}`,
                htmlContent: html
            }, { headers: { 'api-key': process.env.BREVO_API_KEY } });

            logger.info(`✅ [CONTATO] E-mail enviado para contato@lawtechpro.com.br`);
        } else {
            logger.warn('⚠️ [CONTATO] BREVO não configurado — e-mail não enviado');
        }

        res.json({ ok: true, mensagem: 'Mensagem enviada com sucesso!' });
    } catch (err) {
        logger.error(`❌ [CONTATO] Erro: ${err.message}`);
        res.status(500).json({ ok: false, erro: 'Erro ao enviar mensagem. Tente novamente.' });
    }
});

/* ======================================================
   VERIFICAR E-MAIL
   GET /api/auth/verificar-email?token=xxx  (PÚBLICO)
===================================================== */

router.get('/verificar-email', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(400).json({ ok: false, erro: 'Token é obrigatório' });

        const result = await pool.query(
            `SELECT id FROM usuarios WHERE email_verificacao_token = $1 AND email_verificacao_expira > NOW()`,
            [token]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ ok: false, erro: 'Token inválido ou expirado. Solicite um novo link de verificação.' });
        }

        await pool.query(
            `UPDATE usuarios SET email_verificado = true, email_verificacao_token = NULL, email_verificacao_expira = NULL WHERE id = $1`,
            [result.rows[0].id]
        );

        logger.info(`✅ [EMAIL-VERIFY] E-mail verificado para usuário ${result.rows[0].id}`);
        res.json({ ok: true, mensagem: 'E-mail verificado com sucesso!' });
    } catch (err) {
        logger.error(`❌ [EMAIL-VERIFY] Erro: ${err.message}`);
        res.status(500).json({ ok: false, erro: 'Erro ao verificar e-mail' });
    }
});

/* ======================================================
   REENVIAR VERIFICAÇÃO DE E-MAIL
   POST /api/auth/reenviar-verificacao  (authMiddleware)
===================================================== */

router.post('/reenviar-verificacao', authMiddleware, limiterReenvio, async (req, res) => {
    try {
        const usuarioResult = await pool.query(
            `SELECT id, nome, email, email_verificado FROM usuarios WHERE id = $1`,
            [req.user.id]
        );

        if (usuarioResult.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });
        }

        const usuario = usuarioResult.rows[0];

        if (usuario.email_verificado) {
            return res.status(400).json({ ok: false, erro: 'E-mail já verificado' });
        }

        const novoToken = crypto.randomBytes(32).toString('hex');
        const novaExpiracao = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await pool.query(
            `UPDATE usuarios SET email_verificacao_token = $1, email_verificacao_expira = $2 WHERE id = $3`,
            [novoToken, novaExpiracao, usuario.id]
        );

        const baseUrl = process.env.BASE_URL || 'https://www.lawtechpro.com.br';
        const linkVerificacao = `${baseUrl}/verificar-email.html?token=${novoToken}`;

        if (process.env.BREVO_API_KEY && process.env.BREVO_SENDER) {
            try {
                await axios.post('https://api.brevo.com/v3/smtp/email', {
                    sender: { name: 'LawTech Pro', email: process.env.BREVO_SENDER },
                    to: [{ email: usuario.email, name: usuario.nome }],
                    subject: '✅ Confirme seu e-mail — LawTech Pro',
                    htmlContent: `
                    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafb;">
                        <div style="background:#1E3A5F;padding:32px 24px;text-align:center;">
                            <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:200px;height:auto;margin:0 auto 12px;" />
                        </div>
                        <div style="padding:32px 24px;background:white;">
                            <h2 style="color:#1E3A5F;margin:0 0 16px;font-size:20px;">Olá, Dr(a). ${usuario.nome}!</h2>
                            <p style="color:#4A5568;font-size:15px;line-height:1.7;margin:0 0 20px;">
                                Clique no botão abaixo para confirmar seu e-mail no LawTech Pro.
                            </p>
                            <div style="text-align:center;margin:28px 0;">
                                <a href="${linkVerificacao}"
                                   style="display:inline-block;background-color:#4A90E2;background:linear-gradient(135deg,#4A90E2,#357ABD);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;mso-padding-alt:0;">
                                    Confirmar E-mail &rarr;
                                </a>
                            </div>
                            <div style="background:#FEF3C7;border-left:4px solid #F59E0B;padding:14px 16px;border-radius:0 8px 8px 0;">
                                <p style="margin:0;font-size:13px;color:#92400E;">⏰ Este link expira em <strong>24 horas</strong>.</p>
                            </div>
                        </div>
                    </div>`
                }, { headers: { 'api-key': process.env.BREVO_API_KEY } });
                logger.info(`📧 [EMAIL-VERIFY] Reenvio de verificação para ${usuario.email}`);
            } catch (mailErr) {
                logger.warn(`⚠️ [EMAIL-VERIFY] Falha ao reenviar: ${mailErr.message}`);
            }
        }

        res.json({ ok: true, mensagem: 'E-mail de verificação reenviado com sucesso!' });
    } catch (err) {
        logger.error(`❌ [EMAIL-VERIFY] Erro ao reenviar: ${err.message}`);
        res.status(500).json({ ok: false, erro: 'Erro ao reenviar verificação' });
    }
});

/* ======================================================
   LOGOUT
   POST /api/auth/logout
===================================================== */

router.post('/logout', authMiddleware, async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (token) {
            const decoded = jwtVerify(token);
            const remainingSecs = decoded.exp - Math.floor(Date.now() / 1000);
            if (remainingSecs > 0) {
                const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
                await cache.set(`jwt:blacklist:${tokenHash}`, '1', remainingSecs);
            }
        }
        await cache.del(`auth:user:${req.user.id}`);
        logger.info({ userId: req.user.id }, '[LOGOUT] Token revogado');
        res.json({ ok: true, mensagem: 'Logout realizado com sucesso' });
    } catch (_) {
        res.json({ ok: true });
    }
});

module.exports = router;
