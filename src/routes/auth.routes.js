const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { sign: jwtSign, verify: jwtVerify } = require('../config/jwt');
const pool = require('../config/db');
const { validarSenha, validarDocumento } = require('../utils/validators');
const { registrarAudit, dadosReq } = require('../utils/auditLog');
const axios = require('axios');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { encrypt, decrypt } = require('../utils/crypto');
const authMiddleware = require('../middlewares/authMiddleware');
const rateLimit = require('express-rate-limit');

const limiter2FA = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    message: { error: 'Muitas tentativas. Aguarde 10 minutos.' }
});

/* ======================================================
   ROTA DE REGISTRO - CORRIGIDA E COMPLETA
===================================================== */

router.post('/register', async (req, res) => {
    try {
        const { 
            nome, 
            email, 
            senha, 
            documento, 
            tipoPessoa,
            dataNascimento,
            cep,
            endereco,
            cidade,
            estado,
            planoId
        } = req.body;

        console.log('🔍 [REGISTRO] Nova solicitação de cadastro:', email);

        // ✅ Validações de entrada
        if (!nome || !email || !senha) {
            return res.status(400).json({ 
                erro: 'Nome, email e senha são obrigatórios' 
            });
        }

        const senhaCheck = validarSenha(senha);
        if (!senhaCheck.valida) {
            return res.status(400).json({ erro: senhaCheck.erro });
        }

        // ✅ Validação de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                erro: 'Email inválido' 
            });
        }

        // ✅ Verifica se email já existe
        const emailCheck = await pool.query(
            'SELECT id FROM usuarios WHERE email = $1',
            [email.toLowerCase().trim()]
        );

        if (emailCheck.rows.length > 0) {
            return res.status(400).json({ 
                erro: 'Este email já está cadastrado. Faça login ou use outro email.' 
            });
        }

        // ✅ Hash da senha
        const hashedPassword = await bcrypt.hash(senha, 10);

        // ✅ Preparar dados do documento
        const documentoLimpo = documento ? documento.replace(/\D/g, '') : null;

        // ✅ Calcular data de expiração do trial (7 dias)
        const dataExpiracao = new Date();
        dataExpiracao.setDate(dataExpiracao.getDate() + 7);

        // ✅ TRANSAÇÃO: Criar escritório e usuário
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // 1️⃣ Criar escritório
            const escritorioResult = await client.query(
                `INSERT INTO escritorios 
                 (nome, documento, data_nascimento, cep, endereco, cidade, estado, 
                  plano_id, trial_expira_em, plano_financeiro_status, uf) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $7) 
                 RETURNING id`,
                [
                    nome,
                    documentoLimpo,
                    dataNascimento || null,
                    cep || null,
                    endereco || null,
                    cidade || 'Não informado',
                    estado || 'BA',
                    planoId || 1, // Plano Básico por padrão
                    dataExpiracao,
                    'trial' // Status inicial
                ]
            );

            const escritorioId = escritorioResult.rows[0].id;

            console.log(`✅ [REGISTRO] Escritório criado: ID ${escritorioId}`);

            // 2️⃣ Criar usuário (administrador do escritório)
            const usuarioResult = await client.query(
                `INSERT INTO usuarios 
                 (nome, email, senha, role, escritorio_id) 
                 VALUES ($1, $2, $3, $4, $5) 
                 RETURNING id, nome, email, role`,
                [
                    nome,
                    email.toLowerCase().trim(),
                    hashedPassword,
                    'admin', // Primeiro usuário é sempre admin
                    escritorioId
                ]
            );

            const usuario = usuarioResult.rows[0];

            console.log(`✅ [REGISTRO] Usuário criado: ${usuario.email} (ID: ${usuario.id})`);

            await client.query('COMMIT');

            // ✅ Gerar token JWT
            const token = jwtSign({
                    id: usuario.id,
                    email: usuario.email,
                    escritorio_id: escritorioId,
                    role: usuario.role
                });

            console.log(`🎉 [REGISTRO] Cadastro concluído com sucesso: ${usuario.email}`);
            registrarAudit({ usuario_id: usuario.id, email: usuario.email, escritorio_id: escritorioId, acao: 'REGISTRO', descricao: 'Nova conta criada', ...dadosReq(req) });

            // 📧 Enviar e-mail de boas-vindas via Brevo
            if (process.env.BREVO_API_KEY && process.env.BREVO_SENDER) {
                try {
                    await axios.post('https://api.brevo.com/v3/smtp/email', {
                        sender: { name: 'LawTech Pro', email: process.env.BREVO_SENDER },
                        to: [{ email: usuario.email, name: usuario.nome }],
                        subject: '⚖️ Bem-vindo ao LawTech Pro!',
                        htmlContent: `
                        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafb;">
                            <div style="background:#1E3A5F;padding:32px 24px;text-align:center;">
                                <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:200px;height:auto;margin:0 auto 12px;" />
                                <p style="color:rgba(255,255,255,0.8);margin:0;font-size:14px;">Sistema Jurídico Inteligente</p>
                            </div>
                            <div style="padding:32px 24px;background:white;">
                                <h2 style="color:#1E3A5F;margin:0 0 16px;font-size:20px;">Olá, Dr(a). ${usuario.nome}!</h2>
                                <p style="color:#4A5568;font-size:15px;line-height:1.7;margin:0 0 20px;">
                                    Seja bem-vindo(a) ao <strong>LawTech Pro</strong>! Sua conta foi criada com sucesso e você já pode começar a usar todas as funcionalidades do sistema.
                                </p>
                                <div style="background:#EBF5FF;border-left:4px solid #4A90E2;padding:16px;border-radius:0 8px 8px 0;margin:20px 0;">
                                    <p style="margin:0;font-weight:700;color:#1E3A5F;font-size:14px;">🎁 Período de Teste Grátis: 7 dias</p>
                                    <p style="margin:6px 0 0;color:#4A5568;font-size:13px;">Expira em: ${dataExpiracao.toLocaleDateString('pt-BR')}</p>
                                </div>
                                <p style="color:#4A5568;font-size:14px;line-height:1.6;margin:16px 0;">
                                    Durante o período de teste, você terá acesso completo para explorar:
                                </p>
                                <ul style="color:#4A5568;font-size:14px;line-height:2;padding-left:20px;">
                                    <li>📋 Gestão de Processos e Prazos</li>
                                    <li>👥 Cadastro de Clientes</li>
                                    <li>📅 Audiências e Calendário</li>
                                    <li>💰 Controle Financeiro</li>
                                    <li>📊 Relatórios e Dashboard</li>
                                </ul>
                                <div style="text-align:center;margin:28px 0;">
                                    <a href="https://www.lawtechpro.com.br/login.html"
                                       style="display:inline-block;background:linear-gradient(135deg,#4A90E2,#357ABD);color:white;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;">
                                        Acessar o Sistema →
                                    </a>
                                </div>
                            </div>
                            <div style="padding:20px 24px;text-align:center;background:#f8fafb;border-top:1px solid #e2e8f0;">
                                <p style="color:#7B8794;font-size:11px;margin:0;">LawTech Pro — Sistema Jurídico Inteligente</p>
                                <p style="color:#A0AEC0;font-size:10px;margin:4px 0 0;">Este é um e-mail automático. Não responda esta mensagem.</p>
                            </div>
                        </div>`
                    }, { headers: { 'api-key': process.env.BREVO_API_KEY } });
                    console.log(`📧 [REGISTRO] E-mail de boas-vindas enviado para ${usuario.email}`);
                } catch (mailErr) {
                    console.warn(`⚠️ [REGISTRO] Falha ao enviar e-mail de boas-vindas: ${mailErr.message}`);
                }

                // 📧 Notificar admin sobre novo cadastro
                try {
                    await axios.post('https://api.brevo.com/v3/smtp/email', {
                        sender: { name: 'LawTech Pro', email: process.env.BREVO_SENDER },
                        to: [{ email: process.env.ADMIN_EMAIL || 'fabio@lawtechpro.com.br', name: 'Admin LawTech' }],
                        subject: '🆕 Novo Cadastro no LawTech Pro!',
                        htmlContent: `
                        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafb;">
                            <div style="background:#1E3A5F;padding:24px;text-align:center;">
                                <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:180px;height:auto;margin:0 auto 8px;" />
                                <p style="color:rgba(255,255,255,0.8);margin:0;font-size:13px;">Notificação Administrativa</p>
                            </div>
                            <div style="padding:28px 24px;background:white;">
                                <h2 style="color:#1E3A5F;margin:0 0 16px;font-size:18px;">🎉 Novo usuário cadastrado!</h2>
                                <table style="width:100%;border-collapse:collapse;font-size:14px;">
                                    <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#7B8794;font-weight:600;width:120px;">Nome</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#2D3748;">${usuario.nome}</td></tr>
                                    <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#7B8794;font-weight:600;">E-mail</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#2D3748;">${usuario.email}</td></tr>
                                    <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#7B8794;font-weight:600;">OAB</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#2D3748;">${req.body.oab || '—'} / ${req.body.uf || '—'}</td></tr>
                                    <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#7B8794;font-weight:600;">Data</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#2D3748;">${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td></tr>
                                    <tr><td style="padding:10px 12px;color:#7B8794;font-weight:600;">Plano</td><td style="padding:10px 12px;color:#2D3748;">Trial (7 dias)</td></tr>
                                </table>
                                <div style="text-align:center;margin:24px 0 0;">
                                    <a href="https://www.lawtechpro.com.br/admin-monitor.html" style="display:inline-block;background:#4A90E2;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;">Ver Painel Admin</a>
                                </div>
                            </div>
                            <div style="padding:16px 24px;text-align:center;background:#f8fafb;border-top:1px solid #e2e8f0;">
                                <p style="color:#A0AEC0;font-size:10px;margin:0;">Notificação automática — LawTech Pro</p>
                            </div>
                        </div>`
                    }, { headers: { 'api-key': process.env.BREVO_API_KEY } });
                    console.log(`📧 [ADMIN] Notificação de novo cadastro enviada`);
                } catch (adminMailErr) {
                    console.warn(`⚠️ [ADMIN] Falha ao notificar admin: ${adminMailErr.message}`);
                }
            }

            // ✅ Retorna sucesso
            res.status(201).json({
                ok: true,
                mensagem: 'Cadastro realizado com sucesso!',
                token: token,
                usuario: {
                    id: usuario.id,
                    nome: usuario.nome,
                    email: usuario.email,
                    role: usuario.role,
                    escritorio_id: escritorioId
                },
                trial: {
                    dias_restantes: 7,
                    expira_em: dataExpiracao.toISOString().split('T')[0]
                }
            });

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

    } catch (err) {
        console.error('❌ [REGISTRO] Erro ao processar cadastro:', err.message);
        console.error('Stack:', err.stack);
        
        // Mensagens de erro específicas
        if (err.message.includes('unique')) {
            return res.status(400).json({ 
                erro: 'Email já cadastrado no sistema' 
            });
        }
        
        if (err.message.includes('escritorios')) {
            return res.status(500).json({ 
                erro: 'Erro ao criar escritório. Verifique os dados e tente novamente.' 
            });
        }

        res.status(500).json({ 
            erro: 'Erro ao processar cadastro. Tente novamente em alguns instantes.',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

/* ======================================================
   ROTA DE LOGIN - ✅ CORRIGIDA COM VALIDAÇÃO DE TRIAL
===================================================== */

router.post('/login', async (req, res) => {
    try {
        const { email, senha } = req.body;

        console.log('🔍 [LOGIN] Tentativa de login:', email);

        if (!email || !senha) {
            return res.status(400).json({ 
                erro: 'Email e senha são obrigatórios' 
            });
        }

        // Busca usuário
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
            return res.status(401).json({ 
                erro: 'Email ou senha incorretos' 
            });
        }

        const usuario = result.rows[0];

        // Verifica senha
        const senhaValida = await bcrypt.compare(senha, usuario.senha);

        if (!senhaValida) {
            return res.status(401).json({ 
                erro: 'Email ou senha incorretos' 
            });
        }

        console.log('📊 [LOGIN] Usuário:', usuario.email, '| Escritório:', usuario.escritorio_id);
        console.log('📊 [LOGIN] Status:', usuario.plano_financeiro_status, '| Trial expira em:', usuario.trial_expira_em);

        // ✅ VALIDAÇÃO DE TRIAL EXPIRADO
        const ehMaster = usuario.is_master === true || usuario.email === process.env.MASTER_EMAIL;

        // Padrão 0: sem data de expiração + status não-pago = expirado
        let diasRestantes = 0;
        if (usuario.trial_expira_em) {
            const hoje = new Date();
            const expiracao = new Date(usuario.trial_expira_em);
            diasRestantes = Math.ceil((expiracao - hoje) / (1000 * 60 * 60 * 24));

            console.log('📊 [LOGIN] Dias restantes do trial:', diasRestantes);
        }

        // ⚠️ BLOQUEIA LOGIN SE TRIAL EXPIROU (qualquer status não-pago/ativo)
        if (!ehMaster) {
            if (diasRestantes <= 0 &&
                !['pago', 'ativo'].includes(usuario.plano_financeiro_status)) {
                
                console.log('⚠️ [LOGIN BLOQUEADO] Trial expirado:', usuario.email);
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

        // Gera token
        const token = jwtSign({
                id: usuario.id,
                email: usuario.email,
                escritorio_id: usuario.escritorio_id,
                role: usuario.role
            });

        console.log(`✅ [LOGIN] Login bem-sucedido: ${usuario.email}`);
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
                ultimo_pagamento: usuario.ultimo_pagamento,        // ✅ ADICIONADO
                proxima_cobranca: usuario.proxima_cobranca,        // ✅ ADICIONADO
                dias_restantes: diasRestantes
            }
        });

    } catch (err) {
        console.error('❌ [LOGIN] Erro:', err.message);
        res.status(500).json({ 
            erro: 'Erro ao processar login' 
        });
    }
});

/* ======================================================
   ROTA PARA VERIFICAR TOKEN
===================================================== */

router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ erro: 'Token não fornecido' });

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

        if (result.rows.length === 0) return res.status(401).json({ erro: 'Usuário não encontrado' });

        const usuario = result.rows[0];

        // Calcular dias restantes (padrão 0: sem data = expirado)
        let diasRestantes = 0;
        if (usuario.trial_expira_em) {
            const hoje = new Date();
            const expiracao = new Date(usuario.trial_expira_em);
            diasRestantes = Math.ceil((expiracao - hoje) / (1000 * 60 * 60 * 24));
        }

        // Bloquear acesso se trial expirado (sem tolerância)
        const ehMaster = usuario.is_master === true || usuario.email === process.env.MASTER_EMAIL;
        if (!ehMaster && diasRestantes <= 0 && !['pago', 'ativo'].includes(usuario.plano_financeiro_status)) {
            return res.status(402).json({
                error: 'Trial expirado',
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
                ultimo_pagamento: usuario.ultimo_pagamento,        // ✅ ADICIONADO
                proxima_cobranca: usuario.proxima_cobranca,        // ✅ ADICIONADO
                dias_restantes: diasRestantes
            }
        });
    } catch (err) {
        return res.status(401).json({ erro: 'Token inválido' });
    }
});

