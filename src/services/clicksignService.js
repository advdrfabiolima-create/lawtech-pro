const axios = require('axios');
const fs = require('fs');

const BASE_URL = process.env.CLICKSIGN_ENV === 'production'
    ? 'https://app.clicksign.com'
    : 'https://sandbox.clicksign.com';

// Chave padrão do servidor (fallback caso escritório não tenha configurado a sua)
const DEFAULT_API_KEY = () => process.env.CLICKSIGN_API_KEY;

function csApi() {
    return axios.create({
        baseURL: BASE_URL,
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
    });
}

/**
 * Faz upload de um documento PDF para o ClickSign.
 * @param {string} apiKey - Chave API do escritório (BYOK)
 * @returns {string} document_key
 */
async function uploadDocumento(filePathOrBuffer, nomeOriginal, deadline, mimetype = 'application/pdf', apiKey) {
    const key = apiKey || DEFAULT_API_KEY();
    const content = Buffer.isBuffer(filePathOrBuffer)
        ? filePathOrBuffer
        : fs.readFileSync(filePathOrBuffer);
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

    const res = await csApi().post(`/api/v1/documents?access_token=${key}`, body);
    return res.data.document.key;
}

/**
 * Cria um signatário no ClickSign.
 * @param {string} apiKey - Chave API do escritório (BYOK)
 * @returns {string} signer_key
 */
async function criarSignatario(email, nome, apiKey) {
    const key = apiKey || DEFAULT_API_KEY();
    const body = {
        signer: {
            email,
            auths: ['email'],
            name: nome,
            has_documentation: false
        }
    };

    const res = await csApi().post(`/api/v1/signers?access_token=${key}`, body);
    return res.data.signer.key;
}

/**
 * Adiciona um signatário a um documento no ClickSign.
 * @param {string} apiKey - Chave API do escritório (BYOK)
 * @returns {{ requestSignatureKey: string, signingUrl: string|null }}
 */
async function adicionarSignatario(documentKey, signerKey, mensagem, apiKey) {
    const key = apiKey || DEFAULT_API_KEY();
    const body = {
        list: {
            document_key: documentKey,
            signer_key: signerKey,
            sign_as: 'sign',
            message: mensagem || null
        }
    };

    const res = await csApi().post(`/api/v1/lists?access_token=${key}`, body);
    const list = res.data.list;
    return {
        requestSignatureKey: list.request_signature_key,
        signingUrl: list.url || null
    };
}

/**
 * Notifica o signatário por e-mail.
 * @param {string} apiKey - Chave API do escritório (BYOK)
 */
async function notificarSignatario(requestSignatureKey, mensagem, apiKey) {
    const key = apiKey || DEFAULT_API_KEY();
    const body = {
        request_signature_key: requestSignatureKey,
        message: mensagem || null
    };

    await csApi().patch(`/api/v1/notifications?access_token=${key}`, body);
}

/**
 * Busca o status atual de um documento no ClickSign.
 * @param {string} apiKey - Chave API do escritório (BYOK)
 * @returns {{ status: string, signers: Array }}
 */
async function buscarStatus(documentKey, apiKey) {
    const key = apiKey || DEFAULT_API_KEY();
    const res = await csApi().get(`/api/v1/documents/${documentKey}?access_token=${key}`);
    const doc = res.data.document;
    return {
        status: doc.status,
        signers: doc.signers || []
    };
}

/**
 * Cancela um documento no ClickSign.
 * @param {string} apiKey - Chave API do escritório (BYOK)
 */
async function cancelarDocumento(documentKey, apiKey) {
    const key = apiKey || DEFAULT_API_KEY();
    await csApi().patch(`/api/v1/documents/${documentKey}/cancel?access_token=${key}`, {});
}

/**
 * Baixa o PDF assinado do ClickSign.
 * @param {string} apiKey - Chave API do escritório (BYOK)
 * @returns {{ data: Buffer, filename: string }}
 */
async function downloadDocumentoAssinado(documentKey, apiKey) {
    const key = apiKey || DEFAULT_API_KEY();

    // 1. Busca metadados completos do documento
    const metaRes = await csApi().get(`/api/v1/documents/${documentKey}?access_token=${key}`);
    const doc = metaRes.data.document;

    // 2. Tenta obter a URL de download dos metadados
    const downloadUrl = doc.downloads?.file_url
        || doc.downloads?.signed_file_url
        || doc.file_download_url
        || doc.signed_file_url
        || null;

    console.log(`[ClickSign] Download doc ${documentKey} — status: ${doc.status} — downloadUrl: ${downloadUrl || 'não encontrada nos metadados'}`);

    let fileBuffer;
    if (downloadUrl) {
        const fileRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
        fileBuffer = Buffer.from(fileRes.data);
    } else {
        const directRes = await csApi().get(
            `/api/v1/documents/${documentKey}/download?access_token=${key}`,
            { responseType: 'arraybuffer' }
        );
        const contentType = directRes.headers['content-type'] || '';
        if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
            throw new Error(`ClickSign retornou conteúdo inesperado (${contentType}). O documento pode ainda estar em processamento.`);
        }
        fileBuffer = Buffer.from(directRes.data);
    }

    const filename = `documento_assinado_${documentKey}.pdf`;
    return { data: fileBuffer, filename };
}

module.exports = {
    uploadDocumento,
    criarSignatario,
    adicionarSignatario,
    notificarSignatario,
    buscarStatus,
    cancelarDocumento,
    downloadDocumentoAssinado
};
