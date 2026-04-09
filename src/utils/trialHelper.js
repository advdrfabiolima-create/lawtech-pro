const pool = require('../config/db');

/**
 * Verifica se um escritório está em período de trial ativo.
 * Retorna { emTrial: bool, diasRestantes: number, expiracao: Date|null }
 */
async function verificarTrialAtivo(escritorioId) {
    const { rows } = await pool.query(
        'SELECT plano_financeiro_status, trial_expira_em FROM escritorios WHERE id = $1',
        [escritorioId]
    );

    if (!rows.length) return { emTrial: false, diasRestantes: 0, expiracao: null };

    const { plano_financeiro_status, trial_expira_em } = rows[0];

    if (plano_financeiro_status !== 'trial' || !trial_expira_em) {
        return { emTrial: false, diasRestantes: 0, expiracao: null };
    }

    const agora = new Date();
    const expiracao = new Date(trial_expira_em);
    const diasRestantes = Math.ceil((expiracao - agora) / (1000 * 60 * 60 * 24));
    const emTrial = diasRestantes > 0;

    return { emTrial, diasRestantes: Math.max(diasRestantes, 0), expiracao };
}

module.exports = { verificarTrialAtivo };
