const express = require('express');
const router = express.Router();
const axios = require('axios');
const pool = require('../../config/db');
const logger = require('../../utils/logger');
const cache = require('../../utils/cache');
const { encrypt } = require('../../utils/crypto');
const { cobrarViaStripe } = require('../../services/chargeService');

async function invalidarCacheEscritorio(escritorioId) {
    try {
        const users = await pool.query('SELECT id FROM usuarios WHERE escritorio_id = $1', [escritorioId]);
        for (const u of users.rows) await cache.del(`auth:user:${u.id}`);
    } catch (_) {}
}

/* ======================================================
   CONFIGURAÇÃO ASAAS — PAGAMENTO DE TRIAL EXPIRADO
===================================================== */

const ASAAS_ENV_AUTH = process.env.ASAAS_ENV || 'production';
const ASAAS_BASE_URL_AUTH = ASAAS_ENV_AUTH === 'sandbox'
    ? 'https://sandbox.asaas.com/api/v3'
    : 'https://api.asaas.com/v3';

const getAsaasHeadersAuth = () => ({
    'access_token': process.env.ASAAS_API_KEY,
    'Content-Type': 'application/json'
});

function obterDataVencimentoTrial(dias = 1) {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function obterOuCriarClienteTrial(nome, email, cpfCnpj) {
    const docLimpo = cpfCnpj.replace(/\D/g, '');
    const busca = await axios.get(`${ASAAS_BASE_URL_AUTH}/customers`, {
        headers: getAsaasHeadersAuth(),
        params: { cpfCnpj: docLimpo }
    });
    if (busca.data.data && busca.data.data.length > 0) {
        return busca.data.data[0].id;
    }
    const novo = await axios.post(`${ASAAS_BASE_URL_AUTH}/customers`, {
        name: nome || 'Advogado LawTech',
        email,
        cpfCnpj: docLimpo,
        notificationDisabled: false
    }, { headers: getAsaasHeadersAuth() });
    return novo.data.id;
}

/* ======================================================
   POST /api/auth/pagar-trial-pix  (PÚBLICO — sem JWT)
===================================================== */

router.post('/pagar-trial-pix', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ ok: false, erro: 'Email é obrigatório' });

        const userResult = await pool.query(
            `SELECT u.id, u.nome, u.email, u.escritorio_id,
                    e.documento, e.plano_id, e.plano_financeiro_status, e.trial_expira_em
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             WHERE u.email = $1`,
            [email.toLowerCase().trim()]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });
        }

        const u = userResult.rows[0];

        if (u.plano_financeiro_status !== 'trial') {
            return res.status(400).json({ ok: false, erro: 'Conta não está em período de trial' });
        }
        if (!u.trial_expira_em || new Date(u.trial_expira_em) > new Date()) {
            return res.status(400).json({ ok: false, erro: 'Trial ainda está ativo ou sem data de expiração' });
        }

        const planoR = await pool.query('SELECT nome, preco_mensal FROM planos WHERE id = $1', [u.plano_id]);
        if (planoR.rows.length === 0) return res.status(400).json({ ok: false, erro: 'Plano não encontrado' });
        const plano = planoR.rows[0];
        const valor = parseFloat(plano.preco_mensal);

        if (!u.documento) {
            return res.status(400).json({ ok: false, erro: 'CPF/CNPJ não cadastrado. Entre em contato com o suporte.' });
        }

        // [M-5] Idempotência: reutilizar PIX pendente criado hoje para o mesmo escritório
        const pixExistente = await pool.query(
            `SELECT gateway_id FROM transacoes
             WHERE escritorio_id = $1 AND status = 'pix_pendente' AND DATE(created_at) = CURRENT_DATE
             ORDER BY created_at DESC LIMIT 1`,
            [u.escritorio_id]
        );

        let cobrancaId, pixPayload, pixQrCodeBase64;

        if (pixExistente.rows.length > 0) {
            cobrancaId = pixExistente.rows[0].gateway_id;
            const qrRes = await axios.get(
                `${ASAAS_BASE_URL_AUTH}/payments/${cobrancaId}/pixQrCode`,
                { headers: getAsaasHeadersAuth() }
            );
            pixPayload = qrRes.data.payload;
            pixQrCodeBase64 = qrRes.data.encodedImage;
            logger.info(`[REUTILIZADO] [PIX TRIAL] Reutilizando cobrança ${cobrancaId} para escritório ${u.escritorio_id}`);
        } else {
            const customerId = await obterOuCriarClienteTrial(u.nome, u.email, u.documento);

            const pagRes = await axios.post(`${ASAAS_BASE_URL_AUTH}/payments`, {
                customer: customerId,
                billingType: 'PIX',
                value: valor,
                dueDate: obterDataVencimentoTrial(1),
                description: `${plano.nome} - LawTech Pro`,
                externalReference: String(u.escritorio_id)
            }, { headers: getAsaasHeadersAuth() });

            cobrancaId = pagRes.data.id;

            // Registrar imediatamente para idempotência em chamadas subsequentes
            try {
                await pool.query(
                    `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                     VALUES ($1, $2, 'asaas', $3, 'pix_pendente', $4, NOW())`,
                    [u.escritorio_id, cobrancaId, Math.round(valor * 100), `PIX Trial - ${plano.nome}`]
                );
            } catch (_) {}

            const qrRes = await axios.get(
                `${ASAAS_BASE_URL_AUTH}/payments/${cobrancaId}/pixQrCode`,
                { headers: getAsaasHeadersAuth() }
            );
            pixPayload = qrRes.data.payload;
            pixQrCodeBase64 = qrRes.data.encodedImage;
            logger.info(`[COBRANCA] [PIX TRIAL] Cobrança ${cobrancaId} criada para escritório ${u.escritorio_id}`);
        }

        res.json({
            ok: true,
            cobrancaId,
            pixPayload,
            pixQrCodeBase64,
            valor,
            planNome: plano.nome
        });

    } catch (err) {
        const msg = err.response?.data?.errors?.[0]?.description || err.message;
        logger.error(`[ERRO] [PIX TRIAL] ${msg}`);
        res.status(500).json({ ok: false, erro: 'Erro ao gerar PIX: ' + msg });
    }
});

