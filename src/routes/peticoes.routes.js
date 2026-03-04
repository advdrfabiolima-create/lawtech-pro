/**
 * ============================================
 * ROTAS: PETIÇÕES
 * Sistema de geração de petições com IA
 * ============================================
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const planMiddleware = require('../middlewares/planMiddleware');
const PeticoesController = require('../controllers/peticoesController');
const logger = require('../utils/logger');

// ===== ROTAS PROTEGIDAS - REQUEREM AUTENTICAÇÃO =====

/**
 * POST /api/peticoes/gerar
 * Gerar petição com IA
 */
router.post('/gerar',
    authMiddleware,
    roleMiddleware('admin', 'operador'),
    planMiddleware.checkFeature('ia_juridica'),
    PeticoesController.uploadMiddleware,   // processa multipart/form-data + PDFs
    PeticoesController.gerarPeticaoComIA
);

/**
 * GET /api/peticoes
 * Listar todas as petições do escritório
 */
router.get('/',
    authMiddleware,
    PeticoesController.listarPeticoes
);

/**
 * POST /api/peticoes/:id/pdf
 * Gerar PDF da petição
 */
router.post('/:id/pdf',
    authMiddleware,
    roleMiddleware('admin', 'operador'),
    PeticoesController.gerarPDF
);

/**
 * PUT /api/peticoes/:id/conteudo
 * Editar conteúdo da petição
 */
router.put('/:id/conteudo',
    authMiddleware,
    roleMiddleware('admin', 'operador'),
    PeticoesController.editarConteudo
);

/**
 * DELETE /api/peticoes/:id
 * Deletar petição
 */
router.delete('/:id',
    authMiddleware,
    roleMiddleware('admin'),
    PeticoesController.deletarPeticao
);

logger.info('[PETICOES] Rotas de petições carregadas');

module.exports = router;