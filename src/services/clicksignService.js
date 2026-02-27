const axios = require('axios');
const fs = require('fs');

const BASE_URL = process.env.CLICKSIGN_ENV === 'production'
    ? 'https://app.clicksign.com'
    : 'https://sandbox.clicksign.com';

const API_KEY = () => process.env.CLICKSIGN_API_KEY;

function csApi() {
    return axios.create({
        baseURL: BASE_URL,
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
    });
}

/**
 * Faz upload de um documento PDF para o ClickSign.
 * @returns {string} document_key
 */
async function uploadDocumento(filePath, nomeOriginal, deadline, mimetype = 'application/pdf') {
    const content = fs.readFileSync(filePath);
    // ClickSign exige Data URL com prefixo MIME: "data:<mime>;base64,<dados>"
    const content_base64 = `data:${mimetype};base64,${content.toString('base64')}`;
    const safeName = nomeOriginal.replace(/[^a-zA-Z0-9._-]/g, '_');
    const docPath = `/docs/${Date.now()}_${safeName}`;

    const body = {
        document: {
            path: docPath,
            content_base64,
            deadline_at: deadline || null,
            auto_close: true,
            locale: 'pt-BR',
            sequence_enabled: false
        }
    };

    const res = await csApi().post(`/api/v1/documents?access_token=${API_KEY()}`, body);
    return res.data.document.key;
}

/**
 * Cria um signatário no ClickSign.
 * @returns {string} signer_key
 */
async function criarSignatario(email, nome) {
    const body = {
        signer: {
            email,
            auths: ['email'],
            name: nome,
            has_documentation: false
        }
    };

    const res = await csApi().post(`/api/v1/signers?access_token=${API_KEY()}`, body);
    return res.data.signer.key;
}

/**
 * Adiciona um signatário a um documento no ClickSign.
 * @returns {{ requestSignatureKey: string, signingUrl: string|null }}
 */
async function adicionarSignatario(documentKey, signerKey, mensagem) {
    const body = {
        list: {
            document_key: documentKey,
            signer_key: signerKey,
            sign_as: 'sign',
            message: mensagem || null
        }
    };

    const res = await csApi().post(`/api/v1/lists?access_token=${API_KEY()}`, body);
    const list = res.data.list;
    return {
        requestSignatureKey: list.request_signature_key,
        signingUrl: list.url || null   // URL direta de assinatura retornada pelo ClickSign
    };
}

/**
 * Notifica o signatário por e-mail (dispara o e-mail da ClickSign com link de assinatura).
 */
async function notificarSignatario(requestSignatureKey, mensagem) {
    const body = {
        request_signature_key: requestSignatureKey,
        message: mensagem || null
    };

    await csApi().patch(`/api/v1/notifications?access_token=${API_KEY()}`, body);
}

/**
 * Busca o status atual de um documento no ClickSign.
 * @returns {{ status: string, signers: Array }}
 */
async function buscarStatus(documentKey) {
    const res = await csApi().get(`/api/v1/documents/${documentKey}?access_token=${API_KEY()}`);
    const doc = res.data.document;
    return {
        status: doc.status,
        signers: doc.signers || []
    };
}

/**
 * Cancela um documento no ClickSign.
 */
async function cancelarDocumento(documentKey) {
    await csApi().patch(`/api/v1/documents/${documentKey}/cancel?access_token=${API_KEY()}`, {});
}

module.exports = {
    uploadDocumento,
    criarSignatario,
    adicionarSignatario,
    notificarSignatario,
    buscarStatus,
    cancelarDocumento
};
