const cron = require('node-cron');
const pool = require('../config/db');
const axios = require('axios');
const { decrypt } = require('../utils/crypto');
const { withRetry } = require('../utils/retry');
const { tentarGatewayAlternativo } = require('../utils/gatewayFailover');
const { enviarEmailCobrancaPix } = require('../services/emailService');

const ASAAS_ENV = process.env.ASAAS_ENV || 'production';
const ASAAS_BASE_URL = ASAAS_ENV === 'sandbox' 
  ? 'https://sandbox.asaas.com/api/v3'
  : 'https://api.asaas.com/v3';

const getAsaasHeaders = () => ({
  'access_token': process.env.ASAAS_API_KEY,
  'Content-Type': 'application/json'
});

/* ✅ CORREÇÃO 1: Cobra NO DIA que expira (não 1 dia antes) */
cron.schedule('0 6 * * *', async () => {
    console.log('\n🔔 [CRON TRIAL] Verificando cobranças...');

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

        console.log(`📊 Cartão: ${resultCartao.rowCount} | PIX: ${resultPix.rowCount}`);

        // ══════════════════════════════════════════
        // FLUXO CARTÃO — cobrança automática
        // ══════════════════════════════════════════
        let sucessos = 0, falhas = 0;

        for (const esc of resultCartao.rows) {
            try {
                const valorCentavos = Math.round(parseFloat(esc.preco_mensal) * 100);
                console.log(`\n💳 [CARTÃO] Cobrando: ${esc.nome} - R$ ${esc.preco_mensal}`);

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
                            console.log(`ℹ️ Transação já registrada: ${cobranca.transacaoId}`);
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
                        console.log(`✅ APROVADO! ID: ${cobranca.transacaoId}`);
                        sucessos++;
                    } catch (txErr) {
                        await client.query('ROLLBACK');
                        console.error(`❌ Erro na transação: ${txErr.message}`);
                        falhas++;
                    } finally {
                        client.release();
                    }
                } else {
                    await pool.query(`UPDATE escritorios SET plano_financeiro_status = 'inadimplente' WHERE id = $1`, [esc.id]);
                    console.log(`❌ RECUSADO: ${cobranca.erro}`);
                    falhas++;
                }
            } catch (err) {
                console.error(`❌ Erro cartão: ${err.message}`);
                falhas++;
            }
        }

        // ══════════════════════════════════════════
        // FLUXO PIX — gera QR e envia e-mail
        // ══════════════════════════════════════════
        const DIAS_PARA_SUSPENSAO = 3;

        for (const esc of resultPix.rows) {
            try {
                console.log(`\n🔵 [PIX] Gerando cobrança: ${esc.nome}`);

                if (!esc.documento) {
                    console.warn(`⚠️ [PIX] ${esc.nome} sem CPF/CNPJ — pulando`);
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

                console.log(`✅ [PIX] Cobrança ${cobrancaId} gerada e e-mail enviado para ${esc.email_responsavel}`);
                sucessos++;
            } catch (err) {
                console.error(`❌ Erro PIX ${esc.nome}: ${err.response?.data?.errors?.[0]?.description || err.message}`);
                falhas++;
            }
        }

        if (resultCartao.rowCount + resultPix.rowCount === 0) {
            console.log('✅ Nenhum trial para processar hoje\n');
            return;
        }

        console.log(`\n📊 Resultado: ✅ ${sucessos} processados | ❌ ${falhas} falhas\n`);

    } catch (err) {
        console.error('❌ [CRON] Erro:', err);
    }
});

cron.schedule('0 9 * * *', async () => {
    console.log('\n⚠️ [CRON] Enviando avisos (2 dias antes)...');
    
    try {
        const result = await pool.query(`
            SELECT e.nome, u.email, p.nome as plano_nome
            FROM escritorios e
            JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
            JOIN planos p ON e.plano_id = p.id
            WHERE e.plano_financeiro_status = 'trial'
            AND e.trial_expira_em = CURRENT_DATE + INTERVAL '2 days'
        `);

        console.log(`📧 ${result.rowCount} aviso(s) para enviar`);
        for (const esc of result.rows) {
            console.log(`📧 Aviso: ${esc.email}`);
            // TODO: Implementar email
        }
        console.log('✅ Avisos processados\n');
    } catch (err) {
        console.error('❌ Erro:', err);
    }
});

