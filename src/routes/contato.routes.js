const express = require('express');
const router = express.Router();
const { enviarEmail } = require('../services/emailService');

/**
 * POST /api/contato
 * Recebe o formulário de contato do site e envia para contato@lawtechpro.com.br
 */
router.post('/contato', async (req, res) => {
    try {
        const { nome, email, telefone, motivo, mensagem } = req.body;

        if (!nome || !email || !mensagem) {
            return res.status(400).json({ erro: 'Nome, e-mail e mensagem são obrigatórios' });
        }

        const motivoLabel = {
            suporte: 'Suporte Técnico',
            comercial: 'Comercial / Vendas',
            financeiro: 'Financeiro',
            outro: 'Outro'
        }[motivo] || motivo || 'Não informado';

        const html = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafb;">
            <div style="background:#1E3A5F;padding:32px 24px;text-align:center;">
                <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:200px;height:auto;margin:0 auto 12px;" />
                <p style="color:rgba(255,255,255,0.8);margin:0;font-size:14px;">Sistema Jurídico Inteligente</p>
            </div>
            <div style="padding:32px 24px;background:white;">
                <h2 style="color:#1E3A5F;margin:0 0 20px;font-size:20px;">📬 Nova mensagem de contato</h2>
                <table style="width:100%;border-collapse:collapse;">
                    <tr>
                        <td style="padding:8px 0;color:#7B8794;font-size:13px;width:110px;">Nome</td>
                        <td style="padding:8px 0;font-weight:600;color:#2D3748;">${nome}</td>
                    </tr>
                    <tr>
                        <td style="padding:8px 0;color:#7B8794;font-size:13px;">E-mail</td>
                        <td style="padding:8px 0;font-weight:600;"><a href="mailto:${email}" style="color:#4A90E2;">${email}</a></td>
                    </tr>
                    <tr>
                        <td style="padding:8px 0;color:#7B8794;font-size:13px;">Telefone</td>
                        <td style="padding:8px 0;font-weight:600;color:#2D3748;">${telefone || 'Não informado'}</td>
                    </tr>
                    <tr>
                        <td style="padding:8px 0;color:#7B8794;font-size:13px;">Motivo</td>
                        <td style="padding:8px 0;font-weight:600;color:#2D3748;">${motivoLabel}</td>
                    </tr>
                </table>
                <div style="margin-top:20px;padding:16px;background:#f8fafb;border-radius:8px;border:1px solid #e2e8f0;">
                    <p style="margin:0 0 8px;color:#7B8794;font-size:13px;">Mensagem:</p>
                    <p style="margin:0;color:#2D3748;font-size:14px;line-height:1.7;">${mensagem.replace(/\n/g, '<br>')}</p>
                </div>
            </div>
            <div style="padding:20px 24px;text-align:center;background:#f8fafb;border-top:1px solid #e2e8f0;">
                <p style="color:#7B8794;font-size:11px;margin:0;">LawTech Pro — Sistema Jurídico Inteligente</p>
                <p style="color:#A0AEC0;font-size:10px;margin:4px 0 0;">Este é um e-mail automático gerado pelo formulário de contato do site.</p>
            </div>
        </div>`;

        await enviarEmail({
            para: 'contato@lawtechpro.com.br',
            assunto: `📬 Contato via site: ${motivoLabel} — ${nome}`,
            html
        });

        console.log(`📬 Formulário de contato recebido de ${email} (${motivoLabel})`);

        res.json({ ok: true, mensagem: 'Mensagem enviada com sucesso!' });
    } catch (err) {
        console.error('❌ Erro ao enviar formulário de contato:', err);
        res.status(500).json({ erro: 'Erro ao enviar mensagem. Tente novamente.' });
    }
});

module.exports = router;
