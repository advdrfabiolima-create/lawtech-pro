const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios');
const authMiddleware = require('../middlewares/authMiddleware');

/**
 * 📡 ROTA DE SINCRONIZAÇÃO INTELIGENTE (SAAS READY)
 * Objetivo: Monitorar o DJEN e auto-provisionar novos clientes
 */
router.get('/publicacoes/fetch-all', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const authHeader = { 
            'Authorization': `Bearer ${process.env.ESCAVADOR_API_KEY}`,
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/json'
        };

        // 1. BUSCA DADOS DO ESCRITÓRIO E SE JÁ TEM MONITORAMENTO
        const escRes = await pool.query(
            "SELECT oab, documento, advogado_responsavel, monitoramento_id FROM escritorios WHERE id = $1", 
            [escritorioId]
        );

        if (escRes.rowCount === 0) return res.status(404).json({ ok: false, mensagem: "Escritório não encontrado." });

        const { oab, documento, advogado_responsavel } = escRes.rows[0];
        let monitoramento_id = escRes.rows[0].monitoramento_id;

        console.log("\n--------------------------------------------------");
        console.log(`📡 [RADAR] Iniciando operação para: ${advogado_responsavel}`);

        // 2. AUTO-PROVISIONAMENTO: Se não tem ID, cria agora no Escavador
        if (!monitoramento_id) {
    console.log(`🆕 [SAAS] Criando novo monitoramento para OAB: ${oab}`);
    try {
const createRes = await axios.post('https://api.escavador.com/api/v1/monitoramentos', {
    tipo: 'termo',
    termo: oab, 
    frequencia: 'diaria',
    // 🚀 ESTES CAMPOS SÃO OBRIGATÓRIOS PARA EVITAR O ERRO DO TERMINAL:
    monitorar_todos_diarios: true, 
    monitorar_tribunais: true,
    origens_ids: [1] // 1 geralmente representa o DJEN nacional
}, { headers: authHeader });

        monitoramento_id = createRes.data.id;

        await pool.query("UPDATE escritorios SET monitoramento_id = $1 WHERE id = $2", [monitoramento_id, escritorioId]);
        
        console.log(`✅ [SAAS] Monitoramento ID ${monitoramento_id} criado.`);
        return res.json({ ok: true, mensagem: "Radar ativado com sucesso!" });

    } catch (errCreate) {
        // Agora o erro detalhado aparecerá aqui se algo falhar
        console.error("❌ Detalhes do erro no Escavador:", errCreate.response?.data?.errors || errCreate.message);
        return res.status(500).json({ ok: false, erro: "Erro ao configurar os diários de monitoramento." });
    }
}

        // 3. BUSCA AS APARIÇÕES NO MONITORAMENTO EXISTENTE
        console.log(`🔎 [RADAR] Consultando Monitoramento ID: ${monitoramento_id}`);
        const aparicoesRes = await axios.get(`https://api.escavador.com/api/v1/monitoramentos/${monitoramento_id}/aparicoes`, { headers: authHeader });
        const itens = aparicoesRes.data.items || [];
        
        console.log(`📊 [RADAR] ${itens.length} publicações encontradas no Escavador.`);

        let totalNovas = 0;

        // 4. LOOP DE INSERÇÃO NO BANCO
        for (const item of itens) {
            const conteudoPub = item.conteudo || item.resumo; 
            if (!conteudoPub) continue;

            const numeroProcesso = item.numero_processo || '0000000-00.0000.0.00.0000';

            const result = await pool.query(
                `INSERT INTO publicacoes_djen (numero_processo, conteudo, data_publicacao, tribunal, escritorio_id, status) 
                 VALUES ($1, $2, $3, $4, $5, 'pendente') 
                 ON CONFLICT (numero_processo, data_publicacao) DO NOTHING`,
                [numeroProcesso, conteudoPub, item.data_publicacao, item.diario?.sigla || 'DJEN', escritorioId]
            );

            if (result.rowCount > 0) {
                totalNovas++;
                console.log(`🔔 [NOVA!] Processo: ${numeroProcesso}`);
            }
        }

        console.log(`🚀 [RADAR] Finalizado. Novas importadas: ${totalNovas}`);
        console.log("--------------------------------------------------\n");

        res.json({ ok: true, novas: totalNovas });

    } catch (err) {
        console.error("⚠️ [RADAR ERROR]:", err.response?.data || err.message);
        res.status(500).json({ ok: false, erro: "Erro na sincronização." });
    }
});
// Rota que o seu Frontend (publicacoes.html) está tentando acessar
router.get('/publicacoes-pendentes', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        
        // 🚀 IMPORTANTE: Verifique se o nome da tabela no seu banco é 'publicacoes_djen'
        const query = `
            SELECT * FROM publicacoes_djen 
            WHERE escritorio_id = $1 AND status = 'pendente' 
            ORDER BY data_publicacao DESC`;

        const result = await pool.query(query, [escritorioId]);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao buscar publicações:", err.message);
        res.status(500).json({ erro: "Erro ao carregar publicações do banco." });
    }
});
module.exports = router;