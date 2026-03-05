const pool = require('../config/db');
const axios = require('axios');
const { validarDocumento } = require('../utils/validators');
const { encrypt, decrypt } = require('../utils/crypto');
const logger = require('../utils/logger');
const { getPagination, buildPage } = require('../utils/paginate');

const ASAAS_ENV = process.env.ASAAS_ENV || 'production';
const ASAAS_BASE_URL = ASAAS_ENV === 'sandbox'
    ? 'https://sandbox.asaas.com/api/v3'
    : 'https://api.asaas.com/v3';

const getAsaasHeaders = (customToken = null) => ({
    'access_token': customToken || process.env.ASAAS_API_KEY,
    'Content-Type': 'application/json'
});

function formatarDataVencimento(dataInput) {
    if (!dataInput) {
        const data = new Date(Date.now() + 3 * 86400000);
        return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
    }
    if (dataInput instanceof Date) {
        return `${dataInput.getFullYear()}-${String(dataInput.getMonth() + 1).padStart(2, '0')}-${String(dataInput.getDate()).padStart(2, '0')}`;
    }
    const s = String(dataInput);
    if (s.includes('/')) {
        const [dia, mes, ano] = s.split('/');
        return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
    }
    if (s.match(/^\d{4}-\d{2}-\d{2}$/)) return s;
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    const fb = new Date(Date.now() + 3 * 86400000);
    return `${fb.getFullYear()}-${String(fb.getMonth() + 1).padStart(2, '0')}-${String(fb.getDate()).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ALTERAÇÃO: LEFT JOIN com clientes para retornar cliente_nome em cada lançamento
// ─────────────────────────────────────────────────────────────────────────────
async function listarLancamentos(req, res) {
    try {
        const { page, limit, offset } = getPagination(req.query);
        const escritorioId = req.user.escritorio_id;

        // Filtro de mês/ano — padrão: mês atual
        const hoje = new Date();
        const mes = parseInt(req.query.mes) || (hoje.getMonth() + 1);
        const ano = parseInt(req.query.ano) || hoje.getFullYear();
        const dataInicio = `${ano}-${String(mes).padStart(2,'0')}-01`;
        const dataFim    = new Date(ano, mes, 0).toISOString().split('T')[0]; // último dia do mês

        const [result, countResult] = await Promise.all([
            pool.query(`
                SELECT f.*, c.nome AS cliente_nome
                FROM financeiro f
                JOIN usuarios u ON u.id = f.usuario_id
                LEFT JOIN clientes c ON c.id = f.cliente_id
                WHERE u.escritorio_id = $1
                  AND f.data_vencimento BETWEEN $4 AND $5
                ORDER BY f.data_vencimento DESC
                LIMIT $2 OFFSET $3
            `, [escritorioId, limit, offset, dataInicio, dataFim]),
            pool.query(`
                SELECT COUNT(*) AS total FROM financeiro f
                JOIN usuarios u ON u.id = f.usuario_id
                WHERE u.escritorio_id = $1
                  AND f.data_vencimento BETWEEN $2 AND $3
            `, [escritorioId, dataInicio, dataFim])
        ]);

        const total = parseInt(countResult.rows[0].total);
        res.json(buildPage(result.rows, total, page, limit));
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao buscar dados financeiros');
        res.status(500).send('Erro ao buscar dados financeiros.');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ALTERAÇÃO: Aceita cliente_id opcional no corpo da requisição
// ─────────────────────────────────────────────────────────────────────────────
async function criarLancamento(req, res) {
    const { descricao, valor, tipo, data_vencimento, cliente_id, beneficiario } = req.body;
    try {
        if (!descricao || !valor || !tipo || !data_vencimento) {
            return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios' });
        }
        const clienteIdFinal = cliente_id ? parseInt(cliente_id) : null;
        // beneficiario só é relevante para Despesa; cliente_id só para Receita
        const beneficiarioFinal = tipo === 'Despesa' ? (beneficiario || null) : null;
        const clienteFinal     = tipo === 'Receita'  ? clienteIdFinal : null;

        const result = await pool.query(`
            INSERT INTO financeiro
                (descricao, valor, tipo, data_vencimento, usuario_id, status, cliente_id, beneficiario)
            VALUES ($1, $2, $3, $4, $5, 'Pendente', $6, $7)
            RETURNING *
        `, [descricao, valor, tipo, data_vencimento, req.user.id, clienteFinal, beneficiarioFinal]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao salvar lancamento');
        res.status(500).json({ erro: 'Erro ao salvar lançamento' });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ALTERAÇÃO: Aceita cliente_id opcional na atualização
// ─────────────────────────────────────────────────────────────────────────────
async function atualizarLancamento(req, res) {
    const { id } = req.params;
    const { descricao, valor, tipo, data_vencimento, cliente_id, forma_pagamento, beneficiario } = req.body;
    try {
        const clienteIdFinal    = cliente_id   ? parseInt(cliente_id) : null;
        const beneficiarioFinal = tipo === 'Despesa' ? (beneficiario || null) : null;
        const clienteFinal      = tipo === 'Receita'  ? clienteIdFinal : null;

        const result = await pool.query(`
            UPDATE financeiro
            SET descricao      = $1,
                valor          = $2,
                tipo           = $3,
                data_vencimento = $4,
                cliente_id     = $5,
                forma_pagamento = $6,
                beneficiario   = $7
            WHERE id = $8 AND usuario_id = $9
            RETURNING *
        `, [descricao, valor, tipo, data_vencimento, clienteFinal,
            forma_pagamento || null, beneficiarioFinal, id, req.user.id]);

        res.json(result.rows[0]);
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao atualizar lancamento');
        res.status(500).json({ erro: 'Erro ao atualizar' });
    }
}

async function marcarPago(req, res) {
    try {
        const { id } = req.params;
        const { forma_pagamento } = req.body || {};
        const result = await pool.query(`
            UPDATE financeiro
            SET status = 'Pago',
                forma_pagamento = COALESCE($1::varchar, forma_pagamento)
            WHERE id = $2 AND usuario_id = $3
            RETURNING *
        `, [forma_pagamento || null, id, req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ erro: 'Lançamento não encontrado' });
        res.json(result.rows[0]);
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao marcar como pago');
        res.status(500).json({ erro: 'Erro interno ao processar pagamento' });
    }
}

async function excluirLancamento(req, res) {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM financeiro WHERE id = $1 AND usuario_id = $2', [id, req.user.id]);
        res.json({ mensagem: 'Excluído com sucesso' });
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao excluir lancamento');
        res.status(500).json({ erro: 'Erro ao excluir' });
    }
}

async function calcularSaldo(req, res) {
    try {
        const mes = req.query.mes ? parseInt(req.query.mes) : null;
        const ano = req.query.ano ? parseInt(req.query.ano) : null;

        // Filtro de mês/ano quando informado
        const filtroData = (mes && ano)
            ? `AND EXTRACT(MONTH FROM data_vencimento) = ${mes} AND EXTRACT(YEAR FROM data_vencimento) = ${ano}`
            : '';

        const result = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN tipo = 'Receita' AND status = 'Pago' THEN valor ELSE 0 END), 0) as receitas_reais,
                COALESCE(SUM(CASE WHEN tipo = 'Despesa' AND status = 'Pago' THEN valor ELSE 0 END), 0) as despesas_pagas,
                COALESCE(SUM(CASE WHEN tipo = 'Receita' AND status != 'Pago' THEN valor ELSE 0 END), 0) as a_receber,
                COALESCE(SUM(CASE WHEN tipo = 'Despesa' AND status != 'Pago' THEN valor ELSE 0 END), 0) as a_pagar
            FROM financeiro
            WHERE usuario_id = $1 ${filtroData}
        `, [req.user.id]);

        const row = result.rows[0];
        res.json({
            receitasReais: row.receitas_reais,
            despesasPagas: row.despesas_pagas,
            aReceber: row.a_receber,
            aPagar: row.a_pagar,
            saldoLiquido: row.receitas_reais - row.despesas_pagas
        });
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao calcular saldo');
        res.status(500).json({ erro: 'Erro ao calcular saldo' });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ALTERAÇÃO: Inclui cliente_nome no relatório
