const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middlewares/authMiddleware');
const pool = require('../config/db');

/* ======================================================
   CONFIGURAÇÃO ASAAS (BOLETOS) - MANTIDO
===================================================== */

const ASAAS_ENV = process.env.ASAAS_ENV || 'production';
const ASAAS_BASE_URL = ASAAS_ENV === 'sandbox' 
  ? 'https://sandbox.asaas.com/api/v3'
  : 'https://api.asaas.com/v3';

const getAsaasHeaders = () => ({
  'access_token': process.env.ASAAS_API_KEY,
  'Content-Type': 'application/json'
});

/* ======================================================
   FUNÇÃO AUXILIAR: CRIAR/BUSCAR CLIENTE NO ASAAS
===================================================== */
async function obterOuCriarCliente(dadosUsuario) {
  try {
    const { nome, email, cpfCnpj } = dadosUsuario;
    const documentoLimpo = cpfCnpj.replace(/\D/g, '');
    
    if (documentoLimpo.length !== 11 && documentoLimpo.length !== 14) {
      throw new Error('CPF/CNPJ inválido. Use 11 dígitos (CPF) ou 14 dígitos (CNPJ)');
    }

    // Buscar cliente existente
    const buscaCliente = await axios.get(
      `${ASAAS_BASE_URL}/customers`,
      { 
        headers: getAsaasHeaders(),
        params: { cpfCnpj: documentoLimpo }
      }
    );

    if (buscaCliente.data.data && buscaCliente.data.data.length > 0) {
      console.log(`✅ Cliente já existe no Asaas: ${buscaCliente.data.data[0].id}`);
      return buscaCliente.data.data[0].id;
    }

    // Criar novo cliente
    console.log(`📝 Criando novo cliente no Asaas: ${email}`);
    
    const novoCliente = await axios.post(
      `${ASAAS_BASE_URL}/customers`,
      {
        name: nome || 'Advogado LawTech',
        email: email,
        cpfCnpj: documentoLimpo,
        notificationDisabled: false
      },
      { headers: getAsaasHeaders() }
    );

    console.log(`✅ Cliente criado com sucesso: ${novoCliente.data.id}`);
    return novoCliente.data.id;

  } catch (error) {
    const msgErro = error.response?.data?.errors?.[0]?.description || error.message;
    console.error('❌ Erro ao criar/buscar cliente:', msgErro);
    throw new Error(`Falha ao configurar cliente: ${msgErro}`);
  }
}

/* ======================================================
   FUNÇÃO AUXILIAR: FORMATAR DATA DE VENCIMENTO
===================================================== */
function obterDataVencimento(diasParaVencer = 3) {
  const data = new Date();
  data.setDate(data.getDate() + diasParaVencer);
  
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  
  return `${ano}-${mes}-${dia}`;
}

/* ======================================================
   ASSINAR PLANO VIA BOLETO (ASAAS) - MANTIDO
===================================================== */

