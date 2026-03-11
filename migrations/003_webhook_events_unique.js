/**
 * Migration 003 — Corrigir UNIQUE constraint em webhook_events
 *
 * [A-2] A coluna event_id tem UNIQUE individual, mas a proteção correta
 * é UNIQUE (event_id, source): permite o mesmo event_id em diferentes
 * gateways (asaas vs stripe) sem colisão, e viabiliza
 * ON CONFLICT (event_id, source) DO NOTHING para idempotência atômica ([A-1]).
 */

exports.up = async (pgm) => {
    // Remover constraint UNIQUE individual em event_id
    pgm.sql(`
        ALTER TABLE webhook_events
        DROP CONSTRAINT IF EXISTS webhook_events_event_id_key
    `);

    // Adicionar constraint UNIQUE composta (event_id, source)
    pgm.sql(`
        ALTER TABLE webhook_events
        ADD CONSTRAINT webhook_events_event_id_source_key
        UNIQUE (event_id, source)
    `);
};

exports.down = async (pgm) => {
    pgm.sql(`
        ALTER TABLE webhook_events
        DROP CONSTRAINT IF EXISTS webhook_events_event_id_source_key
    `);

    pgm.sql(`
        ALTER TABLE webhook_events
        ADD CONSTRAINT webhook_events_event_id_key
        UNIQUE (event_id)
    `);
};
