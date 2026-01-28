const express = require('express');
const router = express.Router();
const { salvarCalculo, listarHistorico, excluirCalculo } = require('../controllers/calculosController');
const authMiddleware = require('../middlewares/authMiddleware');
const planMiddleware = require('../middlewares/planMiddleware');

// ============================================================
// 🔒 CÁLCULOS JURÍDICOS - AVANÇADO E PREMIUM APENAS
// ============================================================

router.post('/calculos/salvar', 
    authMiddleware, 
    planMiddleware.checkFeature('calculos'),
    salvarCalculo
);

router.get('/calculos/historico', 
    authMiddleware, 
    planMiddleware.checkFeature('calculos'),
    listarHistorico
);

router.delete('/calculos/excluir/:id', 
    authMiddleware, 
    planMiddleware.checkFeature('calculos'),
    excluirCalculo
);

module.exports = router;