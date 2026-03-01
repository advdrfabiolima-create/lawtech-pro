const cron = require('node-cron');
const pool = require('../config/db');
const { enviarAlertaLeadParado, enviarEmailReativacao } = require('../services/crmEmailService');
const logger = require('../utils/logger');

async function registrarAtividade(leadId, escritorioId, tipo, descricao) {
    try {
        await pool.query(
            `INSERT INTO lead_atividades (lead_id, escritorio_id, tipo, descricao)
             VALUES ($1, $2, $3, $4)`,
            [leadId, escritorioId, tipo, descricao]
        );
    } catch (err) {
        logger.error(`[CRM Cron] Erro ao registrar atividade: ${err.message}`);
    }
}

cron.schedule('0 9 * * *', async () => {
    logger.info('🔔 [CRM] Iniciando verificação de leads parados e reativação...');
    try {
        // --- Cron 1: Alertas ao advogado (leads parados há 3+ dias) ---
        const leadsParados = await pool.query(`
            SELECT l.id, l.nome, l.status, l.escritorio_id,
                   FLOOR(EXTRACT(EPOCH FROM (NOW() - l.ultima_movimentacao)) / 86400)::int AS dias_parado
            FROM leads l
            WHERE l.ultima_movimentacao <= NOW() - INTERVAL '3 days'
              AND l.status NOT IN ('Ganho', 'Perdido', 'Arquivado')
            ORDER BY l.escritorio_id, dias_parado DESC
        `);

        const porEscritorio = {};
        for (const lead of leadsParados.rows) {
            if (!porEscritorio[lead.escritorio_id]) {
                porEscritorio[lead.escritorio_id] = [];
            }
            porEscritorio[lead.escritorio_id].push(lead);
        }

        for (const [escritorioId, leads] of Object.entries(porEscritorio)) {
            const usuariosResult = await pool.query(
                'SELECT id, nome, email FROM usuarios WHERE escritorio_id = $1 LIMIT 1',
                [escritorioId]
            );
            const usuario = usuariosResult.rows[0];
            if (!usuario?.email) continue;

            for (const lead of leads) {
                await enviarAlertaLeadParado({
                    emailAdvogado: usuario.email,
                    nomeAdvogado: usuario.nome || 'Advogado',
                    nomeLead: lead.nome,
                    diasParado: lead.dias_parado,
                    etapaAtual: lead.status
                });

                // Notificação in-app
                try {
                    await pool.query(`
                        INSERT INTO notificacoes
                            (escritorio_id, usuario_id, prazo_id, tipo, titulo, mensagem)
                        VALUES ($1, $2, NULL, 'inapp', $3, $4)
                    `, [
                        escritorioId,
                        usuario.id,
                        `⚠️ Lead parado: ${lead.nome}`,
                        `O lead ${lead.nome} está parado há ${lead.dias_parado} dia(s) na etapa ${lead.status}.`
                    ]);
                } catch (e) {
                    logger.warn(`[CRM Cron] Notificação in-app falhou: ${e.message}`);
                }
            }
        }

        // --- Cron 2: Reativação para leads inativos há 7+ dias ainda em 'Novo' ---
        const leadsReativar = await pool.query(`
            SELECT l.id, l.nome, l.email, l.assunto, l.escritorio_id
            FROM leads l
            WHERE l.ultima_movimentacao <= NOW() - INTERVAL '7 days'
              AND l.status = 'Novo'
              AND l.email IS NOT NULL
              AND l.id NOT IN (
                  SELECT lead_id FROM lead_atividades
                  WHERE tipo = 'reativacao_enviada'
                    AND criado_em > NOW() - INTERVAL '14 days'
              )
        `);

        for (const lead of leadsReativar.rows) {
            const escResult = await pool.query(
                'SELECT nome FROM escritorios WHERE id = $1',
                [lead.escritorio_id]
            );
            const nomeEscritorio = escResult.rows[0]?.nome || 'Escritório';

            const usuariosResult = await pool.query(
                'SELECT nome FROM usuarios WHERE escritorio_id = $1 LIMIT 1',
                [lead.escritorio_id]
            );
            const nomeAdvogado = usuariosResult.rows[0]?.nome || 'Advogado';

            await enviarEmailReativacao({
                nomeAdvogado,
                nomeEscritorio,
                nomeLead: lead.nome,
                emailLead: lead.email,
                areaInteresse: lead.assunto || 'questão jurídica'
            });

            await registrarAtividade(
                lead.id,
                lead.escritorio_id,
                'reativacao_enviada',
                'E-mail de reativação enviado automaticamente'
            );
        }

        logger.info(`✅ [CRM] Cron concluído: ${leadsParados.rowCount} alertas, ${leadsReativar.rowCount} reativações.`);
    } catch (error) {
        logger.error(`❌ [CRM] Erro no cron de follow-up: ${error.message}`);
    }
});

logger.info('📅 [CRM] Cron de follow-up registrado (9h diário)');
