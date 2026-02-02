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
 * 1. CRIAR PRAZO
 * ✅ CORRIGIDA - 27/01/2026: Adiciona deletado = false ao criar
 * ============================================================
 */
async function criarPrazo(req, res) {
  try {
    const { processoId, clienteId, cliente_id, tipo, descricao, dataLimite } = req.body;
    const usuarioId = req.user.id;
    const escritorioId = req.user.escritorio_id;

    // Aceita clienteId ou cliente_id
    const clienteFinal = clienteId || cliente_id || null;

    if (!processoId || !tipo || !dataLimite) {
      return res.status(400).json({ erro: 'Dados obrigatórios ausentes' });
    }

    // Verificar limite
    const verificacao = await verificarLimitePrazos(escritorioId);
    if (!verificacao.permitido) {
      return res.status(403).json({
        erro: verificacao.erro,
        detalhes: verificacao.detalhes
      });
    }

    const result = await pool.query(
      `INSERT INTO prazos 
       (processo_id, cliente_id, tipo, descricao, data_limite, status, escritorio_id, usuario_id, deletado, created_at)
       VALUES ($1, $2, $3, $4, $5, 'aberto', $6, $7, false, NOW())
       RETURNING *`,
      [processoId, clienteFinal, tipo, descricao, dataLimite, escritorioId, usuarioId]
    );

    console.log(`✅ [CRIAR PRAZO] Tipo: ${tipo} - Cliente: ${clienteFinal || 'SEM CLIENTE'}`);

    res.status(201).json({
      ok: true,
      prazo: result.rows[0],
      detalhes: verificacao.detalhes
    });

  } catch (err) {
    console.error('❌ [CRIAR PRAZO] Erro:', err.message);
    res.status(500).json({ erro: 'Erro ao criar prazo' });
  }
}

/**
 * ============================================================
 * 2. LISTAR PRAZOS GERAL (Página de Prazos)
 * ✅ CORRIGIDA - 31/01/2026: Adiciona JOIN com clientes
 * ============================================================
 */
