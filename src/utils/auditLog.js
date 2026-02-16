const pool = require('../config/db');

/**
 * Registra uma ação no audit log
 * @param {Object} params
 * @param {number} params.usuario_id - ID do usuário que realizou a ação
 * @param {string} params.email - Email do usuário
 * @param {number} params.escritorio_id - ID do escritório
 * @param {string} params.acao - Tipo da ação (LOGIN, LOGOUT, PAGAMENTO, ALTERACAO_SENHA, etc.)
 * @param {string} params.descricao - Descrição legível da ação
 * @param {Object} params.metadata - Dados adicionais (JSON)
 * @param {string} params.ip - Endereço IP da requisição
 * @param {string} params.user_agent - User-Agent do navegador
 */
async function registrarAudit({ usuario_id, email, escritorio_id, acao, descricao, metadata, ip, user_agent }) {
    try {
        await pool.query(
            `INSERT INTO audit_log
             (usuario_id, email, escritorio_id, acao, descricao, metadata, ip, user_agent, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [
                usuario_id || null,
                email || null,
                escritorio_id || null,
                acao,
                descricao || null,
                metadata ? JSON.stringify(metadata) : null,
                ip || null,
                user_agent || null
            ]
        );
    } catch (err) {
        // Nunca deixar o audit log quebrar a operação principal
        console.error('⚠️ [AUDIT] Erro ao registrar:', err.message);
    }
}

/**
 * Extrai IP e User-Agent de um request Express
 */
function dadosReq(req) {
    return {
        ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress,
        user_agent: req.headers['user-agent'] || null
    };
}

module.exports = { registrarAudit, dadosReq };
