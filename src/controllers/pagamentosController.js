const axios = require('axios');
const pool = require('../config/db');
const { validarDocumento } = require('../utils/validators');
const { encrypt, decrypt } = require('../utils/crypto');
const { registrarAudit, dadosReq } = require('../utils/auditLog');
const { cobrarViaStripe, cobrarViaAsaas } = require('../services/chargeService');
const logger = require('../utils/logger');
const cache = require('../utils/cache');

async function invalidarCacheEscritorio(escritorioId) {
    try {
        const users = await pool.query('SELECT id FROM usuarios WHERE escritorio_id = $1', [escritorioId]);
        for (const u of users.rows) await cache.del(`auth:user:${u.id}`);
    } catch (_) {}
}

/**
 * [A-5] Parse externalReference estruturado.
 * Suporta formato legado "123" e novo "escritorio_123_plano_2".
 * Retorna { escritorioId, planoId } ou null se inválido.
 */
function parseExternalRef(ref) {
    if (!ref) return null;
    const match = String(ref).match(/^escritorio_(\d+)_plano_(\d+)$/);
    if (match) return { escritorioId: parseInt(match[1], 10), planoId: parseInt(match[2], 10) };
    const num = parseInt(ref, 10);
    if (Number.isInteger(num) && num > 0) return { escritorioId: num, planoId: null };
    return null;
}

const ASAAS_ENV = process.env.ASAAS_ENV || 'production';
const ASAAS_BASE_URL = ASAAS_ENV === 'sandbox'
    ? 'https://sandbox.asaas.com/api/v3'
    : 'https://api.asaas.com/v3';

const getAsaasHeaders = () => ({
    'access_token': process.env.ASAAS_API_KEY,
    'Content-Type': 'application/json'
});

async function obterOuCriarCliente(dadosUsuario) {
    const { nome, email, cpfCnpj } = dadosUsuario;
    const documentoLimpo = cpfCnpj.replace(/\D/g, '');

    const docCheck = validarDocumento(documentoLimpo);
    if (!docCheck.valido) {
        throw new Error(`${docCheck.tipo || 'CPF/CNPJ'} inválido. Verifique os dígitos informados.`);
    }

    const buscaCliente = await axios.get(`${ASAAS_BASE_URL}/customers`, {
        headers: getAsaasHeaders(),
        params: { cpfCnpj: documentoLimpo }
    });

    if (buscaCliente.data.data?.length > 0) {
        logger.info({ asaasClienteId: buscaCliente.data.data[0].id }, 'Cliente ja existe no Asaas');
        return buscaCliente.data.data[0].id;
    }

    const novoCliente = await axios.post(`${ASAAS_BASE_URL}/customers`, {
        name: nome || 'Advogado LawTech',
        email,
        cpfCnpj: documentoLimpo,
        notificationDisabled: false
    }, { headers: getAsaasHeaders() });

    logger.info({ asaasClienteId: novoCliente.data.id }, 'Cliente criado no Asaas');
    return novoCliente.data.id;
}

