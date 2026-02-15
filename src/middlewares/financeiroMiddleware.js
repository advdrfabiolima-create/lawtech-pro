const pool = require('../config/db');

async function verificarPagamento(req, res, next) {
    const escritorioId = req.user.escritorio_id;

    const { rows } = await pool.query(
        'SELECT plano_financeiro_status FROM escritorios WHERE id = $1',
        [escritorioId]
    );

    if (!rows.length) {
        return res.status(403).json({ erro: 'Escritório não encontrado' });
    }

    if (rows[0].plano_financeiro_status !== 'ativo') {
        return res.status(402).json({
            erro: 'Pagamento pendente ou suspenso'
        });
    }

    next();
}

module.exports = verificarPagamento;
