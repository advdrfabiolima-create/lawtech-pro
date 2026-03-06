const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const { checkFeature } = require('../middlewares/planMiddleware');
const c = require('../controllers/financeiroController');
const logger = require('../utils/logger');

logger.info({ asaasEnv: process.env.ASAAS_ENV || 'production' }, 'Asaas configurado');
logger.info({ configured: !!process.env.ASAAS_API_KEY }, 'Token Asaas status');

const temFinanceiro = checkFeature('financeiro');

// ── CRUD básico ───────────────────────────────────────────────────────────────
router.get('/financeiro',                  authMiddleware, temFinanceiro,                              c.listarLancamentos);
router.post('/financeiro',                 authMiddleware, temFinanceiro, roleMiddleware('admin', 'operador'), c.criarLancamento);
router.put('/financeiro/:id',              authMiddleware, temFinanceiro, roleMiddleware('admin', 'operador'), c.atualizarLancamento);
router.patch('/financeiro/:id/pagar',      authMiddleware, temFinanceiro, roleMiddleware('admin', 'operador'), c.marcarPago);
router.delete('/financeiro/:id',           authMiddleware, temFinanceiro, roleMiddleware('admin'),     c.excluirLancamento);

// ── Agregações e relatório ────────────────────────────────────────────────────
router.get('/financeiro/saldo-real',       authMiddleware, temFinanceiro,                              c.calcularSaldo);
router.get('/financeiro/relatorio',        authMiddleware, temFinanceiro,                              c.gerarRelatorio);

// ── Asaas (subconta e boleto) ─────────────────────────────────────────────────
router.post('/financeiro/ativar-subconta', authMiddleware, temFinanceiro, roleMiddleware('admin'),     c.ativarSubconta);
router.post('/financeiro/gerar-boleto-honorarios', authMiddleware, temFinanceiro, roleMiddleware('admin', 'operador'), c.gerarBoletoHonorarios);

// ── Webhook (sem auth — chamado pelo Asaas) ───────────────────────────────────
router.post('/webhook/financeiro',                                                      c.handleWebhookFinanceiro);

// ── Utilitários ───────────────────────────────────────────────────────────────
router.get('/adm/reset-asaas-escritorio',  authMiddleware,                              c.resetAsaas);
router.get('/financeiro/testar-subconta',  authMiddleware,                              c.testarSubconta);

module.exports = router;
