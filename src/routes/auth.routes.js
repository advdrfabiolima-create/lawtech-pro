const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { sign: jwtSign, verify: jwtVerify } = require('../config/jwt');
const pool = require('../config/db');
const { validarSenha, validarDocumento } = require('../utils/validators');
const { registrarAudit, dadosReq } = require('../utils/auditLog');
const axios = require('axios');

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
                    e.plano_id, e.trial_expira_em, e.plano_financeiro_status,
                    e.ultimo_pagamento, e.proxima_cobranca
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
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

        // ✅ VALIDAÇÃO DE TRIAL EXPIRADO (CORRIGIDO)
        const ehMaster = usuario.is_master === true || usuario.email === process.env.MASTER_EMAIL;

        // ✅ MELHORIA: Calcula dias restantes APENAS se status for 'trial'
        let diasRestantes = null;
        if (usuario.plano_financeiro_status === 'trial' && usuario.trial_expira_em) {
            const hoje = new Date();
            const expiracao = new Date(usuario.trial_expira_em);
            diasRestantes = Math.ceil((expiracao - hoje) / (1000 * 60 * 60 * 24));
            
            console.log('📊 [LOGIN] Dias restantes do trial:', diasRestantes);
        }

        // ⚠️ BLOQUEIA LOGIN SE TRIAL EXPIROU E NÃO PAGOU
        if (!ehMaster) {
            // Se trial expirou e não é plano pago/ativo
            if (diasRestantes !== null && diasRestantes <= 0 && 
                usuario.plano_financeiro_status !== 'pago' && 
                usuario.plano_financeiro_status !== 'ativo') {
                
                console.log('⚠️ [LOGIN BLOQUEADO] Trial expirado:', usuario.email);
                registrarAudit({ usuario_id: usuario.id, email: usuario.email, escritorio_id: usuario.escritorio_id, acao: 'LOGIN_BLOQUEADO', descricao: 'Trial expirado', metadata: { dias_restantes: diasRestantes, status: usuario.plano_financeiro_status }, ...dadosReq(req) });
                
                return res.status(402).json({ 
                    erro: 'Período de teste expirado', 
                    detalhe: 'Seu trial de 7 dias chegou ao fim. Realize o pagamento para liberar o acesso total.',
                    dias_restantes: diasRestantes,
                    status: usuario.plano_financeiro_status,
                    redirect: '/planos-page?action=pay'
                });
            }
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

        // ADICIONADO: u.tour_desativado, u.data_criacao e u.primeiro_acesso no SELECT
        const result = await pool.query(
            `SELECT u.id, u.nome, u.email, u.role, u.escritorio_id, u.tour_desativado, u.data_criacao, u.primeiro_acesso,
                    e.plano_id, e.trial_expira_em, e.plano_financeiro_status,
                    e.ultimo_pagamento, e.proxima_cobranca
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             WHERE u.id = $1`,
            [decoded.id]
        );

        if (result.rows.length === 0) return res.status(401).json({ erro: 'Usuário não encontrado' });

        const usuario = result.rows[0];

        let diasRestantes = null;
        
        // ✅ MELHORIA: Só calcula dias restantes se status for 'trial'
        // Evita calcular dias quando usuário já pagou
        if (usuario.plano_financeiro_status === 'trial' && usuario.trial_expira_em) {
            const hoje = new Date();
            const expiracao = new Date(usuario.trial_expira_em);
            diasRestantes = Math.ceil((expiracao - hoje) / (1000 * 60 * 60 * 24));
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
   ROTA PARA RECUPERAR SENHA (BONUS)
===================================================== */

router.post('/recuperar-senha', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ erro: 'Email é obrigatório' });
        }

        // Verifica se email existe
        const result = await pool.query(
            'SELECT id, nome FROM usuarios WHERE email = $1',
            [email.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            // Por segurança, não informa se email existe ou não
            return res.json({ 
                ok: true, 
                mensagem: 'Se o email existir, você receberá instruções de recuperação.' 
            });
        }

        // TODO: Implementar envio de email com link de recuperação
        // Por enquanto, apenas confirma
        console.log(`📧 [RECUPERAR SENHA] Solicitação para: ${email}`);

        res.json({ 
            ok: true, 
            mensagem: 'Se o email existir, você receberá instruções de recuperação.',
            // Em desenvolvimento, retorna um aviso
            aviso: 'Funcionalidade de email ainda não implementada. Contate o suporte.'
        });

    } catch (err) {
        console.error('❌ [RECUPERAR SENHA] Erro:', err.message);
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

module.exports = router;