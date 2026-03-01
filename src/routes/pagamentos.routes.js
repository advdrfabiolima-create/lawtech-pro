const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const c = require('../controllers/pagamentosController');

// ── Plano / boleto ────────────────────────────────────────────────────────────
router.post('/assinar-plano',            authMiddleware, roleMiddleware('admin'), c.assinarPlano);

// ── Webhook (sem auth — chamado pelo Asaas) ───────────────────────────────────
router.post('/webhook',                                                           c.handleWebhookPagamentos);

// ── Status de cobrança e teste de conexão ────────────────────────────────────
router.get('/verificar-cobranca/:cobrancaId', authMiddleware,                    c.verificarCobranca);
router.get('/testar-asaas',              authMiddleware,                          c.testarAsaas);

// ── Cartão ────────────────────────────────────────────────────────────────────
router.post('/salvar-cartao',            authMiddleware, roleMiddleware('admin'), c.salvarCartao);
router.get('/cartao',                    authMiddleware,                          c.buscarCartao);
router.delete('/cartao',                 authMiddleware, roleMiddleware('admin'), c.removerCartao);

// ── Cobrança via token salvo ──────────────────────────────────────────────────
router.post('/cobrar-renovacao',         authMiddleware, roleMiddleware('admin'), c.cobrarRenovacao);

module.exports = router;
