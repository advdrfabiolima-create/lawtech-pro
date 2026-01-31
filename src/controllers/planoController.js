const pool = require('../config/db');

// ============================================================
// FUNÇÃO LISTAR PLANOS
// ============================================================
async function listarPlanos(req, res) {
  try {
    const result = await pool.query(
      'SELECT id, nome, limite_prazos, preco_mensal, preco_anual FROM planos'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Erro ao listar planos.");
  }
}

// ============================================================
// FUNÇÃO MEU PLANO (CORRIGIDA)
// ============================================================
async function meuPlano(req, res) {
  try {
    const result = await pool.query(`
      SELECT 
        p.id,
        p.nome, 
        p.limite_prazos,
        p.slug,
        e.ciclo
      FROM escritorios e
      JOIN planos p ON p.id = e.plano_id
      WHERE e.id = $1
    `, [req.user.escritorio_id]);

    if (result.rowCount > 0) {
      const dados = result.rows[0];
      console.log('📊 [MEU PLANO] Plano atual:', dados);
      res.json(dados);
    } else {
      res.status(404).json({ 
        error: "Plano não encontrado.",
        escritorio_id: req.user.escritorio_id
      });
    }
  } catch (err) {
    console.error('❌ [MEU PLANO] Erro:', err);
    res.status(500).json({ 
      error: "Erro ao buscar plano atual.",
      detalhes: err.message
    });
  }
}

// ============================================================
// FUNÇÃO UPGRADE DE PLANO (CORRIGIDA)
// ============================================================
async function upgradePlano(req, res) {
  try {
    const { planoId, ciclo } = req.body;
    const escritorioId = req.user.escritorio_id;

    console.log('📊 [UPGRADE] Dados recebidos:', {
      planoId,
      ciclo,
      escritorioId,
      body: req.body
    });

    // Validação básica
    if (!planoId) {
      return res.status(400).json({ 
        error: 'planoId é obrigatório',
        recebido: req.body
      });
    }

    // Verificar se o plano existe
    const planoCheck = await pool.query(
      'SELECT id, nome FROM planos WHERE id = $1',
      [planoId]
    );

    if (planoCheck.rows.length === 0) {
      console.log('❌ [UPGRADE] Plano não existe:', planoId);
      return res.status(404).json({ 
        error: 'Plano não encontrado',
        planoId: planoId
      });
    }

    const planoNome = planoCheck.rows[0].nome;
    console.log('✅ [UPGRADE] Plano encontrado:', planoNome);

    // Atualizar escritório (SEM data_atualizacao que não existe)
    const updateResult = await pool.query(`
      UPDATE escritorios 
      SET plano_id = $1, ciclo = $2
      WHERE id = $3
      RETURNING id, plano_id, ciclo
    `, [planoId, ciclo || 'mensal', escritorioId]);

    if (updateResult.rows.length === 0) {
      console.log('❌ [UPGRADE] Escritório não encontrado:', escritorioId);
      return res.status(404).json({ 
        error: 'Escritório não encontrado' 
      });
    }

    console.log('✅ [UPGRADE] Plano atualizado com sucesso:', {
      escritorio: escritorioId,
      plano: planoNome,
      ciclo: ciclo || 'mensal'
    });

    res.json({ 
      ok: true, 
      mensagem: `Plano atualizado para ${planoNome} com sucesso!`,
      plano: planoNome,
      ciclo: ciclo || 'mensal'
    });

  } catch (err) {
    console.error('❌ [UPGRADE] Erro ao atualizar plano:', err);
    console.error('Stack:', err.stack);
    res.status(500).json({ 
      error: 'Erro ao atualizar plano.',
      detalhes: err.message
    });
  }
}

// ============================================================
// FUNÇÃO CANCELAR AGENDAMENTO
// ============================================================
async function cancelarAgendamento(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;
    const userEmail = req.user.email;

    console.log(`📢 [CANCELAMENTO] Solicitação recebida de: ${userEmail}`);

    // Agora o comando vai funcionar porque a coluna foi criada no passo 1
    await pool.query(
      `UPDATE escritorios 
       SET renovacao_automatica = false, 
           data_cancelamento_agendado = data_vencimento 
       WHERE id = $1`, 
      [escritorioId]
    );

    res.json({ 
      ok: true, 
      msg: "Doutor, sua renovação automática foi cancelada com sucesso. O acesso permanecerá ativo até o fim do período atual." 
    });
  } catch (err) {
    console.error('❌ Erro ao processar cancelamento:', err);
    res.status(500).json({ error: 'Erro ao processar a solicitação no servidor.' });
  }
}

// ============================================================
// ✅ FUNÇÃO PLANO E CONSUMO (VERSÃO DEFINITIVA - 27/01/2026)
// Conta TODOS os prazos criados no mês (incluindo deletados)
// ============================================================
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

    // ✅ CRÍTICO: Conta TODOS os prazos criados no mês (incluindo deletados)
    // Isso evita que o usuário burle o limite via lixeira
    const resultConsumo = await pool.query(`
      SELECT COUNT(*) as total 
      FROM prazos 
      WHERE escritorio_id = $1 
        AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
    `, [req.user.escritorio_id]);
    // NÃO filtra por deletado!

    const prazosUsados = parseInt(resultConsumo.rows[0].total || 0);

    // ✅ Calcular dias restantes para vencimento
    let diasRestantes = null;
    let diasParaBloqueio = null;
    let emTolerancia = false;

    if (dadosBase.data_vencimento) {
      const hoje = new Date();
      const vencimento = new Date(dadosBase.data_vencimento);
      const diff = Math.ceil((vencimento - hoje) / (1000 * 60 * 60 * 24));
      
      diasRestantes = diff;
      
      if (diff < 0) {
        emTolerancia = true;
        diasParaBloqueio = 7 + diff;
      }
    }

    // Log detalhado para debug
    console.log(`[PLANO CONSUMO] Escritório: ${req.user.escritorio_id}`);
    console.log(`[PLANO CONSUMO] Prazos criados no mês (incluindo deletados): ${prazosUsados}/${dadosBase.limite_prazos}`);
    console.log(`[PLANO CONSUMO] Porcentagem: ${Math.round((prazosUsados / dadosBase.limite_prazos) * 100)}%`);

    res.json({
      plano: dadosBase.plano,
      limite_prazos: dadosBase.limite_prazos,
      prazos_usados: prazosUsados,
      limite: dadosBase.limite_prazos,
      ciclo: dadosBase.ciclo || 'mensal',
      data_vencimento: dadosBase.data_vencimento,
      dias_restantes: diasRestantes,
      dias_para_bloqueio: diasParaBloqueio,
      em_tolerancia: emTolerancia
    });

  } catch (err) {
    console.error('Erro planoEConsumo:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar plano e consumo' });
  }
}

// ============================================================
// EXPORTAR FUNÇÕES
// ============================================================
module.exports = { 
    listarPlanos, 
    meuPlano, 
    upgradePlano, 
    cancelarAgendamento,
    planoEConsumo 
};