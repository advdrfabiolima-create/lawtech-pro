const axios = require('axios');
const pool = require('../config/db');

/**
 * 1. OBTER MÉTRICAS DO FUNIL
 * Agrupa os leads por status para exibir os totais no Dashboard/CRM
 */
async function obterMetricasFunil(req, res) {
    try {
        const escritorioId = req.user.escritorio_id;
        
        const query = `
            SELECT status, COUNT(*) as total 
            FROM leads 
            WHERE escritorio_id = $1 
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
            if (row.status === 'Novo') stats.leads = parseInt(row.total);
            if (row.status === 'Reunião') stats.reuniao = parseInt(row.total);
            if (row.status === 'Proposta') stats.proposta = parseInt(row.total);
            if (row.status === 'Ganho') stats.ganho = parseInt(row.total);
        });

        res.json(stats);
    } catch (error) {
        console.error('Erro CRM Metricas:', error.message);
        res.status(500).json({ erro: 'Erro ao carregar métricas do CRM' });
    }
}

/**
 * 2. LISTAR LEADS
 * Busca todos os leads do escritório logado
 */
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

/**
 * 3. CRIAR LEAD PÚBLICO
 * Rota usada pela Landing Page (index.html) para captar novos clientes
 */
async function criarLeadPublico(req, res) {
    const { nome, email, telefone } = req.body;
    // Vincula o lead ao seu escritório principal (ID 1)
    const MEU_ESCRITORIO_ID = 1; 

    try {
        const query = `
            INSERT INTO leads (nome, email, telefone, origem, status, escritorio_id)
            VALUES ($1, $2, $3, 'Landing Page', 'Novo', $4)
            RETURNING id
        `;
        await pool.query(query, [nome, email, telefone, MEU_ESCRITORIO_ID]);

        // Dispara E-mail de Alerta via Brevo (se configurado no .env)
        if (process.env.BREVO_API_KEY) {
            try {
                await axios.post('https://api.brevo.com/v3/smtp/email', {
                    sender: { name: 'LawTech Pro', email: process.env.BREVO_SENDER },
                    to: [{ email: process.env.ALERTA_EMAIL_DESTINO }],
                    subject: '🚀 Novo Lead na Landing Page',
                    htmlContent: `
                        <h2>Novo Contato Recebido</h2>
                        <p><strong>Nome:</strong> ${nome}</p>
                        <p><strong>E-mail:</strong> ${email}</p>
                        <p><strong>WhatsApp:</strong> ${telefone}</p>
                    `
                }, {
                    headers: { 'api-key': process.env.BREVO_API_KEY }
                });
            } catch (mailErr) {
                console.warn("Aviso: Lead salvo, mas e-mail não enviado:", mailErr.message);
            }
        }

        res.status(201).json({ ok: true, mensagem: 'Mensagem enviada com sucesso!' });
    } catch (error) {
        console.error('Erro ao captar lead:', error.message);
        res.status(500).json({ erro: 'Falha ao processar contato.' });
    }
}

/**
 * 4. ATUALIZAR STATUS DO LEAD
 * Altera a fase do lead no funil (Mover entre colunas)
 */
async function atualizarStatusLead(req, res) {
    const { id } = req.params;
    const { status } = req.body;
    const escritorioId = req.user.escritorio_id;

    try {
        const result = await pool.query(
            'UPDATE leads SET status = $1 WHERE id = $2 AND escritorio_id = $3',
            [status, id, escritorioId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ erro: 'Lead não encontrado ou sem permissão.' });
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('Erro ao atualizar status do lead:', err.message);
        res.status(500).json({ erro: 'Erro interno ao atualizar status' });
    }
}

// Exportação unificada das funções
module.exports = { 
    obterMetricasFunil, 
    listarLeads, 
    criarLeadPublico, 
    atualizarStatusLead 
};