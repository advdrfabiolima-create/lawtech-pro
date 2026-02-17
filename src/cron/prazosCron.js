const cron = require('node-cron');
const pool = require('../config/db');
const axios = require('axios');
const { enviarAlertaPrazo } = require('../services/emailService');

/**
 * Motor de Agendamentos LawTech Pro - ESCAVADOR MONITORAMENTO
 * Fábio Lima da Silva - OAB/BA 51.288
 */
const iniciarAgendamentos = () => {
    
    // --- TAREFA 1: ATUALIZAR STATUS DE PRAZOS (A cada 30 min) ---
    cron.schedule('*/5 8-20 * * 1-5', async () => {   // seg-sex, 8h às 20h
        try {
            await pool.query(`
            UPDATE prazos 
            SET status = 'atrasado' 
            WHERE data_limite < CURRENT_DATE 
            AND status = 'aberto'
        `);
        } catch (error) {
            console.error('❌ Erro no cron de prazos:', error.message);
        }
    });

    // --- TAREFA 3: VERIFICAR EXPIRAÇÃO DO TRIAL ---
cron.schedule('0 0 * * *', async () => {  // Todo dia à meia-noite
    try {
        console.log('🔒 Verificando trials expirados...');
        
        await pool.query(`
            UPDATE escritorios 
            SET plano_financeiro_status = 'trial_expirado'
            WHERE trial_expira_em < CURRENT_DATE 
            AND plano_financeiro_status = 'ativo'
        `);
        
        console.log('✅ Verificação de trials concluída.');
    } catch (error) {
        console.error('❌ Erro ao verificar trials:', error.message);
    }
});

    // --- TAREFA 2: VARREDURA AUTOMÁTICA NO ESCAVADOR (Monitoramentos) ---
    // Agendado para as 07:00 e 19:00 (Início e fim do expediente)
    cron.schedule('0 7,19 * * *', async () => {
        console.log(`⏰ [CRON] Iniciando coleta de monitoramentos no Escavador...`);
        
        try {
            // Busca dados do escritório master
            const escritorio = await pool.query('SELECT id, oab, uf FROM escritorios WHERE id = 1');
            const esc = escritorio.rows[0];

            if (!esc || !esc.oab) return;

            const termoBusca = `${esc.oab}${esc.uf}`;
            const authHeader = { 'Authorization': `Bearer ${process.env.ESCAVADOR_API_KEY}` };

            // 1. Lista monitoramentos para encontrar o ID do seu termo (OAB)
            const listRes = await axios.get('https://api.escavador.com/v1/monitoramentos', { headers: authHeader });
            const monitoramento = listRes.data.items?.find(m => m.termo === termoBusca);

            if (!monitoramento) {
                console.log(`⚠️ Monitoramento para ${termoBusca} não encontrado. Criando agora...`);
                await axios.post('https://api.escavador.com/v1/monitoramentos', 
                    { tipo: "termo", termo: termoBusca }, 
                    { headers: authHeader }
                );
                return;
            }

            // 2. Busca os novos "cards" (publicações/movimentações) do monitoramento
            const cardsRes = await axios.get(`https://api.escavador.com/v1/monitoramentos/${monitoramento.id}/cards`, { 
                headers: authHeader 
            });

            const itens = cardsRes.data.items || [];

    // Substitua o loop for atual por este para maior segurança
    for (const item of itens) {
    const regexProcesso = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;
    const match = item.conteudo.match(regexProcesso);
    const numeroProcesso = match ? match[0] : "Verificar no texto";

    // Usamos a View que criamos para garantir compatibilidade
    const query = `
        INSERT INTO publicacoes (numero_processo, conteudo, data_publicacao, tribunal, escritorio_id, status)
        VALUES ($1, $2, $3, $4, $5, 'pendente')
        ON CONFLICT DO NOTHING
    `;
    
    const values = [
        numeroProcesso, 
        item.conteudo, 
        item.data_publicacao || new Date(), // Evita erro se a data vier nula
        item.diario ? item.diario.sigla : 'DJEN', 
        esc.id
    ];

    await pool.query(query, values);
}

            console.log(`✅ Cron Escavador finalizado: ${itens.length} cards processados.`);

        } catch (error) {
            console.error(`❌ Erro no monitoramento automático:`, error.response?.data || error.message);
        }
    });

    // --- TAREFA 4: ALERTAS INTELIGENTES DE PRAZOS (8h, seg-sex) ---
    cron.schedule('0 8 * * 1-5', async () => {
        console.log('🔔 [ALERTAS] Iniciando verificação de prazos...');
        try {
            // Buscar todos os escritórios com config (ou usar defaults)
            const escritorios = await pool.query('SELECT DISTINCT escritorio_id FROM usuarios');

            for (const row of escritorios.rows) {
                const escId = row.escritorio_id;

                // Buscar config de alertas (ou defaults)
                const cfgResult = await pool.query('SELECT * FROM config_alertas WHERE escritorio_id = $1', [escId]);
                const cfg = cfgResult.rows[0] || { dias_alerta_1: 7, dias_alerta_2: 3, dias_alerta_3: 1, email_ativo: true, inapp_ativo: true };

                const diasArray = [cfg.dias_alerta_1, cfg.dias_alerta_2, cfg.dias_alerta_3].filter(d => d != null);

                // Buscar prazos que vencem nos dias configurados OU estão atrasados
                const prazosResult = await pool.query(`
                    SELECT p.id, p.tipo, p.descricao, p.data_limite, p.status,
                           pr.numero AS processo, c.nome AS cliente,
                           (p.data_limite::date - CURRENT_DATE) as dias_restantes
                    FROM prazos p
                    LEFT JOIN processos pr ON p.processo_id = pr.id
                    LEFT JOIN clientes c ON p.cliente_id = c.id
                    WHERE p.escritorio_id = $1
                      AND p.status NOT IN ('concluido', 'deletado')
                      AND (p.deletado IS NULL OR p.deletado = false)
                      AND (
                          (p.data_limite::date - CURRENT_DATE) = ANY($2::int[])
                          OR (p.data_limite::date < CURRENT_DATE AND p.status = 'atrasado')
                      )
                `, [escId, diasArray]);

                if (prazosResult.rowCount === 0) continue;

                // Buscar escritório nome
                const escNome = await pool.query('SELECT nome FROM escritorios WHERE id = $1', [escId]);
                const escritorioNome = escNome.rows[0]?.nome || 'Escritório';

                // Buscar usuários do escritório
                const usuarios = await pool.query('SELECT id, email FROM usuarios WHERE escritorio_id = $1', [escId]);

                for (const prazo of prazosResult.rows) {
                    for (const usuario of usuarios.rows) {
                        // Verificar se já notificou esse prazo hoje para esse usuário
                        const jaNotificou = await pool.query(`
                            SELECT id FROM notificacoes
                            WHERE prazo_id = $1 AND usuario_id = $2 AND enviada_em::date = CURRENT_DATE
                        `, [prazo.id, usuario.id]);

                        if (jaNotificou.rowCount > 0) continue;

                        const diasRest = parseInt(prazo.dias_restantes);
                        const textoUrgencia = diasRest < 0
                            ? `ATRASADO há ${Math.abs(diasRest)} dia(s)`
                            : diasRest === 0 ? 'VENCE HOJE'
                            : `Vence em ${diasRest} dia(s)`;

                        const titulo = `⚖️ ${textoUrgencia} — ${prazo.tipo || 'Prazo'}`;
                        const mensagem = `${prazo.tipo || 'Prazo'} ${prazo.processo ? '(' + prazo.processo + ')' : ''} - ${prazo.cliente || 'Sem cliente'} - ${textoUrgencia}`;

                        // Notificação in-app
                        if (cfg.inapp_ativo !== false) {
                            await pool.query(`
                                INSERT INTO notificacoes (escritorio_id, usuario_id, prazo_id, tipo, titulo, mensagem)
                                VALUES ($1, $2, $3, 'inapp', $4, $5)
                            `, [escId, usuario.id, prazo.id, titulo, mensagem]);
                        }

                        // E-mail
                        if (cfg.email_ativo !== false) {
                            await enviarAlertaPrazo(usuario.email, {
                                escritorio_nome: escritorioNome,
                                tipo: prazo.tipo,
                                processo: prazo.processo,
                                cliente: prazo.cliente,
                                data_limite: prazo.data_limite,
                                dias_restantes: diasRest,
                                prazo_id: prazo.id
                            });
                        }
                    }
                }
            }

            console.log('✅ [ALERTAS] Verificação de prazos concluída.');
        } catch (error) {
            console.error('❌ [ALERTAS] Erro:', error.message);
        }
    });

    console.log('🚀 Motor LawTech Pro Ativado');
};

module.exports = { iniciarAgendamentos };