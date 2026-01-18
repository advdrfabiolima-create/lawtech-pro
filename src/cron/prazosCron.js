const cron = require('node-cron');
const pool = require('../config/db');
const axios = require('axios');

/**
 * Motor de Agendamentos LawTech Pro - OTIMIZADO
 * Fábio Lima da Silva - OAB/BA 51.288
 */
const iniciarAgendamentos = () => {
    
    // --- TAREFA 1: VERIFICAR PRAZOS VENCIDOS (A cada 30 min para não travar o servidor) ---
    cron.schedule('*/30 * * * *', async () => {
        console.log('⏰ [SISTEMA] Verificando prazos e alertas...');
        try {
            // Atualiza status de prazos vencidos
            await pool.query(`
                UPDATE prazos 
                SET status = 'vencido' 
                WHERE status = 'aberto' AND data_limite < NOW()
            `);
        } catch (error) {
            console.error('❌ Erro no cron de prazos:', error.message);
        }
    });

    // --- TAREFA 2: BUSCA REAL DE PUBLICAÇÕES (Datajud / DJEN) ---
    // Agendado para 03:00 e 12:00
    cron.schedule('0 3,12 * * *', async () => {
        console.log(`⏰ [CRON] Iniciando busca real de publicações...`);
        
        try {
            // Busca dados do Dr. Fábio (escritorio_id: 1)
            const escritorio = await pool.query('SELECT id, oab, uf FROM escritorios WHERE id = 1');
            const esc = escritorio.rows[0];

            if (!esc || !esc.oab) return;

            console.log(`📡 Consultando Datajud para OAB: ${esc.oab}/${esc.uf}`);

            // Rota para o tribunal BA (Datajud)
            const urlDatajud = `${process.env.DATAJUD_URL}/api_publica_tjba/_search`;

            const response = await axios.post(urlDatajud, {
                "query": {
                    "bool": {
                        "must": [
                            { "match": { "numeroOab": esc.oab.replace(/\D/g, '') } },
                            { "match": { "ufOab": esc.uf } }
                        ]
                    }
                },
                "size": 20,
                "sort": [{ "dataHoraUltimaAtualizacao": { "order": "desc" } }]
            }, {
                headers: { 
                    'Authorization': `APIKey ${process.env.DATAJUD_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            const hits = response.data.hits?.hits || [];

            for (const hit of hits) {
                const source = hit._source;
                const movimento = source.movimentos?.[0]?.nome || "Movimentação identificada";

                // SALVA NA TABELA CORRETA 'publicacoes_djen'
                await pool.query(`
                    INSERT INTO publicacoes_djen (numero_processo, conteudo, data_publicacao, tribunal, escritorio_id)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT DO NOTHING
                `, [source.numeroProcesso, movimento, source.dataHoraUltimaAtualizacao, 'TJBA', esc.id]);
            }

            console.log(`✅ Busca finalizada. ${hits.length} itens processados.`);

        } catch (error) {
            console.error(`❌ Erro na busca de publicações:`, error.message);
        }
    });

    console.log('✅ Sistema de Agendamentos Ativado (Dr. Fábio - OAB/BA 51.288)');
};

module.exports = { iniciarAgendamentos };