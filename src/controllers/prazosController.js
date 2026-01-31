const pool = require('../config/db');
const planLimits = require('../config/planLimits.json');

/**
 * ============================================================
 * 🔒 FUNÇÃO AUXILIAR: VERIFICAR LIMITE DE PRAZOS
 * ✅ CORRIGIDA - 27/01/2026: Usa created_at e conta todos (incluindo deletados)
 * ============================================================
 */
async function verificarLimitePrazos(escritorioId) {
  try {
    // Buscar plano do escritório
    const planoResult = await pool.query(
      `SELECT p.slug, p.nome 
       FROM escritorios e
       JOIN planos p ON e.plano_id = p.id
       WHERE e.id = $1`,
      [escritorioId]
    );

    if (planoResult.rows.length === 0) {
      return { 
        permitido: false, 
        erro: 'Plano não identificado' 
      };
    }

    const planoSlug = planoResult.rows[0].slug || 'basico';
    const planoConfig = planLimits[planoSlug];
    const limitePrazos = planoConfig.prazos;

    // Se for ilimitado, libera
    if (limitePrazos.ilimitado) {
      return { 
        permitido: true, 
        ilimitado: true,
        plano: planoConfig.nome 
      };
    }

    // ✅ CORRIGIDO: Contar TODOS os prazos criados no mês (incluindo deletados)
    // Isso evita que usuários burlem o limite deletando prazos
    const countResult = await pool.query(
      `SELECT COUNT(*) as total 
       FROM prazos 
       WHERE escritorio_id = $1 
       AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
       AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)`,
      [escritorioId]
    );

    const prazosAtivos = parseInt(countResult.rows[0].total);
    const limiteMax = limitePrazos.max;

    // Verificar se atingiu o limite
    if (prazosAtivos >= limiteMax) {
      return {
        permitido: false,
        erro: `Limite de ${limiteMax} prazos mensais atingido`,
        detalhes: {
          atual: prazosAtivos,
          maximo: limiteMax,
          plano: planoConfig.nome
        }
      };
    }

    return {
      permitido: true,
      detalhes: {
        atual: prazosAtivos,
        maximo: limiteMax,
        restante: limiteMax - prazosAtivos,
        plano: planoConfig.nome
      }
    };

  } catch (err) {
    console.error('❌ Erro ao verificar limite de prazos:', err);
    return { 
      permitido: false, 
      erro: 'Erro ao verificar limite' 
    };
  }
}

/**
 * ============================================================
 * 1. GESTÃO DE CRIAÇÃO (SISTEMA DE LIMITES DINÂMICOS)
 * ✅ CORRIGIDA - 27/01/2026: Adiciona deletado = false ao criar
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

    // 🔒 NOVA VALIDAÇÃO: Verificar limite de prazos mensais baseado no planLimits.json
    const verificacao = await verificarLimitePrazos(escritorioId);
    
    if (!verificacao.permitido) {
      return res.status(402).json({
        codigo: 'LIMITE_PLANO_ATINGIDO',
        erro: verificacao.erro,
        upgrade_required: true,
        detalhes: verificacao.detalhes,
        message: `Você atingiu o limite de prazos mensais do seu plano. Faça upgrade para continuar cadastrando.`
      });
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

    // ✅ CORRIGIDO: Adiciona deletado = false e created_at na inserção
    const insertResult = await pool.query(
      `INSERT INTO prazos (processo_id, tipo, descricao, data_limite, status, usuario_id, escritorio_id, deletado, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, NOW()) RETURNING *`,
      [processoId, tipo, descricao, dataLimite, statusInicial, usuarioId, escritorioId]
    );

    res.status(201).json({ 
      mensagem: 'Prazo criado com sucesso', 
      prazo: insertResult.rows[0],
      limites: verificacao.detalhes // Informações de uso
    });
  } catch (error) {
    console.error('Erro ao criar prazo:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar prazo' });
  }
}

/**
 * Lista geral - usada na página de prazos (mostra abertos, hoje e atrasados)
 * ✅ CORRIGIDA - 27/01/2026: Filtra deletados
 */