/* ======================================================
   ROTA PARA ATUALIZAR STATUS DO TOUR
===================================================== */
router.post('/atualizar-tour', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const [, token] = authHeader.split(' ');
        const decoded = jwtVerify(token);
        
        const { desativar } = req.body; // true ou false

        await pool.query(
            'UPDATE usuarios SET tour_desativado = $1 WHERE id = $2',
            [desativar, decoded.id]
        );

        res.json({ ok: true, mensagem: 'Preferência de tour atualizada' });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao salvar preferência' });
    }
});

/* ======================================================
   ROTA PARA MARCAR BOAS-VINDAS COMO VISTAS
===================================================== */
router.put('/marcar-boas-vindas', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ erro: 'Token não fornecido' });

        const [, token] = authHeader.split(' ');
        const decoded = jwtVerify(token);
        
        await pool.query(
            'UPDATE usuarios SET primeiro_acesso = false WHERE id = $1',
            [decoded.id]
        );

        console.log(`✅ [BOAS-VINDAS] Usuário ${decoded.id} marcado como não-primeiro-acesso`);
        res.json({ ok: true, mensagem: 'Boas-vindas registradas' });
    } catch (err) {
        console.error('❌ [BOAS-VINDAS] Erro:', err);
        res.status(500).json({ erro: 'Erro ao registrar boas-vindas' });
    }
});

