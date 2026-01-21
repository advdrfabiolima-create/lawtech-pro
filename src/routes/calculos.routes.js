const express = require('express');
const router = express.Router();
// 🚀 ADICIONADO: excluirCalculo dentro das chaves
const { salvarCalculo, listarHistorico, excluirCalculo } = require('../controllers/calculosController');
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/calculos/salvar', authMiddleware, salvarCalculo);
router.get('/calculos/historico', authMiddleware, listarHistorico);

// 🚀 CORRIGIDO: Removido o prefixo "calculosController." que causava o erro
router.delete('/calculos/excluir/:id', authMiddleware, excluirCalculo);

module.exports = router;