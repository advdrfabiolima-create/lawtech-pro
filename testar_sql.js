// testar_sql.js
const pool = require('./src/config/db');

async function testar() {
    console.log('🔍 Testando banco de dados...\n');
    
    try {
        // Teste de conexão
        const result = await pool.query('SELECT NOW() as data_atual');
        console.log('✅ Conexão OK!');
        console.log('📅 Data:', result.rows[0].data_atual);
        console.log('');

        // Verificar tabelas
        const tabelas = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            AND table_name IN ('cartoes', 'transacoes', 'escritorios')
            ORDER BY table_name
        `);
        
        const nomes = tabelas.rows.map(r => r.table_name);
        console.log('📋 Tabelas:', nomes.join(', '));
        console.log('');
        
        // Verificar tabelas de pagamento
        const temCartoes = nomes.includes('cartoes');
        const temTransacoes = nomes.includes('transacoes');
        
        if (temCartoes && temTransacoes) {
            console.log('✅ Tabelas de pagamento OK!');
            
            const countCartoes = await pool.query('SELECT COUNT(*) FROM cartoes');
            const countTransacoes = await pool.query('SELECT COUNT(*) FROM transacoes');
            
            console.log(`   Cartões: ${countCartoes.rows[0].count}`);
            console.log(`   Transações: ${countTransacoes.rows[0].count}`);
            console.log('');
            
            const trials = await pool.query(`
                SELECT id, nome, trial_expira_em 
                FROM escritorios 
                WHERE plano_financeiro_status = 'trial'
                LIMIT 3
            `);
            
            if (trials.rows.length > 0) {
                console.log(`📋 Trials: ${trials.rows.length}`);
                trials.rows.forEach(e => {
                    console.log(`   - ${e.nome} (expira: ${e.trial_expira_em})`);
                });
            }
            
            console.log('\n✅ Sistema pronto!');
            
        } else {
            console.log('❌ Tabelas NÃO existem!');
            console.log('\n💡 Execute o SQL:');
            console.log('   https://console.neon.tech → SQL Editor');
            console.log('   Cole: setup_pagamentos_SIMPLES.sql');
        }
        
    } catch (err) {
        console.error('❌ Erro:', err.message);
    } finally {
        await pool.end();
    }
}

testar();