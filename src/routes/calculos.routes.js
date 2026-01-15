const express = require('express');
const router = express.Router();
const { salvarCalculo, listarHistorico } = require('../controllers/calculosController');
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/calculos/salvar', authMiddleware, salvarCalculo);
router.get('/calculos/historico', authMiddleware, listarHistorico);

module.exports = router;