/* ======================================================
   🧪 ROTA PARA RESETAR PRIMEIRO ACESSO (APENAS TESTES)
===================================================== */
router.put('/resetar-boas-vindas', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ erro: 'Token não fornecido' });

        const [, token] = authHeader.split(' ');
        const decoded = jwtVerify(token);
        
        await pool.query(
            'UPDATE usuarios SET primeiro_acesso = true WHERE id = $1',
            [decoded.id]
        );

        console.log(`🔄 [TESTE] Usuário ${decoded.id} resetado para primeiro acesso`);
        res.json({ ok: true, mensagem: 'Primeiro acesso resetado para teste' });
    } catch (err) {
        console.error('❌ [TESTE] Erro:', err);
        res.status(500).json({ erro: 'Erro ao resetar' });
    }
});

/* ======================================================
   🧪 ROTA PARA EXPIRAR TRIAL (APENAS DESENVOLVIMENTO)
===================================================== */
router.post('/expirar-trial-teste', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ erro: 'Email é obrigatório' });
        }

        // Busca escritório do usuário
        const result = await pool.query(
            `SELECT escritorio_id FROM usuarios WHERE email = $1`,
            [email.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        const escritorioId = result.rows[0].escritorio_id;

        // Expira o trial
        await pool.query(
            `UPDATE escritorios 
             SET trial_expira_em = NOW() - INTERVAL '1 day',
                 plano_financeiro_status = 'trial'
             WHERE id = $1`,
            [escritorioId]
        );

        console.log(`🧪 [TESTE] Trial expirado para: ${email}`);

        res.json({ 
            ok: true, 
            mensagem: `Trial do usuário ${email} foi expirado para testes` 
        });

    } catch (err) {
        console.error('❌ [TESTE] Erro ao expirar trial:', err);
        res.status(500).json({ erro: 'Erro ao processar' });
    }
});

