/**
 * Executa uma função com retry e exponential backoff
 * @param {Function} fn - Função async a executar
 * @param {Object} options
 * @param {number} options.maxRetries - Máximo de tentativas (default: 3)
 * @param {number} options.baseDelay - Delay base em ms (default: 1000)
 * @param {number} options.maxDelay - Delay máximo em ms (default: 10000)
 * @param {Function} options.shouldRetry - Função que recebe o erro e decide se deve tentar novamente
 * @returns {Promise} Resultado da função ou último erro
 */
async function withRetry(fn, options = {}) {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 10000,
        shouldRetry = (err) => {
            // Retry apenas em erros de rede/timeout, não em erros de negócio
            if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') return true;
            if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return true;
            if (err.response?.status >= 500) return true; // 5xx do gateway
            if (err.response?.status === 429) return true; // Rate limited
            return false;
        }
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;

            if (attempt >= maxRetries || !shouldRetry(err)) {
                throw err;
            }

            // Exponential backoff com jitter
            const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 500, maxDelay);
            console.log(`   🔄 Retry ${attempt + 1}/${maxRetries} em ${Math.round(delay)}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

module.exports = { withRetry };
