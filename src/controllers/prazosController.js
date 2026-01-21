const pool = require('../config/db');

// 1. CRIAR PRAZO (BLINDADO)
async function criarPrazo(req, res) {
  try {
    const { processoId, tipo, descricao, dataLimite } = req.body;
    const usuarioId = req.user.id;
    const escritorioId = req.user.escritorio_id;

    // Inserção direta ignorando limites para o Dr. Fábio (Acesso Master)
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

// 2. LISTAGEM COMPLETA (ATUALIZADA COM NOME DO CLIENTE PARA A PÁGINA DE PRAZOS)
async function listarPrazosSemana(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;
    // Buscando dados do processo e nome do cliente via JOIN
    const result = await pool.query(
      `SELECT pr.*, proc.numero AS processo_numero, proc.cliente AS cliente_nome
       FROM prazos pr
       JOIN processos proc ON proc.id = pr.processo_id
       WHERE pr.escritorio_id = $1 AND pr.status = 'aberto'
       ORDER BY pr.data_limite ASC`, 
      [escritorioId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('ERRO AO LISTAR:', error.message);
    res.status(500).json({ erro: 'Erro ao listar prazos' });
  }
}

// 3. MANTÉM AS OUTRAS ROTAS PARA NÃO DAR ERRO NO FRONTEND
async function listarPrazosVencidos(req, res) { await listarPrazosSemana(req, res); }
async function listarPrazosFuturos(req, res) { await listarPrazosSemana(req, res); }

// 4. LISTAGEM DE CONCLUÍDOS (ATUALIZADA COM NOME DO CLIENTE)
async function listarPrazosConcluidos(req, res) {
  try {
    const result = await pool.query(
      `SELECT p.*, pr.numero AS processo_numero, pr.cliente AS cliente_nome 
       FROM prazos p 
       JOIN processos pr ON pr.id = p.processo_id
       WHERE p.escritorio_id = $1 AND p.status = 'concluido' 
       ORDER BY p.concluido_em DESC`, 
      [req.user.escritorio_id]
    );
    res.json(result.rows);
  } catch (err) { 
    console.error('ERRO CONCLUÍDOS:', err.message);
    res.status(500).json({ erro: err.message }); 
  }
}

// 5. CONCLUIR PRAZO
async function concluirPrazo(req, res) {
  try {
    await pool.query(
      `UPDATE prazos SET status = 'concluido', concluido_em = NOW(), concluido_por = $1 WHERE id = $2 AND escritorio_id = $3`,
      [req.user.id, req.params.id, req.user.escritorio_id]
    );
    res.json({ sucesso: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
}

// 6. LIMPAR PRAZOS CONCLUÍDOS
async function limparPrazosConcluidos(req, res) {
  try {
    const resultado = await pool.query(
      `DELETE FROM prazos WHERE status = 'concluido' AND escritorio_id = $1`,
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

// 7. EXCLUIR PRAZO
async function excluirPrazo(req, res) {
  try {
    await pool.query('DELETE FROM prazos WHERE id = $1 AND escritorio_id = $2', [req.params.id, req.user.escritorio_id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
}

// 8. ATUALIZAR PRAZO
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

// 9. FUNÇÃO OTIMIZADA PARA O DASHBOARD (COM NOME DO CLIENTE)
async function listarPrazosDashboard(req, res) {
  try {
    const result = await pool.query(
      `SELECT pr.*, proc.numero AS processo_numero, proc.cliente AS cliente_nome
       FROM prazos pr
       JOIN processos proc ON proc.id = pr.processo_id
       WHERE pr.escritorio_id = $1 
         AND pr.status = 'aberto'
         -- 🚀 A LINHA "AND pr.data_limite >= CURRENT_DATE" FOI REMOVIDA DAQUI
       ORDER BY pr.data_limite ASC
       LIMIT 5`, 
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