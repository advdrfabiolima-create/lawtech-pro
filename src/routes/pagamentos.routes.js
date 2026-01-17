const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middlewares/authMiddleware');
const pool = require('../config/db');

/* ======================================================
   CONFIGURAÇÃO ASAAS
===================================================== */

const asaasHeaders = {
  access_token: process.env.ASAAS_API_KEY
};

/* ======================================================
   ASSINAR PLANO (DEV + PRODUÇÃO)
===================================================== */

router.post('/assinar-plano', authMiddleware, async (req, res) => {
  const { planoId, nomePlano, valor, cpfUsuario } = req.body;

  const escritorioId = req.user.escritorio_id;

  if (!planoId || !escritorioId) {
    return res.status(400).json({ erro: 'Dados inválidos para ativação de plano' });
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
        mensagem: `Plano ${nomePlano} ativado com sucesso!`
      });

    } catch (err) {
      console.error('❌ ERRO BANCO (DEV):', err.message);
      return res.status(500).json({ erro: 'Erro interno ao processar upgrade.' });
    }
  }

  /* ======================================================
     💳 MODO REAL (ASAAS)
  ====================================================== */

  try {
    // 1️⃣ Criar ou Atualizar cliente no Asaas
    // O Asaas exige um CPF/CNPJ válido no Sandbox. Se não vier do front, usamos um genérico para teste.
    const documentoFinal = (cpfUsuario && cpfUsuario.length >= 11) 
      ? cpfUsuario.replace(/\D/g, '') 
      : '00000000000';

    console.log(`📡 Solicitando cobrança Asaas para: ${req.user.email}`);

    const clienteRes = await axios.post(
      `${process.env.ASAAS_URL}/customers`,
      {
        name: req.user.nome || 'Advogado LawTech',
        email: req.user.email,
        cpfCnpj: documentoFinal
      },
      { headers: asaasHeaders }
    );

    const customerId = clienteRes.data.id;

    // 2️⃣ Criar cobrança (Pagamento por cartão ou boleto não definido - UNDEFINED)
    const pagamentoRes = await axios.post(
      `${process.env.ASAAS_URL}/payments`,
      {
        customer: customerId,
        billingType: 'UNDEFINED',
        value: valor,
        dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Vence amanhã
        description: `Plano ${nomePlano} - LawTech Pro`,
        externalReference: String(escritorioId) // Vincula a cobrança ao escritório no banco
      },
      { headers: asaasHeaders }
    );

    console.log('✅ Link de pagamento gerado com sucesso.');
    return res.json({ url: pagamentoRes.data.invoiceUrl });

  } catch (err) {
    // Captura o erro detalhado da API do Asaas para facilitar seu debug
    const erroAsaas = err.response?.data || err.message;
    console.error('❌ ERRO DETALHADO ASAAS:', JSON.stringify(erroAsaas, null, 2));
    
    return res.status(500).json({
      erro: 'Falha ao processar pagamento com o gateway.',
      detalhes: erroAsaas
    });
  }
});

/* ======================================================
   WEBHOOK ASAAS (ATUALIZAÇÃO AUTOMÁTICA)
===================================================== */

router.post('/webhook', async (req, res) => {
  const { event, payment } = req.body;

  // Responde imediatamente para o Asaas não reenviar o post (status 200)
  res.status(200).send('OK');

  if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
    const escritorioId = payment.externalReference;
    const descricao = payment.description || '';

    let novoPlanoId = 1;
    if (descricao.includes('Intermediário')) novoPlanoId = 2;
    if (descricao.includes('Avançado')) novoPlanoId = 3;
    if (descricao.includes('Premium')) novoPlanoId = 4;

    try {
      await pool.query(
        'UPDATE escritorios SET plano_id = $1 WHERE id = $2',
        [novoPlanoId, escritorioId]
      );
      console.log(`💰 PAGAMENTO CONFIRMADO: Escritório ${escritorioId} atualizado para Plano ${novoPlanoId}`);
    } catch (err) {
      console.error('❌ ERRO AO ATUALIZAR PLANO VIA WEBHOOK:', err.message);
    }
  }
});

module.exports = router;