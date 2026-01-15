const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// 1. Função de Registro (Corrigida para exportação única)
const register = async (req, res) => {
    // Adicionado escritorio_id para suportar a estrutura multitenant do seu SQL
    const { nome, email, senha, role, escritorio_id } = req.body;

    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: 'Dados obrigatórios não informados' });
    }

    try {
        const existe = await pool.query(
            'SELECT id FROM usuarios WHERE email = $1',
            [email]
        );

        if (existe.rowCount > 0) {
            return res.status(409).json({ erro: 'E-mail já cadastrado' });
        }

        const senhaHash = await bcrypt.hash(senha, 10);

        const result = await pool.query(
            `INSERT INTO usuarios (nome, email, senha, role, escritorio_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, nome, email, role, escritorio_id`,
            [nome, email, senhaHash, role || 'advogado', escritorio_id]
        );

        res.status(201).json({
            mensagem: 'Usuário cadastrado com sucesso',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error("Erro no registro:", error);
        res.status(500).json({ erro: 'Erro ao cadastrar usuário' });
    }
};

// 2. Função de Login
const login = async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ erro: 'Dados obrigatórios não informados' });
    }

    try {
        const result = await pool.query(
            'SELECT * FROM usuarios WHERE email = $1',
            [email]
        );

        if (result.rowCount === 0) {
            return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
        }

        const usuario = result.rows[0];
        const senhaOk = await bcrypt.compare(senha, usuario.senha);

        if (!senhaOk) {
            return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
        }

        // Importante: escritorio_id no Token é o que permite a IA checar o plano no server.js
        const token = jwt.sign(
            { 
                id: usuario.id, 
                email: usuario.email, 
                role: usuario.role, 
                escritorio_id: usuario.escritorio_id 
            },
            process.env.JWT_SECRET || 'segredo_temporario',
            { expiresIn: '1d' }
        );

        res.json({ 
          token,
          usuario: {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            role: usuario.role,
            escritorio_id: usuario.escritorio_id
          }
        });
    } catch (error) {
        console.error("Erro no login:", error);
        res.status(500).json({ erro: 'Erro ao realizar login' });
    }
};

// Adicione esta função caso ela não exista entre as 128 linhas
async function alterarSenha(req, res) {
    const { novaSenha } = req.body;
    try {
        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(novaSenha, salt);
        // req.user.id vem do seu authMiddleware
        await pool.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [senhaHash, req.user.id]);
        res.json({ ok: true, mensagem: 'Senha alterada com sucesso!' });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao processar alteração de senha.' });
    }
}

// GARANTA QUE ESTA EXPORTAÇÃO ESTEJA NO FINAL (ajuste os nomes conforme suas funções)
module.exports = { 
    login: exports.login || login, 
    register: exports.register || register, 
    alterarSenha 
};
