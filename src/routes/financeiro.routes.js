const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const planMiddleware = require('../middlewares/planMiddleware');
const axios = require('axios');

// ============================================================
// ✅ CONFIGURAÇÃO ASAAS - CORRIGIDA
// ============================================================

const ASAAS_ENV = process.env.ASAAS_ENV || 'production';
const ASAAS_BASE_URL = ASAAS_ENV === 'sandbox' 
  ? 'https://sandbox.asaas.com/api/v3'
  : 'https://api.asaas.com/v3';

const TOKEN_ASAAS = process.env.ASAAS_API_KEY;

// ✅ Função para obter headers corretos
const getAsaasHeaders = (customToken = null) => ({
  'access_token': customToken || TOKEN_ASAAS,
  'Content-Type': 'application/json'
});

// ✅ Função para formatar data de vencimento
function formatarDataVencimento(dataInput) {
  // Se for null ou undefined, usa 3 dias a partir de hoje
  if (!dataInput) {
    const data = new Date(Date.now() + 3 * 86400000);
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }
  
  // Se for objeto Date, processa primeiro
  if (dataInput instanceof Date) {
    const ano = dataInput.getFullYear();
    const mes = String(dataInput.getMonth() + 1).padStart(2, '0');
    const dia = String(dataInput.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }
  
  // Converte para string para trabalhar com outros formatos
  const dataString = String(dataInput);
  
  // Se vier no formato DD/MM/YYYY, converte para YYYY-MM-DD
  if (dataString.includes('/')) {
    const [dia, mes, ano] = dataString.split('/');
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }
  
  // Se já estiver no formato correto, retorna
  if (dataString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return dataString;
  }
  
  // Tenta converter para Date e formatar
  const data = new Date(dataString);
  if (!isNaN(data.getTime())) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }
  
  // Se nenhum formato funcionar, usa 3 dias a partir de hoje
  const dataFallback = new Date(Date.now() + 3 * 86400000);
  const ano = dataFallback.getFullYear();
  const mes = String(dataFallback.getMonth() + 1).padStart(2, '0');
  const dia = String(dataFallback.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

console.log(`✅ Asaas configurado - Ambiente: ${ASAAS_ENV} | URL: ${ASAAS_BASE_URL}`);
console.log(`🔑 Token Asaas: ${TOKEN_ASAAS ? 'CONFIGURADO' : '❌ FALTANDO'}`);

// ============================================================
// ✅ ROTAS BÁSICAS - DISPONÍVEIS EM TODOS OS PLANOS
// ============================================================

router.get('/financeiro', 
    authMiddleware,
    async (req, res) => {
        try {
            const query = `
                SELECT f.* FROM financeiro f
                JOIN usuarios u ON u.id = f.usuario_id
                WHERE u.escritorio_id = $1
                ORDER BY f.data_vencimento DESC
            `;
            const resultado = await pool.query(query, [req.user.escritorio_id]);
            res.json(resultado.rows);
        } catch (err) {
            console.error('Erro ao buscar dados financeiros:', err.message);
            res.status(500).send('Erro ao buscar dados financeiros.');
        }
    }
);

router.post('/financeiro', 
    authMiddleware,
    async (req, res) => {
        const { descricao, valor, tipo, data_vencimento } = req.body;
        try {
            if (!descricao || !valor || !tipo || !data_vencimento) {
                return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios' });
            }

            const query = `
                INSERT INTO financeiro (descricao, valor, tipo, data_vencimento, usuario_id, status) 
                VALUES ($1, $2, $3, $4, $5, 'Pendente') RETURNING *
            `;
            const values = [descricao, valor, tipo, data_vencimento, req.user.id];

            const resultado = await pool.query(query, values);
            res.status(201).json(resultado.rows[0]);
        } catch (err) {
            console.error('ERRO AO SALVAR LANÇAMENTO:', err.message);
            res.status(500).json({ erro: 'Erro ao salvar lançamento: ' + err.message });
        }
    }
);

router.put('/financeiro/:id', 
    authMiddleware,
    async (req, res) => {
        const { id } = req.params;
        const { descricao, valor, tipo, data_vencimento } = req.body;
        try {
            const query = `
                UPDATE financeiro 
                SET descricao = $1, valor = $2, tipo = $3, data_vencimento = $4 
                WHERE id = $5 AND usuario_id = $6 
                RETURNING *
            `;
            const values = [descricao, valor, tipo, data_vencimento, id, req.user.id];
            const resultado = await pool.query(query, values);
            res.json(resultado.rows[0]);
        } catch (err) {
            res.status(500).json({ erro: 'Erro ao atualizar: ' + err.message });
        }
    }
);

router.patch('/financeiro/:id/pagar', 
    authMiddleware,
    async (req, res) => {
        try {
            const { id } = req.params;
            const query = `
                UPDATE financeiro 
                SET status = 'Pago' 
                WHERE id = $1 AND usuario_id = $2 
                RETURNING *
            `;
            const result = await pool.query(query, [id, req.user.id]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ erro: 'Lançamento não encontrado' });
            }
            
            res.json(result.rows[0]);
        } catch (err) {
            console.error('Erro ao pagar:', err.message);
            res.status(500).json({ erro: 'Erro interno ao processar pagamento' });
        }
    }
);

