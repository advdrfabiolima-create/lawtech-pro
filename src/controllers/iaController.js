const Anthropic = require('@anthropic-ai/sdk');

/**
 * ============================================================
 * ASSISTENTE JURÍDICO COM CLAUDE HAIKU 4.5
 * Sistema: LawTech Pro
 * IA: Anthropic Claude (Haiku - Rápida e Econômica)
 * ============================================================
 */

async function analisarPrazoComClaude(req, res) {
  try {
    const { descricao, processo } = req.body;
    
    if (!descricao || !processo) {
      return res.status(400).json({ erro: 'Descrição e processo são obrigatórios' });
    }

    // Inicializa o cliente Anthropic
    const anthropic = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
    });

    // Prompt otimizado para análise jurídica brasileira
    const promptAnalise = `Você é um advogado sênior brasileiro especializado em prazos processuais.

PROCESSO: ${processo}
PRAZO/SITUAÇÃO: ${descricao}

Por favor, analise tecnicamente e forneça:
1. Natureza do prazo (fatal, dilatório, comum, etc.)
2. Fundamento legal (CPC, CLT, leis específicas)
3. Sugestão de cumprimento técnico
4. Alertas críticos (se houver)

Responda de forma objetiva e técnica em português jurídico formal.`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: promptAnalise
        }
      ]
    });

    // Extrai a resposta do formato da Claude
    const textoAnalise = message.content[0].text;

    res.json({ analise: textoAnalise });

  } catch (error) {
    console.error('❌ Erro na análise com Claude:', error.message);
    
    // Tratamento específico de erros da API Anthropic
    if (error.status === 401) {
      return res.status(401).json({ 
        erro: 'Chave API da Claude inválida ou expirada.',
        detalhe: 'Verifique a configuração no painel do sistema.'
      });
    }
    
    if (error.status === 429) {
      return res.status(429).json({ 
        erro: 'Limite de requisições atingido.',
        detalhe: 'Aguarde alguns segundos e tente novamente.'
      });
    }

    res.status(500).json({ 
      erro: 'IA temporariamente indisponível.',
      detalhe: error.message 
    });
  }
}

module.exports = { analisarPrazoComClaude };