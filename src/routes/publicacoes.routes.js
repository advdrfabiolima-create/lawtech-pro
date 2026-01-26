const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios');
const authMiddleware = require('../middlewares/authMiddleware');

/**
 * 📡 ROTA DE SINCRONIZAÇÃO - VERSÃO MULTI-TENANT
 * Usa APENAS a chave API do cliente (nunca a do .env)
 */
router.get('/publicacoes/fetch-all', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;

        console.log("\n🔍 [SYNC] Iniciando sincronização do DJEN...");

        // 1. BUSCA DADOS DO ESCRITÓRIO E CHAVE API
        const escRes = await pool.query(
            "SELECT oab, uf, advogado_responsavel, monitoramento_id, escavador_api_key FROM escritorios WHERE id = $1", 
            [escritorioId]
        );

        if (escRes.rowCount === 0) {
            return res.status(404).json({ ok: false, mensagem: "Escritório não encontrado." });
        }

        const { oab, uf, advogado_responsavel, escavador_api_key } = escRes.rows[0];
        let monitoramento_id = escRes.rows[0].monitoramento_id;

        console.log(`📋 Escritório: ${advogado_responsavel}`);
        console.log(`📋 OAB: ${oab}/${uf || 'BA'}`);
        console.log(`🔑 Chave API configurada? ${escavador_api_key ? 'SIM' : 'NÃO'}`);
        console.log(`🔑 Valor da chave: ${escavador_api_key ? '[OCULTA]' : 'VAZIA'}`);

        // 🔑 VERIFICA SE TEM CHAVE API PRÓPRIA (OBRIGATÓRIA)
        if (!escavador_api_key || escavador_api_key.trim() === '') {
            console.log("⚠️ Sem chave API configurada para este escritório");
            return res.json({
                ok: false,
                mensagem: "⚠️ Para usar sincronização automática, configure sua chave API do Escavador em:\n\nConfigurações → Integrações → Chave API do Escavador\n\nSem chave configurada, use o botão 'Adicionar Manual' para inserir publicações.",
                sem_chave: true
            });
        }

        // 🔥 USA EXCLUSIVAMENTE A CHAVE DO CLIENTE
        const authHeader = { 
            'Authorization': `Bearer ${escavador_api_key.trim()}`,
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/json'
        };

        console.log(`🔑 Usando chave API do cliente (escritório ID: ${escritorioId})`);

        // 2. BUSCAR MONITORAMENTO EXISTENTE
        if (!monitoramento_id) {
            console.log("🔍 Buscando monitoramentos existentes na conta do Escavador...");
            
            try {
                const listRes = await axios.get(
                    'https://api.escavador.com/api/v1/monitoramentos',
                    { headers: authHeader }
                );

                console.log(`📊 Total de monitoramentos na conta: ${listRes.data.items?.length || 0}`);

                const monitoramentoExistente = listRes.data.items?.find(m => 
                    m.termo && m.termo.includes(oab)
                );

                if (monitoramentoExistente) {
                    monitoramento_id = monitoramentoExistente.id;
                    console.log(`✅ Monitoramento encontrado! ID: ${monitoramento_id}`);
                    
                    await pool.query(
                        "UPDATE escritorios SET monitoramento_id = $1 WHERE id = $2", 
                        [monitoramento_id, escritorioId]
                    );
                } else {
                    return res.json({
                        ok: true,
                        novas: 0,
                        mensagem: "⚠️ Nenhum monitoramento ativo encontrado para sua OAB. Crie um monitoramento no site do Escavador ou use 'Adicionar Manual'.",
                        sem_monitoramento: true
                    });
                }

            } catch (errList) {
                console.error("❌ Erro ao buscar monitoramentos:", errList.response?.data || errList.message);
                
                if (errList.response?.status === 401) {
                    return res.status(401).json({ 
                        ok: false, 
                        erro: "❌ Chave API inválida. Verifique em Configurações → Integrações." 
                    });
                }
                
                return res.status(500).json({ 
                    ok: false, 
                    erro: "Erro ao acessar API do Escavador" 
                });
            }
        }

        // 3. BUSCAR PUBLICAÇÕES DO MONITORAMENTO
        console.log(`🔎 Buscando publicações do monitoramento ID: ${monitoramento_id}`);
        
        try {
            const aparicoesRes = await axios.get(
                `https://api.escavador.com/api/v1/monitoramentos/${monitoramento_id}/aparicoes`,
                { 
                    headers: authHeader,
                    params: { limite: 100 }
                }
            );
            
            const itens = aparicoesRes.data.items || [];
            console.log(`📊 API retornou: ${itens.length} publicações`);

            if (itens.length === 0) {
                return res.json({ 
                    ok: true, 
                    novas: 0, 
                    mensagem: "Nenhuma publicação nova no momento.",
                });
            }

            // 4. PROCESSAR E INSERIR PUBLICAÇÕES
            let totalNovas = 0;
            let totalDuplicadas = 0;

            for (const item of itens) {
                const conteudoPub = item.conteudo || item.resumo || item.texto;
                
                if (!conteudoPub || conteudoPub.length < 10) continue;

                const regexProcesso = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;
                const match = conteudoPub.match(regexProcesso);
                const numeroProcesso = match ? match[0] : 'SEM_NUMERO';
                const dataPub = item.data_publicacao || item.data || new Date().toISOString().split('T')[0];

                try {
                    const result = await pool.query(
                        `INSERT INTO publicacoes_djen 
                         (numero_processo, conteudo, data_publicacao, tribunal, escritorio_id, status) 
                         VALUES ($1, $2, $3, $4, $5, 'pendente') 
                         ON CONFLICT (numero_processo, data_publicacao) DO NOTHING
                         RETURNING id`,
                        [numeroProcesso, conteudoPub, dataPub, item.diario?.sigla || 'DJEN', escritorioId]
                    );

                    if (result.rowCount > 0) {
                        totalNovas++;
                        console.log(`📌 NOVA: ${numeroProcesso}`);
                    } else {
                        totalDuplicadas++;
                    }

                } catch (errInsert) {
                    console.error(`❌ Erro ao inserir ${numeroProcesso}:`, errInsert.message);
                }
            }

            console.log(`✅ Sincronização concluída: ${totalNovas} novas, ${totalDuplicadas} duplicadas\n`);

            res.json({ 
                ok: true, 
                novas: totalNovas, 
                duplicadas: totalDuplicadas,
                total_processadas: itens.length
            });

        } catch (errAparicoes) {
            console.error("❌ Erro ao buscar aparições:", errAparicoes.message);
            
            if (errAparicoes.response?.status === 401) {
                return res.status(401).json({
                    ok: false,
                    erro: "❌ Chave API inválida. Atualize em Configurações."
                });
            }
            
            return res.json({
                ok: true,
                novas: 0,
                mensagem: "⚠️ Nenhuma publicação disponível no momento."
            });
        }

    } catch (err) {
        console.error("❌ [ERRO GERAL]:", err.message);
        res.status(500).json({ 
            ok: false, 
            erro: "Erro na sincronização",
            detalhes: err.message
        });
    }
});

