const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const controller = require('../controllers/prazosController');

/**
 * ============================================================
 * 1. ROTAS DE LISTAGEM (O QUE APARECE NA TELA)
 * ============================================================
 */

// Página Principal de Prazos (Resolve o sumiço dos dados na listagem geral)
router.get('/prazos', authMiddleware, controller.listarPrazosGeral);
router.get('/todos-prazos-ativos', authMiddleware, controller.listarPrazosGeral);

// Histórico de Concluídos
router.get('/prazos-concluidos', authMiddleware, controller.listarPrazosConcluidos);

/**
 * ============================================================
 * 2. ROTAS DO DASHBOARD (CARDS COLORIDOS E LISTA REDUZIDA)
 * ============================================================
 */

// Card de Vencidos (Bolinha vermelha do Dashboard)
router.get('/dashboard/prazos-vencidos', authMiddleware, controller.listarPrazosVencidos);

// Card da Semana (Bolinha amarela do Dashboard)
router.get('/dashboard/prazos-semana', authMiddleware, controller.listarPrazosSemana);

// Lista de 10 Próximos (Onde as Tags de dias agora vão funcionar)
router.get('/dashboard/prazos-geral', authMiddleware, controller.listarPrazosDashboard);

/**
 * ============================================================
 * 3. ROTAS DE AÇÃO (CRIAR, CONCLUIR, EDITAR E LIMPAR)
 * ============================================================
 */

// 🚀 PRIORIDADE MÁXIMA: Limpeza de lixeira (Deve vir antes de rotas com :id)
// Resolve o erro 404 ao clicar em "Limpar Concluídos"
router.delete('/prazos/concluidos/limpar', authMiddleware, controller.limparPrazosConcluidos);

// Concluir um prazo específico (Check verde)
router.put('/prazos/:id/concluir', authMiddleware, controller.concluirPrazo);

// Operações Básicas (CRUD)
router.post('/prazos', authMiddleware, controller.criarPrazo);
router.put('/prazos/:id', authMiddleware, controller.atualizarPrazo);
router.delete('/prazos/:id', authMiddleware, controller.excluirPrazo);

module.exports = router;