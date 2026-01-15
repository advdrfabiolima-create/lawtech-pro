const pool = require('../config/db');

/**
 * ============================
 * CRIAR PRAZO (COM LIMITE DE PLANO)
 * ============================
 */
async function criarPrazo(req, res) {
  try {
    const { processoId, tipo, descricao, dataLimite } = req.body;
    const usuarioId = req.user.id;
    const escritorioId = req.user.escritorio_id;

    if (!processoId || !tipo || !dataLimite) {
      return res.status(400).json({ erro: 'Dados obrigatórios ausentes' });
    }

    /**
     * 1️⃣ BUSCAR PLANO DO ESCRITÓRIO
     */
    const planoResult = await pool.query(
      `
      SELECT p.nome, p.limite_prazos
      FROM escritorios e
      JOIN planos p ON p.id = e.plano_id
      WHERE e.id = $1
      `,
      [escritorioId]
    );

    if (planoResult.rows.length === 0) {
      return res.status(400).json({ erro: 'Plano do escritório não encontrado' });
    }

    const plano = planoResult.rows[0];

    /**
     * 2️⃣ CONTAR PRAZOS DO ESCRITÓRIO
     * (via usuários → escritório)
     */
    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM prazos pr
      JOIN usuarios u ON u.id = pr.usuario_id
      WHERE u.escritorio_id = $1
      `,
      [escritorioId]
    );

    const totalPrazos = countResult.rows[0].total;

    /**
     * 3️⃣ BLOQUEIO POR LIMITE (SE EXISTIR)
     */
    if (plano.limite_prazos !== null && totalPrazos >= plano.limite_prazos) {
      return res.status(403).json({
  codigo: 'LIMITE_PLANO_ATINGIDO',
  erro: 'Limite de prazos do plano atingido',
  sugestao: 'Faça upgrade do plano para continuar'
});
    }

    /**
     * 4️⃣ INSERIR PRAZO
     * (⚠️ SEM escritorio_id)
     */
    const insertResult = await pool.query(
      `
      INSERT INTO prazos
        (processo_id, tipo, descricao, data_limite, status, usuario_id)
      VALUES
        ($1, $2, $3, $4, 'aberto', $5)
      RETURNING *
      `,
      [processoId, tipo, descricao, dataLimite, usuarioId]
    );

    res.status(201).json({
      mensagem: 'Prazo criado com sucesso',
      prazo: insertResult.rows[0]
    });

  } catch (error) {
    console.error('Erro ao criar prazo:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar prazo' });
  }
}

/**
 * ============================
 * LISTAGENS DE PRAZOS
 * (sempre por escritório via usuários)
 * ============================
 */
async function listarPrazosVencidos(req, res) {
  const escritorioId = req.user.escritorio_id;

  const result = await pool.query(
    `
    SELECT pr.*, proc.numero AS processo_numero
    FROM prazos pr
    JOIN usuarios u ON u.id = pr.usuario_id
    JOIN processos proc ON proc.id = pr.processo_id
    WHERE u.escritorio_id = $1
      AND pr.status = 'vencido'
    ORDER BY pr.data_limite ASC
    `,
    [escritorioId]
  );

  res.json(result.rows);
}

async function listarPrazosSemana(req, res) {
  const escritorioId = req.user.escritorio_id;

  const result = await pool.query(
    `
    SELECT pr.*, proc.numero AS processo_numero
    FROM prazos pr
    JOIN usuarios u ON u.id = pr.usuario_id
    JOIN processos proc ON proc.id = pr.processo_id
    WHERE u.escritorio_id = $1
      AND pr.status = 'aberto'
      AND pr.data_limite BETWEEN NOW() AND NOW() + INTERVAL '7 days'
    ORDER BY pr.data_limite ASC
    `,
    [escritorioId]
  );

  res.json(result.rows);
}

async function listarPrazosFuturos(req, res) {
  const escritorioId = req.user.escritorio_id;

  const result = await pool.query(
    `
    SELECT pr.*, proc.numero AS processo_numero
    FROM prazos pr
    JOIN usuarios u ON u.id = pr.usuario_id
    JOIN processos proc ON proc.id = pr.processo_id
    WHERE u.escritorio_id = $1
      AND pr.status = 'aberto'
      AND pr.data_limite > NOW() + INTERVAL '7 days'
    ORDER BY pr.data_limite ASC
    `,
    [escritorioId]
  );

  res.json(result.rows);
}

async function listarPrazosConcluidos(req, res) {
  try {
    const escritorioId = req.user.escritorio_id; // Pegamos o ID do escritório do usuário

    const result = await pool.query(`
      SELECT 
        p.*, 
        u.nome AS concluido_por_nome,
        pr.numero AS processo_numero 
      FROM prazos p
      JOIN usuarios u ON u.id = p.concluido_por
      JOIN processos pr ON pr.id = p.processo_id
      -- AQUI ESTÁ A PROTEÇÃO: Filtramos para ver apenas o que é do nosso escritório
      WHERE u.escritorio_id = $1 
        AND p.status = 'concluido'
      ORDER BY p.concluido_em DESC
    `, [escritorioId]);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao listar prazos concluídos' });
  }
}

/**
 * ============================
 * CONCLUIR PRAZO
 * ============================
 */
async function concluirPrazo(req, res) {
  const { id } = req.params;
  const usuarioId = req.user.id;
  const escritorioId = req.user.escritorio_id;

  try {
    // Adicionamos um JOIN para garantir que o usuário só conclua prazos do seu próprio escritório
    const result = await pool.query(
      `
      UPDATE prazos
      SET
        status = 'concluido',
        concluido_em = NOW(),
        concluido_por = $1
      WHERE id = $2 
        AND EXISTS (
          SELECT 1 FROM usuarios u 
          WHERE u.id = prazos.usuario_id 
          AND u.escritorio_id = $3
        )
      `,
      [usuarioId, id, escritorioId]
    );

    if (result.rowCount === 0) {
      return res.status(403).json({ erro: 'Prazo não encontrado ou sem permissão' });
    }

    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao concluir prazo' });
  }
}

/**
 * ============================
 * PLANO & CONSUMO
 * ============================
 */
async function planoEConsumo(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;

    const result = await pool.query(
      `
      SELECT
        p.nome AS plano,
        p.limite_prazos,
        COUNT(pr.id)::int AS prazos_usados
      FROM escritorios e
      JOIN planos p ON p.id = e.plano_id
      LEFT JOIN usuarios u ON u.escritorio_id = e.id
      LEFT JOIN prazos pr ON pr.usuario_id = u.id
      WHERE e.id = $1
      GROUP BY p.nome, p.limite_prazos
      `,
      [escritorioId]
    );

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Erro ao buscar plano e consumo:', error);
    res.status(500).json({ erro: 'Erro ao buscar plano e consumo' });
  }
}
async function excluirPrazo(req, res) {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM prazos WHERE id = $1 AND usuario_id = $2', [id, req.user.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao excluir prazo' });
  }
}

async function atualizarPrazo(req, res) {
  try {
    const { id } = req.params;
    const { tipo, dataLimite, descricao } = req.body;
    await pool.query(
      'UPDATE prazos SET tipo = $1, data_limite = $2, descricao = $3 WHERE id = $4 AND usuario_id = $5',
      [tipo, dataLimite, descricao, id, req.user.id]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao atualizar prazo' });
  }
}
module.exports = {
  criarPrazo,
  listarPrazosVencidos,
  listarPrazosSemana,
  listarPrazosFuturos,
  listarPrazosConcluidos,
  concluirPrazo,
  excluirPrazo,    
  atualizarPrazo,  
  planoEConsumo
};
