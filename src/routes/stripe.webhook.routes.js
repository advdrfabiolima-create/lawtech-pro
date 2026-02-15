const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../config/db');

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {

    const sig = req.headers['stripe-signature'];

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('❌ Webhook inválido:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'charge.dispute.created') {
        const paymentIntentId = event.data.object.payment_intent;

        await pool.query(`
            UPDATE escritorios
            SET plano_financeiro_status = 'suspenso'
            WHERE stripe_payment_intent_id = $1
        `, [paymentIntentId]);

        console.log('🚨 Chargeback detectado. Escritório suspenso.');
    }

    res.json({ received: true });
});

module.exports = router;
