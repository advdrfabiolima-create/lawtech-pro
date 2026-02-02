const cron = require('node-cron');
const pool = require('../config/db');
const axios = require('axios');

/* ======================================================
   CONFIGURAÇÃO ASAAS
===================================================== */

const ASAAS_ENV = process.env.ASAAS_ENV || 'production';
const ASAAS_BASE_URL = ASAAS_ENV === 'sandbox' 
  ? 'https://sandbox.asaas.com/api/v3'
  : 'https://api.asaas.com/v3';

const getAsaasHeaders = () => ({
  'access_token': process.env.ASAAS_API_KEY,
  'Content-Type': 'application/json'
});

/* ======================================================
   💳 CRON JOB: Cobrar trials expirados às 6h
===================================================== */

cron.schedule('0 6 * * *', async () => {
    console.log('\n🔔 [CRON] Verificando trials expirados...');
    console.log('📅 Data/Hora:', new Date().toLocaleString('pt-BR'));
    
    try {
        const result = await pool.query(`
            SELECT 
                e.id,
                e.nome,
                e.plano_id,
                e.trial_expira_em,
                e.valor_assinatura,
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
                e.plano_financeiro_status = 'trial'
                AND e.trial_expira_em < CURRENT_DATE
                AND e.trial_expira_em > CURRENT_DATE - INTERVAL '7 days'
            ORDER BY e.id
        `);

        console.log(`📊 [CRON] Encontrados: ${result.rowCount} escritórios`);

        if (result.rowCount === 0) {
            console.log('   ✅ Nenhum trial expirado para cobrar\n');
            return;
        }

        let sucessos = 0;
        let falhas = 0;

        for (const escritorio of result.rows) {
            try {
                console.log(`\n💳 [CRON] Cobrando: ${escritorio.nome}`);
                console.log(`   Email: ${escritorio.email_responsavel}`);
                console.log(`   Plano: ${escritorio.plano_nome}`);
                console.log(`   Valor: R$ ${(escritorio.valor_assinatura / 100).toFixed(2)}`);
                console.log(`   Cartão: **** ${escritorio.last4} (${escritorio.brand})`);
                
                const cobranca = await processarCobrancaCartao({
                    escritorioId: escritorio.id,
                    valor: escritorio.valor_assinatura,
                    cartaoToken: escritorio.cartao_token,
                    gateway: escritorio.gateway,
                    descricao: `Assinatura ${escritorio.plano_nome} - LawTech Pro`
                });

                if (cobranca.sucesso) {
                    await pool.query(`
                        UPDATE escritorios 
                        SET plano_financeiro_status = 'pago',
                            ultimo_pagamento = NOW(),
                            proxima_cobranca = NOW() + INTERVAL '1 month',
                            trial_expira_em = NULL
                        WHERE id = $1
                    `, [escritorio.id]);

                    await pool.query(`
                        INSERT INTO transacoes 
                        (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                        VALUES ($1, $2, $3, $4, 'aprovada', $5, NOW())
                    `, [
                        escritorio.id,
                        cobranca.transacaoId,
                        escritorio.gateway,
                        escritorio.valor_assinatura,
                        `Primeira cobrança - ${escritorio.plano_nome}`
                    ]);

                    console.log(`   ✅ APROVADO! ID: ${cobranca.transacaoId}`);
                    sucessos++;
                    
                } else {
                    await pool.query(`
                        UPDATE escritorios 
                        SET plano_financeiro_status = 'inadimplente'
                        WHERE id = $1
                    `, [escritorio.id]);

                    await pool.query(`
                        INSERT INTO transacoes 
                        (escritorio_id, gateway_id, gateway, valor, status, mensagem_erro, descricao, created_at)
                        VALUES ($1, $2, $3, $4, 'recusada', $5, $6, NOW())
                    `, [
                        escritorio.id,
                        cobranca.transacaoId || null,
                        escritorio.gateway,
                        escritorio.valor_assinatura,
                        cobranca.erro,
                        `Tentativa de cobrança - ${escritorio.plano_nome}`
                    ]);

                    console.log(`   ❌ RECUSADO: ${cobranca.erro}`);
                    falhas++;
                }

            } catch (err) {
                console.error(`   ❌ ERRO: ${err.message}`);
                falhas++;
            }
        }

        console.log(`\n📊 Resultado: ${sucessos} aprovados, ${falhas} falhas\n`);

    } catch (err) {
        console.error('❌ [CRON] Erro geral:', err);
    }
});

