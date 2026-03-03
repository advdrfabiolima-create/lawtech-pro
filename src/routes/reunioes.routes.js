const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { criarSala } = require('../services/dailyService');
const { enviarEmailReuniao } = require('../services/emailService');
const logger = require('../utils/logger');
const { getPagination, buildPage } = require('../utils/paginate');

// GET /api/reunioes — Lista reuniões do escritório (paginado)
router.get('/reunioes', async (req, res) => {
    const escritorio_id = req.user.escritorio_id;
    const { page, limit, offset } = getPagination(req.query);
    try {
        const [result, countResult] = await Promise.all([
            pool.query(
                `SELECT r.*, c.nome AS cliente_nome
                 FROM reunioes r
                 LEFT JOIN clientes c ON c.id = r.cliente_id
                 WHERE r.escritorio_id = $1
                 ORDER BY r.data_hora DESC
                 LIMIT $2 OFFSET $3`,
                [escritorio_id, limit, offset]
            ),
            pool.query(
                'SELECT COUNT(*) AS total FROM reunioes WHERE escritorio_id = $1',
                [escritorio_id]
            )
        ]);
        const total = parseInt(countResult.rows[0].total);
        res.json({ ok: true, ...buildPage(result.rows, total, page, limit) });
    } catch (err) {
        logger.error({ err: err.message }, '[Reuniões] GET /reunioes erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// POST /api/reunioes — Cria reunião e envia e-mail de convite ao cliente
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
            logger.error({ err: err.message }, '[Reuniões] POST validação cliente erro');
            return res.status(500).json({ ok: false, erro: 'Erro interno.' });
        }
    }

    const duracao = parseInt(duracao_minutos) || 60;
    const jitsiRoom = criarSala(Date.now());

    try {
        const result = await pool.query(
            `INSERT INTO reunioes
                (escritorio_id, cliente_id, usuario_id, titulo, descricao, data_hora, duracao_minutos, daily_room_name, daily_room_url, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'agendada')
             RETURNING *`,
            [escritorio_id, cliente_id || null, usuario_id, titulo, descricao || null, data_hora, duracao, jitsiRoom.name, jitsiRoom.url]
        );

        const reuniao = result.rows[0];

        if (cliente_id) {
            const cli = await pool.query('SELECT nome FROM clientes WHERE id = $1', [cliente_id]);
            reuniao.cliente_nome = cli.rows[0]?.nome || null;
        }

        // Envia e-mail de convite ao cliente (sem await — não atrasa a resposta)
        if (cliente_id) {
            _dispararEmailReuniao({
                escritorio_id,
                usuario_id,
                cliente_id,
                reuniao
            }).catch(err => logger.warn({ err: err.message }, '[Reuniões] Falha ao disparar e-mail de convite'));
        }

        res.json({ ok: true, reuniao });
    } catch (err) {
        logger.error({ err: err.message }, '[Reuniões] POST INSERT erro');
        res.status(500).json({ ok: false, erro: 'Erro interno ao salvar reunião.' });
    }
});

// GET /api/reunioes/:id/token — Retorna URL da sala Jitsi para o advogado
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

        const crypto = require('crypto');
        const peer_host_id = 'lt-' + crypto.randomBytes(10).toString('hex');
        await pool.query('UPDATE reunioes SET peer_host_id = $1 WHERE id = $2', [peer_host_id, id]);

        res.json({ ok: true, room_url: reuniao.daily_room_url, peer_host_id });
    } catch (err) {
        logger.error({ err: err.message }, '[Reuniões] GET token erro');
        res.status(500).json({ ok: false, erro: 'Erro ao obter URL da sala.' });
    }
});