// ─────────────────────────────────────────────────────────────────────────────
async function gerarRelatorio(req, res) {
    try {
        const { dataInicio, dataFim } = req.query;
        if (!dataInicio || !dataFim) {
            return res.status(400).json({ erro: 'Datas de início e fim são obrigatórias' });
        }
        const result = await pool.query(`
            SELECT f.*, c.nome AS cliente_nome
            FROM financeiro f
            JOIN usuarios u ON u.id = f.usuario_id
            LEFT JOIN clientes c ON c.id = f.cliente_id
            WHERE u.escritorio_id = $1
              AND f.data_vencimento BETWEEN $2 AND $3
            ORDER BY f.data_vencimento ASC, f.tipo DESC
        `, [req.user.escritorio_id, dataInicio, dataFim]);
        res.json(result.rows);
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao buscar dados do relatorio');
        res.status(500).json({ erro: 'Erro ao buscar dados do relatório' });
    }
}

async function ativarSubconta(req, res) {
    try {
        const escritorioId = req.user.escritorio_id;
        const esc = await pool.query(
            `SELECT nome, documento, email, TO_CHAR(data_nascimento, 'YYYY-MM-DD') as data_nascimento,
             endereco, cidade, estado, cep, banco_codigo, agencia, conta, conta_digito, renda_mensal
             FROM escritorios WHERE id = $1`,
            [escritorioId]
        );
        const e = esc.rows[0];

        if (!e.banco_codigo || !e.agencia || !e.conta || !e.documento) {
            return res.status(400).json({
                erro: '⚠️ Dados incompletos! Preencha: CPF/CNPJ, Banco, Agência e Conta em "Configurações"'
            });
        }

        const documentoLimpo = String(e.documento).replace(/\D/g, '');
        const docCheck = validarDocumento(documentoLimpo);
        if (!docCheck.valido) {
            return res.status(400).json({
                erro: `${docCheck.tipo || 'CPF/CNPJ'} inválido. Verifique os dígitos informados.`
            });
        }

        logger.info({ nome: e.nome }, 'Criando subconta Asaas');

        const payloadAsaas = {
            name: String(e.nome),
            email: String(e.email).trim().toLowerCase(),
            cpfCnpj: documentoLimpo,
            birthDate: String(e.data_nascimento),
            companyType: documentoLimpo.length > 11 ? 'LIMITED' : 'INDIVIDUAL',
            incomeValue: parseFloat(e.renda_mensal) || 1000,
            address: String(e.endereco || 'Não informado'),
            addressNumber: 'S/N',
            province: String(e.cidade || 'Não informado'),
            postalCode: String(e.cep || '00000000').replace(/\D/g, ''),
            mobilePhone: '71987654321',
            bankAccount: {
                bank: String(e.banco_codigo),
                agency: String(e.agencia),
                account: String(e.conta),
                accountDigit: String(e.conta_digito || '0'),
                bankAccountType: 'CONTA_CORRENTE',
                ownerName: String(e.nome),
                cpfCnpj: documentoLimpo
            }
        };

        const response = await axios.post(`${ASAAS_BASE_URL}/accounts`, payloadAsaas, { headers: getAsaasHeaders() });

        await pool.query(
            `UPDATE escritorios SET asaas_id = $1, asaas_api_key = $2, plano_financeiro_status = 'ativo' WHERE id = $3`,
            [response.data.id, encrypt(response.data.apiKey), escritorioId]
        );

        logger.info({ asaasId: response.data.id }, 'Subconta Asaas criada com sucesso');
        res.json({ ok: true, mensagem: 'Faturamento próprio ativado com sucesso!', asaasId: response.data.id });

    } catch (err) {
        const erroMsg = err.response?.data?.errors?.[0]?.description || err.message;
        logger.error({ erroMsg }, 'Erro ao criar subconta Asaas');

        if (erroMsg.includes('invalid cpfCnpj')) {
            return res.status(400).json({ erro: 'CPF/CNPJ inválido' });
        }

        if (erroMsg.includes('already exists') || erroMsg.includes('já está em uso') || erroMsg.includes('email')) {
            logger.warn('Email ou CPF ja em uso. Tentando recuperar subconta existente...');
            try {
                const escritorioId = req.user.escritorio_id;
                const escData = await pool.query(
                    `SELECT documento, email FROM escritorios WHERE id = $1`, [escritorioId]
                );
                const e = escData.rows[0];
                const documentoLimpo = String(e.documento).replace(/\D/g, '');

                const subcontasResponse = await axios.get(`${ASAAS_BASE_URL}/accounts`, {
                    headers: getAsaasHeaders(),
                    params: { limit: 100 }
                });

                if (!subcontasResponse.data?.data) throw new Error('Não foi possível listar subcontas');

                const subcontaExistente = subcontasResponse.data.data.find(s =>
                    s.email?.toLowerCase() === e.email?.toLowerCase() || s.cpfCnpj === documentoLimpo
                );

                if (subcontaExistente?.apiKey) {
                    await pool.query(
                        `UPDATE escritorios SET asaas_id = $1, asaas_api_key = $2, plano_financeiro_status = 'ativo' WHERE id = $3`,
                        [subcontaExistente.id, encrypt(subcontaExistente.apiKey), escritorioId]
                    );
                    return res.json({
                        ok: true,
                        mensagem: '✅ Subconta recuperada com sucesso! Faturamento ativado.',
                        asaasId: subcontaExistente.id,
                        recuperado: true
                    });
                }

                return res.status(400).json({
                    erro: '⚠️ Este email/CPF já está cadastrado no Asaas. Entre em contato com o suporte para recuperar sua conta ou use um email diferente.'
                });

            } catch (recuperarErr) {
                logger.error({ err: recuperarErr.message }, 'Erro ao tentar recuperar subconta');
                return res.status(400).json({
                    erro: '⚠️ Este email/CPF já está em uso no Asaas. Entre em contato com o suporte ou tente com email diferente.'
                });
            }
        }

        res.status(500).json({ erro: erroMsg });
    }
}

