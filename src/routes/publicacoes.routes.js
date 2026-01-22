const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios');
const authMiddleware = require('../middlewares/authMiddleware');

/**
 * 📡 ROTA DE SINCRONIZAÇÃO COM O ESCAVADOR (API V1)
 * Objetivo: Ler monitoramentos já existentes no painel do Dr. Fábio
 */
router.get('/publicacoes/fetch-all', authMiddleware, async (req, res) => {
    try {
        const authHeader = { 'Authorization': `Bearer ${process.env.ESCAVADOR_API_KEY}`, 'X-Requested-With': 'XMLHttpRequest' };

        console.log("\n--------------------------------------------------");
        console.log("📡 [RADAR DJEN] Iniciando varredura no Escavador...");

        // 1. Localiza o monitoramento
        const response = await axios.get(`https://api.escavador.com/api/v1/monitoramentos`, { headers: authHeader });
        const monitoramento = response.data.items?.find(m => m.termo.includes('51288'));

        if (!monitoramento) {
            console.log("❌ [RADAR] Monitoramento 51288-BA não encontrado no painel do Escavador.");
            return res.json({ ok: false, mensagem: "Aguardando ativação no site." });
        }

        console.log(`🔎 [RADAR] Monitoramento ID ${monitoramento.id} localizado. Verificando novas aparições...`);

        // 2. Busca as aparições
        const aparicoesRes = await axios.get(`https://api.escavador.com/api/v1/monitoramentos/${monitoramento.id}/aparicoes`, { headers: authHeader });
        const itens = aparicoesRes.data.items || [];
        
        console.log(`📊 [RADAR] Escavador retornou ${itens.length} aparições no total.`);

        let totalNovas = 0;

        for (const item of itens) {
            const pub = item.movimentacao;
            if (!pub) continue;

            const result = await pool.query(
                `INSERT INTO publicacoes_djen (numero_processo, conteudo, data_publicacao, tribunal, escritorio_id, status) 
                 VALUES ($1, $2, $3, $4, $5, 'pendente') 
                 ON CONFLICT (numero_processo, data_publicacao) DO NOTHING`,
                [item.numero_processo || '0000000-00.0000.0.00.0000', pub.conteudo, pub.data_formatada || pub.data, item.sigla_diario || 'DJEN', req.user.escritorio_id]
            );

            if (result.rowCount > 0) {
                totalNovas++;
                // 🔔 LOG DE ALERTA - ISSO VAI BRILHAR NO SEU TERMINAL
                console.log(`\n🔔 [NOVA PUBLICAÇÃO DETECTADA!]`);
                console.log(`📌 Processo: ${item.numero_processo}`);
                console.log(`📅 Data: ${pub.data_formatada}`);
                console.log(`✅ Salva com sucesso no banco Neon.\n`);
            }
        }

        if (totalNovas === 0) {
            console.log("😴 [RADAR] Nenhuma publicação nova para importar neste ciclo.");
        } else {
            console.log(`🚀 [RADAR] Varredura finalizada. ${totalNovas} novas publicações inseridas.`);
        }
        console.log("--------------------------------------------------\n");

        res.json({ ok: true, novas: totalNovas });

    } catch (err) {
        console.error("⚠️ [RADAR ERROR]:", err.message);
        res.status(200).json({ ok: false, mensagem: "O Radar está operando, mas o Escavador ainda não enviou dados." });
    }
});

// 2. LISTAR PUBLICAÇÕES PENDENTES (Para o frontend carregar os cards)
router.get('/publicacoes-pendentes', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM publicacoes_djen WHERE escritorio_id = $1 AND status = 'pendente' ORDER BY id DESC",
            [req.user.escritorio_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// 3. CONVERTER PUBLICAÇÃO EM PRAZO (Ações do Dr. Fábio)
router.post('/converter-publicacao', authMiddleware, async (req, res) => {
    const { id_publicacao, tipo, dataCalculada } = req.body;
    try {
        const pub = await pool.query("SELECT * FROM publicacoes_djen WHERE id = $1", [id_publicacao]);
        if (pub.rowCount === 0) return res.status(404).json({ erro: "Publicação não encontrada" });

        // Tenta vincular ao processo se ele já existir no seu sistema
        const proc = await pool.query("SELECT id FROM processos WHERE numero = $1", [pub.rows[0].numero_processo]);
        const processo_id = proc.rowCount > 0 ? proc.rows[0].id : null;

        await pool.query(
            `INSERT INTO prazos (processo_id, tipo, descricao, data_limite, status, usuario_id, escritorio_id) 
             VALUES ($1, $2, $3, $4, 'aberto', $5, $6)`,
            [processo_id, tipo, pub.rows[0].conteudo.substring(0, 200), dataCalculada, req.user.id, req.user.escritorio_id]
        );

        await pool.query("UPDATE publicacoes_djen SET status = 'processado' WHERE id = $1", [id_publicacao]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// ROTA PARA ANÁLISE JURÍDICA COM IA
router.post('/publicacoes/analisar-ia', authMiddleware, async (req, res) => {
    const { conteudo_publicacao } = req.body;

    try {
        // Aqui conectamos com o motor da IA (Gemini ou OpenAI)
        // O prompt instrui a IA a identificar o prazo (dias úteis) e a peça
        const prompt = `Analise a seguinte publicação judicial e extraia: 
        1. O prazo processual em dias úteis. 
        2. O nome da peça processual cabível. 
        Publicação: ${conteudo_publicacao}`;

        // Chamada fictícia para o serviço de IA que você utiliza
        const analiseIA = await serviceIA.gerarSugestao(prompt); 

        res.json({ 
            ok: true, 
            sugestao: analiseIA // Ex: { prazo: 15, peca: "Apelação" }
        });
    } catch (err) {
        console.error("Erro na análise de IA:", err.message);
        res.status(500).json({ erro: "Falha ao processar análise." });
    }
});

module.exports = router;