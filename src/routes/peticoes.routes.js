/**
 * ============================================
 * ROTAS: PETIÇÕES
 * Sistema de geração de petições com IA
 * ============================================
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const planMiddleware = require('../middlewares/planMiddleware');
const PeticoesController = require('../controllers/peticoesController');

// ===== ROTAS PROTEGIDAS - REQUEREM AUTENTICAÇÃO =====

/**
 * POST /api/peticoes/gerar
 * Gerar petição com IA
 */
router.post('/gerar',
    authMiddleware,
    planMiddleware.checkFeature('ia_juridica'), // Requer plano Premium
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
    PeticoesController.gerarPDF
);

/**
 * PUT /api/peticoes/:id/conteudo
 * Editar conteúdo da petição
 */
router.put('/:id/conteudo',
    authMiddleware,
    PeticoesController.editarConteudo
);

/**
 * DELETE /api/peticoes/:id
 * Deletar petição
 */
router.delete('/:id',
    authMiddleware,
    PeticoesController.deletarPeticao
);

console.log('[PETICOES] Rotas de petições carregadas');

module.exports = router;