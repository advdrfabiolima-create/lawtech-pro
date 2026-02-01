const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios');
const authMiddleware = require('../middlewares/authMiddleware');
const planMiddleware = require('../middlewares/planMiddleware');

/**
 * ============================================================
 * 📡 ROTA DE SINCRONIZAÇÃO - VERSÃO CORRIGIDA (27/01/2026)
 * ✅ Formato OAB correto: "BA-51288" (sem zeros, UF primeiro)
 * ============================================================
 */
router.get('/publicacoes/fetch-all', 
    authMiddleware, 
    planMiddleware.checkFeature('sincronizacao_djen'),
    async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;

        console.log("\n📄 [SYNC] Iniciando sincronização do DJEN...");

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

        // ✅ FORMATAR OAB CORRETAMENTE
        // Remove pontos, traços e barra
        const oabNumeros = oab ? oab.replace(/\D/g, '') : '';
        // Remove zeros à esquerda
        const oabSemZeros = oabNumeros.replace(/^0+/, '');
        const ufFinal = uf || 'BA';
        
        // ✅ FORMATO CORRETO: "BA-51288" (UF primeiro, sem zeros)
        const oabFormatada = `${ufFinal}-${oabSemZeros}`;

        console.log(`📋 Escritório: ${advogado_responsavel}`);
        console.log(`📋 OAB original: ${oab}`);
        console.log(`📋 OAB formatada: ${oabFormatada}`);
        console.log(`🔑 Chave API configurada? ${escavador_api_key ? 'SIM' : 'NÃO'}`);

        // 🔒 VERIFICA SE TEM CHAVE API PRÓPRIA
        if (!escavador_api_key || escavador_api_key.trim() === '') {
            console.log("⚠️ Sem chave API configurada para este escritório");
            return res.json({
                ok: false,
                mensagem: "⚠️ Para usar sincronização automática, configure sua chave API do Escavador em:\n\nConfigurações → Integrações → Chave API do Escavador\n\nSem chave configurada, use o botão 'Adicionar Manual' para inserir publicações.",
                sem_chave: true
            });
        }

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
                    { headers: authHeader, timeout: 15000 }
                );

                console.log(`📊 Total de monitoramentos na conta: ${listRes.data.items?.length || 0}`);

                // ✅ BUSCAR POR OAB FORMATADA CORRETA
                const monitoramentoExistente = listRes.data.items?.find(m => {
                    if (!m.termo) return false;
                    
                    // Tentar match com diferentes formatos
                    const termo = m.termo.toUpperCase();
                    return termo.includes(oabFormatada) || 
                           termo.includes(oabSemZeros) ||
                           termo.includes(oab);
                });

                if (monitoramentoExistente) {
                    monitoramento_id = monitoramentoExistente.id;
                    console.log(`✅ Monitoramento encontrado! ID: ${monitoramento_id}`);
                    console.log(`   Termo: ${monitoramentoExistente.termo}`);
                    
                    await pool.query(
                        "UPDATE escritorios SET monitoramento_id = $1 WHERE id = $2", 
                        [monitoramento_id, escritorioId]
                    );
                } else {
                    console.log(`❌ Nenhum monitoramento encontrado para: ${oabFormatada}`);
                    console.log(`   Monitoramentos disponíveis:`);
                    listRes.data.items?.forEach((m, i) => {
                        console.log(`   ${i+1}. ${m.termo} (ID: ${m.id})`);
                    });
                    
                    return res.json({
                        ok: true,
                        novas: 0,
                        mensagem: `⚠️ Nenhum monitoramento ativo encontrado para sua OAB (${oabFormatada}).\n\nCrie um monitoramento no site do Escavador para esta OAB ou use 'Adicionar Manual'.`,
                        sem_monitoramento: true,
                        oab_formatada: oabFormatada
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
                    params: { limite: 100 },
                    timeout: 20000
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

            console.log('\n🔄 Processando publicações...');
            
            for (const item of itens) {
                console.log('\n📦 Processando item ID:', item.id);
                
                // ✅ API V1: Dados estão em estrutura diferente
                const conteudoPub = item.movimentacao?.conteudo || item.conteudo || item.resumo || item.texto;
                const numeroProcesso = item.numero_processo || 'SEM_NUMERO';
                const dataPub = item.data_diario?.date?.split(' ')[0] || 
                               item.data_processo?.date?.split(' ')[0] || 
                               item.data_publicacao || 
                               new Date().toISOString().split('T')[0];
                
                console.log('   📋 Número processo:', numeroProcesso);
                console.log('   📅 Data:', dataPub);
                console.log('   📝 Tamanho conteúdo:', conteudoPub?.length || 0);
                
                if (!conteudoPub || conteudoPub.length < 10) {
                    console.log('   ⏭️ IGNORADO: Conteúdo vazio ou muito curto');
                    continue;
                }

                try {
                    const result = await pool.query(
                        `INSERT INTO publicacoes 
                         (numero_processo, conteudo, data_publicacao, tribunal, escritorio_id, status) 
                         VALUES ($1, $2, $3, $4, $5, 'pendente') 
                         ON CONFLICT (numero_processo, data_publicacao, escritorio_id) DO NOTHING
                         RETURNING id`,
                        [numeroProcesso, conteudoPub, dataPub, item.sigla_diario || 'DJEN', escritorioId]
                    );

                    if (result.rowCount > 0) {
                        totalNovas++;
                        console.log(`   ✅ INSERIDO: ${numeroProcesso} (ID: ${result.rows[0].id})`);
                    } else {
                        totalDuplicadas++;
                        console.log(`   ⏭️ DUPLICADO: ${numeroProcesso}`);
                    }

                } catch (errInsert) {
                    console.error(`   ❌ Erro ao inserir ${numeroProcesso}:`, errInsert.message);
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
 * ============================================================
 * 📋 BUSCAR PUBLICAÇÕES PENDENTES
 * ============================================================
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
            FROM publicacoes 
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
 * ============================================================
 * ⚡ CONVERTER PUBLICAÇÃO EM PRAZO
 * ✅ CORRIGIDO: Busca cliente_id do processo existente
 * ============================================================
 */
router.post('/converter-publicacao', authMiddleware, async (req, res) => {
    const { id_publicacao, tipo, dias, dataCalculada } = req.body;
    const escritorioId = req.user.escritorio_id;
    const usuarioId = req.user.id;

    try {
        const pubRes = await pool.query(
            'SELECT * FROM publicacoes WHERE id = $1 AND escritorio_id = $2',
            [id_publicacao, escritorioId]
        );

        if (pubRes.rowCount === 0) {
            return res.status(404).json({ erro: 'Publicação não encontrada' });
        }

        const pub = pubRes.rows[0];

        let processoId = null;
        let clienteId = null;
        
        // ✅ BUSCAR PROCESSO EXISTENTE E SEU CLIENTE
        const processoExistente = await pool.query(
            'SELECT id, cliente_id FROM processos WHERE numero = $1 AND escritorio_id = $2',
            [pub.numero_processo, escritorioId]
        );

        if (processoExistente.rowCount > 0) {
            processoId = processoExistente.rows[0].id;
            clienteId = processoExistente.rows[0].cliente_id;
            console.log(`✅ Processo existente encontrado: ${pub.numero_processo} (cliente_id: ${clienteId})`);
        } else {
            // ✅ CRIAR PROCESSO SEM CLIENTE (será preenchido depois)
            const novoProcesso = await pool.query(
                `INSERT INTO processos (numero, escritorio_id, usuario_id, status) 
                 VALUES ($1, $2, $3, 'ativo') 
                 RETURNING id`,
                [pub.numero_processo, escritorioId, usuarioId]
            );
            processoId = novoProcesso.rows[0].id;
            console.log(`📁 Processo criado automaticamente: ${pub.numero_processo} (SEM CLIENTE - precisa editar)`);
        }

        // ✅ CRIAR PRAZO COM CLIENTE_ID SE DISPONÍVEL
        const prazoRes = await pool.query(
            `INSERT INTO prazos 
             (tipo, processo_id, cliente_id, descricao, data_limite, status, escritorio_id, usuario_id, deletado, created_at) 
             VALUES ($1, $2, $3, $4, $5, 'aberto', $6, $7, false, NOW())
             RETURNING *`,
            [
                tipo,
                processoId,
                clienteId, // ✅ AGORA VINCULA O CLIENTE
                `Processo: ${pub.numero_processo} | Prazo: ${dias} dias úteis | Gerado de publicação DJEN em ${pub.data_publicacao}`,
                dataCalculada,
                escritorioId,
                usuarioId
            ]
        );

        await pool.query(
            "UPDATE publicacoes SET status = 'convertida' WHERE id = $1",
            [id_publicacao]
        );

        console.log(`✅ Prazo criado: ${tipo} - Processo ${pub.numero_processo} - Vencimento: ${dataCalculada} - Cliente: ${clienteId || 'NÃO VINCULADO'}`);

        res.json({ 
            ok: true, 
            mensagem: clienteId 
                ? 'Prazo criado com sucesso e vinculado ao cliente!' 
                : 'Prazo criado! ⚠️ Processo sem cliente - edite o prazo para vincular.',
            prazo: prazoRes.rows[0],
            processo_sem_cliente: !clienteId
        });

    } catch (err) {
        console.error('❌ Erro ao converter publicação:', err.message);
        console.error('Stack:', err.stack);
        res.status(500).json({ erro: 'Erro ao criar prazo', detalhes: err.message });
    }
});

/**
 * ============================================================
 * 🧪 INSERIR PUBLICAÇÃO MANUAL
 * ============================================================
 */
router.post('/publicacoes/manual', authMiddleware, async (req, res) => {
    try {
        const { numero_processo, conteudo, data_publicacao, tribunal } = req.body;
        const escritorioId = req.user.escritorio_id;

        if (!numero_processo || !conteudo) {
            return res.status(400).json({ erro: 'Campos obrigatórios: numero_processo e conteudo' });
        }

        const result = await pool.query(
            `INSERT INTO publicacoes 
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