const pool = require('../config/db');

/**
 * Registra ação de auditoria
 */
async function logAudit({
    escritorio_id,
    usuario_id,
    tipo_evento,
    entidade_tipo,
    entidade_id,
    descricao,
    dados_antes = null,
    dados_depois = null,
    req = null
}) {
    try {
        const ip = req?.ip || req?.connection?.remoteAddress || null;
        const userAgent = req?.headers['user-agent'] || null;

        await pool.query(
            `INSERT INTO audit_logs 
             (escritorio_id, usuario_id, tipo_evento, entidade_tipo, entidade_id, 
              descricao, dados_antes, dados_depois, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                escritorio_id,
                usuario_id,
                tipo_evento,
                entidade_tipo,
                entidade_id,
                descricao,
                dados_antes ? JSON.stringify(dados_antes) : null,
                dados_depois ? JSON.stringify(dados_depois) : null,
                ip,
                userAgent
            ]
        );

        console.log(`✅ [AUDIT] ${tipo_evento}: ${descricao}`);
    } catch (err) {
        console.error('❌ [AUDIT] Erro ao registrar:', err.message);
    }
}

/**
 * Registra erro do sistema
 */
async function logError({
    escritorio_id,
    usuario_id,
    servico,
    tipo_erro,
    mensagem_erro,
    stack_trace = null,
    req = null
}) {
    try {
        const ip = req?.ip || req?.connection?.remoteAddress || null;
        const userAgent = req?.headers['user-agent'] || null;

        await pool.query(
            `INSERT INTO logs_sistema 
             (escritorio_id, usuario_id, servico, tipo_erro, mensagem_erro, 
              stack_trace, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                escritorio_id,
                usuario_id,
                servico,
                tipo_erro,
                mensagem_erro,
                stack_trace,
                ip,
                userAgent
            ]
        );

        console.log(`⚠️ [ERROR LOG] ${servico}: ${mensagem_erro}`);
    } catch (err) {
        console.error('❌ [ERROR LOG] Falha:', err.message);
    }
}

/**
 * Registra login/logout
 */
async function logLogin({
    usuario_id,
    escritorio_id,
    tipo,
    sucesso,
    motivo_falha = null,
    req = null
}) {
    try {
        const ip = req?.ip || req?.connection?.remoteAddress || null;
        const userAgent = req?.headers['user-agent'] || null;

        await pool.query(
            `INSERT INTO login_history 
             (usuario_id, escritorio_id, tipo, sucesso, motivo_falha, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [usuario_id, escritorio_id, tipo, sucesso, motivo_falha, ip, userAgent]
        );

        console.log(`🔐 [LOGIN] ${tipo}: Usuário ${usuario_id}`);
    } catch (err) {
        console.error('❌ [LOGIN LOG] Erro:', err.message);
    }
}

module.exports = { logAudit, logError, logLogin };