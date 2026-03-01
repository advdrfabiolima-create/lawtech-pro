const axios = require('axios');
const pool = require('../config/db');
const { validarDocumento } = require('../utils/validators');
const { encrypt, decrypt } = require('../utils/crypto');
const { registrarAudit, dadosReq } = require('../utils/auditLog');
const { cobrarViaStripe, cobrarViaAsaas } = require('../services/chargeService');
const logger = require('../utils/logger');

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

        const customerId = await obterOuCriarCliente({ nome: req.user.nome, email: req.user.email, cpfCnpj: cpfUsuario });

        const cobrancaRes = await axios.post(`${ASAAS_BASE_URL}/payments`, {
            customer: customerId,
            billingType: 'BOLETO',
            value: parseFloat(valor),
            dueDate: obterDataVencimento(3),
            description: `${nomePlano} - LawTech Pro`,
            externalReference: String(escritorioId),
            postalService: false,
            discount: { value: 0, dueDateLimitDays: 0 },
            fine: { value: 2.00 },
            interest: { value: 1.00 }
        }, { headers: getAsaasHeaders() });

        const cobranca = cobrancaRes.data;
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

    if (payment?.id) {
        try {
            const jaProcessado = await pool.query(
                'SELECT id FROM webhook_events WHERE event_id = $1 AND source = $2',
                [`${event}_${payment.id}`, 'asaas_pagamentos']
            );
            if (jaProcessado.rows.length > 0) {
                logger.info({ eventId: `${event}_${payment.id}` }, 'Webhook pagamentos: evento ja processado');
                return res.status(200).json({ received: true });
            }
        } catch (err) {
            logger.error({ err: err.message }, 'Webhook pagamentos: erro ao verificar idempotencia');
        }
    }

    res.status(200).send('OK');

    const eventosPagamento = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH'];

    if (eventosPagamento.includes(event) && payment?.externalReference) {
        const escritorioId = payment.externalReference;
        const descricao = payment.description || '';

        let novoPlanoId = 1;
        if (descricao.includes('Intermediário')) novoPlanoId = 2;
        if (descricao.includes('Avançado')) novoPlanoId = 3;
        if (descricao.includes('Premium')) novoPlanoId = 4;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `UPDATE escritorios SET plano_id = $1, plano_financeiro_status = 'pago', trial_expira_em = NULL WHERE id = $2`,
                [novoPlanoId, escritorioId]
            );
            await client.query(
                'INSERT INTO webhook_events (event_id, source, processed_at) VALUES ($1, $2, NOW())',
                [`${event}_${payment.id}`, 'asaas_pagamentos']
            );
            await client.query('COMMIT');
            logger.info({ escritorioId, novoPlanoId }, 'Webhook pagamentos: pagamento confirmado');
        } catch (err) {
            await client.query('ROLLBACK');
            logger.error({ err: err.message }, 'Webhook pagamentos: erro ao atualizar plano');
        } finally {
            client.release();
        }
    }

    if (event === 'PAYMENT_OVERDUE' && payment?.externalReference) {
        logger.warn({ escritorioId: payment.externalReference }, 'Webhook pagamentos: pagamento vencido');
    }
}

async function verificarCobranca(req, res) {
    try {
        const { cobrancaId } = req.params;
        const response = await axios.get(`${ASAAS_BASE_URL}/payments/${cobrancaId}`, { headers: getAsaasHeaders() });
        res.json({
            ok: true,
            status: response.data.status,
            valor: response.data.value,
            vencimento: response.data.dueDate,
            boletoUrl: response.data.bankSlipUrl
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
        const { token, last4, brand, exp_month, exp_year, gateway } = req.body;
        const escritorioId = req.user.escritorio_id;

        if (!token) return res.status(400).json({ erro: 'Token do cartão não fornecido' });
        if (!gateway || !['stripe', 'asaas'].includes(gateway)) {
            return res.status(400).json({ erro: 'Gateway inválido. Use "stripe" ou "asaas"' });
        }

        const existente = await pool.query('SELECT id FROM cartoes WHERE escritorio_id = $1', [escritorioId]);
        const tokenEncriptado = encrypt(token);

        if (existente.rows.length > 0) {
            await pool.query(
                `UPDATE cartoes SET token = $1, last4 = $2, brand = $3, exp_month = $4, exp_year = $5, gateway = $6, updated_at = NOW() WHERE escritorio_id = $7`,
                [tokenEncriptado, last4, brand, exp_month, exp_year, gateway, escritorioId]
            );
            registrarAudit({ usuario_id: req.user.id, email: req.user.email, escritorio_id: escritorioId, acao: 'CARTAO_ATUALIZADO', descricao: `Cartão ${brand} **** ${last4} atualizado`, ...dadosReq(req) });
            return res.json({ ok: true, mensagem: 'Cartão atualizado com sucesso!', ultimos_digitos: last4, bandeira: brand });
        } else {
            await pool.query(
                `INSERT INTO cartoes (escritorio_id, token, last4, brand, exp_month, exp_year, gateway, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
                [escritorioId, tokenEncriptado, last4, brand, exp_month, exp_year, gateway]
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
            `SELECT p.preco_mensal FROM escritorios e JOIN planos p ON e.plano_id = p.id WHERE e.id = $1`,
            [escritorioId]
        );
        if (planoCheck.rows.length > 0) {
            const precoReal = parseFloat(planoCheck.rows[0].preco_mensal);
            const valorEnviado = parseFloat(valor);
            if (valorEnviado > 0 && Math.abs(precoReal - valorEnviado / 100) > 0.01 && Math.abs(precoReal - valorEnviado) > 0.01) {
                logger.error({ precoReal, valorEnviado }, 'Seguranca: valor adulterado na renovacao');
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
                `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at) VALUES ($1, $2, $3, $4, 'aprovada', $5, NOW())`,
                [escritorioId, cobranca.id, gateway, valor, descricao]
            );
            await pool.query(
                `UPDATE escritorios SET plano_financeiro_status = 'pago', ultimo_pagamento = NOW(), proxima_cobranca = NOW() + INTERVAL '1 month' WHERE id = $1`,
                [escritorioId]
            );
            return res.json({ ok: true, mensagem: 'Pagamento processado com sucesso!', transacao_id: cobranca.id });
        } else {
            await pool.query(
                `INSERT INTO transacoes (escritorio_id, gateway_id, gateway, valor, status, mensagem_erro, descricao, created_at) VALUES ($1, $2, $3, $4, 'recusada', $5, $6, NOW())`,
                [escritorioId, cobranca.id || null, gateway, valor, cobranca.erro, descricao]
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
