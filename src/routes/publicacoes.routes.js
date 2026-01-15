const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const axios = require('axios');

// Rota que o Cron Job chamará automaticamente
router.post('/publicacoes/fetch-all', async (req, res) => {
    try {
        // Busca todos os escritórios ativos no sistema
        const escritorios = await pool.query('SELECT id, oab, uf FROM escritorios WHERE oab IS NOT NULL');

        for (const esc of escritorios.rows) {
            console.log(`📡 Buscando para OAB: ${esc.oab}/${esc.uf}`);
            
            // Aqui entra a chamada para o provedor escolhido (Escavador/Digesto)
            // Exemplo genérico que o senhor só precisará colocar a Chave de API
            const response = await axios.get(`https://api.provedor.com.br/v1/oab/${esc.oab}/${esc.uf}`, {
                headers: { 'Authorization': `Bearer ${process.env.CHAVE_API_JURIDICA}` }
            });

            // Salva as publicações no banco
            for (const pub of response.data.publicacoes) {
                await pool.query(
                    `INSERT INTO publicacoes (numero_processo, conteudo, data_publicacao, tribunal, escritorio_id) 
                     VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
                    [pub.numero, pub.texto, pub.data, pub.tribunal, esc.id]
                );
            }
        }
        res.json({ status: 'Sucesso na varredura completa' });
    } catch (err) {
        console.error('Erro na varredura:', err.message);
        res.status(500).send('Erro interno');
    }
});

module.exports = router;