router.delete('/financeiro/:id', 
    authMiddleware,
    async (req, res) => {
        const { id } = req.params;
        try {
            await pool.query('DELETE FROM financeiro WHERE id = $1 AND usuario_id = $2', [id, req.user.id]);
            res.json({ mensagem: 'Excluído com sucesso' });
        } catch (err) {
            res.status(500).json({ erro: 'Erro ao excluir: ' + err.message });
        }
    }
);

router.get('/financeiro/saldo-real', 
    authMiddleware,
    async (req, res) => {
        try {
            const query = `
                SELECT 
                    COALESCE(SUM(CASE WHEN tipo = 'Receita' AND status = 'Pago' THEN valor ELSE 0 END), 0) as receitas_reais,
                    COALESCE(SUM(CASE WHEN tipo = 'Despesa' AND status = 'Pago' THEN valor ELSE 0 END), 0) as despesas_pagas,
                    COALESCE(SUM(CASE WHEN tipo = 'Receita' AND status != 'Pago' THEN valor ELSE 0 END), 0) as a_receber,
                    COALESCE(SUM(CASE WHEN tipo = 'Despesa' AND status != 'Pago' THEN valor ELSE 0 END), 0) as a_pagar
                FROM financeiro
                WHERE usuario_id = $1
            `;
            const result = await pool.query(query, [req.user.id]);
            const row = result.rows[0];
            res.json({
                receitasReais: row.receitas_reais,
                despesasPagas: row.despesas_pagas,
                aReceber: row.a_receber,
                aPagar: row.a_pagar,
                saldoLiquido: row.receitas_reais - row.despesas_pagas
            });
        } catch (err) {
            res.status(500).json({ erro: 'Erro ao calcular saldo: ' + err.message });
        }
    }
);

// ==========================================
// 📊 RELATÓRIO DE FATURAMENTO
// ==========================================

router.get('/financeiro/relatorio', 
    authMiddleware,
    async (req, res) => {
        try {
            const { dataInicio, dataFim } = req.query;
            
            if (!dataInicio || !dataFim) {
                return res.status(400).json({ erro: 'Datas de início e fim são obrigatórias' });
            }
            
            const query = `
                SELECT f.* 
                FROM financeiro f
                JOIN usuarios u ON u.id = f.usuario_id
                WHERE u.escritorio_id = $1
                  AND f.data_vencimento BETWEEN $2 AND $3
                ORDER BY f.data_vencimento ASC, f.tipo DESC
            `;
            
            const result = await pool.query(query, [
                req.user.escritorio_id,
                dataInicio,
                dataFim
            ]);
            
            res.json(result.rows);
            
        } catch (err) {
            console.error('Erro ao buscar dados do relatório:', err.message);
            res.status(500).json({ erro: 'Erro ao buscar dados do relatório' });
        }
    }
);