async function gerarBoletoHonorarios(req, res) {
    try {
        const { clienteId, valor, descricao, vencimento } = req.body;

        if (!clienteId || !valor) {
            return res.status(400).json({ erro: 'Cliente e valor são obrigatórios' });
        }
        if (parseFloat(valor) <= 0) {
            return res.status(400).json({ erro: 'Valor deve ser maior que zero' });
        }

        const escRes = await pool.query(
            'SELECT asaas_api_key FROM escritorios WHERE id = $1',
            [req.user.escritorio_id]
        );
        const apiKeyRaw = escRes.rows[0]?.asaas_api_key;
        const tokenCliente = apiKeyRaw ? decrypt(apiKeyRaw).trim() : null;
        if (!tokenCliente) {
            return res.status(400).json({ erro: '⚠️ Ative o faturamento próprio em Configurações antes de gerar boletos' });
        }

        const clienteRes = await pool.query(
            'SELECT nome, documento, email FROM clientes WHERE id = $1 AND escritorio_id = $2',
            [clienteId, req.user.escritorio_id]
        );
        const cliente = clienteRes.rows[0];
        if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });

        const documentoLimpo = cliente.documento ? cliente.documento.replace(/\D/g, '') : '';
        const docCliente = validarDocumento(documentoLimpo);
        if (!docCliente.valido) {
            return res.status(400).json({ erro: 'Cliente sem CPF/CNPJ válido. Atualize o cadastro do cliente primeiro.' });
        }

        let asaasClienteId;
        try {
            const buscaAsaas = await axios.get(`${ASAAS_BASE_URL}/customers`, {
                headers: getAsaasHeaders(tokenCliente),
                params: { cpfCnpj: documentoLimpo }
            });
            if (buscaAsaas.data.data?.length > 0) {
                asaasClienteId = buscaAsaas.data.data[0].id;
            } else {
                const novoClienteAsaas = await axios.post(`${ASAAS_BASE_URL}/customers`, {
                    name: cliente.nome || 'Cliente',
                    cpfCnpj: documentoLimpo,
                    email: cliente.email || `cliente${Date.now()}@lawtech.temp`,
                    notificationDisabled: false
                }, { headers: getAsaasHeaders(tokenCliente) });
                asaasClienteId = novoClienteAsaas.data.id;
            }
        } catch (e) {
            const erroAsaas = e.response?.data?.errors?.[0]?.description || e.message;
            throw new Error(`Falha ao sincronizar cliente: ${erroAsaas}`);
        }

        const dataVencimento = formatarDataVencimento(vencimento || new Date(Date.now() + 3 * 86400000));

        const cobranca = await axios.post(`${ASAAS_BASE_URL}/payments`, {
            customer: asaasClienteId,
            billingType: 'BOLETO',
            value: parseFloat(valor),
            dueDate: dataVencimento,
            description: descricao || 'Honorários Advocatícios',
            externalReference: `HON-${req.user.escritorio_id}-${Date.now()}`,
            postalService: false,
            fine: { value: 2.00 },
            interest: { value: 1.00 }
        }, { headers: getAsaasHeaders(tokenCliente) });

        try {
            await pool.query(
                `INSERT INTO financeiro (descricao, valor, tipo, data_vencimento, usuario_id, status, asaas_payment_id, cliente_id)
                 VALUES ($1, $2, 'Receita', $3, $4, 'Pendente', $5, $6)`,
                [descricao || 'Honorários Advocatícios', parseFloat(valor), dataVencimento, req.user.id, cobranca.data.id, parseInt(clienteId)]
            );
        } catch (dbErr) {
            logger.warn({ err: dbErr.message }, 'Erro ao criar lancamento no banco');
        }

        res.json({
            ok: true,
            url: cobranca.data.invoiceUrl,
            boletoUrl: cobranca.data.bankSlipUrl,
            invoiceId: cobranca.data.id,
            vencimento: cobranca.data.dueDate,
            valor: cobranca.data.value,
            mensagem: 'Boleto gerado com sucesso!'
        });

    } catch (err) {
        const msg = err.response?.data?.errors?.[0]?.description || err.message;
        logger.error({ err: msg }, 'Erro ao gerar boleto');
        res.status(500).json({ erro: 'Erro ao gerar boleto: ' + msg });
    }
}

