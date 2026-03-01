const crypto = require('crypto');

const JITSI_BASE = 'https://meet.jit.si';

/**
 * Gera uma sala Jitsi única e privada (nome aleatório de 32 chars hex).
 * Não requer API key — Jitsi Meet é gratuito e open source.
 * @param {number} reuniaoId - ID da reunião (usado no prefixo para rastreabilidade)
 * @returns {{ name: string, url: string }}
 */
function criarSala(reuniaoId) {
    const rand = crypto.randomBytes(12).toString('hex'); // 24 chars hex
    const name = `lawtech-${reuniaoId}-${rand}`;
    const url = `${JITSI_BASE}/${name}`;
    return { name, url };
}

/**
 * No Jitsi Meet público, não há tokens — qualquer um com o link entra.
 * A privacidade vem do nome aleatório da sala.
 * Retorna null para manter compatibilidade com a interface existente.
 */
function criarToken() {
    return null;
}

/**
 * Salas Jitsi expiram automaticamente quando ficam vazias.
 * Não há API para deletar — esta função é no-op.
 */
function deletarSala() {
    // No-op: Jitsi não requer exclusão manual de salas
}

module.exports = { criarSala, criarToken, deletarSala };
