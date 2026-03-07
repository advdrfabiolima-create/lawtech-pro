/**
 * Circuit Breaker simples para proteger chamadas a APIs externas.
 *
 * Estados:
 *   CLOSED    — operação normal, chamadas passam
 *   OPEN      — serviço falhou N vezes; rejeita chamadas sem tentar
 *   HALF_OPEN — após recoveryTimeout, permite 1 chamada de teste
 *
 * Uso:
 *   const { breakers } = require('../utils/circuitBreaker');
 *   const resultado = await breakers.brevo.call(() => axios.post(...));
 */

const logger = require('./logger');

const STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

class CircuitBreaker {
    constructor(name, { failureThreshold = 5, recoveryTimeoutMs = 30000 } = {}) {
        this.name = name;
        this.state = STATES.CLOSED;
        this.failures = 0;
        this.failureThreshold = failureThreshold;
        this.recoveryTimeoutMs = recoveryTimeoutMs;
        this.nextAttempt = null;
    }

    async call(fn) {
        if (this.state === STATES.OPEN) {
            if (Date.now() < this.nextAttempt) {
                const err = new Error(`[CircuitBreaker:${this.name}] Serviço temporariamente indisponível`);
                err.circuitOpen = true;
                throw err;
            }
            // Timeout expirou — tenta recuperação
            this.state = STATES.HALF_OPEN;
            logger.warn({ breaker: this.name }, '[CircuitBreaker] HALF_OPEN — testando recuperacao');
        }

        try {
            const result = await fn();
            this._onSuccess();
            return result;
        } catch (err) {
            this._onFailure(err);
            throw err;
        }
    }

    _onSuccess() {
        if (this.state === STATES.HALF_OPEN) {
            logger.info({ breaker: this.name }, '[CircuitBreaker] Recuperado — CLOSED');
        }
        this.failures = 0;
        this.state = STATES.CLOSED;
    }

    _onFailure(err) {
        // Não conta falha do próprio circuit breaker (circuito já aberto)
        if (err.circuitOpen) return;

        this.failures++;
        if (this.state === STATES.HALF_OPEN || this.failures >= this.failureThreshold) {
            this.state = STATES.OPEN;
            this.nextAttempt = Date.now() + this.recoveryTimeoutMs;
            logger.error(
                { breaker: this.name, failures: this.failures, nextAttempt: new Date(this.nextAttempt).toISOString(), err: err.message },
                '[CircuitBreaker] OPEN — falhas consecutivas atingiram o limite'
            );
        } else {
            logger.warn({ breaker: this.name, failures: this.failures, threshold: this.failureThreshold }, '[CircuitBreaker] Falha registrada');
        }
    }

    getStatus() {
        return {
            state: this.state,
            failures: this.failures,
            nextAttempt: this.state === STATES.OPEN ? new Date(this.nextAttempt).toISOString() : null
        };
    }
}

// Instâncias compartilhadas por serviço externo
const breakers = {
    clicksign: new CircuitBreaker('clicksign', { failureThreshold: 3, recoveryTimeoutMs: 60000 }),
    brevo:     new CircuitBreaker('brevo',     { failureThreshold: 5, recoveryTimeoutMs: 30000 }),
    asaas:     new CircuitBreaker('asaas',     { failureThreshold: 3, recoveryTimeoutMs: 60000 }),
};

module.exports = { CircuitBreaker, breakers };