/* ======================================================
   🧪 ROTA PARA VERIFICAR STATUS DO TRIAL (APENAS DESENVOLVIMENTO)
===================================================== */
router.post('/verificar-status-trial', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ erro: 'Email é obrigatório' });
        }

        // Busca informações completas
        const result = await pool.query(
            `SELECT 
                u.email,
                u.nome,
                e.plano_financeiro_status,
                e.trial_expira_em,
                EXTRACT(DAY FROM (e.trial_expira_em - NOW())) as dias_restantes,
                CASE 
                    WHEN e.trial_expira_em < NOW() THEN 'EXPIRADO'
                    ELSE 'ATIVO'
                END as status_trial
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             WHERE u.email = $1`,
            [email.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        const info = result.rows[0];

        res.json({ 
            ok: true,
            email: info.email,
            nome: info.nome,
            status_financeiro: info.plano_financeiro_status,
            trial_expira_em: info.trial_expira_em,
            dias_restantes: Math.ceil(parseFloat(info.dias_restantes)),
            status_trial: info.status_trial
        });

    } catch (err) {
        console.error('❌ [TESTE] Erro ao verificar status:', err);
        res.status(500).json({ erro: 'Erro ao processar' });
    }
});

/* ======================================================
   ROTA PARA RECUPERAR SENHA
===================================================== */

router.post('/recuperar-senha', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ erro: 'Email é obrigatório' });

        // Resposta genérica por segurança (não revela se o e-mail existe)
        const resposta = { ok: true, mensagem: 'Se o e-mail estiver cadastrado, você receberá as instruções em breve.' };

        const result = await pool.query(
            'SELECT id, nome FROM usuarios WHERE email = $1',
            [email.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            console.log(`📧 [RECUPERAR SENHA] E-mail não encontrado: ${email}`);
            return res.json(resposta);
        }

        const usuario = result.rows[0];

        // Gerar token seguro e expiração de 1 hora
        const token = crypto.randomBytes(32).toString('hex');
        const expira = new Date(Date.now() + 60 * 60 * 1000);

        await pool.query(
            'UPDATE usuarios SET reset_token = $1, reset_token_expira = $2 WHERE id = $3',
            [token, expira, usuario.id]
        );

        const baseUrl = 'https://www.lawtechpro.com.br';
        const link = `${baseUrl}/nova-senha.html?token=${token}`;

        console.log(`📧 [RECUPERAR SENHA] Token gerado para: ${email}`);

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

                console.log(`✅ [RECUPERAR SENHA] E-mail enviado para: ${email}`);
            } catch (mailErr) {
                console.error(`❌ [RECUPERAR SENHA] Falha ao enviar e-mail: ${mailErr.message}`);
            }
        } else {
            console.warn(`⚠️ [RECUPERAR SENHA] Brevo não configurado. Link: ${link}`);
        }

        res.json(resposta);

    } catch (err) {
        console.error('❌ [RECUPERAR SENHA] Erro:', err.message);
        res.status(500).json({ erro: 'Erro ao processar solicitação' });
    }
});

/* ======================================================
   ROTA PARA DEFINIR NOVA SENHA (via token)
===================================================== */

