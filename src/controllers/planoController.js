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
   PLANO ATUAL
========================= */
async function meuPlano(req, res) {
  try {
    const result = await pool.query(`
      SELECT 
        p.id, 
        p.nome, 
        p.limite_prazos,
        e.ciclo 
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
  const { planoId, ciclo } = req.body; 
  const escritorioId = req.user.escritorio_id;
  const intervalo = (ciclo === 'anual') ? '1 year' : '1 month';

  try {
    await pool.query(`
      UPDATE escritorios
      SET plano_id = $1, 
          ciclo = $2, 
          data_vencimento = CURRENT_DATE + INTERVAL '${intervalo}'
      WHERE id = $3
    `, [planoId, ciclo || 'mensal', escritorioId]);

    res.json({ ok: true, mensagem: `Contratado com sucesso no modo ${ciclo}` });
  } catch (err) {
    console.error('Erro upgradePlano:', err.message);
    res.status(500).json({ erro: 'Erro ao atualizar plano' });
  }
}

/* =========================
   PLANO + CONSUMO
========================= */
async function planoEConsumo(req, res) {
  try {
    const resultPlano = await pool.query(`
      SELECT 
        p.nome AS plano,
        p.limite_prazos,
        e.ciclo,
        e.data_vencimento
      FROM escritorios e
      JOIN planos p ON p.id = e.plano_id
      WHERE e.id = $1
    `, [req.user.escritorio_id]);

    const dadosBase = resultPlano.rows[0];

    const resultConsumo = await pool.query(`
      SELECT COUNT(*) as total 
      FROM prazos 
      WHERE escritorio_id = $1 AND status = 'aberto'
    `, [req.user.escritorio_id]);

    const prazosUsados = parseInt(resultConsumo.rows[0].total || 0);

    res.json({
      plano: dadosBase.plano,
      limite_prazos: dadosBase.limite_prazos,
      prazos_usados: prazosUsados,
      ciclo: dadosBase.ciclo || 'mensal',
      data_vencimento: dadosBase.data_vencimento
    });

  } catch (err) {
    console.error('Erro planoEConsumo:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar plano e consumo' });
  }
}

/* =========================
   CANCELAR AGENDAMENTO (NOVO)
========================= */
async function cancelarAgendamento(req, res) {
    try {
        // Usamos req.user.id pois seu middleware de auth injeta em 'user'
        const usuarioId = req.user.id; 

        // 🚀 CORREÇÃO: Usando 'pool.query' em vez de 'db.query'
        const resultado = await pool.query(
            "UPDATE usuarios SET status_assinatura = 'cancelamento_pendente', renovacao_automatica = false WHERE id = $1",
            [usuarioId]
        );

        if (resultado.rowCount > 0) {
            return res.status(200).json({ ok: true, msg: "Cobrança futura cancelada com sucesso. Você ainda tem acesso até o fim do teste." });
        } else {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }
    } catch (error) {
        console.error("Erro ao cancelar agendamento:", error);
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
}

// 🚀 EXPORTAÇÃO UNIFICADA (Para evitar o erro de 'planoController is not defined')
module.exports = { 
    listarPlanos, 
    meuPlano, 
    upgradePlano, 
    planoEConsumo, 
    cancelarAgendamento 
};