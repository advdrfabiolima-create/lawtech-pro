const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middlewares/authMiddleware');

// Rota para visualizar a saúde do sistema (LawTech Systems)
// Futuramente adicionaremos uma trava de 'role === admin' aqui
router.get('/monitoramento', authMiddleware, adminController.getLogsSistema);

module.exports = router;