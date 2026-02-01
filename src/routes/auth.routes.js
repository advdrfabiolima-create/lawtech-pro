const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

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

        console.log('ðŸ“ [REGISTRO] Nova solicitaÃ§Ã£o de cadastro:', email);

        // âœ… ValidaÃ§Ãµes de entrada
        if (!nome || !email || !senha) {
            return res.status(400).json({ 
                erro: 'Nome, email e senha sÃ£o obrigatÃ³rios' 
            });
        }

        if (senha.length < 6) {
            return res.status(400).json({ 
                erro: 'A senha deve ter no mÃ­nimo 6 caracteres' 
            });
        }

        // âœ… ValidaÃ§Ã£o de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                erro: 'Email invÃ¡lido' 
            });
        }

        // âœ… Verifica se email jÃ¡ existe
        const emailCheck = await pool.query(
            'SELECT id FROM usuarios WHERE email = $1',
            [email.toLowerCase().trim()]
        );

        if (emailCheck.rows.length > 0) {
            return res.status(400).json({ 
                erro: 'Este email jÃ¡ estÃ¡ cadastrado. FaÃ§a login ou use outro email.' 
            });
        }

        // âœ… Hash da senha
        const hashedPassword = await bcrypt.hash(senha, 10);

        // âœ… Preparar dados do documento
        const documentoLimpo = documento ? documento.replace(/\D/g, '') : null;

        // âœ… Calcular data de expiraÃ§Ã£o do trial (7 dias)
        const dataExpiracao = new Date();
        dataExpiracao.setDate(dataExpiracao.getDate() + 7);

        // âœ… TRANSAÃ‡ÃƒO: Criar escritÃ³rio e usuÃ¡rio
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // 1ï¸âƒ£ Criar escritÃ³rio
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
                    cidade || 'NÃ£o informado',
                    estado || 'BA',
                    planoId || 1, // Plano BÃ¡sico por padrÃ£o
                    dataExpiracao,
                    'trial' // Status inicial
                ]
            );

            const escritorioId = escritorioResult.rows[0].id;

            console.log(`âœ… [REGISTRO] EscritÃ³rio criado: ID ${escritorioId}`);

            // 2ï¸âƒ£ Criar usuÃ¡rio (administrador do escritÃ³rio)
            const usuarioResult = await client.query(
                `INSERT INTO usuarios 
                 (nome, email, senha, role, escritorio_id) 
                 VALUES ($1, $2, $3, $4, $5) 
                 RETURNING id, nome, email, role`,
                [
                    nome,
                    email.toLowerCase().trim(),
                    hashedPassword,
                    'admin', // Primeiro usuÃ¡rio Ã© sempre admin
                    escritorioId
                ]
            );

            const usuario = usuarioResult.rows[0];

            console.log(`âœ… [REGISTRO] UsuÃ¡rio criado: ${usuario.email} (ID: ${usuario.id})`);

            await client.query('COMMIT');

            // âœ… Gerar token JWT
            const token = jwt.sign(
                { 
                    id: usuario.id,
                    email: usuario.email,
                    escritorio_id: escritorioId,
                    role: usuario.role
                },
                process.env.JWT_SECRET || 'segredo_temporario',
                { expiresIn: '7d' }
            );

            console.log(`ðŸŽ‰ [REGISTRO] Cadastro concluÃ­do com sucesso: ${usuario.email}`);

            // âœ… Retorna sucesso
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
        console.error('âŒ [REGISTRO] Erro ao processar cadastro:', err.message);
        console.error('Stack:', err.stack);
        
        // Mensagens de erro especÃ­ficas
        if (err.message.includes('unique')) {
            return res.status(400).json({ 
                erro: 'Email jÃ¡ cadastrado no sistema' 
            });
        }
        
        if (err.message.includes('escritorios')) {
            return res.status(500).json({ 
                erro: 'Erro ao criar escritÃ³rio. Verifique os dados e tente novamente.' 
            });
        }

        res.status(500).json({ 
            erro: 'Erro ao processar cadastro. Tente novamente em alguns instantes.',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

/* ======================================================
   ROTA DE LOGIN
===================================================== */

router.post('/login', async (req, res) => {
    try {
        const { email, senha } = req.body;

        console.log('ðŸ” [LOGIN] Tentativa de login:', email);

        if (!email || !senha) {
            return res.status(400).json({ 
                erro: 'Email e senha sÃ£o obrigatÃ³rios' 
            });
        }

        // Busca usuÃ¡rio
        const result = await pool.query(
            `SELECT u.id, u.nome, u.email, u.senha, u.role, u.escritorio_id,
                    e.plano_id, e.trial_expira_em, e.plano_financeiro_status
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

        // Gera token
        const token = jwt.sign(
            { 
                id: usuario.id,
                email: usuario.email,
                escritorio_id: usuario.escritorio_id,
                role: usuario.role
            },
            process.env.JWT_SECRET || 'segredo_temporario',
            { expiresIn: '7d' }
        );

        console.log(`âœ… [LOGIN] Login bem-sucedido: ${usuario.email}`);

        // Calcula dias restantes do trial
        let diasRestantes = null;
        if (usuario.trial_expira_em) {
            const hoje = new Date();
            const expiracao = new Date(usuario.trial_expira_em);
            diasRestantes = Math.ceil((expiracao - hoje) / (1000 * 60 * 60 * 24));
        }

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
                dias_restantes: diasRestantes
            }
        });

    } catch (err) {
        console.error('âŒ [LOGIN] Erro:', err.message);
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
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'segredo_temporario');

        // ADICIONADO: u.tour_desativado e u.data_criacao no SELECT
        const result = await pool.query(
            `SELECT u.id, u.nome, u.email, u.role, u.escritorio_id, u.tour_desativado, u.data_criacao,
                    e.plano_id, e.trial_expira_em, e.plano_financeiro_status
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             WHERE u.id = $1`,
            [decoded.id]
        );

        if (result.rows.length === 0) return res.status(401).json({ erro: 'Usuário não encontrado' });

        const usuario = result.rows[0];

        let diasRestantes = null;
        if (usuario.trial_expira_em) {
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
                tour_desativado: usuario.tour_desativado, // Agora o frontend recebe isso!
                data_criacao: usuario.data_criacao,
                plano_id: usuario.plano_id,
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
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'segredo_temporario');
        
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
   ROTA PARA RECUPERAR SENHA (BONUS)
===================================================== */

router.post('/recuperar-senha', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ erro: 'Email Ã© obrigatÃ³rio' });
        }

        // Verifica se email existe
        const result = await pool.query(
            'SELECT id, nome FROM usuarios WHERE email = $1',
            [email.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            // Por seguranÃ§a, nÃ£o informa se email existe ou nÃ£o
            return res.json({ 
                ok: true, 
                mensagem: 'Se o email existir, vocÃª receberÃ¡ instruÃ§Ãµes de recuperaÃ§Ã£o.' 
            });
        }

        // TODO: Implementar envio de email com link de recuperaÃ§Ã£o
        // Por enquanto, apenas confirma
        console.log(`ðŸ“§ [RECUPERAR SENHA] SolicitaÃ§Ã£o para: ${email}`);

        res.json({ 
            ok: true, 
            mensagem: 'Se o email existir, vocÃª receberÃ¡ instruÃ§Ãµes de recuperaÃ§Ã£o.',
            // Em desenvolvimento, retorna um aviso
            aviso: 'Funcionalidade de email ainda nÃ£o implementada. Contate o suporte.'
        });

    } catch (err) {
        console.error('âŒ [RECUPERAR SENHA] Erro:', err.message);
        res.status(500).json({ erro: 'Erro ao processar solicitaÃ§Ã£o' });
    }
});

module.exports = router;