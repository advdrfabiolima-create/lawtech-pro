const cron = require('node-cron');
const pool = require('../config/db');
const axios = require('axios');

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
        const result = await pool.query(`
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
            AND u.email != 'adv.limaesilva@hotmail.com'
        `);

        console.log(`📊 Encontrados: ${result.rowCount} escritório(s)`);

        if (result.rowCount === 0) {
            console.log('✅ Nenhum trial para cobrar hoje\n');
            return;
        }

        let sucessos = 0, falhas = 0;

        for (const esc of result.rows) {
            try {
                const valorCentavos = Math.round(parseFloat(esc.preco_mensal) * 100);
                
                console.log(`\n💳 Cobrando: ${esc.nome} - R$ ${esc.preco_mensal}`);
                
                const cobranca = await processarCobrancaCartao({
                    escritorioId: esc.id,
                    valor: valorCentavos,
                    cartaoToken: esc.cartao_token,
                    asaasCardToken: esc.asaas_card_token,
                    gateway: esc.gateway,
                    descricao: `Assinatura ${esc.plano_nome}`,
                    emailResponsavel: esc.email_responsavel,
                    planoNome: esc.plano_nome
                });

                if (cobranca.sucesso) {
                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');

                        // Verificação de idempotência
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
                console.error(`❌ Erro: ${err.message}`);
                falhas++;
            }
        }

        console.log(`\n📊 Resultado: ✅ ${sucessos} aprovados | ❌ ${falhas} falhas\n`);

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
        if (gateway === 'stripe') {
            return await cobrarViaStripe(cartaoToken, valor, descricao, {
                escritorioId, emailResponsavel, planoNome
            });
        } else if (gateway === 'asaas') {
            return await cobrarViaAsaas(cartaoToken, asaasCardToken, valor, descricao, escritorioId);
        } else {
            throw new Error('Gateway não suportado: ' + gateway);
        }
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