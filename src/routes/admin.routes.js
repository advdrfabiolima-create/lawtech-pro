const express = require('express');
const router = express.Router();
const pool = require('../config/db');

/**
 * 📊 ESTATÍSTICAS GERAIS - COMPATÍVEL
 */
router.get('/stats', async (req, res) => {
    try {
        // Status por plano financeiro
        const statusCount = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE plano_financeiro_status = 'trial') as em_trial,
                COUNT(*) FILTER (WHERE plano_financeiro_status = 'pago') as pagos,
                COUNT(*) FILTER (WHERE plano_financeiro_status = 'ativo') as ativos,
                COUNT(*) FILTER (WHERE plano_financeiro_status = 'inadimplente') as inadimplentes,
                COUNT(*) FILTER (WHERE renovacao_automatica = false) as cancelados,
                COUNT(*) FILTER (WHERE plano_id = 1) as basico,
                COUNT(*) FILTER (WHERE plano_id = 2) as intermediario,
                COUNT(*) FILTER (WHERE plano_id = 3) as avancado,
                COUNT(*) FILTER (WHERE plano_id = 4) as premium
            FROM escritorios
        `);

        const procCount = await pool.query("SELECT COUNT(*) as total FROM processos");

        // MRR Real
        const mrrResult = await pool.query(`
            SELECT 
                COALESCE(SUM(p.preco_mensal), 0) as mrr_total,
                COUNT(*) as total_pagantes
            FROM escritorios e
            JOIN planos p ON p.id = e.plano_id
            WHERE e.plano_financeiro_status IN ('pago', 'ativo')
            AND (e.renovacao_automatica IS NULL OR e.renovacao_automatica = true)
        `);

        // Churn (com proteção contra divisão por zero)
        const churnResult = await pool.query(`
            SELECT COUNT(*) as total
            FROM escritorios 
            WHERE renovacao_automatica = false
            AND plano_financeiro_status IN ('pago', 'ativo', 'trial')
        `);

        // Cobranças
        const cobrancasProximas = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE proxima_cobranca = CURRENT_DATE) as hoje,
                COUNT(*) FILTER (WHERE proxima_cobranca BETWEEN CURRENT_DATE + 1 AND CURRENT_DATE + 7) as proximos_7_dias
            FROM escritorios
            WHERE proxima_cobranca IS NOT NULL
            AND plano_financeiro_status = 'pago'
            AND (renovacao_automatica IS NULL OR renovacao_automatica = true)
        `);

        // Taxa de Sucesso
        const taxaSucesso = await pool.query(`
            SELECT 
                COALESCE(COUNT(*) FILTER (WHERE status = 'aprovada'), 0) as aprovadas,
                COALESCE(COUNT(*) FILTER (WHERE status = 'recusada'), 0) as recusadas,
                COUNT(*) as total
            FROM transacoes
            WHERE created_at >= date_trunc('month', current_date)
        `);

        // Falhas recentes
        const falhasPagamento = await pool.query(`
            SELECT COUNT(*) as total
            FROM transacoes
            WHERE status = 'recusada'
            AND created_at >= CURRENT_DATE - INTERVAL '7 days'
        `);

        // No limite
        const noLimiteCount = await pool.query(`
            SELECT COUNT(*) as total
            FROM escritorios e
            WHERE (
                e.limite_usuarios NOT IN (-1, 999, 9999) 
                AND e.limite_prazos NOT IN (-1, 999, 9999)
                AND e.limite_usuarios > 0 
                AND e.limite_prazos > 0
            )
            AND (
                (SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id) >= (e.limite_prazos * 0.9)
                OR
                (SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id) >= (e.limite_usuarios * 0.9)
            )
        `);

        const stats = statusCount.rows[0];
        const mrr = mrrResult.rows[0];
        const cobrancas = cobrancasProximas.rows[0];
        const taxas = taxaSucesso.rows[0];
        
        // ✅ CÁLCULO SEGURO DO CHURN
        const totalEscritorios = parseInt(stats.total || 0);
        const totalCancelados = parseInt(churnResult.rows[0]?.total || 0);
        const churnRate = totalEscritorios > 0 
            ? ((totalCancelados / totalEscritorios) * 100).toFixed(1)
            : '0.0';
        
        res.json({
            ok: true,
            stats: {
                total_escritorios: totalEscritorios,
                total_processos: parseInt(procCount.rows[0].total || 0),
                
                // Status
                em_trial: parseInt(stats.em_trial || 0),
                pagos: parseInt(stats.pagos || 0),
                ativos: parseInt(stats.ativos || 0),
                inadimplentes: parseInt(stats.inadimplentes || 0),
                cancelados: totalCancelados,
                
                // Planos
                plano_basico: parseInt(stats.basico || 0),
                plano_intermediario: parseInt(stats.intermediario || 0),
                plano_avancado: parseInt(stats.avancado || 0),
                plano_premium: parseInt(stats.premium || 0),
                
                // Financeiro
                mrr: parseFloat(mrr.mrr_total || 0),
                churn: totalCancelados,  // Quantidade
                churn_rate: churnRate,   // Percentual
                
                // Cobranças
                cobrancas_hoje: parseInt(cobrancas?.hoje || 0),
                cobrancas_proximos_7dias: parseInt(cobrancas?.proximos_7_dias || 0),
                
                // Taxa - null se não houver transações (evita métrica enganosa)
                taxa_aprovacao: taxas.total > 0
                    ? parseFloat(((taxas.aprovadas / taxas.total) * 100).toFixed(1))
                    : null,
                falhas_7dias: parseInt(falhasPagamento.rows[0].total || 0),
                
                // Compatibilidade
                em_dia: parseInt(stats.pagos || 0) + parseInt(stats.ativos || 0),
                pendente: 0,
                inadimplente: parseInt(stats.inadimplentes || 0),
                no_limite: parseInt(noLimiteCount.rows[0].total || 0)
            }
        });
    } catch (err) {
        console.error('❌ Erro nas estatísticas admin:', err.message);
        res.status(500).json({ ok: false, error: 'Erro interno do servidor' });
    }
});

