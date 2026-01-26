const express = require('express');
const router = express.Router();
const planoController = require('../controllers/planoController'); 
const authMiddleware = require('../middlewares/authMiddleware');

// ============================
// ROTAS DE PLANOS
// ============================

// Usamos o objeto 'planoController' para chamar todas as funções
router.get('/planos', authMiddleware, planoController.listarPlanos);
router.get('/planos/meu-plano', authMiddleware, planoController.meuPlano);
router.post('/planos/upgrade', authMiddleware, planoController.upgradePlano);

// Rota de cancelamento (agora devidamente conectada)
router.post('/cancelar-agendamento', authMiddleware, planoController.cancelarAgendamento);

// ============================
// PLANO & CONSUMO (DASHBOARD)
// ============================

router.get('/plano-consumo', authMiddleware, planoController.planoEConsumo);

module.exports = router;