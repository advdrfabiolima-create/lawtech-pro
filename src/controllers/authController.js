const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// 1. Função de Registro
const register = async (req, res) => {
    // Agora capturamos também os dados de faturamento vindos do novo register.html
    const { nome, email, senha, planoId, documento, cep, endereco } = req.body;

    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: 'Dados obrigatórios não informados' });
    }

    try {
        // 1. Verifica se o e-mail já existe
        const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
        if (existe.rowCount > 0) {
            return res.status(409).json({ erro: 'Este e-mail já está em uso' });
        }

        // 2. Define lógica de status inicial do plano
        const planoParaDefinir = planoId || 1;
        // Se o plano for maior que 1 (pago), o status nasce como 'pendente'
        const statusInicial = (planoParaDefinir > 1) ? 'pendente' : 'ativo';

        // 3. Cria o Escritório com dados completos
        const novoEscritorio = await pool.query(
            `INSERT INTO escritorios 
                (nome, plano_id, documento, cep, endereco, plano_financeiro_status) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [`Escritório de ${nome}`, planoParaDefinir, documento, cep, endereco, statusInicial]
        );
        const escritorioId = novoEscritorio.rows[0].id;

        // 4. Criptografa a senha e salva o usuário como 'admin'
        const senhaHash = await bcrypt.hash(senha, 10);
        const result = await pool.query(
            `INSERT INTO usuarios (nome, email, senha, role, escritorio_id)
             VALUES ($1, $2, $3, 'admin', $4)
             RETURNING id, nome, email, role, escritorio_id`,
            [nome, email, senhaHash, escritorioId]
        );

        res.status(201).json({
            mensagem: 'Conta criada com sucesso!',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error("Erro no auto-registro:", error);
        res.status(500).json({ erro: 'Falha ao processar cadastro. Tente novamente.' });
    }
};

// 2. Função de Login com Verificação de Pagamento
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

        // --- VERIFICAÇÃO DE STATUS DO PLANO (BLOQUEIO) ---
        const escCheck = await pool.query(
            'SELECT plano_id, plano_financeiro_status, documento, oab FROM escritorios WHERE id = $1',
            [usuario.escritorio_id]
        );
        const escritorio = escCheck.rows[0];

        // Se o plano for pago e o status ainda for pendente, bloqueia o acesso
        if (escritorio.plano_id > 1 && escritorio.plano_financeiro_status === 'pendente') {
            return res.status(402).json({ 
                erro: 'Pagamento pendente', 
                detalhe: 'Acesse o link enviado ao seu e-mail para quitar a fatura e liberar o acesso.' 
            });
        }

        // Geração do Token JWT
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

        const perfilCompleto = !!(escritorio.documento && escritorio.oab);

        res.json({ 
          token,
          usuario: {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            role: usuario.role,
            escritorio_id: usuario.escritorio_id,
            perfilCompleto
          }
        });

    } catch (error) {
        console.error("Erro no login:", error);
        res.status(500).json({ erro: 'Erro ao realizar login' });
    }
};

async function alterarSenha(req, res) {
    const { novaSenha } = req.body;
    try {
        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(novaSenha, salt);
        await pool.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [senhaHash, req.user.id]);
        res.json({ ok: true, mensagem: 'Senha alterada com sucesso!' });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao processar alteração de senha.' });
    }
}

module.exports = { 
    login, 
    register, 
    alterarSenha 
};