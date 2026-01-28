const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
// 🔑 A LINHA ABAIXO FOI ADICIONADA PARA RESOLVER O ERRO "POOL IS NOT DEFINED"
const planMiddleware = require('../middlewares/planMiddleware');
const pool = require('../config/db'); 

// 🔓 LOGIN (público)
router.post('/login', authController.login);

// 🔓 REGISTER
router.post('/register', authController.register);

router.post('/alterar-senha', authMiddleware, authController.alterarSenha);

router.get('/me', authMiddleware, async (req, res) => {
    try {
        // 🚀 ADICIONADO: tour_desativado na consulta SQL
        const result = await pool.query(
            'SELECT id, nome, email, role, escritorio_id, data_criacao, tour_desativado FROM usuarios WHERE id = $1',
            [req.user.id]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });
        }
        
        const usuario = result.rows[0];
        
        res.json({ 
            ok: true, 
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                role: usuario.role,
                escritorio_id: usuario.escritorio_id,
                data_criacao: usuario.data_criacao,
                // 🔑 AGORA O DASHBOARD RECEBERÁ ESTA INFORMAÇÃO:
                tour_desativado: usuario.tour_desativado 
            }
        });
    } catch (error) {
        console.error('Erro em /api/auth/me:', error);
        res.status(500).json({ ok: false, erro: 'Erro ao buscar dados do usuário' });
    }
});

// 👥 ROTA DE CONVITE (EQUIPE)
router.post('/convidar-funcionario', authMiddleware, planMiddleware.checkLimit('usuarios'), async (req, res) => {
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

router.post('/atualizar-tour', authMiddleware, async (req, res) => {
    try {
        const { desativar } = req.body;
        await pool.query('UPDATE usuarios SET tour_desativado = $1 WHERE id = $2', [desativar, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao salvar preferência de tour' });
    }
});

module.exports = router;