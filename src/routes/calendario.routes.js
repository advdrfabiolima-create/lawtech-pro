const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const controller = require('../controllers/calendarioController');

// ── Calendário mensal (prazos + feriados + compromissos) ──────────────────
router.get('/calendario/mensal', authMiddleware, controller.dadosMensal);

// ── Feriados ──────────────────────────────────────────────────────────────
// IMPORTANTE: rota específica /inicializar ANTES de /:id
router.get('/calendario/feriados',              authMiddleware, controller.listarFeriados);
router.post('/calendario/feriados/inicializar', authMiddleware, roleMiddleware('admin'), controller.inicializarFeriados);
router.post('/calendario/feriados',             authMiddleware, roleMiddleware('admin', 'operador'), controller.criarFeriado);
router.delete('/calendario/feriados/:id',       authMiddleware, roleMiddleware('admin'), controller.deletarFeriado);

// ── Compromissos ──────────────────────────────────────────────────────────
router.post('/calendario/compromissos',         authMiddleware, roleMiddleware('admin', 'operador'), controller.criarCompromisso);
router.delete('/calendario/compromissos/:id',   authMiddleware, roleMiddleware('admin', 'operador'), controller.deletarCompromisso);

module.exports = router;