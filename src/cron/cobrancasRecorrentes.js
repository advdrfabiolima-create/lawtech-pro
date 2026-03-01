const cron = require('node-cron');
const pool = require('../config/db');
const { decrypt } = require('../utils/crypto');
const { tentarGatewayAlternativo } = require('../utils/gatewayFailover');
const { processarCobrancaCartao } = require('../services/chargeService');
const logger = require('../utils/logger');
const cache = require('../utils/cache');

async function invalidarCacheEscritorio(escritorioId) {
    try {
        const users = await pool.query('SELECT id FROM usuarios WHERE escritorio_id = $1', [escritorioId]);
        for (const u of users.rows) {
            await cache.del(`auth:user:${u.id}`);
        }
    } catch (_) {}
}

/* ======================================================
   💳 CRON JOB: Cobranças Recorrentes Mensais
   
   Executa todo dia às 8h da manhã
   Cobra assinaturas que vencem hoje
===================================================== */

cron.schedule('0 8 * * *', async () => {
    logger.info('\n💰 [CRON RECORRENTE] Verificando cobranças mensais...');
    logger.info(`Data/Hora: ${new Date().toLocaleString('pt-BR')}`);
    
    try {
        // Buscar assinaturas que vencem hoje
        const result = await pool.query(`
            SELECT 
                e.id,
                e.nome,
                e.plano_id,
                e.proxima_cobranca,
                e.renovacao_automatica,
                p.preco_mensal,
                p.nome as plano_nome,
                u.email as email_responsavel,
                c.token as cartao_token,
                c.gateway,
                c.last4,
                c.brand
            FROM escritorios e
            JOIN planos p ON e.plano_id = p.id
            JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
            JOIN cartoes c ON c.escritorio_id = e.id
            WHERE 
                e.plano_financeiro_status = 'pago'
                AND e.proxima_cobranca IS NOT NULL
                AND e.proxima_cobranca <= CURRENT_DATE
                AND (e.renovacao_automatica IS NULL OR e.renovacao_automatica = true)
                AND COALESCE(u.is_master, false) = false
            ORDER BY e.proxima_cobranca ASC
        `);

        logger.info(`📊 [CRON RECORRENTE] Encontrados: ${result.rowCount} assinatura(s) para renovar`);

        if (result.rowCount === 0) {
            logger.info('   ✅ Nenhuma cobrança agendada para hoje\n');
            return;
        }

        let sucessos = 0;
        let falhas = 0;

        for (const escritorio of result.rows) {
            try {
                // Calcular valor em centavos
                const valorEmCentavos = Math.round(parseFloat(escritorio.preco_mensal) * 100);
                
                logger.info(`\n💳 [CRON RECORRENTE] Cobrando renovação: ${escritorio.nome}`);
                logger.info(`   Email: ${escritorio.email_responsavel}`);
                logger.info(`   Plano: ${escritorio.plano_nome}`);
                logger.info(`   Valor: R$ ${escritorio.preco_mensal}`);
                logger.info(`   Cartão: **** ${escritorio.last4} (${escritorio.brand})`);
                logger.info(`   Vencimento: ${new Date(escritorio.proxima_cobranca).toLocaleDateString('pt-BR')}`);
                
                let cobranca = await processarCobrancaCartao({
                    escritorioId: escritorio.id,
                    valor: valorEmCentavos,
                    cartaoToken: decrypt(escritorio.cartao_token),
                    gateway: escritorio.gateway,
                    descricao: `Renovação ${escritorio.plano_nome} - LawTech Pro`
                });

                // Failover: se falhou por erro de rede, tenta gateway alternativo
                if (!cobranca.sucesso && cobranca.erro) {
                    const alt = await tentarGatewayAlternativo({
                        escritorioId: escritorio.id,
                        gateway: escritorio.gateway,
                        erro: cobranca.erro
                    });
                    if (alt) {
                        cobranca = await processarCobrancaCartao({
                            escritorioId: escritorio.id,
                            valor: valorEmCentavos,
                            cartaoToken: alt.cartaoToken,
                            gateway: alt.gateway,
                            descricao: `Renovação ${escritorio.plano_nome} - LawTech Pro (failover)`
                        });
                    }
                }

                const client = await pool.connect();
                try {
                    if (cobranca.sucesso) {
                        await client.query('BEGIN');

                        // Verificação de idempotência
                        const jaExiste = await client.query(
                            'SELECT id FROM transacoes WHERE gateway_id = $1',
                            [cobranca.transacaoId]
                        );
                        if (jaExiste.rows.length > 0) {
                            await client.query('ROLLBACK');
                            logger.info(`   ℹ️ Transação já registrada: ${cobranca.transacaoId}`);
                            sucessos++;
                            continue;
                        }

                        await client.query(`
                            UPDATE escritorios
                            SET ultimo_pagamento = NOW(),
                                proxima_cobranca = NOW() + INTERVAL '1 month'
                            WHERE id = $1
                        `, [escritorio.id]);

                        await client.query(`
                            INSERT INTO transacoes
                            (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                            VALUES ($1, $2, $3, $4, 'aprovada', $5, NOW())
                        `, [
                            escritorio.id,
                            cobranca.transacaoId,
                            escritorio.gateway,
                            valorEmCentavos,
                            `Renovação mensal - ${escritorio.plano_nome}`
                        ]);

                        await client.query('COMMIT');
                        await invalidarCacheEscritorio(escritorio.id);
                        logger.info(`   ✅ RENOVAÇÃO APROVADA! ID: ${cobranca.transacaoId}`);
                        sucessos++;

                    } else {
                        await client.query('BEGIN');

                        await client.query(`
                            UPDATE escritorios
                            SET plano_financeiro_status = 'inadimplente',
                                proxima_cobranca = NOW() + INTERVAL '3 days'
                            WHERE id = $1
                        `, [escritorio.id]);

                        await client.query(`
                            INSERT INTO transacoes
                            (escritorio_id, gateway_id, gateway, valor, status, mensagem_erro, descricao, created_at)
                            VALUES ($1, $2, $3, $4, 'recusada', $5, $6, NOW())
                        `, [
                            escritorio.id,
                            cobranca.transacaoId || null,
                            escritorio.gateway,
                            valorEmCentavos,
                            cobranca.erro,
                            `Tentativa de renovação - ${escritorio.plano_nome}`
                        ]);

                        await client.query('COMMIT');
                        await invalidarCacheEscritorio(escritorio.id);
                        logger.info(`   ❌ COBRANÇA RECUSADA: ${cobranca.erro}`);
                        falhas++;
                    }
                } catch (txErr) {
                    await client.query('ROLLBACK');
                    logger.error(`   ❌ Erro na transação: ${txErr.message}`);
                    falhas++;
                } finally {
                    client.release();
                }

            } catch (err) {
                logger.error(`   ❌ ERRO ao processar escritório ${escritorio.id}:`, err.message);
                falhas++;
            }
        }

        logger.info(`\n📊 [CRON RECORRENTE] Resultado Final:`);
        logger.info(`   ✅ Aprovadas: ${sucessos}`);
        logger.info(`   ❌ Recusadas: ${falhas}`);
        logger.info(`   📊 Total: ${result.rowCount}\n`);

    } catch (err) {
        logger.error(`❌ [CRON RECORRENTE] Erro geral: ${err}`);
    }
});

