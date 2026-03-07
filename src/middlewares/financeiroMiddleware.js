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

    // Trial: permitido dentro do grace period de 3 dias após expiração (igual ao authMiddleware)
    if (status === 'trial') {
        const agora = new Date();
        const expiracao = rows[0].trial_expira_em ? new Date(rows[0].trial_expira_em) : null;

        if (!expiracao) return next(); // sem data definida = sem bloqueio

        const diasRestantes = Math.ceil((expiracao - agora) / (1000 * 60 * 60 * 24));

        if (diasRestantes >= -3) return next(); // dentro do grace period (3 dias: -1, -2, -3)

        return res.status(402).json({
            ok: false,
            erro: 'Período de teste expirado. Assine um plano para continuar.',
            upgrade_required: true
        });
    }

    if (!statusPermitidos.includes(status)) {
        return res.status(402).json({
            ok: false,
            erro: status === 'suspenso'
                ? 'Conta suspensa por inadimplência. Regularize seu pagamento em Configurações → Pagamento.'
                : 'Pagamento pendente. Regularize sua assinatura para continuar.',
            upgrade_required: true,
            status
        });
    }

    next();
}

module.exports = verificarPagamento;
