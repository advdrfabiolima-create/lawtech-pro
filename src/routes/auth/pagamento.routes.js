const express = require('express');
const router = express.Router();
const axios = require('axios');
const pool = require('../../config/db');
const logger = require('../../utils/logger');
const cache = require('../../utils/cache');

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

        const customerId = await obterOuCriarClienteTrial(u.nome, u.email, u.documento);

        const pagRes = await axios.post(`${ASAAS_BASE_URL_AUTH}/payments`, {
            customer: customerId,
            billingType: 'PIX',
            value: valor,
            dueDate: obterDataVencimentoTrial(1),
            description: `${plano.nome} - LawTech Pro`,
            externalReference: String(u.escritorio_id)
        }, { headers: getAsaasHeadersAuth() });

        const cobranca = pagRes.data;

        const qrRes = await axios.get(
            `${ASAAS_BASE_URL_AUTH}/payments/${cobranca.id}/pixQrCode`,
            { headers: getAsaasHeadersAuth() }
        );

        logger.info(`💰 [PIX TRIAL] Cobrança ${cobranca.id} criada para escritório ${u.escritorio_id}`);

        res.json({
            ok: true,
            cobrancaId: cobranca.id,
            pixPayload: qrRes.data.payload,
            pixQrCodeBase64: qrRes.data.encodedImage,
            valor,
            planNome: plano.nome
        });

    } catch (err) {
        const msg = err.response?.data?.errors?.[0]?.description || err.message;
        logger.error(`❌ [PIX TRIAL] ${msg}`);
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
            await pool.query(
                `UPDATE escritorios
                 SET plano_financeiro_status = 'pago',
                     trial_expira_em = NULL,
                     ultimo_pagamento = NOW(),
                     proxima_cobranca = NOW() + INTERVAL '1 month'
                 WHERE id = $1`,
                [pg.externalReference]
            );
            try {
                await pool.query(
                    `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                     VALUES ($1, $2, 'asaas', $3, 'aprovada', 'Ativação pós-trial — PIX', NOW())`,
                    [pg.externalReference, cobrancaId, pg.value]
                );
            } catch (_) { /* tabela pode não existir — não crítico */ }
            await invalidarCacheEscritorio(pg.externalReference);
            logger.info(`✅ [PIX TRIAL] Escritório ${pg.externalReference} ativado.`);
        }

        res.json({ status: pg.status, pago });

    } catch (err) {
        logger.error(`❌ [VERIFICAR PIX] ${err.message}`);
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

        const customerId = await obterOuCriarClienteTrial(u.nome, u.email, u.documento);

        const pagRes = await axios.post(`${ASAAS_BASE_URL_AUTH}/payments`, {
            customer: customerId,
            billingType: 'PIX',
            value: valor,
            dueDate: obterDataVencimentoTrial(1),
            description: `${plano.nome} - LawTech Pro (Ativação)`,
            externalReference: String(u.escritorio_id)
        }, { headers: getAsaasHeadersAuth() });

        const cobranca = pagRes.data;

        const qrRes = await axios.get(
            `${ASAAS_BASE_URL_AUTH}/payments/${cobranca.id}/pixQrCode`,
            { headers: getAsaasHeadersAuth() }
        );

        logger.info(`💰 [PIX REGISTRO] Cobrança ${cobranca.id} criada para escritório ${u.escritorio_id}`);

        res.json({
            ok: true,
            cobrancaId: cobranca.id,
            pixPayload: qrRes.data.payload,
            pixQrCodeBase64: qrRes.data.encodedImage,
            valor,
            planNome: plano.nome
        });

    } catch (err) {
        const msg = err.response?.data?.errors?.[0]?.description || err.message;
        logger.error(`❌ [PIX REGISTRO] ${msg}`);
        res.status(500).json({ ok: false, erro: 'Erro ao gerar PIX: ' + msg });
    }
});

/* ======================================================
   POST /api/auth/pagar-trial-cartao  (PÚBLICO — sem JWT)
===================================================== */

