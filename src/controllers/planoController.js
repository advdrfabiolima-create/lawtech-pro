const pool = require('../config/db');

// 🔹 Listar todos os planos
async function listarPlanos(req, res) {
  try {
    const result = await pool.query('SELECT id, nome, limite_prazos FROM planos WHERE ativo = true ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao listar planos' });
  }
}

// 🔹 Ver meu plano atual (Ajustado para o Dashboard)
async function meuPlano(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;
    const result = await pool.query(
      // 🚀 Adicionamos e.ciclo no SELECT
      'SELECT p.id, p.nome, e.ciclo FROM escritorios e JOIN planos p ON p.id = e.plano_id WHERE e.id = $1',
      [escritorioId]
    );
    res.json(result.rows[0] || { erro: 'Plano não encontrado' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao buscar plano' });
  }
}

// 🔹 Upgrade de plano (Ajustado para salvar Mensal/Anual)
async function upgradePlano(req, res) {
  try {
    const { planoId, ciclo } = req.body; // 🚀 Recebe o ciclo (mensal ou anual)
    const escritorioId = req.user.escritorio_id;

    if (!planoId) return res.status(400).json({ erro: 'ID do plano não informado' });

    // 🚀 Salva o plano e o ciclo (mensal/anual) no banco
    await pool.query(
      'UPDATE escritorios SET plano_id = $1, ciclo = $2 WHERE id = $3', 
      [planoId, ciclo || 'mensal', escritorioId]
    );

    res.json({ ok: true, mensagem: `Plano atualizado para ${ciclo}!` });
  } catch (error) {
    console.error('Erro no upgrade:', error.message);
    res.status(500).json({ erro: 'Erro ao atualizar plano' });
  }
}

module.exports = { listarPlanos, upgradePlano, meuPlano };