router.post('/nova-senha', async (req, res) => {
    try {
        const { token, novaSenha } = req.body;

        if (!token || !novaSenha) {
            return res.status(400).json({ erro: 'Token e nova senha são obrigatórios' });
        }

        const senhaCheck = validarSenha(novaSenha);
        if (!senhaCheck.valida) {
            return res.status(400).json({ erro: senhaCheck.erro });
        }

        const result = await pool.query(
            'SELECT id, email, reset_token_expira FROM usuarios WHERE reset_token = $1',
            [token]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ erro: 'Link inválido ou já utilizado. Solicite um novo.' });
        }

        const usuario = result.rows[0];

        if (new Date() > new Date(usuario.reset_token_expira)) {
            return res.status(400).json({ erro: 'Link expirado. Solicite um novo link de recuperação.' });
        }

        const hashedPassword = await bcrypt.hash(novaSenha, 10);

        await pool.query(
            'UPDATE usuarios SET senha = $1, reset_token = NULL, reset_token_expira = NULL WHERE id = $2',
            [hashedPassword, usuario.id]
        );

        console.log(`✅ [NOVA SENHA] Senha redefinida com sucesso: ${usuario.email}`);
        registrarAudit({ usuario_id: usuario.id, email: usuario.email, acao: 'SENHA_REDEFINIDA', descricao: 'Senha redefinida via link de recuperação', ...dadosReq(req) });

        res.json({ ok: true, mensagem: 'Senha alterada com sucesso! Você já pode fazer login.' });

    } catch (err) {
        console.error('❌ [NOVA SENHA] Erro:', err.message);
        res.status(500).json({ erro: 'Erro ao processar solicitação' });
    }
});

/* ======================================================
   ROTA PÚBLICA — FORMULÁRIO DE CONTATO DO SITE
   POST /api/auth/contato
   Envia os dados para contato@lawtechpro.com.br via Brevo
===================================================== */

router.post('/contato', async (req, res) => {
    try {
        const { nome, email, telefone, motivo, mensagem } = req.body;

        if (!nome || !email || !mensagem) {
            return res.status(400).json({ erro: 'Nome, e-mail e mensagem são obrigatórios' });
        }

        const motivoLabel = {
            suporte: 'Suporte Técnico',
            comercial: 'Comercial / Vendas',
            financeiro: 'Financeiro',
            outro: 'Outro'
        }[motivo] || motivo || 'Não informado';

        console.log(`📬 [CONTATO] Recebido de ${email} — Motivo: ${motivoLabel}`);

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

            console.log(`✅ [CONTATO] E-mail enviado para contato@lawtechpro.com.br`);
        } else {
            console.warn('⚠️ [CONTATO] BREVO não configurado — e-mail não enviado');
        }

        res.json({ ok: true, mensagem: 'Mensagem enviada com sucesso!' });
    } catch (err) {
        console.error('❌ [CONTATO] Erro:', err.message);
        res.status(500).json({ erro: 'Erro ao enviar mensagem. Tente novamente.' });
    }
});

/* ======================================================
   CONFIGURAÇÃO ASAAS — PAGAMENTO DE TRIAL EXPIRADO
===================================================== */

const ASAAS_ENV_AUTH = process.env.ASAAS_ENV || 'production';
const ASAAS_BASE_URL_AUTH = ASAAS_ENV_AUTH === 'sandbox'
    ? 'https://sandbox.asaas.com/api/v3'
    : 'https://api.asaas.com/v3';

const getAsaasHeadersAuth = () => ({
    'access_token': process.env.ASAAS_API_KEY,
    'Content-Type': 'application/json'
});

function obterDataVencimentoTrial(dias = 1) {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function obterOuCriarClienteTrial(nome, email, cpfCnpj) {
    const docLimpo = cpfCnpj.replace(/\D/g, '');
    const busca = await axios.get(`${ASAAS_BASE_URL_AUTH}/customers`, {
        headers: getAsaasHeadersAuth(),
        params: { cpfCnpj: docLimpo }
    });
    if (busca.data.data && busca.data.data.length > 0) {
        return busca.data.data[0].id;
    }
    const novo = await axios.post(`${ASAAS_BASE_URL_AUTH}/customers`, {
        name: nome || 'Advogado LawTech',
        email,
        cpfCnpj: docLimpo,
        notificationDisabled: false
    }, { headers: getAsaasHeadersAuth() });
    return novo.data.id;
}

/* ======================================================
   POST /api/auth/pagar-trial-pix  (PÚBLICO — sem JWT)
===================================================== */

router.post('/pagar-trial-pix', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ erro: 'Email é obrigatório' });

        const userResult = await pool.query(
            `SELECT u.id, u.nome, u.email, u.escritorio_id,
                    e.documento, e.plano_id, e.plano_financeiro_status, e.trial_expira_em
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             WHERE u.email = $1`,
            [email.toLowerCase().trim()]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        const u = userResult.rows[0];

        if (u.plano_financeiro_status !== 'trial') {
            return res.status(400).json({ erro: 'Conta não está em período de trial' });
        }
        if (!u.trial_expira_em || new Date(u.trial_expira_em) > new Date()) {
            return res.status(400).json({ erro: 'Trial ainda está ativo ou sem data de expiração' });
        }

        const planoR = await pool.query('SELECT nome, preco_mensal FROM planos WHERE id = $1', [u.plano_id]);
        if (planoR.rows.length === 0) return res.status(400).json({ erro: 'Plano não encontrado' });
        const plano = planoR.rows[0];
        const valor = parseFloat(plano.preco_mensal);

        if (!u.documento) {
            return res.status(400).json({ erro: 'CPF/CNPJ não cadastrado. Entre em contato com o suporte.' });
        }

        const customerId = await obterOuCriarClienteTrial(u.nome, u.email, u.documento);

        const pagRes = await axios.post(`${ASAAS_BASE_URL_AUTH}/payments`, {
            customer: customerId,
            billingType: 'PIX',
            value: valor,
            dueDate: obterDataVencimentoTrial(1),
            description: `${plano.nome} - LawTech Pro`,
            externalReference: String(u.escritorio_id)
        }, { headers: getAsaasHeadersAuth() });

        const cobranca = pagRes.data;

        const qrRes = await axios.get(
            `${ASAAS_BASE_URL_AUTH}/payments/${cobranca.id}/pixQrCode`,
            { headers: getAsaasHeadersAuth() }
        );

        console.log(`💰 [PIX TRIAL] Cobrança ${cobranca.id} criada para escritório ${u.escritorio_id}`);

        res.json({
            ok: true,
            cobrancaId: cobranca.id,
            pixPayload: qrRes.data.payload,
            pixQrCodeBase64: qrRes.data.encodedImage,
            valor,
            planNome: plano.nome
        });

    } catch (err) {
        const msg = err.response?.data?.errors?.[0]?.description || err.message;
        console.error('❌ [PIX TRIAL]', msg);
        res.status(500).json({ erro: 'Erro ao gerar PIX: ' + msg });
    }
});