async function listarPrazosGeral(req, res) {
  try {
    const result = await pool.query(
      `SELECT pr.*, proc.numero AS processo_numero, proc.cliente AS cliente_nome
       FROM prazos pr
       LEFT JOIN processos proc ON proc.id = pr.processo_id
       WHERE pr.escritorio_id = $1 
         AND pr.deletado = false
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
 * ✅ CORRIGIDA - 27/01/2026: Filtra deletados
 */
async function listarPrazosDashboard(req, res) {
  try {
    const result = await pool.query(
      `SELECT 
          pr.id, 
          pr.tipo, 
          pr.data_limite, 
          pr.status, 
          proc.numero AS numero_processo, 
          proc.cliente AS cliente_nome,
          proc.parte_contraria AS parte_contraria,
          proc.tribunal AS tribunal           -- ✅ Adicionado o tribunal
       FROM prazos pr
       LEFT JOIN processos proc ON proc.id = pr.processo_id
       WHERE pr.escritorio_id = $1 
         AND pr.deletado = false
         AND pr.status IN ('atrasado', 'hoje', 'aberto')
       ORDER BY 
         CASE pr.status 
           WHEN 'atrasado' THEN 1
           WHEN 'hoje' THEN 2
           ELSE 3
         END,
         pr.data_limite ASC
       LIMIT 15`,
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
 * ✅ CORRIGIDA - 27/01/2026: Filtra deletados
 */
async function listarPrazosVencidos(req, res) {
  try {
    const result = await pool.query(`
      SELECT pr.*, proc.numero AS processo_numero, proc.cliente AS cliente_nome
      FROM prazos pr
      LEFT JOIN processos proc ON proc.id = pr.processo_id
      WHERE pr.escritorio_id = $1
        AND pr.deletado = false
        AND pr.status = 'atrasado'
      ORDER BY pr.data_limite DESC
    `, [req.user.escritorio_id]);

    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao listar prazos vencidos:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar prazos vencidos' });
  }
}

/**
 * ✅ CORRIGIDA - 27/01/2026: Filtra deletados
 */
async function listarPrazosSemana(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT p.*, pr.numero AS processo_numero, pr.cliente AS cliente_nome
      FROM prazos p
      LEFT JOIN processos pr ON pr.id = p.processo_id
      WHERE p.escritorio_id = $1
        AND p.deletado = false
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

/**
 * ✅ CORRIGIDA - 27/01/2026: Filtra deletados
 */
async function listarPrazosFuturos(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT p.*, pr.numero AS processo_numero, pr.cliente AS cliente_nome
      FROM prazos p
      LEFT JOIN processos pr ON pr.id = p.processo_id
      WHERE p.escritorio_id = $1
        AND p.deletado = false
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

/**
 * ✅ CORRIGIDA - 27/01/2026: Filtra deletados
 */
async function listarPrazosConcluidos(req, res) {
  try {
    const result = await pool.query(
      `SELECT p.*, pr.numero AS processo_numero, pr.cliente AS cliente_nome 
       FROM prazos p 
       LEFT JOIN processos pr ON pr.id = p.processo_id
       WHERE p.escritorio_id = $1 
         AND p.deletado = false
         AND p.status = 'concluido' 
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
 * Limpar concluídos - Hard delete de prazos concluídos antigos
 * (Prazos concluídos há mais de 30 dias podem ser removidos permanentemente)
 */
async function limparPrazosConcluidos(req, res) {
  try {
    const resultado = await pool.query(
      `DELETE FROM prazos 
       WHERE status = 'concluido' 
       AND escritorio_id = $1
       AND concluido_em < NOW() - INTERVAL '30 days'`,
      [req.user.escritorio_id]
    );
    res.json({ sucesso: true, removidos: resultado.rowCount });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao limpar' });
  }
}

/**
 * Excluir prazo
 * ✅ CORRIGIDA - 27/01/2026: SOFT DELETE ao invés de hard delete
 */
async function excluirPrazo(req, res) {
  try {
    // ✅ SOFT DELETE: Marca como deletado ao invés de apagar
    const result = await pool.query(
      'UPDATE prazos SET deletado = true WHERE id = $1 AND escritorio_id = $2 RETURNING *',
      [req.params.id, req.user.escritorio_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ erro: 'Prazo não encontrado' });
    }

    console.log(`[PRAZO] Soft delete: ID ${req.params.id} marcado como deletado`);
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao excluir prazo:', error);
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
 * ============================================================
 * PLANO E CONSUMO - ATUALIZADO COM LIMITES DO planLimits.json
 * ✅ CORRIGIDA - 27/01/2026: Usa created_at e conta todos (incluindo deletados)
 * ============================================================
 */
async function planoEConsumo(req, res) {
  try {
    const escritorioId = req.user.escritorio_id;

    // Buscar plano do escritório
    const planoResult = await pool.query(
      `SELECT p.slug, p.nome, p.limite_prazos, e.ciclo, e.data_vencimento, e.status_pagamento
       FROM escritorios e 
       JOIN planos p ON e.plano_id = p.id 
       WHERE e.id = $1`,
      [escritorioId]
    );
    
    if (planoResult.rows.length === 0) {
      return res.status(404).json({ erro: 'Escritório não encontrado' });
    }

    const planoSlug = planoResult.rows[0].slug || 'basico';
    const planoConfig = planLimits[planoSlug];
    const planoNome = planoResult.rows[0].nome;

    // ✅ CORRIGIDO: Buscar consumo atual de prazos usando created_at
    // Conta TODOS os prazos criados no mês (incluindo deletados)
    const prazosCount = await pool.query(
      `SELECT COUNT(*) as total 
       FROM prazos 
       WHERE escritorio_id = $1 
       AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
       AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)`,
      [escritorioId]
    );

    // Buscar consumo de usuários
    const usuariosCount = await pool.query(
      'SELECT COUNT(*) as total FROM usuarios WHERE escritorio_id = $1',
      [escritorioId]
    );

    // Buscar consumo de processos
    const processosCount = await pool.query(
      'SELECT COUNT(*) as total FROM processos WHERE escritorio_id = $1',
      [escritorioId]
    );

    const prazosAtivos = parseInt(prazosCount.rows[0].total);
    const usuariosAtivos = parseInt(usuariosCount.rows[0].total);
    const processosAtivos = parseInt(processosCount.rows[0].total);

    // Calcular dias restantes
    const hoje = new Date();
    const vencimento = planoResult.rows[0].data_vencimento ? new Date(planoResult.rows[0].data_vencimento) : null;
    let diasRestantes = vencimento ? Math.ceil((vencimento - hoje) / (1000 * 60 * 60 * 24)) : null;

    // Log para debug
    console.log(`[PLANO CONSUMO] Escritório: ${escritorioId}`);
    console.log(`[PLANO CONSUMO] Prazos criados no mês: ${prazosAtivos}/${planoConfig.prazos.max}`);

    // ✅ RESPOSTA COM COMPATIBILIDADE DUPLA (frontend antigo + novo)
    res.json({ 
      // Estrutura ANTIGA (compatibilidade com páginas HTML existentes)
      plano: planoNome,  // ← String simples "Básico"
      limite_prazos: planoConfig.prazos.max,
      prazos_usados: prazosAtivos,
      ciclo: planoResult.rows[0].ciclo,
      data_vencimento: planoResult.rows[0].data_vencimento,
      status_pagamento: planoResult.rows[0].status_pagamento,
      dias_restantes: diasRestantes,
      em_tolerancia: (diasRestantes !== null && diasRestantes < 0 && diasRestantes >= -5),
      dias_para_bloqueio: vencimento ? diasRestantes + 5 : null,
      
      // Estrutura NOVA (para novas features)
      plano_detalhado: {
        nome: planoNome,
        slug: planoSlug
      },
      consumo: {
        prazos: {
          atual: prazosAtivos,
          maximo: planoConfig.prazos.max,
          ilimitado: planoConfig.prazos.ilimitado,
          percentual: planoConfig.prazos.ilimitado 
            ? 0 
            : Math.round((prazosAtivos / planoConfig.prazos.max) * 100)
        },
        usuarios: {
          atual: usuariosAtivos,
          maximo: planoConfig.usuarios.max,
          ilimitado: planoConfig.usuarios.ilimitado,
          percentual: planoConfig.usuarios.ilimitado 
            ? 0 
            : Math.round((usuariosAtivos / planoConfig.usuarios.max) * 100)
        },
        processos: {
          atual: processosAtivos,
          maximo: planoConfig.processos.max,
          ilimitado: planoConfig.processos.ilimitado
        }
      },
      funcionalidades: planoConfig.funcionalidades
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
  atualizarStatusPrazo
};