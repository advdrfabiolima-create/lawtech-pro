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
// ✅ FUNÇÃO UPGRADE DE PLANO (CORRIGIDA COM VALIDAÇÕES DE SEGURANÇA)
// Versão: 2.0 - 31/01/2026
// ============================================================
async function upgradePlano(req, res) {
  try {
    const { planoId, ciclo } = req.body;
    const escritorioId = req.user.escritorio_id;

    console.log('📊 [UPGRADE] Dados recebidos:', {
      planoId,
      ciclo,
      escritorioId,
      usuario: req.user.email
    });

    // ✅ 1. VALIDAÇÕES BÁSICAS
    if (!planoId) {
      return res.status(400).json({ 
        error: 'planoId é obrigatório',
        recebido: req.body
      });
    }

    // ✅ 2. BUSCAR STATUS ATUAL DO ESCRITÓRIO
    const escritorioResult = await pool.query(`
      SELECT 
        e.plano_id as plano_atual_id,
        e.plano_financeiro_status,
        e.trial_expira_em,
        p.nome as plano_atual_nome,
        p.preco_mensal as preco_atual_mensal,
        CASE 
          WHEN e.trial_expira_em IS NOT NULL 
          THEN EXTRACT(DAY FROM (e.trial_expira_em - NOW()))
          ELSE 0
        END as dias_trial
      FROM escritorios e
      JOIN planos p ON e.plano_id = p.id
      WHERE e.id = $1
    `, [escritorioId]);

    if (escritorioResult.rows.length === 0) {
      return res.status(404).json({ error: 'Escritório não encontrado' });
    }

    const escritorio = escritorioResult.rows[0];
    
    console.log('📊 [UPGRADE] Status atual:', {
      plano_atual: escritorio.plano_atual_nome,
      status: escritorio.plano_financeiro_status,
      dias_trial: Math.ceil(escritorio.dias_trial)
    });

    // ✅ 3. BUSCAR INFORMAÇÕES DO NOVO PLANO
    const novoPlanoResult = await pool.query(
      'SELECT id, nome, preco_mensal, preco_anual FROM planos WHERE id = $1',
      [planoId]
    );

    if (novoPlanoResult.rows.length === 0) {
      console.log('❌ [UPGRADE] Plano não existe:', planoId);
      return res.status(404).json({ 
        error: 'Plano não encontrado',
        planoId: planoId
      });
    }

    const novoPlano = novoPlanoResult.rows[0];

    // ✅ 4. REGRAS DE VALIDAÇÃO

    // 4.1. Não pode "fazer upgrade" para o mesmo plano
    if (parseInt(planoId) === parseInt(escritorio.plano_atual_id)) {
      console.log('⚠️ [UPGRADE] Tentativa de upgrade para o mesmo plano');
      return res.status(400).json({
        error: 'Você já está no plano ' + novoPlano.nome,
        plano_atual: escritorio.plano_atual_nome
      });
    }

    // 4.2. Durante TRIAL: NÃO pode upgrade sem pagamento
    if (escritorio.plano_financeiro_status === 'trial' && escritorio.dias_trial > 0) {
      console.log(`⚠️ [UPGRADE BLOQUEADO] Tentativa durante trial por escritório ${escritorioId}`);
      
      return res.status(402).json({
        error: 'Upgrade não permitido durante período trial',
        message: 'Você está no período de teste gratuito. Para fazer upgrade, é necessário primeiro ativar seu plano atual através do pagamento.',
        trial_info: {
          dias_restantes: Math.ceil(escritorio.dias_trial),
          status: 'trial_ativo',
          plano_atual: escritorio.plano_atual_nome
        },
        acao_necessaria: 'pagar_plano_atual',
        redirect: '/planos-page?action=activate'
      });
    }

    // 4.3. Trial EXPIRADO sem pagamento: Sistema bloqueado
    if (escritorio.plano_financeiro_status === 'trial' && escritorio.dias_trial <= 0) {
      console.log(`❌ [UPGRADE BLOQUEADO] Trial expirado para escritório ${escritorioId}`);
      return res.status(402).json({
        error: 'Trial expirado',
        message: 'Seu período de teste expirou. Ative seu plano para continuar.',
        acao_necessaria: 'pagar_plano',
        redirect: '/planos-page?action=pay'
      });
    }

    // 4.4. Se status = 'pago', pode fazer upgrade (gerando nova cobrança)
    if (escritorio.plano_financeiro_status === 'pago' || escritorio.plano_financeiro_status === 'ativo') {
      console.log(`✅ [UPGRADE] Usuário ${req.user.email} pode fazer upgrade (plano pago)`);
      
      const valorMensal = parseFloat(novoPlano.preco_mensal);
      const valorAnual = parseFloat(novoPlano.preco_anual);
      const valorFinal = (ciclo === 'anual') ? valorAnual : valorMensal;

      // ✅ IMPORTANTE: Aqui deveria gerar nova cobrança proporcional
      // Por enquanto, vamos sinalizar que precisa de pagamento adicional
      
      return res.status(402).json({
        upgrade_disponivel: true,
        error: 'Upgrade requer pagamento adicional',
        message: `Para fazer upgrade do plano ${escritorio.plano_atual_nome} para ${novoPlano.nome}, é necessário realizar o pagamento da diferença.`,
        plano_atual: {
          id: escritorio.plano_atual_id,
          nome: escritorio.plano_atual_nome,
          valor: parseFloat(escritorio.preco_atual_mensal)
        },
        plano_destino: {
          id: novoPlano.id,
          nome: novoPlano.nome,
          valor: valorFinal,
          ciclo: ciclo || 'mensal'
        },
        diferenca: valorFinal - parseFloat(escritorio.preco_atual_mensal),
        acao_necessaria: 'gerar_cobranca_upgrade',
        redirect: '/planos-page?action=upgrade&plano=' + planoId
      });
    }

    // ✅ Se chegou aqui, status está em estado inválido
    console.error('❌ [UPGRADE] Status de plano inválido:', escritorio.plano_financeiro_status);
    return res.status(500).json({
      error: 'Status de plano inválido',
      message: 'Entre em contato com o suporte',
      debug: {
        status_atual: escritorio.plano_financeiro_status,
        dias_trial: Math.ceil(escritorio.dias_trial)
      }
    });

  } catch (err) {
    console.error('❌ [UPGRADE] Erro ao processar upgrade:', err);
    console.error('Stack:', err.stack);
    res.status(500).json({ 
      error: 'Erro ao processar upgrade',
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
    const resultConsumo = await pool.query(`
      SELECT COUNT(*) as total 
      FROM prazos 
      WHERE escritorio_id = $1 
        AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
    `, [req.user.escritorio_id]);

    const prazosUsados = parseInt(resultConsumo.rows[0].total || 0);

    // ✅ Calcular dias restantes para vencimento
    let diasRestantes = null;

    if (dadosBase.data_vencimento) {
      const hoje = new Date();
      const vencimento = new Date(dadosBase.data_vencimento);
      diasRestantes = Math.ceil((vencimento - hoje) / (1000 * 60 * 60 * 24));
    }

    console.log(`[PLANO CONSUMO] Escritório: ${req.user.escritorio_id}`);
    console.log(`[PLANO CONSUMO] Prazos criados no mês: ${prazosUsados}/${dadosBase.limite_prazos}`);

    res.json({
      plano: dadosBase.plano,
      limite_prazos: dadosBase.limite_prazos,
      prazos_usados: prazosUsados,
      limite: dadosBase.limite_prazos,
      ciclo: dadosBase.ciclo || 'mensal',
      data_vencimento: dadosBase.data_vencimento,
      dias_restantes: diasRestantes,
      dias_para_bloqueio: null,
      em_tolerancia: false
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