async function listarPrazosGeral(req, res) {
  try {
    const result = await pool.query(
      `SELECT 
        pr.*,
        proc.numero AS processo_numero,
        COALESCE(c.nome, proc.cliente) AS cliente_nome,
        proc.parte_contraria,
        proc.tribunal
       FROM prazos pr
       LEFT JOIN processos proc ON proc.id = pr.processo_id
       LEFT JOIN clientes c ON c.id = pr.cliente_id
       WHERE pr.escritorio_id = $1 
         AND pr.deletado = false
         AND pr.status IN ('aberto', 'hoje', 'atrasado')
       ORDER BY pr.data_limite ASC`,
      [req.user.escritorio_id]
    );
    
    console.log(`📋 [LISTAR PRAZOS] Retornando ${result.rowCount} prazos`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ [LISTAR PRAZOS] Erro:', error);
    res.status(500).json({ erro: 'Erro ao listar geral' });
  }
}

/**
 * ============================================================
 * 3. LISTAR PRAZOS DASHBOARD
 * ✅ CORRIGIDA - 31/01/2026: Adiciona JOIN com clientes
 * ============================================================
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
          COALESCE(c.nome, proc.cliente) AS cliente_nome,
          proc.parte_contraria AS parte_contraria,
          proc.tribunal AS tribunal
       FROM prazos pr
       LEFT JOIN processos proc ON proc.id = pr.processo_id
       LEFT JOIN clientes c ON c.id = pr.cliente_id
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
    
    console.log(`📊 [DASHBOARD PRAZOS] Retornando ${result.rowCount} prazos`);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ [DASHBOARD PRAZOS] Erro:', err);
    res.status(500).json({ erro: err.message });
  }
}

/**
 * ============================================================
 * 4. LISTAR PRAZOS VENCIDOS
 * ✅ CORRIGIDA - 31/01/2026: Adiciona JOIN com clientes e corrige duplicação
 * ============================================================
 */
async function listarPrazosVencidos(req, res) {
  try {
    const result = await pool.query(
      `SELECT 
        pr.*,
        proc.numero AS processo_numero,
        COALESCE(c.nome, proc.cliente) AS cliente_nome,
        proc.parte_contraria,
        proc.tribunal
       FROM prazos pr
       LEFT JOIN processos proc ON proc.id = pr.processo_id
       LEFT JOIN clientes c ON c.id = pr.cliente_id
       WHERE pr.escritorio_id = $1
         AND pr.deletado = false
         AND pr.status = 'atrasado'
       ORDER BY pr.data_limite DESC`,
      [req.user.escritorio_id]
    );

    console.log(`🔴 [PRAZOS VENCIDOS] Retornando ${result.rowCount} prazos`);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ [PRAZOS VENCIDOS] Erro:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar prazos vencidos' });
  }
}

/**
 * ============================================================
 * 5. LISTAR PRAZOS DA SEMANA
 * ✅ CORRIGIDA - 31/01/2026: Adiciona JOIN com clientes
 * ============================================================
 */
async function listarPrazosSemana(req, res) {
  try {
    const result = await pool.query(
      `SELECT 
        p.*,
        pr.numero AS processo_numero,
        COALESCE(c.nome, pr.cliente) AS cliente_nome,
        pr.parte_contraria,
        pr.tribunal
       FROM prazos p
       LEFT JOIN processos pr ON pr.id = p.processo_id
       LEFT JOIN clientes c ON c.id = p.cliente_id
       WHERE p.escritorio_id = $1
         AND p.deletado = false
         AND p.status IN ('aberto', 'hoje')
         AND p.data_limite >= CURRENT_DATE
         AND p.data_limite <= CURRENT_DATE + INTERVAL '7 days'
       ORDER BY p.data_limite ASC`,
      [req.user.escritorio_id]
    );

    console.log(`📅 [PRAZOS SEMANA] Retornando ${result.rowCount} prazos`);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ [PRAZOS SEMANA] Erro:', err.message);
    res.status(500).json({ erro: err.message });
  }
}

/**
 * ============================================================
 * 6. LISTAR PRAZOS FUTUROS
 * ✅ CORRIGIDA - 31/01/2026: Adiciona JOIN com clientes
 * ============================================================
 */
async function listarPrazosFuturos(req, res) {
  try {
    const result = await pool.query(
      `SELECT 
        p.*,
        pr.numero AS processo_numero,
        COALESCE(c.nome, pr.cliente) AS cliente_nome,
        pr.parte_contraria,
        pr.tribunal
       FROM prazos p
       LEFT JOIN processos pr ON pr.id = p.processo_id
       LEFT JOIN clientes c ON c.id = p.cliente_id
       WHERE p.escritorio_id = $1
         AND p.deletado = false
         AND p.status = 'aberto'
         AND p.data_limite > CURRENT_DATE + INTERVAL '7 days'
       ORDER BY p.data_limite ASC`,
      [req.user.escritorio_id]
    );

    console.log(`🔮 [PRAZOS FUTUROS] Retornando ${result.rowCount} prazos`);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ [PRAZOS FUTUROS] Erro:', err.message);
    res.status(500).json({ erro: err.message });
  }
}

/**
 * ============================================================
 * 7. LISTAR PRAZOS CONCLUÍDOS
 * ✅ CORRIGIDA - 31/01/2026: Adiciona JOIN com clientes
 * ============================================================
 */
async function listarPrazosConcluidos(req, res) {
  try {
    const result = await pool.query(
      `SELECT 
        p.*,
        pr.numero AS processo_numero,
        COALESCE(c.nome, pr.cliente) AS cliente_nome,
        pr.parte_contraria,
        pr.tribunal
       FROM prazos p 
       LEFT JOIN processos pr ON pr.id = p.processo_id
       LEFT JOIN clientes c ON c.id = p.cliente_id
       WHERE p.escritorio_id = $1 
         AND p.deletado = false
         AND p.status = 'concluido' 
       ORDER BY p.concluido_em DESC`, 
      [req.user.escritorio_id]
    );
    
    console.log(`✅ [PRAZOS CONCLUÍDOS] Retornando ${result.rowCount} prazos`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ [PRAZOS CONCLUÍDOS] Erro:', error);
    res.status(500).json({ erro: 'Erro ao listar concluídos' });
  }
}

/**
 * ============================================================
 * 8. ATUALIZAR PRAZO
 * ✅ CORRIGIDA - 31/01/2026: Aceita clienteId e cliente_id
 * ============================================================
 */
async function atualizarPrazo(req, res) {
    const { id } = req.params;
    const { tipo, descricao, dataLimite, clienteId, cliente_id } = req.body;
    const escritorioId = req.user.escritorio_id;

    // Aceita ambos os formatos
    const clienteFinal = clienteId || cliente_id || null;

    console.log(`📝 [ATUALIZAR PRAZO] ID: ${id}, Cliente: ${clienteFinal}, Tipo: ${tipo}`);

    try {
        const result = await pool.query(
            `UPDATE prazos 
             SET tipo = $1, 
                 descricao = $2, 
                 data_limite = $3,
                 cliente_id = $4
             WHERE id = $5 
             AND escritorio_id = $6 
             AND deletado = false
             RETURNING *`,
            [tipo, descricao, dataLimite, clienteFinal, id, escritorioId]
        );

        if (result.rowCount === 0) {
            console.warn(`⚠️ [ATUALIZAR PRAZO] Prazo ${id} não encontrado`);
            return res.status(404).json({ erro: 'Prazo não encontrado' });
        }

        console.log(`✅ [ATUALIZAR PRAZO] Prazo ${id} atualizado - Cliente: ${clienteFinal || 'SEM CLIENTE'}`);
        
        res.json({ 
            ok: true, 
            prazo: result.rows[0],
            mensagem: 'Prazo atualizado com sucesso'
        });

    } catch (err) {
        console.error('❌ [ATUALIZAR PRAZO] Erro:', err.message);
        res.status(500).json({ erro: 'Erro ao atualizar prazo' });
    }
}

/**
 * ============================================================
 * 9. CONCLUIR PRAZO
 * ============================================================
 */
async function concluirPrazo(req, res) {
  try {
    const result = await pool.query(
      `UPDATE prazos 
       SET status = 'concluido', 
           concluido_em = NOW(), 
           concluido_por = $1 
       WHERE id = $2 
       AND escritorio_id = $3
       RETURNING *`,
      [req.user.id, req.params.id, req.user.escritorio_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ erro: 'Prazo não encontrado' });
    }

    console.log(`✅ [CONCLUIR PRAZO] ID: ${req.params.id}`);
    res.json({ sucesso: true, prazo: result.rows[0] });
  } catch (err) {
    console.error('❌ [CONCLUIR PRAZO] Erro:', err);
    res.status(500).json({ erro: err.message });
  }
}

/**
 * ============================================================
 * 10. EXCLUIR PRAZO (SOFT DELETE)
 * ✅ CORRIGIDA - 27/01/2026: SOFT DELETE ao invés de hard delete
 * ============================================================
 */
async function excluirPrazo(req, res) {
  try {
    const result = await pool.query(
      `UPDATE prazos 
       SET deletado = true 
       WHERE id = $1 
       AND escritorio_id = $2 
       RETURNING *`,
      [req.params.id, req.user.escritorio_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ erro: 'Prazo não encontrado' });
    }

    console.log(`🗑️ [EXCLUIR PRAZO] ID ${req.params.id} marcado como deletado`);
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ [EXCLUIR PRAZO] Erro:', error);
    res.status(500).json({ erro: 'Erro ao excluir' });
  }
}