/* ======================================================
   GET /api/auth/verificar-pix/:cobrancaId  (PÚBLICO — sem JWT)
===================================================== */

router.get('/verificar-pix/:cobrancaId', async (req, res) => {
    try {
        const { cobrancaId } = req.params;

        const response = await axios.get(
            `${ASAAS_BASE_URL_AUTH}/payments/${cobrancaId}`,
            { headers: getAsaasHeadersAuth() }
        );

        const pg = response.data;
        const pago = ['CONFIRMED', 'RECEIVED'].includes(pg.status);

        if (pago && pg.externalReference) {
            await pool.query(
                `UPDATE escritorios
                 SET plano_financeiro_status = 'pago',
                     trial_expira_em = NULL,
                     ultimo_pagamento = NOW(),
                     proxima_cobranca = NOW() + INTERVAL '1 month'
                 WHERE id = $1`,
                [pg.externalReference]
            );
            try {
                await pool.query(
                    `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                     VALUES ($1, $2, 'asaas', $3, 'aprovada', 'Ativação pós-trial — PIX', NOW())`,
                    [pg.externalReference, cobrancaId, pg.value]
                );
            } catch (_) { /* tabela pode não existir — não crítico */ }
            console.log(`✅ [PIX TRIAL] Escritório ${pg.externalReference} ativado.`);
        }

        res.json({ status: pg.status, pago });

    } catch (err) {
        console.error('❌ [VERIFICAR PIX]', err.message);
        res.status(500).json({ erro: 'Erro ao verificar pagamento' });
    }
});

/* ======================================================
   POST /api/auth/pagar-trial-cartao  (PÚBLICO — sem JWT)
===================================================== */

