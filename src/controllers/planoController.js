const pool = require('../config/db');

/* =========================
   LISTAR PLANOS DISPONÍVEIS
========================= */
async function listarPlanos(req, res) {
  try {
    const result = await pool.query(
      'SELECT id, nome, preco, limite_prazos, descricao FROM planos ORDER BY preco'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarPlanos:', err.message);
    res.status(500).json({ erro: 'Erro ao listar planos' });
  }
}

/* =========================
   PLANO ATUAL (CORRIGIDO)
========================= */
async function meuPlano(req, res) {
  try {
    // 🚀 REMOVIDO p.preco que estava causando erro no log
    const result = await pool.query(`
      SELECT p.id, p.nome, p.limite_prazos
      FROM usuarios u
      JOIN escritorios e ON e.id = u.escritorio_id
      JOIN planos p ON p.id = e.plano_id
      WHERE u.id = $1
    `, [req.user.id]);

    res.json(result.rows[0] || {});
  } catch (err) {
    console.error('Erro meuPlano:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar plano atual' });
  }
}

/* =========================
   UPGRADE DE PLANO
========================= */
async function upgradePlano(req, res) {
  const { planoId } = req.body;

  try {
    await pool.query(`
      UPDATE escritorios
      SET plano_id = $1
      WHERE id = $2
    `, [planoId, req.user.escritorio_id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro upgradePlano:', err.message);
    res.status(500).json({ erro: 'Erro ao atualizar plano' });
  }
}

/* =========================
   PLANO + CONSUMO (CORRIGIDO)
========================= */
async function planoEConsumo(req, res) {
  try {
    // 🚀 REMOVIDO e.ciclo_pagamento e e.data_fim_assinatura que causavam erro
    const resultPlano = await pool.query(`
      SELECT 
        p.nome AS plano,
        p.limite_prazos
      FROM escritorios e
      JOIN planos p ON p.id = e.plano_id
      WHERE e.id = $1
    `, [req.user.escritorio_id]);

    const dadosBase = resultPlano.rows[0] || { plano: 'Básico', limite_prazos: 10 };

    const resultConsumo = await pool.query(`
      SELECT COUNT(*) as total 
      FROM prazos 
      WHERE escritorio_id = $1 AND status = 'aberto'
    `, [req.user.escritorio_id]);

    const prazosUsados = parseInt(resultConsumo.rows[0].total || 0);

    // Enviamos o JSON que o Dashboard espera, com valores padrão para o que não existe no banco
    res.json({
      plano: dadosBase.plano,
      limite_prazos: dadosBase.limite_prazos,
      prazos_usados: prazosUsados,
      ciclo: 'mensal', // Valor fixo para evitar erro 'undefined'
      data_fim_assinatura: null
    });

  } catch (err) {
    console.error('Erro planoEConsumo:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar plano e consumo' });
  }
}

/* =========================
   EXPORTAÇÃO CORRETA
========================= */
module.exports = {
  listarPlanos,
  meuPlano,
  upgradePlano,
  planoEConsumo
};
