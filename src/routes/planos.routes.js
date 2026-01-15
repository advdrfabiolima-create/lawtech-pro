const express = require('express');
const router = express.Router();

// Importamos apenas as referências das funções do Controller
const {
  listarPlanos,
  upgradePlano,
  meuPlano
} = require('../controllers/planoController');

const authMiddleware = require('../middlewares/authMiddleware');

// Rotas: Elas apenas chamam as funções. Não usamos 'await' aqui.
router.get('/planos', authMiddleware, listarPlanos);
router.get('/planos/meu-plano', authMiddleware, meuPlano);
router.post('/planos/upgrade', authMiddleware, upgradePlano);

module.exports = router;