/**
 * ============================================================
 * 11. LIMPAR PRAZOS CONCLUÍDOS
 * Remove permanentemente prazos concluídos há mais de 30 dias
 * ============================================================
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
    
    console.log(`🧹 [LIMPAR CONCLUÍDOS] ${resultado.rowCount} prazos removidos`);
    res.json({ sucesso: true, removidos: resultado.rowCount });
  } catch (err) {
    console.error('❌ [LIMPAR CONCLUÍDOS] Erro:', err);
    res.status(500).json({ erro: 'Erro ao limpar' });
  }
}

/**
 * ============================================================
 * 12. ATUALIZAR STATUS DO PRAZO (AUXILIAR)
 * Marca prazos como atrasados quando a data passa
 * ============================================================
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
    console.error('❌ Erro ao atualizar status do prazo', id, ':', err.message);
  }
}

/**
 * ============================================================
 * 13. PLANO E CONSUMO
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

    // ✅ CORRIGIDO: Conta TODOS os prazos criados no mês (incluindo deletados)
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

    console.log(`📊 [PLANO CONSUMO] Escritório ${escritorioId}: ${prazosAtivos}/${planoConfig.prazos.max} prazos`);

    // Resposta com compatibilidade dupla
    res.json({ 
      // Estrutura antiga (compatibilidade)
      plano: planoNome,
      limite_prazos: planoConfig.prazos.max,
      prazos_usados: prazosAtivos,
      ciclo: planoResult.rows[0].ciclo,
      data_vencimento: planoResult.rows[0].data_vencimento,
      status_pagamento: planoResult.rows[0].status_pagamento,
      dias_restantes: diasRestantes,
      em_tolerancia: (diasRestantes !== null && diasRestantes < 0 && diasRestantes >= -5),
      dias_para_bloqueio: vencimento ? diasRestantes + 5 : null,
      
      // Estrutura nova
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
    console.error('❌ [PLANO CONSUMO] Erro:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
}

/**
 * ============================================================
 * 14. UPLOAD DE ANEXO PDF
 * ============================================================
 */
