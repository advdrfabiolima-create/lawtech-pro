const pool = require('../config/db');

/**
 * ============================================================
 * 1. GESTÃO DE CRIAÇÃO (SISTEMA DE LIMITES DINÂMICOS)
 * ============================================================
 */
async function criarPrazo(req, res) {
  try {
    const { processoId, tipo, descricao, dataLimite } = req.body;
    const usuarioId = req.user.id;
    const escritorioId = req.user.escritorio_id;

    if (!processoId || !tipo || !dataLimite) {
      return res.status(400).json({ erro: 'Dados obrigatórios ausentes' });
    }

    // Validação de Bloqueio por Inadimplência
    const statusResult = await pool.query('SELECT status_pagamento FROM escritorios WHERE id = $1', [escritorioId]);
    if (statusResult.rows[0]?.status_pagamento === 'bloqueado') {
      return res.status(403).json({ erro: 'Acesso bloqueado por inadimplência. Regularize seu plano.' });
    }

    // Validação de Limites de Prazo baseada no Plano Real do Banco
    const planoResult = await pool.query(
      `SELECT p.limite_prazos FROM escritorios e JOIN planos p ON p.id = e.plano_id WHERE e.id = $1`,
      [escritorioId]
    );
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM prazos WHERE escritorio_id = $1`, [escritorioId]);
    
    const totalPrazos = countResult.rows[0].total;
    const plano = planoResult.rows[0];

    if (plano?.limite_prazos !== null && totalPrazos >= plano.limite_prazos) {
      return res.status(403).json({ codigo: 'LIMITE_PLANO_ATINGIDO', erro: 'Limite de prazos atingido' });
    }

    // Calcular status inicial com base na data
    const dataLimiteDate = new Date(dataLimite);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    let statusInicial = 'aberto';
    if (dataLimiteDate < hoje) {
      statusInicial = 'atrasado';
    } else if (dataLimiteDate.getTime() === hoje.getTime()) {
      statusInicial = 'hoje';  // útil para destacar no front
    }

    const insertResult = await pool.query(
      `INSERT INTO prazos (processo_id, tipo, descricao, data_limite, status, usuario_id, escritorio_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [processoId, tipo, descricao, dataLimite, statusInicial, usuarioId, escritorioId]
    );

    res.status(201).json({ mensagem: 'Prazo criado com sucesso', prazo: insertResult.rows[0] });
  } catch (error) {
    console.error('Erro ao criar prazo:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar prazo' });
  }
}

/**
 * Lista geral - usada na página de prazos (mostra abertos, hoje e atrasados)
 */
