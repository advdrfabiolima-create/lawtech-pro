const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { criarSala, criarToken, deletarSala } = require('../services/dailyService');

// GET /api/reunioes — Lista reuniões do escritório
router.get('/reunioes', async (req, res) => {
    const escritorio_id = req.user.escritorio_id;
    try {
        const result = await pool.query(
            `SELECT r.*, c.nome AS cliente_nome
             FROM reunioes r
             LEFT JOIN clientes c ON c.id = r.cliente_id
             WHERE r.escritorio_id = $1
             ORDER BY r.data_hora DESC`,
            [escritorio_id]
        );
        res.json({ ok: true, reunioes: result.rows });
    } catch (err) {
        console.error('[Reuniões] GET /reunioes erro:', err.message);
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// POST /api/reunioes — Cria reunião + sala Daily.co
router.post('/reunioes', async (req, res) => {
    const escritorio_id = req.user.escritorio_id;
    const usuario_id = req.user.id;
    const { cliente_id, titulo, descricao, data_hora, duracao_minutos } = req.body;

    if (!titulo || !data_hora) {
        return res.status(400).json({ ok: false, erro: 'titulo e data_hora são obrigatórios.' });
    }

    // Valida cliente pertence ao escritório (se informado)
    if (cliente_id) {
        try {
            const check = await pool.query(
                'SELECT id FROM clientes WHERE id = $1 AND escritorio_id = $2',
                [cliente_id, escritorio_id]
            );
            if (check.rows.length === 0) {
                return res.status(404).json({ ok: false, erro: 'Cliente não encontrado.' });
            }
        } catch (err) {
            console.error('[Reuniões] POST /reunioes erro validação cliente:', err.message);
            return res.status(500).json({ ok: false, erro: 'Erro interno.' });
        }
    }

    const duracao = parseInt(duracao_minutos) || 60;

    // Calcula expiração: data_hora + duracao + 30min de folga
    const dataHora = new Date(data_hora);
    const expMs = dataHora.getTime() + (duracao + 30) * 60 * 1000;
    const expTimestamp = Math.floor(expMs / 1000);

    // Cria a sala no Daily.co
    let dailyRoom;
    try {
        if (!process.env.DAILY_API_KEY) {
            return res.status(503).json({ ok: false, erro: 'Integração de videochamada não configurada. Adicione DAILY_API_KEY no servidor.' });
        }
        // Usamos um ID temporário; após INSERT obtemos o real ID
        // Criamos a sala com timestamp para garantir nome único
        const tempId = Date.now();
        dailyRoom = await criarSala(tempId, expTimestamp);
    } catch (err) {
        console.error('[Reuniões] Erro ao criar sala Daily.co:', err.message);
        return res.status(502).json({ ok: false, erro: 'Não foi possível criar a sala de videochamada. Verifique a chave DAILY_API_KEY.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO reunioes
                (escritorio_id, cliente_id, usuario_id, titulo, descricao, data_hora, duracao_minutos, daily_room_name, daily_room_url, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'agendada')
             RETURNING *`,
            [escritorio_id, cliente_id || null, usuario_id, titulo, descricao || null, data_hora, duracao, dailyRoom.name, dailyRoom.url]
        );

        // JOIN com cliente para retornar o nome
        const reuniao = result.rows[0];
        if (cliente_id) {
            const cli = await pool.query('SELECT nome FROM clientes WHERE id = $1', [cliente_id]);
            reuniao.cliente_nome = cli.rows[0]?.nome || null;
        }

        res.json({ ok: true, reuniao });
    } catch (err) {
        console.error('[Reuniões] POST /reunioes erro INSERT:', err.message);
        // Tenta limpar sala criada no Daily.co se INSERT falhou
        try { await deletarSala(dailyRoom.name); } catch (_) {}
        res.status(500).json({ ok: false, erro: 'Erro interno ao salvar reunião.' });
    }
});

// GET /api/reunioes/:id/token — Gera token Daily.co para o advogado (is_owner: true)
router.get('/reunioes/:id/token', async (req, res) => {
    const escritorio_id = req.user.escritorio_id;
    const { id } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM reunioes WHERE id = $1 AND escritorio_id = $2',
            [id, escritorio_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Reunião não encontrada.' });
        }

        const reuniao = result.rows[0];

        if (reuniao.status === 'cancelada') {
            return res.status(400).json({ ok: false, erro: 'Esta reunião foi cancelada.' });
        }

        if (!process.env.DAILY_API_KEY) {
            return res.status(503).json({ ok: false, erro: 'Integração de videochamada não configurada.' });
        }

        const dataHora = new Date(reuniao.data_hora);
        const duracao = reuniao.duracao_minutos || 60;
        const expFromMeeting = Math.floor((dataHora.getTime() + (duracao + 30) * 60 * 1000) / 1000);
        const expTimestamp = Math.max(expFromMeeting, Math.floor(Date.now() / 1000) + 3600);

        const token = await criarToken(reuniao.daily_room_name, true, expTimestamp);

        res.json({ ok: true, token, room_url: reuniao.daily_room_url });
    } catch (err) {
        console.error('[Reuniões] GET /reunioes/:id/token erro:', err.message);
        res.status(500).json({ ok: false, erro: 'Erro ao gerar token de acesso.' });
    }
});

// PATCH /api/reunioes/:id/status — Atualiza status (concluida / cancelada)
router.patch('/reunioes/:id/status', async (req, res) => {
    const escritorio_id = req.user.escritorio_id;
    const { id } = req.params;
    const { status } = req.body;

    const statusPermitidos = ['agendada', 'concluida', 'cancelada'];
    if (!statusPermitidos.includes(status)) {
        return res.status(400).json({ ok: false, erro: 'Status inválido.' });
    }

    try {
        const result = await pool.query(
            `UPDATE reunioes SET status = $1, atualizado_em = NOW()
             WHERE id = $2 AND escritorio_id = $3
             RETURNING *`,
            [status, id, escritorio_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Reunião não encontrada.' });
        }

        res.json({ ok: true, reuniao: result.rows[0] });
    } catch (err) {
        console.error('[Reuniões] PATCH /reunioes/:id/status erro:', err.message);
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// DELETE /api/reunioes/:id — Cancela reunião: deleta sala Daily.co + marca cancelada
router.delete('/reunioes/:id', async (req, res) => {
    const escritorio_id = req.user.escritorio_id;
    const { id } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM reunioes WHERE id = $1 AND escritorio_id = $2',
            [id, escritorio_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Reunião não encontrada.' });
        }

        const reuniao = result.rows[0];

        // Tenta deletar sala no Daily.co
        if (reuniao.daily_room_name && process.env.DAILY_API_KEY) {
            try {
                await deletarSala(reuniao.daily_room_name);
            } catch (err) {
                console.warn('[Reuniões] Aviso: não foi possível deletar sala Daily.co:', err.message);
            }
        }

        await pool.query(
            `UPDATE reunioes SET status = 'cancelada', atualizado_em = NOW() WHERE id = $1`,
            [id]
        );

        res.json({ ok: true });
    } catch (err) {
        console.error('[Reuniões] DELETE /reunioes/:id erro:', err.message);
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

module.exports = router;
