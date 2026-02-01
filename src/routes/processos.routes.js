const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');

/**
 * 1. CADASTRAR NOVO PROCESSO
 * Caminho final: /api/processos (POST)
 */
router.post('/processos', authMiddleware, async (req, res) => {
  const dadosRecebidos = req.body;

  // Logs para debug (remova depois de testar)
  console.log('🚀 POST /api/processos - Dados recebidos do front:', dadosRecebidos);
  console.log('Esfera recebida:', dadosRecebidos.esfera);
  console.log('Tribunal recebido:', dadosRecebidos.tribunal);

  let {
    numero,
    cliente,
    uf,
    instancia,
    cliente_id,
    parte_contraria,
    esfera,
    tribunal
  } = dadosRecebidos;

  // Normalização defensiva
  esfera = (esfera || '').trim();
  tribunal = (tribunal || '').trim();

  // Validação mínima
  if (!numero) {
    return res.status(400).json({ erro: 'Número do processo é obrigatório' });
  }
  if (!esfera || !tribunal) {
    console.warn('Aviso: esfera ou tribunal não foram enviados ou estão vazios');
    // Descomente se quiser tornar obrigatório:
    // return res.status(400).json({ erro: 'Esfera e tribunal são obrigatórios' });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO processos (
        numero, cliente, uf, instancia,
        usuario_id, escritorio_id, cliente_id,
        parte_contraria, esfera, tribunal, status
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8,
        $9,
        $10,
        'ativo'
      )
      RETURNING *
      `,
      [
        numero,
        cliente,
        uf,
        instancia,
        req.user.id,
        req.user.escritorio_id,
        cliente_id,
        parte_contraria,
        esfera,
        tribunal
      ]
    );

    console.log('✅ Processo salvo com sucesso:', result.rows[0]);

    res.status(201).json({
      ok: true,
      processo: result.rows[0]
    });
  } catch (err) {
    console.error('❌ Erro ao salvar processo:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ erro: 'Erro interno ao salvar processo', detalhe: err.message });
  }
});

/**
 * VERIFICA SE JÁ EXISTE PROCESSO COM O MESMO NÚMERO NO ESCRITÓRIO
 * GET /api/processos/existe/:numero
 */
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

/**
 * 2. LISTAR PROCESSOS
 * Caminho final: /api/processos (GET)
 */
router.get('/processos', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        id,
        numero,
        cliente,
        parte_contraria,
        esfera,
        tribunal,
        instancia,
        uf,
        status,
        excluido_por,
        data_exclusao
      FROM processos
      WHERE escritorio_id = $1
      ORDER BY id DESC
      `,
      [req.user.escritorio_id]
    );

    console.log(`📋 Listados ${result.rowCount} processos para escritório ${req.user.escritorio_id}`);

    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao listar processos:', err.message);
    res.status(500).json({ erro: 'Erro ao listar processos' });
  }
});

/**
 * EXCLUSÃO COM AUDITORIA (PATCH /processos/:id/excluir)
 */