// ==========================================
// 🔐 ATIVAR SUBCONTA ASAAS (FATURAMENTO PRÓPRIO)
// ==========================================

router.post('/financeiro/ativar-subconta', 
    authMiddleware,
    async (req, res) => {
        try {
            const escritorioId = req.user.escritorio_id;
            
            const esc = await pool.query(
                `SELECT nome, documento, email, TO_CHAR(data_nascimento, 'YYYY-MM-DD') as data_nascimento, 
                 endereco, cidade, estado, cep, banco_codigo, agencia, conta, conta_digito, renda_mensal 
                 FROM escritorios WHERE id = $1`, 
                [escritorioId]
            );
            const e = esc.rows[0];

            // ✅ Validação completa dos dados
            if (!e.banco_codigo || !e.agencia || !e.conta || !e.documento) {
                return res.status(400).json({ 
                    erro: '⚠️ Dados incompletos! Preencha: CPF/CNPJ, Banco, Agência e Conta em "Configurações"' 
                });
            }

            const documentoLimpo = String(e.documento).replace(/\D/g, '');
            
            // ✅ Validação de CPF/CNPJ
            if (documentoLimpo.length !== 11 && documentoLimpo.length !== 14) {
                return res.status(400).json({ 
                    erro: 'CPF deve ter 11 dígitos ou CNPJ 14 dígitos' 
                });
            }

            console.log(`📡 [ASAAS] Criando subconta para: ${e.nome}`);

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

            // ✅ Chamada corrigida ao Asaas
            const response = await axios.post(
                `${ASAAS_BASE_URL}/accounts`, 
                payloadAsaas, 
                { headers: getAsaasHeaders() }
            );

            // ✅ Salva os dados da subconta
            await pool.query(
                `UPDATE escritorios 
                 SET asaas_id = $1, 
                     asaas_api_key = $2, 
                     plano_financeiro_status = 'ativo' 
                 WHERE id = $3`,
                [response.data.id, response.data.apiKey, escritorioId]
            );

            console.log(`✅ [ASAAS] Subconta criada com sucesso! ID: ${response.data.id}`);
            
            res.json({ 
                ok: true, 
                mensagem: 'Faturamento próprio ativado com sucesso!',
                asaasId: response.data.id
            });
            
        } catch (err) {
            const erroMsg = err.response?.data?.errors?.[0]?.description || err.message;
            console.error("❌ ERRO AO CRIAR SUBCONTA:", erroMsg);
            
            // Mensagens de erro específicas
            if (erroMsg.includes('invalid cpfCnpj')) {
                return res.status(400).json({ erro: 'CPF/CNPJ inválido' });
            }
            
            // 🔥 NOVO: Recuperação automática quando email/CPF já está em uso
            if (erroMsg.includes('already exists') || 
                erroMsg.includes('já está em uso') || 
                erroMsg.includes('email')) {
                
                console.log('⚠️ Email ou CPF já em uso. Tentando recuperar subconta existente...');
                
                try {
                    // Lista todas as subcontas da conta principal
                    const subcontasResponse = await axios.get(
                        `${ASAAS_BASE_URL}/accounts`,
                        { 
                            headers: getAsaasHeaders(),
                            params: { limit: 100 }
                        }
                    );
                    
                    if (!subcontasResponse.data || !subcontasResponse.data.data) {
                        throw new Error('Não foi possível listar subcontas');
                    }
                    
                    const documentoLimpo = String(e.documento).replace(/\D/g, '');
                    
                    // Procura subconta com mesmo email ou CPF
                    const subcontaExistente = subcontasResponse.data.data.find(subconta => {
                        const emailMatch = subconta.email?.toLowerCase() === e.email?.toLowerCase();
                        const cpfMatch = subconta.cpfCnpj === documentoLimpo;
                        return emailMatch || cpfMatch;
                    });
                    
                    if (subcontaExistente && subcontaExistente.apiKey) {
                        console.log(`✅ Subconta encontrada! ID: ${subcontaExistente.id}`);
                        
                        // Atualiza banco de dados com subconta existente
                        await pool.query(
                            `UPDATE escritorios 
                             SET asaas_id = $1, 
                                 asaas_api_key = $2, 
                                 plano_financeiro_status = 'ativo' 
                             WHERE id = $3`,
                            [subcontaExistente.id, subcontaExistente.apiKey, escritorioId]
                        );
                        
                        console.log('✅ Dados da subconta existente salvos no banco!');
                        
                        return res.json({ 
                            ok: true, 
                            mensagem: '✅ Subconta recuperada com sucesso! Faturamento ativado.',
                            asaasId: subcontaExistente.id,
                            recuperado: true
                        });
                        
                    } else {
                        // Subconta existe mas sem API key ou não encontrada
                        console.error('⚠️ Subconta existe mas não foi possível recuperar');
                        
                        return res.status(400).json({ 
                            erro: '⚠️ Este email/CPF já está cadastrado no Asaas. Entre em contato com o suporte para recuperar sua conta ou use um email diferente (ex: seuemail+lawtech@dominio.com).'
                        });
                    }
                    
                } catch (recuperarErr) {
                    console.error('❌ Erro ao tentar recuperar subconta:', recuperarErr.message);
                    
                    return res.status(400).json({ 
                        erro: '⚠️ Este email/CPF já está em uso no Asaas. Entre em contato com o suporte para recuperar sua conta ou tente com email diferente.'
                    });
                }
            }
            
            // Outros erros
            res.status(500).json({ erro: erroMsg });
        }
    }
);

