const axios = require('axios');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function getBrevoConfig() {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = process.env.BREVO_SENDER || 'contato@lawtechpro.com.br';
    if (!apiKey) {
        console.warn('⚠️ BREVO_API_KEY não configurada. E-mails não serão enviados.');
        return null;
    }
    return { apiKey, sender };
}

/**
 * Enviar e-mail genérico via Brevo
 */
async function enviarEmail({ para, assunto, texto, html }) {
    const config = getBrevoConfig();
    if (!config) return;

    try {
        await axios.post(BREVO_URL, {
            sender: { name: 'LawTech Pro', email: config.sender },
            to: [{ email: para }],
            subject: assunto,
            htmlContent: html || `<p>${texto || ''}</p>`
        }, { headers: { 'api-key': config.apiKey } });

        console.log(`📧 Email enviado para ${para}`);
    } catch (error) {
        console.error('❌ Erro ao enviar email:', error.response?.data || error.message);
    }
}

/**
 * Envia alerta de prazo por e-mail com template HTML
 */
async function enviarAlertaPrazo(email, dadosPrazo) {
    const config = getBrevoConfig();
    if (!config) return { ok: false, erro: 'Brevo não configurado' };

    try {
        const { escritorio_nome, tipo, processo, cliente, data_limite, dias_restantes } = dadosPrazo;

        const corUrgencia = dias_restantes <= 1 ? '#E76F51' : dias_restantes <= 3 ? '#F2A65A' : '#4A90E2';
        const textoUrgencia = dias_restantes < 0
            ? `ATRASADO há ${Math.abs(dias_restantes)} dia(s)`
            : dias_restantes === 0
                ? 'VENCE HOJE'
                : `Vence em ${dias_restantes} dia(s)`;

        const dataFormatada = new Date(data_limite).toLocaleDateString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        });

        const html = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafb;">
            <div style="background: #1E3A5F; padding: 32px 24px; text-align: center;">
                <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width: 200px; height: auto; margin: 0 auto 12px; display: block;" />
                <p style="color: rgba(255,255,255,0.8); margin: 0; font-size: 14px;">Sistema Jurídico Inteligente</p>
            </div>
            <div style="padding: 32px 24px; background: white;">
                <div style="background: ${corUrgencia}15; border-left: 4px solid ${corUrgencia}; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
                    <p style="margin: 0; font-weight: 700; color: ${corUrgencia}; font-size: 16px;">🔔 ${textoUrgencia}</p>
                </div>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr><td style="padding: 8px 0; color: #7B8794; font-size: 13px;">Tipo</td><td style="padding: 8px 0; font-weight: 600;">${tipo || 'Prazo'}</td></tr>
                    <tr><td style="padding: 8px 0; color: #7B8794; font-size: 13px;">Processo</td><td style="padding: 8px 0; font-weight: 600;">${processo || '—'}</td></tr>
                    <tr><td style="padding: 8px 0; color: #7B8794; font-size: 13px;">Cliente</td><td style="padding: 8px 0; font-weight: 600;">${cliente || '—'}</td></tr>
                    <tr><td style="padding: 8px 0; color: #7B8794; font-size: 13px;">Data Limite</td><td style="padding: 8px 0; font-weight: 700; color: ${corUrgencia};">${dataFormatada}</td></tr>
                </table>
                <div style="text-align: center; margin-top: 28px;">
                    <a href="https://www.lawtechpro.com.br/prazos-page"
                       style="display: inline-block; background: #4A90E2; color: white; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600; font-size: 14px;">
                        Ver no Sistema →
                    </a>
                </div>
            </div>
            <div style="padding: 16px 24px; text-align: center; color: #7B8794; font-size: 11px;">
                <p>Este é um alerta automático do LawTech Pro. Gerencie suas notificações em Configurações.</p>
            </div>
        </div>`;

        await axios.post(BREVO_URL, {
            sender: { name: 'LawTech Pro', email: config.sender },
            to: [{ email }],
            subject: `⚖️ ${textoUrgencia} — ${tipo || 'Prazo'} ${processo ? '(' + processo + ')' : ''}`,
            htmlContent: html
        }, { headers: { 'api-key': config.apiKey } });

        console.log(`📧 Alerta de prazo enviado para ${email}`);
        return { ok: true };
    } catch (error) {
        console.warn('⚠️ Falha ao enviar alerta de prazo:', error.response?.data || error.message);
        return { ok: false, erro: error.message };
    }
}

/**
 * Envia e-mail de cobrança PIX ao vencer o trial
 * @param {string} email
 * @param {{ nomeEscritorio: string, planoNome: string, valor: number, pixQrCodeBase64: string, pixPayload: string, diasParaSuspensao: number }} dados
 */
async function enviarEmailCobrancaPix(email, dados) {
    const config = getBrevoConfig();
    if (!config) return;

    const { nomeEscritorio, planoNome, valor, pixQrCodeBase64, pixPayload, diasParaSuspensao = 3 } = dados;
    const valorFmt = parseFloat(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() + diasParaSuspensao);
    const dataLimiteFmt = dataLimite.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafb;">
        <div style="background:#1E3A5F;padding:32px 24px;text-align:center;">
            <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:200px;height:auto;margin:0 auto 12px;display:block;"/>
            <p style="color:rgba(255,255,255,0.8);margin:0;font-size:14px;">Sistema Jurídico Inteligente</p>
        </div>
        <div style="padding:32px 24px;background:white;">
            <h2 style="color:#0f172a;font-size:20px;margin:0 0 8px;">Seu período de teste encerrou 🎉</h2>
            <p style="color:#475569;font-size:15px;margin:0 0 24px;">
                Olá, <strong>${nomeEscritorio}</strong>! Esperamos que tenha aproveitado o LawTech Pro.
                Para continuar com acesso completo, realize o pagamento via PIX abaixo.
            </p>

            <div style="background:#f0fdf4;border:2px solid #10b981;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
                <p style="margin:0 0 4px;font-size:13px;color:#065f46;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Plano ${planoNome}</p>
                <p style="margin:0 0 16px;font-size:32px;font-weight:800;color:#059669;">${valorFmt}<span style="font-size:14px;font-weight:500;color:#6b7280;">/mês</span></p>
                <img src="data:image/png;base64,${pixQrCodeBase64}" alt="QR Code PIX" style="width:180px;height:180px;display:block;margin:0 auto 16px;border:1px solid #d1fae5;border-radius:8px;padding:6px;"/>
                <p style="margin:0 0 8px;font-size:12px;color:#6b7280;">Ou copie o código Pix Copia e Cola:</p>
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:11px;color:#475569;word-break:break-all;text-align:left;">
                    ${pixPayload}
                </div>
            </div>

            <div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:24px;">
                <p style="margin:0;color:#92400e;font-size:13px;">
                    ⚠️ <strong>Atenção:</strong> Se o pagamento não for confirmado até <strong>${dataLimiteFmt}</strong>,
                    sua conta será suspensa temporariamente.
                </p>
            </div>

            <div style="text-align:center;">
                <a href="https://www.lawtechpro.com.br/pagamento-pendente"
                   style="display:inline-block;background:#2563eb;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px;">
                    Acessar página de pagamento →
                </a>
            </div>
        </div>
        <div style="padding:16px 24px;text-align:center;color:#94a3b8;font-size:11px;">
            <p>LawTech Pro · Este é um e-mail automático de cobrança.</p>
        </div>
    </div>`;

    try {
        await axios.post(BREVO_URL, {
            sender: { name: 'LawTech Pro', email: config.sender },
            to: [{ email }],
            subject: `💳 Seu trial encerrou — Pague via PIX e continue usando o LawTech Pro`,
            htmlContent: html
        }, { headers: { 'api-key': config.apiKey } });
        console.log(`📧 [PIX COBRANÇA] E-mail enviado para ${email}`);
    } catch (err) {
        console.error('❌ Erro ao enviar e-mail PIX cobrança:', err.response?.data || err.message);
    }
}

module.exports = { enviarEmail, enviarAlertaPrazo, enviarEmailCobrancaPix };
