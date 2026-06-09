const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const logger = require('../utils/logger');
const { getPagination, buildPage } = require('../utils/paginate');
const { checkLimit } = require('../middlewares/planMiddleware');

// Valida que :id é um inteiro em todas as rotas deste router
router.param('id', (req, res, next, val) => {
  const id = parseInt(val, 10);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });
  req.params.id = id;
  next();
});

/**
 * CONTAGEM DE PROCESSOS COM ANDAMENTOS NÃO VISTOS
 * GET /api/processos/novos-andamentos
 * Retorna o número de processos que têm pelo menos 1 andamento com visto=false.
 */
router.get('/processos/novos-andamentos', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(DISTINCT processo_id)::int AS total
       FROM andamentos_processuais
       WHERE escritorio_id = $1 AND NOT COALESCE(visto, true)`,
      [req.user.escritorio_id]
    );
    res.json({ ok: true, total: result.rows[0].total });
  } catch (err) {
    // Se coluna visto ainda não existe, retorna 0 sem erro
    res.json({ ok: true, total: 0 });
  }
});

/**
 * EXPORTAR PROCESSOS EM CSV
 * GET /api/processos/exportar
 */
router.get('/processos/exportar', authMiddleware, async (req, res) => {
  try {
    const escritorioId = req.user.escritorio_id;
    const { status, busca, ufs } = req.query;
    const conditions = ['p.escritorio_id = $1'];
    const params = [escritorioId];
    let idx = 2;

    if (status) {
      conditions.push(`p.status = $${idx++}`);
      params.push(status);
    }

    if (busca && busca.trim()) {
      const termo = '%' + busca.trim().toLowerCase() + '%';
      conditions.push(`(LOWER(p.numero) LIKE $${idx} OR EXISTS (
        SELECT 1 FROM partes_processo pp_busca
        WHERE pp_busca.processo_id = p.id
          AND LOWER(pp_busca.pessoa_nome) LIKE $${idx}
      ))`);
      params.push(termo);
      idx++;
    }

    if (ufs && ufs.trim()) {
      const lista = ufs.split(',').map(u => u.trim().toUpperCase()).filter(Boolean);
      if (lista.length > 0) {
        const placeholders = lista.map((_, i) => `$${idx + i}`).join(', ');
        conditions.push(`p.uf IN (${placeholders})`);
        params.push(...lista);
      }
    }

    const result = await pool.query(
      `SELECT
         p.numero,
         COALESCE(partes.ativo, p.cliente, '') AS polo_ativo,
         COALESCE(partes.passivo, p.parte_contraria, '') AS polo_passivo,
         p.esfera,
         p.tribunal,
         p.instancia,
         p.uf,
         p.status
       FROM processos p
       LEFT JOIN LATERAL (
         SELECT
           STRING_AGG(pp.pessoa_nome, ' | ' ORDER BY pp.eh_principal DESC, pp.id)
             FILTER (WHERE pp.polo = 'ativo') AS ativo,
           STRING_AGG(pp.pessoa_nome, ' | ' ORDER BY pp.eh_principal DESC, pp.id)
             FILTER (WHERE pp.polo = 'passivo') AS passivo
         FROM partes_processo pp
         WHERE pp.processo_id = p.id
       ) partes ON TRUE
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.id DESC`,
      params
    );

    const protegerFormula = (valor) => {
      const texto = valor == null ? '' : String(valor);
      return /^[=+\-@]/.test(texto) ? "'" + texto : texto;
    };
    const escaparCsv = (valor) => `"${protegerFormula(valor).replace(/"/g, '""')}"`;
    const cabecalho = [
      'Numero do processo',
      'Polo ativo',
      'Polo passivo',
      'Esfera',
      'Tribunal',
      'Instancia',
      'UF',
      'Status'
    ];
    const linhas = result.rows.map(processo => [
      processo.numero,
      processo.polo_ativo,
      processo.polo_passivo,
      processo.esfera,
      processo.tribunal,
      processo.instancia,
      processo.uf,
      processo.status
    ].map(escaparCsv).join(';'));

    const csv = '\uFEFF' + [cabecalho.map(escaparCsv).join(';'), ...linhas].join('\r\n');
    const data = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="processos-${data}.csv"`);
    res.send(csv);
  } catch (err) {
    logger.error({ err: err.message }, 'Erro ao exportar processos');
    res.status(500).json({ erro: 'Erro ao exportar processos' });
  }
});

/**
 * CADASTRAR NOVO PROCESSO (COM MÚLTIPLAS PARTES)
 * POST /api/processos
 */
router.post('/processos', authMiddleware, roleMiddleware('admin', 'operador'), checkLimit('processos'), async (req, res) => {
  const dadosRecebidos = req.body;

  logger.info({ dadosRecebidos }, 'POST /api/processos - Dados recebidos');

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
    logger.warn('Aviso: esfera ou tribunal não enviados');
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
    logger.info({ processoId }, 'Processo criado');

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

    logger.info({ processoId }, 'Processo e partes salvos com sucesso');

    res.status(201).json({
      ok: true,
      processo: processoResult.rows[0]
    });

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err: err.message }, 'Erro ao salvar processo');
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
    const { page, limit, offset } = getPagination(req.query);
    const escritorioId = req.user.escritorio_id;
    const { status, busca, ufs } = req.query;

    // Monta WHERE dinâmico
    const conditions = ['p.escritorio_id = $1'];
    const params = [escritorioId];
    let idx = 2;

    if (status) {
      conditions.push(`p.status = $${idx++}`);
      params.push(status);
    }

    if (busca && busca.trim()) {
      const termo = '%' + busca.trim().toLowerCase() + '%';
      conditions.push(`(LOWER(p.numero) LIKE $${idx} OR EXISTS (
        SELECT 1 FROM partes_processo pp
        WHERE pp.processo_id = p.id AND LOWER(pp.pessoa_nome) LIKE $${idx}
      ))`);
      params.push(termo);
      idx++;
    }

    // ufs: lista separada por vírgula ex: "SP,RJ,MG" (filtro por região/estado)
    if (ufs && ufs.trim()) {
      const lista = ufs.split(',').map(u => u.trim().toUpperCase()).filter(Boolean);
      if (lista.length > 0) {
        const placeholders = lista.map((_, i) => `$${idx + i}`).join(', ');
        conditions.push(`p.uf IN (${placeholders})`);
        params.push(...lista);
        idx += lista.length;
      }
    }

    const whereClause = conditions.join(' AND ');
    const countParams = [...params];
    params.push(limit, offset);
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const baseSelect = (comNovos) => `
        SELECT
          p.id, p.numero, p.esfera, p.tribunal, p.instancia, p.uf, p.status,
          p.excluido_por, p.data_exclusao,
          pp_ativo.pessoa_nome   AS cliente,
          pp_ativo.pessoa_id     AS cliente_id,
          pp_passivo.pessoa_nome AS parte_contraria,
          COALESCE(cnt_ativo.total,   0) AS total_autores,
          COALESCE(cnt_passivo.total, 0) AS total_reus
          ${comNovos ? ', COALESCE(cnt_novos.total, 0) AS andamentos_novos' : ', 0 AS andamentos_novos'}
        FROM processos p
        LEFT JOIN LATERAL (
          SELECT pessoa_nome, pessoa_id
          FROM partes_processo
          WHERE processo_id = p.id AND polo = 'ativo' AND eh_principal = TRUE
          ORDER BY id LIMIT 1
        ) pp_ativo ON TRUE
        LEFT JOIN LATERAL (
          SELECT pessoa_nome
          FROM partes_processo
          WHERE processo_id = p.id AND polo = 'passivo' AND eh_principal = TRUE
          ORDER BY id LIMIT 1
        ) pp_passivo ON TRUE
        LEFT JOIN (
          SELECT processo_id, COUNT(*) AS total
          FROM partes_processo WHERE polo = 'ativo'
          GROUP BY processo_id
        ) cnt_ativo ON cnt_ativo.processo_id = p.id
        LEFT JOIN (
          SELECT processo_id, COUNT(*) AS total
          FROM partes_processo WHERE polo = 'passivo'
          GROUP BY processo_id
        ) cnt_passivo ON cnt_passivo.processo_id = p.id
        ${comNovos ? `LEFT JOIN (
          SELECT processo_id, COUNT(*) AS total
          FROM andamentos_processuais WHERE visto = false
          GROUP BY processo_id
        ) cnt_novos ON cnt_novos.processo_id = p.id` : ''}
        WHERE ${whereClause}
        ORDER BY p.id DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;

    let result;
    try {
      result = await pool.query(baseSelect(true), params);
    } catch (err) {
      // Coluna visto ainda não existe (migration pendente) — usa query sem badge
      if (err.code === '42703') {
        result = await pool.query(baseSelect(false), params);
      } else {
        throw err;
      }
    }

    const [countResult, metricasResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS total FROM processos p WHERE ${whereClause}`,
        countParams
      ),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'ativo')     AS ativos,
          COUNT(*) FILTER (WHERE status = 'arquivado') AS arquivados,
          COUNT(*) FILTER (WHERE status = 'excluido')  AS excluidos,
          COUNT(*)                                      AS total_geral,
          COUNT(DISTINCT tribunal)                      AS tribunais
        FROM processos WHERE escritorio_id = $1
      `, [escritorioId])
    ]);

    const total = parseInt(countResult.rows[0].total);
    const metricas = metricasResult.rows[0];
    const pagina = buildPage(result.rows, total, page, limit);
    pagina.metricas = {
      total:      parseInt(metricas.total_geral),
      ativos:     parseInt(metricas.ativos),
      arquivados: parseInt(metricas.arquivados),
      excluidos:  parseInt(metricas.excluidos),
      tribunais:  parseInt(metricas.tribunais)
    };

    logger.info({ count: result.rowCount, page, busca, ufs }, 'Processos listados');
    res.json(pagina);

  } catch (err) {
    logger.error({ err: err.message }, 'Erro ao listar processos');
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
    logger.error({ err: err.message }, 'Erro ao buscar processo');
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
    logger.error({ err: err.message }, 'Erro ao listar partes');
    res.status(500).json({ erro: 'Erro ao carregar partes' });
  }
});

