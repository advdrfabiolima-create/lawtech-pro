const pool = require('../config/db');
const { decrypt } = require('./crypto');

/**
 * Tenta cobrar no gateway alternativo quando o primário falha por erro de rede/timeout.
 * Retorna null se não há gateway alternativo disponível.
 */
async function tentarGatewayAlternativo({ escritorioId, gateway, erro }) {
    // Só faz failover em erros de conexão/timeout, não em recusa de cartão
    const errosRecuperaveis = [
        'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
        'EAI_AGAIN', 'ESOCKETTIMEDOUT', 'ERR_SOCKET_TIMEOUT'
    ];

    const isErroRede = errosRecuperaveis.some(code =>
        erro.includes(code) || erro.includes('timeout') || erro.includes('network')
    );

    if (!isErroRede) {
        return null; // Não é erro de rede, não tenta failover
    }

    // Determinar gateway alternativo
    const gatewayAlternativo = gateway === 'stripe' ? 'asaas' : 'stripe';

    // Verificar se o escritório tem credenciais para o gateway alternativo
    try {
        const result = await pool.query(
            `SELECT token, gateway FROM cartoes
             WHERE escritorio_id = $1 AND gateway = $2`,
            [escritorioId, gatewayAlternativo]
        );

        if (result.rows.length === 0) {
            console.log(`   ℹ️ [FAILOVER] Sem cartão no gateway alternativo (${gatewayAlternativo})`);
            return null;
        }

        console.log(`   🔄 [FAILOVER] Tentando via ${gatewayAlternativo.toUpperCase()} (fallback)...`);

        return {
            gateway: gatewayAlternativo,
            cartaoToken: decrypt(result.rows[0].token)
        };

    } catch (err) {
        console.error(`   ❌ [FAILOVER] Erro ao buscar gateway alternativo:`, err.message);
        return null;
    }
}

module.exports = { tentarGatewayAlternativo };
