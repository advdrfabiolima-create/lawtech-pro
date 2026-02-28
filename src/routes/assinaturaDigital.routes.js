const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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
    const { mensagem, deadline, signatarioNome, signatarioEmail } = req.body;

    try {
        // 0. Verificar acesso ao ClickSign (plano + addon + chave API)
        const escritorioRes = await pool.query(`
            SELECT e.clicksign_addon_ativo, e.clicksign_addon_limite, e.clicksign_addon_usado,
                   e.clicksign_api_key, p.slug AS plano_slug
            FROM escritorios e
            LEFT JOIN planos p ON p.id = e.plano_id
            WHERE e.id = $1
        `, [escritorioId]);
        const esc = escritorioRes.rows[0];

        if (!esc?.clicksign_api_key) {
            return res.status(403).json({ erro: 'clicksign_key_ausente' });
        }

        const clicksignApiKey = esc.clicksign_api_key;

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

        // 3. Verificar assinatura ativa (não cancelada, não com erro, não concluída)
        const assAtiva = await pool.query(
            `SELECT id FROM assinaturas_digitais
             WHERE documento_id = $1 AND status NOT IN ('cancelado', 'erro', 'concluido')`,
            [docId]
        );
        if (assAtiva.rows.length > 0) {
            return res.status(400).json({ erro: 'Já existe uma assinatura ativa para este documento. Cancele-a antes de iniciar uma nova.' });
        }

        // 4. Resolver signatário — processo vinculado OU informado manualmente
        let parteNome, parteEmail;

        if (doc.processo_id) {
            // Busca polo ativo do processo
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
            parteNome  = parte.pessoa_nome;
            parteEmail = parte.pessoa_email;
        } else {
            // Documento sem processo — signatário informado manualmente
            if (!signatarioEmail || !signatarioNome) {
                return res.status(400).json({ erro: 'Informe o nome e e-mail do signatário para documentos sem processo vinculado' });
            }
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(signatarioEmail)) {
                return res.status(400).json({ erro: 'E-mail do signatário inválido' });
            }
            parteNome  = signatarioNome.trim();
            parteEmail = signatarioEmail.trim().toLowerCase();
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
            doc.mimetype,
            clicksignApiKey
        );
        console.log('[ClickSign] Etapa 1 OK — document_key:', documentKey);

        console.log('[ClickSign] Etapa 2: criar signatário:', parteEmail);
        const signerKey = await clicksignService.criarSignatario(parteEmail, parteNome, clicksignApiKey);
        console.log('[ClickSign] Etapa 2 OK — signer_key:', signerKey);

        console.log('[ClickSign] Etapa 3: adicionar signatário ao documento...');
        const { requestSignatureKey, signingUrl } = await clicksignService.adicionarSignatario(documentKey, signerKey, mensagem || null, clicksignApiKey);
        console.log('[ClickSign] Etapa 3 OK — request_signature_key:', requestSignatureKey);
        console.log('[ClickSign] Etapa 3 — signing URL:', signingUrl);

        // 10. Registrar na base
        const signatarios = JSON.stringify([{
            nome: parteNome,
            email: parteEmail,
            signer_key: signerKey,
            request_signature_key: requestSignatureKey,
            signing_url: signingUrl
        }]);

        await pool.query(`
            INSERT INTO assinaturas_digitais
                (documento_id, escritorio_id, usuario_id, clicksign_document_key, status, signatarios, mensagem, deadline, link_assinatura)
            VALUES ($1, $2, $3, $4, 'enviado', $5::jsonb, $6, $7, $8)
        `, [docId, escritorioId, usuarioId, documentKey, signatarios, mensagem || null, deadline || null, signingUrl || null]);

        // Incrementar contador do add-on
        await pool.query(
            'UPDATE escritorios SET clicksign_addon_usado = clicksign_addon_usado + 1 WHERE id = $1',
            [escritorioId]
        );

        // 11. Enviar e-mail via Brevo com o link de assinatura
        const emailEnviado = await enviarEmailAssinatura({
            para: parteEmail,
            nomeSignatario: parteNome,
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
// Eventos tratados: sign (assinatura parcial), auto_close/closed (concluído),
//                   cancel/canceled (cancelado), deadline (expirado)
router.post('/clicksign', async (req, res) => {
    try {
        // Autenticação: o hook foi registrado sem authenticity_token,
        // portanto nenhum token é enviado pelo ClickSign.
        // A segurança é garantida pela obscuridade da URL /webhook/clicksign.

        const event = req.body?.event;
        if (!event) return res.sendStatus(200);

        const eventName = event.name;         // 'sign', 'auto_close', 'cancel', 'deadline', etc.
        const docData = event?.data?.document;
        if (!docData) return res.sendStatus(200);

        const documentKey = docData.key;
        const csStatus = docData.status;      // 'running', 'closed', 'canceled'

        if (!documentKey) return res.sendStatus(200);

        console.log(`[WEBHOOK/ClickSign] Evento "${eventName}" — doc ${documentKey} — status ClickSign: "${csStatus}"`);

        // 2. Buscar o registro de assinatura na base
        const assRes = await pool.query(
            `SELECT id, documento_id, escritorio_id, usuario_id, status, signatarios
             FROM assinaturas_digitais WHERE clicksign_document_key = $1`,
            [documentKey]
        );
        if (assRes.rows.length === 0) {
            console.warn(`[WEBHOOK/ClickSign] Documento ${documentKey} não encontrado na base — ignorando`);
            return res.sendStatus(200);
        }
        const ass = assRes.rows[0];

        // 3. Evento "sign": alguém assinou (pode ser o último — documento fecha automaticamente)
        if (eventName === 'sign') {
            const signerData = event.data?.signer;
            if (signerData?.key) {
                const signatariosAtual = Array.isArray(ass.signatarios) ? ass.signatarios : [];
                const signatariosAtualizados = signatariosAtual.map(s =>
                    s.signer_key === signerData.key
                        ? { ...s, assinado: true, assinado_em: signerData.signed_at || new Date().toISOString() }
                        : s
                );

                // Com auto_close:true e único signatário, o ClickSign envia "sign"
                // com document.status="closed" — já é a conclusão definitiva.
                const statusFinal = csStatus === 'closed' ? 'concluido' : 'em_assinatura';

                await pool.query(`
                    UPDATE assinaturas_digitais
                    SET signatarios   = $1::jsonb,
                        status        = $3,
                        atualizado_em = NOW(),
                        concluido_em  = $4
                    WHERE id = $2 AND status NOT IN ('concluido', 'cancelado')
                `, [
                    JSON.stringify(signatariosAtualizados),
                    ass.id,
                    statusFinal,
                    statusFinal === 'concluido' ? new Date() : ass.concluido_em
                ]);

                console.log(`[WEBHOOK/ClickSign] Signer ${signerData.key} (${signerData.email || '?'}) assinou — doc ${documentKey} → ${statusFinal}`);

                // Notificação interna quando a assinatura for concluída via evento sign
                if (statusFinal === 'concluido') {
                    try {
                        const docRes = await pool.query('SELECT nome FROM documentos WHERE id = $1', [ass.documento_id]);
                        const nomeDoc = docRes.rows[0]?.nome || 'Documento';
                        await pool.query(`
                            INSERT INTO notificacoes
                                (escritorio_id, usuario_id, prazo_id, tipo, titulo, mensagem)
                            VALUES ($1, $2, NULL, 'inapp', $3, $4)
                        `, [
                            ass.escritorio_id,
                            ass.usuario_id,
                            '✅ Documento assinado com sucesso',
                            `O documento "${nomeDoc}" foi assinado por todos os signatários.`
                        ]);
                    } catch (notifErr) {
                        console.warn('[WEBHOOK/ClickSign] Falha ao criar notificação (sign+closed):', notifErr.message);
                    }
                }
            }
            return res.sendStatus(200);
        }

        // 4. Evento "deadline": prazo expirado → cancelado
        if (eventName === 'deadline') {
            await pool.query(`
                UPDATE assinaturas_digitais
                SET status        = 'cancelado',
                    atualizado_em = NOW()
                WHERE id = $1 AND status NOT IN ('concluido', 'cancelado')
            `, [ass.id]);
            console.log(`[WEBHOOK/ClickSign] Prazo expirado — doc ${documentKey} cancelado`);
            return res.sendStatus(200);
        }

        // 5. Demais eventos: basear decisão no status do documento ClickSign
        const statusMap = {
            closed:   'concluido',
            canceled: 'cancelado'
        };
        const novoStatus = statusMap[csStatus];
        if (!novoStatus || novoStatus === ass.status) return res.sendStatus(200);

        await pool.query(`
            UPDATE assinaturas_digitais
            SET status        = $1,
                atualizado_em = NOW(),
                concluido_em  = $3
            WHERE id = $2
        `, [novoStatus, ass.id, novoStatus === 'concluido' ? new Date() : ass.concluido_em]);

        console.log(`[WEBHOOK/ClickSign] Documento ${documentKey}: ${ass.status} → ${novoStatus}`);

        // 6. Notificação interna ao escritório quando assinatura for concluída
        if (novoStatus === 'concluido') {
            try {
                const docRes = await pool.query(
                    'SELECT nome FROM documentos WHERE id = $1',
                    [ass.documento_id]
                );
                const nomeDoc = docRes.rows[0]?.nome || 'Documento';
                await pool.query(`
                    INSERT INTO notificacoes
                        (escritorio_id, usuario_id, prazo_id, tipo, titulo, mensagem)
                    VALUES ($1, $2, NULL, 'inapp', $3, $4)
                `, [
                    ass.escritorio_id,
                    ass.usuario_id,
                    '✅ Documento assinado com sucesso',
                    `O documento "${nomeDoc}" foi assinado por todos os signatários.`
                ]);
                console.log(`[WEBHOOK/ClickSign] Notificação criada para assinatura concluída — doc #${ass.documento_id}`);
            } catch (notifErr) {
                // Não bloqueia a resposta ao ClickSign
                console.warn('[WEBHOOK/ClickSign] Falha ao criar notificação:', notifErr.message);
            }
        }

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

        const escRes = await pool.query('SELECT clicksign_api_key FROM escritorios WHERE id = $1', [escritorioId]);
        const clicksignApiKey = escRes.rows[0]?.clicksign_api_key || null;

        const { status: csStatus } = await clicksignService.buscarStatus(ass.clicksign_document_key, clicksignApiKey);

        const statusMap = { closed: 'concluido', canceled: 'cancelado', running: 'em_assinatura' };
        const novoStatus = statusMap[csStatus] || ass.status;

        if (novoStatus !== ass.status) {
            await pool.query(`
                UPDATE assinaturas_digitais
                SET status        = $1,
                    atualizado_em = NOW(),
                    concluido_em  = $3
                WHERE id = $2
            `, [novoStatus, assId, novoStatus === 'concluido' ? new Date() : ass.concluido_em]);
            console.log(`[ASSINATURA] Verificação manual: #${assId} ${ass.status} → ${novoStatus}`);
        }

        res.json({ ok: true, status: novoStatus, atualizado: novoStatus !== ass.status });
    } catch (err) {
        console.error('[ASSINATURA] Erro ao verificar status:', err.message);
        res.status(500).json({ erro: 'Erro ao verificar status no ClickSign' });
    }
});

// ─── GET /api/assinaturas/:id/download ───────────────────────────────────────
// Baixa o PDF assinado diretamente do ClickSign
router.get('/assinaturas/:id/download', async (req, res) => {
    if (!req.user) return res.status(401).json({ erro: 'Não autenticado' });

    const escritorioId = req.user.escritorio_id;
    const assId = parseInt(req.params.id);

    try {
        const assRes = await pool.query(
            `SELECT ad.*, d.nome AS doc_nome
             FROM assinaturas_digitais ad
             JOIN documentos d ON d.id = ad.documento_id
             WHERE ad.id = $1 AND ad.escritorio_id = $2`,
            [assId, escritorioId]
        );
        if (assRes.rows.length === 0) {
            return res.status(404).json({ erro: 'Assinatura não encontrada' });
        }
        const ass = assRes.rows[0];

        if (ass.status !== 'concluido') {
            return res.status(400).json({ erro: 'O documento ainda não foi assinado por todos os signatários' });
        }
        if (!ass.clicksign_document_key) {
            return res.status(400).json({ erro: 'Chave ClickSign não disponível' });
        }

        const escResDown = await pool.query('SELECT clicksign_api_key FROM escritorios WHERE id = $1', [escritorioId]);
        const clicksignApiKeyDown = escResDown.rows[0]?.clicksign_api_key || null;

        const { data, filename } = await clicksignService.downloadDocumentoAssinado(ass.clicksign_document_key, clicksignApiKeyDown);

        const safeName = (ass.doc_nome || filename)
            .replace(/[^a-zA-Z0-9À-ÿ _.-]/g, '_')
            .replace(/\s+/g, '_');
        const downloadName = `${safeName}_assinado.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
        res.setHeader('Content-Length', data.length);
        res.send(data);

    } catch (err) {
        const httpStatus = err.response?.status;
        const rawData = err.response?.data;
        const bodyText = rawData
            ? (Buffer.isBuffer(rawData) ? rawData.toString('utf8').slice(0, 300) : JSON.stringify(rawData).slice(0, 300))
            : err.message;
        console.error(`[ASSINATURA] Erro ao baixar documento assinado (HTTP ${httpStatus || 'n/a'}):`, bodyText);
        res.status(500).json({ erro: err.message || 'Erro ao baixar documento assinado do ClickSign' });
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