/**
 * ATUALIZAR PROCESSO (COM PARTES)
 * PUT /api/processos/:id
 */
router.put('/processos/:id', authMiddleware, roleMiddleware('admin', 'operador'), async (req, res) => {
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

        logger.info({ id }, 'Processo atualizado com sucesso');

        res.json({ 
            ok: true, 
            mensagem: 'Processo atualizado com sucesso'
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err: err.message }, 'Erro ao atualizar processo');
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
    logger.error({ err: err.message }, 'Erro ao verificar duplicidade');
    res.status(500).json({ erro: 'Erro ao verificar processo' });
  }
});

router.patch('/processos/:id/excluir', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  const { id } = req.params;
  const escritorioId = req.user?.escritorio_id;
  const operador = req.user?.nome || req.user?.email || 'Usuário desconhecido';

  logger.info({ id, operador }, 'Tentando excluir processo');

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
      logger.info({ id: auditoria.rows[0].id }, 'Deletado processo antigo excluido');
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

    logger.info({ id }, 'Processo excluido com sucesso');
    res.json({ ok: true });

  } catch (err) {
    logger.error({ err: err.message }, 'Erro ao excluir processo');
    res.status(500).json({ erro: 'Erro interno ao excluir processo' });
  }
});

router.patch('/processos/:id/arquivar', authMiddleware, roleMiddleware('admin', 'operador'), async (req, res) => {
  try {
    await pool.query(
      'UPDATE processos SET status = $1 WHERE id = $2 AND escritorio_id = $3',
      ['arquivado', req.params.id, req.user.escritorio_id]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err.message }, 'Erro ao arquivar processo');
    res.status(500).json({ erro: 'Erro ao arquivar' });
  }
});

