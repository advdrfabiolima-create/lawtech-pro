const axios = require('axios');

async function analisarPrazoComGemini(req, res) {
  try {
    const { descricao, processo } = req.body;
    // Usando a chave DeepSeek que já está no seu .env
    const apiKey = process.env.IA_API_KEY; 

    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "Você é um assistente jurídico sênior brasileiro." },
        { role: "user", content: `Analise este prazo: ${descricao} do processo ${processo}. Sugira o cumprimento técnico.` }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const textoAnalise = response.data.choices[0].message.content;
    res.json({ analise: textoAnalise });

  } catch (error) {
    console.error("Erro na IA Reserva:", error.message);
    res.status(500).json({ erro: "IA em manutenção. Tente novamente em instantes." });
  }
}

module.exports = { analisarPrazoComGemini };