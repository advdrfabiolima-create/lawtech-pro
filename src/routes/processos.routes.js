const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');

// 1. Listar Processos do Escritório
router.get('/processos', authMiddleware, async (req, res) => {
    try {
        const query = 'SELECT id, numero, cliente, uf, instancia FROM processos WHERE escritorio_id = $1 ORDER BY id DESC';
        const result = await pool.query(query, [req.user.escritorio_id]);
        res.json(result.rows);
    } catch (error) {
        console.error("Erro ao listar processos:", error.message);
        res.status(500).json({ erro: 'Erro ao buscar processos' });
    }
});

// 2. Cadastrar Novo Processo
router.post('/processos', authMiddleware, async (req, res) => {
    const { numero, cliente, uf, instancia, cliente_id } = req.body;
    try {
        await pool.query(
            `INSERT INTO processos (numero, cliente, uf, instancia, usuario_id, escritorio_id, cliente_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [numero.trim(), cliente.trim(), uf, instancia, req.user.id, req.user.escritorio_id, cliente_id || null]     
        );
        res.status(201).json({ mensagem: "Processo cadastrado com sucesso!" });
    } catch (err) {
        console.error("Erro ao cadastrar processo:", err.message);
        res.status(500).json({ erro: "Erro ao salvar processo" });
    }
});

// 🚀 3. ROTA CORRIGIDA PARA O MODAL DE CLIENTES
// Resolve o Erro 404 e mapeia os campos corretos (uf, instancia)
router.get('/por-cliente/:clienteId', authMiddleware, async (req, res) => {
    try {
        const { clienteId } = req.params;
        const escritorioId = req.user.escritorio_id;

        // Buscamos os processos filtrando por CLIENTE ou NOME DO CLIENTE (para processos antigos)
        const result = await pool.query(
            `SELECT id, numero, uf, instancia, parte_contraria 
            FROM processos 
            WHERE (cliente_id = $1 OR cliente = (SELECT nome FROM clientes WHERE id = $1))
            AND escritorio_id = $2
            ORDER BY id DESC`,
            [clienteId, escritorioId]
        );

        res.json(result.rows);
    } catch (err) {
        console.error("❌ Erro na busca:", err.message);
        res.status(500).json({ erro: "Erro ao buscar no banco." });
    }
});
module.exports = router;