router.patch('/processos/:id/desarquivar', authMiddleware, roleMiddleware('admin', 'operador'), async (req, res) => {
  try {
    await pool.query(
      'UPDATE processos SET status = $1 WHERE id = $2 AND escritorio_id = $3',
      ['ativo', req.params.id, req.user.escritorio_id]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err.message }, 'Erro ao desarquivar processo');
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
    
    logger.info({ count: result.rowCount, clienteId }, 'Processos do cliente listados');
    
    res.json(result.rows);

  } catch (err) {
    logger.error({ err: err.message }, 'Erro ao buscar processos do cliente');
    res.status(500).json({ erro: 'Erro ao buscar processos do cliente' });
  }
});

/**
 * VERIFICAR CONFLITO DE INTERESSES
 * POST /api/processos/verificar-conflito
 *
 * Verifica nos dois sentidos:
 *  - "polo_verificar: passivo" → a pessoa que vai entrar como réu já é cliente ativo em outro processo?
 *  - "polo_verificar: ativo"  → a pessoa que vai virar cliente já é parte adversa em algum processo ativo?
 */
router.post('/processos/verificar-conflito', authMiddleware, async (req, res) => {
    try {
        const { nome, documento, polo_verificar = 'passivo' } = req.body;
        const escritorioId = req.user.escritorio_id;

        if (!nome && !documento) {
            return res.status(400).json({ erro: 'Informe nome ou documento' });
        }

        // polo que queremos encontrar nos processos existentes
        const poloExistente = polo_verificar === 'passivo' ? 'ativo' : 'passivo';

        const result = await pool.query(
            `SELECT DISTINCT
                p.id,
                p.numero,
                p.status,
                p.esfera,
                pp_match.pessoa_nome  AS nome_encontrado,
                pp_match.polo         AS polo_encontrado,
                -- cliente principal do processo
                (SELECT pessoa_nome FROM partes_processo
                 WHERE processo_id = p.id AND polo = 'ativo' AND eh_principal = TRUE LIMIT 1
                ) AS cliente_processo
             FROM partes_processo pp_match
             JOIN processos p ON p.id = pp_match.processo_id
             WHERE p.escritorio_id = $1
               AND p.status NOT IN ('encerrado', 'excluido', 'arquivado')
               AND pp_match.polo = $2
               AND (
                   ($3::text IS NOT NULL AND pp_match.pessoa_nome ILIKE $3)
                   OR
                   ($4::text IS NOT NULL AND pp_match.pessoa_id IN (
                       SELECT id FROM clientes
                       WHERE documento = $4 AND escritorio_id = $1
                   ))
               )
             ORDER BY p.id DESC
             LIMIT 5`,
            [
                escritorioId,
                poloExistente,
                nome   ? `%${nome.trim()}%` : null,
                documento ? documento.replace(/\D/g, '') || null : null
            ]
        );

        const conflitos = result.rows;
        res.json({
            conflito: conflitos.length > 0,
            processos: conflitos.map(c => ({
                id:              c.id,
                numero:          c.numero,
                status:          c.status,
                esfera:          c.esfera,
                nome_encontrado: c.nome_encontrado,
                cliente:         c.cliente_processo
            }))
        });

    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao verificar conflito de interesses');
        res.status(500).json({ erro: 'Erro ao verificar conflito de interesses' });
    }
});

