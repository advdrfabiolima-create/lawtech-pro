const express = require('express');
const router = express.Router();
const clientesController = require('../controllers/clientesController');
const authMiddleware = require('../middlewares/authMiddleware');

// Note que aqui NÃO colocamos /api, pois o server.js já coloca
router.get('/clientes', authMiddleware, clientesController.listarClientes);
router.post('/clientes', authMiddleware, clientesController.criarCliente);
router.put('/clientes/:id', authMiddleware, clientesController.editarCliente);
router.delete('/clientes/:id', authMiddleware, clientesController.excluirCliente);

module.exports = router;