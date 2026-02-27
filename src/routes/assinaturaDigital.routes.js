const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const pool = require('../config/db');
const clicksignService = require('../services/clicksignService');

const uploadDir = path.join(__dirname, '..', 'uploads', 'documentos');

// ─── Helper: enviar e-mail de assinatura via Brevo ───────────────────────────
async function enviarEmailAssinatura({ para, nomeSignatario, nomeDocumento, signingUrl, mensagemAdvogado }) {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = process.env.BREVO_SENDER || 'contato@lawtechpro.com.br';
    if (!apiKey || !signingUrl) {
        console.warn('[ASSINATURA] Brevo não configurado ou URL de assinatura ausente — e-mail não enviado.');
        return false;
    }
    try {
        const mensagemHtml = mensagemAdvogado
            ? `<p style="color:#374151;font-size:14px;margin-bottom:16px;"><em>"${mensagemAdvogado}"</em></p>`
            : '';
        await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: 'LawTech Pro', email: sender },
            to: [{ email: para, name: nomeSignatario }],
            subject: `Documento aguardando sua assinatura: ${nomeDocumento}`,
            htmlContent: `
            <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafb;">
                <div style="background:#1E3A5F;padding:28px 24px;text-align:center;">
                    <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png"
                         alt="LawTech Pro" style="max-width:160px;height:auto;display:block;margin:0 auto 8px;" />
                    <p style="color:rgba(255,255,255,0.75);margin:0;font-size:13px;">Sistema Jurídico Inteligente</p>
                </div>
                <div style="padding:28px 24px;background:#ffffff;">
                    <h2 style="color:#1E3A5F;font-size:20px;margin:0 0 16px;">Olá, ${nomeSignatario}!</h2>
                    <p style="color:#374151;font-size:14px;margin-bottom:16px;">
                        Você recebeu um documento que precisa da sua assinatura eletrônica:
                    </p>
                    <div style="background:#f1f5f9;border-left:4px solid #4A90E2;padding:14px 16px;border-radius:6px;margin-bottom:20px;">
                        <strong style="color:#1E3A5F;font-size:15px;">📄 ${nomeDocumento}</strong>
                    </div>
                    ${mensagemHtml}
                    <div style="text-align:center;margin:24px 0;">
                        <a href="${signingUrl}"
                           style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;
                                  padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;
                                  letter-spacing:0.02em;">
                            🔏 Assinar Documento
                        </a>
                    </div>
                    <p style="color:#6b7280;font-size:12px;text-align:center;margin-top:20px;">
                        Ou acesse diretamente:<br>
                        <a href="${signingUrl}" style="color:#4A90E2;word-break:break-all;">${signingUrl}</a>
                    </p>
                </div>
                <div style="padding:16px 24px;text-align:center;background:#f8fafb;border-top:1px solid #e5e7eb;">
                    <p style="color:#9ca3af;font-size:11px;margin:0;">
                        Este e-mail foi enviado automaticamente pelo sistema LawTech Pro.
                    </p>
                </div>
            </div>`
        }, { headers: { 'api-key': apiKey } });
        console.log(`📧 [ASSINATURA] E-mail de assinatura enviado para ${para}`);
        return true;
    } catch (err) {
        console.warn('[ASSINATURA] Falha ao enviar e-mail via Brevo:', err.response?.data || err.message);
        return false;
    }
}