/* ======================================================
   GET /api/auth/verificar-pix/:cobrancaId  (PÚBLICO — sem JWT)
===================================================== */

router.get('/verificar-pix/:cobrancaId', async (req, res) => {
    try {
        const { cobrancaId } = req.params;

        const response = await axios.get(
            `${ASAAS_BASE_URL_AUTH}/payments/${cobrancaId}`,
            { headers: getAsaasHeadersAuth() }
        );

        const pg = response.data;
        const pago = ['CONFIRMED', 'RECEIVED'].includes(pg.status);

        if (pago && pg.externalReference) {
            const escritorioId = parseInt(pg.externalReference, 10);

            await pool.query(
                `UPDATE escritorios
                 SET plano_financeiro_status = 'pago',
                     trial_expira_em = NULL,
                     ultimo_pagamento = NOW(),
                     proxima_cobranca = NOW() + INTERVAL '1 month'
                 WHERE id = $1`,
                [escritorioId]
            );

            // [C-2] Idempotência: só insere transação se ainda não existe para este gateway_id
            const jaExiste = await pool.query(
                'SELECT id FROM transacoes WHERE gateway_id = $1',
                [cobrancaId]
            );
            if (jaExiste.rows.length === 0) {
                try {
                    await pool.query(
                        `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                         VALUES ($1, $2, 'asaas', $3, 'aprovada', 'Ativação pós-trial — PIX', NOW())`,
                        [escritorioId, cobrancaId, Math.round(pg.value * 100)]
                    );
                } catch (insertErr) {
                    logger.warn({ err: insertErr.message, cobrancaId }, '[PIX TRIAL] Falha ao registrar transação');
                }
            }

            await invalidarCacheEscritorio(escritorioId);
            logger.info(`[OK] [PIX TRIAL] Escritório ${escritorioId} ativado.`);
        }

        res.json({ status: pg.status, pago });

    } catch (err) {
        logger.error(`[ERRO] [VERIFICAR PIX] ${err.message}`);
        res.status(500).json({ ok: false, erro: 'Erro ao verificar pagamento' });
    }
});

/* ======================================================
   POST /api/auth/gerar-pix-registro  (PÚBLICO — sem JWT)
===================================================== */

