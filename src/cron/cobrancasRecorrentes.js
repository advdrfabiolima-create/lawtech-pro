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
   💳 CRON JOB: Cobranças Recorrentes Mensais
   
   Executa todo dia às 8h da manhã
   Cobra assinaturas que vencem hoje
===================================================== */

cron.schedule('0 8 * * *', async () => {
    console.log('\n💰 [CRON RECORRENTE] Verificando cobranças mensais...');
    console.log('📅 Data/Hora:', new Date().toLocaleString('pt-BR'));
    
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
                AND u.email != 'adv.limaesilva@hotmail.com'
            ORDER BY e.proxima_cobranca ASC
        `);

        console.log(`📊 [CRON RECORRENTE] Encontrados: ${result.rowCount} assinatura(s) para renovar`);

        if (result.rowCount === 0) {
            console.log('   ✅ Nenhuma cobrança agendada para hoje\n');
            return;
        }

        let sucessos = 0;
        let falhas = 0;

        for (const escritorio of result.rows) {
            try {
                // Calcular valor em centavos
                const valorEmCentavos = Math.round(parseFloat(escritorio.preco_mensal) * 100);
                
                console.log(`\n💳 [CRON RECORRENTE] Cobrando renovação: ${escritorio.nome}`);
                console.log(`   Email: ${escritorio.email_responsavel}`);
                console.log(`   Plano: ${escritorio.plano_nome}`);
                console.log(`   Valor: R$ ${escritorio.preco_mensal}`);
                console.log(`   Cartão: **** ${escritorio.last4} (${escritorio.brand})`);
                console.log(`   Vencimento: ${new Date(escritorio.proxima_cobranca).toLocaleDateString('pt-BR')}`);
                
                const cobranca = await processarCobrancaCartao({
                    escritorioId: escritorio.id,
                    valor: valorEmCentavos,
                    cartaoToken: escritorio.cartao_token,
                    gateway: escritorio.gateway,
                    descricao: `Renovação ${escritorio.plano_nome} - LawTech Pro`
                });

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
                            console.log(`   ℹ️ Transação já registrada: ${cobranca.transacaoId}`);
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
                        console.log(`   ✅ RENOVAÇÃO APROVADA! ID: ${cobranca.transacaoId}`);
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
                        console.log(`   ❌ COBRANÇA RECUSADA: ${cobranca.erro}`);
                        falhas++;
                    }
                } catch (txErr) {
                    await client.query('ROLLBACK');
                    console.error(`   ❌ Erro na transação: ${txErr.message}`);
                    falhas++;
                } finally {
                    client.release();
                }

            } catch (err) {
                console.error(`   ❌ ERRO ao processar escritório ${escritorio.id}:`, err.message);
                falhas++;
            }
        }

        console.log(`\n📊 [CRON RECORRENTE] Resultado Final:`);
        console.log(`   ✅ Aprovadas: ${sucessos}`);
        console.log(`   ❌ Recusadas: ${falhas}`);
        console.log(`   📊 Total: ${result.rowCount}\n`);

    } catch (err) {
        console.error('❌ [CRON RECORRENTE] Erro geral:', err);
    }
});

/* ======================================================
   ⚠️ CRON: Lembrete 3 dias antes do vencimento
===================================================== */

cron.schedule('0 10 * * *', async () => {
    console.log('\n📧 [CRON LEMBRETE] Enviando lembretes de cobrança...');
    
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

        console.log(`📊 [CRON LEMBRETE] ${result.rowCount} lembrete(s) para enviar`);

        for (const escritorio of result.rows) {
            console.log(`📧 Lembrete: ${escritorio.email}`);
            console.log(`   Cobrança em: ${new Date(escritorio.proxima_cobranca).toLocaleDateString('pt-BR')}`);
            console.log(`   Valor: R$ ${escritorio.preco_mensal}`);
            
            // TODO: Enviar email de lembrete
            // await enviarEmailLembrete({
            //     email: escritorio.email,
            //     nome: escritorio.nome,
            //     plano: escritorio.plano_nome,
            //     valor: escritorio.preco_mensal,
            //     data_cobranca: escritorio.proxima_cobranca
            // });
        }

        console.log('✅ [CRON LEMBRETE] Lembretes processados\n');

    } catch (err) {
        console.error('❌ [CRON LEMBRETE] Erro:', err);
    }
});

/* ======================================================
   🔄 CRON: Retry de cobranças inadimplentes
===================================================== */

cron.schedule('0 14 * * *', async () => {
    console.log('\n🔄 [CRON RETRY] Tentando reprocessar inadimplentes...');
    
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
        `);

        console.log(`📊 [CRON RETRY] ${result.rowCount} inadimplente(s) para tentar novamente`);

        for (const esc of result.rows) {
            console.log(`🔄 Tentando: ${esc.email}`);
            
            const valorEmCentavos = Math.round(parseFloat(esc.preco_mensal) * 100);
            
            const cobranca = await processarCobrancaCartao({
                escritorioId: esc.id,
                valor: valorEmCentavos,
                cartaoToken: esc.cartao_token,
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
                        console.log(`   ℹ️ Transação já registrada: ${cobranca.transacaoId}`);
                        continue;
                    }

                    await client.query(`
                        UPDATE escritorios
                        SET plano_financeiro_status = 'pago',
                            ultimo_pagamento = NOW(),
                            proxima_cobranca = NOW() + INTERVAL '1 month'
                        WHERE id = $1
                    `, [esc.id]);

                    await client.query(`
                        INSERT INTO transacoes
                        (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                        VALUES ($1, $2, $3, $4, 'aprovada', $5, NOW())
                    `, [esc.id, cobranca.transacaoId, esc.gateway, valorEmCentavos, `Retry bem-sucedido - ${esc.plano_nome}`]);

                    await client.query('COMMIT');
                    console.log(`   ✅ APROVADO no retry!`);

                } else {
                    console.log(`   ❌ Ainda recusado: ${cobranca.erro}`);
                    await client.query(`
                        UPDATE escritorios
                        SET proxima_cobranca = NOW() + INTERVAL '3 days'
                        WHERE id = $1
                    `, [esc.id]);
                }
            } catch (txErr) {
                await client.query('ROLLBACK');
                console.error(`   ❌ Erro na transação retry: ${txErr.message}`);
            } finally {
                client.release();
            }
        }

        console.log('✅ [CRON RETRY] Retries processados\n');

    } catch (err) {
        console.error('❌ [CRON RETRY] Erro:', err);
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
        console.error(`   ❌ Erro na cobrança:`, err.message);
        return { sucesso: false, transacaoId: null, erro: err.message };
    }
}