/* ======================================================
   ⚠️ CRON: Avisar trials próximos às 9h
===================================================== */

cron.schedule('0 9 * * *', async () => {
    console.log('\n⚠️ [CRON] Enviando avisos de trial expirando...');
    
    try {
        const result = await pool.query(`
            SELECT e.id, e.nome, e.trial_expira_em, u.email, p.nome as plano_nome
            FROM escritorios e
            JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
            JOIN planos p ON e.plano_id = p.id
            WHERE e.plano_financeiro_status = 'trial'
            AND e.trial_expira_em = CURRENT_DATE + INTERVAL '2 days'
        `);

        console.log(`📊 [CRON] ${result.rowCount} avisos para enviar`);

        for (const escritorio of result.rows) {
            console.log(`📧 Aviso: ${escritorio.email} (expira em 2 dias)`);
            // TODO: Enviar email
        }

        console.log('✅ [CRON] Avisos processados\n');

    } catch (err) {
        console.error('❌ [CRON] Erro:', err);
    }
});

/* ======================================================
   FUNÇÃO: Processar cobrança
===================================================== */

async function processarCobrancaCartao({ escritorioId, valor, cartaoToken, gateway, descricao }) {
    console.log(`   🔄 Processando via ${gateway.toUpperCase()}...`);

    try {
        if (gateway === 'stripe') {
            return await cobrarViaStripe(cartaoToken, valor, descricao);
        } else if (gateway === 'asaas') {
            return await cobrarViaAsaas(cartaoToken, valor, descricao, escritorioId);
        } else {
            throw new Error('Gateway não suportado: ' + gateway);
        }
    } catch (err) {
        console.error(`   ❌ Erro:`, err.message);
        return { sucesso: false, transacaoId: null, erro: err.message };
    }
}

/* ======================================================
   INTEGRAÇÃO STRIPE
===================================================== */

async function cobrarViaStripe(token, valor, descricao) {
    try {
        if (!process.env.STRIPE_SECRET_KEY) {
            throw new Error('STRIPE_SECRET_KEY não configurado');
        }

        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        const charge = await stripe.charges.create({
            amount: valor,
            currency: 'brl',
            source: token,
            description: descricao
        });

        return {
            sucesso: charge.paid,
            transacaoId: charge.id,
            erro: charge.failure_message || null
        };

    } catch (err) {
        return { sucesso: false, transacaoId: null, erro: err.message };
    }
}

/* ======================================================
   INTEGRAÇÃO ASAAS
===================================================== */

async function cobrarViaAsaas(customerId, valor, descricao, escritorioId) {
    try {
        const response = await axios.post(
            `${ASAAS_BASE_URL}/payments`,
            {
                customer: customerId,
                billingType: 'CREDIT_CARD',
                value: valor / 100,
                dueDate: new Date().toISOString().split('T')[0],
                description: descricao,
                externalReference: String(escritorioId)
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

/* ======================================================
   LOGS DE INICIALIZAÇÃO
===================================================== */

console.log('\n✅ [CRON] Sistema de cobranças automáticas iniciado');
console.log('   → 06:00 - Cobrar trials expirados');
console.log('   → 09:00 - Avisar trials próximos (2 dias)');
console.log('   → Ambiente:', ASAAS_ENV);
console.log('');

module.exports = { 
    processarCobrancaCartao,
    cobrarViaStripe,
    cobrarViaAsaas
};