router.post('/assinar-plano', authMiddleware, async (req, res) => {
  const { planoId, nomePlano, valor, cpfUsuario } = req.body;
  const escritorioId = req.user.escritorio_id;

  if (!planoId || !escritorioId || !valor) {
    return res.status(400).json({
      erro: 'Dados inválidos. Necessário: planoId, valor e escritorioId'
    });
  }

  // Validar que o valor corresponde ao preço real do plano
  try {
    const planoResult = await pool.query('SELECT preco_mensal FROM planos WHERE id = $1', [planoId]);
    if (planoResult.rows.length === 0) {
      return res.status(400).json({ erro: 'Plano não encontrado' });
    }
    const precoReal = parseFloat(planoResult.rows[0].preco_mensal);
    const valorEnviado = parseFloat(valor);
    if (Math.abs(precoReal - valorEnviado) > 0.01) {
      console.error(`⚠️ [SEGURANÇA] Valor adulterado! Esperado: ${precoReal}, Recebido: ${valorEnviado}, Escritório: ${escritorioId}`);
      return res.status(400).json({ erro: 'Valor não corresponde ao plano selecionado' });
    }
  } catch (err) {
    console.error('❌ Erro ao validar plano:', err.message);
    return res.status(500).json({ erro: 'Erro ao validar plano' });
  }

  // Modo desenvolvedor (sem cobrança real)
  if (process.env.MODO_DESENVOLVEDOR === 'true') {
    try {
      console.log('🧪 [MODO DEV] Ativando plano sem cobrança real.');
      
      await pool.query(
        'UPDATE escritorios SET plano_id = $1 WHERE id = $2',
        [planoId, escritorioId]
      );

      return res.json({
        modoDev: true,
        mensagem: `Plano ${nomePlano} ativado com sucesso! (Modo Dev)`
      });

    } catch (err) {
      console.error('❌ ERRO BANCO (DEV):', err.message);
      return res.status(500).json({ erro: 'Erro interno ao processar upgrade.' });
    }
  }

  // Modo produção (ASAAS)
  try {
    if (!cpfUsuario || cpfUsuario.length < 11) {
      return res.status(400).json({ 
        erro: 'CPF/CNPJ é obrigatório para gerar boleto' 
      });
    }

    const customerId = await obterOuCriarCliente({
      nome: req.user.nome,
      email: req.user.email,
      cpfCnpj: cpfUsuario
    });

    console.log(`📄 Gerando boleto para escritório ${escritorioId} - Valor: R$ ${valor}`);
    
    const dadosCobranca = {
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
    };

    const cobrancaRes = await axios.post(
      `${ASAAS_BASE_URL}/payments`,
      dadosCobranca,
      { headers: getAsaasHeaders() }
    );

    const cobranca = cobrancaRes.data;

    console.log('✅ Boleto gerado com sucesso!');
    console.log(`📋 ID da Cobrança: ${cobranca.id}`);
    console.log(`🔗 Link do Boleto: ${cobranca.bankSlipUrl}`);

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
    
    console.error('❌ ERRO DETALHADO ASAAS:', JSON.stringify(erroAsaas, null, 2));
    
    if (mensagemErro.includes('Customer not found')) {
      return res.status(400).json({ erro: 'Erro ao criar cliente. Verifique os dados cadastrais.' });
    }
    
    if (mensagemErro.includes('invalid cpfCnpj')) {
      return res.status(400).json({ erro: 'CPF/CNPJ inválido. Verifique o documento informado.' });
    }

    if (mensagemErro.includes('Insufficient balance')) {
      return res.status(400).json({ erro: 'Saldo insuficiente na conta Asaas. Contate o suporte.' });
    }
    
    return res.status(500).json({
      erro: 'Falha ao gerar boleto',
      detalhes: mensagemErro
    });
  }
});

/* ======================================================
   WEBHOOK ASAAS (ATUALIZAÇÃO AUTOMÁTICA) - MANTIDO
===================================================== */

