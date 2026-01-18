const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios');

// 1. ROTA DE BUSCA (VARREDURA NO DATAJUD)
router.get('/publicacoes/fetch-all', async (req, res) => {
    try {
        const escritorios = await pool.query(
            "SELECT id, oab, uf, nome FROM escritorios WHERE oab IS NOT NULL AND plano_financeiro_status = 'ativo'"
        );

        if (escritorios.rowCount === 0) {
            return res.send("<h1>📭 Nenhum cliente ativo encontrado</h1>");
        }

        let totalNovas = 0;

        for (const esc of escritorios.rows) {
            const oabPura = esc.oab.replace(/\D/g, '').replace(/^0+/, ''); 
            const formatosParaTestar = [oabPura, oabPura.padStart(6, '0'), `${oabPura}${esc.uf}`];
            const ufSegura = esc.uf ? esc.uf.toLowerCase() : 'ba';
            const tribunalAlias = `tj${ufSegura}`;
            const urlDatajud = `${process.env.DATAJUD_URL}/api_publica_${tribunalAlias}/_search`;

            try {
                for (const oabTeste of formatosParaTestar) {
                    const response = await axios.post(urlDatajud, {
                        "query": {
                            "bool": {
                                "must": [
                                    { "match": { "numeroOab": oabTeste } },
                                    { "match": { "ufOab": esc.uf } }
                                ]
                            }
                        },
                        "size": 50,
                        "sort": [{ "dataHoraUltimaAtualizacao": { "order": "desc" } }]
                    }, {
                        headers: { 
                            'Authorization': `APIKey ${process.env.DATAJUD_API_KEY}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    const hits = response.data.hits?.hits || [];
                    
                    if (hits.length > 0) {
                        for (const hit of hits) {
                            const source = hit._source;
const movimentoNome = source.movimentos?.[0]?.nome || "Movimentação em análise";

// 🚀 BLOCO REVISADO: Sem colunas inexistentes (como 'status' ou 'oab')
await pool.query(
    `INSERT INTO publicacoes_djen (numero_processo, conteudo, data_publicacao, tribunal, escritorio_id) 
     VALUES ($1, $2, $3, $4, $5) 
     ON CONFLICT (numero_processo, data_publicacao) DO NOTHING`,
    [
        source.numeroProcesso, 
        movimentoNome, 
        source.dataHoraUltimaAtualizacao, 
        source.siglaTribunal || 'TJBA', 
        esc.id
    ]
);
                        }
                        totalNovas += hits.length;
                        break; 
                    }
                }
            } catch (apiErr) {
                console.error(`⚠️ Erro tribunal ${tribunalAlias}: ${apiErr.message}`);
            }
        }
        res.send(`<h1>🚀 Varredura Concluída</h1><p>${totalNovas} movimentações processadas.</p><a href="/api/publicacoes/listar">Ver Painel</a>`);

    } catch (err) {
        console.error('❌ Erro no servidor:', err.message);
        res.status(500).send('Erro interno no servidor.');
    }
});

// 2. ROTA DE LISTAGEM (O QUE APARECE NA TELA)
router.get('/publicacoes/listar', async (req, res) => {
    try {
        // 🚀 CORREÇÃO AQUI: Lê da tabela correta 'publicacoes_djen'
        const resultado = await pool.query(`
            SELECT numero_processo, conteudo, data_publicacao, tribunal
            FROM publicacoes_djen
            ORDER BY data_publicacao DESC LIMIT 50
        `);

        if (resultado.rows.length === 0) return res.send('<h1>📭 Sem movimentações recentes.</h1>');

        let html = `
            <style>
                table { width: 100%; border-collapse: collapse; font-family: sans-serif; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                th { background-color: #2c3e50; color: white; }
                tr:nth-child(even) { background-color: #f9f9f9; }
                .urgente { background-color: #ffcccc !important; color: #b30000; font-weight: bold; }
                .alerta { background-color: #fff4cc !important; color: #856404; font-weight: bold; }
            </style>
            <h1>📄 Painel de Controle Premium</h1>
            <table>
                <tr><th>Processo</th><th>Tribunal</th><th>Último Movimento</th><th>Data</th></tr>
        `;
        
        resultado.rows.forEach(pub => {
            const cont = (pub.conteudo || "").toLowerCase();
            let classe = (cont.includes('sentença') || cont.includes('acordo') || cont.includes('julgado')) ? 'urgente' : 
                         (cont.includes('decisão') || cont.includes('despacho') || cont.includes('intimação')) ? 'alerta' : '';
            
            html += `<tr class="${classe}">
                <td><strong>${pub.numero_processo}</strong></td>
                <td>${pub.tribunal}</td>
                <td>${pub.conteudo}</td>
                <td>${new Date(pub.data_publicacao).toLocaleDateString('pt-BR')}</td>
            </tr>`;
        });
        res.send(html + '</table>');
        } catch (err) { 
        console.error(err);
        res.status(500).send('Erro ao listar.'); 
        }
});
        // ROTA PARA O FRONTEND (Envia apenas os dados, sem o HTML da tabela)
router.get('/publicacoes-pendentes', async (req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT id, numero_processo, conteudo, data_publicacao, tribunal
            FROM publicacoes_djen
            ORDER BY data_publicacao DESC LIMIT 50
        `); // 🚀 REMOVI A COLUNA STATUS DAQUI
        res.json(resultado.rows);
    } catch (err) {
        console.error("ERRO NA ROTA DJEN:", err.message);
        res.status(500).json({ erro: err.message });
    }
});
module.exports = router;