router.post('/gerar-pix-registro', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ ok: false, erro: 'Email é obrigatório' });

        const userResult = await pool.query(
            `SELECT u.id, u.nome, u.email, u.escritorio_id,
                    e.documento, e.plano_id, e.plano_financeiro_status
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             WHERE u.email = $1`,
            [email.toLowerCase().trim()]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });
        }

        const u = userResult.rows[0];

        if (!['trial', 'inadimplente'].includes(u.plano_financeiro_status)) {
            return res.status(400).json({ ok: false, erro: 'Conta já está ativa' });
        }

        if (!u.documento) {
            return res.status(400).json({ ok: false, erro: 'CPF/CNPJ não cadastrado. Verifique seu cadastro.' });
        }

        const planoR = await pool.query('SELECT nome, preco_mensal FROM planos WHERE id = $1', [u.plano_id]);
        if (planoR.rows.length === 0) return res.status(400).json({ ok: false, erro: 'Plano não encontrado' });
        const plano = planoR.rows[0];
        const valor = parseFloat(plano.preco_mensal);

        // [M-5] Idempotência: reutilizar PIX pendente criado hoje para o mesmo escritório
        const pixExistenteReg = await pool.query(
            `SELECT gateway_id FROM transacoes
             WHERE escritorio_id = $1 AND status = 'pix_pendente' AND DATE(created_at) = CURRENT_DATE
             ORDER BY created_at DESC LIMIT 1`,
            [u.escritorio_id]
        );

        let cobrancaIdReg, pixPayloadReg, pixQrCodeBase64Reg;

        if (pixExistenteReg.rows.length > 0) {
            cobrancaIdReg = pixExistenteReg.rows[0].gateway_id;
            const qrRes = await axios.get(
                `${ASAAS_BASE_URL_AUTH}/payments/${cobrancaIdReg}/pixQrCode`,
                { headers: getAsaasHeadersAuth() }
            );
            pixPayloadReg = qrRes.data.payload;
            pixQrCodeBase64Reg = qrRes.data.encodedImage;
            logger.info(`[REUTILIZADO] [PIX REGISTRO] Reutilizando cobrança ${cobrancaIdReg} para escritório ${u.escritorio_id}`);
        } else {
            const customerId = await obterOuCriarClienteTrial(u.nome, u.email, u.documento);

            const pagRes = await axios.post(`${ASAAS_BASE_URL_AUTH}/payments`, {
                customer: customerId,
                billingType: 'PIX',
                value: valor,
                dueDate: obterDataVencimentoTrial(1),
                description: `${plano.nome} - LawTech Pro (Ativação)`,
                externalReference: String(u.escritorio_id)
            }, { headers: getAsaasHeadersAuth() });

            cobrancaIdReg = pagRes.data.id;

            try {
                await pool.query(
                    `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                     VALUES ($1, $2, 'asaas', $3, 'pix_pendente', $4, NOW())`,
                    [u.escritorio_id, cobrancaIdReg, Math.round(valor * 100), `PIX Registro - ${plano.nome}`]
                );
            } catch (_) {}

            const qrRes = await axios.get(
                `${ASAAS_BASE_URL_AUTH}/payments/${cobrancaIdReg}/pixQrCode`,
                { headers: getAsaasHeadersAuth() }
            );
            pixPayloadReg = qrRes.data.payload;
            pixQrCodeBase64Reg = qrRes.data.encodedImage;
            logger.info(`[COBRANCA] [PIX REGISTRO] Cobrança ${cobrancaIdReg} criada para escritório ${u.escritorio_id}`);
        }

        res.json({
            ok: true,
            cobrancaId: cobrancaIdReg,
            pixPayload: pixPayloadReg,
            pixQrCodeBase64: pixQrCodeBase64Reg,
            valor,
            planNome: plano.nome
        });

    } catch (err) {
        const msg = err.response?.data?.errors?.[0]?.description || err.message;
        logger.error(`[ERRO] [PIX REGISTRO] ${msg}`);
        res.status(500).json({ ok: false, erro: 'Erro ao gerar PIX: ' + msg });
    }
});

/* ======================================================
   POST /api/auth/pagar-trial-cartao  (PÚBLICO — sem JWT)
   [C-3] Recebe paymentMethodId do Stripe.js — PAN/CVV
   nunca chegam ao servidor (conformidade PCI SAQ-A).
===================================================== */

