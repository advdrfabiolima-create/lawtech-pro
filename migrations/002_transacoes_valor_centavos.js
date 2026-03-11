/**
 * Migration 002 — Normalizar transacoes.valor para centavos
 *
 * [C-1] A coluna `transacoes.valor` usa centavos como unidade canônica:
 *   - Stripe: amount já chega em centavos (ex: 9990 = R$ 99,90)
 *   - PIX:    inserido em centavos nos crons e pagamento.routes.js
 *   - Boleto: até a corr. no pagamentosController.js, era inserido em reais
 *
 * Este script normaliza os registros históricos de boleto (status = 'boleto_pendente')
 * que foram gravados em reais, multiplicando por 100.
 *
 * Heurística segura: valor < 1000 em boleto_pendente é claramente reais
 * (nenhum plano LawTech Pro custa R$ 10.000+).
 */

exports.up = async (pgm) => {
    // Normalizar boletos históricos gravados em reais → centavos
    pgm.sql(`
        UPDATE transacoes
        SET valor = ROUND(valor * 100)
        WHERE status = 'boleto_pendente'
          AND valor < 1000
          AND valor > 0
    `);

    // Adicionar comentário na coluna para documentar o padrão
    pgm.sql(`
        COMMENT ON COLUMN transacoes.valor IS
        'Valor em centavos (unidade canônica). Stripe: amount direto. PIX/Cartão: Math.round(reais*100). Nunca inserir em reais.'
    `);
};

exports.down = async (pgm) => {
    // Reversão: boletos de volta para reais (apenas os que parecem centavos de planos típicos)
    pgm.sql(`
        UPDATE transacoes
        SET valor = ROUND(valor / 100, 2)
        WHERE status = 'boleto_pendente'
          AND valor >= 100
          AND valor <= 100000
    `);

    pgm.sql(`COMMENT ON COLUMN transacoes.valor IS NULL`);
};
