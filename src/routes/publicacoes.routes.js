const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const logger = require('../utils/logger');

/**
 * ============================================================
 * 📡 ROTA DE SINCRONIZAÇÃO - VERSÃO CORRIGIDA FINAL
 * ✅ Endpoint correto: /sincronizar (sem /publicacoes)
 * ✅ POST (req.body)
 * ✅ Logs detalhados
 * ============================================================
 */
router.post('/sincronizar', authMiddleware, roleMiddleware('admin', 'operador'), async (req, res) => {
  try {
    const escritorioId = req.user.escritorio_id;
    const { dataInicio, dataFim } = req.body;

    logger.info({ escritorioId, dataInicio, dataFim }, 'Enviando solicitacao ao Worker DJEN');

    if (!process.env.WORKER_URL) {
      logger.error('WORKER_URL nao configurada');
      return res.status(500).json({
        ok: false,
        erro: 'WORKER_URL não configurada no servidor.'
      });
    }

    if (!process.env.WORKER_SECRET) {
      logger.error('WORKER_SECRET nao configurada');
      return res.status(500).json({
        ok: false,
        erro: 'WORKER_SECRET não configurada no servidor.'
      });
    }

    logger.info({ workerUrl: process.env.WORKER_URL }, 'Worker URL configurada');

    const escritorio = await pool.query(
      'SELECT oab, uf, advogado_responsavel FROM escritorios WHERE id = $1',
      [escritorioId]
    );

    if (escritorio.rowCount === 0) {
      return res.status(404).json({ ok: false, erro: 'Escritório não encontrado' });
    }

    let { oab, uf, advogado_responsavel } = escritorio.rows[0];

    // OAB SEM FORMATAÇÃO
    oab = oab ? oab.replace(/\D/g, '') : '';

    if (!uf) {
      const oabOriginal = escritorio.rows[0].oab || '';
      const match = oabOriginal.match(/\/([A-Z]{2})$/);
      uf = match ? match[1] : 'BA';
    }

    if (!oab || !uf) {
      return res.status(400).json({
        ok: false,
        erro: 'OAB não cadastrada. Configure sua OAB em Configurações.',
        sem_oab: true
      });
    }

    logger.info({ advogado: advogado_responsavel, oab, uf }, 'Dados do advogado para sincronizacao');

    // ✅ CHAMADA CORRETA AO WORKER
    const response = await axios.post(
      `${process.env.WORKER_URL}/worker/djen/sync`,
      {
        escritorio_id: escritorioId,
        advogado: advogado_responsavel,
        oab,
        uf,
        dataInicio,
        dataFim
      },
      {
        headers: {
          'x-worker-secret': process.env.WORKER_SECRET
        },
        timeout: 5 * 60 * 1000
      }
    );

    logger.info({ resultado: response.data }, 'Worker DJEN executado com sucesso');

    return res.json({
      ok: true,
      mensagem: `Sincronização concluída! ${response.data.resultado?.novas || 0} novas publicações encontradas.`,
      resultado_worker: response.data
    });

  } catch (err) {
    logger.error({ err: err.message }, 'Erro ao chamar worker DJEN');

    if (err.code === 'ECONNREFUSED') {
      logger.error('Worker DJEN offline ou inacessivel');
      return res.status(503).json({
        ok: false,
        erro: 'Worker DJEN está temporariamente indisponível.',
        detalhes: 'O servidor de sincronização não respondeu. Tente novamente em alguns minutos.'
      });
    }

    if (err.response) {
      logger.error({ status: err.response.status, data: err.response.data }, 'Resposta de erro do worker DJEN');
      return res.status(err.response.status).json({
        ok: false,
        erro: 'Erro no worker DJEN',
        detalhes: err.response.data
      });
    }

    return res.status(500).json({
      ok: false,
      erro: 'Erro ao sincronizar publicações via DJEN.',
      detalhes: err.message
    });
  }
});

/**
 * ============================================================
 * 📋 BUSCAR TODAS AS PUBLICAÇÕES
 * ============================================================
 */
