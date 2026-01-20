const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');

// Importamos as funções do Controller
const {
  listarPlanos,
  upgradePlano,
  meuPlano,
  planoEConsumo // 👈 IMPORTANTE
} = require('../controllers/planoController');

// ============================
// ROTAS DE PLANOS
// ============================

router.get('/planos', authMiddleware, listarPlanos);
router.get('/planos/meu-plano', authMiddleware, meuPlano);
router.post('/planos/upgrade', authMiddleware, upgradePlano);

// ============================
// PLANO & CONSUMO (DASHBOARD)
// ============================

router.get('/plano-consumo', authMiddleware, planoEConsumo);

module.exports = router;
