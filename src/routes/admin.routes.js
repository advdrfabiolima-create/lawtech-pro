const express = require('express');
const router = express.Router();
const pool = require('../config/db');

/**
 * 📊 ESTATÍSTICAS GERAIS DO SISTEMA
 */
router.get('/stats', async (req, res) => {
    try {
        // 1. Contagem de Escritórios por Plano
        const planosCount = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE plano_id = 1) as basico,
                COUNT(*) FILTER (WHERE plano_id = 2) as intermediario,
                COUNT(*) FILTER (WHERE plano_id = 3) as avancado,
                COUNT(*) FILTER (WHERE plano_id = 4) as premium
            FROM escritorios
        `);

        // 2. Contagem de Processos Totais
        const procCount = await pool.query("SELECT COUNT(*) as total FROM processos");

        // 3. Estatísticas de Inadimplência
        const inadimplenciaCount = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status_pagamento = 'em_dia') as em_dia,
                COUNT(*) FILTER (WHERE status_pagamento = 'pendente') as pendente,
                COUNT(*) FILTER (WHERE status_pagamento = 'inadimplente') as inadimplente
            FROM escritorios
        `);

        // 4. Escritórios no limite (próximos de upgrade)
        // ✅ EXCLUINDO planos ilimitados (-1, 999, 9999)
        const noLimiteCount = await pool.query(`
            SELECT COUNT(*) as total
            FROM escritorios e
            WHERE (
                -- ✅ Apenas escritórios com limites definidos (não ilimitados)
                e.limite_usuarios NOT IN (-1, 999, 9999) 
                AND e.limite_prazos NOT IN (-1, 999, 9999)
                AND e.limite_usuarios > 0 
                AND e.limite_prazos > 0
            )
            AND (
                -- ✅ E que estejam >= 90% do limite
                (SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id) >= (e.limite_prazos * 0.9)
                OR
                (SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id) >= (e.limite_usuarios * 0.9)
            )
        `);

        // ✅ 5. CÁLCULO REAL DO MRR (Faturamento Mensal)
        // Somamos a coluna valor_mensalidade apenas de quem está ativo/em dia
        const mrrResult = await pool.query(`
            SELECT SUM(valor_mensalidade) as total 
            FROM escritorios 
            WHERE status_pagamento = 'em_dia'
        `);

        // ✅ 6. CÁLCULO DE CHURN (Cancelamentos do mês atual)
        const churnResult = await pool.query(`
            SELECT COUNT(*) as total 
            FROM escritorios 
            WHERE status_pagamento = 'cancelado' 
            AND criado_em >= date_trunc('month', current_date)
        `);

        const stats = planosCount.rows[0];
        const inadimplencia = inadimplenciaCount.rows[0];
        
        res.json({
            ok: true,
            stats: {
                total_escritorios: parseInt(stats.total || 0),
                plano_basico: parseInt(stats.basico || 0),
                plano_intermediario: parseInt(stats.intermediario || 0),
                plano_avancado: parseInt(stats.avancado || 0),
                plano_premium: parseInt(stats.premium || 0),
                total_processos: parseInt(procCount.rows[0].total || 0),
                mrr: parseFloat(mrrResult.rows[0].total || 0), // ✅ Agora dinâmico
                churn: parseInt(churnResult.rows[0].total || 0), // ✅ Agora dinâmico
                em_dia: parseInt(inadimplencia.em_dia || 0),
                pendente: parseInt(inadimplencia.pendente || 0),
                inadimplente: parseInt(inadimplencia.inadimplente || 0),
                no_limite: parseInt(noLimiteCount.rows[0].total || 0)
            }
        });
    } catch (err) {
        console.error('❌ Erro nas estatísticas admin:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/**
 * 🏢 LISTA DETALHADA DE ESCRITÓRIOS COM STATUS DE PAGAMENTO E LIMITES
 */
router.get('/escritorios', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                e.id, 
                e.nome, 
                e.oab, 
                e.advogado_responsavel, -- ✅ Adicionado para aparecer no dashboard
                e.criado_em AS data_criacao,
                e.renovacao_automatica,
                COALESCE(e.status_pagamento, 'em_dia') as status_pagamento,
                COALESCE(e.data_vencimento, CURRENT_DATE + INTERVAL '30 days') as data_vencimento,
                COALESCE(e.plano_ativo, 'Individual') as plano_ativo, -- ✅ Agora pega o plano real
                COALESCE(e.limite_usuarios, 999) as limite_usuarios,
                COALESCE(e.limite_prazos, 999) as limite_prazos,
                (SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id) as total_usuarios,
                (SELECT COUNT(*) FROM processos WHERE escritorio_id = e.id) as total_processos,
                (SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id) as total_prazos,
                -- Cálculo de percentual de uso
                ROUND(((SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id)::numeric / NULLIF(COALESCE(e.limite_usuarios, 999), 0) * 100), 1) as percentual_usuarios,
                ROUND(((SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id)::numeric / NULLIF(COALESCE(e.limite_prazos, 999), 0) * 100), 1) as percentual_prazos,
                -- Flag de "no limite" (>=90%)
                CASE 
                    WHEN (SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id) >= (COALESCE(e.limite_usuarios, 999) * 0.9) 
                        OR (SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id) >= (COALESCE(e.limite_prazos, 999) * 0.9)
                    THEN true
                    ELSE false
                END as no_limite_upgrade
            FROM escritorios e
            ORDER BY e.id DESC
        `);

        res.json({
            ok: true,
            total: result.rowCount,
            escritorios: result.rows
        });
    } catch (err) {
        console.error('❌ Erro na lista de escritórios:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/**
 * 🛡️ ROTA DE MONITORAMENTO DE ERROS (LOGS_SISTEMA)
 */
router.get('/monitoramento', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                l.id, 
                l.servico, 
                l.tipo_erro, 
                l.mensagem_erro, 
                l.criado_em,
                e.nome as escritorio_nome,
                e.oab as escritorio_oab
            FROM logs_sistema l
            LEFT JOIN escritorios e ON e.id = l.escritorio_id
            ORDER BY l.criado_em DESC 
            LIMIT 100
        `);

        const logsFormatados = result.rows.map(log => ({
            id: log.id,
            servico: log.servico,
            tipo_erro: log.tipo_erro,
            mensagem_erro: log.mensagem_erro,
            criado_em: log.criado_em,
            advogado_responsavel: log.escritorio_nome || "Sistema Geral",
            oab: log.escritorio_oab || "—"
        }));

        res.json({ ok: true, total: result.rowCount, logs: logsFormatados });
    } catch (err) {
        console.error('❌ Erro ao buscar logs:', err.message);
        res.json({ ok: true, total: 0, logs: [] });
    }
});