router.post('/pagar-trial-cartao', async (req, res) => {
    try {
        const { email, holderName, paymentMethodId } = req.body;

        if (!email || !paymentMethodId) {
            return res.status(400).json({ ok: false, erro: 'Email e paymentMethodId são obrigatórios' });
        }

        const userResult = await pool.query(
            `SELECT u.id, u.nome, u.email, u.escritorio_id,
                    e.plano_id, e.plano_financeiro_status, e.trial_expira_em
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             WHERE u.email = $1`,
            [email.toLowerCase().trim()]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });
        }

        const u = userResult.rows[0];

        // [M-1] Permitir também status 'inadimplente'
        if (!['trial', 'inadimplente'].includes(u.plano_financeiro_status)) {
            return res.status(400).json({ ok: false, erro: 'Conta já está ativa ou suspensa' });
        }
        if (u.plano_financeiro_status === 'trial' && (!u.trial_expira_em || new Date(u.trial_expira_em) > new Date())) {
            return res.status(400).json({ ok: false, erro: 'Trial ainda está ativo' });
        }

        const planoR = await pool.query('SELECT nome, preco_mensal FROM planos WHERE id = $1', [u.plano_id]);
        if (planoR.rows.length === 0) return res.status(400).json({ ok: false, erro: 'Plano não encontrado' });
        const plano = planoR.rows[0];
        const valorReais = parseFloat(plano.preco_mensal);
        const valorCentavos = Math.round(valorReais * 100);

        // [C-3] Cobrar via Stripe usando paymentMethodId tokenizado no browser
        const resultado = await cobrarViaStripe(
            paymentMethodId,
            valorCentavos,
            `${plano.nome} - LawTech Pro`,
            { escritorioId: u.escritorio_id, planoNome: plano.nome, emailResponsavel: u.email }
        );

        if (!resultado.sucesso) {
            logger.info(`[ERRO] [CARTAO TRIAL] Recusado: ${resultado.erro}`);
            return res.status(402).json({ ok: false, erro: resultado.erro || 'Cartão recusado. Tente novamente.' });
        }

        await pool.query(
            `UPDATE escritorios
             SET plano_financeiro_status = 'pago',
                 trial_expira_em = NULL,
                 ultimo_pagamento = NOW(),
                 proxima_cobranca = NOW() + INTERVAL '1 month'
             WHERE id = $1`,
            [u.escritorio_id]
        );

        // Salvar paymentMethodId para cobranças recorrentes via Stripe
        try {
            const cartaoExistente = await pool.query(
                'SELECT id FROM cartoes WHERE escritorio_id = $1 AND gateway = $2',
                [u.escritorio_id, 'stripe']
            );
            if (cartaoExistente.rows.length > 0) {
                await pool.query(
                    `UPDATE cartoes SET token = $1, updated_at = NOW() WHERE escritorio_id = $2 AND gateway = 'stripe'`,
                    [encrypt(paymentMethodId), u.escritorio_id]
                );
            } else {
                await pool.query(
                    `INSERT INTO cartoes (escritorio_id, token, gateway, created_at, updated_at)
                     VALUES ($1, $2, 'stripe', NOW(), NOW())`,
                    [u.escritorio_id, encrypt(paymentMethodId)]
                );
            }
            logger.info(`[CARTAO] [CARTAO TRIAL] PaymentMethod Stripe salvo para escritório ${u.escritorio_id}`);
        } catch (cardErr) {
            logger.error({ err: cardErr.message, escritorioId: u.escritorio_id }, '[CARTAO TRIAL] Falha ao salvar paymentMethod — cobrança recorrente pode não funcionar');
        }

        try {
            await pool.query(
                `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                 VALUES ($1, $2, 'stripe', $3, 'aprovada', 'Ativação pós-trial — Cartão', NOW())`,
                [u.escritorio_id, resultado.transacaoId, valorCentavos]
            );
        } catch (_) { /* não crítico */ }

        await invalidarCacheEscritorio(u.escritorio_id);
        logger.info(`[OK] [CARTAO TRIAL] Escritório ${u.escritorio_id} ativado via Stripe.`);
        return res.json({ ok: true });

    } catch (err) {
        const msg = err.message;
        logger.error(`[ERRO] [CARTAO TRIAL] ${msg}`);
        const isCardError = err.type === 'StripeCardError' ||
            msg.toLowerCase().includes('declined') ||
            msg.toLowerCase().includes('card');
        if (isCardError) {
            return res.status(402).json({ ok: false, erro: msg });
        }
        res.status(500).json({ ok: false, erro: 'Erro ao processar pagamento: ' + msg });
    }
});

module.exports = router;
