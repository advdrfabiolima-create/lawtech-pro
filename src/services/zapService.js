/**
 * zapService.js — Z-API BYOK (credenciais por escritório, salvas no banco)
 */
const axios  = require('axios');
const pool   = require('../config/db');
const logger = require('../utils/logger');

async function buscarCredenciais(escritorioId) {
    const r = await pool.query(
        `SELECT zapi_instance_id, zapi_token, zapi_client_token,
                zapi_followup_dias_lead, zapi_followup_dias_triagem, zapi_followup_dias_proposta
         FROM escritorios WHERE id = $1`,
        [escritorioId]
    );
    return r.rows[0] || null;
}

function credenciaisValidas(c) {
    return !!(c?.zapi_instance_id && c?.zapi_token && c?.zapi_client_token);
}

function formatarNumero(telefone) {
    const l = (telefone || '').replace(/\D/g, '');
    return (l.startsWith('55') && l.length >= 12) ? l : `55${l}`;
}

async function enviarMensagem(escritorioId, telefone, mensagem) {
    if (!telefone) return false;
    let creds;
    try { creds = await buscarCredenciais(escritorioId); }
    catch (e) { logger.error({ err: e.message }, '[ZAP] Erro buscar creds'); return false; }
    if (!credenciaisValidas(creds)) { logger.info({ escritorioId }, '[ZAP] Sem Z-API configurada'); return false; }
    const numero = formatarNumero(telefone);
    const base   = `https://api.z-api.io/instances/${creds.zapi_instance_id}/token/${creds.zapi_token}`;
    try {
        await axios.post(`${base}/send-text`, { phone: numero, message: mensagem },
            { headers: { 'Client-Token': creds.zapi_client_token } });
        logger.info({ numero, escritorioId }, '[ZAP] Mensagem enviada');
        return true;
    } catch (e) {
        logger.error({ status: e.response?.status, numero, escritorioId }, '[ZAP] Erro envio');
        return false;
    }
}

async function buscarDiasFollowUp(escritorioId) {
    const c = await buscarCredenciais(escritorioId);
    return { lead: c?.zapi_followup_dias_lead || 3, triagem: c?.zapi_followup_dias_triagem || 5, proposta: c?.zapi_followup_dias_proposta || 4 };
}

function msgBoasVindas(nome, area, esc) {
    const p = (nome||'cliente').trim().split(' ')[0];
    const a = (area && area !== 'Não informado') ? ` sobre *${area}*` : '';
    return `Olá, *${p}*! 👋\n\nRecebemos seu contato${a} e ficamos felizes em poder ajudar.\n\nEm breve um de nossos advogados entrará em contato.\n\n_${esc||'Escritório de Advocacia'}_`;
}
function msgTriagem(nome, adv, esc) {
    const p = (nome||'cliente').trim().split(' ')[0];
    return `Olá, *${p}*! 📋\n\nSeu caso foi analisado por *${adv||'nosso advogado'}* e estamos prontos para agendar uma conversa.\n\nQuando você tem disponibilidade?\n\n_${esc||'Escritório de Advocacia'}_`;
}
function msgProposta(nome, area, esc) {
    const p = (nome||'cliente').trim().split(' ')[0];
    const a = (area && area !== 'Não informado') ? ` para seu caso de *${area}*` : '';
    return `Olá, *${p}*! ⚖️\n\nPreparamos uma proposta de honorários${a}.\n\nPodemos apresentar os detalhes agora?\n\n_${esc||'Escritório de Advocacia'}_`;
}
function msgGanho(nome, link, esc) {
    const p = (nome||'cliente').trim().split(' ')[0];
    return `Bem-vindo ao escritório, *${p}*! 🎉\n\nEstamos muito felizes em tê-lo como cliente.\n\nPreencha sua ficha de cadastro:\n👉 ${link}\n\n_${esc||'Escritório de Advocacia'}_`;
}
function msgFollowUp(nome, dias, area, esc) {
    const p = (nome||'cliente').trim().split(' ')[0];
    const a = (area && area !== 'Não informado') ? ` sobre *${area}*` : '';
    return `Olá, *${p}*! 🔔\n\nPassaram alguns dias desde seu contato${a}. Ainda podemos ajudá-lo?\n\nEstamos à disposição! 👨‍⚖️\n\n_${esc||'Escritório de Advocacia'}_`;
}

module.exports = { enviarMensagem, buscarDiasFollowUp, credenciaisValidas, buscarCredenciais, formatarNumero, msgBoasVindas, msgTriagem, msgProposta, msgGanho, msgFollowUp };