const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // Conexão com o banco
const authMiddleware = require('../middlewares/authMiddleware');

// Importando as funções do Controller que estavam faltando
const { 
    criarPrazo, 
    listarPrazosVencidos, 
    listarPrazosSemana, 
    listarPrazosFuturos, 
    listarPrazosConcluidos, 
    concluirPrazo,
    excluirPrazo,
    atualizarPrazo,
    planoEConsumo
    
    } = require('../controllers/prazosController');

// ============================
// PUBLICAÇÕES DJEN
// ============================

// Rota para listar publicações capturadas do DJEN na tela publicacoes.html
router.get('/publicacoes-pendentes', authMiddleware, async (req, res) => {
    try {
        // Buscamos apenas as do usuário logado
        const result = await pool.query(
            "SELECT * FROM publicacoes_djen WHERE status = 'pendente' AND usuario_id = $1 ORDER BY data_publicacao DESC",
            [req.user.id]
        );
        
        // Forçamos o retorno de um array, mesmo vazio
        return res.json(result.rows || []);
    } catch (err) {
        console.error("Erro na rota DJEN:", err.message);
        // Retornamos array vazio para o frontend não travar a tela
        return res.json([]); 
    }
});

// Rota para converter publicação em prazo real
router.post('/converter-publicacao', authMiddleware, async (req, res) => {
    // Recebemos agora a dataCalculada vinda do seu novo código no frontend
    const { id_publicacao, tipo, dataCalculada } = req.body;

    try {
        const pub = await pool.query('SELECT * FROM publicacoes_djen WHERE id = $1', [id_publicacao]);
        if (pub.rowCount === 0) return res.status(404).send('Publicação não encontrada');

        const numProcesso = pub.rows[0].processo_numero;
        const procResult = await pool.query(
            'SELECT id FROM processos WHERE numero = $1 AND escritorio_id = $2',
            [numProcesso, req.user.escritorio_id] // Alterado para buscar por escritorio_id
        );

        if (procResult.rowCount === 0) {
            return res.status(400).json({ 
                error: `O processo ${numProcesso} não está cadastrado. Cadastre-o na tela de Processos primeiro.` 
            });
        }

        const processoId = procResult.rows[0].id;

        // Inserimos o prazo com a data calculada (Dias Úteis) enviada pelo frontend
        await pool.query(`
            INSERT INTO prazos (usuario_id, processo_id, tipo, data_limite, status)
            VALUES ($1, $2, $3, $4, 'aberto')
        `, [req.user.id, processoId, tipo, dataCalculada]);

        await pool.query("UPDATE publicacoes_djen SET status = 'convertido' WHERE id = $1", [id_publicacao]);

        res.status(200).json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ============================
// GESTÃO DE PRAZOS (Controller)
// ============================

router.post('/prazos', authMiddleware, criarPrazo);

router.get('/dashboard/prazos-vencidos', authMiddleware, listarPrazosVencidos);
router.get('/dashboard/prazos-semana', authMiddleware, listarPrazosSemana);
router.get('/dashboard/prazos-futuros', authMiddleware, listarPrazosFuturos);
router.get('/prazos-concluidos', authMiddleware, listarPrazosConcluidos);

router.post('/prazos/:id/concluir', authMiddleware, concluirPrazo);
router.put('/prazos/:id', authMiddleware, atualizarPrazo);
router.delete('/prazos/:id', authMiddleware, excluirPrazo);

// ============================
// PLANO & CONSUMO
// ============================

router.get('/plano-consumo', authMiddleware, planoEConsumo);

// Exportação única ao final do arquivo
module.exports = router;