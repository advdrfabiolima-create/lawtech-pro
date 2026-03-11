/**
 * Migration 004 — Melhorias de rastreabilidade e limpeza de bootstrap
 *
 * [M-3] Adicionar plano_id e valor_centavos a transacoes:
 *   - plano_id INTEGER FK → planos: saber qual plano foi cobrado
 *   - valor_centavos INTEGER GENERATED ALWAYS AS (ROUND(valor)::INTEGER) STORED:
 *     coluna inteira explícita — sem ambiguidade, útil para relatórios
 *
 * [M-5] Mover DDL inline de iniciarSistema() para migration oficial:
 *   - escritorios.stripe_customer_id VARCHAR(100): habilita auditoriaStripeCron
 *   - CREATE TABLE whatsapp_conversas: remove CREATE TABLE de server.js
 */

exports.up = async (pgm) => {
    // ── [M-3] transacoes.plano_id ──────────────────────────────────────────────
    pgm.sql(`
        ALTER TABLE transacoes
        ADD COLUMN IF NOT EXISTS plano_id INTEGER REFERENCES planos(id) ON DELETE SET NULL
    `);

    // ── [M-3] transacoes.valor_centavos (GENERATED) ───────────────────────────
    // Coluna inteira derivada de valor — nunca precisará de INSERT manual
    pgm.sql(`
        ALTER TABLE transacoes
        ADD COLUMN IF NOT EXISTS valor_centavos INTEGER
        GENERATED ALWAYS AS (ROUND(valor)::INTEGER) STORED
    `);

    pgm.sql(`COMMENT ON COLUMN transacoes.plano_id IS 'Plano cobrado na transação (null para estornos/refunds sem plano direto)'`);
    pgm.sql(`COMMENT ON COLUMN transacoes.valor_centavos IS 'Alias inteiro de valor (centavos). GENERATED — não inserir diretamente.'`);

    // ── [M-5] escritorios.stripe_customer_id ──────────────────────────────────
    pgm.sql(`
        ALTER TABLE escritorios
        ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(100)
    `);

    pgm.sql(`COMMENT ON COLUMN escritorios.stripe_customer_id IS 'ID do customer no Stripe (cus_xxx). Necessário para auditoriaStripeCron.'`);

    // ── [M-5] whatsapp_conversas ───────────────────────────────────────────────
    pgm.createTable('whatsapp_conversas', {
        id:           { type: 'serial', primaryKey: true },
        escritorio_id: { type: 'integer', notNull: true },
        telefone:     { type: 'varchar(30)', notNull: true },
        lead_id:      { type: 'integer', references: 'leads(id)', onDelete: 'SET NULL' },
        mensagens:    { type: 'jsonb', default: "'[]'::jsonb" },
        status:       { type: 'varchar(20)', default: "'bot'" },
        nome_contato: { type: 'varchar(200)' },
        criado_em:    { type: 'timestamptz', default: pgm.func('NOW()') },
        atualizado_em:{ type: 'timestamptz', default: pgm.func('NOW()') }
    }, { ifNotExists: true });

    pgm.addConstraint('whatsapp_conversas', 'whatsapp_conversas_escritorio_telefone_key',
        'UNIQUE (escritorio_id, telefone)'
    );
};

exports.down = async (pgm) => {
    pgm.sql(`ALTER TABLE transacoes DROP COLUMN IF EXISTS plano_id`);
    pgm.sql(`ALTER TABLE transacoes DROP COLUMN IF EXISTS valor_centavos`);
    pgm.sql(`ALTER TABLE escritorios DROP COLUMN IF EXISTS stripe_customer_id`);
    pgm.dropTable('whatsapp_conversas', { ifExists: true });
};