function obterDataVencimento(diasParaVencer = 3) {
    const data = new Date();
    data.setDate(data.getDate() + diasParaVencer);
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

async function assinarPlano(req, res) {
    const { planoId, nomePlano, valor, cpfUsuario } = req.body;
    const escritorioId = req.user.escritorio_id;

    if (!planoId || !escritorioId || !valor) {
        return res.status(400).json({ erro: 'Dados inválidos. Necessário: planoId, valor e escritorioId' });
    }

    try {
        const planoResult = await pool.query('SELECT preco_mensal FROM planos WHERE id = $1', [planoId]);
        if (planoResult.rows.length === 0) return res.status(400).json({ erro: 'Plano não encontrado' });

        const precoReal = parseFloat(planoResult.rows[0].preco_mensal);
        if (Math.abs(precoReal - parseFloat(valor)) > 0.01) {
            logger.error({ precoReal, valorRecebido: valor, escritorioId }, 'Seguranca: valor adulterado detectado');
            return res.status(400).json({ erro: 'Valor não corresponde ao plano selecionado' });
        }
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao validar plano');
        return res.status(500).json({ erro: 'Erro ao validar plano' });
    }

    if (process.env.MODO_DESENVOLVEDOR === 'true') {
        try {
            await pool.query('UPDATE escritorios SET plano_id = $1 WHERE id = $2', [planoId, escritorioId]);
            return res.json({ modoDev: true, mensagem: `Plano ${nomePlano} ativado com sucesso! (Modo Dev)` });
        } catch (err) {
            return res.status(500).json({ erro: 'Erro interno ao processar upgrade.' });
        }
    }

    try {
        const cpfCheck = validarDocumento(cpfUsuario);
        if (!cpfCheck.valido) {
            return res.status(400).json({ erro: `${cpfCheck.tipo || 'CPF/CNPJ'} inválido. Verifique os dígitos informados.` });
        }

        // [M-3] Idempotência: verificar se já existe boleto pendente nos últimos 3 dias
        const boletoExistente = await pool.query(
            `SELECT gateway_id FROM transacoes
             WHERE escritorio_id = $1 AND status = 'boleto_pendente'
               AND created_at >= NOW() - INTERVAL '3 days'
             ORDER BY created_at DESC LIMIT 1`,
            [escritorioId]
        );

        if (boletoExistente.rows.length > 0) {
            const cobrancaExistenteId = boletoExistente.rows[0].gateway_id;
            try {
                const cobrancaAtual = await axios.get(`${ASAAS_BASE_URL}/payments/${cobrancaExistenteId}`, { headers: getAsaasHeaders() });
                const c = cobrancaAtual.data;
                if (['PENDING', 'AWAITING_RISK_ANALYSIS'].includes(c.status)) {
                    logger.info({ escritorioId, cobrancaId: cobrancaExistenteId }, 'Boleto pendente reutilizado');
                    return res.json({
                        ok: true,
                        cobrancaId: c.id,
                        url: c.invoiceUrl,
                        boletoUrl: c.bankSlipUrl,
                        pixQrCode: c.pixQrCodeUrl || null,
                        valor: c.value,
                        vencimento: c.dueDate,
                        status: c.status,
                        mensagem: 'Boleto já gerado anteriormente — reutilizando.'
                    });
                }
            } catch (_) { /* boleto não encontrado no Asaas, criar novo */ }
        }

        const customerId = await obterOuCriarCliente({ nome: req.user.nome, email: req.user.email, cpfCnpj: cpfUsuario });

        const cobrancaRes = await axios.post(`${ASAAS_BASE_URL}/payments`, {
            customer: customerId,
            billingType: 'BOLETO',
            value: parseFloat(valor),
            dueDate: obterDataVencimento(3),
            description: `${nomePlano} - LawTech Pro`,
            externalReference: `escritorio_${escritorioId}_plano_${planoId}`,
            postalService: false,
            discount: { value: 0, dueDateLimitDays: 0 },
            fine: { value: 2.00 },
            interest: { value: 1.00 }
        }, { headers: getAsaasHeaders() });

        const cobranca = cobrancaRes.data;

        // [M-3] Registrar boleto para idempotência em chamadas futuras
        // [C-1] valor em centavos (unidade canônica — igual a Stripe/PIX)
        try {
            await pool.query(
                `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, descricao, plano_id, created_at)
                 VALUES ($1, $2, 'asaas', $3, 'boleto_pendente', $4, $5, NOW())`,
                [escritorioId, cobranca.id, Math.round(parseFloat(valor) * 100), `Boleto - ${nomePlano}`, planoId]
            );
        } catch (_) { /* não crítico */ }

        return res.json({
            ok: true,
            cobrancaId: cobranca.id,
            url: cobranca.invoiceUrl,
            boletoUrl: cobranca.bankSlipUrl,
            pixQrCode: cobranca.pixQrCodeUrl || null,
            valor: cobranca.value,
            vencimento: cobranca.dueDate,
            status: cobranca.status,
            mensagem: 'Boleto gerado com sucesso!'
        });

    } catch (err) {
        const erroAsaas = err.response?.data || {};
        const mensagemErro = erroAsaas.errors?.[0]?.description || err.message;
        if (mensagemErro.includes('Customer not found')) {
            return res.status(400).json({ erro: 'Erro ao criar cliente. Verifique os dados cadastrais.' });
        }
        if (mensagemErro.includes('invalid cpfCnpj')) {
            return res.status(400).json({ erro: 'CPF/CNPJ inválido. Verifique o documento informado.' });
        }
        if (mensagemErro.includes('Insufficient balance')) {
            return res.status(400).json({ erro: 'Saldo insuficiente na conta Asaas. Contate o suporte.' });
        }
        return res.status(500).json({ erro: 'Falha ao gerar boleto', detalhes: mensagemErro });
    }
}

async function handleWebhookPagamentos(req, res) {
    const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
    if (!webhookToken) {
        logger.error('ASAAS_WEBHOOK_TOKEN nao configurado. Rejeitando request.');
        return res.status(500).json({ ok: false, erro: 'Webhook não configurado' });
    }
    const tokenRecebido = req.headers['asaas-access-token'] || req.query.token;
    if (tokenRecebido !== webhookToken) {
        logger.error('Webhook pagamentos: token de acesso invalido');
        return res.status(401).json({ ok: false, erro: 'Token inválido' });
    }

    const { event, payment } = req.body;
    logger.info({ event }, 'Webhook pagamentos: evento recebido');

    // [A-3] Processar ANTES de responder — assim o Asaas reintenta se houver falha
    const eventosPagamento = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH'];

    if (eventosPagamento.includes(event) && payment?.externalReference) {
        // [A-5] Suporta formato legado "123" e novo "escritorio_123_plano_2"
        const parsedRef = parseExternalRef(payment.externalReference);
        if (!parsedRef) {
            logger.error({ externalReference: payment.externalReference }, 'Webhook pagamentos: externalReference invalido');
            return res.status(400).json({ ok: false, erro: 'externalReference inválido' });
        }
        const escritorioId = parsedRef.escritorioId;

        const descricao = payment.description || '';
        let novoPlanoId = parsedRef.planoId || 1;
        if (!parsedRef.planoId) {
            if (descricao.includes('Intermediário')) novoPlanoId = 2;
            if (descricao.includes('Avançado')) novoPlanoId = 3;
            if (descricao.includes('Premium')) novoPlanoId = 4;
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // [A-1] Idempotência atômica via ON CONFLICT — elimina race condition (TOCTOU)
            // Requer constraint UNIQUE (event_id, source) da migration 003 [A-2]
            const idemResult = await client.query(
                `INSERT INTO webhook_events (event_id, source, processed_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (event_id, source) DO NOTHING`,
                [`${event}_${payment.id}`, 'asaas_pagamentos']
            );

            if (idemResult.rowCount === 0) {
                await client.query('ROLLBACK');
                logger.info({ eventId: `${event}_${payment.id}` }, 'Webhook pagamentos: evento ja processado');
                return res.status(200).json({ received: true });
            }

            await client.query(
                `UPDATE escritorios SET plano_id = $1, plano_financeiro_status = 'pago', trial_expira_em = NULL,
                 ultimo_pagamento = NOW(), proxima_cobranca = NOW() + INTERVAL '1 month' WHERE id = $2`,
                [novoPlanoId, escritorioId]
            );
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            logger.error({ err: err.message }, 'Webhook pagamentos: erro ao atualizar plano');
            return res.status(500).json({ ok: false, erro: 'Erro ao processar pagamento' });
        } finally {
            client.release();
        }

        // Efeitos colaterais após commit (fora da transação — invalidarCacheEscritorio nunca lança)
        await invalidarCacheEscritorio(escritorioId);
        logger.info({ escritorioId, novoPlanoId }, 'Webhook pagamentos: pagamento confirmado');

    } else if (event === 'PAYMENT_OVERDUE' && payment?.externalReference) {
        const parsed = parseExternalRef(payment.externalReference);
        logger.warn({ escritorioId: parsed?.escritorioId }, 'Webhook pagamentos: pagamento vencido');
    }

    return res.status(200).json({ received: true });
}

async function verificarCobranca(req, res) {
    try {
        const { cobrancaId } = req.params;
        const response = await axios.get(`${ASAAS_BASE_URL}/payments/${cobrancaId}`, { headers: getAsaasHeaders() });
        const pg = response.data;

        // [M-2] Verificar ownership: externalReference deve pertencer ao escritório do usuário
        if (pg.externalReference) {
            const parsed = parseExternalRef(pg.externalReference);
            if (!parsed || parsed.escritorioId !== req.user.escritorio_id) {
                logger.warn({ cobrancaId, escritorioId: req.user.escritorio_id, externalReference: pg.externalReference }, 'Tentativa de acesso a cobrança de outro escritório');
                return res.status(403).json({ erro: 'Acesso negado' });
            }
        }

        res.json({
            ok: true,
            status: pg.status,
            valor: pg.value,
            vencimento: pg.dueDate,
            boletoUrl: pg.bankSlipUrl
        });
    } catch (err) {
        const msgErro = err.response?.data?.errors?.[0]?.description || err.message;
        res.status(500).json({ erro: msgErro });
    }
}

async function testarAsaas(req, res) {
    try {
        const response = await axios.get(`${ASAAS_BASE_URL}/customers?limit=1`, { headers: getAsaasHeaders() });
        res.json({
            ok: true,
            mensagem: 'Conexão com Asaas OK!',
            ambiente: ASAAS_ENV,
            url: ASAAS_BASE_URL,
            clientesEncontrados: response.data.totalCount || 0
        });
    } catch (err) {
        const msgErro = err.response?.data?.errors?.[0]?.description || err.message;
        res.status(500).json({ ok: false, erro: 'Falha na conexão com Asaas', detalhes: msgErro, ambiente: ASAAS_ENV });
    }
}

async function salvarCartao(req, res) {
    try {
        // [A-1] Para Asaas: token = customerId Asaas, asaas_card_token = creditCardToken Asaas
        const { token, last4, brand, exp_month, exp_year, gateway, asaas_card_token } = req.body;
        const escritorioId = req.user.escritorio_id;

        if (!token) return res.status(400).json({ erro: 'Token do cartão não fornecido' });
        if (!gateway || !['stripe', 'asaas'].includes(gateway)) {
            return res.status(400).json({ erro: 'Gateway inválido. Use "stripe" ou "asaas"' });
        }

        const existente = await pool.query('SELECT id FROM cartoes WHERE escritorio_id = $1', [escritorioId]);
        const tokenEncriptado = encrypt(token);
        const asaasCardTokenEncriptado = asaas_card_token ? encrypt(asaas_card_token) : null;

        if (existente.rows.length > 0) {
            await pool.query(
                `UPDATE cartoes SET token = $1, last4 = $2, brand = $3, exp_month = $4, exp_year = $5,
                 gateway = $6, asaas_card_token = COALESCE($7, asaas_card_token), updated_at = NOW()
                 WHERE escritorio_id = $8`,
                [tokenEncriptado, last4, brand, exp_month, exp_year, gateway, asaasCardTokenEncriptado, escritorioId]
            );
            registrarAudit({ usuario_id: req.user.id, email: req.user.email, escritorio_id: escritorioId, acao: 'CARTAO_ATUALIZADO', descricao: `Cartão ${brand} **** ${last4} atualizado`, ...dadosReq(req) });
            return res.json({ ok: true, mensagem: 'Cartão atualizado com sucesso!', ultimos_digitos: last4, bandeira: brand });
        } else {
            await pool.query(
                `INSERT INTO cartoes (escritorio_id, token, asaas_card_token, last4, brand, exp_month, exp_year, gateway, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
                [escritorioId, tokenEncriptado, asaasCardTokenEncriptado, last4, brand, exp_month, exp_year, gateway]
            );
            registrarAudit({ usuario_id: req.user.id, email: req.user.email, escritorio_id: escritorioId, acao: 'CARTAO_SALVO', descricao: `Cartão ${brand} **** ${last4} cadastrado via ${gateway}`, ...dadosReq(req) });
            return res.json({ ok: true, mensagem: 'Cartão salvo com sucesso!', ultimos_digitos: last4, bandeira: brand });
        }
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao salvar cartao');
        res.status(500).json({ erro: 'Erro ao processar cartão', detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
}

async function buscarCartao(req, res) {
    try {
        const result = await pool.query(
            `SELECT last4, brand, exp_month, exp_year, gateway, created_at FROM cartoes WHERE escritorio_id = $1`,
            [req.user.escritorio_id]
        );
        if (result.rows.length === 0) return res.json({ ok: true, cartao: null });
        res.json({ ok: true, cartao: result.rows[0] });
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao buscar cartao');
        res.status(500).json({ erro: 'Erro ao buscar informações do cartão' });
    }
}

async function removerCartao(req, res) {
    try {
        await pool.query('DELETE FROM cartoes WHERE escritorio_id = $1', [req.user.escritorio_id]);
        res.json({ ok: true, mensagem: 'Cartão removido com sucesso!' });
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao remover cartao');
        res.status(500).json({ erro: 'Erro ao remover cartão' });
    }
}

async function cobrarRenovacao(req, res) {
    try {
        const { valor, descricao } = req.body;
        const escritorioId = req.user.escritorio_id;

        const planoCheck = await pool.query(
            `SELECT e.plano_id, p.preco_mensal FROM escritorios e JOIN planos p ON e.plano_id = p.id WHERE e.id = $1`,
            [escritorioId]
        );
        const planoIdRenovacao = planoCheck.rows[0]?.plano_id || null;
        if (planoCheck.rows.length > 0) {
            const precoReal = parseFloat(planoCheck.rows[0].preco_mensal);
            // [M-4] Valor esperado em centavos (unidade canônica para gateways).
            // Converter para reais antes de comparar com preco_mensal (que está em reais no banco).
            const valorEmReais = parseFloat(valor) / 100;
            if (valorEmReais > 0 && Math.abs(precoReal - valorEmReais) > 0.01) {
                logger.error({ precoReal, valorEmReais }, 'Seguranca: valor adulterado na renovacao');
                return res.status(400).json({ erro: 'Valor não corresponde ao plano' });
            }
        }

        const cartaoResult = await pool.query(
            'SELECT token, gateway FROM cartoes WHERE escritorio_id = $1',
            [escritorioId]
        );
        if (cartaoResult.rows.length === 0) return res.status(400).json({ erro: 'Nenhum cartão cadastrado' });

        const { token: tokenEncrypted, gateway } = cartaoResult.rows[0];
        const token = decrypt(tokenEncrypted);

        let cobranca;
        if (gateway === 'stripe') {
            cobranca = await cobrarViaStripe(token, valor, descricao);
        } else if (gateway === 'asaas') {
            cobranca = await cobrarViaAsaas(token, valor, descricao, escritorioId);
        } else {
            return res.status(400).json({ erro: 'Gateway não suportado' });
        }

        if (cobranca.sucesso) {
            await pool.query(
                `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, descricao, plano_id, created_at) VALUES ($1, $2, $3, $4, 'aprovada', $5, $6, NOW())`,
                [escritorioId, cobranca.id, gateway, valor, descricao, planoIdRenovacao]
            );
            await pool.query(
                `UPDATE escritorios SET plano_financeiro_status = 'pago', ultimo_pagamento = NOW(), proxima_cobranca = NOW() + INTERVAL '1 month' WHERE id = $1`,
                [escritorioId]
            );
            return res.json({ ok: true, mensagem: 'Pagamento processado com sucesso!', transacao_id: cobranca.id });
        } else {
            await pool.query(
                `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, mensagem_erro, descricao, plano_id, created_at) VALUES ($1, $2, $3, $4, 'recusada', $5, $6, $7, NOW())`,
                [escritorioId, cobranca.id || null, gateway, valor, cobranca.erro, descricao, planoIdRenovacao]
            );
            return res.status(402).json({ erro: 'Pagamento recusado', motivo: cobranca.erro });
        }

    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao processar cobranca de renovacao');
        res.status(500).json({ erro: 'Erro ao processar pagamento', detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
}

module.exports = {
    assinarPlano,
    handleWebhookPagamentos,
    verificarCobranca,
    testarAsaas,
    salvarCartao,
    buscarCartao,
    removerCartao,
    cobrarRenovacao
};