router.patch('/processos/:id/excluir', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const escritorioId = req.user?.escritorio_id;
  const operador = req.user?.nome || req.user?.email || 'Usuário desconhecido';

  console.log(`Tentando excluir processo ID ${id} por usuário ${operador} (escritorio ${escritorioId})`);

  if (!req.user || !escritorioId) {
    console.error('Usuário ou escritorio_id não encontrado');
    return res.status(401).json({ erro: 'Autenticação inválida' });
  }

  try {
    // Verifica se tem audiências associadas
    const audCheck = await pool.query(
      'SELECT COUNT(*) FROM audiencias WHERE processo_id = $1',
      [id]
    );

    const countAudiencias = parseInt(audCheck.rows[0].count);

    if (countAudiencias > 0) {
      console.warn(`Bloqueado exclusão: processo ${id} tem ${countAudiencias} audiência(s)`);
      return res.status(400).json({ 
        erro: `Não é possível excluir o processo porque ele tem ${countAudiencias} audiência(s) associada(s). Exclua as audiências primeiro ou arquive o processo.` 
      });
    }

    // Limpeza circular (só prosseguir se não tiver audiência)
    const auditoria = await pool.query(
      'SELECT id FROM processos WHERE escritorio_id = $1 AND status = \'excluido\' ORDER BY id ASC',
      [escritorioId]
    );

    if (auditoria.rows.length >= 10) {
      await pool.query('DELETE FROM processos WHERE id = $1', [auditoria.rows[0].id]);
      console.log(`Deletado processo antigo excluído ID ${auditoria.rows[0].id}`);
    }

    const updateResult = await pool.query(
      `
      UPDATE processos
      SET 
        status = 'excluido',
        excluido_por = $1,
        data_exclusao = CURRENT_TIMESTAMP
      WHERE id = $2 AND escritorio_id = $3
      RETURNING id, excluido_por, data_exclusao
      `,
      [operador, id, escritorioId]
    );

    if (updateResult.rowCount === 0) {
      console.warn(`Nenhum processo encontrado para exclusão: ID ${id}`);
      return res.status(404).json({ erro: 'Processo não encontrado ou sem permissão' });
    }

    console.log(`Processo ${id} excluído com sucesso por ${operador}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Erro ao excluir processo:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ erro: 'Erro interno ao excluir processo', detalhe: err.message });
  }
});

/**
 * 4. ARQUIVAR PROCESSO
 * Caminho final: /api/processos/:id/arquivar (PATCH)
 */
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

/**
 * 5. DESARQUIVAR PROCESSO
 * Caminho final: /api/processos/:id/desarquivar (PATCH)
 */
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
 * 6. PROCESSOS POR CLIENTE
 * Caminho final: /api/por-cliente/:clienteId (GET)
 */
router.get('/por-cliente/:clienteId', authMiddleware, async (req, res) => {
  try {
    const { clienteId } = req.params;

    const query = `
      SELECT 
        id, numero, uf, instancia, parte_contraria, esfera, tribunal
      FROM processos
      WHERE escritorio_id = $1
        AND (cliente_id = $2 OR cliente = (SELECT nome FROM clientes WHERE id = $2))
      ORDER BY id DESC
    `;

    const result = await pool.query(query, [req.user.escritorio_id, clienteId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar processos do cliente:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar processos do cliente' });
  }
});

/**
 * ✅ ATUALIZAR DADOS DO PROCESSO
 * PUT /api/processos/:id
 */
router.put('/processos/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { cliente_id, parte_contraria, esfera, tribunal, instancia, uf } = req.body;
    const escritorioId = req.user.escritorio_id;

    console.log(`📝 Atualizando processo ${id}:`, req.body);

    // Validações
    if (!cliente_id) {
        return res.status(400).json({ erro: 'Cliente é obrigatório' });
    }
    if (!esfera || !tribunal || !instancia || !uf) {
        return res.status(400).json({ erro: 'Esfera, Tribunal, Instância e UF são obrigatórios' });
    }

    try {
        // Buscar nome do cliente
        const clienteRes = await pool.query(
            'SELECT nome FROM clientes WHERE id = $1 AND escritorio_id = $2',
            [cliente_id, escritorioId]
        );

        if (clienteRes.rowCount === 0) {
            return res.status(404).json({ erro: 'Cliente não encontrado' });
        }

        const clienteNome = clienteRes.rows[0].nome;

        // Atualizar processo
        const result = await pool.query(
            `UPDATE processos 
             SET cliente_id = $1,
                 cliente = $2,
                 parte_contraria = $3,
                 esfera = $4,
                 tribunal = $5,
                 instancia = $6,
                 uf = $7
             WHERE id = $8 
             AND escritorio_id = $9
             RETURNING *`,
            [
                cliente_id,
                clienteNome,
                parte_contraria || null,
                esfera,
                tribunal,
                instancia,
                uf,
                id,
                escritorioId
            ]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ erro: 'Processo não encontrado' });
        }

        console.log(`✅ Processo ${id} atualizado com sucesso`);

        res.json({ 
            ok: true, 
            mensagem: 'Processo atualizado com sucesso',
            processo: result.rows[0]
        });

    } catch (err) {
        console.error('❌ Erro ao atualizar processo:', err.message);
        res.status(500).json({ 
            erro: 'Erro ao atualizar processo',
            detalhes: err.message 
        });
    }
});

module.exports = router;