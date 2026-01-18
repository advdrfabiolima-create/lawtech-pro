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
     * 1️⃣ VERIFICAR STATUS DE PAGAMENTO
     */
    const statusResult = await pool.query('SELECT status_pagamento, data_vencimento FROM escritorios WHERE id = $1', [escritorioId]);
    if (statusResult.rows[0]?.status_pagamento === 'bloqueado') {
        return res.status(403).json({ erro: 'Acesso bloqueado por inadimplência. Regularize seu plano.' });
    }

    const planoResult = await pool.query(
      `SELECT p.nome, p.limite_prazos FROM escritorios e JOIN planos p ON p.id = e.plano_id WHERE e.id = $1`,
      [escritorioId]
    );

    if (planoResult.rows.length === 0) {
      return res.status(400).json({ erro: 'Plano do escritório não encontrado' });
    }

    const plano = planoResult.rows[0];

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM prazos pr JOIN usuarios u ON u.id = pr.usuario_id WHERE u.escritorio_id = $1`,
      [escritorioId]
    );

    const totalPrazos = countResult.rows[0].total;

    if (plano.limite_prazos !== null && totalPrazos >= plano.limite_prazos) {
      return res.status(403).json({
        codigo: 'LIMITE_PLANO_ATINGIDO',
        erro: 'Limite de prazos do plano atingido',
        sugestao: 'Faça upgrade do plano para continuar'
      });
    }

    const insertResult = await pool.query(
      `INSERT INTO prazos (processo_id, tipo, descricao, data_limite, status, usuario_id) VALUES ($1, $2, $3, $4, 'aberto', $5) RETURNING *`,
      [processoId, tipo, descricao, dataLimite, usuarioId]
    );

    res.status(201).json({ mensagem: 'Prazo criado com sucesso', prazo: insertResult.rows[0] });

  } catch (error) {
    console.error('Erro ao criar prazo:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar prazo' });
  }
}

/**
 * ============================
 * LISTAGENS DE PRAZOS
 * ============================
 */
async function listarPrazosVencidos(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;
    const result = await pool.query(
      `SELECT pr.*, proc.numero AS processo_numero
       FROM prazos pr
       JOIN usuarios u ON u.id = pr.usuario_id
       JOIN processos proc ON proc.id = pr.processo_id
       WHERE u.escritorio_id = $1 AND pr.status = 'aberto' AND pr.data_limite < NOW()
       ORDER BY pr.data_limite ASC`, 
      [escritorioId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao listar prazos vencidos' });
  }
}

async function listarPrazosSemana(req, res) {
  const escritorioId = req.user.escritorio_id;
  const result = await pool.query(
    `SELECT pr.*, proc.numero AS processo_numero FROM prazos pr JOIN usuarios u ON u.id = pr.usuario_id JOIN processos proc ON proc.id = pr.processo_id
    WHERE u.escritorio_id = $1 AND pr.status = 'aberto' AND pr.data_limite BETWEEN NOW() AND NOW() + INTERVAL '7 days'
    ORDER BY pr.data_limite ASC`,
    [escritorioId]
  );
  res.json(result.rows);
}

async function listarPrazosFuturos(req, res) {
  const escritorioId = req.user.escritorio_id;
  const result = await pool.query(
    `SELECT pr.*, proc.numero AS processo_numero FROM prazos pr JOIN usuarios u ON u.id = pr.usuario_id JOIN processos proc ON proc.id = pr.processo_id
    WHERE u.escritorio_id = $1 AND pr.status = 'aberto' AND pr.data_limite > NOW() + INTERVAL '7 days'
    ORDER BY pr.data_limite ASC`,
    [escritorioId]
  );
  res.json(result.rows);
}

async function listarPrazosConcluidos(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;
    const result = await pool.query(`
      SELECT p.*, u.nome AS concluido_por_nome, pr.numero AS processo_numero 
      FROM prazos p JOIN usuarios u ON u.id = p.concluido_por JOIN processos pr ON pr.id = p.processo_id
      WHERE u.escritorio_id = $1 AND p.status = 'concluido' ORDER BY p.concluido_em DESC`, 
      [escritorioId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao listar prazos concluídos' });
  }
}

async function concluirPrazo(req, res) {
  const { id } = req.params;
  const usuarioId = req.user.id;
  const escritorioId = req.user.escritorio_id;
  try {
    const result = await pool.query(
      `UPDATE prazos SET status = 'concluido', concluido_em = NOW(), concluido_por = $1
      WHERE id = $2 AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = prazos.usuario_id AND u.escritorio_id = $3)`,
      [usuarioId, id, escritorioId]
    );
    if (result.rowCount === 0) return res.status(403).json({ erro: 'Prazo não encontrado ou sem permissão' });
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao concluir prazo' });
  }
}

/**
 * ============================
 * PLANO, CONSUMO & FINANCEIRO (DUNNING)
 * ============================
 */
async function planoEConsumo(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;
    const result = await pool.query(`
      SELECT p.nome as plano, e.ciclo, e.limite_prazos, e.prazos_usados, e.data_vencimento, e.status_pagamento
      FROM escritorios e 
      JOIN planos p ON e.plano_id = p.id 
      WHERE e.id = $1`, 
      [escritorioId]
    );
    
    if (result.rows.length > 0) {
        let dados = result.rows[0];

        // 🚀 REGRA DE EXCEÇÃO PARA O CRIADOR (ID 1)
        // Se for o seu escritório, o plano se torna infinito e vitalício
        if (escritorioId === 1) {
            return res.json({
                ...dados,
                plano: "LawTech Master",
                ciclo: "Vitalício",
                limite_prazos: null,      // Para exibir o símbolo de infinito
                dias_restantes: null,     // Remove banners de alerta
                em_tolerancia: false,     // Remove alerta de tolerância
                dias_para_bloqueio: null, // Impede o redirecionamento de bloqueio
                status_pagamento: 'ativo'
            });
        }

        // --- LÓGICA NORMAL PARA OS DEMAIS CLIENTES ---
        const hoje = new Date();
        const vencimento = dados.data_vencimento ? new Date(dados.data_vencimento) : null;
        
        let diasRestantes = null;
        let emTolerancia = false;
        let bloqueado = dados.status_pagamento === 'bloqueado';

        if (vencimento) {
            const diffTime = vencimento - hoje;
            diasRestantes = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            // Se passou de 5 dias negativos, bloqueia no banco automaticamente
            if (diasRestantes < -5 && !bloqueado) {
                await pool.query("UPDATE escritorios SET status_pagamento = 'bloqueado' WHERE id = $1", [escritorioId]);
                bloqueado = true;
            } else if (diasRestantes < 0 && diasRestantes >= -5) {
                emTolerancia = true;
            }
        }

        res.json({
            ...dados,
            status_pagamento: bloqueado ? 'bloqueado' : dados.status_pagamento,
            dias_restantes: diasRestantes,
            em_tolerancia: emTolerancia,
            dias_para_bloqueio: vencimento ? diasRestantes + 5 : null
        });
    } else {
        res.status(404).json({ erro: 'Dados não encontrados' });
    }
  } catch (error) {
    console.error('ERRO NO ACESSO:', error.message);
    res.status(500).json({ erro: 'Erro interno' });
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