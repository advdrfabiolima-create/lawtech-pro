const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const c = require('../controllers/financeiroController');
const logger = require('../utils/logger');

logger.info({ asaasEnv: process.env.ASAAS_ENV || 'production' }, 'Asaas configurado');
logger.info({ configured: !!process.env.ASAAS_API_KEY }, 'Token Asaas status');

// ── CRUD básico ───────────────────────────────────────────────────────────────
router.get('/financeiro',                  authMiddleware,                              c.listarLancamentos);
router.post('/financeiro',                 authMiddleware, roleMiddleware('admin', 'operador'), c.criarLancamento);
router.put('/financeiro/:id',              authMiddleware, roleMiddleware('admin', 'operador'), c.atualizarLancamento);
router.patch('/financeiro/:id/pagar',      authMiddleware, roleMiddleware('admin', 'operador'), c.marcarPago);
router.delete('/financeiro/:id',           authMiddleware, roleMiddleware('admin'),     c.excluirLancamento);

// ── Agregações e relatório ────────────────────────────────────────────────────
router.get('/financeiro/saldo-real',       authMiddleware,                              c.calcularSaldo);
router.get('/financeiro/relatorio',        authMiddleware,                              c.gerarRelatorio);

// ── Asaas (subconta e boleto) ─────────────────────────────────────────────────
router.post('/financeiro/ativar-subconta', authMiddleware, roleMiddleware('admin'),     c.ativarSubconta);
router.post('/financeiro/gerar-boleto-honorarios', authMiddleware, roleMiddleware('admin', 'operador'), c.gerarBoletoHonorarios);

// ── Webhook (sem auth — chamado pelo Asaas) ───────────────────────────────────
router.post('/webhook/financeiro',                                                      c.handleWebhookFinanceiro);

// ── Utilitários ───────────────────────────────────────────────────────────────
router.get('/adm/reset-asaas-escritorio',  authMiddleware,                              c.resetAsaas);
router.get('/financeiro/testar-subconta',  authMiddleware,                              c.testarSubconta);

module.exports = router;
