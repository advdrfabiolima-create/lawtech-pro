/**
 * 🗑️ SCRIPT PARA DELETAR MONITORAMENTOS ERRADOS
 * 
 * Este script vai:
 * 1. Buscar sua chave API no banco
 * 2. Deletar os monitoramentos com formato errado
 * 3. Limpar o monitoramento_id do banco
 * 4. Preparar para criar novos monitoramentos corretos
 * 
 * Como usar:
 * node deletar_monitoramentos.js
 */

const axios = require('axios');
const pool = require('./src/config/db'); // ✅ Caminho corrigido

async function limparMonitoramentos() {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║  🗑️  LIMPEZA DE MONITORAMENTOS ERRADOS                   ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    
    try {
        // 1. Buscar chave API do banco
        console.log('🔍 Buscando configurações...\n');
        
        const result = await pool.query(
            'SELECT id, escavador_api_key, monitoramento_id, oab, uf FROM escritorios WHERE id = 1'
        );
        
        if (result.rowCount === 0) {
            console.error('❌ Escritório não encontrado');
            process.exit(1);
        }
        
        const escritorio = result.rows[0];
        const API_KEY = escritorio.escavador_api_key;
        
        if (!API_KEY) {
            console.error('❌ Chave API não configurada no banco');
            console.log('\nConfigure a chave API antes de executar este script.');
            process.exit(1);
        }
        
        console.log('✅ Chave API encontrada');
        console.log(`📋 Escritório ID: ${escritorio.id}`);
        console.log(`📋 OAB: ${escritorio.oab}-${escritorio.uf}`);
        console.log(`📋 Monitoramento ID atual: ${escritorio.monitoramento_id || 'Nenhum'}\n`);
        
        const authHeader = {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        };
        
        // 2. Listar todos os monitoramentos
        console.log('📊 Listando todos os monitoramentos...\n');
        
        let todosMonitoramentos = [];
        
        try {
            const listRes = await axios.get(
                'https://api.escavador.com/api/v1/monitoramentos',
                { headers: authHeader, timeout: 15000 }
            );
            
            todosMonitoramentos = listRes.data.items || [];
            
            console.log(`✅ Total de monitoramentos na conta: ${todosMonitoramentos.length}\n`);
            
            if (todosMonitoramentos.length === 0) {
                console.log('ℹ️ Nenhum monitoramento para deletar');
                process.exit(0);
            }
            
            // Mostrar todos
            console.log('┌─────────────────────────────────────────────────────────┐');
            console.log('│ MONITORAMENTOS ENCONTRADOS                              │');
            console.log('├─────────────────────────────────────────────────────────┤');
            
            todosMonitoramentos.forEach((m, i) => {
                console.log(`│ ${i+1}. ID: ${m.id}`);
                console.log(`│    Termo: ${m.termo || 'N/A'}`);
                console.log(`│    Tipo: ${m.tipo || 'N/A'}`);
                console.log(`│    Criado em: ${m.created_at || 'N/A'}`);
                console.log('│');
            });
            
            console.log('└─────────────────────────────────────────────────────────┘\n');
            
        } catch (errList) {
            console.error('❌ Erro ao listar monitoramentos:', errList.message);
            process.exit(1);
        }
        
        // 3. Identificar monitoramentos com formato errado
        const oabNumeros = escritorio.oab.replace(/\D/g, '');
        const uf = escritorio.uf;
        
        const formatoErrado = `${oabNumeros}-${uf}`;  // Ex: "51288-BA" ❌
        const formatoCerto = `${uf}-${oabNumeros}`;   // Ex: "BA-51288" ✅
        
        console.log('🔍 Identificando monitoramentos com formato errado...\n');
        console.log(`   Formato ERRADO: ${formatoErrado}`);
        console.log(`   Formato CORRETO: ${formatoCerto}\n`);
        
        const monitoramentosErrados = todosMonitoramentos.filter(m => 
            m.termo && (
                m.termo.includes(formatoErrado) ||
                m.termo.match(/^\d+-[A-Z]{2}$/) // Qualquer formato número-UF
            )
        );
        
        if (monitoramentosErrados.length === 0) {
            console.log('✅ Nenhum monitoramento com formato errado encontrado!\n');
            console.log('Todos os monitoramentos estão corretos.');
            process.exit(0);
        }
        
        console.log(`⚠️ Encontrados ${monitoramentosErrados.length} monitoramento(s) com formato errado:\n`);
        
        monitoramentosErrados.forEach((m, i) => {
            console.log(`${i+1}. ID: ${m.id} | Termo: ${m.termo}`);
        });
        
        console.log('\n🗑️ Iniciando exclusão...\n');
        
        // 4. Deletar cada monitoramento errado
        let deletados = 0;
        let erros = 0;
        
        for (const mon of monitoramentosErrados) {
            try {
                console.log(`Deletando ID ${mon.id} (${mon.termo})...`);
                
                await axios.delete(
                    `https://api.escavador.com/api/v1/monitoramentos/${mon.id}`,
                    { headers: authHeader, timeout: 10000 }
                );
                
                console.log(`   ✅ Deletado com sucesso\n`);
                deletados++;
                
                // Aguardar 1 segundo entre exclusões
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (errDel) {
                if (errDel.response?.status === 404) {
                    console.log(`   ℹ️ Já não existe (404)\n`);
                    deletados++;
                } else {
                    console.error(`   ❌ Erro: ${errDel.message}\n`);
                    erros++;
                }
            }
        }
        
        // 5. Limpar do banco de dados
        console.log('🗄️ Limpando banco de dados...\n');
        
        await pool.query('UPDATE escritorios SET monitoramento_id = NULL WHERE id = $1', [escritorio.id]);
        
        console.log('✅ Banco de dados atualizado\n');
        
        // 6. Resumo final
        console.log('╔═══════════════════════════════════════════════════════════╗');
        console.log('║  📊 RESUMO DA LIMPEZA                                     ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
        
        console.log(`✅ Monitoramentos deletados: ${deletados}`);
        console.log(`❌ Erros: ${erros}`);
        console.log(`🗄️ Banco de dados limpo: SIM\n`);
        
        console.log('╔═══════════════════════════════════════════════════════════╗');
        console.log('║  🎯 PRÓXIMOS PASSOS                                       ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
        
        console.log('1. Certifique-se de que o arquivo config_routes.js foi corrigido');
        console.log('2. Reinicie o servidor: node src/server.js');
        console.log('3. Acesse Configurações no sistema');
        console.log('4. Clique em "Salvar" para criar novo monitoramento');
        console.log('5. Aguarde 10 segundos');
        console.log('6. Vá em Publicações DJEN e clique em "Sincronizar"\n');
        
        console.log('✅ Limpeza concluída com sucesso!\n');
        
    } catch (err) {
        console.error('\n❌ ERRO CRÍTICO:', err.message);
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Dados:', err.response.data);
        }
        console.error('Stack:', err.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Executar
console.log('\n⏳ Iniciando limpeza de monitoramentos...\n');
limparMonitoramentos()
    .then(() => {
        console.log('Script finalizado.\n');
        process.exit(0);
    })
    .catch(err => {
        console.error('\nErro durante execução:', err);
        process.exit(1);
    });