/**
 * Migration 007 — adiciona coluna telefone em escritorios
 */
exports.up = (pgm) => {
    pgm.sql(`ALTER TABLE escritorios ADD COLUMN IF NOT EXISTS telefone VARCHAR(20)`);
};

exports.down = (pgm) => {
    pgm.sql(`ALTER TABLE escritorios DROP COLUMN IF EXISTS telefone`);
};
