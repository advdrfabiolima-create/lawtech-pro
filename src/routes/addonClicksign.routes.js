const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../config/db');
const axios = require('axios');
const { encrypt, decrypt } = require('../utils/crypto');

const PLANOS_GRATIS = ['basico', 'intermediario', 'avancado', 'premium'];

// ─── GET /api/addon/clicksign/status ─────────────────────────────────────────
router.get('/addon/clicksign/status', async (req, res) => {
    if (!req.user) return res.status(401).json({ erro: 'Não autenticado' });
    const escritorioId = req.user.escritorio_id;

    try {
        const result = await pool.query(`
            SELECT e.clicksign_addon_ativo, e.clicksign_addon_limite, e.clicksign_addon_usado,
                   e.clicksign_addon_periodo_inicio, e.clicksign_addon_stripe_sub_id,
                   e.clicksign_api_key, p.slug AS plano_slug
            FROM escritorios e
            LEFT JOIN planos p ON p.id = e.plano_id
            WHERE e.id = $1
        `, [escritorioId]);

        const row = result.rows[0] || {};
        const planoSlug = row.plano_slug || 'basico';
        const planoTemAcessoGratis = PLANOS_GRATIS.includes(planoSlug);
        const addonAtivo = !!row.clicksign_addon_ativo;
        const ativo = planoTemAcessoGratis || addonAtivo;
        const limite = row.clicksign_addon_limite ?? 20;
        const usado = row.clicksign_addon_usado ?? 0;
        const apiKeyConfigurada = !!(row.clicksign_api_key);
        // Quota só limita o plano básico; demais têm acesso ilimitado
        const dentroQuota = planoTemAcessoGratis || usado < limite;

        res.json({
            ativo,
            plano_tem_acesso_gratis: planoTemAcessoGratis,
            plano_slug: planoSlug,
            addon_ativo: addonAtivo,
            limite,
            usado,
            periodo_inicio: row.clicksign_addon_periodo_inicio || null,
            api_key_configurada: apiKeyConfigurada,
            disponivel: ativo && dentroQuota && apiKeyConfigurada
        });
    } catch (err) {
        console.error('[ADDON/ClickSign] Erro ao buscar status:', err.message);
        res.status(500).json({ erro: 'Erro ao buscar status do add-on' });
    }
});

// ─── PATCH /api/addon/clicksign/chave ────────────────────────────────────────
// Salva (ou remove) a API key ClickSign do escritório (BYOK)
router.patch('/addon/clicksign/chave', async (req, res) => {
    if (!req.user) return res.status(401).json({ erro: 'Não autenticado' });
    if (req.user.role !== 'admin') {
        return res.status(403).json({ erro: 'Apenas administradores podem configurar a chave ClickSign' });
    }

    const escritorioId = req.user.escritorio_id;
    const { api_key } = req.body;

    // Aceita string não vazia ou null/'' para remover
    const chave = (api_key && String(api_key).trim()) ? String(api_key).trim() : null;

    try {
        // Encripta antes de salvar — nunca armazenar API keys em plain text
        const chaveCriptografada = chave ? encrypt(chave) : null;
        await pool.query(
            'UPDATE escritorios SET clicksign_api_key = $1 WHERE id = $2',
            [chaveCriptografada, escritorioId]
        );
        console.log(`[ADDON/ClickSign] Chave API ${chave ? 'configurada (encriptada)' : 'removida'} para escritório ${escritorioId}`);

        // ── Auto-registrar webhook no ClickSign ao salvar nova chave ──
        // Usa a chave original (não encriptada) para chamada de API
        let webhookRegistrado = false;
        if (chave) {
            try {
                const csBase = process.env.CLICKSIGN_ENV === 'production'
                    ? 'https://app.clicksign.com'
                    : 'https://sandbox.clicksign.com';
                const appUrl = process.env.APP_URL || 'https://app.lawtechpro.com.br';
                const webhookUrl = `${appUrl}/webhook/clicksign`;
                const webhookToken = process.env.CLICKSIGN_WEBHOOK_SECRET || '';

                await axios.post(
                    `${csBase}/api/v1/hooks?access_token=${chave}`,
                    { hook: { url: webhookUrl, authenticity_token: webhookToken || undefined } },
                    { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
                );
                webhookRegistrado = true;
                console.log(`[ADDON/ClickSign] Webhook registrado automaticamente para escritório ${escritorioId}: ${webhookUrl}`);
            } catch (whErr) {
                // Não crítico: chave salva com sucesso mesmo se webhook falhar
                console.warn('[ADDON/ClickSign] Não foi possível registrar webhook automaticamente:',
                    whErr.response?.data || whErr.message);
            }
        }

        res.json({ ok: true, api_key_configurada: !!chave, webhook_registrado: webhookRegistrado });
    } catch (err) {
        console.error('[ADDON/ClickSign] Erro ao salvar chave:', err.message);
        res.status(500).json({ erro: 'Erro ao salvar chave ClickSign' });
    }
});

// ─── POST /api/addon/clicksign/checkout ──────────────────────────────────────
// Cria Stripe Checkout Session — apenas para plano básico
router.post('/addon/clicksign/checkout', async (req, res) => {
    if (!req.user) return res.status(401).json({ erro: 'Não autenticado' });

    const priceId = process.env.STRIPE_CLICKSIGN_ADDON_PRICE_ID;
    if (!priceId) {
        return res.status(500).json({ erro: 'Add-on não configurado no servidor' });
    }

    const escritorioId = req.user.escritorio_id;

    try {
        // Verificar se o plano do escritório requer o add-on pago
        const planRes = await pool.query(`
            SELECT p.slug FROM escritorios e
            LEFT JOIN planos p ON p.id = e.plano_id
            WHERE e.id = $1
        `, [escritorioId]);
        const planoSlug = planRes.rows[0]?.slug || 'basico';

        if (PLANOS_GRATIS.includes(planoSlug)) {
            return res.status(400).json({ erro: 'Seu plano já inclui Assinatura Digital sem custo adicional.' });
        }

        const userRes = await pool.query('SELECT email FROM usuarios WHERE id = $1', [req.user.id]);
        const customerEmail = userRes.rows[0]?.email;

        const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
        const successUrl = `${baseUrl}/documentos-page?addon_ativo=1`;
        const cancelUrl = `${baseUrl}/documentos-page`;

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            metadata: { escritorio_id: String(escritorioId), tipo: 'clicksign_addon' },
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
