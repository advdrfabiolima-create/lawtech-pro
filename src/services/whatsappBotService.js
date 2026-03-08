const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const pool = require('../config/db');
const logger = require('../utils/logger');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const GRAPH_URL = 'https://graph.facebook.com/v19.0';
const HANDOFF_TRIGGERS = [
    'falar com advogado', 'falar com um advogado', 'atendente', 'humano',
    'pessoa real', 'quero falar com alguém', 'atendimento humano',
    'falar com alguém', 'falar com uma pessoa'
];

// ── Envia mensagem via Meta Cloud API ──────────────────────────────────────
async function enviarMensagem(telefone, texto) {
    await axios.post(
        `${GRAPH_URL}/${process.env.META_PHONE_NUMBER_ID}/messages`,
        {
            messaging_product: 'whatsapp',
            to: telefone,
            type: 'text',
            text: { body: texto }
        },
        { headers: { Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}` } }
    );
}

// ── Busca ou cria conversa no banco ────────────────────────────────────────
async function obterConversa(escritorioId, telefone, nomeContato) {
    const { rows } = await pool.query(
        `INSERT INTO whatsapp_conversas (escritorio_id, telefone, nome_contato)
         VALUES ($1, $2, $3)
         ON CONFLICT (escritorio_id, telefone) DO UPDATE
         SET nome_contato = COALESCE(EXCLUDED.nome_contato, whatsapp_conversas.nome_contato),
             atualizado_em = NOW()
         RETURNING *`,
        [escritorioId, telefone, nomeContato || null]
    );
    return rows[0];
}

// ── Salva mensagem no histórico (max 20) ───────────────────────────────────
async function salvarMensagem(conversaId, role, content) {
    await pool.query(
        `UPDATE whatsapp_conversas SET
            mensagens = (
                CASE WHEN jsonb_array_length(mensagens) >= 20
                     THEN mensagens - 0
                     ELSE mensagens
                END || $1::jsonb
            ),
            atualizado_em = NOW()
         WHERE id = $2`,
        [JSON.stringify([{ role, content, ts: new Date().toISOString() }]), conversaId]
    );
}

// ── Busca dados do escritório para o prompt ────────────────────────────────
async function obterDadosEscritorio(escritorioId) {
    const { rows } = await pool.query(
        `SELECT e.nome, e.advogado_responsavel, e.cidade, e.estado
         FROM escritorios e WHERE e.id = $1`,
        [escritorioId]
    );
    return rows[0] || {};
}

// ── Cria lead no CRM se ainda não existir ─────────────────────────────────
async function criarLeadSeNecessario(escritorioId, conversaId, telefone, nomeContato) {
    const { rows: existing } = await pool.query(
        'SELECT lead_id FROM whatsapp_conversas WHERE id = $1',
        [conversaId]
    );
    if (existing[0]?.lead_id) return;

    const nome = nomeContato || `WhatsApp ${telefone}`;
    const { rows } = await pool.query(
        `INSERT INTO leads (escritorio_id, nome, telefone, origem, status, score, ultima_movimentacao)
         VALUES ($1, $2, $3, 'whatsapp', 'Novo', 10, NOW())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [escritorioId, nome, telefone]
    );

    if (rows[0]?.id) {
        await pool.query(
            'UPDATE whatsapp_conversas SET lead_id = $1 WHERE id = $2',
            [rows[0].id, conversaId]
        );
    }
}

// ── Notificação inapp para o escritório (handoff) ─────────────────────────
async function notificarHandoff(escritorioId, telefone, nomeContato) {
    try {
        await pool.query(
            `INSERT INTO notificacoes (escritorio_id, tipo, titulo, mensagem, prazo_id)
             VALUES ($1, 'whatsapp_handoff', 'Lead solicita atendimento humano',
             $2, NULL)`,
            [escritorioId, `${nomeContato || telefone} pediu para falar com um advogado via WhatsApp.`]
        );
    } catch (err) {
        logger.warn({ err: err.message }, '[WhatsApp Bot] Erro ao criar notificacao handoff');
    }
}

// ── Processa mensagem recebida ─────────────────────────────────────────────
async function processarMensagem({ escritorioId, telefone, nomeContato, textoRecebido }) {
    const conversa = await obterConversa(escritorioId, telefone, nomeContato);

    // Se em atendimento humano, ignora o bot
    if (conversa.status === 'humano') {
        logger.info({ telefone }, '[WhatsApp Bot] Conversa em modo humano — ignorando');
        return;
    }

    // Salva mensagem do usuário
    await salvarMensagem(conversa.id, 'user', textoRecebido);
    await criarLeadSeNecessario(escritorioId, conversa.id, telefone, nomeContato);

    // Detecta pedido de atendimento humano
    const textoLower = textoRecebido.toLowerCase();
    const pedindoHumano = HANDOFF_TRIGGERS.some(t => textoLower.includes(t));

    if (pedindoHumano) {
        await pool.query(
            `UPDATE whatsapp_conversas SET status = 'humano', atualizado_em = NOW() WHERE id = $1`,
            [conversa.id]
        );
        await notificarHandoff(escritorioId, telefone, nomeContato);
        const msg = 'Entendido! Vou transferir você para um de nossos advogados. Em breve alguém entrará em contato. 🤝';
        await enviarMensagem(telefone, msg);
        await salvarMensagem(conversa.id, 'assistant', msg);
        return;
    }

    // Monta histórico para o Claude (re-busca do banco para incluir mensagem recém-salva)
    const { rows: convAtualizada } = await pool.query(
        'SELECT mensagens FROM whatsapp_conversas WHERE id = $1',
        [conversa.id]
    );
    const historico = (convAtualizada[0]?.mensagens || [])
        .slice(-20)
        .map(m => ({ role: m.role, content: m.content }));

    // Busca dados do escritório
    const esc = await obterDadosEscritorio(escritorioId);
    const systemPrompt = `Você é o assistente virtual do escritório de advocacia "${esc.nome || 'LawTech Pro'}", \
localizado em ${esc.cidade || 'Brasil'}/${esc.estado || 'BR'}. \
${esc.advogado_responsavel ? `Advogado responsável: Dr(a). ${esc.advogado_responsavel}.` : ''}

Suas responsabilidades:
1. Recepcionar leads de forma calorosa e profissional
2. Qualificar o caso: perguntar qual área jurídica (trabalhista, família, criminal, cível, etc.), urgência e breve descrição
3. Responder dúvidas jurídicas gerais de forma didática — sempre ressaltando que é uma orientação geral e não substitui consulta com advogado
4. Quando o caso for muito complexo ou o usuário pedir, ofereça transferir para um advogado
5. Tom: profissional, empático, claro e direto

Regras importantes:
- Nunca invente leis ou jurisprudências específicas
- Em casos urgentes (prisão, prazo judicial iminente), priorize transferência para advogado
- Não colete dados sensíveis como senhas ou documentos completos
- Respostas curtas e objetivas — é WhatsApp, não e-mail
- Escreva em português brasileiro`;

    // Chama Claude
    const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: systemPrompt,
        messages: historico
    });

    const resposta = response.content[0].text;

    // Salva e envia resposta
    await salvarMensagem(conversa.id, 'assistant', resposta);
    await enviarMensagem(telefone, resposta);

    logger.info({ telefone, status: conversa.status }, '[WhatsApp Bot] Resposta enviada');
}

module.exports = { processarMensagem };
