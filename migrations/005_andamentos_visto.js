/**
 * Migration 005 — Coluna visto em andamentos_processuais
 * Permite marcar andamentos novos do DataJud como não lidos (visto = false)
 * Registros existentes e manuais recebem visto = true por padrão
 */
exports.up = async (pgm) => {
    pgm.sql(`
        ALTER TABLE andamentos_processuais
        ADD COLUMN IF NOT EXISTS visto BOOLEAN NOT NULL DEFAULT true
    `);
};

exports.down = async (pgm) => {
    pgm.sql(`
        ALTER TABLE andamentos_processuais
        DROP COLUMN IF EXISTS visto
    `);
};
