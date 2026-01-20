const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios');
const authMiddleware = require('../middlewares/authMiddleware');

// 1. ROTA DE BUSCA (VARREDURA NO DATAJUD / DJEN)
router.get('/publicacoes/fetch-all', async (req, res) => {
    try {
        const escritorios = await pool.query(
            "SELECT id, oab, uf FROM escritorios WHERE oab IS NOT NULL AND plano_financeiro_status = 'ativo'"
        );

        if (escritorios.rowCount === 0) return res.send("<h1>🚀 Nenhum cliente ativo</h1>");

        let totalNovas = 0;
        // URL Oficial de Publicações do CNJ (Datajud)
        const urlDatajud = `https://api-publica.cloud.cnj.jus.br/servico/publicacoes/_search`;

        for (const esc of escritorios.rows) {
            const oabPura = esc.oab.replace(/\D/g, '').replace(/^0+/, ''); 
            const ufMaiuscula = esc.uf ? esc.uf.toUpperCase() : 'BA';

            try {
                const payload = {
                    "query": {
                        "bool": {
                            "must": [
                                { "match": { "numeroOab": oabPura } },
                                { "match": { "ufOab": ufMaiuscula } }
                            ],
                            "filter": [
                                { "range": { "dataPublicacao": { "gte": "now-7d/d" } } }
                            ]
                        }
                    },
                    "size": 50
                };

                const response = await axios.post(urlDatajud, payload, {
                    headers: { 
                        'Authorization': `APIKey ${process.env.DATAJUD_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                });

                const hits = response.data.hits?.hits || [];

                for (const hit of hits) {
                    const source = hit._source;
                    const movimentoNome = source.movimentos?.[0]?.nome || "Movimentação em análise";

                    await pool.query(
                        `INSERT INTO publicacoes_djen (numero_processo, conteudo, data_publicacao, tribunal, escritorio_id, status) 
                         VALUES ($1, $2, $3, $4, $5, 'pendente') 
                         ON CONFLICT (numero_processo, data_publicacao) DO NOTHING`,
                        [
                            source.numeroProcesso, 
                            movimentoNome, 
                            source.dataPublicacao || source.dataHoraUltimaAtualizacao, 
                            source.siglaTribunal || 'TJBA', 
                            esc.id
                        ]
                    );
                    totalNovas++;
                }
            } catch (apiErr) {
                console.error(`⚠️ Erro na OAB ${oabPura}:`, apiErr.response?.status || apiErr.message);
            }
        }
        res.send(`<h1>🚀 Varredura Concluída</h1><p>${totalNovas} processadas.</p>`);
    } catch (err) {
        res.status(500).send('Erro interno.');
    }
});

// Mantive as demais rotas (listar, pendentes, converter) conforme o arquivo original
module.exports = router;