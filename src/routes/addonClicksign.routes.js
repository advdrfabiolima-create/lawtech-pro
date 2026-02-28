const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../config/db');

// ─── GET /api/addon/clicksign/status ─────────────────────────────────────────
// Retorna o estado atual do add-on de Assinatura Digital para o escritório logado
router.get('/addon/clicksign/status', async (req, res) => {
    if (!req.user) return res.status(401).json({ erro: 'Não autenticado' });
    const escritorioId = req.user.escritorio_id;

    try {
        const result = await pool.query(
            `SELECT clicksign_addon_ativo, clicksign_addon_limite, clicksign_addon_usado,
                    clicksign_addon_periodo_inicio, clicksign_addon_stripe_sub_id
             FROM escritorios WHERE id = $1`,
            [escritorioId]
        );
        const row = result.rows[0] || {};
        const ativo = !!row.clicksign_addon_ativo;
        const limite = row.clicksign_addon_limite ?? 20;
        const usado = row.clicksign_addon_usado ?? 0;

        res.json({
            ativo,
            limite,
            usado,
            periodo_inicio: row.clicksign_addon_periodo_inicio || null,
            disponivel: ativo && usado < limite
        });
    } catch (err) {
        console.error('[ADDON/ClickSign] Erro ao buscar status:', err.message);
        res.status(500).json({ erro: 'Erro ao buscar status do add-on' });
    }
});

// ─── POST /api/addon/clicksign/checkout ──────────────────────────────────────
// Cria uma Stripe Checkout Session (subscription) para ativar o add-on
router.post('/addon/clicksign/checkout', async (req, res) => {
    if (!req.user) return res.status(401).json({ erro: 'Não autenticado' });

    const priceId = process.env.STRIPE_CLICKSIGN_ADDON_PRICE_ID;
    if (!priceId) {
        return res.status(500).json({ erro: 'Add-on não configurado no servidor' });
    }

    const escritorioId = req.user.escritorio_id;

    try {
        // Buscar e-mail do usuário logado
        const userRes = await pool.query(
            'SELECT email FROM usuarios WHERE id = $1',
            [req.user.id]
        );
        const customerEmail = userRes.rows[0]?.email;

        const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
        const successUrl = `${baseUrl}/documentos-page?addon_ativo=1`;
        const cancelUrl = `${baseUrl}/documentos-page`;

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{
                price: priceId,
                quantity: 1
            }],
            metadata: {
                escritorio_id: String(escritorioId),
                tipo: 'clicksign_addon'
            },
            ...(customerEmail ? { customer_email: customerEmail } : {}),
            success_url: successUrl,
            cancel_url: cancelUrl
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('[ADDON/ClickSign] Erro ao criar checkout session:', err.message);
        res.status(500).json({ erro: 'Erro ao criar sessão de pagamento: ' + err.message });
    }
});

// ─── DELETE /api/addon/clicksign/cancelar (admin only) ───────────────────────
// Cancela a subscription Stripe e desativa o add-on
router.delete('/addon/clicksign/cancelar', async (req, res) => {
    if (!req.user) return res.status(401).json({ erro: 'Não autenticado' });
    if (req.user.role !== 'admin') {
        return res.status(403).json({ erro: 'Apenas administradores podem cancelar o add-on' });
    }

    const escritorioId = req.user.escritorio_id;

    try {
        const result = await pool.query(
            'SELECT clicksign_addon_stripe_sub_id FROM escritorios WHERE id = $1',
            [escritorioId]
        );
        const subId = result.rows[0]?.clicksign_addon_stripe_sub_id;

        if (subId) {
            try {
                await stripe.subscriptions.cancel(subId);
                console.log(`[ADDON/ClickSign] Subscription ${subId} cancelada no Stripe`);
            } catch (stripeErr) {
                // Não bloqueia — pode já estar cancelada
                console.warn('[ADDON/ClickSign] Aviso ao cancelar no Stripe:', stripeErr.message);
            }
        }

        await pool.query(
            `UPDATE escritorios SET clicksign_addon_ativo = false, clicksign_addon_stripe_sub_id = NULL WHERE id = $1`,
            [escritorioId]
        );

        res.json({ ok: true });
    } catch (err) {
        console.error('[ADDON/ClickSign] Erro ao cancelar add-on:', err.message);
        res.status(500).json({ erro: 'Erro ao cancelar add-on' });
    }
});

module.exports = router;
