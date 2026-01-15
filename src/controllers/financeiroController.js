const pool = require('../config/db');

/**
 * ============================
 * PLANO FINANCEIRO ATUAL
 * ============================
 */
async function planoFinanceiroAtual(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;

    const result = await pool.query(
      `
      SELECT
        pf.nome,
        pf.valor,
        e.plano_financeiro_status
      FROM escritorios e
      LEFT JOIN planos_financeiros pf
        ON pf.id = e.plano_financeiro_id
      WHERE e.id = $1
      `,
      [escritorioId]
    );

    if (result.rows.length === 0 || !result.rows[0].nome) {
      return res.json({
        mensagem: 'Nenhum plano financeiro ativo'
      });
    }

    res.json({
      plano: result.rows[0].nome,
      valor: result.rows[0].valor,
      status: result.rows[0].plano_financeiro_status
    });

  } catch (error) {
    console.error('Erro ao buscar plano financeiro:', error);
    res.status(500).json({ erro: 'Erro ao buscar plano financeiro' });
  }
}

module.exports = {
  planoFinanceiroAtual
};

