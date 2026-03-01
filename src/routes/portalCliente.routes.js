const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../config/db');
const { sign: jwtSign } = require('../config/jwt');
const authMiddleware = require('../middlewares/authMiddleware');
const portalMiddleware = require('../middlewares/portalMiddleware');

// GET /api/portal/autenticar?token=xxx  (público)
router.get('/autenticar', async (req, res) => {
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
        console.error('[Portal] GET /autenticar erro:', err.message);
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
        console.error('[Portal] POST /gerar-token erro:', err.message);
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// GET /api/portal/meus-processos  (portal JWT)
router.get('/meus-processos', portalMiddleware, async (req, res) => {
    const cliente_id = req.cliente.id;
    const escritorio_id = req.cliente.escritorio_id;

    try {
        const result = await pool.query(
            `SELECT DISTINCT ON (p.id) p.id, p.numero, p.tribunal, p.esfera, p.instancia, p.status, p.uf
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
        console.error('[Portal] GET /meus-processos erro:', err.message);
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
        console.error('[Portal] GET /processos/:id/andamentos erro:', err.message);
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

module.exports = router;