async function handleWebhookFinanceiro(req, res) {
    const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
    if (webhookToken) {
        const tokenRecebido = req.headers['asaas-access-token'] || req.query.token;
        if (tokenRecebido !== webhookToken) {
            logger.error('Webhook financeiro: token de acesso invalido');
            return res.status(401).json({ ok: false, erro: 'Token inválido' });
        }
    }

    try {
        const { event, payment } = req.body;
        logger.info({ event }, 'Webhook financeiro: evento recebido');

        if (payment?.id) {
            const jaProcessado = await pool.query(
                'SELECT id FROM webhook_events WHERE event_id = $1 AND source = $2',
                [`${event}_${payment.id}`, 'asaas_financeiro']
            );
            if (jaProcessado.rows.length > 0) {
                logger.info({ eventId: `${event}_${payment.id}` }, 'Webhook financeiro: evento ja processado');
                return res.status(200).json({ received: true });
            }
        }

        res.status(200).json({ received: true });

        const eventosPagamento = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED_IN_CASH'];

        if (eventosPagamento.includes(event) && payment?.id) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const result = await client.query(
                    `UPDATE financeiro SET status = 'Pago', data_pagamento = NOW()
                     WHERE asaas_payment_id = $1 AND status != 'Pago' RETURNING *`,
                    [payment.id]
                );
                await client.query(
                    'INSERT INTO webhook_events (event_id, source, processed_at) VALUES ($1, $2, NOW())',
                    [`${event}_${payment.id}`, 'asaas_financeiro']
                );
                await client.query('COMMIT');
                if (result.rowCount > 0) {
                    logger.info({ descricao: result.rows[0].descricao }, 'Baixa automatica realizada');
                }
            } catch (txErr) {
                await client.query('ROLLBACK');
                logger.error({ err: txErr.message }, 'Erro na transacao do webhook financeiro');
            } finally {
                client.release();
            }
        }
    } catch (err) {
        logger.error({ err: err.message }, 'Erro no processamento do webhook financeiro');
    }
}

