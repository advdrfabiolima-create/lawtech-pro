const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const axios = require('axios');
const logger = require('../../utils/logger');
const pool = require('../../config/db');
const { validarSenha } = require('../../utils/validators');
const { registrarAudit, dadosReq } = require('../../utils/auditLog');

/* ======================================================
   ROTA PARA RECUPERAR SENHA
===================================================== */

router.post('/recuperar-senha', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ ok: false, erro: 'Email é obrigatório' });

        // Resposta genérica por segurança (não revela se o e-mail existe)
        const resposta = { ok: true, mensagem: 'Se o e-mail estiver cadastrado, você receberá as instruções em breve.' };

        const result = await pool.query(
            'SELECT id, nome FROM usuarios WHERE email = $1',
            [email.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            logger.info(`📧 [RECUPERAR SENHA] E-mail não encontrado: ${email}`);
            return res.json(resposta);
        }

        const usuario = result.rows[0];

        const token = crypto.randomBytes(32).toString('hex');
        const expira = new Date(Date.now() + 60 * 60 * 1000);

        await pool.query(
            'UPDATE usuarios SET reset_token = $1, reset_token_expira = $2 WHERE id = $3',
            [token, expira, usuario.id]
        );

        const baseUrl = 'https://www.lawtechpro.com.br';
        const link = `${baseUrl}/nova-senha.html?token=${token}`;

        logger.info(`📧 [RECUPERAR SENHA] Token gerado para: ${email}`);

        if (process.env.BREVO_API_KEY && process.env.BREVO_SENDER) {
            try {
                await axios.post('https://api.brevo.com/v3/smtp/email', {
                    sender: { name: 'LawTech Pro', email: process.env.BREVO_SENDER },
                    to: [{ email: email.toLowerCase().trim(), name: usuario.nome }],
                    subject: '🔑 Recuperação de Senha — LawTech Pro',
                    htmlContent: `
                    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafb;">
                        <div style="background:#1E3A5F;padding:32px 24px;text-align:center;">
                            <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:200px;height:auto;margin:0 auto 12px;display:block;" />
                            <p style="color:rgba(255,255,255,0.8);margin:0;font-size:14px;">Sistema Jurídico Inteligente</p>
                        </div>
                        <div style="padding:32px 24px;background:white;">
                            <h2 style="color:#1E3A5F;margin:0 0 16px;font-size:20px;">Olá, Dr(a). ${usuario.nome}!</h2>
                            <p style="color:#4A5568;font-size:15px;line-height:1.7;margin:0 0 20px;">
                                Recebemos uma solicitação para redefinir a senha da sua conta no <strong>LawTech Pro</strong>.
                                Clique no botão abaixo para criar uma nova senha.
                            </p>
                            <div style="text-align:center;margin:28px 0;">
                                <a href="${link}"
                                   style="display:inline-block;background-color:#1e3a8a;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;border:2px solid #1e3a8a;letter-spacing:0.3px;">
                                    Redefinir Minha Senha
                                </a>
                                <p style="margin:16px 0 0;font-size:12px;color:#718096;">
                                    Se o botão não funcionar, copie e cole o link abaixo no navegador:<br>
                                    <a href="${link}" style="color:#2563eb;word-break:break-all;">${link}</a>
                                </p>
                            </div>
                            <div style="background:#FEF3C7;border-left:4px solid #F59E0B;padding:14px 16px;border-radius:0 8px 8px 0;margin:20px 0;">
                                <p style="margin:0;font-size:13px;color:#92400E;">
                                    ⏰ Este link é válido por <strong>1 hora</strong> a partir do recebimento deste e-mail.
                                </p>
                            </div>
                            <p style="color:#718096;font-size:13px;line-height:1.6;margin:16px 0 0;">
                                Se você não solicitou a recuperação de senha, ignore este e-mail. Sua conta permanece segura.
                            </p>
                        </div>
                        <div style="padding:20px 24px;text-align:center;background:#f8fafb;border-top:1px solid #e2e8f0;">
                            <p style="color:#7B8794;font-size:11px;margin:0;">LawTech Pro — Sistema Jurídico Inteligente</p>
                            <p style="color:#A0AEC0;font-size:10px;margin:4px 0 0;">Este é um e-mail automático. Não responda esta mensagem.</p>
                        </div>
                    </div>`
                }, { headers: { 'api-key': process.env.BREVO_API_KEY } });

                logger.info(`✅ [RECUPERAR SENHA] E-mail enviado para: ${email}`);
            } catch (mailErr) {
                logger.error(`❌ [RECUPERAR SENHA] Falha ao enviar e-mail: ${mailErr.message}`);
            }
        } else {
            logger.warn(`⚠️ [RECUPERAR SENHA] Brevo não configurado. Link: ${link}`);
        }

        res.json(resposta);

    } catch (err) {
        logger.error(`❌ [RECUPERAR SENHA] Erro: ${err.message}`);
        res.status(500).json({ ok: false, erro: 'Erro ao processar solicitação' });
    }
});

/* ======================================================
   ROTA PARA DEFINIR NOVA SENHA (via token)
===================================================== */

router.post('/nova-senha', async (req, res) => {
    try {
        const { token, novaSenha } = req.body;

        if (!token || !novaSenha) {
            return res.status(400).json({ ok: false, erro: 'Token e nova senha são obrigatórios' });
        }

        const senhaCheck = validarSenha(novaSenha);
        if (!senhaCheck.valida) {
            return res.status(400).json({ ok: false, erro: senhaCheck.erro });
        }

        const result = await pool.query(
            'SELECT id, email, reset_token_expira FROM usuarios WHERE reset_token = $1',
            [token]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ ok: false, erro: 'Link inválido ou já utilizado. Solicite um novo.' });
        }

        const usuario = result.rows[0];

        if (new Date() > new Date(usuario.reset_token_expira)) {
            return res.status(400).json({ ok: false, erro: 'Link expirado. Solicite um novo link de recuperação.' });
        }

        const hashedPassword = await bcrypt.hash(novaSenha, 10);

        await pool.query(
            'UPDATE usuarios SET senha = $1, reset_token = NULL, reset_token_expira = NULL WHERE id = $2',
            [hashedPassword, usuario.id]
        );

        logger.info(`✅ [NOVA SENHA] Senha redefinida com sucesso: ${usuario.email}`);
        registrarAudit({ usuario_id: usuario.id, email: usuario.email, acao: 'SENHA_REDEFINIDA', descricao: 'Senha redefinida via link de recuperação', ...dadosReq(req) });

        res.json({ ok: true, mensagem: 'Senha alterada com sucesso! Você já pode fazer login.' });

    } catch (err) {
        logger.error(`❌ [NOVA SENHA] Erro: ${err.message}`);
        res.status(500).json({ ok: false, erro: 'Erro ao processar solicitação' });
    }
});

module.exports = router;