/* ======================================================
   ⚠️ CRON: Lembrete 3 dias antes do vencimento
===================================================== */

cron.schedule('0 10 * * *', async () => {
    logger.info('\n📧 [CRON LEMBRETE] Enviando lembretes de cobrança...');
    
    try {
        const result = await pool.query(`
            SELECT 
                e.id, 
                e.nome, 
                e.proxima_cobranca,
                u.email,
                p.nome as plano_nome,
                p.preco_mensal,
                DATE_PART('day', e.proxima_cobranca - CURRENT_DATE) as dias_ate_vencimento
            FROM escritorios e
            JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
            JOIN planos p ON e.plano_id = p.id
            WHERE e.plano_financeiro_status = 'pago'
            AND e.proxima_cobranca = CURRENT_DATE + INTERVAL '3 days'
            AND (e.renovacao_automatica IS NULL OR e.renovacao_automatica = true)
        `);

        logger.info(`📊 [CRON LEMBRETE] ${result.rowCount} lembrete(s) para enviar`);

        for (const escritorio of result.rows) {
            logger.info(`📧 Lembrete: ${escritorio.email}`);
            logger.info(`   Cobrança em: ${new Date(escritorio.proxima_cobranca).toLocaleDateString('pt-BR')}`);
            logger.info(`   Valor: R$ ${escritorio.preco_mensal}`);
            
            // TODO: Enviar email de lembrete
            // await enviarEmailLembrete({
            //     email: escritorio.email,
            //     nome: escritorio.nome,
            //     plano: escritorio.plano_nome,
            //     valor: escritorio.preco_mensal,
            //     data_cobranca: escritorio.proxima_cobranca
            // });
        }

        logger.info('✅ [CRON LEMBRETE] Lembretes processados\n');

    } catch (err) {
        logger.error(`❌ [CRON LEMBRETE] Erro: ${err}`);
    }
});