/* ======================================================
   INTEGRAÇÃO STRIPE
===================================================== */

async function cobrarViaStripe(paymentMethodId, valor, descricao) {
    try {
        if (!process.env.STRIPE_SECRET_KEY) {
            throw new Error('STRIPE_SECRET_KEY não configurado');
        }

        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        const paymentIntent = await stripe.paymentIntents.create({
            amount: valor,
            currency: 'brl',
            payment_method: paymentMethodId,
            confirm: true,
            description: descricao,
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
        return { 
            sucesso: false, 
            transacaoId: null, 
            erro: err.message 
        };
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
        return { 
            sucesso: false, 
            transacaoId: null, 
            erro: msgErro 
        };
    }
}

/* ======================================================
   LOGS DE INICIALIZAÇÃO
===================================================== */

console.log('\n✅ [CRON] Sistema de cobranças recorrentes iniciado');
console.log('   ⏰ 08:00 - Processar renovações mensais');
console.log('   ⏰ 10:00 - Enviar lembretes (3 dias antes)');
console.log('   ⏰ 14:00 - Retry de inadimplentes');
console.log('   🌍 Ambiente:', ASAAS_ENV);
console.log('   📅 Data atual:', new Date().toLocaleDateString('pt-BR'));
console.log('');

module.exports = { 
    processarCobrancaCartao,
    cobrarViaStripe,
    cobrarViaAsaas
};