const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middlewares/authMiddleware');
const pool = require('../config/db');

/* ======================================================
   CONFIGURAÇÃO ASAAS - CORRIGIDA
===================================================== */

// ✅ Determina ambiente automaticamente
const ASAAS_ENV = process.env.ASAAS_ENV || 'production';
const ASAAS_BASE_URL = ASAAS_ENV === 'sandbox' 
  ? 'https://sandbox.asaas.com/api/v3'
  : 'https://api.asaas.com/v3';

// ✅ Headers corrigidos (access_token é um header HTTP, não JSON)
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
    
    // Limpa CPF/CNPJ
    const documentoLimpo = cpfCnpj.replace(/\D/g, '');
    
    // ✅ IMPORTANTE: Valida tamanho do documento
    if (documentoLimpo.length !== 11 && documentoLimpo.length !== 14) {
      throw new Error('CPF/CNPJ inválido. Use 11 dígitos (CPF) ou 14 dígitos (CNPJ)');
    }

    // 1️⃣ Tenta buscar cliente existente
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

    // 2️⃣ Se não existe, cria novo cliente
    console.log(`📝 Criando novo cliente no Asaas: ${email}`);
    
    const novoCliente = await axios.post(
      `${ASAAS_BASE_URL}/customers`,
      {
        name: nome || 'Advogado LawTech',
        email: email,
        cpfCnpj: documentoLimpo,
        notificationDisabled: false // ✅ Habilita notificações de boleto
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
  
  // ✅ Formato correto: YYYY-MM-DD
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  
  return `${ano}-${mes}-${dia}`;
}

/* ======================================================
   ASSINAR PLANO (DEV + PRODUÇÃO) - CORRIGIDO
===================================================== */

router.post('/assinar-plano', authMiddleware, async (req, res) => {
  const { planoId, nomePlano, valor, cpfUsuario } = req.body;
  const escritorioId = req.user.escritorio_id;

  // ✅ Validação de entrada
  if (!planoId || !escritorioId || !valor) {
    return res.status(400).json({ 
      erro: 'Dados inválidos. Necessário: planoId, valor e escritorioId' 
    });
  }

  /* ======================================================
     🔧 MODO DESENVOLVEDOR (SEM ASAAS)
  ====================================================== */

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

  /* ======================================================
     💳 MODO REAL (ASAAS) - CORRIGIDO
  ====================================================== */

  try {
    // 1️⃣ Validar e preparar CPF
    if (!cpfUsuario || cpfUsuario.length < 11) {
      return res.status(400).json({ 
        erro: 'CPF/CNPJ é obrigatório para gerar boleto' 
      });
    }

    // 2️⃣ Obter ou criar cliente
    const customerId = await obterOuCriarCliente({
      nome: req.user.nome,
      email: req.user.email,
      cpfCnpj: cpfUsuario
    });

    // 3️⃣ Criar cobrança via BOLETO
    console.log(`📄 Gerando boleto para escritório ${escritorioId} - Valor: R$ ${valor}`);
    
    const dadosCobranca = {
      customer: customerId,
      billingType: 'BOLETO', // ✅ MUDOU: agora sempre gera boleto
      value: parseFloat(valor),
      dueDate: obterDataVencimento(3), // ✅ Vence em 3 dias
      description: `${nomePlano} - LawTech Pro`,
      externalReference: String(escritorioId),
      
      // ✅ CONFIGURAÇÕES IMPORTANTES DO BOLETO
      postalService: false, // Não envia pelos Correios
      
      // Configuração de desconto (opcional)
      discount: {
        value: 0,
        dueDateLimitDays: 0
      },
      
      // Configuração de multa e juros
      fine: {
        value: 2.00 // Multa de 2%
      },
      interest: {
        value: 1.00 // Juros de 1% ao mês
      }
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

    // ✅ Retorna dados completos do boleto
    return res.json({ 
      ok: true,
      cobrancaId: cobranca.id,
      url: cobranca.invoiceUrl, // Link da fatura completa
      boletoUrl: cobranca.bankSlipUrl, // Link direto do PDF do boleto
      pixQrCode: cobranca.pixQrCodeUrl || null, // Se tiver PIX habilitado
      valor: cobranca.value,
      vencimento: cobranca.dueDate,
      status: cobranca.status,
      mensagem: 'Boleto gerado com sucesso!'
    });

  } catch (err) {
    // ✅ Tratamento de erro melhorado
    const erroAsaas = err.response?.data || {};
    const mensagemErro = erroAsaas.errors?.[0]?.description || err.message;
    
    console.error('❌ ERRO DETALHADO ASAAS:', JSON.stringify(erroAsaas, null, 2));
    
    // Erros específicos do Asaas
    if (mensagemErro.includes('Customer not found')) {
      return res.status(400).json({ 
        erro: 'Erro ao criar cliente. Verifique os dados cadastrais.' 
      });
    }
    
    if (mensagemErro.includes('invalid cpfCnpj')) {
      return res.status(400).json({ 
        erro: 'CPF/CNPJ inválido. Verifique o documento informado.' 
      });
    }

    if (mensagemErro.includes('Insufficient balance')) {
      return res.status(400).json({ 
        erro: 'Saldo insuficiente na conta Asaas. Contate o suporte.' 
      });
    }
    
    return res.status(500).json({
      erro: 'Falha ao gerar boleto',
      detalhes: mensagemErro
    });
  }
});

/* ======================================================
   WEBHOOK ASAAS (ATUALIZAÇÃO AUTOMÁTICA) - CORRIGIDO
===================================================== */

router.post('/webhook', async (req, res) => {
  const { event, payment } = req.body;

  console.log(`🔔 [WEBHOOK] Evento recebido: ${event}`);
  
  // ✅ Responde imediatamente para o Asaas não reenviar
  res.status(200).send('OK');

  // ✅ Eventos que confirmam pagamento
  const eventosPagamento = [
    'PAYMENT_CONFIRMED',
    'PAYMENT_RECEIVED',
    'PAYMENT_RECEIVED_IN_CASH'
  ];

  if (eventosPagamento.includes(event)) {
    const escritorioId = payment.externalReference;
    const descricao = payment.description || '';

    // Identifica o plano pela descrição
    let novoPlanoId = 1;
    if (descricao.includes('Intermediário')) novoPlanoId = 2;
    if (descricao.includes('Avançado')) novoPlanoId = 3;
    if (descricao.includes('Premium')) novoPlanoId = 4;

    try {
      // ✅ Atualiza plano E status financeiro
      await pool.query(
        `UPDATE escritorios 
         SET plano_id = $1, 
             plano_financeiro_status = 'pago',
             trial_expira_em = NULL
         WHERE id = $2`,
        [novoPlanoId, escritorioId]
      );
      
      console.log(`💰 [WEBHOOK] Pagamento confirmado! Escritório ${escritorioId} → Plano ${novoPlanoId}`);
    } catch (err) {
      console.error('❌ [WEBHOOK] Erro ao atualizar plano:', err.message);
    }
  }

  // ✅ Evento de pagamento vencido
  if (event === 'PAYMENT_OVERDUE') {
    const escritorioId = payment.externalReference;
    console.log(`⚠️ [WEBHOOK] Pagamento vencido - Escritório ${escritorioId}`);
    
    // Aqui você pode adicionar lógica para suspender o plano
  }
});

/* ======================================================
   ROTA AUXILIAR: VERIFICAR STATUS DE COBRANÇA
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
   ROTA AUXILIAR: TESTAR CONEXÃO COM ASAAS
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

/**
 * 💳 SALVAR CARTÃO (TOKENIZADO)
 * Endpoint para salvar token do cartão para cobrança futura
 */
router.post('/salvar-cartao', authMiddleware, async (req, res) => {
    try {
        const { numero, validade } = req.body;
        const escritorioId = req.user.escritorio_id;

        console.log(`💳 [CARTÃO] Salvando para escritório ${escritorioId}`);

        // ⚠️ IMPORTANTE: NUNCA salvar número completo!
        // Usar gateway de pagamento para tokenizar
        
        // TODO: Implementar tokenização real com Asaas ou outro gateway
        // Por enquanto, salva apenas últimos dígitos (TEMPORÁRIO)
        
        const ultimosDigitos = numero.replace(/\D/g, '').slice(-4);
        const bandeira = detectarBandeira(numero);
        
        // TEMPORÁRIO: Gerar token fake até implementar gateway
        const cartaoToken = 'TMP_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        // Salvar no banco
        await pool.query(`
            UPDATE escritorios 
            SET cartao_token = $1,
                cartao_bandeira = $2,
                cartao_ultimos_digitos = $3
            WHERE id = $4
        `, [cartaoToken, bandeira, ultimosDigitos, escritorioId]);

        console.log(`✅ [CARTÃO] Token salvo: **** **** **** ${ultimosDigitos} (${bandeira})`);

        res.json({ 
            ok: true, 
            mensagem: 'Cartão salvo com segurança',
            ultimos_digitos: ultimosDigitos,
            bandeira: bandeira
        });

    } catch (err) {
        console.error('❌ [CARTÃO] Erro ao salvar:', err);
        res.status(500).json({ 
            erro: 'Erro ao processar cartão',
            detalhes: err.message
        });
    }
});

// Função auxiliar para detectar bandeira
function detectarBandeira(numero) {
    const limpo = numero.replace(/\D/g, '');
    if (/^4/.test(limpo)) return 'Visa';
    if (/^5[1-5]/.test(limpo)) return 'Mastercard';
    if (/^3[47]/.test(limpo)) return 'Amex';
    if (/^6(?:011|5)/.test(limpo)) return 'Discover';
    if (/^636368|438935|504175|451416|636297/.test(limpo)) return 'Elo';
    return 'Desconhecida';
}
module.exports = router;