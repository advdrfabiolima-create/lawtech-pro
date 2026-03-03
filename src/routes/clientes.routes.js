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


// ================================
// ROTAS DE CONTRATOS DE HONORÁRIOS
// ================================
const contratosController = require('../controllers/contratosController');

// Listar contratos do cliente
router.get(
    '/clientes/:id/contratos',
    authMiddleware,
    verificarPagamento,
    contratosController.listarContratos
);

// Criar contrato
router.post(
    '/clientes/:id/contratos',
    authMiddleware,
    roleMiddleware('admin', 'operador'),
    verificarPagamento,
    contratosController.criarContrato
);

// Gerar template HTML
router.get(
    '/clientes/:id/contratos/:contratoId/template',
    authMiddleware,
    verificarPagamento,
    contratosController.gerarTemplate
);

// Upload PDF assinado
router.post(
    '/contratos/:contratoId/upload',
    authMiddleware,
    roleMiddleware('admin', 'operador'),
    verificarPagamento,
    contratosController.uploadMiddleware,
    contratosController.uploadContratoAssinado
);

// Download PDF
router.get(
    '/contratos/:contratoId/arquivo',
    authMiddleware,
    verificarPagamento,
    contratosController.downloadContrato
);

// Editar metadados
router.put(
    '/contratos/:contratoId',
    authMiddleware,
    roleMiddleware('admin', 'operador'),
    verificarPagamento,
    contratosController.editarContrato
);

// Excluir contrato
router.delete(
    '/contratos/:contratoId',
    authMiddleware,
    roleMiddleware('admin'),
    verificarPagamento,
    contratosController.excluirContrato
);

module.exports = router;