const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios');
const authMiddleware = require('../middlewares/authMiddleware');

/**
 * ============================================================
 * 📡 ROTA DE SINCRONIZAÇÃO - VERSÃO CORRIGIDA FINAL
 * ✅ Endpoint correto: /sincronizar (sem /publicacoes)
 * ✅ POST (req.body)
 * ✅ Logs detalhados
 * ============================================================
 */
router.post('/sincronizar', authMiddleware, async (req, res) => {
  try {
    const escritorioId = req.user.escritorio_id;
    const { dataInicio, dataFim } = req.body;

    console.log('📄 [SYNC] Enviando solicitação ao WORKER DJEN...');
    console.log('📋 Escritório ID:', escritorioId);
    console.log('📅 Período:', dataInicio, 'até', dataFim);

    if (!process.env.WORKER_URL) {
      console.error('❌ WORKER_URL não configurada!');
      return res.status(500).json({
        ok: false,
        erro: 'WORKER_URL não configurada no servidor.'
      });
    }

    if (!process.env.WORKER_SECRET) {
      console.error('❌ WORKER_SECRET não configurada!');
      return res.status(500).json({
        ok: false,
        erro: 'WORKER_SECRET não configurada no servidor.'
      });
    }

    console.log('🔗 Worker URL:', process.env.WORKER_URL);

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

    console.log('👤 Advogado:', advogado_responsavel);
    console.log('🎓 OAB:', oab, '/', uf);

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

    console.log('✅ Worker DJEN executado com sucesso');
    console.log('📊 Resultado:', response.data);

    return res.json({
      ok: true,
      mensagem: `Sincronização concluída! ${response.data.resultado?.novas || 0} novas publicações encontradas.`,
      resultado_worker: response.data
    });

  } catch (err) {
    console.error('❌ Erro ao chamar worker DJEN:', err.message);
    
    if (err.code === 'ECONNREFUSED') {
      console.error('❌ Worker offline ou inacessível');
      return res.status(503).json({
        ok: false,
        erro: 'Worker DJEN está temporariamente indisponível.',
        detalhes: 'O servidor de sincronização não respondeu. Tente novamente em alguns minutos.'
      });
    }

    if (err.response) {
      console.error('❌ Resposta do worker:', err.response.status, err.response.data);
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
 * 📋 BUSCAR PUBLICAÇÕES PENDENTES
 * ============================================================
 */
router.get('/publicacoes-pendentes', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        
        const query = `
            SELECT 
                id, 
                numero_processo, 
                conteudo, 
                data_publicacao, 
                tribunal, 
                status
            FROM publicacoes 
            WHERE escritorio_id = $1 
            AND status = 'pendente' 
            ORDER BY data_publicacao DESC
            LIMIT 100`;

        const result = await pool.query(query, [escritorioId]);
        
        console.log(`📋 Retornando ${result.rows.length} publicações pendentes`);
        
        res.json(result.rows);
        
    } catch (err) {
        console.error("❌ Erro ao buscar publicações:", err.message);
        res.status(500).json({ erro: "Erro ao carregar publicações do banco." });
    }
});

/**
 * ============================================================
 * 🗑️ EXCLUIR PUBLICAÇÃO
 * ============================================================
 */
router.delete('/publicacoes/:id', authMiddleware, async (req, res) => {
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
        
        console.log(`✅ Publicação ${publicacaoId} excluída com sucesso`);
        
        res.json({ 
            ok: true, 
            mensagem: 'Publicação excluída com sucesso' 
        });
        
    } catch (err) {
        console.error('❌ Erro ao excluir publicação:', err.message);
        res.status(500).json({ erro: 'Erro ao excluir publicação' });
    }
});

/**
 * ============================================================
 * ⚡ CONVERTER PUBLICAÇÃO EM PRAZO
 * ============================================================
 */
router.post('/converter-publicacao', authMiddleware, async (req, res) => {
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
                `Processo: ${pub.numero_processo} | Prazo: ${dias} dias úteis | Gerado de publicação DJEN em ${pub.data_publicacao}`,
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
        console.error('❌ Erro ao converter publicação:', err.message);
        res.status(500).json({ erro: 'Erro ao criar prazo', detalhes: err.message });
    }
});

/**
 * ============================================================
 * 🧪 INSERIR PUBLICAÇÃO MANUAL
 * ============================================================
 */
router.post('/publicacoes/manual', authMiddleware, async (req, res) => {
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

        console.log(`✅ Publicação manual inserida: ${numero_processo}`);

        res.json({ ok: true, publicacao: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ erro: 'Esta publicação já existe' });
        }
        console.error('❌ Erro ao inserir publicação manual:', err.message);
        res.status(500).json({ erro: 'Erro ao inserir publicação' });
    }
});

module.exports = router;