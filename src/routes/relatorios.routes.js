const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { checkFeature } = require('../middlewares/planMiddleware');
const controller = require('../controllers/relatoriosController');

router.use(authMiddleware, checkFeature('relatorios_avancados'));

router.get('/relatorios/financeiro', controller.financeiro);
router.get('/relatorios/prazos', controller.prazos);
router.get('/relatorios/processos', controller.processos);
router.get('/relatorios/produtividade', controller.produtividade);
router.get('/relatorios/crm', controller.crm);

module.exports = router;
