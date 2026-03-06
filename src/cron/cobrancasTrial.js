const cron = require('node-cron');
const pool = require('../config/db');
const axios = require('axios');
const { decrypt } = require('../utils/crypto');
const { tentarGatewayAlternativo } = require('../utils/gatewayFailover');
const { enviarEmailCobrancaPix } = require('../services/emailService');
const { getAsaasHeaders, processarCobrancaCartao, ASAAS_BASE_URL } = require('../services/chargeService');
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

/* ✅ CORREÇÃO 1: Cobra NO DIA que expira (não 1 dia antes) */
cron.schedule('0 6 * * *', async () => {
    let cronLockAtivo = false;
    try {
        const { rows: lr } = await pool.query('SELECT pg_try_advisory_lock($1) as locked', [1001]);
        cronLockAtivo = lr[0].locked;
    } catch (lockErr) {
        logger.error({ err: lockErr.message }, '[CRON TRIAL] Erro ao adquirir lock');
        return;
    }
    if (!cronLockAtivo) {
        logger.info('[CRON TRIAL] Outra instância já em execução — pulando.');
        return;
    }

    logger.info('\n🔔 [CRON TRIAL] Verificando cobranças...');

    try {
        // ─── Escritórios com preferência CARTÃO que têm cartão salvo ───
        const resultCartao = await pool.query(`
            SELECT
                e.id, e.nome, e.plano_id, e.trial_expira_em,
                p.preco_mensal, p.nome as plano_nome,
                u.email as email_responsavel,
                c.token as cartao_token,
                c.asaas_card_token,
                c.gateway, c.last4, c.brand
            FROM escritorios e
            JOIN planos p ON e.plano_id = p.id
            JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
            JOIN cartoes c ON c.escritorio_id = e.id
            WHERE e.plano_financeiro_status = 'trial'
            AND e.trial_expira_em = CURRENT_DATE
            AND COALESCE(e.preferencia_pagamento, 'cartao') = 'cartao'
            AND COALESCE(u.is_master, false) = false
        `);

        // ─── Escritórios com preferência PIX (sem necessidade de cartão) ───
        const resultPix = await pool.query(`
            SELECT
                e.id, e.nome, e.plano_id, e.trial_expira_em, e.documento,
                p.preco_mensal, p.nome as plano_nome,
                u.email as email_responsavel
            FROM escritorios e
            JOIN planos p ON e.plano_id = p.id
            JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
            WHERE e.plano_financeiro_status = 'trial'
            AND e.trial_expira_em = CURRENT_DATE
            AND COALESCE(e.preferencia_pagamento, 'cartao') = 'pix'
            AND COALESCE(u.is_master, false) = false
        `);

        logger.info(`📊 Cartão: ${resultCartao.rowCount} | PIX: ${resultPix.rowCount}`);

        // ══════════════════════════════════════════
        // FLUXO CARTÃO — cobrança automática
        // ══════════════════════════════════════════
        let sucessos = 0, falhas = 0;

        for (const esc of resultCartao.rows) {
            try {
                const valorCentavos = Math.round(parseFloat(esc.preco_mensal) * 100);
                logger.info(`\n💳 [CARTÃO] Cobrando: ${esc.nome} - R$ ${esc.preco_mensal}`);

                let cobranca = await processarCobrancaCartao({
                    escritorioId: esc.id,
                    valor: valorCentavos,
                    cartaoToken: decrypt(esc.cartao_token),
                    asaasCardToken: esc.asaas_card_token ? decrypt(esc.asaas_card_token) : null,
                    gateway: esc.gateway,
                    descricao: `Assinatura ${esc.plano_nome}`,
                    emailResponsavel: esc.email_responsavel,
                    planoNome: esc.plano_nome
                });

                if (!cobranca.sucesso && cobranca.erro) {
                    const alt = await tentarGatewayAlternativo({
                        escritorioId: esc.id,
                        gateway: esc.gateway,
                        erro: cobranca.erro
                    });
                    if (alt) {
                        cobranca = await processarCobrancaCartao({
                            escritorioId: esc.id,
                            valor: valorCentavos,
                            cartaoToken: alt.cartaoToken,
                            gateway: alt.gateway,
                            descricao: `Assinatura ${esc.plano_nome} (failover)`,
                            emailResponsavel: esc.email_responsavel,
                            planoNome: esc.plano_nome
                        });
                    }
                }

                if (cobranca.sucesso) {
                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');
                        const jaExiste = await client.query(
                            'SELECT id FROM transacoes WHERE gateway_id = $1',
                            [cobranca.transacaoId]
                        );
                        if (jaExiste.rows.length > 0) {
                            await client.query('ROLLBACK');
                            logger.info(`ℹ️ Transação já registrada: ${cobranca.transacaoId}`);
                            sucessos++;
                            continue;
                        }
                        await client.query(`
                            UPDATE escritorios
                            SET plano_financeiro_status = 'pago',
                                ultimo_pagamento = NOW(),
                                proxima_cobranca = NOW() + INTERVAL '1 month',
                                trial_expira_em = NULL
                            WHERE id = $1
                        `, [esc.id]);
                        await client.query(`
                            INSERT INTO transacoes
                            (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                            VALUES ($1, $2, $3, $4, 'aprovada', $5, NOW())
                        `, [esc.id, cobranca.transacaoId, esc.gateway, valorCentavos, `Primeira cobrança - ${esc.plano_nome}`]);
                        await client.query('COMMIT');
                        await invalidarCacheEscritorio(esc.id);
                        logger.info(`✅ APROVADO! ID: ${cobranca.transacaoId}`);
                        sucessos++;
                    } catch (txErr) {
                        await client.query('ROLLBACK');
                        logger.error(`❌ Erro na transação: ${txErr.message}`);
                        falhas++;
                    } finally {
                        client.release();
                    }
                } else {
                    await pool.query(`UPDATE escritorios SET plano_financeiro_status = 'inadimplente' WHERE id = $1`, [esc.id]);
                    await invalidarCacheEscritorio(esc.id);
                    logger.info(`❌ RECUSADO: ${cobranca.erro}`);
                    falhas++;
                }
            } catch (err) {
                logger.error(`❌ Erro cartão: ${err.message}`);
                falhas++;
            }
        }

        // ══════════════════════════════════════════
        // FLUXO PIX — gera QR e envia e-mail
        // ══════════════════════════════════════════
        const DIAS_PARA_SUSPENSAO = 3;

        for (const esc of resultPix.rows) {
            try {
                logger.info(`\n🔵 [PIX] Gerando cobrança: ${esc.nome}`);

                if (!esc.documento) {
                    logger.warn(`⚠️ [PIX] ${esc.nome} sem CPF/CNPJ — pulando`);
                    continue;
                }

                // Criar/buscar cliente ASAAS
                const docLimpo = esc.documento.replace(/\D/g, '');
                const buscaCliente = await axios.get(`${ASAAS_BASE_URL}/customers`, {
                    headers: getAsaasHeaders(),
                    params: { cpfCnpj: docLimpo }
                });
                let customerId;
                if (buscaCliente.data.data && buscaCliente.data.data.length > 0) {
                    customerId = buscaCliente.data.data[0].id;
                } else {
                    const novoCliente = await axios.post(`${ASAAS_BASE_URL}/customers`, {
                        name: esc.nome,
                        email: esc.email_responsavel,
                        cpfCnpj: docLimpo,
                        notificationDisabled: true
                    }, { headers: getAsaasHeaders() });
                    customerId = novoCliente.data.id;
                }

                // Data de vencimento = hoje + DIAS_PARA_SUSPENSAO
                const vencimento = new Date();
                vencimento.setDate(vencimento.getDate() + DIAS_PARA_SUSPENSAO);
                const vencimentoStr = vencimento.toISOString().split('T')[0];

                // Idempotência: verificar se já existe PIX gerado hoje para este escritório
                const pixExistente = await pool.query(
                    `SELECT id FROM transacoes
                     WHERE escritorio_id = $1 AND status = 'pix_pendente'
                     AND DATE(created_at) = CURRENT_DATE`,
                    [esc.id]
                );
                if (pixExistente.rows.length > 0) {
                    logger.info(`[PIX] QR já gerado hoje para ${esc.nome} — pulando`);
                    continue;
                }

                // Criar cobrança PIX
                const pagRes = await axios.post(`${ASAAS_BASE_URL}/payments`, {
                    customer: customerId,
                    billingType: 'PIX',
                    value: parseFloat(esc.preco_mensal),
                    dueDate: vencimentoStr,
                    description: `${esc.plano_nome} - LawTech Pro`,
                    externalReference: String(esc.id)
                }, { headers: getAsaasHeaders() });

                const cobrancaId = pagRes.data.id;

                // Registrar transação imediatamente — garante idempotência em caso de crash
                await pool.query(
                    `INSERT INTO transacoes
                     (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                     VALUES ($1, $2, 'asaas', $3, 'pix_pendente', $4, NOW())`,
                    [esc.id, cobrancaId, parseFloat(esc.preco_mensal), `PIX Trial - ${esc.plano_nome}`]
                );

                // Buscar QR Code
                const qrRes = await axios.get(
                    `${ASAAS_BASE_URL}/payments/${cobrancaId}/pixQrCode`,
                    { headers: getAsaasHeaders() }
                );

                // Enviar e-mail com QR Code
                await enviarEmailCobrancaPix(esc.email_responsavel, {
                    nomeEscritorio: esc.nome,
                    planoNome: esc.plano_nome,
                    valor: esc.preco_mensal,
                    pixQrCodeBase64: qrRes.data.encodedImage,
                    pixPayload: qrRes.data.payload,
                    diasParaSuspensao: DIAS_PARA_SUSPENSAO
                });

                // Marca como inadimplente para deixar de renovar trial
                // Conta continua acessível por DIAS_PARA_SUSPENSAO dias via verificação de cobrança
                await pool.query(`
                    UPDATE escritorios
                    SET plano_financeiro_status = 'inadimplente',
                        trial_expira_em = NULL
                    WHERE id = $1
                `, [esc.id]);

                await invalidarCacheEscritorio(esc.id);
                logger.info(`✅ [PIX] Cobrança ${cobrancaId} gerada e e-mail enviado para ${esc.email_responsavel}`);
                sucessos++;
            } catch (err) {
                logger.error(`❌ Erro PIX ${esc.nome}: ${err.response?.data?.errors?.[0]?.description || err.message}`);
                falhas++;
            }
        }

        if (resultCartao.rowCount + resultPix.rowCount === 0) {
            logger.info('✅ Nenhum trial para processar hoje\n');
            return;
        }

        logger.info(`\n📊 Resultado: ✅ ${sucessos} processados | ❌ ${falhas} falhas\n`);

    } catch (err) {
        logger.error(`❌ [CRON] Erro: ${err}`);
    } finally {
        if (cronLockAtivo) await pool.query('SELECT pg_advisory_unlock($1)', [1001]).catch(() => {});
    }
});

cron.schedule('0 9 * * *', async () => {
    logger.info('\n⚠️ [CRON] Enviando avisos (2 dias antes)...');
    
    try {
        const result = await pool.query(`
            SELECT e.nome, u.email, p.nome as plano_nome
            FROM escritorios e
            JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
            JOIN planos p ON e.plano_id = p.id
            WHERE e.plano_financeiro_status = 'trial'
            AND e.trial_expira_em = CURRENT_DATE + INTERVAL '2 days'
        `);

        logger.info(`📧 ${result.rowCount} aviso(s) para enviar`);
        for (const esc of result.rows) {
            logger.info(`📧 Aviso: ${esc.email}`);
            // TODO: Implementar email
        }
        logger.info('✅ Avisos processados\n');
    } catch (err) {
        logger.error(`❌ Erro: ${err}`);
    }
});


logger.info('\n✅ [CRON TRIAL] Sistema iniciado (CORRIGIDO)');
logger.info('   ⏰ 06:00 - Cobrar trials que expiram HOJE');
logger.info('   ⏰ 09:00 - Avisar trials (2 dias antes)');
logger.info(`   Ambiente: ${process.env.ASAAS_ENV || 'production'}`);

module.exports = {};