// ─── POST /api/documentos/:id/assinar ────────────────────────────────────────
// Envia um documento PDF do GED para assinatura digital via ClickSign
router.post('/documentos/:id/assinar', async (req, res) => {
    if (!req.user) return res.status(401).json({ erro: 'Não autenticado' });

    const escritorioId = req.user.escritorio_id;
    const usuarioId = req.user.id;
    const docId = parseInt(req.params.id);
    const { mensagem, deadline } = req.body;

    try {
        // 1. Buscar e validar o documento
        const docRes = await pool.query(
            `SELECT * FROM documentos WHERE id = $1 AND escritorio_id = $2`,
            [docId, escritorioId]
        );
        if (docRes.rows.length === 0) {
            return res.status(404).json({ erro: 'Documento não encontrado' });
        }
        const doc = docRes.rows[0];

        // 2. Apenas PDFs
        if (doc.mimetype !== 'application/pdf') {
            return res.status(400).json({ erro: 'Apenas documentos PDF podem ser enviados para assinatura digital' });
        }

        // 3. Deve ter processo vinculado
        if (!doc.processo_id) {
            return res.status(400).json({ erro: 'O documento deve estar vinculado a um processo para ser enviado para assinatura' });
        }

        // 4. Verificar assinatura ativa (não cancelada, não com erro, não concluída)
        const assAtiva = await pool.query(
            `SELECT id FROM assinaturas_digitais
             WHERE documento_id = $1 AND status NOT IN ('cancelado', 'erro', 'concluido')`,
            [docId]
        );
        if (assAtiva.rows.length > 0) {
            return res.status(400).json({ erro: 'Já existe uma assinatura ativa para este documento. Cancele-a antes de iniciar uma nova.' });
        }

        // 5. Buscar signatário — polo ativo principal (ou primeiro do polo ativo)
        const parteRes = await pool.query(
            `SELECT pp.pessoa_nome, c.email AS pessoa_email
             FROM partes_processo pp
             LEFT JOIN clientes c ON pp.pessoa_id = c.id
             WHERE pp.processo_id = $1 AND pp.polo = 'ativo'
             ORDER BY pp.eh_principal DESC, pp.id ASC
             LIMIT 1`,
            [doc.processo_id]
        );
        if (parteRes.rows.length === 0) {
            return res.status(400).json({ erro: 'Nenhuma parte no polo ativo encontrada para este processo' });
        }
        const parte = parteRes.rows[0];
        if (!parte.pessoa_email) {
            return res.status(400).json({ erro: 'O signatário (polo ativo) não possui e-mail cadastrado no sistema' });
        }

        // 6. Verificar arquivo físico
        const filePath = path.join(uploadDir, doc.arquivo_nome);
        if (!fs.existsSync(filePath)) {
            return res.status(400).json({ erro: 'Arquivo físico não encontrado no servidor' });
        }

        // 7-9. Integração ClickSign
        console.log('[ClickSign] Etapa 1: upload do documento...');
        const documentKey = await clicksignService.uploadDocumento(
            filePath,
            doc.arquivo_original,
            deadline || null,
            doc.mimetype
        );
        console.log('[ClickSign] Etapa 1 OK — document_key:', documentKey);

        console.log('[ClickSign] Etapa 2: criar signatário:', parte.pessoa_email);
        const signerKey = await clicksignService.criarSignatario(parte.pessoa_email, parte.pessoa_nome);
        console.log('[ClickSign] Etapa 2 OK — signer_key:', signerKey);

        console.log('[ClickSign] Etapa 3: adicionar signatário ao documento...');
        const { requestSignatureKey, signingUrl } = await clicksignService.adicionarSignatario(documentKey, signerKey, mensagem || null);
        console.log('[ClickSign] Etapa 3 OK — request_signature_key:', requestSignatureKey);
        console.log('[ClickSign] Etapa 3 — signing URL:', signingUrl);

        // 10. Registrar na base
        const signatarios = JSON.stringify([{
            nome: parte.pessoa_nome,
            email: parte.pessoa_email,
            signer_key: signerKey,
            request_signature_key: requestSignatureKey,
            signing_url: signingUrl
        }]);

        await pool.query(`
            INSERT INTO assinaturas_digitais
                (documento_id, escritorio_id, usuario_id, clicksign_document_key, status, signatarios, mensagem, deadline, link_assinatura)
            VALUES ($1, $2, $3, $4, 'enviado', $5::jsonb, $6, $7, $8)
        `, [docId, escritorioId, usuarioId, documentKey, signatarios, mensagem || null, deadline || null, signingUrl || null]);

        // 11. Enviar e-mail via Brevo com o link de assinatura
        const emailEnviado = await enviarEmailAssinatura({
            para: parte.pessoa_email,
            nomeSignatario: parte.pessoa_nome,
            nomeDocumento: doc.nome,
            signingUrl,
            mensagemAdvogado: mensagem || null
        });

        console.log(`[ASSINATURA] Documento #${docId} enviado para assinatura. ClickSign key: ${documentKey} | E-mail Brevo: ${emailEnviado ? 'enviado' : 'falhou'}`);
        res.json({ ok: true, status: 'enviado', clicksign_document_key: documentKey, link_assinatura: signingUrl, email_enviado: emailEnviado });

    } catch (err) {
        console.error('[ASSINATURA] Erro ao enviar para assinatura:', err.response?.data || err.message);
        res.status(500).json({ erro: 'Erro ao enviar documento para assinatura: ' + (err.response?.data?.error || err.message) });
    }
});

// ─── GET /api/documentos/:id/assinatura ──────────────────────────────────────
// Retorna a assinatura mais recente de um documento
router.get('/documentos/:id/assinatura', async (req, res) => {
    if (!req.user) return res.status(401).json({ erro: 'Não autenticado' });

    const escritorioId = req.user.escritorio_id;
    const docId = parseInt(req.params.id);

    try {
        const result = await pool.query(
            `SELECT * FROM assinaturas_digitais
             WHERE documento_id = $1 AND escritorio_id = $2
             ORDER BY criado_em DESC LIMIT 1`,
            [docId, escritorioId]
        );

        if (result.rows.length === 0) {
            return res.json({ ok: false });
        }

        res.json({ ok: true, assinatura: result.rows[0] });
    } catch (err) {
        console.error('[ASSINATURA] Erro ao buscar assinatura:', err.message);
        res.status(500).json({ erro: 'Erro ao buscar assinatura' });
    }
});

