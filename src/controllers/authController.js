const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

/* ======================================================
   1. FUNÇÃO DE REGISTRO - CORRIGIDA
===================================================== */

const register = async (req, res) => {
    const { 
        nome, email, senha, planoId, documento, 
        tipoPessoa, dataNascimento, cep, endereco, 
        cidade, estado, pagamento 
    } = req.body;

    console.log('📝 [REGISTRO] Nova solicitação:', email);

    // ✅ Validação de entrada
    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios' });
    }

    if (senha.length < 6) {
        return res.status(400).json({ erro: 'A senha deve ter no mínimo 6 caracteres' });
    }

    try {
        // ✅ Verifica se email já existe
        const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase().trim()]);
        if (existe.rowCount > 0) {
            return res.status(409).json({ erro: 'Este e-mail já está em uso' });
        }

        // ✅ Preparar dados
        const planoParaDefinir = planoId || 1;
        const documentoLimpo = documento ? documento.replace(/\D/g, '') : null;
        
        // ✅ Calcular data de expiração do trial (7 dias)
        const dataExpiracao = new Date();
        dataExpiracao.setDate(dataExpiracao.getDate() + 7);

        // ✅ Status inicial (trial para novos usuários)
        let statusInicial = 'trial';
        
        // Se pagamento foi fornecido, marca como ativo
        if (pagamento && pagamento.numero && pagamento.numero.length > 10) {
            statusInicial = 'ativo'; 
        }

        // ✅ TRANSAÇÃO: Garante que escritório e usuário sejam criados juntos
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // 1️⃣ Criar escritório
            const queryEscritorio = `
                INSERT INTO escritorios 
                    (nome, plano_id, documento, data_nascimento, cep, 
                     endereco, cidade, estado, uf, plano_financeiro_status, 
                     trial_expira_em, created_at) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) 
                RETURNING id
            `;

            const valoresEscritorio = [
                nome, // ✅ MUDOU: Usa o nome direto, não "Escritório de..."
                planoParaDefinir, 
                documentoLimpo,
                dataNascimento || null,
                cep || null, 
                endereco || null,
                cidade || 'Não informado',
                estado || 'BA',
                estado || 'BA', // UF (mesmo valor do estado)
                statusInicial,
                dataExpiracao // ✅ ADICIONADO: Data de expiração do trial
            ];

            const novoEscritorio = await client.query(queryEscritorio, valoresEscritorio);
            const escritorioId = novoEscritorio.rows[0].id;

            console.log(`✅ [REGISTRO] Escritório criado: ID ${escritorioId}`);

            // 2️⃣ Criar usuário
            const senhaHash = await bcrypt.hash(senha, 10);
            
            const result = await client.query(
                `INSERT INTO usuarios (nome, email, senha, role, escritorio_id, tour_desativado, created_at)
                 VALUES ($1, $2, $3, 'admin', $4, FALSE, NOW())
                 RETURNING id, nome, email, role, escritorio_id, tour_desativado`,
                [nome, email.toLowerCase().trim(), senhaHash, escritorioId]
            );

            const usuario = result.rows[0];

            console.log(`✅ [REGISTRO] Usuário criado: ${usuario.email} (ID: ${usuario.id})`);

            await client.query('COMMIT');

            // ✅ Gerar token JWT
            const token = jwt.sign(
                { 
                    id: usuario.id,
                    email: usuario.email,
                    role: usuario.role,
                    escritorio_id: escritorioId
                },
                process.env.JWT_SECRET || 'segredo_temporario',
                { expiresIn: '7d' }
            );

            console.log(`🎉 [REGISTRO] Cadastro concluído com sucesso: ${usuario.email}`);

            // ✅ Retorna sucesso com token
            res.status(201).json({
                ok: true,
                mensagem: 'Conta criada com sucesso!',
                token: token, // ✅ ADICIONADO: Retorna token para login automático
                usuario: {
                    id: usuario.id,
                    nome: usuario.nome,
                    email: usuario.email,
                    role: usuario.role,
                    escritorio_id: escritorioId,
                    tour_desativado: usuario.tour_desativado
                },
                trial: {
                    dias_restantes: 7,
                    expira_em: dataExpiracao.toISOString().split('T')[0]
                }
            });

        } catch (err) {
            await client.query('ROLLBACK');
            console.error('❌ [REGISTRO] Erro na transação:', err.message);
            throw err;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('❌ [REGISTRO] Erro ao processar cadastro:', error.message);
        console.error('Stack:', error.stack);
        
        // ✅ Mensagens de erro específicas
        if (error.message.includes('unique') || error.code === '23505') {
            return res.status(409).json({ erro: 'E-mail já cadastrado no sistema' });
        }
        
        if (error.message.includes('escritorios') || error.message.includes('usuarios')) {
            return res.status(500).json({ 
                erro: 'Erro ao criar conta. Verifique os dados e tente novamente.',
                detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }

        res.status(500).json({ 
            erro: 'Falha ao processar cadastro.',
            detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/* ======================================================
   2. FUNÇÃO DE LOGIN - MANTIDA (JÁ ESTÁ BOA)
===================================================== */

const login = async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
    }

    try {
        console.log('🔐 [LOGIN] Tentativa de login:', email);

        const result = await pool.query(
            `SELECT u.*, e.plano_id, e.plano_financeiro_status, e.trial_expira_em,
                    EXTRACT(DAY FROM (NOW() - e.created_at)) as dias_passados
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             WHERE u.email = $1`,
            [email.toLowerCase().trim()]
        );

        if (result.rowCount === 0) {
            return res.status(401).json({ erro: 'Email ou senha incorretos' });
        }

        const usuario = result.rows[0];
        const senhaOk = await bcrypt.compare(senha, usuario.senha);

        if (!senhaOk) {
            return res.status(401).json({ erro: 'Email ou senha incorretos' });
        }

        console.log('📊 [LOGIN] Usuário:', usuario.email, '| Escritório:', usuario.escritorio_id);

        // ✅ Verificação de Trial/Pagamento
        const ehMaster = usuario.email === 'adv.limaesilva@hotmail.com';

        if (!ehMaster) {
            // Calcula dias restantes do trial
            let diasRestantes = null;
            if (usuario.trial_expira_em) {
                const hoje = new Date();
                const expiracao = new Date(usuario.trial_expira_em);
                diasRestantes = Math.ceil((expiracao - hoje) / (1000 * 60 * 60 * 24));
            }

            // Se trial expirou e não pagou
            if (usuario.plano_id > 1 && diasRestantes !== null && diasRestantes <= 0 && usuario.plano_financeiro_status !== 'pago') {
                console.log('⚠️ [LOGIN] Trial expirado:', usuario.email);
                
                return res.status(402).json({ 
                    erro: 'Período de teste expirado', 
                    detalhe: 'Seu trial de 7 dias chegou ao fim. Realize o pagamento para liberar o acesso total.',
                    dias_restantes: diasRestantes
                });
            }
        }

        // ✅ Gerar token
        const token = jwt.sign(
            { 
                id: usuario.id, 
                email: usuario.email, 
                role: usuario.role, 
                escritorio_id: usuario.escritorio_id 
            },
            process.env.JWT_SECRET || 'segredo_temporario',
            { expiresIn: '7d' }
        );

        console.log('✅ [LOGIN] Login bem-sucedido:', usuario.email);

        res.json({ 
            ok: true,
            token,
            usuario: {
                id: usuario.id, 
                nome: usuario.nome, 
                email: usuario.email,
                role: usuario.role, 
                escritorio_id: usuario.escritorio_id,
                tour_desativado: usuario.tour_desativado || false,
                plano_id: usuario.plano_id,
                plano_financeiro_status: usuario.plano_financeiro_status
            }
        });

    } catch (error) {
        console.error('❌ [LOGIN] Erro:', error.message);
        res.status(500).json({ erro: 'Erro ao realizar login' });
    }
};

/* ======================================================
   3. FUNÇÃO DE ALTERAR SENHA - MELHORADA
===================================================== */

async function alterarSenha(req, res) {
    const { senhaAtual, novaSenha } = req.body;
    
    console.log('🔑 [ALTERAR SENHA] Solicitação do usuário:', req.user.email);

    try {
        // ✅ Validações
        if (!novaSenha) {
            return res.status(400).json({ erro: 'Nova senha é obrigatória' });
        }

        if (novaSenha.length < 6) {
            return res.status(400).json({ erro: 'A nova senha deve ter no mínimo 6 caracteres' });
        }

        // ✅ Se tem senha atual, valida (mudança manual)
        if (senhaAtual) {
            const result = await pool.query('SELECT senha FROM usuarios WHERE id = $1', [req.user.id]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ erro: 'Usuário não encontrado' });
            }

            const senhaValida = await bcrypt.compare(senhaAtual, result.rows[0].senha);
            
            if (!senhaValida) {
                return res.status(401).json({ erro: 'Senha atual incorreta' });
            }
        }

        // ✅ Atualiza senha
        const senhaHash = await bcrypt.hash(novaSenha, 10);
        await pool.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [senhaHash, req.user.id]);
        
        console.log('✅ [ALTERAR SENHA] Senha alterada:', req.user.email);
        
        res.json({ ok: true, mensagem: 'Senha alterada com sucesso!' });
        
    } catch (err) {
        console.error('❌ [ALTERAR SENHA] Erro:', err.message);
        res.status(500).json({ erro: 'Erro ao processar alteração de senha.' });
    }
}

module.exports = { login, register, alterarSenha };