/**
 * chargeService.js
 * Funções de cobrança compartilhadas entre cobrancasTrial e cobrancasRecorrentes.
 */

const axios = require('axios');
const pool = require('../config/db');
const { withRetry } = require('../utils/retry');
const logger = require('../utils/logger');
const { breakers } = require('../utils/circuitBreaker');
const { decrypt } = require('../utils/crypto');

const ASAAS_ENV = process.env.ASAAS_ENV || 'production';
const ASAAS_BASE_URL = ASAAS_ENV === 'sandbox'
    ? 'https://sandbox.asaas.com/api/v3'
    : 'https://api.asaas.com/v3';

function getAsaasHeaders() {
    return {
        'access_token': process.env.ASAAS_API_KEY,
        'Content-Type': 'application/json'
    };
}

/**
 * Cobra via Stripe.
 * Aceita token (tok_xxx) ou paymentMethodId (pm_xxx).
 */
async function cobrarViaStripe(cardToken, valor, descricao, metadata = {}) {
    try {
        if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY não configurado');

        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        let paymentMethodId;
        if (cardToken && cardToken.startsWith('tok_')) {
            const pm = await stripe.paymentMethods.create({ type: 'card', card: { token: cardToken } });
            paymentMethodId = pm.id;
        } else {
            paymentMethodId = cardToken;
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: valor,
            currency: 'brl',
            payment_method: paymentMethodId,
            confirm: true,
            description: descricao,
            metadata: {
                escritorio_id: String(metadata.escritorioId || ''),
                plano: metadata.planoNome || '',
                email: metadata.emailResponsavel || ''
            },
            automatic_payment_methods: { enabled: true, allow_redirects: 'never' }
        });

        const sucesso = paymentIntent.status === 'succeeded';
        return {
            sucesso,
            transacaoId: paymentIntent.id,
            erro: sucesso ? null : (paymentIntent.last_payment_error?.message || 'Erro desconhecido')
        };
    } catch (err) {
        return { sucesso: false, transacaoId: null, erro: err.message };
    }
}

/**
 * Cobra via Asaas (creditCardToken).
 * customerId: ID do cliente no Asaas.
 * asaasCardToken: token do cartão salvo. Se null, busca no banco pelo escritorioId.
 */
async function cobrarViaAsaas(customerId, valor, descricao, escritorioId, asaasCardToken = null) {
    try {
        let creditCardToken = asaasCardToken;

        if (!creditCardToken) {
            const cartaoResult = await pool.query(
                'SELECT asaas_card_token FROM cartoes WHERE escritorio_id = $1',
                [escritorioId]
            );
            if (cartaoResult.rows.length === 0) throw new Error('Nenhum cartão cadastrado');
            // [A-2] asaas_card_token é armazenado criptografado — descriptografar antes de usar
            const raw = cartaoResult.rows[0].asaas_card_token;
            creditCardToken = raw ? decrypt(raw) : null;
        }

        if (!creditCardToken) throw new Error('Token do cartão não encontrado');

        const response = await breakers.asaas.call(() => axios.post(
            `${ASAAS_BASE_URL}/payments`,
            {
                customer: customerId,
                billingType: 'CREDIT_CARD',
                value: valor / 100,
                dueDate: new Date().toISOString().split('T')[0],
                description: descricao,
                externalReference: String(escritorioId),
                creditCardToken
            },
            { headers: getAsaasHeaders() }
        ));

        const aprovado = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(response.data.status);
        return {
            sucesso: aprovado,
            transacaoId: response.data.id,
            erro: aprovado ? null : `Status: ${response.data.status}`
        };
    } catch (err) {
        const msgErro = err.response?.data?.errors?.[0]?.description || err.message;
        return { sucesso: false, transacaoId: null, erro: msgErro };
    }
}

/**
 * Orquestra a cobrança de cartão pelo gateway correto, com retry.
 */
async function processarCobrancaCartao({ escritorioId, valor, cartaoToken, asaasCardToken = null, gateway, descricao, emailResponsavel = '', planoNome = '' }) {
    logger.info({ gateway: gateway.toUpperCase() }, 'Processando cobrança');
    try {
        return await withRetry(async () => {
            if (gateway === 'stripe') {
                return await cobrarViaStripe(cartaoToken, valor, descricao, { escritorioId, emailResponsavel, planoNome });
            } else if (gateway === 'asaas') {
                return await cobrarViaAsaas(cartaoToken, valor, descricao, escritorioId, asaasCardToken);
            } else {
                throw new Error('Gateway não suportado: ' + gateway);
            }
        }, { maxRetries: 2, baseDelay: 2000 });
    } catch (err) {
        logger.error({ err: err.message, gateway }, 'Erro na cobrança');
        return { sucesso: false, transacaoId: null, erro: err.message };
    }
}

/**
 * Registra uma transação no banco dentro de uma conexão client existente.
 */
async function registrarTransacao(client, { escritorioId, gateway_id, gateway, valor, status, descricao, mensagem_erro = null }) {
    if (mensagem_erro) {
        await client.query(
            `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, mensagem_erro, descricao, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [escritorioId, gateway_id || null, gateway, valor, status, mensagem_erro, descricao]
        );
    } else {
        await client.query(
            `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [escritorioId, gateway_id, gateway, valor, status, descricao]
        );
    }
}

module.exports = { getAsaasHeaders, cobrarViaStripe, cobrarViaAsaas, processarCobrancaCartao, registrarTransacao, ASAAS_BASE_URL };