// ==========================================
// 💰 GERAR BOLETO DE HONORÁRIOS - CORRIGIDO
// ==========================================

router.post('/financeiro/gerar-boleto-honorarios', 
    authMiddleware, 
    async (req, res) => {
        try {
            const { clienteId, valor, descricao, vencimento } = req.body;

            // ✅ Validações de entrada
            if (!clienteId || !valor) {
                return res.status(400).json({ 
                    erro: 'Cliente e valor são obrigatórios' 
                });
            }

            if (parseFloat(valor) <= 0) {
                return res.status(400).json({ 
                    erro: 'Valor deve ser maior que zero' 
                });
            }

            // 1️⃣ Buscar chave API da subconta do escritório
            const escRes = await pool.query(
                'SELECT asaas_api_key, asaas_id FROM escritorios WHERE id = $1', 
                [req.user.escritorio_id]
            );
            
            const tokenCliente = escRes.rows[0]?.asaas_api_key?.trim();

            if (!tokenCliente) {
                return res.status(400).json({ 
                    erro: '⚠️ Ative o faturamento próprio em Configurações antes de gerar boletos' 
                });
            }

            // 2️⃣ Buscar dados do cliente pagador
            const clienteRes = await pool.query(
                'SELECT nome, documento, email FROM clientes WHERE id = $1 AND escritorio_id = $2', 
                [clienteId, req.user.escritorio_id]
            );
            
            const cliente = clienteRes.rows[0];

            if (!cliente) {
                return res.status(404).json({ 
                    erro: 'Cliente não encontrado' 
                });
            }

            const documentoLimpo = cliente.documento ? cliente.documento.replace(/\D/g, '') : '';

            // ✅ Validação de CPF/CNPJ do cliente
            if (!documentoLimpo || (documentoLimpo.length !== 11 && documentoLimpo.length !== 14)) {
                return res.status(400).json({ 
                    erro: 'Cliente sem CPF/CNPJ válido. Atualize o cadastro do cliente primeiro.' 
                });
            }

            // 3️⃣ Buscar ou criar cliente no Asaas (dentro da subconta)
            let asaasClienteId;
            
            try {
                console.log(`🔍 Buscando cliente ${cliente.nome} no Asaas...`);
                
                const buscaAsaas = await axios.get(
                    `${ASAAS_BASE_URL}/customers`,
                    { 
                        headers: getAsaasHeaders(tokenCliente),
                        params: { cpfCnpj: documentoLimpo }
                    }
                );

                if (buscaAsaas.data.data && buscaAsaas.data.data.length > 0) {
                    asaasClienteId = buscaAsaas.data.data[0].id;
                    console.log(`✅ Cliente encontrado: ${asaasClienteId}`);
                } else {
                    // Cliente não existe, criar novo
                    console.log(`📝 Criando novo cliente no Asaas...`);
                    
                    const novoClienteAsaas = await axios.post(
                        `${ASAAS_BASE_URL}/customers`, 
                        {
                            name: cliente.nome || 'Cliente',
                            cpfCnpj: documentoLimpo,
                            email: cliente.email || `cliente${Date.now()}@lawtech.temp`,
                            notificationDisabled: false
                        }, 
                        { headers: getAsaasHeaders(tokenCliente) }
                    );
                    
                    asaasClienteId = novoClienteAsaas.data.id;
                    console.log(`✅ Cliente criado: ${asaasClienteId}`);
                }
            } catch (e) {
                const erroAsaas = e.response?.data?.errors?.[0]?.description || e.message;
                console.error('❌ Erro ao gerenciar cliente:', erroAsaas);
                throw new Error(`Falha ao sincronizar cliente: ${erroAsaas}`);
            }

            // 4️⃣ Formatar data de vencimento
            const dataVencimento = vencimento ? formatarDataVencimento(vencimento) : formatarDataVencimento(new Date(Date.now() + 3 * 86400000));

            // 5️⃣ Gerar cobrança via boleto
            console.log(`💰 Gerando boleto - Valor: R$ ${valor} | Vencimento: ${dataVencimento}`);
            
            const cobranca = await axios.post(
                `${ASAAS_BASE_URL}/payments`, 
                {
                    customer: asaasClienteId,
                    billingType: 'BOLETO',
                    value: parseFloat(valor),
                    dueDate: dataVencimento,
                    description: descricao || 'Honorários Advocatícios',
                    externalReference: `HON-${req.user.escritorio_id}-${Date.now()}`,
                    postalService: false,
                    
                    // ✅ Configurações do boleto
                    fine: {
                        value: 2.00 // Multa 2%
                    },
                    interest: {
                        value: 1.00 // Juros 1% ao mês
                    }
                }, 
                { headers: getAsaasHeaders(tokenCliente) }
            );

            console.log(`✅ Boleto gerado com sucesso! ID: ${cobranca.data.id}`);

            // 6️⃣ Criar lançamento no financeiro vinculado ao boleto
            try {
                await pool.query(
                    `INSERT INTO financeiro (descricao, valor, tipo, data_vencimento, usuario_id, status, asaas_payment_id) 
                     VALUES ($1, $2, 'Receita', $3, $4, 'Pendente', $5)`,
                    [
                        descricao || 'Honorários Advocatícios',
                        parseFloat(valor),
                        dataVencimento,
                        req.user.id,
                        cobranca.data.id
                    ]
                );
                console.log(`💾 Lançamento criado no banco com ID Asaas: ${cobranca.data.id}`);
            } catch (dbErr) {
                console.error('⚠️ Erro ao criar lançamento no banco:', dbErr.message);
                // Não bloqueia a resposta, apenas loga o erro
            }

            // ✅ Retorna URLs do boleto
            res.json({ 
                ok: true, 
                url: cobranca.data.invoiceUrl, // Fatura completa
                boletoUrl: cobranca.data.bankSlipUrl, // PDF do boleto
                invoiceId: cobranca.data.id,
                vencimento: cobranca.data.dueDate,
                valor: cobranca.data.value,
                mensagem: 'Boleto gerado com sucesso!'
            });

        } catch (err) {
            const msg = err.response?.data?.errors?.[0]?.description || err.message;
            console.error('❌ Erro ao gerar boleto:', msg);
            res.status(500).json({ erro: 'Erro ao gerar boleto: ' + msg });
        }
    }
);

