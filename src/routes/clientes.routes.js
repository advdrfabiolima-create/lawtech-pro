const express = require('express');
const router = express.Router();

const clientesController = require('../controllers/clientesController');
const authMiddleware = require('../middlewares/authMiddleware');
const verificarPagamento = require('../middlewares/financeiroMiddleware');

// ================================
// ROTAS DE CLIENTES
// ================================

// Listar todos os clientes
router.get(
    '/clientes',
    authMiddleware,
    verificarPagamento,
    clientesController.listarClientes
);

// Criar cliente
router.post(
    '/clientes',
    authMiddleware,
    verificarPagamento,
    clientesController.criarCliente
);

// Editar cliente
router.put(
    '/clientes/:id',
    authMiddleware,
    verificarPagamento,
    clientesController.editarCliente
);

// Excluir cliente
router.delete(
    '/clientes/:id',
    authMiddleware,
    verificarPagamento,
    clientesController.excluirCliente
);

module.exports = router;