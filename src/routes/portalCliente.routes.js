const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');
const { sign: jwtSign } = require('../config/jwt');
const authMiddleware = require('../middlewares/authMiddleware');
const portalMiddleware = require('../middlewares/portalMiddleware');
const logger = require('../utils/logger');
// dailyService não é mais necessário no portal (Jitsi não usa tokens)

// Rate limiting para autenticação do portal — protege contra brute-force de tokens
const portalAuthLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutos
    max: 5,                   // máximo 5 tentativas por IP a cada 10 min
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, erro: 'Muitas tentativas de autenticação. Aguarde 10 minutos e tente novamente.' }
});

// GET /api/portal/autenticar?token=xxx  (público)
router.get('/autenticar', portalAuthLimiter, async (req, res) => {
    const { token } = req.query;

    if (!token || token.length !== 64) {
        return res.status(400).json({ ok: false, erro: 'Token inválido.' });
    }

    try {
        const result = await pool.query(
            `SELECT id, nome, email, escritorio_id, portal_token_expira_em
             FROM clientes
             WHERE portal_token = $1`,
            [token]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ ok: false, erro: 'Link inválido ou expirado. Solicite um novo ao seu advogado.' });
        }

        const cliente = result.rows[0];

        if (!cliente.portal_token_expira_em || new Date(cliente.portal_token_expira_em) < new Date()) {
            return res.status(401).json({ ok: false, erro: 'Link expirado. Solicite um novo ao seu advogado.' });
        }

        const escritorioResult = await pool.query(
            'SELECT nome, advogado_responsavel, logo_arquivo, logo_base64 FROM escritorios WHERE id = $1',
            [cliente.escritorio_id]
        );
        const escritorio = escritorioResult.rows[0] || {};

        const portalToken = jwtSign(
            { cliente_id: cliente.id, escritorio_id: cliente.escritorio_id, scope: 'portal_cliente' },
            { expiresIn: '7d' }
        );

        res.json({
            ok: true,
            token: portalToken,
            nome: cliente.nome,
            escritorio: {
                nome: escritorio.nome || '',
                advogado: escritorio.advogado_responsavel || '',
                logo_arquivo: escritorio.logo_arquivo || null,
                logo_base64: escritorio.logo_base64 || null
            }
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Portal] GET /autenticar erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// POST /api/portal/gerar-token  (advogado autenticado)
router.post('/gerar-token', authMiddleware, async (req, res) => {
    const { cliente_id } = req.body;
    const escritorio_id = req.user.escritorio_id;

    if (!cliente_id) {
        return res.status(400).json({ ok: false, erro: 'cliente_id é obrigatório.' });
    }

    try {
        const check = await pool.query(
            'SELECT id FROM clientes WHERE id = $1 AND escritorio_id = $2',
            [cliente_id, escritorio_id]
        );

        if (check.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Cliente não encontrado.' });
        }

        const novoToken = crypto.randomBytes(32).toString('hex'); // 64 chars

        await pool.query(
            `UPDATE clientes
             SET portal_token = $1, portal_token_expira_em = NOW() + INTERVAL '90 days'
             WHERE id = $2`,
            [novoToken, cliente_id]
        );

        res.json({
            ok: true,
            token: novoToken,
            url: '/portal-cliente?token=' + novoToken
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Portal] POST /gerar-token erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// GET /api/portal/meus-processos  (portal JWT)
router.get('/meus-processos', portalMiddleware, async (req, res) => {
    const cliente_id = req.cliente.id;
    const escritorio_id = req.cliente.escritorio_id;

    try {
        const result = await pool.query(
            `SELECT DISTINCT ON (p.id)
                p.id, p.numero, p.tribunal, p.esfera, p.instancia, p.status, p.uf,
                (
                    SELECT string_agg(pp2.pessoa_nome, ' · ' ORDER BY pp2.eh_principal DESC, pp2.id ASC)
                    FROM partes_processo pp2
                    WHERE pp2.processo_id = p.id
                      AND pp2.polo = 'ativo'
                      AND pp2.escritorio_id = $2
                ) AS polo_ativo,
                (
                    SELECT string_agg(pp2.pessoa_nome, ' · ' ORDER BY pp2.eh_principal DESC, pp2.id ASC)
                    FROM partes_processo pp2
                    WHERE pp2.processo_id = p.id
                      AND pp2.polo = 'passivo'
                      AND pp2.escritorio_id = $2
                ) AS polo_passivo
             FROM processos p
             JOIN partes_processo pp ON pp.processo_id = p.id
             WHERE pp.pessoa_id = $1
               AND p.escritorio_id = $2
               AND p.status != 'excluido'
             ORDER BY p.id DESC`,
            [cliente_id, escritorio_id]
        );

        res.json({ ok: true, processos: result.rows });
    } catch (err) {
        logger.error({ err: err.message }, '[Portal] GET /meus-processos erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// GET /api/portal/processos/:id/andamentos  (portal JWT)
router.get('/processos/:id/andamentos', portalMiddleware, async (req, res) => {
    const { id } = req.params;
    const cliente_id = req.cliente.id;
    const escritorio_id = req.cliente.escritorio_id;

    try {
        // Verifica que o cliente tem acesso a esse processo
        const acesso = await pool.query(
            `SELECT 1 FROM processos p
             JOIN partes_processo pp ON pp.processo_id = p.id
             WHERE p.id = $1 AND p.escritorio_id = $2 AND pp.pessoa_id = $3
             LIMIT 1`,
            [id, escritorio_id, cliente_id]
        );

        if (acesso.rows.length === 0) {
            return res.status(403).json({ ok: false, erro: 'Acesso negado a este processo.' });
        }

        const result = await pool.query(
            `SELECT id, data_andamento, tipo, titulo, descricao, criado_em
             FROM andamentos_processuais
             WHERE processo_id = $1
               AND escritorio_id = $2
               AND visivel_cliente = true
             ORDER BY data_andamento DESC, criado_em DESC`,
            [id, escritorio_id]
        );

        res.json({ ok: true, andamentos: result.rows });
    } catch (err) {
        logger.error({ err: err.message }, '[Portal] GET /processos/:id/andamentos erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// GET /api/portal/reunioes  (portal JWT)
router.get('/reunioes', portalMiddleware, async (req, res) => {
    const cliente_id = req.cliente.id;
    const escritorio_id = req.cliente.escritorio_id;

    try {
        const result = await pool.query(
            `SELECT id, titulo, descricao, data_hora, duracao_minutos, status
             FROM reunioes
             WHERE cliente_id = $1
               AND escritorio_id = $2
               AND status != 'cancelada'
             ORDER BY data_hora DESC`,
            [cliente_id, escritorio_id]
        );

        res.json({ ok: true, reunioes: result.rows });
    } catch (err) {
        logger.error({ err: err.message }, '[Portal] GET /reunioes erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// GET /api/portal/reunioes/:id/token  (portal JWT)
// Retorna a URL da sala Jitsi — sem tokens, sem API key
router.get('/reunioes/:id/token', portalMiddleware, async (req, res) => {
    const { id } = req.params;
    const cliente_id = req.cliente.id;
    const escritorio_id = req.cliente.escritorio_id;

    try {
        const result = await pool.query(
            `SELECT id, titulo, data_hora, daily_room_url, status, peer_host_id FROM reunioes
             WHERE id = $1 AND cliente_id = $2 AND escritorio_id = $3`,
            [id, cliente_id, escritorio_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Reunião não encontrada.' });
        }

        const reuniao = result.rows[0];

        if (reuniao.status === 'cancelada') {
            return res.status(400).json({ ok: false, erro: 'Esta reunião foi cancelada.' });
        }

        res.json({
            ok: true,
            room_url: reuniao.daily_room_url,
            peer_host_id: reuniao.peer_host_id || null,
            titulo: reuniao.titulo,
            data_hora: reuniao.data_hora
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Portal] GET /reunioes/:id/token erro');
        res.status(500).json({ ok: false, erro: 'Erro ao obter URL da sala.' });
    }
});

module.exports = router;
