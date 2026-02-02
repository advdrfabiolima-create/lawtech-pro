// consultar_valores.js
const pool = require('./src/config/db');

async function consultarValores() {
    console.log('💰 Consultando valores de assinatura...\n');
    
    try {
        // Valores por plano
        const planos = await pool.query(`
            SELECT id, nome, preco_mensal, preco_anual 
            FROM planos 
            ORDER BY id
        `);
        
        console.log('📋 TABELA PLANOS:');
        console.log('════════════════════════════════════════');
        planos.rows.forEach(p => {
            console.log(`Plano ${p.id}: ${p.nome}`);
            console.log(`   Mensal: R$ ${parseFloat(p.preco_mensal).toFixed(2)}`);
            console.log(`   Anual: R$ ${parseFloat(p.preco_anual).toFixed(2)}`);
            console.log('');
        });
        
        // Valores por escritório
        const escritorios = await pool.query(`
            SELECT 
                e.id, 
                e.nome, 
                e.valor_assinatura,
                e.plano_id,
                p.nome as plano_nome
            FROM escritorios e
            LEFT JOIN planos p ON p.id = e.plano_id
            ORDER BY e.id
            LIMIT 10
        `);
        
        console.log('🏢 ESCRITÓRIOS (valores individuais):');
        console.log('════════════════════════════════════════');
        escritorios.rows.forEach(e => {
            const valor = e.valor_assinatura 
                ? `R$ ${(e.valor_assinatura / 100).toFixed(2)}` 
                : 'Não definido';
            console.log(`${e.nome} (ID: ${e.id})`);
            console.log(`   Plano: ${e.plano_nome || 'Não definido'}`);
            console.log(`   Valor: ${valor}`);
            console.log('');
        });
        
        // Verificar se a coluna existe
        const colunas = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'escritorios' 
            AND column_name IN ('valor_assinatura', 'preco_mensal')
            ORDER BY column_name
        `);
        
        console.log('📊 ESTRUTURA DA TABELA:');
        console.log('════════════════════════════════════════');
        if (colunas.rows.length > 0) {
            colunas.rows.forEach(c => {
                console.log(`✅ Coluna: ${c.column_name} (${c.data_type})`);
            });
        } else {
            console.log('⚠️ Coluna valor_assinatura não encontrada!');
        }
        
    } catch (err) {
        console.error('❌ Erro:', err.message);
    } finally {
        await pool.end();
    }
}

consultarValores();