// POST /api/reunioes/:id/reenviar-email — Reenvio manual do convite pelo advogado
router.post('/reunioes/:id/reenviar-email', async (req, res) => {
    const escritorio_id = req.user.escritorio_id;
    const usuario_id = req.user.id;
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

        if (!reuniao.cliente_id) {
            return res.status(400).json({ ok: false, erro: 'Reunião sem cliente associado.' });
        }

        const emailResult = await _dispararEmailReuniao({
            escritorio_id,
            usuario_id,
            cliente_id: reuniao.cliente_id,
            reuniao
        });

        if (!emailResult.ok) {
            return res.status(400).json({ ok: false, erro: emailResult.erro });
        }

        res.json({ ok: true });
    } catch (err) {
        logger.error({ err: err.message }, '[Reuniões] POST reenviar-email erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
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
        logger.error({ err: err.message }, '[Reuniões] PATCH status erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// DELETE /api/reunioes/:id — Cancela reunião (marca status='cancelada')
router.delete('/reunioes/:id', async (req, res) => {
    const escritorio_id = req.user.escritorio_id;
    const { id } = req.params;

    try {
        const result = await pool.query(
            'SELECT id FROM reunioes WHERE id = $1 AND escritorio_id = $2',
            [id, escritorio_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Reunião não encontrada.' });
        }

        await pool.query(
            `UPDATE reunioes SET status = 'cancelada', atualizado_em = NOW() WHERE id = $1`,
            [id]
        );

        res.json({ ok: true });
    } catch (err) {
        logger.error({ err: err.message }, '[Reuniões] DELETE erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// PATCH /api/reunioes/:id/anotacoes — Salva anotações da reunião (advogado)
router.patch('/reunioes/:id/anotacoes', async (req, res) => {
    const escritorio_id = req.user.escritorio_id;
    const { id } = req.params;
    const { anotacoes } = req.body;

    try {
        const result = await pool.query(
            `UPDATE reunioes SET anotacoes = $1, atualizado_em = NOW()
             WHERE id = $2 AND escritorio_id = $3
             RETURNING id`,
            [anotacoes || null, id, escritorio_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Reunião não encontrada.' });
        }

        res.json({ ok: true });
    } catch (err) {
        logger.error({ err: err.message }, '[Reuniões] PATCH anotacoes erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// DELETE /api/reunioes/:id/excluir — Exclui permanentemente do banco (concluída/cancelada)
router.delete('/reunioes/:id/excluir', async (req, res) => {
    const escritorio_id = req.user.escritorio_id;
    const { id } = req.params;

    try {
        const result = await pool.query(
            `SELECT id, status FROM reunioes WHERE id = $1 AND escritorio_id = $2`,
            [id, escritorio_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Reunião não encontrada.' });
        }

        const { status } = result.rows[0];
        if (status === 'agendada') {
            return res.status(400).json({ ok: false, erro: 'Cancele a reunião antes de excluí-la.' });
        }

        await pool.query('DELETE FROM reunioes WHERE id = $1', [id]);

        res.json({ ok: true });
    } catch (err) {
        logger.error({ err: err.message }, '[Reuniões] DELETE excluir erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// ── Helper interno: busca dados e dispara o e-mail ────────────────────────────
async function _dispararEmailReuniao({ escritorio_id, usuario_id, cliente_id, reuniao }) {
    // Busca e-mail, nome e token do portal do cliente
    const cliResult = await pool.query(
        'SELECT nome, email, portal_token FROM clientes WHERE id = $1 AND escritorio_id = $2',
        [cliente_id, escritorio_id]
    );
    const cliente = cliResult.rows[0];

    if (!cliente?.email) {
        return { ok: false, erro: 'Cliente sem e-mail cadastrado.' };
    }

    // Busca nome do advogado responsável
    const advResult = await pool.query(
        'SELECT nome FROM usuarios WHERE id = $1',
        [usuario_id]
    );
    const nomeAdvogado = advResult.rows[0]?.nome || 'Seu advogado';

    // Monta link do portal do cliente (onde ele entra na reunião)
    const appUrl = (process.env.APP_URL || 'https://www.lawtechpro.com.br').replace(/\/$/, '');
    const linkPortal = cliente.portal_token
        ? `${appUrl}/portal-cliente.html?token=${cliente.portal_token}`
        : `${appUrl}/portal-cliente.html`;

    return enviarEmailReuniao({
        emailCliente:   cliente.email,
        nomeCliente:    cliente.nome || 'Cliente',
        tituloReuniao:  reuniao.titulo,
        dataHoraISO:    reuniao.data_hora,
        duracaoMinutos: reuniao.duracao_minutos || 60,
        linkPortal,
        nomeAdvogado,
    });
}

module.exports = router;