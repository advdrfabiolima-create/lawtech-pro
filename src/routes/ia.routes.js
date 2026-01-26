const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const { analisarPrazoComClaude } = require('../controllers/iaController');
const Anthropic = require('@anthropic-ai/sdk');

/**
 * ============================================================
 * ROTA PRINCIPAL: ASSISTENTE JURÍDICO (CHAT IA)
 * Usa: Claude Haiku 4.5 (Anthropic)
 * Restrição: Apenas plano Premium
 * ============================================================
 */
router.post('/ia/perguntar', authMiddleware, async (req, res) => {
  try {
    const { pergunta } = req.body;
    const escritorioId = req.user.escritorio_id;

    // 1️⃣ Validação básica
    if (!pergunta || !pergunta.trim()) {
      return res.status(400).json({ erro: 'Pergunta não informada.' });
    }

    // 2️⃣ 🔒 Verificação de Plano Premium
    const planoResult = await pool.query(`
      SELECT p.nome FROM escritorios e
      JOIN planos p ON p.id = e.plano_id
      WHERE e.id = $1
    `, [escritorioId]);

    if (planoResult.rowCount === 0 || planoResult.rows[0].nome.toLowerCase() !== 'premium') {
      return res.status(403).json({ erro: 'Recurso exclusivo do plano Premium' });
    }

    // 3️⃣ 🚀 Configuração da Claude API
    const anthropic = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
    });

    // 4️⃣ Prompt otimizado para contexto jurídico brasileiro
    const systemPrompt = `Você é um advogado sênior brasileiro com expertise em:
- Direito Civil e Processual Civil
- Direito do Trabalho e Processual do Trabalho  
- Direito Penal e Processual Penal
- Análise de jurisprudência STF, STJ e Tribunais

Responda sempre:
✓ De forma técnica e fundamentada
✓ Citando artigos de lei quando aplicável
✓ Em português jurídico formal
✓ Com objetividade e clareza
✓ Referenciando jurisprudência relevante quando pertinente`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      temperature: 0.4,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: pergunta
        }
      ]
    });

    // 5️⃣ Extração da resposta
    const respostaIA = message.content[0].text;

    return res.json({ resposta: respostaIA });

  } catch (err) {
    console.error('❌ ERRO NO ASSISTENTE JURÍDICO (CLAUDE):', err.message);

    // Tratamento de erros específicos da Anthropic
    if (err.status === 401) {
      return res.status(401).json({ 
        erro: 'Chave API da Claude inválida.',
        detalhe: 'Configure a chave correta no arquivo .env (CLAUDE_API_KEY)'
      });
    }

    if (err.status === 429) {
      return res.status(429).json({ 
        erro: 'Muitas requisições. Aguarde um momento.',
        detalhe: 'Limite de taxa da API atingido.'
      });
    }

    if (err.status === 400) {
      return res.status(400).json({ 
        erro: 'Requisição inválida.',
        detalhe: err.message
      });
    }

    return res.status(500).json({ 
      erro: 'O assistente jurídico está temporariamente offline.',
      detalhe: err.message 
    });
  }
});

/**
 * ============================================================
 * ROTA SECUNDÁRIA: ANÁLISE DE PRAZO ESPECÍFICO (DASHBOARD)
 * Usa: Claude Haiku para análise técnica rápida
 * ============================================================
 */
router.post('/analisar-prazo', authMiddleware, analisarPrazoComClaude);

module.exports = router;