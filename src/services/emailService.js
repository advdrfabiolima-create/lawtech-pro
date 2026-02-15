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

module.exports = { enviarEmail };