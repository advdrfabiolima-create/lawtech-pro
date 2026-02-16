const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../config/db');
const { registrarAudit } = require('../utils/auditLog');

/* ✅ CORREÇÃO 3: Webhook Stripe Completo */

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error('⚠️ Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log('✅ Webhook recebido:', event.type);

    try {
        switch (event.type) {
            // ✅ Confirmar pagamento aprovado (com idempotência e transação)
            case 'payment_intent.succeeded': {
                const paymentIntent = event.data.object;
                const escritorioId = paymentIntent.metadata?.escritorio_id;

                console.log('✅ Pagamento aprovado:', paymentIntent.id);

                if (escritorioId) {
                    // Verificação de idempotência
                    const jaExiste = await pool.query(
                        'SELECT id FROM transacoes WHERE gateway_id = $1',
                        [paymentIntent.id]
                    );
                    if (jaExiste.rows.length > 0) {
                        console.log(`ℹ️ Transação já registrada: ${paymentIntent.id}`);
                        break;
                    }

                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');

                        await client.query(`
                            UPDATE escritorios
                            SET plano_financeiro_status = 'pago',
                                ultimo_pagamento = NOW(),
                                proxima_cobranca = NOW() + INTERVAL '1 month'
                            WHERE id = $1
                        `, [escritorioId]);

                        await client.query(`
                            INSERT INTO transacoes
                            (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                            VALUES ($1, $2, 'stripe', $3, 'aprovada', 'Pagamento aprovado', NOW())
                        `, [escritorioId, paymentIntent.id, paymentIntent.amount]);

                        await client.query('COMMIT');
                        console.log(`✅ Escritório ${escritorioId} atualizado para PAGO`);
                        registrarAudit({ escritorio_id: parseInt(escritorioId), acao: 'PAGAMENTO_APROVADO', descricao: `Pagamento Stripe aprovado: ${paymentIntent.id}`, metadata: { gateway: 'stripe', valor: paymentIntent.amount, gateway_id: paymentIntent.id } });
                    } catch (txErr) {
                        await client.query('ROLLBACK');
                        console.error('❌ Erro na transação webhook:', txErr.message);
                    } finally {
                        client.release();
                    }
                }
                break;
            }

            // ✅ NOVO: Marcar pagamento falho
            case 'payment_intent.payment_failed': {
                const paymentIntent = event.data.object;
                const escritorioId = paymentIntent.metadata?.escritorio_id;

                console.log('❌ Pagamento recusado:', paymentIntent.id);

                if (escritorioId) {
                    await pool.query(`
                        UPDATE escritorios 
                        SET plano_financeiro_status = 'inadimplente'
                        WHERE id = $1
                    `, [escritorioId]);

                    const erro = paymentIntent.last_payment_error?.message || 'Erro desconhecido';

                    await pool.query(`
                        INSERT INTO transacoes 
                        (escritorio_id, gateway_id, gateway, valor, status, mensagem_erro, descricao, created_at)
                        VALUES ($1, $2, 'stripe', $3, 'recusada', $4, 'Tentativa de pagamento', NOW())
                    `, [escritorioId, paymentIntent.id, paymentIntent.amount, erro]);

                    console.log(`❌ Escritório ${escritorioId} marcado como INADIMPLENTE`);
                    registrarAudit({ escritorio_id: parseInt(escritorioId), acao: 'PAGAMENTO_RECUSADO', descricao: `Pagamento Stripe recusado: ${paymentIntent.id}`, metadata: { gateway: 'stripe', erro: paymentIntent.last_payment_error?.message } });
                }
                break;
            }

            // ✅ NOVO: Processar estorno
            case 'charge.refunded': {
                const charge = event.data.object;
                const paymentIntentId = charge.payment_intent;

                console.log('🔄 Estorno processado:', charge.id);

                await pool.query(`
                    INSERT INTO transacoes 
                    (escritorio_id, gateway_id, gateway, valor, status, descricao, created_at)
                    SELECT 
                        escritorio_id, 
                        $1, 
                        'stripe', 
                        $2, 
                        'estornada', 
                        'Estorno processado', 
                        NOW()
                    FROM transacoes 
                    WHERE gateway_id = $3
                    LIMIT 1
                `, [charge.id, -charge.amount_refunded, paymentIntentId]);

                break;
            }

            // ✅ JÁ EXISTIA: Suspender por chargeback
            case 'charge.dispute.created': {
                const dispute = event.data.object;
                const chargeId = dispute.charge;

                console.log('🚨 Chargeback detectado:', chargeId);
                registrarAudit({ acao: 'CHARGEBACK', descricao: `Chargeback Stripe detectado: ${chargeId}`, metadata: { gateway: 'stripe', charge_id: chargeId } });

                await pool.query(`
                    UPDATE escritorios e
                    SET plano_financeiro_status = 'suspenso',
                        renovacao_automatica = false
                    FROM transacoes t
                    WHERE t.gateway_id = $1
                    AND t.escritorio_id = e.id
                `, [chargeId]);

                break;
            }

            default:
                console.log(`ℹ️ Evento não tratado: ${event.type}`);
        }

        res.json({ received: true });

    } catch (err) {
        console.error('❌ Erro ao processar webhook:', err.message);
        res.status(500).json({ error: 'Webhook handler failed' });
    }
});

module.exports = router;