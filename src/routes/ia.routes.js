const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const { analisarPrazoComGemini } = require('../controllers/iaController');

router.post('/ia/perguntar', authMiddleware, async (req, res) => {
  try {
    const { pergunta } = req.body;
    const escritorioId = req.user.escritorio_id;

    // 1. Validação básica da pergunta
    if (!pergunta || !pergunta.trim()) {
      return res.status(400).json({ erro: 'Pergunta não informada.' });
    }

    // 2. 🔒 Verificação de Plano (Mantida a regra de negócio do LawTech Pro)
    const planoResult = await pool.query(`
      SELECT p.nome FROM escritorios e
      JOIN planos p ON p.id = e.plano_id
      WHERE e.id = $1
    `, [escritorioId]);

    if (planoResult.rowCount === 0 || planoResult.rows[0].nome.toLowerCase() !== 'premium') {
      return res.status(403).json({ erro: 'Recurso exclusivo do plano Premium' });
    }

    // 3. 🚀 Configuração da Chamada DeepSeek
    // Certifique-se de que a variável IA_API_KEY esteja no seu .env e no Render
    const API_KEY = process.env.IA_API_KEY; 
    const API_URL = "https://api.deepseek.com/chat/completions"; 

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat", 
        messages: [
          { 
            role: "system", 
            content: "Atue como um advogado sênior brasileiro especializado em Direito Civil, Processual e Trabalhista. Responda de forma técnica, clara e fundamentada em português jurídico formal." 
          },
          { role: "user", content: pergunta }
        ],
        stream: false,
        temperature: 0.5
      })
    });

    // 4. Tratamento da Resposta da API
    const data = await response.json();

    if (data.error) {
      console.error("ERRO API DEEPSEEK:", data.error);
      throw new Error(data.error.message || "Erro na comunicação com a IA.");
    }

    // Extração do texto da resposta
    const respostaIA = data.choices[0].message.content;

    return res.json({ resposta: respostaIA }); 

  } catch (err) {
    console.error('ERRO NO ASSISTENTE JURÍDICO:', err.message);

    // Tratamento de erro de saldo ou cota (comum em APIs pagas)
    if (err.message.toLowerCase().includes('insufficient_balance') || err.message.includes('402')) {
      return res.status(402).json({ 
        erro: 'Saldo insuficiente na conta da IA.', 
        detalhe: 'Verifique os créditos no painel da DeepSeek.' 
      });
    }

    return res.status(500).json({ 
      erro: 'O assistente jurídico está temporariamente offline.',
      detalhe: err.message 
    });
  }
});
// --- NOVA ROTA (GEMINI / DASHBOARD) ---
// Esta rota chama a função de análise técnica via Gemini
router.post('/analisar-prazo', authMiddleware, analisarPrazoComGemini);

module.exports = router;