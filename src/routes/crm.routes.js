const express = require('express');
const router = express.Router();
const crmController = require('../controllers/crmController');
const authMiddleware = require('../middlewares/authMiddleware');

router.get('/crm/metricas', authMiddleware, crmController.obterMetricasFunil);
router.get('/crm/leads', authMiddleware, crmController.listarLeads); // Esta linha depende da função listarLeads
router.post('/public/lead', crmController.criarLeadPublico);
router.patch('/crm/lead/:id/status', authMiddleware, crmController.atualizarStatusLead);

module.exports = router;