/* ======================================================
   🔄 CRON: Retry de cobranças inadimplentes
===================================================== */

cron.schedule('0 14 * * *', async () => {
    logger.info('\n🔄 [CRON RETRY] Tentando reprocessar inadimplentes...');
    
    try {
        const result = await pool.query(`
            SELECT 
                e.id,
                e.nome,
                p.preco_mensal,
                p.nome as plano_nome,
                u.email,
                c.token as cartao_token,
                c.gateway,
                c.last4
            FROM escritorios e
            JOIN planos p ON e.plano_id = p.id
            JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
            JOIN cartoes c ON c.escritorio_id = e.id
            WHERE
                e.plano_financeiro_status = 'inadimplente'
                AND e.proxima_cobranca <= CURRENT_DATE
                AND (e.renovacao_automatica IS NULL OR e.renovacao_automatica = true)
                AND COALESCE(e.retry_count, 0) < 3
        `);

        logger.info(`📊 [CRON RETRY] ${result.rowCount} inadimplente(s) para tentar novamente`);

        for (const esc of result.rows) {
            logger.info(`🔄 Tentando: ${esc.email}`);
            
            const valorEmCentavos = Math.round(parseFloat(esc.preco_mensal) * 100);
            
            const cobranca = await processarCobrancaCartao({
                escritorioId: esc.id,
                valor: valorEmCentavos,
                cartaoToken: decrypt(esc.cartao_token),
                gateway: esc.gateway,
                descricao: `Retry - ${esc.plano_nome}`
            });

            const client = await pool.connect();
            try {
                if (cobranca.sucesso) {
                    await client.query('BEGIN');

                    const jaExiste = await client.query(
                        'SELECT id FROM transacoes WHERE gateway_id = $1',
                        [cobranca.transacaoId]
                    );
                    if (jaExiste.rows.length > 0) {
                        await client.query('ROLLBACK');
                        logger.info(`   ℹ️ Transação já registrada: ${cobranca.transacaoId}`);
                        continue;
                    }

                    await client.query(`
                        UPDATE escritorios
                        SET plano_financeiro_status = 'pago',
                            ultimo_pagamento = NOW(),
                            proxima_cobranca = NOW() + INTERVAL '1 month',
                            retry_count = 0
                        WHERE id = $1
                    `, [esc.id]);

                    await client.query(`
                        INSERT INTO transacoes
                        (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                        VALUES ($1, $2, $3, $4, 'aprovada', $5, NOW())
                    `, [esc.id, cobranca.transacaoId, esc.gateway, valorEmCentavos, `Retry bem-sucedido - ${esc.plano_nome}`]);

                    await client.query('COMMIT');
                    await invalidarCacheEscritorio(esc.id);
                    logger.info(`   ✅ APROVADO no retry!`);

                } else {
                    logger.info(`   ❌ Ainda recusado: ${cobranca.erro}`);
                    await client.query('BEGIN');
                    await client.query(`
                        UPDATE escritorios
                        SET proxima_cobranca = NOW() + INTERVAL '3 days',
                            retry_count = COALESCE(retry_count, 0) + 1
                        WHERE id = $1
                    `, [esc.id]);

                    await client.query(`
                        INSERT INTO transacoes
                        (escritorio_id, gateway_id, gateway, valor, status, mensagem_erro, descricao, created_at)
                        VALUES ($1, $2, $3, $4, 'recusada', $5, $6, NOW())
                    `, [
                        esc.id,
                        cobranca.transacaoId || null,
                        esc.gateway,
                        valorEmCentavos,
                        cobranca.erro,
                        `Retry inadimplente - ${esc.plano_nome}`
                    ]);
                    await client.query('COMMIT');
                }
            } catch (txErr) {
                await client.query('ROLLBACK');
                logger.error(`   ❌ Erro na transação retry: ${txErr.message}`);
            } finally {
                client.release();
            }
        }

        logger.info('✅ [CRON RETRY] Retries processados\n');

    } catch (err) {
        logger.error(`❌ [CRON RETRY] Erro: ${err}`);
    }
});


/* ======================================================
   LOGS DE INICIALIZAÇÃO
===================================================== */

logger.info('\n✅ [CRON] Sistema de cobranças recorrentes iniciado');
logger.info('   ⏰ 08:00 - Processar renovações mensais');
logger.info('   ⏰ 10:00 - Enviar lembretes (3 dias antes)');
logger.info('   ⏰ 14:00 - Retry de inadimplentes');
logger.info(`   Ambiente: ${process.env.ASAAS_ENV || 'production'}`);
logger.info(`   Data atual: ${new Date().toLocaleDateString('pt-BR')}`);

module.exports = {};