/* ✅ CORREÇÃO CRÍTICA: Stripe Payment Method */
async function cobrarViaStripe(cardToken, valor, descricao, metadata) {
    try {
        if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY não configurado');

        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        // ✅ PASSO 1: Criar PaymentMethod a partir do token
        let paymentMethodId;
        
        if (cardToken.startsWith('tok_')) {
            const paymentMethod = await stripe.paymentMethods.create({
                type: 'card',
                card: { token: cardToken }
            });
            paymentMethodId = paymentMethod.id;
        } else {
            paymentMethodId = cardToken;
        }

        // ✅ PASSO 2: Criar PaymentIntent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: valor,
            currency: 'brl',
            payment_method: paymentMethodId,
            confirm: true,
            description: descricao,
            metadata: {
                escritorio_id: String(metadata.escritorioId),
                plano: metadata.planoNome,
                email: metadata.emailResponsavel
            },
            automatic_payment_methods: {
                enabled: true,
                allow_redirects: 'never'
            }
        });

        const sucesso = paymentIntent.status === 'succeeded';

        return {
            sucesso,
            transacaoId: paymentIntent.id,
            erro: sucesso ? null : (paymentIntent.last_payment_error?.message || 'Erro desconhecido')
        };

    } catch (err) {
        return { sucesso: false, transacaoId: null, erro: err.message };
    }
}

/* ✅ CORREÇÃO CRÍTICA: Asaas creditCard/creditCardToken */
async function cobrarViaAsaas(customerId, cardToken, valor, descricao, escritorioId) {
    try {
        // ✅ PASSO 1: Buscar token do cartão
        const cartaoResult = await pool.query(
            'SELECT asaas_card_token FROM cartoes WHERE escritorio_id = $1',
            [escritorioId]
        );

        if (cartaoResult.rows.length === 0) {
            throw new Error('Nenhum cartão cadastrado');
        }

        const creditCardToken = cartaoResult.rows[0].asaas_card_token || cardToken;

        if (!creditCardToken) {
            throw new Error('Token do cartão não encontrado');
        }

        // ✅ PASSO 2: Criar cobrança com creditCardToken
        const response = await axios.post(
            `${ASAAS_BASE_URL}/payments`,
            {
                customer: customerId,
                billingType: 'CREDIT_CARD',
                value: valor / 100,
                dueDate: new Date().toISOString().split('T')[0],
                description: descricao,
                externalReference: String(escritorioId),
                creditCardToken: creditCardToken // ✅ ADICIONADO
            },
            { headers: getAsaasHeaders() }
        );

        const aprovado = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(response.data.status);

        return {
            sucesso: aprovado,
            transacaoId: response.data.id,
            erro: aprovado ? null : `Status: ${response.data.status}`
        };

    } catch (err) {
        const msgErro = err.response?.data?.errors?.[0]?.description || err.message;
        return { sucesso: false, transacaoId: null, erro: msgErro };
    }
}

async function processarCobrancaCartao({
    escritorioId, valor, cartaoToken, asaasCardToken, gateway, descricao, emailResponsavel, planoNome
}) {
    console.log(`   🔄 Processando via ${gateway.toUpperCase()}...`);

    try {
        return await withRetry(async () => {
            if (gateway === 'stripe') {
                return await cobrarViaStripe(cartaoToken, valor, descricao, {
                    escritorioId, emailResponsavel, planoNome
                });
            } else if (gateway === 'asaas') {
                return await cobrarViaAsaas(cartaoToken, asaasCardToken, valor, descricao, escritorioId);
            } else {
                throw new Error('Gateway não suportado: ' + gateway);
            }
        }, { maxRetries: 2, baseDelay: 2000 });
    } catch (err) {
        console.error(`   ❌ Erro:`, err.message);
        return { sucesso: false, transacaoId: null, erro: err.message };
    }
}

console.log('\n✅ [CRON TRIAL] Sistema iniciado (CORRIGIDO)');
console.log('   ⏰ 06:00 - Cobrar trials que expiram HOJE');
console.log('   ⏰ 09:00 - Avisar trials (2 dias antes)');
console.log('   🌍 Ambiente:', ASAAS_ENV);
console.log('');

module.exports = { processarCobrancaCartao, cobrarViaStripe, cobrarViaAsaas };