/**
 * 📋 NOVA ROTA: AUDIT LOG (LOG DE EVENTOS IMPORTANTES)
 */
router.get('/audit-log', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                a.id,
                a.tipo_evento,
                a.descricao,
                a.criado_em,
                a.escritorio_id,
                e.nome as escritorio_nome,
                e.oab as escritorio_oab,
                a.usuario_id,
                u.nome as usuario_nome,
                a.metadata
            FROM audit_logs a
            LEFT JOIN escritorios e ON e.id = a.escritorio_id
            LEFT JOIN usuarios u ON u.id = a.usuario_id
            ORDER BY a.criado_em DESC 
            LIMIT 200
        `);

        const eventsFormatados = result.rows.map(event => ({
            id: event.id,
            tipo_evento: event.tipo_evento,
            descricao: event.descricao,
            criado_em: event.criado_em,
            escritorio: event.escritorio_nome || "Sistema",
            oab: event.escritorio_oab || "—",
            usuario: event.usuario_nome || "Sistema",
            metadata: event.metadata
        }));

        res.json({ ok: true, total: result.rowCount, eventos: eventsFormatados });
    } catch (err) {
        console.error('❌ Erro ao buscar audit log:', err.message);
        res.json({ ok: true, total: 0, eventos: [] });
    }
});

/**
 * 🚨 NOVA ROTA: ESCRITÓRIOS NO LIMITE (OPORTUNIDADE DE UPGRADE)
 */
router.get('/no-limite', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                e.id,
                e.nome,
                e.oab,
                e.plano_ativo,
                e.limite_usuarios,
                e.limite_prazos,
                (SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id) as total_usuarios,
                (SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id) as total_prazos,
                ROUND(((SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id)::numeric / NULLIF(e.limite_usuarios, 0) * 100), 1) as percentual_usuarios,
                ROUND(((SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id)::numeric / NULLIF(e.limite_prazos, 0) * 100), 1) as percentual_prazos,
                CASE 
                    WHEN (SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id) >= (e.limite_usuarios * 0.9) THEN 'usuarios'
                    WHEN (SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id) >= (e.limite_prazos * 0.9) THEN 'prazos'
                    ELSE 'ambos'
                END as recurso_limite
            FROM escritorios e
            WHERE (
                -- ✅ EXCLUIR escritórios com recursos ilimitados
                -- Valores -1, 999, ou 9999 indicam "ilimitado"
                e.limite_usuarios NOT IN (-1, 999, 9999) 
                AND e.limite_prazos NOT IN (-1, 999, 9999)
                AND e.limite_usuarios > 0 
                AND e.limite_prazos > 0
            )
            AND (
                -- ✅ Apenas os que estão >= 90% do limite
                (SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id) >= (e.limite_usuarios * 0.9)
                OR
                (SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id) >= (e.limite_prazos * 0.9)
            )
            ORDER BY 
                GREATEST(
                    (SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id)::numeric / NULLIF(e.limite_usuarios, 1),
                    (SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id)::numeric / NULLIF(e.limite_prazos, 1)
                ) DESC
        `);

        res.json({ ok: true, total: result.rowCount, escritorios: result.rows });
    } catch (err) {
        console.error('❌ Erro ao buscar escritórios no limite:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/**
 * 💳 NOVA ROTA: INADIMPLENTES E STATUS DE PAGAMENTO
 */
router.get('/inadimplencia', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                e.id,
                e.nome,
                e.oab,
                e.plano_ativo,
                COALESCE(e.status_pagamento, 'em_dia') as status_pagamento,
                COALESCE(e.data_vencimento, CURRENT_DATE + INTERVAL '30 days') as data_vencimento,
                COALESCE(e.valor_mensalidade, 0) as valor_mensalidade,
                CASE 
                    WHEN COALESCE(e.data_vencimento, CURRENT_DATE + INTERVAL '30 days') < CURRENT_DATE 
                    THEN CURRENT_DATE - COALESCE(e.data_vencimento, CURRENT_DATE)
                    ELSE 0
                END as dias_atraso,
                (SELECT COUNT(*) FROM processos WHERE escritorio_id = e.id) as total_processos,
                (SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id) as total_usuarios
            FROM escritorios e
            WHERE COALESCE(e.status_pagamento, 'em_dia') != 'em_dia'
            ORDER BY 
                CASE 
                    WHEN e.status_pagamento = 'inadimplente' THEN 1
                    WHEN e.status_pagamento = 'pendente' THEN 2
                    ELSE 3
                END,
                e.data_vencimento ASC
        `);

        res.json({ ok: true, total: result.rowCount, inadimplentes: result.rows });
    } catch (err) {
        console.error('❌ Erro ao buscar inadimplentes:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/**
 * 📈 DADOS PARA O GRÁFICO DE CRESCIMENTO SEMANAL
 */
router.get('/crescimento', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                TO_CHAR(d.dia, 'DD/MM') as data_formatada,
                COUNT(e.id) as total
            FROM (
                SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day')::date as dia
            ) d
            LEFT JOIN escritorios e ON DATE(e.criado_em) = d.dia
            GROUP BY d.dia
            ORDER BY d.dia ASC
        `);

        res.json({
            ok: true,
            labels: result.rows.map(r => r.data_formatada),
            valores: result.rows.map(r => parseInt(r.total))
        });
    } catch (err) {
        console.error('❌ Erro no gráfico:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;