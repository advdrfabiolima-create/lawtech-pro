const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// 1. Função de Registro
const register = async (req, res) => {
    const { 
        nome, email, senha, planoId, documento, 
        tipoPessoa, dataNascimento, cep, endereco, 
        cidade, estado, pagamento 
    } = req.body;

    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: 'Dados obrigatórios não informados' });
    }

    try {
        const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
        if (existe.rowCount > 0) {
            return res.status(409).json({ erro: 'Este e-mail já está em uso' });
        }

        const planoParaDefinir = planoId || 1;
        let statusInicial = (planoParaDefinir > 1) ? 'pendente' : 'ativo';
        
        if (pagamento && pagamento.numero && pagamento.numero.length > 10) {
            statusInicial = 'ativo'; 
        }

        const queryEscritorio = `
            INSERT INTO escritorios 
                (nome, plano_id, documento, tipo_pessoa, data_nascimento, cep, 
                 endereco, cidade, estado, plano_financeiro_status, 
                 card_hash, card_validade, criado_em) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()) 
            RETURNING id
        `;

        const valoresEscritorio = [
            `Escritório de ${nome}`, 
            planoParaDefinir, 
            documento, 
            tipoPessoa || 'fisica',
            dataNascimento || null,
            cep, 
            endereco,
            cidade,
            estado,
            statusInicial,
            pagamento ? pagamento.numero : null,
            pagamento ? pagamento.validade : null
        ];

        const novoEscritorio = await pool.query(queryEscritorio, valoresEscritorio);
        const escritorioId = novoEscritorio.rows[0].id;

        const senhaHash = await bcrypt.hash(senha, 10);
        const result = await pool.query(
            `INSERT INTO usuarios (nome, email, senha, role, escritorio_id, tour_desativado)
             VALUES ($1, $2, $3, 'admin', $4, FALSE)
             RETURNING id, nome, email, role, escritorio_id, tour_desativado`,
            [nome, email, senhaHash, escritorioId]
        );

        res.status(201).json({
            ok: true,
            mensagem: 'Conta criada com sucesso!',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error("Erro no auto-registro:", error);
        res.status(500).json({ erro: 'Falha ao processar cadastro.' });
    }
};

// 2. Função de Login com Bloqueio de 7 Dias
const login = async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ erro: 'Dados obrigatórios não informados' });
    }

    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);

        if (result.rowCount === 0) {
            return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
        }

        const usuario = result.rows[0];
        const senhaOk = await bcrypt.compare(senha, usuario.senha);

        if (!senhaOk) {
            return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
        }
        console.log("--- DIAGNÓSTICO DE LOGIN ---");
        console.log("ESCRITÓRIO ID DO USUÁRIO:", usuario.escritorio_id);
        console.log("----------------------------");

// --- 🛡️ BLOCO DE VERIFICAÇÃO DE TRIAL (VERSÃO BLINDADA MASTER) ---
const escCheck = await pool.query(
    `SELECT id, plano_id, plano_financeiro_status, criado_em,
     EXTRACT(DAY FROM (NOW() - criado_em)) as dias_passados
     FROM escritorios WHERE id = $1`,
    [usuario.escritorio_id]
);

if (escCheck.rowCount > 0) {
    let escritorio = escCheck.rows[0];
    
    // VERIFICAÇÃO DE IMUNIDADE: Se for o Dr. Fábio, ignoramos o bloqueio abaixo
    const ehMaster = usuario.email === 'adv.limaesilva@hotmail.com';

    if (!ehMaster) {
        const statusAtivo = ['ativo', 'active'].includes(escritorio.plano_financeiro_status);
        
        if (escritorio.plano_id > 1 && statusAtivo && escritorio.dias_passados >= 7) {
            await pool.query(
                "UPDATE escritorios SET plano_financeiro_status = 'pendente' WHERE id = $1",
                [escritorio.id]
            );
            escritorio.plano_financeiro_status = 'pendente';
        }

        if (escritorio.plano_id > 1 && escritorio.plano_financeiro_status === 'pendente') {
            return res.status(402).json({ 
                erro: 'Período de teste expirado', 
                detalhe: 'Seu trial de 7 dias chegou ao fim. Realize o pagamento para liberar o acesso total.' 
            });
        }
    }
}
        // -----------------------------------------

        const token = jwt.sign(
            { id: usuario.id, email: usuario.email, role: usuario.role, escritorio_id: usuario.escritorio_id },
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
            escritorio_id: usuario.escritorio_id,
            // 🚀 ADICIONADO: Envia a preferência do tour para o Dashboard
            tour_desativado: usuario.tour_desativado 
          }
        });

    } catch (error) {
        console.error("Erro no login:", error);
        res.status(500).json({ erro: 'Erro ao realizar login' });
    }
};

// 3. Função de Alterar Senha
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

module.exports = { login, register, alterarSenha };