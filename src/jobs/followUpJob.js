/**
 * followUpJob.js — Follow-up automático via WhatsApp (por escritório)
 *
 * INSTALAÇÃO:  npm install node-cron
 * ATIVAÇÃO:    No server.js, adicione: require('./jobs/followUpJob');
 */
const cron   = require('node-cron');
const pool   = require('../config/db');
const zap    = require('../services/zapService');
const logger = require('../utils/logger');

async function executarFollowUp() {
    logger.info('[FOLLOWUP] Iniciando job...');
    let enviados = 0, erros = 0;

    try {
        // Busca leads ativos parados, agrupados por escritório
        // JOIN com escritorios para pegar as credenciais e dias configurados
        const result = await pool.query(`
            SELECT
                l.id,
                l.nome,
                l.telefone,
                l.status,
                l.assunto,
                l.escritorio_id,
                COALESCE(u.nome, 'Dr./Dra.')   AS nome_advogado,
                COALESCE(e.nome, 'Escritório')  AS nome_escritorio,
                COALESCE(e.zapi_followup_dias_lead,     3) AS dias_lead,
                COALESCE(e.zapi_followup_dias_triagem,  5) AS dias_triagem,
                COALESCE(e.zapi_followup_dias_proposta, 4) AS dias_proposta,
                EXTRACT(DAY FROM NOW() - COALESCE(l.ultima_movimentacao, l.data_criacao)) AS dias_parado
            FROM leads l
            JOIN escritorios e ON e.id = l.escritorio_id
            LEFT JOIN usuarios u ON u.escritorio_id = l.escritorio_id
            WHERE l.status IN ('Novo', 'Reunião', 'Reuniao', 'Proposta')
              AND l.telefone IS NOT NULL AND l.telefone != ''
              AND e.zapi_instance_id IS NOT NULL
              AND (l.ultimo_followup_em IS NULL OR l.ultimo_followup_em < NOW() - INTERVAL '20 hours')
        `);

        for (const lead of result.rows) {
            const diasParado = parseInt(lead.dias_parado, 10) || 0;
            const statusNorm = lead.status.includes('Reuni') ? 'Reunião' : lead.status;
            const limiar = statusNorm === 'Reunião' ? lead.dias_triagem
                         : statusNorm === 'Proposta' ? lead.dias_proposta
                         : lead.dias_lead;

            if (diasParado < limiar) continue;

            const mensagem = zap.msgFollowUp(lead.nome, diasParado, lead.assunto, lead.nome_escritorio);
            const ok = await zap.enviarMensagem(lead.escritorio_id, lead.telefone, mensagem);

            if (ok) {
                enviados++;
                await pool.query(`UPDATE leads SET ultimo_followup_em = NOW() WHERE id = $1`, [lead.id]);
                await pool.query(
                    `INSERT INTO lead_atividades (lead_id, escritorio_id, tipo, descricao) VALUES ($1, $2, 'followup_enviado', $3)`,
                    [lead.id, lead.escritorio_id, `Follow-up automático enviado (${diasParado} dias sem movimentação)`]
                );
                logger.info({ leadId: lead.id, diasParado }, '[FOLLOWUP] Enviado');
            } else {
                erros++;
            }
            await new Promise(r => setTimeout(r, 1500));
        }
        logger.info({ enviados, erros }, '[FOLLOWUP] Concluído');
    } catch (err) {
        logger.error({ err: err.message }, '[FOLLOWUP] Erro crítico');
    }
}

// Roda dias úteis às 9h (horário de Brasília)
cron.schedule('0 12 * * 1-5', () => {
    logger.info('[FOLLOWUP] Cron disparado');
    executarFollowUp();
}, { timezone: 'America/Sao_Paulo' });

module.exports = { executarFollowUp };