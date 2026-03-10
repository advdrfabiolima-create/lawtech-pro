const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../config/db');
const { registrarAudit } = require('../utils/auditLog');
const logger = require('../utils/logger');
const axios = require('axios');
const cache = require('../utils/cache');

async function invalidarCacheEscritorio(escritorioId) {
    try {
        const users = await pool.query('SELECT id FROM usuarios WHERE escritorio_id = $1', [escritorioId]);
        for (const u of users.rows) await cache.del(`auth:user:${u.id}`);
    } catch (_) {}
}

/* ✅ CORREÇÃO 3: Webhook Stripe Completo */

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        logger.error({ err: err.message }, 'Webhook signature verification failed');
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    logger.info({ eventType: event.type }, 'Webhook Stripe recebido');

    try {
        switch (event.type) {
            // ✅ Confirmar pagamento aprovado (com idempotência e transação)
            case 'payment_intent.succeeded': {
                const paymentIntent = event.data.object;
                const escritorioId = paymentIntent.metadata?.escritorio_id;

                logger.info({ paymentIntentId: paymentIntent.id }, 'Pagamento Stripe aprovado');

                if (escritorioId) {
                    // Verificação de idempotência
                    const jaExiste = await pool.query(
                        'SELECT id FROM transacoes WHERE gateway_id = $1',
                        [paymentIntent.id]
                    );
                    if (jaExiste.rows.length > 0) {
                        logger.info({ paymentIntentId: paymentIntent.id }, 'Transacao ja registrada');
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
                        // [A-4] Invalidar cache após pagamento confirmado
                        await invalidarCacheEscritorio(parseInt(escritorioId, 10));
                        logger.info({ escritorioId }, 'Escritorio atualizado para PAGO');
                        registrarAudit({ escritorio_id: parseInt(escritorioId), acao: 'PAGAMENTO_APROVADO', descricao: `Pagamento Stripe aprovado: ${paymentIntent.id}`, metadata: { gateway: 'stripe', valor: paymentIntent.amount, gateway_id: paymentIntent.id } });

                    } catch (txErr) {
                        await client.query('ROLLBACK');
                        logger.error({ err: txErr.message }, 'Erro na transacao webhook');
                    } finally {
                        // [B-3] Liberar conexão do pool ANTES de chamar API externa (Brevo)
                        client.release();
                    }

                        // Notificar admin — usa pool.query (sem client dedicado) após liberar a conexão
                        if (process.env.BREVO_API_KEY && process.env.BREVO_SENDER) {
                            try {
                                const escritorioInfo = await pool.query(
                                    `SELECT e.nome AS escritorio_nome, u.nome AS usuario_nome, u.email,
                                            p.nome AS plano_nome
                                     FROM escritorios e
                                     LEFT JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
                                     LEFT JOIN planos p ON e.plano_id = p.id
                                     WHERE e.id = $1 LIMIT 1`,
                                    [escritorioId]
                                );
                                const info = escritorioInfo.rows[0] || {};
                                const valorFormatado = (paymentIntent.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

                                await axios.post('https://api.brevo.com/v3/smtp/email', {
                                    sender: { name: 'LawTech Pro', email: process.env.BREVO_SENDER },
                                    to: [{ email: process.env.ADMIN_EMAIL || 'fabio@lawtechpro.com.br', name: 'Admin LawTech' }],
                                    subject: 'Pagamento Aprovado — LawTech Pro',
                                    htmlContent: `
                                    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafb;">
                                        <div style="background:#1E3A5F;padding:24px;text-align:center;">
                                            <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:180px;height:auto;margin:0 auto 8px;" />
                                            <p style="color:rgba(255,255,255,0.8);margin:0;font-size:13px;">Notificação Administrativa</p>
                                        </div>
                                        <div style="padding:28px 24px;background:white;">
                                            <div style="text-align:center;margin-bottom:20px;">
                                                <div style="display:inline-block;background:#D1FAE5;color:#065F46;padding:8px 20px;border-radius:20px;font-weight:700;font-size:14px;">PAGAMENTO APROVADO</div>
                                            </div>
                                            <table style="width:100%;border-collapse:collapse;font-size:14px;">
                                                <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#7B8794;font-weight:600;width:120px;">Valor</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#065F46;font-weight:700;font-size:18px;">${valorFormatado}</td></tr>
                                                <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#7B8794;font-weight:600;">Cliente</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#2D3748;">${info.usuario_nome || '—'}</td></tr>
                                                <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#7B8794;font-weight:600;">E-mail</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#2D3748;">${info.email || '—'}</td></tr>
                                                <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#7B8794;font-weight:600;">Plano</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#2D3748;">${info.plano_nome || '—'}</td></tr>
                                                <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#7B8794;font-weight:600;">Gateway ID</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#2D3748;font-family:monospace;font-size:12px;">${paymentIntent.id}</td></tr>
                                                <tr><td style="padding:10px 12px;color:#7B8794;font-weight:600;">Data</td><td style="padding:10px 12px;color:#2D3748;">${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td></tr>
                                            </table>
                                            <div style="text-align:center;margin:24px 0 0;">
                                                <a href="https://www.lawtechpro.com.br/admin-monitor.html" style="display:inline-block;background:#4A90E2;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;">Ver Painel Admin</a>
                                            </div>
                                        </div>
                                        <div style="padding:16px 24px;text-align:center;background:#f8fafb;border-top:1px solid #e2e8f0;">
                                            <p style="color:#A0AEC0;font-size:10px;margin:0;">Notificação automática — LawTech Pro</p>
                                        </div>
                                    </div>`
                                }, { headers: { 'api-key': process.env.BREVO_API_KEY } });
                                logger.info('[ADMIN] Notificacao de pagamento aprovado enviada');
                            } catch (adminMailErr) {
                                logger.warn({ err: adminMailErr.message }, '[ADMIN] Falha ao notificar pagamento');
                            }
                        }
                }
                break;
            }

            // ✅ NOVO: Marcar pagamento falho
            case 'payment_intent.payment_failed': {
                const paymentIntent = event.data.object;
                const escritorioId = paymentIntent.metadata?.escritorio_id;

                logger.info({ paymentIntentId: paymentIntent.id }, 'Pagamento Stripe recusado');

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

                    logger.info({ escritorioId }, 'Escritorio marcado como INADIMPLENTE');
                    registrarAudit({ escritorio_id: parseInt(escritorioId), acao: 'PAGAMENTO_RECUSADO', descricao: `Pagamento Stripe recusado: ${paymentIntent.id}`, metadata: { gateway: 'stripe', erro: paymentIntent.last_payment_error?.message } });
                }
                break;
            }

            // ✅ NOVO: Processar estorno
            case 'charge.refunded': {
                const charge = event.data.object;
                const paymentIntentId = charge.payment_intent;

                logger.info({ chargeId: charge.id }, 'Estorno Stripe processado');

                // [A-6] Verificar se a transação original existe antes de inserir estorno
                const estornoResult = await pool.query(`
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

                if (estornoResult.rowCount === 0) {
                    logger.error({ chargeId: charge.id, paymentIntentId }, 'Estorno: transação original não encontrada — estorno não registrado');
                    registrarAudit({ acao: 'ESTORNO_SEM_ORIGEM', descricao: `Estorno Stripe sem transação original: ${charge.id}`, metadata: { payment_intent: paymentIntentId, valor: charge.amount_refunded } });
                }

                break;
            }

            // ✅ JÁ EXISTIA: Suspender por chargeback
            case 'charge.dispute.created': {
                const dispute = event.data.object;
                const chargeId = dispute.charge;

                logger.info({ chargeId }, 'Chargeback Stripe detectado');
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

            // ─── Add-on ClickSign: ativação via checkout ──────────────────────
            case 'checkout.session.completed': {
                const session = event.data.object;
                if (session.metadata?.tipo === 'clicksign_addon') {
                    const escritorioId = session.metadata.escritorio_id;
                    await pool.query(`
                        UPDATE escritorios SET
                            clicksign_addon_ativo         = true,
                            clicksign_addon_usado         = 0,
                            clicksign_addon_periodo_inicio = NOW(),
                            clicksign_addon_stripe_sub_id  = $2
                        WHERE id = $1
                    `, [escritorioId, session.subscription]);
                    logger.info({ escritorioId, subscription: session.subscription }, '[ADDON/ClickSign] Add-on ativado');
                }
                break;
            }

            // ─── Add-on ClickSign: renovação mensal → zera contador ──────────
            case 'invoice.payment_succeeded': {
                const invoice = event.data.object;
                const subId = invoice.subscription;
                if (subId) {
                    const upd = await pool.query(`
                        UPDATE escritorios SET
                            clicksign_addon_usado          = 0,
                            clicksign_addon_periodo_inicio = NOW()
                        WHERE clicksign_addon_stripe_sub_id = $1
                        RETURNING id
                    `, [subId]);
                    if (upd.rowCount > 0) {
                        logger.info({ escritorioId: upd.rows[0].id }, '[ADDON/ClickSign] Contador zerado (renovacao)');
                    }
                }
                break;
            }

            // ─── Add-on ClickSign: cancelamento da subscription ───────────────
            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                await pool.query(`
                    UPDATE escritorios SET
                        clicksign_addon_ativo         = false,
                        clicksign_addon_stripe_sub_id  = NULL
                    WHERE clicksign_addon_stripe_sub_id = $1
                `, [subscription.id]);
                logger.info({ subscriptionId: subscription.id }, '[ADDON/ClickSign] Add-on desativado — sub cancelada');
                break;
            }

            default:
                logger.info({ eventType: event.type }, 'Evento Stripe nao tratado');
        }

        res.json({ received: true });

    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao processar webhook Stripe');
        res.status(500).json({ ok: false, erro: 'Webhook handler failed' });
    }
});

module.exports = router;