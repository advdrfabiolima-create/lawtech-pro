const cron = require('node-cron');
const pool = require('../config/db');
const axios = require('axios');
const { decrypt } = require('../utils/crypto');
const { tentarGatewayAlternativo } = require('../utils/gatewayFailover');
const { enviarEmailCobrancaPix, enviarEmail } = require('../services/emailService');
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

/* [OK] CORREÇÃO 1: Cobra NO DIA que expira (não 1 dia antes) */
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

    logger.info('\n[CRON] [CRON TRIAL] Verificando cobranças...');

    try {
        // ─── Escritórios com preferência CARTÃO que têm cartão salvo ───
        // [A-4] Claim rows com SELECT FOR UPDATE SKIP LOCKED
        const claimTrialClient = await pool.connect();
        let claimedTrialCartaoIds = [];
        try {
            await claimTrialClient.query('BEGIN');
            const claimedCartao = await claimTrialClient.query(`
                SELECT e.id FROM escritorios e
                JOIN planos p ON e.plano_id = p.id
                JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
                JOIN cartoes c ON c.escritorio_id = e.id
                WHERE e.plano_financeiro_status = 'trial'
                  AND e.trial_expira_em = CURRENT_DATE
                  AND COALESCE(e.preferencia_pagamento, 'cartao') = 'cartao'
                  AND COALESCE(u.is_master, false) = false
                FOR UPDATE OF e SKIP LOCKED
            `);
            claimedTrialCartaoIds = claimedCartao.rows.map(r => r.id);
            if (claimedTrialCartaoIds.length > 0) {
                // Claim: remover trial_expira_em para prevenir re-seleção durante processamento
                await claimTrialClient.query(
                    `UPDATE escritorios SET trial_expira_em = NULL WHERE id = ANY($1) AND plano_financeiro_status = 'trial'`,
                    [claimedTrialCartaoIds]
                );
            }
            await claimTrialClient.query('COMMIT');
        } catch (claimErr) {
            await claimTrialClient.query('ROLLBACK').catch(() => {});
            logger.error({ err: claimErr.message }, '[CRON TRIAL] Erro ao adquirir locks cartão — abortando');
            return;
        } finally {
            claimTrialClient.release();
        }

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
            WHERE e.id = ANY($1)
            ORDER BY e.id
        `, [claimedTrialCartaoIds.length > 0 ? claimedTrialCartaoIds : [0]]);

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

        logger.info(`[STATS] Cartão: ${resultCartao.rowCount} | PIX: ${resultPix.rowCount}`);

        // ══════════════════════════════════════════
        // FLUXO CARTÃO — cobrança automática
        // ══════════════════════════════════════════
        let sucessos = 0, falhas = 0;

        for (const esc of resultCartao.rows) {
            try {
                const valorCentavos = Math.round(parseFloat(esc.preco_mensal) * 100);
                logger.info(`\n[CARTAO] [CARTÃO] Cobrando: ${esc.nome} - R$ ${esc.preco_mensal}`);

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
                            logger.info(`[INFO] Transação já registrada: ${cobranca.transacaoId}`);
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
                        logger.info(`[OK] APROVADO! ID: ${cobranca.transacaoId}`);
                        sucessos++;
                    } catch (txErr) {
                        await client.query('ROLLBACK');
                        logger.error(`[ERRO] Erro na transação: ${txErr.message}`);
                        falhas++;
                    } finally {
                        client.release();
                    }
                } else {
                    await pool.query(`UPDATE escritorios SET plano_financeiro_status = 'inadimplente' WHERE id = $1`, [esc.id]);
                    await invalidarCacheEscritorio(esc.id);
                    logger.info(`[ERRO] RECUSADO: ${cobranca.erro}`);
                    falhas++;
                }
            } catch (err) {
                logger.error(`[ERRO] Erro cartão: ${err.message}`);
                falhas++;
            }
        }

        // ══════════════════════════════════════════
        // FLUXO PIX — gera QR e envia e-mail
        // ══════════════════════════════════════════
        const DIAS_PARA_SUSPENSAO = 3;

        for (const esc of resultPix.rows) {
            try {
                logger.info(`\n[PIX] [PIX] Gerando cobrança: ${esc.nome}`);

                if (!esc.documento) {
                    logger.warn(`[AVISO] [PIX] ${esc.nome} sem CPF/CNPJ — pulando`);
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
                    externalReference: `escritorio_${esc.id}_plano_${esc.plano_id}`
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
                logger.info(`[OK] [PIX] Cobrança ${cobrancaId} gerada e e-mail enviado para ${esc.email_responsavel}`);
                sucessos++;
            } catch (err) {
                logger.error(`[ERRO] Erro PIX ${esc.nome}: ${err.response?.data?.errors?.[0]?.description || err.message}`);
                falhas++;
            }
        }

        if (resultCartao.rowCount + resultPix.rowCount === 0) {
            logger.info('[OK] Nenhum trial para processar hoje\n');
            return;
        }

        logger.info(`\n[STATS] Resultado: [OK] ${sucessos} processados | [ERRO] ${falhas} falhas\n`);

    } catch (err) {
        logger.error(`[ERRO] [CRON] Erro: ${err}`);
    } finally {
        if (cronLockAtivo) await pool.query('SELECT pg_advisory_unlock($1)', [1001]).catch(() => {});
    }
});

cron.schedule('0 9 * * *', async () => {
    logger.info('\n[AVISO] [CRON] Enviando avisos (2 dias antes)...');
    
    try {
        const result = await pool.query(`
            SELECT e.nome, e.trial_expira_em, u.email, p.nome as plano_nome
            FROM escritorios e
            JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
            JOIN planos p ON e.plano_id = p.id
            WHERE e.plano_financeiro_status = 'trial'
            AND e.trial_expira_em = CURRENT_DATE + INTERVAL '2 days'
        `);

        logger.info(`[EMAIL] ${result.rowCount} aviso(s) para enviar`);
        for (const esc of result.rows) {
            logger.info(`[EMAIL] Aviso: ${esc.email}`);
            const dataExpiracao = new Date(esc.trial_expira_em).toLocaleDateString('pt-BR');
            enviarEmail({
                para: esc.email,
                assunto: `[AVISO] Seu período de teste expira em 2 dias — LawTech Pro`,
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
                        <h2 style="color:#f59e0b;">Seu trial está quase encerrando</h2>
                        <p>Olá, <strong>${esc.nome}</strong>!</p>
                        <p>Seu período de teste gratuito do plano <strong>${esc.plano_nome}</strong> expira em <strong>${dataExpiracao}</strong>.</p>
                        <p>Para continuar utilizando o LawTech Pro sem interrupções, assine agora.</p>
                        <div style="text-align:center;margin:30px 0;">
                            <a href="${process.env.BASE_URL || 'https://www.lawtechpro.com.br'}/planos-page"
                               style="background:#f59e0b;color:#000;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;">
                                Ver Planos e Preços
                            </a>
                        </div>
                        <p style="color:#64748b;font-size:13px;">Após a expiração você terá 3 dias de período de graça antes do bloqueio total.</p>
                    </div>
                `
            }).catch(e => logger.warn({ err: e.message, email: esc.email }, '[CRON TRIAL] Falha ao enviar aviso'));
        }
        logger.info('[OK] Avisos processados\n');
    } catch (err) {
        logger.error(`[ERRO] Erro: ${err}`);
    }
});


logger.info('\n[OK] [CRON TRIAL] Sistema iniciado (CORRIGIDO)');
logger.info('   [HORA] 06:00 - Cobrar trials que expiram HOJE');
logger.info('   [HORA] 09:00 - Avisar trials (2 dias antes)');
logger.info(`   Ambiente: ${process.env.ASAAS_ENV || 'production'}`);

module.exports = {};