/**
 * SINCRONIZAÇÃO DATAJUD INDIVIDUAL
 * POST /api/processos/:id/sincronizar-datajud
 * Busca e importa movimentos de um único processo no DataJud.
 */
router.post('/processos/:id/sincronizar-datajud', authMiddleware, async (req, res) => {
  const escritorioId = req.user.escritorio_id;

  try {
    const { rows } = await pool.query(
      `SELECT id, numero FROM processos WHERE id = $1 AND escritorio_id = $2 AND status = 'ativo'`,
      [req.params.id, escritorioId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, erro: 'Processo não encontrado ou não está ativo.' });
    }

    const processo = rows[0];

    if (!processo.numero) {
      return res.status(400).json({ ok: false, erro: 'Processo sem número CNJ cadastrado.' });
    }

    const { buscarMovimentos } = require('../services/datajudService');
    const movimentos = await buscarMovimentos(processo.numero);

    if (!movimentos || movimentos.length === 0) {
      return res.json({ ok: true, inseridos: 0, mensagem: 'Nenhum movimento encontrado no DataJud para este processo.' });
    }

    let inseridos = 0;
    for (const mov of movimentos) {
      const dup = await pool.query(
        `SELECT id FROM andamentos_processuais
         WHERE processo_id = $1 AND fonte = 'datajud' AND data_andamento = $2 AND titulo = $3`,
        [processo.id, mov.data, mov.titulo]
      );
      if (dup.rows.length > 0) continue;

      await pool.query(
        `INSERT INTO andamentos_processuais
           (processo_id, escritorio_id, data_andamento, tipo, titulo, descricao, visivel_cliente, fonte, visto)
         VALUES ($1, $2, $3, $4, $5, $6, true, 'datajud', false)`,
        [processo.id, escritorioId, mov.data, mov.tipo, mov.titulo, mov.descricao]
      );
      inseridos++;
    }

    logger.info({ processo_id: processo.id, inseridos }, '[DataJud] Sincronização individual concluída');
    res.json({ ok: true, inseridos, mensagem: inseridos > 0 ? `${inseridos} andamento(s) importado(s).` : 'Processo já está atualizado.' });

  } catch (err) {
    logger.error({ err: err.message, processo_id: req.params.id }, '[DataJud] Erro na sincronização individual');
    res.status(500).json({ ok: false, erro: 'Erro ao sincronizar com o DataJud.' });
  }
});

module.exports = router;
