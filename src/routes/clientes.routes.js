const express = require('express');
const router = express.Router();

const clientesController = require('../controllers/clientesController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
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
    roleMiddleware('admin', 'operador'),
    verificarPagamento,
    clientesController.criarCliente
);

// Editar cliente
router.put(
    '/clientes/:id',
    authMiddleware,
    roleMiddleware('admin', 'operador'),
    verificarPagamento,
    clientesController.editarCliente
);

// Excluir cliente
router.delete(
    '/clientes/:id',
    authMiddleware,
    roleMiddleware('admin'),
    verificarPagamento,
    clientesController.excluirCliente
);

module.exports = router;