async function listarPrazosGeral(req, res) {
  try {
    const result = await pool.query(
      `SELECT pr.*, proc.numero AS processo_numero, proc.cliente AS cliente_nome
       FROM prazos pr
       LEFT JOIN processos proc ON proc.id = pr.processo_id
       WHERE pr.escritorio_id = $1 
         AND pr.status IN ('aberto', 'hoje', 'atrasado')
       ORDER BY pr.data_limite ASC`,
      [req.user.escritorio_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar prazos geral:', error);
    res.status(500).json({ erro: 'Erro ao listar geral' });
  }
}

/**
 * Lista para o dashboard - mostra vencidos + hoje + próximos (prioridade alta)
 */
async function listarPrazosDashboard(req, res) {
  try {
    const result = await pool.query(
      `SELECT pr.id, pr.tipo, pr.data_limite, pr.status, proc.numero AS processo_numero, proc.cliente AS cliente_nome
       FROM prazos pr
       LEFT JOIN processos proc ON proc.id = pr.processo_id
       WHERE pr.escritorio_id = $1 
         AND pr.status IN ('atrasado', 'hoje', 'aberto')
       ORDER BY 
         CASE pr.status 
           WHEN 'atrasado' THEN 1
           WHEN 'hoje' THEN 2
           ELSE 3
         END,
         pr.data_limite ASC
       LIMIT 15`,  // aumentei um pouco para mostrar mais urgentes
      [req.user.escritorio_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao listar dashboard:', err);
    res.status(500).json({ erro: err.message });
  }
}

/**
 * Lista apenas os atrasados (usado para seção específica de vencidos)
 */
async function listarPrazosVencidos(req, res) {
  try {
    const result = await pool.query(`
      SELECT pr.*, proc.numero AS processo_numero, proc.cliente AS cliente_nome
      FROM prazos pr
      LEFT JOIN processos proc ON proc.id = pr.processo_id
      WHERE pr.escritorio_id = $1
        AND pr.status = 'atrasado'
      ORDER BY pr.data_limite DESC
    `, [req.user.escritorio_id]);

    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao listar prazos vencidos:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar prazos vencidos' });
  }
}

async function listarPrazosSemana(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT p.*, pr.numero AS processo_numero, pr.cliente AS cliente_nome
      FROM prazos p
      LEFT JOIN processos pr ON pr.id = p.processo_id
      WHERE p.escritorio_id = $1
        AND p.status IN ('aberto', 'hoje')
        AND p.data_limite >= CURRENT_DATE
        AND p.data_limite <= CURRENT_DATE + INTERVAL '7 days'
      ORDER BY p.data_limite ASC
      `,
      [req.user.escritorio_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao listar prazos da semana:', err.message);
    res.status(500).json({ erro: err.message });
  }
}

async function listarPrazosFuturos(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT p.*, pr.numero AS processo_numero, pr.cliente AS cliente_nome
      FROM prazos p
      LEFT JOIN processos pr ON pr.id = p.processo_id
      WHERE p.escritorio_id = $1
        AND p.status = 'aberto'
        AND p.data_limite > CURRENT_DATE + INTERVAL '7 days'
      ORDER BY p.data_limite ASC
      `,
      [req.user.escritorio_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao listar prazos futuros:', err.message);
    res.status(500).json({ erro: err.message });
  }
}

async function listarPrazosConcluidos(req, res) {
  try {
    const result = await pool.query(
      `SELECT p.*, pr.numero AS processo_numero, pr.cliente AS cliente_nome 
       FROM prazos p 
       LEFT JOIN processos pr ON pr.id = p.processo_id
       WHERE p.escritorio_id = $1 AND p.status = 'concluido' 
       ORDER BY p.concluido_em DESC`, 
      [req.user.escritorio_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar concluídos:', error);
    res.status(500).json({ erro: 'Erro ao listar concluídos' });
  }
}

/**
 * Atualiza status de um prazo específico (usado após edição ou criação)
 */
async function atualizarStatusPrazo(id) {
  try {
    await pool.query(`
      UPDATE prazos 
      SET status = 'atrasado'
      WHERE id = $1 
        AND data_limite < CURRENT_DATE 
        AND status IN ('aberto', 'hoje')
    `, [id]);
  } catch (err) {
    console.error('Erro ao atualizar status do prazo', id, ':', err.message);
  }
}

/**
 * Concluir prazo
 */
async function concluirPrazo(req, res) {
  try {
    await pool.query(
      `UPDATE prazos SET status = 'concluido', concluido_em = NOW(), concluido_por = $1 
       WHERE id = $2 AND escritorio_id = $3`,
      [req.user.id, req.params.id, req.user.escritorio_id]
    );
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

/**
 * Limpar concluídos
 */
async function limparPrazosConcluidos(req, res) {
  try {
    const resultado = await pool.query(
      "DELETE FROM prazos WHERE status = 'concluido' AND escritorio_id = $1",
      [req.user.escritorio_id]
    );
    res.json({ sucesso: true, removidos: resultado.rowCount });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao limpar' });
  }
}

/**
 * Excluir prazo
 */
async function excluirPrazo(req, res) {
  try {
    await pool.query(
      'DELETE FROM prazos WHERE id = $1 AND escritorio_id = $2',
      [req.params.id, req.user.escritorio_id]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao excluir' });
  }
}

/**
 * Atualizar prazo + forçar revalidação do status
 */
async function atualizarPrazo(req, res) {
  try {
    const { tipo, dataLimite, descricao } = req.body;
    const prazoId = req.params.id;

    await pool.query(
      'UPDATE prazos SET tipo = $1, data_limite = $2, descricao = $3 WHERE id = $4 AND escritorio_id = $5',
      [tipo, dataLimite, descricao, prazoId, req.user.escritorio_id]
    );

    // Reavalia status após possível mudança de data
    await atualizarStatusPrazo(prazoId);

    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao atualizar prazo:', error);
    res.status(500).json({ erro: 'Erro ao atualizar' });
  }
}

/**
 * Informações do plano e consumo
 */
async function planoEConsumo(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;
    const result = await pool.query(
      `SELECT p.nome as plano, e.ciclo, p.limite_prazos, e.data_vencimento, e.status_pagamento
       FROM escritorios e 
       JOIN planos p ON e.plano_id = p.id 
       WHERE e.id = $1`, [escritorioId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Escritório não encontrado' });
    }

    let dados = result.rows[0];

    // Calcular prazos_usados dinamicamente (total pendentes)
    const countPrazos = await pool.query(
      `SELECT COUNT(*)::int AS total FROM prazos WHERE escritorio_id = $1 AND status IN ('aberto', 'hoje', 'atrasado')`,
      [escritorioId]
    );
    dados.prazos_usados = countPrazos.rows[0].total;

    const hoje = new Date();
    const vencimento = dados.data_vencimento ? new Date(dados.data_vencimento) : null;
    let diasRestantes = vencimento ? Math.ceil((vencimento - hoje) / (1000 * 60 * 60 * 24)) : null;

    res.json({ 
      ...dados, 
      dias_restantes: diasRestantes, 
      em_tolerancia: (diasRestantes !== null && diasRestantes < 0 && diasRestantes >= -5), 
      dias_para_bloqueio: vencimento ? diasRestantes + 5 : null 
    });
  } catch (error) {
    console.error('Erro em planoEConsumo:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = {
  criarPrazo,
  listarPrazosGeral,
  listarPrazosVencidos,
  listarPrazosSemana,
  listarPrazosFuturos,
  listarPrazosConcluidos,
  listarPrazosDashboard,
  concluirPrazo,
  atualizarPrazo,
  excluirPrazo,
  limparPrazosConcluidos,
  planoEConsumo,
  atualizarStatusPrazo   // exportado para uso interno se necessário
};