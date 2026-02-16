const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');

/**
 * CADASTRAR NOVO PROCESSO (COM MÚLTIPLAS PARTES)
 * POST /api/processos
 */
router.post('/processos', authMiddleware, async (req, res) => {
  const dadosRecebidos = req.body;

  console.log('🚀 POST /api/processos - Dados recebidos:', dadosRecebidos);

  let {
    numero,
    uf,
    instancia,
    esfera,
    tribunal,
    partes_ativo,  // Array de partes do polo ativo
    partes_passivo // Array de partes do polo passivo
  } = dadosRecebidos;

  // Normalização
  esfera = (esfera || '').trim();
  tribunal = (tribunal || '').trim();

  // Validação
  if (!numero) {
    return res.status(400).json({ erro: 'Número do processo é obrigatório' });
  }

  if (!esfera || !tribunal) {
    console.warn('Aviso: esfera ou tribunal não enviados');
  }

  // Validar partes
  if (!partes_ativo || !Array.isArray(partes_ativo) || partes_ativo.length === 0) {
    return res.status(400).json({ 
      erro: 'É obrigatório informar pelo menos uma parte no polo ativo (autor/cliente)' 
    });
  }

  if (!partes_passivo || !Array.isArray(partes_passivo) || partes_passivo.length === 0) {
    return res.status(400).json({ 
      erro: 'É obrigatório informar pelo menos uma parte no polo passivo (réu)' 
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1️⃣ Criar o processo (sem cliente/parte_contraria específicos)
    const processoResult = await client.query(
      `INSERT INTO processos (
        numero, uf, instancia,
        usuario_id, escritorio_id,
        esfera, tribunal, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'ativo')
      RETURNING *`,
      [
        numero,
        uf,
        instancia,
        req.user.id,
        req.user.escritorio_id,
        esfera,
        tribunal
      ]
    );

    const processoId = processoResult.rows[0].id;
    console.log('✅ Processo criado:', processoId);

    // 2️⃣ Inserir partes do polo ativo
    for (const parte of partes_ativo) {
      await client.query(
        `INSERT INTO partes_processo (
          processo_id, pessoa_id, pessoa_nome, polo,
          tipo_parte, eh_principal, escritorio_id
        ) VALUES ($1, $2, $3, 'ativo', $4, $5, $6)`,
        [
          processoId,
          parte.pessoa_id || null,
          parte.pessoa_nome,
          parte.tipo_parte || 'autor',
          parte.eh_principal || false,
          req.user.escritorio_id
        ]
      );
    }

    // 3️⃣ Inserir partes do polo passivo
    for (const parte of partes_passivo) {
      await client.query(
        `INSERT INTO partes_processo (
          processo_id, pessoa_id, pessoa_nome, polo,
          tipo_parte, eh_principal, escritorio_id
        ) VALUES ($1, $2, $3, 'passivo', $4, $5, $6)`,
        [
          processoId,
          parte.pessoa_id || null,
          parte.pessoa_nome,
          parte.tipo_parte || 'reu',
          parte.eh_principal || false,
          req.user.escritorio_id
        ]
      );
    }

    // 4️⃣ Atualizar campos legacy para compatibilidade
    const partePrincipalAtiva = partes_ativo.find(p => p.eh_principal) || partes_ativo[0];
    const partePrincipalPassiva = partes_passivo.find(p => p.eh_principal) || partes_passivo[0];

    await client.query(
      `UPDATE processos 
       SET cliente = $1,
           cliente_id = $2,
           parte_contraria = $3
       WHERE id = $4`,
      [
        partePrincipalAtiva.pessoa_nome,
        partePrincipalAtiva.pessoa_id,
        partePrincipalPassiva.pessoa_nome,
        processoId
      ]
    );

    await client.query('COMMIT');

    console.log('✅ Processo e partes salvos com sucesso');

    res.status(201).json({
      ok: true,
      processo: processoResult.rows[0]
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao salvar processo:', err.message);
    res.status(500).json({ 
      erro: 'Erro interno ao salvar processo', 
      detalhe: err.message 
    });
  } finally {
    client.release();
  }
});

/**
 * LISTAR PROCESSOS (COM INFORMAÇÕES DAS PARTES)
 * GET /api/processos
 */
router.get('/processos', authMiddleware, async (req, res) => {
  try {
    const query = `
      SELECT 
        p.id,
        p.numero,
        p.esfera,
        p.tribunal,
        p.instancia,
        p.uf,
        p.status,
        p.excluido_por,
        p.data_exclusao,
        -- Parte ativa principal
        (SELECT pessoa_nome FROM partes_processo 
         WHERE processo_id = p.id AND polo = 'ativo' AND eh_principal = TRUE 
         LIMIT 1) as cliente,
        (SELECT pessoa_id FROM partes_processo 
         WHERE processo_id = p.id AND polo = 'ativo' AND eh_principal = TRUE 
         LIMIT 1) as cliente_id,
        -- Parte passiva principal
        (SELECT pessoa_nome FROM partes_processo 
         WHERE processo_id = p.id AND polo = 'passivo' AND eh_principal = TRUE 
         LIMIT 1) as parte_contraria,
        -- Contadores
        (SELECT COUNT(*) FROM partes_processo 
         WHERE processo_id = p.id AND polo = 'ativo') as total_autores,
        (SELECT COUNT(*) FROM partes_processo 
         WHERE processo_id = p.id AND polo = 'passivo') as total_reus
      FROM processos p
      WHERE p.escritorio_id = $1
      ORDER BY p.id DESC
      LIMIT 500
    `;

    const result = await pool.query(query, [req.user.escritorio_id]);

    console.log(`📋 Listados ${result.rowCount} processos`);

    res.json(result.rows);

  } catch (err) {
    console.error('Erro ao listar processos:', err.message);
    res.status(500).json({ erro: 'Erro ao listar processos' });
  }
});

/**
 * BUSCAR DETALHES DE UM PROCESSO (COM TODAS AS PARTES)
 * GET /api/processos/:id
 */
router.get('/processos/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    // Buscar dados do processo
    const processoResult = await pool.query(
      `SELECT * FROM processos 
       WHERE id = $1 AND escritorio_id = $2`,
      [id, req.user.escritorio_id]
    );

    if (processoResult.rows.length === 0) {
      return res.status(404).json({ erro: 'Processo não encontrado' });
    }

    // Buscar todas as partes
    const partesResult = await pool.query(
      `SELECT pp.*, c.email, c.telefone, c.documento
       FROM partes_processo pp
       LEFT JOIN clientes c ON pp.pessoa_id = c.id
       WHERE pp.processo_id = $1
       ORDER BY pp.polo, pp.eh_principal DESC, pp.pessoa_nome`,
      [id]
    );

    const processo = processoResult.rows[0];
    const partes = {
      ativo: partesResult.rows.filter(p => p.polo === 'ativo'),
      passivo: partesResult.rows.filter(p => p.polo === 'passivo')
    };

    res.json({
      ok: true,
      processo,
      partes
    });

  } catch (err) {
    console.error('Erro ao buscar processo:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar processo' });
  }
});

/**
 * BUSCAR PARTES DE UM PROCESSO
 * GET /api/processos/:id/partes
 */
router.get('/processos/:processoId/partes', authMiddleware, async (req, res) => {
  const { processoId } = req.params;

  try {
    const query = `
      SELECT 
        pp.*,
        c.email as pessoa_email,
        c.telefone as pessoa_telefone,
        c.documento as pessoa_documento
      FROM partes_processo pp
      LEFT JOIN clientes c ON pp.pessoa_id = c.id
      WHERE pp.processo_id = $1 
      AND pp.escritorio_id = $2
      ORDER BY 
        pp.polo ASC,
        pp.eh_principal DESC,
        pp.pessoa_nome ASC
    `;

    const result = await pool.query(query, [processoId, req.user.escritorio_id]);

    const partesOrganizadas = {
      ativo: result.rows.filter(p => p.polo === 'ativo'),
      passivo: result.rows.filter(p => p.polo === 'passivo')
    };

    res.json({
      ok: true,
      partes: result.rows,
      partesOrganizadas
    });

  } catch (err) {
    console.error('Erro ao listar partes:', err.message);
    res.status(500).json({ erro: 'Erro ao carregar partes' });
  }
});

/**
 * ATUALIZAR PROCESSO (COM PARTES)
 * PUT /api/processos/:id
 */
router.put('/processos/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { esfera, tribunal, instancia, uf, partes_ativo, partes_passivo } = req.body;
    const escritorioId = req.user.escritorio_id;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Atualizar dados básicos do processo
        await client.query(
            `UPDATE processos 
             SET esfera = $1, tribunal = $2, instancia = $3, uf = $4
             WHERE id = $5 AND escritorio_id = $6`,
            [esfera, tribunal, instancia, uf, id, escritorioId]
        );

        // Se foram enviadas novas partes, atualizar
        if (partes_ativo && Array.isArray(partes_ativo)) {
            // Remover partes antigas do polo ativo
            await client.query(
                'DELETE FROM partes_processo WHERE processo_id = $1 AND polo = $2',
                [id, 'ativo']
            );

            // Inserir novas partes ativas
            for (const parte of partes_ativo) {
                await client.query(
                    `INSERT INTO partes_processo (
                      processo_id, pessoa_id, pessoa_nome, polo,
                      tipo_parte, eh_principal, escritorio_id
                    ) VALUES ($1, $2, $3, 'ativo', $4, $5, $6)`,
                    [
                        id,
                        parte.pessoa_id || null,
                        parte.pessoa_nome,
                        parte.tipo_parte || 'autor',
                        parte.eh_principal || false,
                        escritorioId
                    ]
                );
            }
        }

        if (partes_passivo && Array.isArray(partes_passivo)) {
            // Remover partes antigas do polo passivo
            await client.query(
                'DELETE FROM partes_processo WHERE processo_id = $1 AND polo = $2',
                [id, 'passivo']
            );

            // Inserir novas partes passivas
            for (const parte of partes_passivo) {
                await client.query(
                    `INSERT INTO partes_processo (
                      processo_id, pessoa_id, pessoa_nome, polo,
                      tipo_parte, eh_principal, escritorio_id
                    ) VALUES ($1, $2, $3, 'passivo', $4, $5, $6)`,
                    [
                        id,
                        parte.pessoa_id || null,
                        parte.pessoa_nome,
                        parte.tipo_parte || 'reu',
                        parte.eh_principal || false,
                        escritorioId
                    ]
                );
            }
        }

        // Atualizar campos legacy
        const partePrincipalAtiva = await client.query(
            `SELECT pessoa_nome, pessoa_id FROM partes_processo 
             WHERE processo_id = $1 AND polo = 'ativo' AND eh_principal = TRUE LIMIT 1`,
            [id]
        );

        const partePrincipalPassiva = await client.query(
            `SELECT pessoa_nome FROM partes_processo 
             WHERE processo_id = $1 AND polo = 'passivo' AND eh_principal = TRUE LIMIT 1`,
            [id]
        );

        if (partePrincipalAtiva.rows.length > 0) {
            await client.query(
                `UPDATE processos 
                 SET cliente = $1, cliente_id = $2
                 WHERE id = $3`,
                [
                    partePrincipalAtiva.rows[0].pessoa_nome,
                    partePrincipalAtiva.rows[0].pessoa_id,
                    id
                ]
            );
        }

        if (partePrincipalPassiva.rows.length > 0) {
            await client.query(
                `UPDATE processos 
                 SET parte_contraria = $1
                 WHERE id = $2`,
                [partePrincipalPassiva.rows[0].pessoa_nome, id]
            );
        }

        await client.query('COMMIT');

        console.log(`✅ Processo ${id} atualizado com sucesso`);

        res.json({ 
            ok: true, 
            mensagem: 'Processo atualizado com sucesso'
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Erro ao atualizar processo:', err.message);
        res.status(500).json({ 
            erro: 'Erro ao atualizar processo',
            detalhes: err.message 
        });
    } finally {
        client.release();
    }
});

// ============================================================
// ROTAS EXISTENTES (mantidas para compatibilidade)
// ============================================================

router.get('/processos/existe/:numero', authMiddleware, async (req, res) => {
  const { numero } = req.params;
  const escritorioId = req.user.escritorio_id;

  try {
    const result = await pool.query(
      'SELECT id FROM processos WHERE numero = $1 AND escritorio_id = $2 LIMIT 1',
      [numero.trim(), escritorioId]
    );

    res.json({ 
      existe: result.rowCount > 0,
      processoId: result.rowCount > 0 ? result.rows[0].id : null 
    });
  } catch (err) {
    console.error('Erro ao verificar duplicidade:', err.message);
    res.status(500).json({ erro: 'Erro ao verificar processo' });
  }
});

router.patch('/processos/:id/excluir', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const escritorioId = req.user?.escritorio_id;
  const operador = req.user?.nome || req.user?.email || 'Usuário desconhecido';

  console.log(`Tentando excluir processo ID ${id} por usuário ${operador}`);

  if (!req.user || !escritorioId) {
    return res.status(401).json({ erro: 'Autenticação inválida' });
  }

  try {
    const audCheck = await pool.query(
      'SELECT COUNT(*) FROM audiencias WHERE processo_id = $1',
      [id]
    );

    const countAudiencias = parseInt(audCheck.rows[0].count);

    if (countAudiencias > 0) {
      return res.status(400).json({ 
        erro: `Não é possível excluir o processo porque ele tem ${countAudiencias} audiência(s) associada(s).` 
      });
    }

    const auditoria = await pool.query(
      'SELECT id FROM processos WHERE escritorio_id = $1 AND status = \'excluido\' ORDER BY id ASC',
      [escritorioId]
    );

    if (auditoria.rows.length >= 10) {
      await pool.query('DELETE FROM processos WHERE id = $1', [auditoria.rows[0].id]);
      console.log(`Deletado processo antigo excluído ID ${auditoria.rows[0].id}`);
    }

    const updateResult = await pool.query(
      `UPDATE processos
       SET status = 'excluido', excluido_por = $1, data_exclusao = CURRENT_TIMESTAMP
       WHERE id = $2 AND escritorio_id = $3
       RETURNING id`,
      [operador, id, escritorioId]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ erro: 'Processo não encontrado' });
    }

    console.log(`Processo ${id} excluído com sucesso`);
    res.json({ ok: true });

  } catch (err) {
    console.error('❌ Erro ao excluir processo:', err.message);
    res.status(500).json({ erro: 'Erro interno ao excluir processo' });
  }
});

