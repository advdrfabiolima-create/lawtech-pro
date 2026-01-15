const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');

// Listar Processos (já estava no seu server, agora aqui)
router.get('/processos', authMiddleware, async (req, res) => {
    try {
        const query = 'SELECT id, numero, cliente, uf, instancia FROM processos WHERE escritorio_id = $1 ORDER BY id DESC';
        const result = await pool.query(query, [req.user.escritorio_id]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ erro: 'Erro ao buscar processos' });
    }
});

// Cadastrar Novo Processo
router.post('/processos', authMiddleware, async (req, res) => {
    const { numero, cliente, uf, instancia } = req.body;
    try {
        await pool.query(
            'INSERT INTO processos (numero, cliente, uf, instancia, usuario_id, escritorio_id) VALUES ($1, $2, $3, $4, $5, $6)',
            [numero.trim(), cliente.trim(), uf, instancia, req.user.id, req.user.escritorio_id]     
        );
        res.status(201).json({ mensagem: "Processo cadastrado com sucesso!" });
    } catch (err) {
        res.status(500).json({ erro: "Erro ao salvar processo" });
    }
});

module.exports = router;