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
      `SELECT p.limite_prazos FROM escritorios e JOIN planos p ON p.id = e.plano_id WHERE e.id = $1`, [escritorioId]
    );
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM prazos WHERE escritorio_id = $1`, [escritorioId]);
    
    const totalPrazos = countResult.rows[0].total;
    const plano = planoResult.rows[0];

    // Removida a trava fixa do ID 1 para permitir que você teste os limites como um usuário comum
    if (plano?.limite_prazos !== null && totalPrazos >= plano.limite_prazos) {
      return res.status(403).json({ codigo: 'LIMITE_PLANO_ATINGIDO', erro: 'Limite de prazos atingido' });
    }

    const insertResult = await pool.query(
      `INSERT INTO prazos (processo_id, tipo, descricao, data_limite, status, usuario_id, escritorio_id) 
       VALUES ($1, $2, $3, $4, 'aberto', $5, $6) RETURNING *`,
      [processoId, tipo, descricao, dataLimite, usuarioId, escritorioId]
    );

    res.status(201).json({ mensagem: 'Prazo criado com sucesso', prazo: insertResult.rows[0] });
  } catch (error) {
    console.error('Erro ao criar prazo:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar prazo' });
  }
}

/**
 * ============================================================
 * 2. LISTAGENS SINCRONIZADAS (BACKEND -> HTML)
 * ============================================================
 */

async function listarPrazosGeral(req, res) {
  try {
    const result = await pool.query(
      `SELECT pr.*, proc.numero AS processo_numero, proc.cliente AS cliente_nome
       FROM prazos pr
       LEFT JOIN processos proc ON proc.id = pr.processo_id
       WHERE pr.escritorio_id = $1 AND pr.status = 'aberto'
       ORDER BY pr.data_limite ASC`, [req.user.escritorio_id]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ erro: 'Erro ao listar geral' }); }
}

async function listarPrazosDashboard(req, res) {
  try {
    const result = await pool.query(
      `SELECT pr.id, pr.tipo, pr.data_limite, pr.status, proc.numero AS processo_numero, proc.cliente AS cliente_nome
       FROM prazos pr
       LEFT JOIN processos proc ON proc.id = pr.processo_id
       WHERE pr.escritorio_id = $1 AND pr.status = 'aberto'
       ORDER BY pr.data_limite ASC LIMIT 10`, [req.user.escritorio_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
}

async function listarPrazosVencidos(req, res) {
  try {
    const result = await pool.query(
      `SELECT pr.id FROM prazos pr WHERE pr.escritorio_id = $1 AND pr.status = 'aberto' AND pr.data_limite < CURRENT_DATE`, 
      [req.user.escritorio_id]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ erro: 'Erro ao contar vencidos' }); }
}

async function listarPrazosDaSemanaFiltro(req, res) {
  try {
    const result = await pool.query(
      `SELECT pr.id FROM prazos pr 
       WHERE pr.escritorio_id = $1 AND pr.status = 'aberto' 
       AND pr.data_limite >= CURRENT_DATE AND pr.data_limite <= CURRENT_DATE + INTERVAL '7 days'`, 
      [req.user.escritorio_id]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ erro: 'Erro ao contar semana' }); }
}

async function listarPrazosConcluidos(req, res) {
  try {
    const result = await pool.query(
      `SELECT p.*, pr.numero AS processo_numero, pr.cliente AS cliente_nome 
       FROM prazos p 
       LEFT JOIN processos pr ON pr.id = p.processo_id
       WHERE p.escritorio_id = $1 AND p.status = 'concluido' ORDER BY p.concluido_em DESC`, 
      [req.user.escritorio_id]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ erro: 'Erro ao listar concluídos' }); }
}

/**
 * ============================================================
 * 3. AÇÕES DO SISTEMA
 * ============================================================
 */
async function concluirPrazo(req, res) {
  try {
    await pool.query(
      `UPDATE prazos SET status = 'concluido', concluido_em = NOW(), concluido_por = $1 
       WHERE id = $2 AND escritorio_id = $3`, [req.user.id, req.params.id, req.user.escritorio_id]
    );
    res.json({ sucesso: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
}

async function limparPrazosConcluidos(req, res) {
  try {
    const resultado = await pool.query("DELETE FROM prazos WHERE status = 'concluido' AND escritorio_id = $1", [req.user.escritorio_id]);
    res.json({ sucesso: true, removidos: resultado.rowCount });
  } catch (err) { res.status(500).json({ erro: 'Erro ao limpar' }); }
}

async function excluirPrazo(req, res) {
  try {
    await pool.query('DELETE FROM prazos WHERE id = $1 AND escritorio_id = $2', [req.params.id, req.user.escritorio_id]);
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ erro: 'Erro ao excluir' }); }
}

async function atualizarPrazo(req, res) {
  try {
    const { tipo, dataLimite, descricao } = req.body;
    await pool.query(
      'UPDATE prazos SET tipo = $1, data_limite = $2, descricao = $3 WHERE id = $4 AND escritorio_id = $5',
      [tipo, dataLimite, descricao, req.params.id, req.user.escritorio_id]
    );
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ erro: 'Erro ao atualizar' }); }
}

/**
 * ============================================================
 * 4. GESTÃO DE PLANO (MODO DE TESTE ATIVADO)
 * ============================================================
 */
async function planoEConsumo(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;
    const result = await pool.query(
      `SELECT p.nome as plano, e.ciclo, p.limite_prazos, e.prazos_usados, e.data_vencimento, e.status_pagamento
       FROM escritorios e 
       JOIN planos p ON e.plano_id = p.id 
       WHERE e.id = $1`, [escritorioId]
    );
    
    if (result.rows.length > 0) {
        let dados = result.rows[0];

        // 🚀 REMOVIDA A REGRA FIXA DO ID 1
        // Agora o Dashboard lerá o que estiver escrito na tabela 'planos' associada ao seu escritório.
        
        const hoje = new Date();
        const vencimento = dados.data_vencimento ? new Date(dados.data_vencimento) : null;
        let diasRestantes = vencimento ? Math.ceil((vencimento - hoje) / (1000 * 60 * 60 * 24)) : null;

        res.json({ 
            ...dados, 
            dias_restantes: diasRestantes, 
            em_tolerancia: (diasRestantes !== null && diasRestantes < 0 && diasRestantes >= -5), 
            dias_para_bloqueio: vencimento ? diasRestantes + 5 : null 
        });
    } else { res.status(404).json({ erro: 'Não encontrado' }); }
  } catch (error) { res.status(500).json({ erro: 'Erro interno' }); }
}

module.exports = {
  criarPrazo,
  concluirPrazo,
  excluirPrazo,
  atualizarPrazo,
  planoEConsumo,
  limparPrazosConcluidos,
  listarPrazosDashboard,
  listarPrazosConcluidos,
  listarPrazosVencidos,
  listarPrazosGeral,
  listarPrazosSemana: listarPrazosDaSemanaFiltro,
  listarPrazosFuturos: listarPrazosGeral
};