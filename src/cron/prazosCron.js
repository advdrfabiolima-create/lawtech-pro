const cron = require('node-cron');
const pool = require('../config/db');
const axios = require('axios');

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

    console.log('🚀 Motor LawTech Pro Ativado');
};

module.exports = { iniciarAgendamentos };