// ─── POST /webhook/clicksign (PÚBLICO — sem authMiddleware) ──────────────────
// Recebe notificações de status do ClickSign
router.post('/clicksign', async (req, res) => {
    try {
        const event = req.body?.event;
        if (!event) return res.sendStatus(200);

        const docData = event?.data?.document;
        if (!docData) return res.sendStatus(200);

        const documentKey = docData.key;
        const csStatus = docData.status;

        if (!documentKey || !csStatus) return res.sendStatus(200);

        const statusMap = {
            closed: 'concluido',
            canceled: 'cancelado'
        };

        const novoStatus = statusMap[csStatus];
        if (!novoStatus) return res.sendStatus(200);

        await pool.query(`
            UPDATE assinaturas_digitais
            SET status = $1,
                atualizado_em = NOW(),
                concluido_em = CASE WHEN $1 = 'concluido' THEN NOW() ELSE concluido_em END
            WHERE clicksign_document_key = $2
        `, [novoStatus, documentKey]);

        console.log(`[WEBHOOK/ClickSign] Documento ${documentKey} → ${novoStatus}`);
        res.sendStatus(200);

    } catch (err) {
        console.error('[WEBHOOK/ClickSign] Erro:', err.message);
        res.sendStatus(200); // Sempre 200 para o ClickSign não retentar
    }
});

// ─── POST /api/assinaturas/:id/verificar ─────────────────────────────────────
// Consulta o status atual no ClickSign e atualiza a base (útil em dev sem webhook)
router.post('/assinaturas/:id/verificar', async (req, res) => {
    if (!req.user) return res.status(401).json({ erro: 'Não autenticado' });

    const escritorioId = req.user.escritorio_id;
    const assId = parseInt(req.params.id);

    try {
        const assRes = await pool.query(
            `SELECT * FROM assinaturas_digitais WHERE id = $1 AND escritorio_id = $2`,
            [assId, escritorioId]
        );
        if (assRes.rows.length === 0) return res.status(404).json({ erro: 'Assinatura não encontrada' });

        const ass = assRes.rows[0];
        if (!ass.clicksign_document_key) return res.status(400).json({ erro: 'Chave ClickSign não disponível' });

        const { status: csStatus } = await clicksignService.buscarStatus(ass.clicksign_document_key);

        const statusMap = { closed: 'concluido', canceled: 'cancelado', running: 'em_assinatura' };
        const novoStatus = statusMap[csStatus] || ass.status;

        if (novoStatus !== ass.status) {
            await pool.query(`
                UPDATE assinaturas_digitais
                SET status = $1,
                    atualizado_em = NOW(),
                    concluido_em = CASE WHEN $1 = 'concluido' THEN NOW() ELSE concluido_em END
                WHERE id = $2
            `, [novoStatus, assId]);
            console.log(`[ASSINATURA] Verificação manual: #${assId} ${ass.status} → ${novoStatus}`);
        }

        res.json({ ok: true, status: novoStatus, atualizado: novoStatus !== ass.status });
    } catch (err) {
        console.error('[ASSINATURA] Erro ao verificar status:', err.message);
        res.status(500).json({ erro: 'Erro ao verificar status no ClickSign' });
    }
});

// ─── DELETE /api/assinaturas/:id (admin only) ────────────────────────────────
// Cancela uma assinatura ativa no ClickSign e marca como cancelada
router.delete('/assinaturas/:id', async (req, res) => {
    if (!req.user) return res.status(401).json({ erro: 'Não autenticado' });
    if (req.user.role !== 'admin') {
        return res.status(403).json({ erro: 'Apenas administradores podem cancelar assinaturas' });
    }

    const escritorioId = req.user.escritorio_id;
    const assId = parseInt(req.params.id);

    try {
        const assRes = await pool.query(
            `SELECT * FROM assinaturas_digitais WHERE id = $1 AND escritorio_id = $2`,
            [assId, escritorioId]
        );
        if (assRes.rows.length === 0) {
            return res.status(404).json({ erro: 'Assinatura não encontrada' });
        }
        const ass = assRes.rows[0];

        if (ass.clicksign_document_key) {
            try {
                await clicksignService.cancelarDocumento(ass.clicksign_document_key);
            } catch (csErr) {
                // Não bloqueia a operação — pode já estar cancelado no ClickSign
                console.warn('[ASSINATURA] Aviso ao cancelar no ClickSign:', csErr.response?.data || csErr.message);
            }
        }

        await pool.query(
            `UPDATE assinaturas_digitais SET status = 'cancelado', atualizado_em = NOW() WHERE id = $1`,
            [assId]
        );

        res.json({ ok: true });
    } catch (err) {
        console.error('[ASSINATURA] Erro ao cancelar assinatura:', err.message);
        res.status(500).json({ erro: 'Erro ao cancelar assinatura' });
    }
});

module.exports = router;
