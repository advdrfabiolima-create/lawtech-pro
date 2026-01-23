const axios = require('axios');
const pool = require('../config/db');

/**
 * 1. OBTER MÉTRICAS DO FUNIL
 * Contagem robusta para os 4 cards do pipeline:
 * leads    → Novos Leads
 * reuniao  → Em Triagem
 * proposta → Propostas
 * ganho    → Ganhos
 */
async function obterMetricasFunil(req, res) {
    try {
        const escritorioId = req.user.escritorio_id;

        const query = `
            SELECT status, COUNT(*) as total 
            FROM leads 
            WHERE escritorio_id = $1 
              AND status IS NOT NULL
              AND LOWER(status) NOT IN ('perdido', 'arquivado', 'excluido', 'cancelado', 'recusado')
            GROUP BY status
        `;

        const result = await pool.query(query, [escritorioId]);

        const stats = {
            leads: 0,
            reuniao: 0,
            proposta: 0,
            ganho: 0
        };

        result.rows.forEach(row => {
    const statusRaw = (row.status || '').trim();
    const status = statusRaw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // remove acentos
    const count = parseInt(row.total, 10) || 0;

    // Leads
    if (status.includes('novo') || status.includes('lead') || status.includes('pista') || statusRaw === 'Novo') {
        stats.leads += count;
    } 
    // Triagem / Reunião
    else if (status.includes('reuniao') || status.includes('reunio') || status.includes('triagem') || statusRaw.includes('Reunião') || statusRaw.includes('Triagem')) {
        stats.reuniao += count;
    } 
    // Proposta
    else if (status.includes('proposta') || status.includes('propost') || statusRaw.includes('Proposta') || statusRaw.includes('Propostas')) {
        stats.proposta += count;
    } 
    // GANHO - agora inclui "ganhar" explicitamente
    else if (
        status.includes('ganho') ||
        status.includes('ganhar') ||          // ← ESSENCIAL PARA O SEU CASO
        status.includes('ganhho') ||
        status.includes('ganhos') ||
        status.includes('contrato') ||
        status.includes('fechado') ||
        statusRaw.includes('Ganho') ||
        statusRaw.includes('Ganhar') ||
        statusRaw.includes('GANHAR') ||
        statusRaw.includes('GANHO')
    ) {
        stats.ganho += count;
        console.log(`[DEBUG] Mapeado como GANHO: status="${statusRaw}" → count=${count}`); // Log para confirmar
    }

    // Log geral para debug
    console.log(`[DEBUG] Status processado: "${statusRaw}" (normalizado: "${status}") → count=${count}`);
});

/* As outras funções permanecem iguais, mas corrigi pequenos detalhes de robustez */

async function listarLeads(req, res) {
    try {
        const escritorioId = req.user.escritorio_id;
        const result = await pool.query(
            'SELECT * FROM leads WHERE escritorio_id = $1 ORDER BY criado_em DESC',
            [escritorioId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao listar leads:', error.message);
        res.status(500).json({ erro: 'Erro ao buscar lista de leads' });
    }
}

async function criarLeadPublico(req, res) {
    const { nome, email, telefone } = req.body;
    const MEU_ESCRITORIO_ID = 1;

    try {
        const query = `
            INSERT INTO leads (nome, email, telefone, origem, status, escritorio_id)
            VALUES ($1, $2, $3, 'Landing Page', 'novo', $4)
            RETURNING id
        `;
        await pool.query(query, [nome, email, telefone, MEU_ESCRITORIO_ID]);

        if (process.env.BREVO_API_KEY) {
            try {
                await axios.post('https://api.brevo.com/v3/smtp/email', {
                    sender: { name: 'LawTech Pro', email: process.env.BREVO_SENDER },
                    to: [{ email: process.env.ALERTA_EMAIL_DESTINO }],
                    subject: '🚀 Novo Lead na Landing Page',
                    htmlContent: `
                        <h2>Novo Contato Recebido</h2>
                        <p><strong>Nome:</strong> ${nome}</p>
                        <p><strong>E-mail:</strong> ${email || '—'}</p>
                        <p><strong>WhatsApp:</strong> ${telefone || '—'}</p>
                    `
                }, { headers: { 'api-key': process.env.BREVO_API_KEY } });
            } catch (mailErr) {
                console.warn("E-mail de alerta falhou:", mailErr.message);
            }
        }

        res.status(201).json({ ok: true, mensagem: 'Lead captado!' });
    } catch (error) {
        console.error('Erro ao criar lead público:', error.message);
        res.status(500).json({ erro: 'Falha ao processar lead' });
    }
}

async function atualizarStatusLead(req, res) {
    const { id } = req.params;
    let { status } = req.body;
    const escritorioId = req.user.escritorio_id;

    try {
        // Normaliza para o padrão mais comum no seu banco
        const statusMap = {
            'lead': 'Novo',
            'triagem': 'Reunião',
            'proposta': 'Proposta',
            'ganho': 'Ganho'
        };
        const statusFinal = statusMap[status.toLowerCase()] || status.trim();

        const result = await pool.query(
            'UPDATE leads SET status = $1 WHERE id = $2 AND escritorio_id = $3 RETURNING id',
            [statusFinal, id, escritorioId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ erro: 'Lead não encontrado ou sem permissão' });
        }

        res.json({ ok: true, status: statusFinal });
    } catch (err) {
        console.error('Erro ao atualizar status:', err.message);
        res.status(500).json({ erro: 'Erro ao mover lead' });
    }
}

module.exports = { 
    obterMetricasFunil, 
    listarLeads, 
    criarLeadPublico, 
    atualizarStatusLead 
};