const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: false, // ⚠️ OBRIGATÓRIO para porta 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function enviarEmail({ para, assunto, texto }) {
  await transporter.sendMail({
    from: `"Sistema Jurídico" <${process.env.EMAIL_USER}>`,
    to: para,
    subject: assunto,
    text: texto
  });
}

module.exports = { enviarEmail };
