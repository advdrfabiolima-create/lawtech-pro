const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const roleMiddleware = require('../middlewares/roleMiddleware');
const logger = require('../utils/logger');

// GET /api/processos/:id/andamentos — listar andamentos de um processo
router.get('/processos/:id/andamentos', async (req, res) => {
    const { id } = req.params;
    const escritorio_id = req.user.escritorio_id;
    try {
        // Verifica que o processo pertence ao escritório
        const proc = await pool.query(
            'SELECT id FROM processos WHERE id = $1 AND escritorio_id = $2',
            [id, escritorio_id]
        );
        if (!proc.rows.length) {
            return res.status(404).json({ ok: false, erro: 'Processo não encontrado.' });
        }

        const result = await pool.query(
            `SELECT a.*, u.nome AS usuario_nome
             FROM andamentos_processuais a
             LEFT JOIN usuarios u ON u.id = a.usuario_id
             WHERE a.processo_id = $1
               AND a.escritorio_id = $2
             ORDER BY a.data_andamento DESC, a.criado_em DESC`,
            [id, escritorio_id]
        );
        res.json({ ok: true, andamentos: result.rows });
    } catch (err) {
        logger.error({ err: err.message }, '[Andamentos] GET erro');
        res.status(500).json({ ok: false, erro: err.message });
    }
});

// POST /api/processos/:id/andamentos — criar andamento
router.post('/processos/:id/andamentos', roleMiddleware('admin', 'operador'), async (req, res) => {
    const { id } = req.params;
    const escritorio_id = req.user.escritorio_id;
    const { data_andamento, tipo, titulo, descricao, visivel_cliente } = req.body;

    if (!titulo || !titulo.trim()) {
        return res.status(400).json({ ok: false, erro: 'Título é obrigatório.' });
    }
    if (!data_andamento) {
        return res.status(400).json({ ok: false, erro: 'Data do andamento é obrigatória.' });
    }

    try {
        // Verifica que o processo pertence ao escritório
        const proc = await pool.query(
            'SELECT id FROM processos WHERE id = $1 AND escritorio_id = $2',
            [id, escritorio_id]
        );
        if (!proc.rows.length) {
            return res.status(404).json({ ok: false, erro: 'Processo não encontrado.' });
        }

        const result = await pool.query(
            `INSERT INTO andamentos_processuais
                (processo_id, escritorio_id, usuario_id, data_andamento, tipo, titulo, descricao, visivel_cliente, fonte)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual')
             RETURNING *`,
            [
                id,
                escritorio_id,
                req.user.id,
                data_andamento,
                tipo || 'outros',
                titulo.trim(),
                descricao ? descricao.trim() : null,
                visivel_cliente === true || visivel_cliente === 'true'
            ]
        );
        res.status(201).json({ ok: true, andamento: result.rows[0] });
    } catch (err) {
        logger.error({ err: err.message }, '[Andamentos] POST erro');
        res.status(500).json({ ok: false, erro: err.message });
    }
});

// PUT /api/andamentos/:id — editar andamento (admin + operador)
router.put('/andamentos/:id', roleMiddleware('admin', 'operador'), async (req, res) => {
    const { id } = req.params;
    const escritorio_id = req.user.escritorio_id;
    const { data_andamento, tipo, titulo, descricao, visivel_cliente } = req.body;

    if (!titulo || !titulo.trim()) {
        return res.status(400).json({ ok: false, erro: 'Título é obrigatório.' });
    }
    if (!data_andamento) {
        return res.status(400).json({ ok: false, erro: 'Data do andamento é obrigatória.' });
    }

    try {
        const result = await pool.query(
            `UPDATE andamentos_processuais
             SET data_andamento = $1, tipo = $2, titulo = $3, descricao = $4, visivel_cliente = $5
             WHERE id = $6 AND escritorio_id = $7
             RETURNING *`,
            [
                data_andamento,
                tipo || 'outros',
                titulo.trim(),
                descricao ? descricao.trim() : null,
                visivel_cliente === true || visivel_cliente === 'true',
                id,
                escritorio_id
            ]
        );
        if (!result.rows.length) {
            return res.status(404).json({ ok: false, erro: 'Andamento não encontrado.' });
        }
        res.json({ ok: true, andamento: result.rows[0] });
    } catch (err) {
        logger.error({ err: err.message }, '[Andamentos] PUT erro');
        res.status(500).json({ ok: false, erro: err.message });
    }
});

// DELETE /api/andamentos/:id — excluir andamento (admin)
router.delete('/andamentos/:id', roleMiddleware('admin'), async (req, res) => {
    const { id } = req.params;
    const escritorio_id = req.user.escritorio_id;
    try {
        const result = await pool.query(
            'DELETE FROM andamentos_processuais WHERE id = $1 AND escritorio_id = $2 RETURNING id',
            [id, escritorio_id]
        );
        if (!result.rows.length) {
            return res.status(404).json({ ok: false, erro: 'Andamento não encontrado.' });
        }
        res.json({ ok: true });
    } catch (err) {
        logger.error({ err: err.message }, '[Andamentos] DELETE erro');
        res.status(500).json({ ok: false, erro: err.message });
    }
});

// PATCH /api/andamentos/:id/visivel — toggle visível ao cliente
router.patch('/andamentos/:id/visivel', roleMiddleware('admin', 'operador'), async (req, res) => {
    const { id } = req.params;
    const escritorio_id = req.user.escritorio_id;
    const { visivel_cliente } = req.body;

    if (typeof visivel_cliente === 'undefined') {
        return res.status(400).json({ ok: false, erro: 'Campo visivel_cliente é obrigatório.' });
    }
    try {
        const result = await pool.query(
            'UPDATE andamentos_processuais SET visivel_cliente = $1 WHERE id = $2 AND escritorio_id = $3 RETURNING id, visivel_cliente',
            [visivel_cliente === true || visivel_cliente === 'true', id, escritorio_id]
        );
        if (!result.rows.length) {
            return res.status(404).json({ ok: false, erro: 'Andamento não encontrado.' });
        }
        res.json({ ok: true, visivel_cliente: result.rows[0].visivel_cliente });
    } catch (err) {
        logger.error({ err: err.message }, '[Andamentos] PATCH visivel erro');
        res.status(500).json({ ok: false, erro: err.message });
    }
});

module.exports = router;
