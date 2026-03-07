const axios = require('axios');
const { breakers } = require('../utils/circuitBreaker');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function getBrevoConfig() {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = process.env.BREVO_SENDER || 'contato@lawtechpro.com.br';
    if (!apiKey) {
        console.warn('⚠️ BREVO_API_KEY não configurada. E-mails CRM não serão enviados.');
        return null;
    }
    return { apiKey, sender };
}

async function enviarEmailCRM({ para, assunto, html }) {
    const config = getBrevoConfig();
    if (!config) return false;
    try {
        await breakers.brevo.call(() => axios.post(BREVO_URL, {
            sender: { name: 'LawTech Pro', email: config.sender },
            to: [{ email: para }],
            subject: assunto,
            htmlContent: html
        }, { headers: { 'api-key': config.apiKey } }));
        console.log(`📧 [CRM] E-mail enviado para ${para} — ${assunto}`);
        return true;
    } catch (error) {
        console.warn('⚠️ [CRM] Falha ao enviar e-mail:', error.response?.data || error.message);
        return false;
    }
}

function layoutBase(conteudo) {
    return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafb;">
        <div style="background: #1E3A5F; padding: 32px 24px; text-align: center;">
            <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png"
                 alt="LawTech Pro" style="max-width: 180px; height: auto; margin: 0 auto 8px; display: block;" />
            <p style="color: rgba(255,255,255,0.7); margin: 0; font-size: 13px;">Sistema Jurídico Inteligente</p>
        </div>
        <div style="padding: 32px 24px; background: white;">
            ${conteudo}
        </div>
        <div style="padding: 16px 24px; text-align: center; color: #7B8794; font-size: 11px;">
            <p>Este é um e-mail automático do LawTech Pro.</p>
        </div>
    </div>`;
}

async function enviarBoasVindasLead({ nomeAdvogado, nomeEscritorio, nomeLead, emailLead, areaInteresse }) {
    const html = layoutBase(`
        <h2 style="color: #1E3A5F; margin-bottom: 16px;">Olá, ${nomeLead}! 👋</h2>
        <p style="color: #4A5568; line-height: 1.7; margin-bottom: 16px;">
            Recebemos seu contato sobre <strong>${areaInteresse || 'questão jurídica'}</strong>
            e estamos muito felizes em poder ajudar.
        </p>
        <p style="color: #4A5568; line-height: 1.7; margin-bottom: 24px;">
            Em breve, <strong>${nomeAdvogado}</strong>, do escritório <strong>${nomeEscritorio}</strong>,
            entrará em contato para entender melhor sua situação.
        </p>
        <div style="background: #EBF4FF; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
            <p style="margin: 0; color: #2B6CB0; font-size: 14px;">
                ⏱️ <strong>Tempo médio de resposta:</strong> até 1 dia útil.
            </p>
        </div>
        <p style="color: #718096; font-size: 13px;">
            Atenciosamente,<br><strong>${nomeEscritorio}</strong>
        </p>
    `);
    return enviarEmailCRM({
        para: emailLead,
        assunto: `Recebemos seu contato — ${nomeEscritorio}`,
        html
    });
}

async function enviarEmailEtapa({ etapa, nomeAdvogado, nomeEscritorio, nomeLead, emailLead, areaInteresse, linkFicha }) {
    const area = areaInteresse || 'questão jurídica';
    const templates = {
        triagem: {
            assunto: `Estamos analisando seu caso — ${nomeEscritorio}`,
            corpo: `
                <h2 style="color: #1E3A5F; margin-bottom: 16px;">Olá, ${nomeLead}! 📋</h2>
                <p style="color: #4A5568; line-height: 1.7; margin-bottom: 16px;">
                    Estamos analisando seu caso sobre <strong>${area}</strong>.
                </p>
                <p style="color: #4A5568; line-height: 1.7; margin-bottom: 24px;">
                    Em breve, <strong>${nomeAdvogado}</strong> agendará uma conversa para
                    entender todos os detalhes da sua situação.
                </p>
                <p style="color: #718096; font-size: 13px;">
                    Atenciosamente,<br><strong>${nomeEscritorio}</strong>
                </p>
            `
        },
        proposta: {
            assunto: `Preparamos uma proposta para você — ${nomeEscritorio}`,
            corpo: `
                <h2 style="color: #1E3A5F; margin-bottom: 16px;">Olá, ${nomeLead}! 📝</h2>
                <p style="color: #4A5568; line-height: 1.7; margin-bottom: 16px;">
                    Analisamos seu caso de <strong>${area}</strong> e preparamos uma proposta personalizada.
                </p>
                <p style="color: #4A5568; line-height: 1.7; margin-bottom: 24px;">
                    <strong>${nomeAdvogado}</strong> entrará em contato em breve para apresentar os detalhes.
                </p>
                <p style="color: #718096; font-size: 13px;">
                    Atenciosamente,<br><strong>${nomeEscritorio}</strong>
                </p>
            `
        },
        ganho: {
            assunto: `Bem-vindo ao ${nomeEscritorio}! 🎉`,
            corpo: `
                <h2 style="color: #1E3A5F; margin-bottom: 16px;">Bem-vindo, ${nomeLead}! 🎉</h2>
                <p style="color: #4A5568; line-height: 1.7; margin-bottom: 16px;">
                    É com grande satisfação que damos as boas-vindas como novo cliente do
                    <strong>${nomeEscritorio}</strong>!
                </p>
                <p style="color: #4A5568; line-height: 1.7; margin-bottom: 24px;">
                    Para agilizarmos o início do seu atendimento, por favor, preencha sua ficha de cadastro:
                </p>
                ${linkFicha ? `
                <div style="text-align: center; margin-bottom: 24px;">
                    <a href="${linkFicha}"
                       style="display: inline-block; background: #4A90E2; color: white; text-decoration: none;
                              padding: 14px 36px; border-radius: 8px; font-weight: 700; font-size: 15px;">
                        Preencher Ficha de Cadastro →
                    </a>
                </div>` : ''}
                <p style="color: #718096; font-size: 13px;">
                    Atenciosamente,<br><strong>${nomeEscritorio}</strong>
                </p>
            `
        }
    };

    const tpl = templates[etapa];
    if (!tpl) return false;
    return enviarEmailCRM({
        para: emailLead,
        assunto: tpl.assunto,
        html: layoutBase(tpl.corpo)
    });
}

async function enviarEmailReativacao({ nomeAdvogado, nomeEscritorio, nomeLead, emailLead, areaInteresse }) {
    const area = areaInteresse || 'questão jurídica';
    const html = layoutBase(`
        <h2 style="color: #1E3A5F; margin-bottom: 16px;">Ainda podemos ajudar, ${nomeLead}? 🤝</h2>
        <p style="color: #4A5568; line-height: 1.7; margin-bottom: 16px;">
            Notamos que você entrou em contato sobre <strong>${area}</strong>
            e queremos saber se ainda precisa de assistência jurídica.
        </p>
        <p style="color: #4A5568; line-height: 1.7; margin-bottom: 24px;">
            Nossa equipe está pronta para ajudar. Basta responder este e-mail ou entrar em
            contato diretamente com <strong>${nomeAdvogado}</strong>.
        </p>
        <div style="background: #F0FFF4; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
            <p style="margin: 0; color: #276749; font-size: 14px;">
                💚 Estamos à disposição para resolver sua questão de <strong>${area}</strong>.
            </p>
        </div>
        <p style="color: #718096; font-size: 13px;">
            Atenciosamente,<br><strong>${nomeEscritorio}</strong>
        </p>
    `);
    return enviarEmailCRM({
        para: emailLead,
        assunto: `Ainda precisa de ajuda jurídica? — ${nomeEscritorio}`,
        html
    });
}

async function enviarAlertaLeadParado({ emailAdvogado, nomeAdvogado, nomeLead, diasParado, etapaAtual }) {
    const corUrgencia = diasParado >= 7 ? '#E76F51' : '#F2A65A';
    const html = layoutBase(`
        <div style="background: ${corUrgencia}22; border-left: 4px solid ${corUrgencia}; padding: 16px;
                    border-radius: 0 8px 8px 0; margin-bottom: 24px;">
            <p style="margin: 0; font-weight: 700; color: ${corUrgencia}; font-size: 16px;">
                ⚠️ Lead parado há ${diasParado} dia(s)
            </p>
        </div>
        <p style="color: #4A5568; line-height: 1.7; margin-bottom: 16px;">
            Olá, <strong>${nomeAdvogado}</strong>!
        </p>
        <p style="color: #4A5568; line-height: 1.7; margin-bottom: 24px;">
            O lead <strong>${nomeLead}</strong> está parado há <strong>${diasParado} dia(s)</strong>
            na etapa <strong>${etapaAtual}</strong> sem movimentação.
        </p>
        <p style="color: #4A5568; line-height: 1.7; margin-bottom: 24px;">
            Recomendamos entrar em contato para não perder essa oportunidade.
        </p>
        <div style="text-align: center; margin-bottom: 24px;">
            <a href="https://www.lawtechpro.com.br/crm-page"
               style="display: inline-block; background: #4A90E2; color: white; text-decoration: none;
                      padding: 12px 32px; border-radius: 6px; font-weight: 600; font-size: 14px;">
                Ver CRM →
            </a>
        </div>
    `);
    return enviarEmailCRM({
        para: emailAdvogado,
        assunto: `⚠️ Lead parado: ${nomeLead} (${diasParado} dias em ${etapaAtual})`,
        html
    });
}

module.exports = {
    enviarBoasVindasLead,
    enviarEmailEtapa,
    enviarEmailReativacao,
    enviarAlertaLeadParado
};
