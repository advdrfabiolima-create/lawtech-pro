const cron = require('node-cron');
const pool = require('../config/db');
const { buscarPublicacoesDJEN } = require('../scrapers/djen_scraper');

// Rodar todo dia às 8h
cron.schedule('0 8 * * *', async () => {
    console.log('\n🤖 [CRON DJEN] Sincronização automática iniciada...');
    
    try {
        // Buscar todos escritórios ativos
        const result = await pool.query(`
            SELECT id, oab, uf, advogado_responsavel
            FROM escritorios
            WHERE plano_financeiro_status IN ('ativo', 'trial')
            AND oab IS NOT NULL
        `);
        
        console.log(`📊 Escritórios ativos: ${result.rowCount}`);
        
        for (const esc of result.rows) {
            try {
                console.log(`\n📋 Sincronizando: ${esc.advogado_responsavel}`);
                
                const resultado = await buscarPublicacoesDJEN(
                    esc.oab,
                    esc.uf,
                    esc.id
                );
                
                if (resultado.ok) {
                    console.log(`✅ ${resultado.novas} novas publicações`);
                } else {
                    console.log(`❌ Erro: ${resultado.erro}`);
                }
                
                // Aguardar 10s entre cada escritório (não sobrecarregar)
                await new Promise(r => setTimeout(r, 10000));
                
            } catch (errEsc) {
                console.error(`❌ Erro escritório ${esc.id}:`, errEsc.message);
            }
        }
        
        console.log('\n✅ [CRON DJEN] Sincronização automática concluída!');
        
    } catch (err) {
        console.error('❌ [CRON DJEN] Erro geral:', err.message);
    }
});

console.log('✅ Cron job DJEN ativado (diariamente às 8h)');

module.exports = {};