// ==========================================
// 🔔 WEBHOOK ASAAS - ATUALIZAÇÃO AUTOMÁTICA
// ==========================================

router.post('/webhook/financeiro', async (req, res) => {
    // ✅ Responde imediatamente para o Asaas
    res.status(200).json({ received: true }); 

    try {
        const { event, payment } = req.body;

        console.log(`🔔 [WEBHOOK] Evento recebido: ${event}`);
        console.log(`💳 Pagamento ID: ${payment?.id} | Valor: R$ ${payment?.value}`);

        // Eventos que confirmam pagamento
        const eventosPagamento = [
            'PAYMENT_RECEIVED',
            'PAYMENT_CONFIRMED',
            'PAYMENT_RECEIVED_IN_CASH'
        ];

        if (eventosPagamento.includes(event) && payment?.id) {
            console.log(`💰 Processando confirmação de pagamento...`);

            // Atualiza o status do lançamento usando o asaas_payment_id
            const result = await pool.query(
                `UPDATE financeiro 
                 SET status = 'Pago', 
                     data_pagamento = NOW()
                 WHERE asaas_payment_id = $1 
                   AND status != 'Pago'
                 RETURNING *`, 
                [payment.id]
            );
            
            if (result.rowCount > 0) {
                const lancamento = result.rows[0];
                console.log(`✅ Baixa automática realizada!`);
                console.log(`   📋 Lançamento: ${lancamento.descricao}`);
                console.log(`   💵 Valor: R$ ${lancamento.valor}`);
                console.log(`   📅 Data pagamento: ${new Date().toLocaleDateString('pt-BR')}`);
            } else {
                console.log(`⚠️ Lançamento não encontrado para payment_id: ${payment.id}`);
                console.log(`   Isso pode acontecer se o boleto foi gerado fora do sistema.`);
            }
        } else {
            console.log(`ℹ️ Evento ${event} não é de confirmação de pagamento - ignorando`);
        }
    } catch (err) {
        console.error('❌ Erro no processamento do Webhook:', err.message);
        console.error('Stack:', err.stack);
    }
});

