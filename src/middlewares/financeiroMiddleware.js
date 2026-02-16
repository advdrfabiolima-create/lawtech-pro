const pool = require('../config/db');

async function verificarPagamento(req, res, next) {
    const escritorioId = req.user.escritorio_id;

    const { rows } = await pool.query(
        'SELECT plano_financeiro_status, trial_expira_em FROM escritorios WHERE id = $1',
        [escritorioId]
    );

    if (!rows.length) {
        return res.status(403).json({ erro: 'Escritório não encontrado' });
    }

    const status = rows[0].plano_financeiro_status;
    const statusPermitidos = ['ativo', 'pago'];

    // Trial é permitido apenas se ainda não expirou
    if (status === 'trial') {
        const agora = new Date();
        const expiracao = rows[0].trial_expira_em ? new Date(rows[0].trial_expira_em) : null;

        if (expiracao && expiracao >= agora) {
            return next();
        }

        return res.status(402).json({
            erro: 'Período de teste expirado. Assine um plano para continuar.'
        });
    }

    if (!statusPermitidos.includes(status)) {
        return res.status(402).json({
            erro: 'Pagamento pendente ou suspenso'
        });
    }

    next();
}

module.exports = verificarPagamento;
