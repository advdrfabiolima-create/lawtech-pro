const pool = require('../config/db');

const notificacoesController = {
    // GET /api/notificacoes — últimas 20 do usuário
    async listar(req, res) {
        try {
            const result = await pool.query(`
                SELECT n.id, n.prazo_id, n.tipo, n.titulo, n.mensagem, n.lida, n.enviada_em
                FROM notificacoes n
                WHERE n.usuario_id = $1
                ORDER BY n.enviada_em DESC
                LIMIT 20
            `, [req.user.id]);

            res.json({ ok: true, notificacoes: result.rows });
        } catch (err) {
            res.status(500).json({ ok: false, erro: err.message });
        }
    },

    // GET /api/notificacoes/count — conta não lidas
    async contarNaoLidas(req, res) {
        try {
            const result = await pool.query(
                'SELECT COUNT(*) as total FROM notificacoes WHERE usuario_id = $1 AND lida = false',
                [req.user.id]
            );
            res.json({ ok: true, count: parseInt(result.rows[0].total) });
        } catch (err) {
            res.status(500).json({ ok: false, erro: err.message });
        }
    },

    // PUT /api/notificacoes/:id/lida
    async marcarComoLida(req, res) {
        try {
            await pool.query(
                'UPDATE notificacoes SET lida = true WHERE id = $1 AND usuario_id = $2',
                [req.params.id, req.user.id]
            );
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ ok: false, erro: err.message });
        }
    },

    // PUT /api/notificacoes/ler-todas
    async marcarTodasComoLidas(req, res) {
        try {
            await pool.query(
                'UPDATE notificacoes SET lida = true WHERE usuario_id = $1 AND lida = false',
                [req.user.id]
            );
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ ok: false, erro: err.message });
        }
    },

    // GET /api/config/alertas — buscar config do escritório
    async buscarConfig(req, res) {
        try {
            const escritorioId = req.user.escritorio_id;
            const result = await pool.query(
                'SELECT * FROM config_alertas WHERE escritorio_id = $1',
                [escritorioId]
            );

            if (result.rowCount === 0) {
                return res.json({
                    ok: true,
                    config: { dias_alerta_1: 7, dias_alerta_2: 3, dias_alerta_3: 1, email_ativo: true, inapp_ativo: true, hora_envio: '08:00' }
                });
            }

            res.json({ ok: true, config: result.rows[0] });
        } catch (err) {
            res.status(500).json({ ok: false, erro: err.message });
        }
    },

    // PUT /api/config/alertas — salvar config do escritório
    async salvarConfig(req, res) {
        try {
            const escritorioId = req.user.escritorio_id;
            const { dias_alerta_1, dias_alerta_2, dias_alerta_3, email_ativo, inapp_ativo, hora_envio } = req.body;

            await pool.query(`
                INSERT INTO config_alertas (escritorio_id, dias_alerta_1, dias_alerta_2, dias_alerta_3, email_ativo, inapp_ativo, hora_envio, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                ON CONFLICT (escritorio_id) DO UPDATE SET
                    dias_alerta_1 = $2, dias_alerta_2 = $3, dias_alerta_3 = $4,
                    email_ativo = $5, inapp_ativo = $6, hora_envio = $7, updated_at = NOW()
            `, [escritorioId,
                dias_alerta_1 ?? 7, dias_alerta_2 ?? 3, dias_alerta_3 ?? 1,
                email_ativo ?? true, inapp_ativo ?? true, hora_envio || '08:00'
            ]);

            res.json({ ok: true, mensagem: 'Configuração de alertas salva' });
        } catch (err) {
            res.status(500).json({ ok: false, erro: err.message });
        }
    }
};

module.exports = notificacoesController;