router.post('/pagar-trial-cartao', async (req, res) => {
    try {
        const { email, holderName, number, expiryMonth, expiryYear, ccv, cpfCnpj, phone, postalCode, addressNumber } = req.body;

        if (!email || !holderName || !number || !expiryMonth || !expiryYear || !ccv || !cpfCnpj || !postalCode || !addressNumber) {
            return res.status(400).json({ erro: 'Todos os dados do cartão são obrigatórios (incluindo CEP e número do endereço)' });
        }

        const userResult = await pool.query(
            `SELECT u.id, u.nome, u.email, u.escritorio_id,
                    e.plano_id, e.plano_financeiro_status, e.trial_expira_em
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             WHERE u.email = $1`,
            [email.toLowerCase().trim()]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        const u = userResult.rows[0];

        if (u.plano_financeiro_status !== 'trial') {
            return res.status(400).json({ erro: 'Conta não está em período de trial' });
        }
        if (!u.trial_expira_em || new Date(u.trial_expira_em) > new Date()) {
            return res.status(400).json({ erro: 'Trial ainda está ativo' });
        }

        const planoR = await pool.query('SELECT nome, preco_mensal FROM planos WHERE id = $1', [u.plano_id]);
        if (planoR.rows.length === 0) return res.status(400).json({ erro: 'Plano não encontrado' });
        const plano = planoR.rows[0];
        const valor = parseFloat(plano.preco_mensal);

        const customerId = await obterOuCriarClienteTrial(holderName, email, cpfCnpj);

        const hoje = new Date();
        const dueDate = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

        const pagRes = await axios.post(`${ASAAS_BASE_URL_AUTH}/payments`, {
            customer: customerId,
            billingType: 'CREDIT_CARD',
            value: valor,
            dueDate,
            description: `${plano.nome} - LawTech Pro`,
            externalReference: String(u.escritorio_id),
            creditCard: {
                holderName,
                number: number.replace(/\s/g, ''),
                expiryMonth: String(expiryMonth),
                expiryYear: String(expiryYear),
                ccv
            },
            creditCardHolderInfo: {
                name: holderName,
                email,
                cpfCnpj: cpfCnpj.replace(/\D/g, ''),
                postalCode: postalCode.replace(/\D/g, ''),
                addressNumber: addressNumber,
                phone: phone || ''
            }
        }, { headers: getAsaasHeadersAuth() });

        const pg = pagRes.data;

        if (['CONFIRMED', 'RECEIVED'].includes(pg.status)) {
            await pool.query(
                `UPDATE escritorios
                 SET plano_financeiro_status = 'pago',
                     trial_expira_em = NULL,
                     ultimo_pagamento = NOW(),
                     proxima_cobranca = NOW() + INTERVAL '1 month'
                 WHERE id = $1`,
                [u.escritorio_id]
            );
            try {
                await pool.query(
                    `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                     VALUES ($1, $2, 'asaas', $3, 'aprovada', 'Ativação pós-trial — Cartão', NOW())`,
                    [u.escritorio_id, pg.id, valor]
                );
            } catch (_) { /* não crítico */ }
            console.log(`✅ [CARTÃO TRIAL] Escritório ${u.escritorio_id} ativado.`);
            return res.json({ ok: true });
        }

        const motivo = pg.creditCardTransactionFailureReason || pg.status || 'Recusado';
        console.log(`❌ [CARTÃO TRIAL] Recusado: ${motivo}`);
        return res.status(402).json({ erro: `Cartão recusado: ${motivo}` });

    } catch (err) {
        const erroAsaas = err.response?.data || {};
        const msg = erroAsaas.errors?.[0]?.description || err.message;
        console.error('❌ [CARTÃO TRIAL]', msg);
        const isCardError = err.response?.status === 400 ||
            msg.toLowerCase().includes('declined') ||
            msg.toLowerCase().includes('recusad') ||
            msg.toLowerCase().includes('invalid card') ||
            msg.toLowerCase().includes('não autorizada') ||
            msg.toLowerCase().includes('nao autorizada') ||
            msg.toLowerCase().includes('expirado') ||
            msg.toLowerCase().includes('inválido') ||
            msg.toLowerCase().includes('invalido') ||
            msg.toLowerCase().includes('cartão') ||
            msg.toLowerCase().includes('cvv') ||
            msg.toLowerCase().includes('cep') ||
            msg.toLowerCase().includes('cpf');
        if (isCardError) {
            return res.status(402).json({ erro: msg });
        }
        res.status(500).json({ erro: 'Erro ao processar pagamento: ' + msg });
    }
});

/* ======================================================
   2FA — CONFIGURAR (gerar QR code)
   GET /api/auth/2fa/configurar  (requer authMiddleware)
===================================================== */
router.get('/2fa/configurar', authMiddleware, async (req, res) => {
    try {
        const secretObj = speakeasy.generateSecret({ name: `LawTechPro:${req.user.email}` });
        const secret = secretObj.base32;
        const encryptedSecret = encrypt(secret);

        await pool.query(
            `UPDATE usuarios SET totp_secret = $1, totp_ativo = false WHERE id = $2`,
            [encryptedSecret, req.user.id]
        );

        const email = req.user.email;
        const otpauthUrl = speakeasy.otpauthURL({ secret, label: email, issuer: 'LawTechPro', encoding: 'base32' });
        const qrcode = await QRCode.toDataURL(otpauthUrl);

        res.json({ qrcode, secret, email });
    } catch (err) {
        console.error('❌ [2FA] Erro ao configurar:', err.message);
        res.status(500).json({ error: 'Erro ao gerar configuração 2FA' });
    }
});

/* ======================================================
   2FA — ATIVAR (validar e ativar)
   POST /api/auth/2fa/ativar  (requer authMiddleware)
===================================================== */
router.post('/2fa/ativar', authMiddleware, async (req, res) => {
    try {
        const { codigo } = req.body;
        if (!codigo) return res.status(400).json({ error: 'Código obrigatório' });

        const result = await pool.query(
            `SELECT totp_secret FROM usuarios WHERE id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

        const encryptedSecret = result.rows[0].totp_secret;
        if (!encryptedSecret) return res.status(400).json({ error: 'Configure o 2FA primeiro' });

        const secret = decrypt(encryptedSecret);
        const valido = speakeasy.totp.verify({ secret, encoding: 'base32', token: codigo, window: 1 });
        if (!valido) return res.status(400).json({ error: 'Código inválido' });

        // Gerar 8 backup codes
        const backupCodesPlain = Array.from({ length: 8 }, () =>
            crypto.randomBytes(5).toString('hex')
        );
        const backupCodesHash = await Promise.all(
            backupCodesPlain.map(c => bcrypt.hash(c, 10))
        );

        await pool.query(
            `UPDATE usuarios SET totp_ativo = true, totp_backup_codes = $1, totp_ativado_em = NOW() WHERE id = $2`,
            [JSON.stringify(backupCodesHash), req.user.id]
        );

        registrarAudit({
            usuario_id: req.user.id, email: req.user.email,
            escritorio_id: req.user.escritorio_id,
            acao: '2FA_ATIVADO', descricao: '2FA ativado com sucesso',
            ...dadosReq(req)
        });

        res.json({ ok: true, backup_codes: backupCodesPlain });
    } catch (err) {
        console.error('❌ [2FA] Erro ao ativar:', err.message);
        res.status(500).json({ error: 'Erro ao ativar 2FA' });
    }
});

/* ======================================================
   2FA — DESATIVAR
   POST /api/auth/2fa/desativar  (requer authMiddleware)
===================================================== */
router.post('/2fa/desativar', authMiddleware, async (req, res) => {
    try {
        const { senha } = req.body;
        if (!senha) return res.status(400).json({ error: 'Senha obrigatória' });

        const result = await pool.query(
            `SELECT senha FROM usuarios WHERE id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

        const senhaValida = await bcrypt.compare(senha, result.rows[0].senha);
        if (!senhaValida) return res.status(401).json({ error: 'Senha incorreta' });

        await pool.query(
            `UPDATE usuarios SET totp_ativo = false, totp_secret = NULL, totp_backup_codes = NULL, totp_ativado_em = NULL WHERE id = $1`,
            [req.user.id]
        );

        registrarAudit({
            usuario_id: req.user.id, email: req.user.email,
            escritorio_id: req.user.escritorio_id,
            acao: '2FA_DESATIVADO', descricao: '2FA desativado',
            ...dadosReq(req)
        });

        res.json({ ok: true });
    } catch (err) {
        console.error('❌ [2FA] Erro ao desativar:', err.message);
        res.status(500).json({ error: 'Erro ao desativar 2FA' });
    }
});

/* ======================================================
   2FA — STATUS
   GET /api/auth/2fa/status  (requer authMiddleware)
===================================================== */
router.get('/2fa/status', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT totp_ativo, totp_ativado_em FROM usuarios WHERE id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
        const { totp_ativo, totp_ativado_em } = result.rows[0];
        res.json({ ativo: totp_ativo || false, ativado_em: totp_ativado_em || null });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar status 2FA' });
    }
});

