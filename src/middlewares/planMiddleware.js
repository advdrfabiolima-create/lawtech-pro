const pool = require('../config/db');
const planLimits = require('../config/planLimits.json');

/**
 * 🔒 MIDDLEWARE DE VERIFICAÇÃO DE PLANO
 * ✅ VERSÃO DEFINITIVA COM SOFT DELETE - 27/01/2026
 * 
 * Conta TODOS os prazos criados no mês (incluindo deletados)
 * para evitar que usuários burlem o limite via lixeira
 */

// ============================================================
// 1. VERIFICAR SE FUNCIONALIDADE ESTÁ DISPONÍVEL
// ============================================================
const checkFeature = (featureName) => {
    return async (req, res, next) => {
        try {
            const escritorioId = req.user.escritorio_id;

            const result = await pool.query(
                `SELECT p.slug, p.nome 
                 FROM escritorios e
                 JOIN planos p ON e.plano_id = p.id
                 WHERE e.id = $1`,
                [escritorioId]
            );

            if (result.rows.length === 0) {
                return res.status(403).json({ 
                    error: 'Plano não identificado',
                    upgrade_required: true 
                });
            }

            const planoSlug = result.rows[0].slug || 'basico';
            const planoConfig = planLimits[planoSlug];

            if (!planoConfig) {
                return res.status(500).json({ 
                    error: 'Configuração de plano inválida' 
                });
            }

            const featureEnabled = planoConfig.funcionalidades[featureName];

            if (!featureEnabled) {
                return res.status(402).json({
                    error: 'Funcionalidade não disponível no seu plano',
                    feature: featureName,
                    current_plan: planoConfig.nome,
                    upgrade_required: true,
                    message: `A funcionalidade "${featureName}" não está disponível no plano ${planoConfig.nome}. Faça upgrade para acessar.`
                });
            }

            req.plan = planoConfig;
            req.planSlug = planoSlug;
            next();

        } catch (err) {
            console.error('Erro ao verificar funcionalidade:', err);
            return res.status(500).json({ 
                error: 'Erro ao verificar permissões de plano' 
            });
        }
    };
};

// ============================================================
// 2. VERIFICAR LIMITE DE RECURSOS
// ✅ CONTA TODOS OS PRAZOS (incluindo deletados)
// ============================================================
const checkLimit = (resourceType) => {
    return async (req, res, next) => {
        try {
            const escritorioId = req.user.escritorio_id;

            const planoResult = await pool.query(
                `SELECT p.slug, p.nome 
                 FROM escritorios e
                 JOIN planos p ON e.plano_id = p.id
                 WHERE e.id = $1`,
                [escritorioId]
            );

            if (planoResult.rows.length === 0) {
                return res.status(403).json({ 
                    error: 'Plano não identificado' 
                });
            }

            const planoSlug = planoResult.rows[0].slug || 'basico';
            const planoConfig = planLimits[planoSlug];
            const limite = planoConfig[resourceType];

            if (limite && limite.ilimitado) {
                req.plan = planoConfig;
                return next();
            }

            const maxAllowed = limite ? limite.max : 0;

            let currentCount = 0;
            let tableName = '';
            let queryCondition = '';

            switch (resourceType) {
                case 'prazos':
                    tableName = 'prazos';
                    // ✅ CRÍTICO: Conta TODOS os prazos criados no mês
                    // (incluindo deletados, para evitar burlar limite)
                    queryCondition = `WHERE escritorio_id = $1 
                                     AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
                                     AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)`;
                    // NÃO filtra por deletado!
                    break;
                case 'usuarios':
                    tableName = 'usuarios';
                    queryCondition = 'WHERE escritorio_id = $1';
                    break;
                case 'processos':
                    tableName = 'processos';
                    queryCondition = 'WHERE escritorio_id = $1';
                    break;
                default:
                    return next();
            }

            const queryDebug = `SELECT COUNT(*) as total FROM ${tableName} ${queryCondition}`;
            console.log(`[PLAN MIDDLEWARE] Verificando limite de ${resourceType}:`, queryDebug);

            const countResult = await pool.query(
                `SELECT COUNT(*) as total FROM ${tableName} ${queryCondition}`,
                [escritorioId]
            );

            currentCount = parseInt(countResult.rows[0].total);

            console.log(`[PLAN MIDDLEWARE] ${resourceType}: ${currentCount}/${maxAllowed} (Plano: ${planoSlug})`);

            if (currentCount >= maxAllowed) {
                console.log(`[PLAN MIDDLEWARE] ❌ LIMITE ATINGIDO! ${currentCount} >= ${maxAllowed}`);
                return res.status(402).json({
                    error: 'Limite do plano atingido',
                    resource: resourceType,
                    current: currentCount,
                    max: maxAllowed,
                    current_plan: planoConfig.nome,
                    upgrade_required: true,
                    message: `Você atingiu o limite de ${maxAllowed} ${resourceType} mensais do plano ${planoConfig.nome}. Faça upgrade para continuar.`
                });
            }

            req.plan = planoConfig;
            req.planSlug = planoSlug;
            req.resourceUsage = {
                type: resourceType,
                current: currentCount,
                max: maxAllowed,
                remaining: maxAllowed - currentCount
            };

            console.log(`[PLAN MIDDLEWARE] ✅ LIBERADO: ${currentCount}/${maxAllowed} - Restam ${maxAllowed - currentCount}`);
            next();

        } catch (err) {
            console.error('[PLAN MIDDLEWARE] Erro ao verificar limite:', err);
            return res.status(500).json({ 
                error: 'Erro ao verificar limite de recursos',
                details: err.message
            });
        }
    };
};

