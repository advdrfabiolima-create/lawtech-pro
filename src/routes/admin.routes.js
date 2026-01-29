// src/routes/admin.routes.js
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middlewares/authMiddleware');

// 📊 Estatísticas gerais do sistema
router.get('/stats', authMiddleware, adminController.estatisticasGerais);

// 📋 Listar todos os escritórios
router.get('/escritorios', authMiddleware, adminController.listarEscritorios);

// 🔍 Detalhes de um escritório específico
router.get('/escritorios/:id', authMiddleware, adminController.detalhesEscritorio);

// 🗂️ Logs do sistema (rota original mantida)
router.get('/monitoramento', authMiddleware, adminController.getLogsSistema);

module.exports = router;