/* ======================================================
   2FA — VERIFICAR código TOTP (rota pública, usa temp_token)
   POST /api/auth/2fa/verificar
===================================================== */
router.post('/2fa/verificar', limiter2FA, async (req, res) => {
    try {
        const { temp_token, codigo } = req.body;
        if (!temp_token || !codigo) return res.status(400).json({ error: 'Dados obrigatórios' });

        let payload;
        try {
            payload = jwtVerify(temp_token);
        } catch (_) {
            return res.status(401).json({ error: 'Token inválido ou expirado' });
        }

        if (payload.scope !== '2fa') return res.status(401).json({ error: 'Token inválido' });

        const result = await pool.query(
            `SELECT u.id, u.nome, u.email, u.role, u.escritorio_id, u.totp_secret,
                    e.plano_id, e.plano_financeiro_status, e.ultimo_pagamento, e.proxima_cobranca,
                    e.trial_expira_em, p.preco_mensal
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             LEFT JOIN planos p ON e.plano_id = p.id
             WHERE u.id = $1`,
            [payload.id]
        );

        if (result.rows.length === 0) return res.status(401).json({ error: 'Usuário não encontrado' });

        const usuario = result.rows[0];
        const secret = decrypt(usuario.totp_secret);
        const valido = speakeasy.totp.verify({ secret, encoding: 'base32', token: codigo, window: 1 });
        if (!valido) return res.status(401).json({ error: 'Código inválido. Tente novamente.' });

        const token = jwtSign({
            id: usuario.id,
            email: usuario.email,
            escritorio_id: usuario.escritorio_id,
            role: usuario.role
        });

        let diasRestantes = 0;
        if (usuario.trial_expira_em) {
            diasRestantes = Math.ceil((new Date(usuario.trial_expira_em) - new Date()) / (1000 * 60 * 60 * 24));
        }

        registrarAudit({
            usuario_id: usuario.id, email: usuario.email, escritorio_id: usuario.escritorio_id,
            acao: 'LOGIN_2FA', descricao: 'Login com 2FA bem-sucedido',
            ip: req.ip, user_agent: req.get('user-agent')
        });

        res.json({
            ok: true,
            token,
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
        console.error('❌ [2FA] Erro ao verificar:', err.message);
        res.status(500).json({ error: 'Erro ao verificar código' });
    }
});

/* ======================================================
   2FA — USAR BACKUP CODE (rota pública, usa temp_token)
   POST /api/auth/2fa/usar-backup
===================================================== */
router.post('/2fa/usar-backup', limiter2FA, async (req, res) => {
    try {
        const { temp_token, codigo_backup } = req.body;
        if (!temp_token || !codigo_backup) return res.status(400).json({ error: 'Dados obrigatórios' });

        let payload;
        try {
            payload = jwtVerify(temp_token);
        } catch (_) {
            return res.status(401).json({ error: 'Token inválido ou expirado' });
        }

        if (payload.scope !== '2fa') return res.status(401).json({ error: 'Token inválido' });

        const result = await pool.query(
            `SELECT u.id, u.nome, u.email, u.role, u.escritorio_id, u.totp_backup_codes,
                    e.plano_id, e.plano_financeiro_status, e.ultimo_pagamento, e.proxima_cobranca,
                    e.trial_expira_em
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             WHERE u.id = $1`,
            [payload.id]
        );

        if (result.rows.length === 0) return res.status(401).json({ error: 'Usuário não encontrado' });

        const usuario = result.rows[0];
        let backupCodes = [];
        try { backupCodes = JSON.parse(usuario.totp_backup_codes || '[]'); } catch (_) {}

        let indiceEncontrado = -1;
        for (let i = 0; i < backupCodes.length; i++) {
            const valido = await bcrypt.compare(codigo_backup.trim(), backupCodes[i]);
            if (valido) { indiceEncontrado = i; break; }
        }

        if (indiceEncontrado === -1) return res.status(401).json({ error: 'Código de backup inválido' });

        // Remove o código usado (one-time)
        backupCodes.splice(indiceEncontrado, 1);
        await pool.query(
            `UPDATE usuarios SET totp_backup_codes = $1 WHERE id = $2`,
            [JSON.stringify(backupCodes), usuario.id]
        );

        const token = jwtSign({
            id: usuario.id,
            email: usuario.email,
            escritorio_id: usuario.escritorio_id,
            role: usuario.role
        });

        let diasRestantes = 0;
        if (usuario.trial_expira_em) {
            diasRestantes = Math.ceil((new Date(usuario.trial_expira_em) - new Date()) / (1000 * 60 * 60 * 24));
        }

        registrarAudit({
            usuario_id: usuario.id, email: usuario.email, escritorio_id: usuario.escritorio_id,
            acao: 'LOGIN_2FA_BACKUP', descricao: 'Login com código de backup 2FA',
            ip: req.ip, user_agent: req.get('user-agent')
        });

        res.json({
            ok: true,
            token,
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
        console.error('❌ [2FA] Erro ao usar backup:', err.message);
        res.status(500).json({ error: 'Erro ao processar código de backup' });
    }
});

module.exports = router;