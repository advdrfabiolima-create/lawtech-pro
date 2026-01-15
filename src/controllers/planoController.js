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

// 🔹 Ver meu plano atual
async function meuPlano(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;
    const result = await pool.query(
      'SELECT p.id, p.nome FROM escritorios e JOIN planos p ON p.id = e.plano_id WHERE e.id = $1',
      [escritorioId]
    );
    res.json(result.rows[0] || { erro: 'Plano não encontrado' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao buscar plano' });
  }
}

// 🔹 Upgrade de plano
async function upgradePlano(req, res) {
  try {
    const { planoId } = req.body;
    const escritorioId = req.user.escritorio_id;

    if (!planoId) return res.status(400).json({ erro: 'ID do plano não informado' });

    await pool.query('UPDATE escritorios SET plano_id = $1 WHERE id = $2', [planoId, escritorioId]);

    res.json({ ok: true, mensagem: 'Plano atualizado!' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao atualizar plano' });
  }
}

module.exports = { listarPlanos, upgradePlano, meuPlano };