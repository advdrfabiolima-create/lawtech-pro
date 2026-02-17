const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const controller = require('../controllers/calendarioController');

router.get('/calendario/feriados', authMiddleware, controller.listarFeriados);
router.post('/calendario/feriados', authMiddleware, controller.criarFeriado);
router.delete('/calendario/feriados/:id', authMiddleware, controller.deletarFeriado);
router.get('/calendario/mensal', authMiddleware, controller.dadosMensal);
router.post('/calendario/feriados/inicializar', authMiddleware, controller.inicializarFeriados);

module.exports = router;
