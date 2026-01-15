require('dotenv').config();
const axios = require('axios');

async function enviarTeste() {
  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: {
          name: process.env.EMAIL_FROM_NAME,
          email: process.env.EMAIL_FROM
        },
        to: [
          { email: 'adv.limaesilva@hotmail.com', name: 'Teste' }
        ],
        subject: 'Teste de alerta de prazo',
        htmlContent: `
          <h3>Teste realizado com sucesso</h3>
          <p>O sistema jurídico conseguiu enviar e-mail via Brevo.</p>
        `
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ E-mail enviado com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao enviar e-mail:');
    console.error(error.response?.data || error.message);
  }
}

enviarTeste();
