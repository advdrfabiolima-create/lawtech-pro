const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');

// GET /api/onboarding/status
// Retorna as 3 etapas de ativação do escritório
router.get('/onboarding/status', authMiddleware, async (req, res) => {
    const escritorioId = req.user.escritorio_id;
    try {
        const [escResult, clientesResult, processosResult] = await Promise.all([
            pool.query(
                'SELECT oab FROM escritorios WHERE id = $1',
                [escritorioId]
            ),
            pool.query(
                'SELECT COUNT(*) FROM clientes WHERE escritorio_id = $1 AND deletado IS NOT TRUE',
                [escritorioId]
            ),
            pool.query(
                'SELECT COUNT(*) FROM processos WHERE escritorio_id = $1',
                [escritorioId]
            )
        ]);

        const oab = escResult.rows[0]?.oab;
        const configurou_escritorio = !!(oab && oab.trim() !== '');
        const cadastrou_cliente    = parseInt(clientesResult.rows[0].count) >= 1;
        const cadastrou_processo   = parseInt(processosResult.rows[0].count) >= 1;
        const concluido            = configurou_escritorio && cadastrou_cliente && cadastrou_processo;

        res.json({ ok: true, configurou_escritorio, cadastrou_cliente, cadastrou_processo, concluido });
    } catch (err) {
        res.status(500).json({ ok: false, erro: 'Erro ao verificar status de onboarding' });
    }
});

module.exports = router;