/**
 * 📋 BUSCAR PUBLICAÇÕES PENDENTES
 */
router.get('/publicacoes-pendentes', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        
        const query = `
            SELECT 
                id, 
                numero_processo, 
                conteudo, 
                data_publicacao, 
                tribunal, 
                status
            FROM publicacoes_djen 
            WHERE escritorio_id = $1 
            AND status = 'pendente' 
            ORDER BY data_publicacao DESC
            LIMIT 100`;

        const result = await pool.query(query, [escritorioId]);
        
        console.log(`📋 Retornando ${result.rows.length} publicações pendentes`);
        
        res.json(result.rows);
        
    } catch (err) {
        console.error("❌ Erro ao buscar publicações:", err.message);
        res.status(500).json({ erro: "Erro ao carregar publicações do banco." });
    }
});

/**
 * ⚡ CONVERTER PUBLICAÇÃO EM PRAZO
 */
router.post('/converter-publicacao', authMiddleware, async (req, res) => {
    const { id_publicacao, tipo, dias, dataCalculada } = req.body;
    const escritorioId = req.user.escritorio_id;
    const usuarioId = req.user.id;

    try {
        const pubRes = await pool.query(
            'SELECT * FROM publicacoes_djen WHERE id = $1 AND escritorio_id = $2',
            [id_publicacao, escritorioId]
        );

        if (pubRes.rowCount === 0) {
            return res.status(404).json({ erro: 'Publicação não encontrada' });
        }

        const pub = pubRes.rows[0];

        let processoId = null;
        
        const processoExistente = await pool.query(
            'SELECT id FROM processos WHERE numero = $1 AND escritorio_id = $2',
            [pub.numero_processo, escritorioId]
        );

        if (processoExistente.rowCount > 0) {
            processoId = processoExistente.rows[0].id;
        } else {
            const novoProcesso = await pool.query(
                `INSERT INTO processos (numero, escritorio_id, usuario_id, status) 
                 VALUES ($1, $2, $3, 'ativo') 
                 RETURNING id`,
                [pub.numero_processo, escritorioId, usuarioId]
            );
            processoId = novoProcesso.rows[0].id;
            console.log(`📁 Processo criado automaticamente: ${pub.numero_processo}`);
        }

        const prazoRes = await pool.query(
            `INSERT INTO prazos 
             (tipo, processo_id, descricao, data_limite, status, escritorio_id, usuario_id) 
             VALUES ($1, $2, $3, $4, 'aberto', $5, $6)
             RETURNING *`,
            [
                tipo,
                processoId,
                `Processo: ${pub.numero_processo} | Prazo: ${dias} dias úteis | Gerado de publicação DJEN em ${pub.data_publicacao}`,
                dataCalculada,
                escritorioId,
                usuarioId
            ]
        );

        await pool.query(
            "UPDATE publicacoes_djen SET status = 'convertida' WHERE id = $1",
            [id_publicacao]
        );

        console.log(`✅ Prazo criado: ${tipo} - Processo ${pub.numero_processo} - Vencimento: ${dataCalculada}`);

        res.json({ 
            ok: true, 
            mensagem: 'Prazo criado com sucesso!',
            prazo: prazoRes.rows[0]
        });

    } catch (err) {
        console.error('❌ Erro ao converter publicação:', err.message);
        console.error('Stack:', err.stack);
        res.status(500).json({ erro: 'Erro ao criar prazo', detalhes: err.message });
    }
});

/**
 * 🧪 INSERIR PUBLICAÇÃO MANUAL
 */
router.post('/publicacoes/manual', authMiddleware, async (req, res) => {
    try {
        const { numero_processo, conteudo, data_publicacao, tribunal } = req.body;
        const escritorioId = req.user.escritorio_id;

        if (!numero_processo || !conteudo) {
            return res.status(400).json({ erro: 'Campos obrigatórios: numero_processo e conteudo' });
        }

        const result = await pool.query(
            `INSERT INTO publicacoes_djen 
             (numero_processo, conteudo, data_publicacao, tribunal, escritorio_id, status) 
             VALUES ($1, $2, $3, $4, $5, 'pendente')
             RETURNING *`,
            [
                numero_processo,
                conteudo,
                data_publicacao || new Date().toISOString().split('T')[0],
                tribunal || 'DJEN',
                escritorioId
            ]
        );

        console.log(`✅ Publicação manual inserida: ${numero_processo}`);

        res.json({ ok: true, publicacao: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ erro: 'Esta publicação já existe' });
        }
        console.error('❌ Erro ao inserir publicação manual:', err.message);
        res.status(500).json({ erro: 'Erro ao inserir publicação' });
    }
});

module.exports = router;