router.get('/publicacoes-pendentes', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const { getPagination, buildPage } = require('../utils/paginate');
        const { page, limit, offset } = getPagination(req.query);

        const [result, countResult] = await Promise.all([
            pool.query(`
                SELECT
                    id,
                    numero_processo,
                    conteudo,
                    data_publicacao,
                    tribunal,
                    status
                FROM publicacoes
                WHERE escritorio_id = $1
                ORDER BY data_publicacao DESC
                LIMIT $2 OFFSET $3
            `, [escritorioId, limit, offset]),
            pool.query('SELECT COUNT(*) AS total FROM publicacoes WHERE escritorio_id = $1', [escritorioId])
        ]);

        const total = parseInt(countResult.rows[0].total);
        logger.info({ count: result.rows.length, page }, 'Publicacoes retornadas');

        res.json(buildPage(result.rows, total, page, limit));

    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao buscar publicacoes');
        res.status(500).json({ erro: "Erro ao carregar publicações do banco." });
    }
});

/**
 * ============================================================
 * 🗑️ EXCLUIR PUBLICAÇÃO
 * ============================================================
 */
router.delete('/publicacoes/:id', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    try {
        const publicacaoId = req.params.id;
        const escritorioId = req.user.escritorio_id;
        
        const result = await pool.query(
            'DELETE FROM publicacoes WHERE id = $1 AND escritorio_id = $2 RETURNING *',
            [publicacaoId, escritorioId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ erro: 'Publicação não encontrada' });
        }
        
        logger.info({ publicacaoId }, 'Publicacao excluida com sucesso');

        res.json({
            ok: true,
            mensagem: 'Publicação excluída com sucesso'
        });

    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao excluir publicacao');
        res.status(500).json({ erro: 'Erro ao excluir publicação' });
    }
});

/**
 * ============================================================
 * ⚡ CONVERTER PUBLICAÇÃO EM PRAZO
 * ============================================================
 */
router.post('/converter-publicacao', authMiddleware, roleMiddleware('admin', 'operador'), async (req, res) => {
    const { id_publicacao, tipo, dias, dataCalculada } = req.body;
    const escritorioId = req.user.escritorio_id;
    const usuarioId = req.user.id;

    try {
        const pubRes = await pool.query(
            'SELECT * FROM publicacoes WHERE id = $1 AND escritorio_id = $2',
            [id_publicacao, escritorioId]
        );

        if (pubRes.rowCount === 0) {
            return res.status(404).json({ erro: 'Publicação não encontrada' });
        }

        const pub = pubRes.rows[0];

        let processoId = null;
        let clienteId = null;
        
        const processoExistente = await pool.query(
            'SELECT id, cliente_id FROM processos WHERE numero = $1 AND escritorio_id = $2',
            [pub.numero_processo, escritorioId]
        );

        if (processoExistente.rowCount > 0) {
            processoId = processoExistente.rows[0].id;
            clienteId = processoExistente.rows[0].cliente_id;
        } else {
            const novoProcesso = await pool.query(
                `INSERT INTO processos (numero, escritorio_id, usuario_id, status) 
                 VALUES ($1, $2, $3, 'ativo') 
                 RETURNING id`,
                [pub.numero_processo, escritorioId, usuarioId]
            );
            processoId = novoProcesso.rows[0].id;
        }

        const prazoRes = await pool.query(
            `INSERT INTO prazos 
             (tipo, processo_id, cliente_id, descricao, data_limite, status, escritorio_id, usuario_id, deletado, created_at) 
             VALUES ($1, $2, $3, $4, $5, 'aberto', $6, $7, false, NOW())
             RETURNING *`,
            [
                tipo,
                processoId,
                clienteId,
                `Processo: ${pub.numero_processo} | ${dias ? `Prazo: ${dias} dias úteis | ` : ''}Gerado de publicação DJEN em ${pub.data_publicacao}`,
                dataCalculada,
                escritorioId,
                usuarioId
            ]
        );

        await pool.query(
            "UPDATE publicacoes SET status = 'convertida' WHERE id = $1",
            [id_publicacao]
        );

        res.json({ 
            ok: true, 
            mensagem: 'Prazo criado com sucesso!',
            prazo: prazoRes.rows[0]
        });

    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao converter publicacao em prazo');
        res.status(500).json({ erro: 'Erro ao criar prazo' });
    }
});

