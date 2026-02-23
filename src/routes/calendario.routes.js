const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const controller = require('../controllers/calendarioController');

router.get('/calendario/feriados', authMiddleware, controller.listarFeriados);
router.post('/calendario/feriados', authMiddleware, roleMiddleware('admin', 'operador'), controller.criarFeriado);
router.delete('/calendario/feriados/:id', authMiddleware, roleMiddleware('admin'), controller.deletarFeriado);
router.get('/calendario/mensal', authMiddleware, controller.dadosMensal);
router.post('/calendario/feriados/inicializar', authMiddleware, roleMiddleware('admin'), controller.inicializarFeriados);

module.exports = router;
