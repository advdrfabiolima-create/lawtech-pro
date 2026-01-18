const pool = require('../config/db');
const axios = require('axios'); // Certifique-se de ter o axios instalado: npm install axios

/**
 * ==========================================
 * ATIVAR FATURAMENTO (CRIAÇÃO DE SUBCONTA)
 * ==========================================
 */
async function configurarSubconta(req, res) {
  try {
    const usuarioId = req.user.id;

    // 1. Busca os dados que o senhor salvou no Neon
    const result = await pool.query(
      `SELECT e.*, u.email as email_usuario 
       FROM escritorios e 
       JOIN usuarios u ON u.escritorio_id = e.id 
       WHERE u.id = $1`,
      [usuarioId]
    );

    const esc = result.rows[0];

    if (!esc || !esc.documento || !esc.banco_codigo) {
      return res.status(400).json({ erro: 'Dados do escritório incompletos para ativação.' });
    }

    // 2. Prepara os dados para o Asaas (conforme a documentação do Sandbox)
    const dadosAsaas = {
      name: esc.nome,
      email: esc.email || esc.email_usuario,
      cpfCnpj: esc.documento.replace(/\D/g, ''),
      birthDate: esc.data_nascimento, // Importante para CPF
      companyType: esc.documento.length > 14 ? 'LIMITED' : 'INDIVIDUAL',
      mobilePhone: '71999999999', // Telefone padrão para teste
      address: esc.endereco,
      addressNumber: 'S/N',
      province: esc.cidade,
      postalCode: esc.cep.replace(/\D/g, ''),
      bankAccount: {
        account: esc.conta,
        accountDigit: esc.conta_digito,
        bankCode: esc.banco_codigo,
        agency: esc.agencia,
        type: 'CONTA_CORRENTE'
      }
    };

    // 3. Chamada para a API do Asaas
    console.log("⏳ Enviando dados ao Asaas Sandbox...");
    
    const response = await axios.post(`${process.env.ASAAS_URL}/accounts`, dadosAsaas, {
      headers: { 'access_token': process.env.ASAAS_API_KEY }
    });

    // 4. Salva o ID da subconta e a chave da subconta no Banco
    await pool.query(
      `UPDATE escritorios SET 
        asaas_id = $1, 
        asaas_api_key = $2, 
        plano_financeiro_status = 'ativo' 
       WHERE id = $3`,
      [response.data.id, response.data.apiKey, esc.id]
    );

    console.log("✅ [ASAAS] Subconta criada com sucesso!");
    res.json({ ok: true, mensagem: 'Faturamento ativado com sucesso!' });

  } catch (error) {
    const mensagemErro = error.response?.data?.errors?.[0]?.description || error.message;
    console.error('❌ ERRO NO ASAAS:', mensagemErro);
    res.status(500).json({ erro: mensagemErro });
  }
}

async function planoFinanceiroAtual(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;
    const result = await pool.query(
      `SELECT pf.nome, pf.valor, e.plano_financeiro_status
       FROM escritorios e
       LEFT JOIN planos_financeiros pf ON pf.id = e.plano_financeiro_id
       WHERE e.id = $1`,
      [escritorioId]
    );

    if (result.rows.length === 0 || !result.rows[0].nome) {
      return res.json({ mensagem: 'Nenhum plano financeiro ativo' });
    }

    res.json({
      plano: result.rows[0].nome,
      valor: result.rows[0].valor,
      status: result.rows[0].plano_financeiro_status
    });
  } catch (error) {
    console.error('Erro ao buscar plano financeiro:', error);
    res.status(500).json({ erro: 'Erro ao buscar plano financeiro' });
  }
}

module.exports = {
  planoFinanceiroAtual,
  configurarSubconta
};