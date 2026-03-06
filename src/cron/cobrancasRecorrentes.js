const cron = require('node-cron');
const pool = require('../config/db');
const { decrypt } = require('../utils/crypto');
const { tentarGatewayAlternativo } = require('../utils/gatewayFailover');
const { processarCobrancaCartao } = require('../services/chargeService');
const { enviarEmail } = require('../services/emailService');
const logger = require('../utils/logger');
const cache = require('../utils/cache');

// Dunning schedule: intervalos em dias após cada falha
// D+2 → D+5 → D+7 → Suspensão
const DUNNING_INTERVALS_DIAS = [2, 3, 2]; // índice = retry_count na falha atual

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
    let cronLockAtivo = false;
    try {
        const { rows: lr } = await pool.query('SELECT pg_try_advisory_lock($1) as locked', [1002]);
        cronLockAtivo = lr[0].locked;
    } catch (lockErr) {
        logger.error({ err: lockErr.message }, '[CRON RECORRENTE] Erro ao adquirir lock');
        return;
    }
    if (!cronLockAtivo) {
        logger.info('[CRON RECORRENTE] Outra instância já em execução — pulando.');
        return;
    }

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
                                proxima_cobranca = NOW() + INTERVAL '2 days',
                                retry_count = 0
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

                        // Email: avisa que a cobrança falhou e haverá nova tentativa em 2 dias
                        await enviarEmail({
                            para: escritorio.email_responsavel,
                            assunto: '⚠️ Falha na renovação — LawTech Pro',
                            html: `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
                                <div style="background:#1E3A5F;padding:24px;text-align:center;">
                                    <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:160px;height:auto;" />
                                </div>
                                <div style="padding:28px 24px;background:#fff;">
                                    <h2 style="color:#b91c1c;margin:0 0 16px;">Não foi possível renovar sua assinatura</h2>
                                    <p style="color:#374151;font-size:14px;">Olá, <strong>${escritorio.nome}</strong>! Tentamos cobrar sua assinatura do plano <strong>${escritorio.plano_nome}</strong> (R$ ${escritorio.preco_mensal}/mês) mas o pagamento foi recusado.</p>
                                    <p style="color:#374151;font-size:14px;">Faremos uma nova tentativa automaticamente <strong>em 2 dias</strong>. Enquanto isso, verifique os dados do seu cartão em Configurações → Pagamento.</p>
                                    <p style="color:#6b7280;font-size:12px;margin-top:24px;">Tentativa 1 de 3. Em caso de dúvidas, entre em contato: contato@lawtechpro.com.br</p>
                                </div>
                            </div>`
                        }).catch(() => {});

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
    } finally {
        if (cronLockAtivo) await pool.query('SELECT pg_advisory_unlock($1)', [1002]).catch(() => {});
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
    let cronLockAtivo = false;
    try {
        const { rows: lr } = await pool.query('SELECT pg_try_advisory_lock($1) as locked', [1003]);
        cronLockAtivo = lr[0].locked;
    } catch (lockErr) {
        logger.error({ err: lockErr.message }, '[CRON RETRY] Erro ao adquirir lock');
        return;
    }
    if (!cronLockAtivo) {
        logger.info('[CRON RETRY] Outra instância já em execução — pulando.');
        return;
    }

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
                c.last4,
                COALESCE(e.retry_count, 0) as retry_count
            FROM escritorios e
            JOIN planos p ON e.plano_id = p.id
            JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
            JOIN cartoes c ON c.escritorio_id = e.id
            WHERE
                e.plano_financeiro_status = 'inadimplente'
                AND e.proxima_cobranca <= CURRENT_DATE
                AND (e.renovacao_automatica IS NULL OR e.renovacao_automatica = true)
                AND COALESCE(e.retry_count, 0) < 3
            ORDER BY e.proxima_cobranca ASC
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
                    const retryAtual = esc.retry_count; // 0, 1 ou 2
                    logger.info(`   ❌ Ainda recusado (tentativa ${retryAtual + 1}/3): ${cobranca.erro}`);

                    await client.query('BEGIN');

                    if (retryAtual >= 2) {
                        // 3ª falha — suspender a conta
                        await client.query(`
                            UPDATE escritorios
                            SET plano_financeiro_status = 'suspenso',
                                proxima_cobranca = NULL,
                                retry_count = 3
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
                            `Retry 3 recusado — conta suspensa - ${esc.plano_nome}`
                        ]);

                        await client.query('COMMIT');
                        await invalidarCacheEscritorio(esc.id);
                        logger.warn(`   🔴 CONTA SUSPENSA: ${esc.email} após 3 falhas`);

                        await enviarEmail({
                            para: esc.email,
                            assunto: '🚨 Conta suspensa — LawTech Pro',
                            html: `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
                                <div style="background:#1E3A5F;padding:24px;text-align:center;">
                                    <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:160px;height:auto;" />
                                </div>
                                <div style="padding:28px 24px;background:#fff;">
                                    <h2 style="color:#7f1d1d;margin:0 0 16px;">Sua conta foi suspensa</h2>
                                    <p style="color:#374151;font-size:14px;">Olá, <strong>${esc.nome}</strong>. Realizamos 3 tentativas de cobrança do plano <strong>${esc.plano_nome}</strong> (R$ ${esc.preco_mensal}/mês), mas todas foram recusadas.</p>
                                    <p style="color:#374151;font-size:14px;">Seu acesso ao LawTech Pro está <strong>temporariamente suspenso</strong>. Para reativar, atualize seu cartão em Configurações → Pagamento ou entre em contato conosco.</p>
                                    <p style="color:#6b7280;font-size:12px;margin-top:24px;">Precisa de ajuda? contato@lawtechpro.com.br</p>
                                </div>
                            </div>`
                        }).catch(() => {});

                    } else {
                        // 1ª ou 2ª falha — agendar próxima tentativa com intervalo do dunning
                        const proximoIntervaloDias = DUNNING_INTERVALS_DIAS[retryAtual + 1];
                        const tentativaNum = retryAtual + 2;
                        const proximaTentativa = new Date();
                        proximaTentativa.setDate(proximaTentativa.getDate() + proximoIntervaloDias);

                        await client.query(`
                            UPDATE escritorios
                            SET proxima_cobranca = NOW() + ($2 * INTERVAL '1 day'),
                                retry_count = $3
                            WHERE id = $1
                        `, [esc.id, proximoIntervaloDias, retryAtual + 1]);

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
                            `Retry ${retryAtual + 1} recusado - ${esc.plano_nome}`
                        ]);

                        await client.query('COMMIT');
                        logger.info(`   ⚠️ Agendando tentativa ${tentativaNum}/3 em ${proximoIntervaloDias} dias (${proximaTentativa.toLocaleDateString('pt-BR')})`);

                        await enviarEmail({
                            para: esc.email,
                            assunto: `⚠️ Nova tentativa de cobrança em ${proximoIntervaloDias} dias — LawTech Pro`,
                            html: `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
                                <div style="background:#1E3A5F;padding:24px;text-align:center;">
                                    <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:160px;height:auto;" />
                                </div>
                                <div style="padding:28px 24px;background:#fff;">
                                    <h2 style="color:#b91c1c;margin:0 0 16px;">Cobrança recusada — nova tentativa agendada</h2>
                                    <p style="color:#374151;font-size:14px;">Olá, <strong>${esc.nome}</strong>. A tentativa de cobrança do plano <strong>${esc.plano_nome}</strong> (R$ ${esc.preco_mensal}/mês) foi recusada novamente.</p>
                                    <p style="color:#374151;font-size:14px;">Faremos mais uma tentativa em <strong>${proximoIntervaloDias} dias</strong> (${proximaTentativa.toLocaleDateString('pt-BR')}). Atualize seu cartão em Configurações → Pagamento para evitar a suspensão da conta.</p>
                                    <p style="color:#6b7280;font-size:12px;margin-top:24px;">Tentativa ${retryAtual + 1} de 3. Dúvidas? contato@lawtechpro.com.br</p>
                                </div>
                            </div>`
                        }).catch(() => {});
                    }
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
    } finally {
        if (cronLockAtivo) await pool.query('SELECT pg_advisory_unlock($1)', [1003]).catch(() => {});
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