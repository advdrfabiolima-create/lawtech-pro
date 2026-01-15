const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post('/ia/perguntar', authMiddleware, async (req, res) => {
  try {
    const { pergunta } = req.body;
    const escritorioId = req.user.escritorio_id;

    if (!pergunta || !pergunta.trim()) {
      return res.status(400).json({ erro: 'Pergunta não informada.' });
    }

    // 🔒 Verifica plano
    const planoResult = await pool.query(`
      SELECT p.nome
      FROM escritorios e
      JOIN planos p ON p.id = e.plano_id
      WHERE e.id = $1
    `, [escritorioId]);

    if (
      planoResult.rowCount === 0 ||
      planoResult.rows[0].nome.toLowerCase() !== 'premium'
    ) {
      return res.status(403).json({
        erro: 'Recurso exclusivo do plano Premium'
      });
    }

    // 🤖 Chamada Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `
Atue como um advogado sênior brasileiro.
Responda de forma técnica, clara e objetiva, em português jurídico formal.

Pergunta:
${pergunta}
    `;

    const result = await model.generateContent(prompt);
    const textoResposta = result.response.text();

    return res.json({ resposta: textoResposta });

  } catch (err) {
    console.error('Erro IA:', err);

    if (err.message?.includes('429')) {
      return res.status(429).json({
        erro: 'Limite de uso da IA atingido',
        detalhe: 'Aguarde alguns segundos ou verifique sua cota no Google AI Studio.'
      });
    }

    return res.status(500).json({
      erro: 'Erro no assistente jurídico.',
      detalhe: err.message
    });
  }
});

module.exports = router;
