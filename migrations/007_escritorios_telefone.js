/**
 * Migration 007 — adiciona coluna telefone em escritorios
 */
exports.up = (pgm) => {
    pgm.addColumn('escritorios', {
        telefone: { type: 'varchar(20)', notNull: false, default: null }
    });
};

exports.down = (pgm) => {
    pgm.dropColumn('escritorios', 'telefone');
};