router.patch('/processos/:id/arquivar', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE processos SET status = $1 WHERE id = $2 AND escritorio_id = $3',
      ['arquivado', req.params.id, req.user.escritorio_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao arquivar:', err.message);
    res.status(500).json({ erro: 'Erro ao arquivar' });
  }
});

router.patch('/processos/:id/desarquivar', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE processos SET status = $1 WHERE id = $2 AND escritorio_id = $3',
      ['ativo', req.params.id, req.user.escritorio_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao desarquivar:', err.message);
    res.status(500).json({ erro: 'Erro ao desarquivar' });
  }
});

/**
 * ✅ ROTA CORRIGIDA: BUSCAR PROCESSOS DE UM CLIENTE
 * Agora busca processos onde o cliente está em QUALQUER polo (ativo OU passivo)
 * 
 * GET /api/por-cliente/:clienteId
 */
router.get('/por-cliente/:clienteId', authMiddleware, async (req, res) => {
  try {
    const { clienteId } = req.params;

    const query = `
      SELECT DISTINCT
        p.id, 
        p.numero, 
        p.uf, 
        p.instancia, 
        p.esfera, 
        p.tribunal,
        -- Cliente pode estar no polo ativo OU passivo
        pp_cliente.polo as polo_cliente,
        pp_cliente.tipo_parte as tipo_cliente,
        -- Exibir a parte CONTRÁRIA (se cliente for autor, exibir réu; se for réu, exibir autor)
        CASE 
          WHEN pp_cliente.polo = 'ativo' THEN 
            (SELECT pessoa_nome FROM partes_processo 
             WHERE processo_id = p.id AND polo = 'passivo' AND eh_principal = TRUE 
             LIMIT 1)
          ELSE 
            (SELECT pessoa_nome FROM partes_processo 
             WHERE processo_id = p.id AND polo = 'ativo' AND eh_principal = TRUE 
             LIMIT 1)
        END as parte_contraria
      FROM processos p
      INNER JOIN partes_processo pp_cliente 
        ON pp_cliente.processo_id = p.id 
        AND pp_cliente.pessoa_id = $2
      WHERE p.escritorio_id = $1
        AND p.status != 'excluido'
      ORDER BY p.id DESC
    `;

    const result = await pool.query(query, [req.user.escritorio_id, clienteId]);
    
    console.log(`📋 Encontrados ${result.rowCount} processos para o cliente ${clienteId}`);
    
    res.json(result.rows);

  } catch (err) {
    console.error('Erro ao buscar processos do cliente:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar processos do cliente' });
  }
});

module.exports = router;