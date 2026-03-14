/**
 * Migration 006 — Portal Público do Cliente
 *
 * Adiciona portal_slug em escritorios:
 *   - Identificador público único (ex: "limaesilva")
 *   - Usado na URL /acesso/:slug para o cliente solicitar acesso pelo CPF
 */

exports.up = (pgm) => {
    pgm.addColumns('escritorios', {
        portal_slug: { type: 'varchar(50)', unique: true }
    }, { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropColumns('escritorios', ['portal_slug']);
};
