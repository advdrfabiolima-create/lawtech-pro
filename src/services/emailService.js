const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false, // Porta 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function enviarEmail({ para, assunto, texto, html }) {
  try {
    await transporter.sendMail({
      from: `"LawTech Pro" <${process.env.EMAIL_USER}>`,
      to: para,
      subject: assunto,
      text: texto || '',
      html: html || `<p>${texto}</p>`
    });

    console.log(`📧 Email enviado para ${para}`);
  } catch (error) {
    console.error('❌ Erro ao enviar email:', error.message);
  }
}

/**
 * Envia alerta de prazo por e-mail com template HTML
 */
async function enviarAlertaPrazo(email, dadosPrazo) {
  try {
    const { escritorio_nome, tipo, processo, cliente, data_limite, dias_restantes, prazo_id } = dadosPrazo;

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
      <div style="background: #1E3A5F; padding: 24px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">⚖️ LawTech Pro</h1>
        <p style="color: rgba(255,255,255,0.7); margin: 4px 0 0; font-size: 13px;">${escritorio_nome || 'Seu Escritório'}</p>
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
          <a href="${process.env.APP_URL || 'https://lawtechpro.com.br'}/prazos-page"
             style="display: inline-block; background: #4A90E2; color: white; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600; font-size: 14px;">
            Ver no Sistema →
          </a>
        </div>
      </div>
      <div style="padding: 16px 24px; text-align: center; color: #7B8794; font-size: 11px;">
        <p>Este é um alerta automático do LawTech Pro. Gerencie suas notificações em Configurações.</p>
      </div>
    </div>`;

    await transporter.sendMail({
      from: `"LawTech Pro" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `⚖️ ${textoUrgencia} — ${tipo || 'Prazo'} ${processo ? '(' + processo + ')' : ''}`,
      html
    });

    console.log(`📧 Alerta de prazo enviado para ${email}`);
    return { ok: true };
  } catch (error) {
    console.warn('⚠️ Falha ao enviar alerta de prazo:', error.message);
    return { ok: false, erro: error.message };
  }
}

module.exports = { enviarEmail, enviarAlertaPrazo };