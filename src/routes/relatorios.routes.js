const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const controller = require('../controllers/relatoriosController');

router.get('/relatorios/financeiro', authMiddleware, controller.financeiro);
router.get('/relatorios/prazos', authMiddleware, controller.prazos);
router.get('/relatorios/processos', authMiddleware, controller.processos);
router.get('/relatorios/produtividade', authMiddleware, controller.produtividade);
router.get('/relatorios/crm', authMiddleware, controller.crm);

module.exports = router;
