require('dotenv').config();
const nodemailer = require('nodemailer');

async function testar() {
  const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // ← MUITO IMPORTANTE
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  connectionTimeout: 10000
});


  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER,
    subject: 'Teste SMTP',
    text: 'Se este e-mail chegou, o SMTP está funcionando.'
  });

  console.log('📧 Email enviado com sucesso');
}

testar().catch(console.error);