// ==========================================
// 🧪 ROTAS DE TESTES E UTILITÁRIOS
// ==========================================

// Resetar configuração Asaas (desenvolvimento)
router.get('/adm/reset-asaas-escritorio', 
    authMiddleware, 
    async (req, res) => {
        try {
            await pool.query(
                `UPDATE escritorios 
                 SET asaas_id = NULL, 
                     asaas_api_key = NULL, 
                     plano_financeiro_status = NULL 
                 WHERE id = $1`,
                [req.user.escritorio_id]
            );
            
            res.json({ 
                ok: true, 
                mensagem: '✅ Configuração Asaas resetada. Ative novamente em Configurações.' 
            });
        } catch (err) {
            res.status(500).json({ erro: err.message });
        }
    }
);

// Testar conexão com subconta
router.get('/financeiro/testar-subconta', 
    authMiddleware, 
    async (req, res) => {
        try {
            const escRes = await pool.query(
                'SELECT asaas_api_key, asaas_id FROM escritorios WHERE id = $1',
                [req.user.escritorio_id]
            );

            const token = escRes.rows[0]?.asaas_api_key;
            const asaasId = escRes.rows[0]?.asaas_id;

            if (!token) {
                return res.status(400).json({ 
                    erro: 'Subconta não ativada' 
                });
            }

            // Testa a conexão
            const teste = await axios.get(
                `${ASAAS_BASE_URL}/customers?limit=1`,
                { headers: getAsaasHeaders(token) }
            );

            res.json({
                ok: true,
                mensagem: 'Subconta ativa e funcionando!',
                asaasId: asaasId,
                clientesTotal: teste.data.totalCount || 0
            });

        } catch (err) {
            const msg = err.response?.data?.errors?.[0]?.description || err.message;
            res.status(500).json({ 
                erro: `Erro na subconta: ${msg}` 
            });
        }
    }
);

module.exports = router;