/**
 * ============================================================
 * 🧪 INSERIR PUBLICAÇÃO MANUAL
 * ============================================================
 */
router.post('/publicacoes/manual', authMiddleware, roleMiddleware('admin', 'operador'), async (req, res) => {
    try {
        const { numero_processo, conteudo, data_publicacao, tribunal } = req.body;
        const escritorioId = req.user.escritorio_id;

        if (!numero_processo || !conteudo) {
            return res.status(400).json({ erro: 'Campos obrigatórios: numero_processo e conteudo' });
        }

        const result = await pool.query(
            `INSERT INTO publicacoes 
             (numero_processo, conteudo, data_publicacao, tribunal, escritorio_id, status) 
             VALUES ($1, $2, $3, $4, $5, 'pendente')
             RETURNING *`,
            [
                numero_processo,
                conteudo,
                data_publicacao || new Date().toISOString().split('T')[0],
                tribunal || 'DJEN',
                escritorioId
            ]
        );

        logger.info({ numero_processo }, 'Publicacao manual inserida');

        res.json({ ok: true, publicacao: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ erro: 'Esta publicação já existe' });
        }
        logger.error({ err: err.message }, 'Erro ao inserir publicacao manual');
        res.status(500).json({ erro: 'Erro ao inserir publicação' });
    }
});

/**
 * ============================================================
 * 🔄 ATUALIZAR STATUS DA PUBLICAÇÃO
 * ============================================================
 */
router.patch('/publicacoes/:id/status', authMiddleware, roleMiddleware('admin', 'operador'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const escritorioId = req.user.escritorio_id;

        logger.info({ id, status, escritorioId }, 'Atualizando status de publicacao');

        if (!['pendente', 'convertida', 'descartada'].includes(status)) {
            logger.error({ status }, 'Status invalido para publicacao');
            return res.status(400).json({ 
                ok: false, 
                erro: 'Status inválido. Use: pendente, convertida ou descartada' 
            });
        }

        const result = await pool.query(
            `UPDATE publicacoes 
             SET status = $1 
             WHERE id = $2 AND escritorio_id = $3
             RETURNING *`,
            [status, id, escritorioId]
        );

        if (result.rowCount === 0) {
            logger.error({ id, escritorioId }, 'Publicacao nao encontrada ou nao pertence ao escritorio');
            return res.status(404).json({ 
                ok: false, 
                erro: 'Publicação não encontrada' 
            });
        }

        logger.info({ id, status }, 'Status de publicacao atualizado com sucesso');

        // Manter apenas as 10 últimas descartadas — remover as mais antigas
        if (status === 'descartada') {
            await pool.query(`
                DELETE FROM publicacoes
                WHERE escritorio_id = $1
                  AND status = 'descartada'
                  AND id NOT IN (
                    SELECT id FROM publicacoes
                    WHERE escritorio_id = $1 AND status = 'descartada'
                    ORDER BY data_publicacao DESC
                    LIMIT 10
                  )
            `, [escritorioId]);
        }

        res.json({
            ok: true,
            publicacao: result.rows[0]
        });
    } catch (err) {
        logger.error({ err: err.message, code: err.code }, 'Erro ao atualizar status de publicacao');
        
        res.status(500).json({ 
            ok: false, 
            erro: 'Erro ao atualizar status',
            detalhe: err.message
        });
    }
});

/**
 * ============================================================
 * 🗑️ LISTAR PUBLICAÇÕES DESCARTADAS (últimas 10)
 * ============================================================
 */
router.get('/publicacoes-descartadas', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const result = await pool.query(`
            SELECT id, numero_processo, conteudo, data_publicacao, tribunal, status
            FROM publicacoes
            WHERE escritorio_id = $1 AND status = 'descartada'
            ORDER BY data_publicacao DESC
            LIMIT 10
        `, [escritorioId]);
        res.json({ ok: true, data: result.rows });
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao buscar descartadas');
        res.status(500).json({ ok: false, erro: 'Erro ao buscar publicações descartadas' });
    }
});

module.exports = router;