// ============================================================
// 3. OBTER INFORMAÇÕES DO PLANO
// ✅ CONTA TODOS (incluindo deletados)
// ============================================================
const getPlanInfo = async (req, res, next) => {
    try {
        const escritorioId = req.user.escritorio_id;

        const result = await pool.query(
            `SELECT p.slug, p.nome
             FROM escritorios e
             JOIN planos p ON e.plano_id = p.id
             WHERE e.id = $1`,
            [escritorioId]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({ 
                error: 'Plano não identificado' 
            });
        }

        const planoSlug = result.rows[0].slug || 'basico';
        const planoConfig = planLimits[planoSlug];

        const [prazosCount, usuariosCount, processosCount] = await Promise.all([
            // ✅ Conta TODOS os prazos do mês (incluindo deletados)
            pool.query(
                `SELECT COUNT(*) as total FROM prazos 
                 WHERE escritorio_id = $1 
                 AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
                 AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)`, 
                [escritorioId]
            ),
            pool.query('SELECT COUNT(*) as total FROM usuarios WHERE escritorio_id = $1', [escritorioId]),
            pool.query('SELECT COUNT(*) as total FROM processos WHERE escritorio_id = $1', [escritorioId])
        ]);

        req.planInfo = {
            ...planoConfig,
            slug: planoSlug,
            usage: {
                prazos: {
                    current: parseInt(prazosCount.rows[0].total),
                    max: planoConfig.prazos.max,
                    ilimitado: planoConfig.prazos.ilimitado
                },
                usuarios: {
                    current: parseInt(usuariosCount.rows[0].total),
                    max: planoConfig.usuarios.max,
                    ilimitado: planoConfig.usuarios.ilimitado
                },
                processos: {
                    current: parseInt(processosCount.rows[0].total),
                    max: planoConfig.processos.max,
                    ilimitado: planoConfig.processos.ilimitado
                }
            }
        };

        next();

    } catch (err) {
        console.error('Erro ao obter informações do plano:', err);
        return res.status(500).json({ 
            error: 'Erro ao carregar informações do plano' 
        });
    }
};

module.exports = {
    checkFeature,
    checkLimit,
    getPlanInfo
};