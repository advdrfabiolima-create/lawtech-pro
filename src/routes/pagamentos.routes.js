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

  const usuarioId = req.user.id;
  const escritorioId = req.user.escritorio_id;

  if (!planoId || !escritorioId) {
    return res.status(400).json({ erro: 'Dados inválidos para troca de plano' });
  }

  /* ======================================================
     🔧 MODO DESENVOLVEDOR (SEM ASAAS)
  ====================================================== */

  if (process.env.MODO_DESENVOLVEDOR === 'true') {
    try {
      console.log('🧪 MODO DEV');
      console.log('DEBUG - Plano:', planoId, 'Escritório:', escritorioId);

      await pool.query(
        'UPDATE escritorios SET plano_id = $1 WHERE id = $2',
        [planoId, escritorioId]
      );

      return res.json({
        modoDev: true,
        mensagem: `Plano ${nomePlano} ativado com sucesso (Modo Dev)`
      });

    } catch (err) {
      console.error('❌ ERRO BANCO (DEV):', err.message);
      return res.status(500).json({
        erro: 'Erro ao atualizar plano no modo desenvolvedor'
      });
    }
  }

  /* ======================================================
     💳 MODO REAL (ASAAS)
  ====================================================== */

  try {
    // 1️⃣ Criar cliente no Asaas
    const clienteRes = await axios.post(
      `${process.env.ASAAS_URL}/customers`,
      {
        name: req.user.nome || 'Advogado LawTech',
        email: req.user.email,
        cpfCnpj: cpfUsuario
      },
      { headers: asaasHeaders }
    );

    const customerId = clienteRes.data.id;

    // 2️⃣ Criar cobrança
    const pagamentoRes = await axios.post(
      `${process.env.ASAAS_URL}/payments`,
      {
        customer: customerId,
        billingType: 'UNDEFINED',
        value: valor,
        dueDate: new Date(Date.now() + 86400000)
          .toISOString()
          .split('T')[0],
        description: `Plano ${nomePlano} - LawTech Pro`,
        externalReference: escritorioId // ⚠️ IMPORTANTE
      },
      { headers: asaasHeaders }
    );

    return res.json({ url: pagamentoRes.data.invoiceUrl });

  } catch (err) {
    console.error('❌ ERRO ASAAS:', err.response?.data || err.message);
    return res.status(500).json({
      erro: 'Falha ao gerar cobrança no Asaas'
    });
  }
});

/* ======================================================
   WEBHOOK ASAAS
===================================================== */

router.post('/webhook', async (req, res) => {
  const { event, payment } = req.body;

  if (
    event === 'PAYMENT_CONFIRMED' ||
    event === 'PAYMENT_RECEIVED'
  ) {
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

      console.log(
        `✅ Plano atualizado via webhook | Escritório ${escritorioId} → Plano ${novoPlanoId}`
      );

    } catch (err) {
      console.error('❌ ERRO WEBHOOK ASAAS:', err.message);
    }
  }

  res.status(200).send('OK');
});

module.exports = router;