router.post('/pagar-trial-cartao', async (req, res) => {
    try {
        const { email, holderName, number, expiryMonth, expiryYear, ccv, cpfCnpj, phone, postalCode, addressNumber } = req.body;

        if (!email || !holderName || !number || !expiryMonth || !expiryYear || !ccv || !cpfCnpj || !postalCode || !addressNumber) {
            return res.status(400).json({ ok: false, erro: 'Todos os dados do cartão são obrigatórios (incluindo CEP e número do endereço)' });
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

        if (u.plano_financeiro_status !== 'trial') {
            return res.status(400).json({ ok: false, erro: 'Conta não está em período de trial' });
        }
        if (!u.trial_expira_em || new Date(u.trial_expira_em) > new Date()) {
            return res.status(400).json({ ok: false, erro: 'Trial ainda está ativo' });
        }

        const planoR = await pool.query('SELECT nome, preco_mensal FROM planos WHERE id = $1', [u.plano_id]);
        if (planoR.rows.length === 0) return res.status(400).json({ ok: false, erro: 'Plano não encontrado' });
        const plano = planoR.rows[0];
        const valor = parseFloat(plano.preco_mensal);

        const customerId = await obterOuCriarClienteTrial(holderName, email, cpfCnpj);

        const hoje = new Date();
        const dueDate = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

        const pagRes = await axios.post(`${ASAAS_BASE_URL_AUTH}/payments`, {
            customer: customerId,
            billingType: 'CREDIT_CARD',
            value: valor,
            dueDate,
            description: `${plano.nome} - LawTech Pro`,
            externalReference: String(u.escritorio_id),
            creditCard: {
                holderName,
                number: number.replace(/\s/g, ''),
                expiryMonth: String(expiryMonth),
                expiryYear: String(expiryYear),
                ccv
            },
            creditCardHolderInfo: {
                name: holderName,
                email,
                cpfCnpj: cpfCnpj.replace(/\D/g, ''),
                postalCode: postalCode.replace(/\D/g, ''),
                addressNumber: addressNumber,
                phone: phone || ''
            }
        }, { headers: getAsaasHeadersAuth() });

        const pg = pagRes.data;

        if (['CONFIRMED', 'RECEIVED'].includes(pg.status)) {
            await pool.query(
                `UPDATE escritorios
                 SET plano_financeiro_status = 'pago',
                     trial_expira_em = NULL,
                     ultimo_pagamento = NOW(),
                     proxima_cobranca = NOW() + INTERVAL '1 month'
                 WHERE id = $1`,
                [u.escritorio_id]
            );
            try {
                await pool.query(
                    `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                     VALUES ($1, $2, 'asaas', $3, 'aprovada', 'Ativação pós-trial — Cartão', NOW())`,
                    [u.escritorio_id, pg.id, valor]
                );
            } catch (_) { /* não crítico */ }
            await invalidarCacheEscritorio(u.escritorio_id);
            logger.info(`✅ [CARTÃO TRIAL] Escritório ${u.escritorio_id} ativado.`);
            return res.json({ ok: true });
        }

        const motivo = pg.creditCardTransactionFailureReason || pg.status || 'Recusado';
        logger.info(`❌ [CARTÃO TRIAL] Recusado: ${motivo}`);
        return res.status(402).json({ ok: false, erro: `Cartão recusado: ${motivo}` });

    } catch (err) {
        const erroAsaas = err.response?.data || {};
        const msg = erroAsaas.errors?.[0]?.description || err.message;
        logger.error(`❌ [CARTÃO TRIAL] ${msg}`);
        const isCardError = err.response?.status === 400 ||
            msg.toLowerCase().includes('declined') ||
            msg.toLowerCase().includes('recusad') ||
            msg.toLowerCase().includes('invalid card') ||
            msg.toLowerCase().includes('não autorizada') ||
            msg.toLowerCase().includes('nao autorizada') ||
            msg.toLowerCase().includes('expirado') ||
            msg.toLowerCase().includes('inválido') ||
            msg.toLowerCase().includes('invalido') ||
            msg.toLowerCase().includes('cartão') ||
            msg.toLowerCase().includes('cvv') ||
            msg.toLowerCase().includes('cep') ||
            msg.toLowerCase().includes('cpf');
        if (isCardError) {
            return res.status(402).json({ ok: false, erro: msg });
        }
        res.status(500).json({ ok: false, erro: 'Erro ao processar pagamento: ' + msg });
    }
});

module.exports = router;
