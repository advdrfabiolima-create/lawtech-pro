const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
// 🔑 A LINHA ABAIXO FOI ADICIONADA PARA RESOLVER O ERRO "POOL IS NOT DEFINED"
const pool = require('../config/db'); 

// 🔓 LOGIN (público)
router.post('/login', authController.login);

// 🔓 REGISTER
router.post('/register', authController.register);

router.post('/alterar-senha', authMiddleware, authController.alterarSenha);

router.get('/me', authMiddleware, (req, res) => {
    res.json({ ok: true, usuario: req.user });
});

// 👥 ROTA DE CONVITE (EQUIPE)
router.post('/convidar-funcionario', authMiddleware, async (req, res) => {
    try {
        // Log para o terminal
        console.log("Tentativa de cadastro por:", req.user.email, "Cargo:", req.user.role);

        const cargoUsuario = req.user.role ? req.user.role.toLowerCase() : '';
        
        if (cargoUsuario !== 'admin') {
            return res.status(403).json({ 
                erro: "Perfil não identificado ou sem permissão de Admin",
                cargoEncontrado: req.user.role 
            });
        }

        const { nome, email, senha, role } = req.body;
        const escritorioId = req.user.escritorio_id;

        const bcrypt = require('bcrypt');
        const senhaCripto = await bcrypt.hash(senha, 10);

        await pool.query(
            `INSERT INTO usuarios (nome, email, senha, role, escritorio_id) 
             VALUES ($1, $2, $3, $4, $5)`,
            [nome, email, senhaCripto, role || 'operador', escritorioId]
        );

        res.json({ ok: true, mensagem: "Funcionário cadastrado com sucesso!" });

    } catch (err) {
        console.error("Erro no cadastro de equipe:", err.message);
        res.status(500).json({ erro: "E-mail já cadastrado ou erro no banco." });
    }
});

// 👥 LISTAR EQUIPE
router.get('/equipe', authMiddleware, async (req, res) => {
    try {
        const resultado = await pool.query(
            "SELECT id, nome, email, role FROM usuarios WHERE escritorio_id = $1 AND id != $2",
            [req.user.escritorio_id, req.user.id]
        );
        res.json(resultado.rows);
    } catch (err) {
        res.status(500).send("Erro ao buscar equipe.");
    }
});

// 👥 EXCLUIR MEMBRO
router.delete('/equipe/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const escritorioId = req.user.escritorio_id;

        const deleteResult = await pool.query(
            "DELETE FROM usuarios WHERE id = $1 AND escritorio_id = $2",
            [id, escritorioId]
        );

        if (deleteResult.rowCount > 0) {
            res.json({ ok: true, mensagem: "Acesso revogado com sucesso." });
        } else {
            res.status(403).json({ error: "Não autorizado ou usuário não encontrado." });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;