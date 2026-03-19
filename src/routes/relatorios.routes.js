const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { checkFeature } = require('../middlewares/planMiddleware');
const controller = require('../controllers/relatoriosController');

const gate = checkFeature('relatorios_avancados');

router.get('/relatorios/financeiro',   authMiddleware, gate, controller.financeiro);
router.get('/relatorios/prazos',       authMiddleware, gate, controller.prazos);
router.get('/relatorios/processos',    authMiddleware, gate, controller.processos);
router.get('/relatorios/produtividade',authMiddleware, gate, controller.produtividade);
router.get('/relatorios/crm',          authMiddleware, gate, controller.crm);

module.exports = router;