async function resetAsaas(req, res) {
    try {
        await pool.query(
            `UPDATE escritorios SET asaas_id = NULL, asaas_api_key = NULL, plano_financeiro_status = NULL WHERE id = $1`,
            [req.user.escritorio_id]
        );
        res.json({ ok: true, mensagem: '✅ Configuração Asaas resetada. Ative novamente em Configurações.' });
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao resetar Asaas');
        res.status(500).json({ erro: 'Erro interno do servidor' });
    }
}

async function testarSubconta(req, res) {
    try {
        const escRes = await pool.query(
            'SELECT asaas_api_key, asaas_id FROM escritorios WHERE id = $1',
            [req.user.escritorio_id]
        );
        const apiKeyRaw = escRes.rows[0]?.asaas_api_key;
        const token = apiKeyRaw ? decrypt(apiKeyRaw) : null;
        if (!token) return res.status(400).json({ erro: 'Subconta não ativada' });

        const teste = await axios.get(`${ASAAS_BASE_URL}/customers?limit=1`, { headers: getAsaasHeaders(token) });
        res.json({
            ok: true,
            mensagem: 'Subconta ativa e funcionando!',
            asaasId: escRes.rows[0].asaas_id,
            clientesTotal: teste.data.totalCount || 0
        });
    } catch (err) {
        const msg = err.response?.data?.errors?.[0]?.description || err.message;
        res.status(500).json({ erro: `Erro na subconta: ${msg}` });
    }
}

module.exports = {
    listarLancamentos,
    criarLancamento,
    atualizarLancamento,
    marcarPago,
    excluirLancamento,
    calcularSaldo,
    gerarRelatorio,
    ativarSubconta,
    gerarBoletoHonorarios,
    handleWebhookFinanceiro,
    resetAsaas,
    testarSubconta
};