/**
 * 🏢 LISTA DE ESCRITÓRIOS - COMPATÍVEL
 */
router.get('/escritorios', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                e.id, 
                e.nome, 
                e.oab, 
                e.advogado_responsavel,
                e.data_criacao AS data_criacao, -- ✅ Usa data atual como fallback
                e.renovacao_automatica,
                
                -- ✅ NOVOS CAMPOS
                e.plano_financeiro_status,
                e.trial_expira_em,
                e.ultimo_pagamento,
                e.proxima_cobranca,
                
                -- Plano (mantém compatibilidade)
                p.nome as plano_ativo,  -- ✅ CAMPO ESPERADO PELO FRONTEND
                p.preco_mensal,
                
                -- Status Pagamento (compatibilidade)
                CASE 
                    WHEN e.plano_financeiro_status = 'pago' THEN 'em_dia'
                    WHEN e.plano_financeiro_status = 'ativo' THEN 'em_dia'
                    WHEN e.plano_financeiro_status = 'inadimplente' THEN 'inadimplente'
                    WHEN e.plano_financeiro_status = 'trial' THEN 'trial'
                    ELSE 'em_dia'
                END as status_pagamento,
                
                -- Data vencimento (compatibilidade)
                COALESCE(e.proxima_cobranca, e.trial_expira_em, CURRENT_DATE + INTERVAL '30 days') as data_vencimento,
                
                -- Limites
                COALESCE(e.limite_usuarios, 999) as limite_usuarios,
                COALESCE(e.limite_prazos, 999) as limite_prazos,
                
                -- Contadores
                (SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id) as total_usuarios,
                (SELECT COUNT(*) FROM processos WHERE escritorio_id = e.id) as total_processos,
                (SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id) as total_prazos,
                
                -- Percentuais
                ROUND(((SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id)::numeric / NULLIF(COALESCE(e.limite_usuarios, 999), 0) * 100), 1) as percentual_usuarios,
                ROUND(((SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id)::numeric / NULLIF(COALESCE(e.limite_prazos, 999), 0) * 100), 1) as percentual_prazos,
                
                -- Flag no limite
                CASE 
                    WHEN (SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id) >= (COALESCE(e.limite_usuarios, 999) * 0.9) 
                        OR (SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id) >= (COALESCE(e.limite_prazos, 999) * 0.9)
                    THEN true
                    ELSE false
                END as no_limite_upgrade
                
            FROM escritorios e
            JOIN planos p ON p.id = e.plano_id
            ORDER BY e.id DESC
        `);

        res.json({
            ok: true,
            total: result.rowCount,
            escritorios: result.rows
        });
    } catch (err) {
        console.error('❌ Erro na lista de escritórios:', err.message);
        res.status(500).json({ ok: false, error: 'Erro interno do servidor' });
    }
});

/**
 * 🛡️ MONITORAMENTO
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
 * 📋 AUDIT LOG
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
 * 🚨 NO LIMITE
 */
router.get('/no-limite', async (req, res) => {
    try {
        // ✅ Limites definidos diretamente (não depende de arquivo externo)
        const planLimits = {
            'basico': {
                usuarios: { max: 3, ilimitado: false },
                prazos: { max: 10, ilimitado: false }
            },
            'intermediario': {
                usuarios: { max: 15, ilimitado: false },
                prazos: { max: 100, ilimitado: false }
            },
            'avancado': {
                usuarios: { max: -1, ilimitado: true },
                prazos: { max: 500, ilimitado: false }
            },
            'premium': {
                usuarios: { max: -1, ilimitado: true },
                prazos: { max: -1, ilimitado: true }
            }
        };
        
        // ✅ OTIMIZADO: 1 única query com subqueries (escalável para 1000+ escritórios)
        const result = await pool.query(`
            SELECT 
                e.id,
                e.nome,
                e.oab,
                p.nome as plano_ativo,
                p.slug as plano_slug,
                (SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id) as total_usuarios,
                (SELECT COUNT(*) FROM prazos WHERE escritorio_id = e.id) as total_prazos
            FROM escritorios e
            JOIN planos p ON p.id = e.plano_id
            WHERE p.slug != 'premium'
            ORDER BY e.id DESC
        `);

        // Processar cada escritório com os limites corretos
        const escritoriosComLimites = result.rows.map(esc => {
            const planoSlug = esc.plano_slug || 'basico';
            const limites = planLimits[planoSlug] || planLimits['basico'];
            
            const total_usuarios = parseInt(esc.total_usuarios);
            const total_prazos = parseInt(esc.total_prazos);
            
            // Definir limites baseados no JSON
            const limiteUsuarios = limites.usuarios.ilimitado ? -1 : limites.usuarios.max;
            const limitePrazos = limites.prazos.ilimitado ? -1 : limites.prazos.max;
            
            // Calcular percentuais
            const percUsuarios = limiteUsuarios === -1 
                ? 0 
                : Math.round((total_usuarios / limiteUsuarios) * 100 * 10) / 10;
                
            const percPrazos = limitePrazos === -1 
                ? 0 
                : Math.round((total_prazos / limitePrazos) * 100 * 10) / 10;
            
            // Determinar recurso crítico
            let recursoLimite = 'ok';
            if (limiteUsuarios > 0 && percUsuarios >= 90) recursoLimite = 'usuarios';
            else if (limitePrazos > 0 && percPrazos >= 90) recursoLimite = 'prazos';
            
            return {
                id: esc.id,
                nome: esc.nome,
                oab: esc.oab,
                plano_ativo: esc.plano_ativo,
                limite_usuarios: limiteUsuarios,
                limite_prazos: limitePrazos,
                total_usuarios: total_usuarios,
                total_prazos: total_prazos,
                percentual_usuarios: percUsuarios,
                percentual_prazos: percPrazos,
                recurso_limite: recursoLimite
            };
        });

        // Ordenar por maior uso
        escritoriosComLimites.sort((a, b) => {
            const maxA = Math.max(a.percentual_usuarios, a.percentual_prazos);
            const maxB = Math.max(b.percentual_usuarios, b.percentual_prazos);
            return maxB - maxA;
        });

        res.json({ ok: true, total: escritoriosComLimites.length, escritorios: escritoriosComLimites });
    } catch (err) {
        console.error('❌ Erro ao buscar escritórios no limite:', err.message);
        res.status(500).json({ ok: false, error: 'Erro interno do servidor' });
    }
});

/**
 * 💳 INADIMPLENTES
 */
router.get('/inadimplencia', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                e.id,
                e.nome,
                e.oab,
                p.nome as plano_ativo,
                p.preco_mensal as valor_mensalidade,
                e.plano_financeiro_status as status_pagamento,
                COALESCE(e.proxima_cobranca, e.trial_expira_em, CURRENT_DATE + INTERVAL '30 days') as data_vencimento,
                CASE 
                    WHEN e.proxima_cobranca IS NOT NULL AND e.proxima_cobranca < CURRENT_DATE 
                    THEN EXTRACT(day FROM (CURRENT_DATE - e.proxima_cobranca))::integer
                    ELSE 0
                END as dias_atraso,
                (SELECT COUNT(*) FROM processos WHERE escritorio_id = e.id) as total_processos,
                (SELECT COUNT(*) FROM usuarios WHERE escritorio_id = e.id) as total_usuarios
            FROM escritorios e
            JOIN planos p ON p.id = e.plano_id
            ORDER BY 
                CASE 
                    WHEN e.plano_financeiro_status = 'inadimplente' THEN 1
                    WHEN e.proxima_cobranca < CURRENT_DATE + INTERVAL '7 days' THEN 2
                    ELSE 3
                END,
                e.proxima_cobranca ASC NULLS LAST
        `);

        res.json({ ok: true, total: result.rowCount, inadimplentes: result.rows });
    } catch (err) {
        console.error('❌ Erro ao buscar inadimplentes:', err.message);
        res.status(500).json({ ok: false, error: 'Erro interno do servidor' });
    }
});

/**
 * 📈 CRESCIMENTO
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
            LEFT JOIN escritorios e ON DATE(e.data_criacao) = d.dia
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
        res.status(500).json({ ok: false, error: 'Erro interno do servidor' });
    }
});


module.exports = router;