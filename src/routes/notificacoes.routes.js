const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const controller = require('../controllers/notificacoesController');

router.get('/notificacoes', authMiddleware, controller.listar);
router.get('/notificacoes/count', authMiddleware, controller.contarNaoLidas);
router.put('/notificacoes/ler-todas', authMiddleware, controller.marcarTodasComoLidas);
router.put('/notificacoes/:id/lida', authMiddleware, controller.marcarComoLida);

// Config de alertas
router.get('/config/alertas', authMiddleware, controller.buscarConfig);
router.put('/config/alertas', authMiddleware, controller.salvarConfig);

module.exports = router;