router.post('/webhook', async (req, res) => {
  // Verificação de token de acesso do webhook Asaas
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (webhookToken) {
    const tokenRecebido = req.headers['asaas-access-token'] || req.query.token;
    if (tokenRecebido !== webhookToken) {
      console.error('❌ [WEBHOOK] Token de acesso inválido');
      return res.status(401).json({ error: 'Token inválido' });
    }
  }

  const { event, payment } = req.body;
  console.log(`📢 [WEBHOOK] Evento recebido: ${event}`);

  // Verificação de idempotência
  if (payment?.id) {
    try {
      const jaProcessado = await pool.query(
        'SELECT id FROM webhook_events WHERE event_id = $1 AND source = $2',
        [`${event}_${payment.id}`, 'asaas_pagamentos']
      );

      if (jaProcessado.rows.length > 0) {
        console.log(`ℹ️ [WEBHOOK] Evento já processado: ${event}_${payment.id}`);
        return res.status(200).json({ received: true });
      }
    } catch (err) {
      console.error('❌ [WEBHOOK] Erro ao verificar idempotência:', err.message);
    }
  }

  res.status(200).send('OK');

  const eventosPagamento = [
    'PAYMENT_CONFIRMED',
    'PAYMENT_RECEIVED',
    'PAYMENT_RECEIVED_IN_CASH'
  ];

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
        `UPDATE escritorios
         SET plano_id = $1,
             plano_financeiro_status = 'pago',
             trial_expira_em = NULL
         WHERE id = $2`,
        [novoPlanoId, escritorioId]
      );

      // Registra evento processado
      await client.query(
        'INSERT INTO webhook_events (event_id, source, processed_at) VALUES ($1, $2, NOW())',
        [`${event}_${payment.id}`, 'asaas_pagamentos']
      );

      await client.query('COMMIT');
      console.log(`💰 [WEBHOOK] Pagamento confirmado! Escritório ${escritorioId} → Plano ${novoPlanoId}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('❌ [WEBHOOK] Erro ao atualizar plano:', err.message);
    } finally {
      client.release();
    }
  }

  if (event === 'PAYMENT_OVERDUE' && payment?.externalReference) {
    const escritorioId = payment.externalReference;
    console.log(`⚠️ [WEBHOOK] Pagamento vencido - Escritório ${escritorioId}`);
  }
});

/* ======================================================
   VERIFICAR STATUS DE COBRANÇA - MANTIDO
===================================================== */

router.get('/verificar-cobranca/:cobrancaId', authMiddleware, async (req, res) => {
  try {
    const { cobrancaId } = req.params;
    
    const response = await axios.get(
      `${ASAAS_BASE_URL}/payments/${cobrancaId}`,
      { headers: getAsaasHeaders() }
    );

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
});

/* ======================================================
   TESTAR CONEXÃO COM ASAAS - MANTIDO
===================================================== */

router.get('/testar-asaas', authMiddleware, async (req, res) => {
  try {
    console.log(`🔍 Testando conexão com Asaas (${ASAAS_ENV})...`);
    
    const response = await axios.get(
      `${ASAAS_BASE_URL}/customers?limit=1`,
      { headers: getAsaasHeaders() }
    );

    res.json({
      ok: true,
      mensagem: 'Conexão com Asaas OK!',
      ambiente: ASAAS_ENV,
      url: ASAAS_BASE_URL,
      clientesEncontrados: response.data.totalCount || 0
    });

  } catch (err) {
    const msgErro = err.response?.data?.errors?.[0]?.description || err.message;
    
    res.status(500).json({
      ok: false,
      erro: 'Falha na conexão com Asaas',
      detalhes: msgErro,
      ambiente: ASAAS_ENV
    });
  }
});

/* ======================================================
   💳 SALVAR CARTÃO - VERSÃO SEGURA COM TOKENIZAÇÃO
   ✅ NOVA IMPLEMENTAÇÃO (substituindo a temporária)
===================================================== */

router.post('/salvar-cartao', authMiddleware, async (req, res) => {
    try {
        const { 
            token,           // Token gerado no FRONTEND via Stripe.js
            last4,           // Últimos 4 dígitos
            brand,           // Visa, Mastercard, etc
            exp_month,       // Mês de validade
            exp_year,        // Ano de validade
            gateway          // 'stripe' ou 'asaas'
        } = req.body;

        const escritorioId = req.user.escritorio_id;

        console.log('💳 [CARTÃO] Salvando token para escritório:', escritorioId);

        // ✅ Validações
        if (!token) {
            return res.status(400).json({ 
                erro: 'Token do cartão não fornecido' 
            });
        }

        if (!gateway || !['stripe', 'asaas'].includes(gateway)) {
            return res.status(400).json({ 
                erro: 'Gateway inválido. Use "stripe" ou "asaas"' 
            });
        }

        // ✅ Verificar se já existe cartão
        const existente = await pool.query(
            'SELECT id FROM cartoes WHERE escritorio_id = $1',
            [escritorioId]
        );

        if (existente.rows.length > 0) {
            // Atualizar cartão existente
            await pool.query(
                `UPDATE cartoes 
                 SET token = $1, 
                     last4 = $2, 
                     brand = $3, 
                     exp_month = $4, 
                     exp_year = $5,
                     gateway = $6,
                     updated_at = NOW()
                 WHERE escritorio_id = $7`,
                [token, last4, brand, exp_month, exp_year, gateway, escritorioId]
            );

            console.log('✅ [CARTÃO] Token atualizado');

            return res.json({ 
                ok: true, 
                mensagem: 'Cartão atualizado com sucesso!',
                ultimos_digitos: last4,
                bandeira: brand
            });
        } else {
            // Inserir novo cartão
            await pool.query(
                `INSERT INTO cartoes 
                 (escritorio_id, token, last4, brand, exp_month, exp_year, gateway, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
                [escritorioId, token, last4, brand, exp_month, exp_year, gateway]
            );

            console.log('✅ [CARTÃO] Novo token salvo');

            return res.json({ 
                ok: true, 
                mensagem: 'Cartão salvo com sucesso!',
                ultimos_digitos: last4,
                bandeira: brand
            });
        }

    } catch (err) {
        console.error('❌ [CARTÃO] Erro ao salvar:', err);
        res.status(500).json({ 
            erro: 'Erro ao processar cartão',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

/* ======================================================
   💳 BUSCAR INFORMAÇÕES DO CARTÃO (sem token completo)
===================================================== */

router.get('/cartao', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT last4, brand, exp_month, exp_year, gateway, created_at 
             FROM cartoes 
             WHERE escritorio_id = $1`,
            [req.user.escritorio_id]
        );

        if (result.rows.length === 0) {
            return res.json({ 
                ok: true, 
                cartao: null 
            });
        }

        res.json({ 
            ok: true, 
            cartao: result.rows[0] 
        });

    } catch (err) {
        console.error('❌ [CARTÃO] Erro ao buscar:', err);
        res.status(500).json({ 
            erro: 'Erro ao buscar informações do cartão' 
        });
    }
});

/* ======================================================
   💳 REMOVER CARTÃO
===================================================== */

router.delete('/cartao', authMiddleware, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM cartoes WHERE escritorio_id = $1',
            [req.user.escritorio_id]
        );

        console.log('🗑️ [CARTÃO] Removido:', req.user.escritorio_id);

        res.json({ 
            ok: true, 
            mensagem: 'Cartão removido com sucesso!' 
        });

    } catch (err) {
        console.error('❌ [CARTÃO] Erro ao remover:', err);
        res.status(500).json({ 
            erro: 'Erro ao remover cartão' 
        });
    }
});

/* ======================================================
   💰 COBRAR USANDO TOKEN SALVO
   (para renovações automáticas após trial)
===================================================== */

router.post('/cobrar-renovacao', authMiddleware, async (req, res) => {
    try {
        const { valor, descricao } = req.body;
        const escritorioId = req.user.escritorio_id;

        // Validar valor contra o plano real do escritório
        const planoCheck = await pool.query(
            `SELECT p.preco_mensal FROM escritorios e
             JOIN planos p ON e.plano_id = p.id
             WHERE e.id = $1`,
            [escritorioId]
        );
        if (planoCheck.rows.length > 0) {
            const precoReal = parseFloat(planoCheck.rows[0].preco_mensal);
            const valorEnviado = parseFloat(valor);
            if (valorEnviado > 0 && Math.abs(precoReal - valorEnviado / 100) > 0.01 && Math.abs(precoReal - valorEnviado) > 0.01) {
                console.error(`⚠️ [SEGURANÇA] Valor adulterado na renovação! Esperado: ${precoReal}, Recebido: ${valorEnviado}, Escritório: ${escritorioId}`);
                return res.status(400).json({ erro: 'Valor não corresponde ao plano' });
            }
        }

        console.log('💰 [COBRANÇA] Processando renovação:', escritorioId);

        // Buscar token do cartão
        const cartaoResult = await pool.query(
            'SELECT token, gateway FROM cartoes WHERE escritorio_id = $1',
            [escritorioId]
        );

        if (cartaoResult.rows.length === 0) {
            return res.status(400).json({ 
                erro: 'Nenhum cartão cadastrado' 
            });
        }

        const { token, gateway } = cartaoResult.rows[0];

        // Processar cobrança conforme gateway
        let cobranca;
        
        if (gateway === 'stripe') {
            cobranca = await cobrarViaStripe(token, valor, descricao);
        } else if (gateway === 'asaas') {
            cobranca = await cobrarViaAsaas(token, valor, descricao, escritorioId);
        } else {
            return res.status(400).json({ erro: 'Gateway não suportado' });
        }

        if (cobranca.sucesso) {
            // Registrar transação
            await pool.query(
                `INSERT INTO transacoes 
                 (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                 VALUES ($1, $2, $3, $4, 'aprovada', $5, NOW())`,
                [escritorioId, cobranca.id, gateway, valor, descricao]
            );

            // Atualizar status
            await pool.query(
                `UPDATE escritorios 
                 SET plano_financeiro_status = 'pago',
                     ultimo_pagamento = NOW(),
                     proxima_cobranca = NOW() + INTERVAL '1 month'
                 WHERE id = $1`,
                [escritorioId]
            );

            console.log('✅ [COBRANÇA] Aprovada:', cobranca.id);

            return res.json({ 
                ok: true, 
                mensagem: 'Pagamento processado com sucesso!',
                transacao_id: cobranca.id
            });
        } else {
            // Registrar falha
            await pool.query(
                `INSERT INTO transacoes 
                 (escritorio_id, gateway_id, gateway, valor, status, mensagem_erro, descricao, created_at)
                 VALUES ($1, $2, $3, $4, 'recusada', $5, $6, NOW())`,
                [escritorioId, cobranca.id || null, gateway, valor, cobranca.erro, descricao]
            );

            console.log('❌ [COBRANÇA] Recusada:', cobranca.erro);

            return res.status(402).json({ 
                erro: 'Pagamento recusado',
                motivo: cobranca.erro
            });
        }

    } catch (err) {
        console.error('❌ [COBRANÇA] Erro:', err);
        res.status(500).json({ 
            erro: 'Erro ao processar pagamento',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

/* ======================================================
   FUNÇÕES AUXILIARES - INTEGRAÇÃO COM GATEWAYS
===================================================== */

async function cobrarViaStripe(token, valor, descricao) {
    try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        const charge = await stripe.charges.create({
            amount: Math.round(parseFloat(valor) * 100), // Converter para centavos
            currency: 'brl',
            source: token,
            description: descricao
        });

        return {
            sucesso: charge.paid,
            id: charge.id,
            erro: charge.failure_message || null
        };

    } catch (err) {
        console.error('❌ Erro no Stripe:', err);
        return {
            sucesso: false,
            id: null,
            erro: err.message
        };
    }
}

async function cobrarViaAsaas(token, valor, descricao, escritorioId) {
    try {
        // ASAAS suporta cobranças via cartão tokenizado
        const response = await axios.post(
            `${ASAAS_BASE_URL}/payments`,
            {
                customer: token, // No ASAAS, token pode ser o ID do customer
                billingType: 'CREDIT_CARD',
                value: parseFloat(valor),
                dueDate: obterDataVencimento(0), // Hoje
                description: descricao,
                externalReference: String(escritorioId)
            },
            { headers: getAsaasHeaders() }
        );

        const aprovado = response.data.status === 'CONFIRMED';

        return {
            sucesso: aprovado,
            id: response.data.id,
            erro: aprovado ? null : response.data.status
        };

    } catch (err) {
        console.error('❌ Erro no ASAAS:', err);
        return {
            sucesso: false,
            id: null,
            erro: err.response?.data?.errors?.[0]?.description || err.message
        };
    }
}

module.exports = router;