async function uploadAnexo(req, res) {
  try {
    const prazoId = req.params.id;
    const escritorioId = req.user.escritorio_id;
    
    // Verificar se o arquivo foi enviado
    if (!req.file) {
      return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
    }
    
    // Verificar se o prazo existe e pertence ao escritório
    const prazoCheck = await pool.query(
      'SELECT id, anexo_pdf FROM prazos WHERE id = $1 AND escritorio_id = $2',
      [prazoId, escritorioId]
    );
    
    if (prazoCheck.rows.length === 0) {
      // Deletar o arquivo enviado se o prazo não existir
      const fs = require('fs');
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ erro: 'Prazo não encontrado' });
    }
    
    // Se já existia um anexo anterior, deletar o arquivo antigo
    if (prazoCheck.rows[0].anexo_pdf) {
      const fs = require('fs');
      const path = require('path');
      const oldFilePath = path.join(__dirname, '..', 'uploads', 'prazos', prazoCheck.rows[0].anexo_pdf);
      
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
        console.log('🗑️ Arquivo antigo removido:', prazoCheck.rows[0].anexo_pdf);
      }
    }
    
    // Atualizar o banco com o nome do novo arquivo
    const result = await pool.query(
      `UPDATE prazos 
       SET anexo_pdf = $1
       WHERE id = $2 AND escritorio_id = $3
       RETURNING *`,
      [req.file.filename, prazoId, escritorioId]
    );
    
    console.log(`📎 [UPLOAD ANEXO] PDF anexado ao prazo ${prazoId}: ${req.file.filename}`);
    
    res.json({
      ok: true,
      mensagem: 'PDF anexado com sucesso',
      arquivo: {
        nome: req.file.originalname,
        tamanho: req.file.size,
        nomeServidor: req.file.filename
      },
      prazo: result.rows[0]
    });
    
  } catch (err) {
    console.error('❌ [UPLOAD ANEXO] Erro:', err);
    
    // Tentar deletar o arquivo se houve erro
    if (req.file) {
      const fs = require('fs');
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    }
    
    res.status(500).json({ erro: 'Erro ao fazer upload do PDF' });
  }
}

/**
 * ============================================================
 * 15. VISUALIZAR/BAIXAR ANEXO PDF
 * ============================================================
 */
async function visualizarAnexo(req, res) {
  try {
    const prazoId = req.params.id;
    const escritorioId = req.user.escritorio_id;
    
    // Buscar informações do prazo
    const result = await pool.query(
      'SELECT anexo_pdf FROM prazos WHERE id = $1 AND escritorio_id = $2',
      [prazoId, escritorioId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Prazo não encontrado' });
    }
    
    if (!result.rows[0].anexo_pdf) {
      return res.status(404).json({ erro: 'Este prazo não possui anexo' });
    }
    
    // Montar caminho do arquivo
    const path = require('path');
    const filePath = path.join(__dirname, '..', 'uploads', 'prazos', result.rows[0].anexo_pdf);
    
    // Verificar se o arquivo existe
    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
      console.error('❌ Arquivo não encontrado:', filePath);
      return res.status(404).json({ erro: 'Arquivo não encontrado no servidor' });
    }
    
    console.log(`👁️ [VISUALIZAR ANEXO] Servindo PDF do prazo ${prazoId}`);
    
    // Enviar o arquivo
    res.sendFile(filePath);
    
  } catch (err) {
    console.error('❌ [VISUALIZAR ANEXO] Erro:', err);
    res.status(500).json({ erro: 'Erro ao buscar PDF' });
  }
}

/**
 * ============================================================
 * 16. DELETAR ANEXO PDF
 * ============================================================
 */
async function deletarAnexo(req, res) {
  try {
    const prazoId = req.params.id;
    const escritorioId = req.user.escritorio_id;
    
    // Buscar informações do prazo
    const result = await pool.query(
      'SELECT anexo_pdf FROM prazos WHERE id = $1 AND escritorio_id = $2',
      [prazoId, escritorioId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Prazo não encontrado' });
    }
    
    if (!result.rows[0].anexo_pdf) {
      return res.status(404).json({ erro: 'Este prazo não possui anexo' });
    }
    
    const nomeArquivo = result.rows[0].anexo_pdf;
    
    // Deletar arquivo do servidor
    const path = require('path');
    const fs = require('fs');
    const filePath = path.join(__dirname, '..', 'uploads', 'prazos', nomeArquivo);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('🗑️ Arquivo deletado:', filePath);
    }
    
    // Remover referência do banco
    await pool.query(
      `UPDATE prazos 
       SET anexo_pdf = NULL
       WHERE id = $1 AND escritorio_id = $2`,
      [prazoId, escritorioId]
    );
    
    console.log(`🗑️ [DELETAR ANEXO] PDF removido do prazo ${prazoId}`);
    
    res.json({
      ok: true,
      mensagem: 'PDF removido com sucesso'
    });
    
  } catch (err) {
    console.error('❌ [DELETAR ANEXO] Erro:', err);
    res.status(500).json({ erro: 'Erro ao deletar PDF' });
  }
}

/**
 * ============================================================
 * EXPORTS
 * ============================================================
 */
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
  atualizarStatusPrazo,
  uploadAnexo,
  visualizarAnexo,
  deletarAnexo
};