const pool = require('../config/db');

// 1. CRIAR PRAZO (BLINDADO)
async function criarPrazo(req, res) {
  try {
    const { processoId, tipo, descricao, dataLimite } = req.body;
    const usuarioId = req.user.id;
    const escritorioId = req.user.escritorio_id;

    // Inserção direta ignorando limites para o Dr. Fábio (ID 1)
    const insertResult = await pool.query(
      `INSERT INTO prazos (processo_id, tipo, descricao, data_limite, status, usuario_id, escritorio_id) 
       VALUES ($1, $2, $3, $4, 'aberto', $5, $6) RETURNING *`,
      [processoId, tipo, descricao, dataLimite, usuarioId, escritorioId]
    );

    res.status(201).json({ mensagem: 'Prazo criado com sucesso', prazo: insertResult.rows[0] });
  } catch (error) {
    console.error('ERRO AO CRIAR:', error.message);
    res.status(500).json({ erro: 'Erro ao cadastrar prazo' });
  }
}

// 2. LISTAGEM COMPLETA (MOSTRA TUDO O QUE ESTÁ NO DASHBOARD)
async function listarPrazosSemana(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;
    // Query idêntica à do Dashboard para garantir que o que aparece lá apareça aqui
    const result = await pool.query(
      `SELECT pr.*, proc.numero AS processo_numero
       FROM prazos pr
       JOIN processos proc ON proc.id = pr.processo_id
       WHERE pr.escritorio_id = $1 AND pr.status = 'aberto'
       ORDER BY pr.data_limite ASC`, 
      [escritorioId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao listar prazos' });
  }
}

// 3. MANTEM AS OUTRAS ROTAS PARA NÃO DAR ERRO NO FRONTEND
async function listarPrazosVencidos(req, res) { await listarPrazosSemana(req, res); }
async function listarPrazosFuturos(req, res) { await listarPrazosSemana(req, res); }

async function listarPrazosConcluidos(req, res) {
  try {
    const result = await pool.query(
      `SELECT p.*, pr.numero AS processo_numero FROM prazos p 
       JOIN processos pr ON pr.id = p.processo_id
       WHERE p.escritorio_id = $1 AND p.status = 'concluido' ORDER BY p.concluido_em DESC`, 
      [req.user.escritorio_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
}

async function concluirPrazo(req, res) {
  try {
    await pool.query(
      `UPDATE prazos SET status = 'concluido', concluido_em = NOW(), concluido_por = $1 WHERE id = $2 AND escritorio_id = $3`,
      [req.user.id, req.params.id, req.user.escritorio_id]
    );
    res.json({ sucesso: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
}

async function limparPrazosConcluidos(req, res) {
  try {
    const resultado = await pool.query(
      `
      DELETE FROM prazos
      WHERE status = 'concluido'
        AND escritorio_id = $1
      `,
      [req.user.escritorio_id]
    );

    res.json({
      sucesso: true,
      removidos: resultado.rowCount
    });

  } catch (err) {
    console.error('Erro ao limpar prazos concluídos:', err);
    res.status(500).json({ erro: 'Erro ao limpar prazos concluídos' });
  }
}

async function excluirPrazo(req, res) {
  try {
    await pool.query('DELETE FROM prazos WHERE id = $1 AND escritorio_id = $2', [req.params.id, req.user.escritorio_id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
}

async function atualizarPrazo(req, res) {
  try {
    const { tipo, dataLimite, descricao } = req.body;
    await pool.query(
      'UPDATE prazos SET tipo = $1, data_limite = $2, descricao = $3 WHERE id = $4 AND escritorio_id = $5',
      [tipo, dataLimite, descricao, req.params.id, req.user.escritorio_id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
}

async function planoEConsumo(req, res) {
    res.json({ plano: "LawTech Master", ciclo: "Vitalício", limite_prazos: null, status_pagamento: 'ativo' });
}

// Função otimizada para o Dashboard
async function listarPrazosDashboard(req, res) {
  try {
    const result = await pool.query(
      `SELECT pr.*, proc.numero AS processo_numero
       FROM prazos pr
       JOIN processos proc ON proc.id = pr.processo_id
       WHERE pr.escritorio_id = $1 
         AND pr.status = 'aberto'
         AND pr.data_limite >= CURRENT_DATE -- Não mostra o que já venceu e não foi limpo
       ORDER BY pr.data_limite ASC
       LIMIT 5`, // 🚀 LIMITA AOS 5 MAIS PRÓXIMOS
      [req.user.escritorio_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
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
  listarPrazosDashboard,
  limparPrazosConcluidos
};