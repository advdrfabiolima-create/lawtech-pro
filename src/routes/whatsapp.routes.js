const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { processarMensagem } = require('../services/whatsappBotService');

// ── GET /webhook/whatsapp — verificação do webhook pela Meta ───────────────
router.get('/whatsapp', (req, res) => {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
        logger.info('[WhatsApp] Webhook verificado com sucesso');
        return res.status(200).send(challenge);
    }

    logger.warn({ mode, token }, '[WhatsApp] Falha na verificacao do webhook');
    res.sendStatus(403);
});

// ── POST /webhook/whatsapp — recebe mensagens da Meta ─────────────────────
router.post('/whatsapp', express.json(), async (req, res) => {
    // Responde 200 imediatamente (Meta exige resposta rápida)
    res.sendStatus(200);

    try {
        const body = req.body;
        if (body.object !== 'whatsapp_business_account') return;

        for (const entry of body.entry || []) {
            const escritorioId = await resolverEscritorioId(entry.id);
            if (!escritorioId) continue;

            for (const change of entry.changes || []) {
                const value = change.value;
                if (!value?.messages?.length) continue;

                for (const msg of value.messages) {
                    if (msg.type !== 'text') continue; // por ora só texto

                    const telefone    = msg.from;
                    const texto       = msg.text?.body || '';
                    const nomeContato = value.contacts?.[0]?.profile?.name || null;

                    logger.info({ telefone, texto }, '[WhatsApp] Mensagem recebida');

                    await processarMensagem({
                        escritorioId,
                        telefone,
                        nomeContato,
                        textoRecebido: texto
                    });
                }
            }
        }
    } catch (err) {
        logger.error({ err: err.message }, '[WhatsApp] Erro ao processar mensagem');
    }
});

// ── Resolve qual escritório pertence ao WhatsApp Business Account ──────────
// O campo entry.id é o WABA ID — mapeado via META_WHATSAPP_BUSINESS_ID no .env
// Para múltiplos escritórios no futuro, criar tabela de mapeamento
async function resolverEscritorioId(wabaId) {
    if (wabaId !== process.env.META_WHATSAPP_BUSINESS_ID) return null;

    // Retorna o escritório master (para SaaS multi-tenant, expandir futuramente)
    const pool = require('../config/db');
    const { rows } = await pool.query(
        `SELECT id FROM escritorios WHERE plano_financeiro_status IN ('ativo','pago','trial')
         ORDER BY id LIMIT 1`
    );
    return rows[0]?.id || null;
}

module.exports = router;
