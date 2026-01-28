const pool = require('../config/db');
const bcrypt = require('bcrypt');
const planLimits = require('../config/planLimits.json');

/**
 * ============================================================
 * 🔒 FUNÇÃO AUXILIAR: VERIFICAR LIMITE DE USUÁRIOS
 * ============================================================
 */
const verificarLimiteUsuarios = async (escritorioId) => {
    try {
        // Buscar plano do escritório
        const planoResult = await pool.query(
            `SELECT p.slug, p.nome 
             FROM escritorios e
             JOIN planos p ON e.plano_id = p.id
             WHERE e.id = $1`,
            [escritorioId]
        );

        if (planoResult.rows.length === 0) {
            return { 
                permitido: false, 
                erro: 'Plano não identificado' 
            };
        }

        const planoSlug = planoResult.rows[0].slug || 'basico';
        const planoConfig = planLimits[planoSlug];
        const limiteUsuarios = planoConfig.usuarios;

        // Se for ilimitado, libera
        if (limiteUsuarios.ilimitado) {
            return { 
                permitido: true, 
                ilimitado: true,
                plano: planoConfig.nome 
            };
        }

        // Contar usuários ativos
        const countResult = await pool.query(
            `SELECT COUNT(*) as total 
             FROM usuarios 
             WHERE escritorio_id = $1`,
            [escritorioId]
        );

        const usuariosAtivos = parseInt(countResult.rows[0].total);
        const limiteMax = limiteUsuarios.max;

        // Verificar se atingiu o limite
        if (usuariosAtivos >= limiteMax) {
            return {
                permitido: false,
                erro: `Limite de ${limiteMax} usuários atingido`,
                detalhes: {
                    atual: usuariosAtivos,
                    maximo: limiteMax,
                    plano: planoConfig.nome
                }
            };
        }

        return {
            permitido: true,
            detalhes: {
                atual: usuariosAtivos,
                maximo: limiteMax,
                restante: limiteMax - usuariosAtivos,
                plano: planoConfig.nome
            }
        };

    } catch (err) {
        console.error('❌ Erro ao verificar limite de usuários:', err);
        return { 
            permitido: false, 
            erro: 'Erro ao verificar limite' 
        };
    }
};

/**
 * ============================================================
 * 1. LISTAR USUÁRIOS DO ESCRITÓRIO
 * ============================================================
 */
exports.listarUsuarios = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;

        const query = `
            SELECT 
                id, nome, email, cargo, telefone, oab, 
                ativo, criado_em, atualizado_em
            FROM usuarios
            WHERE escritorio_id = $1
            ORDER BY nome ASC
        `;

        const result = await pool.query(query, [escritorioId]);
        res.json(result.rows);

    } catch (err) {
        console.error('❌ Erro ao listar usuários:', err);
        res.status(500).json({ erro: 'Erro ao listar usuários' });
    }
};

/**
 * ============================================================
 * 2. CRIAR USUÁRIO - COM VERIFICAÇÃO DE LIMITE
 * ============================================================
 */
exports.criarUsuario = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;

        // 🔒 VERIFICAR LIMITE ANTES DE CRIAR
        const verificacao = await verificarLimiteUsuarios(escritorioId);
        
        if (!verificacao.permitido) {
            return res.status(402).json({
                erro: verificacao.erro,
                upgrade_required: true,
                detalhes: verificacao.detalhes,
                message: `Você atingiu o limite de usuários do plano ${verificacao.detalhes?.plano}. Faça upgrade para adicionar mais usuários.`
            });
        }

        const { nome, email, senha, cargo, telefone, oab } = req.body;

        // Validações
        if (!nome || !email || !senha) {
            return res.status(400).json({ 
                erro: 'Nome, email e senha são obrigatórios' 
            });
        }

        // Verificar se email já existe
        const emailExiste = await pool.query(
            'SELECT id FROM usuarios WHERE email = $1',
            [email]
        );

        if (emailExiste.rows.length > 0) {
            return res.status(400).json({ 
                erro: 'Email já cadastrado no sistema' 
            });
        }

        // Hash da senha
        const senhaHash = await bcrypt.hash(senha, 10);

        // Inserir usuário
        const query = `
            INSERT INTO usuarios (
                nome, email, senha, cargo, telefone, oab,
                escritorio_id, ativo, criado_em
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
            RETURNING id, nome, email, cargo, telefone, oab, ativo, criado_em
        `;

        const values = [
            nome,
            email.toLowerCase().trim(),
            senhaHash,
            cargo || 'advogado',
            telefone || null,
            oab || null,
            escritorioId
        ];

        const result = await pool.query(query, values);

        res.status(201).json({
            usuario: result.rows[0],
            limites: verificacao.detalhes
        });

    } catch (err) {
        console.error('❌ Erro ao criar usuário:', err);
        res.status(500).json({ erro: 'Erro ao criar usuário: ' + err.message });
    }
};

/**
 * ============================================================
 * 3. ATUALIZAR USUÁRIO
 * ============================================================
 */
exports.atualizarUsuario = async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, email, cargo, telefone, oab, ativo } = req.body;
        const escritorioId = req.user.escritorio_id;

        // Validações
        if (!nome || !email) {
            return res.status(400).json({ 
                erro: 'Nome e email são obrigatórios' 
            });
        }

        // Verificar se email já existe em outro usuário
        const emailExiste = await pool.query(
            'SELECT id FROM usuarios WHERE email = $1 AND id != $2',
            [email, id]
        );

        if (emailExiste.rows.length > 0) {
            return res.status(400).json({ 
                erro: 'Email já cadastrado para outro usuário' 
            });
        }

        const query = `
            UPDATE usuarios
            SET nome = $1, email = $2, cargo = $3, telefone = $4, 
                oab = $5, ativo = $6, atualizado_em = NOW()
            WHERE id = $7 AND escritorio_id = $8
            RETURNING id, nome, email, cargo, telefone, oab, ativo, atualizado_em
        `;

        const values = [
            nome,
            email.toLowerCase().trim(),
            cargo,
            telefone,
            oab,
            ativo !== undefined ? ativo : true,
            id,
            escritorioId
        ];

        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        res.json(result.rows[0]);

    } catch (err) {
        console.error('❌ Erro ao atualizar usuário:', err);
        res.status(500).json({ erro: 'Erro ao atualizar usuário' });
    }
};

/**
 * ============================================================
 * 4. ALTERAR SENHA DO USUÁRIO
 * ============================================================
 */
exports.alterarSenha = async (req, res) => {
    try {
        const { id } = req.params;
        const { senha_atual, senha_nova } = req.body;
        const escritorioId = req.user.escritorio_id;

        // Validações
        if (!senha_atual || !senha_nova) {
            return res.status(400).json({ 
                erro: 'Senha atual e nova senha são obrigatórias' 
            });
        }

        if (senha_nova.length < 6) {
            return res.status(400).json({ 
                erro: 'A nova senha deve ter no mínimo 6 caracteres' 
            });
        }

        // Buscar usuário
        const userResult = await pool.query(
            'SELECT senha FROM usuarios WHERE id = $1 AND escritorio_id = $2',
            [id, escritorioId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        // Verificar senha atual
        const senhaValida = await bcrypt.compare(
            senha_atual, 
            userResult.rows[0].senha
        );

        if (!senhaValida) {
            return res.status(401).json({ erro: 'Senha atual incorreta' });
        }

        // Hash da nova senha
        const novaSenhaHash = await bcrypt.hash(senha_nova, 10);

        // Atualizar senha
        await pool.query(
            'UPDATE usuarios SET senha = $1, atualizado_em = NOW() WHERE id = $2',
            [novaSenhaHash, id]
        );

        res.json({ mensagem: 'Senha alterada com sucesso' });

    } catch (err) {
        console.error('❌ Erro ao alterar senha:', err);
        res.status(500).json({ erro: 'Erro ao alterar senha' });
    }
};

/**
 * ============================================================
 * 5. DESATIVAR USUÁRIO (SOFT DELETE)
 * ============================================================
 */
exports.desativarUsuario = async (req, res) => {
    try {
        const { id } = req.params;
        const escritorioId = req.user.escritorio_id;

        // Verificar se é o último usuário ativo
        const countResult = await pool.query(
            'SELECT COUNT(*) as total FROM usuarios WHERE escritorio_id = $1 AND ativo = true',
            [escritorioId]
        );

        if (parseInt(countResult.rows[0].total) <= 1) {
            return res.status(400).json({ 
                erro: 'Não é possível desativar o último usuário ativo do escritório' 
            });
        }

        const result = await pool.query(
            `UPDATE usuarios 
             SET ativo = false, atualizado_em = NOW()
             WHERE id = $1 AND escritorio_id = $2
             RETURNING id, nome, email, ativo`,
            [id, escritorioId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        res.json({ 
            mensagem: 'Usuário desativado com sucesso',
            usuario: result.rows[0]
        });

    } catch (err) {
        console.error('❌ Erro ao desativar usuário:', err);
        res.status(500).json({ erro: 'Erro ao desativar usuário' });
    }
};

/**
 * ============================================================
 * 6. REATIVAR USUÁRIO
 * ============================================================
 */
exports.reativarUsuario = async (req, res) => {
    try {
        const { id } = req.params;
        const escritorioId = req.user.escritorio_id;

        // 🔒 VERIFICAR LIMITE ANTES DE REATIVAR
        const verificacao = await verificarLimiteUsuarios(escritorioId);
        
        if (!verificacao.permitido && !verificacao.ilimitado) {
            return res.status(402).json({
                erro: verificacao.erro,
                upgrade_required: true,
                detalhes: verificacao.detalhes,
                message: 'Você atingiu o limite de usuários do seu plano. Faça upgrade para reativar este usuário.'
            });
        }

        const result = await pool.query(
            `UPDATE usuarios 
             SET ativo = true, atualizado_em = NOW()
             WHERE id = $1 AND escritorio_id = $2
             RETURNING id, nome, email, ativo`,
            [id, escritorioId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        res.json({ 
            mensagem: 'Usuário reativado com sucesso',
            usuario: result.rows[0]
        });

    } catch (err) {
        console.error('❌ Erro ao reativar usuário:', err);
        res.status(500).json({ erro: 'Erro ao reativar usuário' });
    }
};

/**
 * ============================================================
 * 7. EXCLUIR USUÁRIO (HARD DELETE)
 * ============================================================
 */
exports.excluirUsuario = async (req, res) => {
    try {
        const { id } = req.params;
        const escritorioId = req.user.escritorio_id;

        // Verificar se é o último usuário
        const countResult = await pool.query(
            'SELECT COUNT(*) as total FROM usuarios WHERE escritorio_id = $1',
            [escritorioId]
        );

        if (parseInt(countResult.rows[0].total) <= 1) {
            return res.status(400).json({ 
                erro: 'Não é possível excluir o último usuário do escritório' 
            });
        }

        // Verificar se usuário tem dados vinculados
        const vinculosResult = await pool.query(
            `SELECT 
                (SELECT COUNT(*) FROM processos WHERE usuario_id = $1) as processos,
                (SELECT COUNT(*) FROM prazos WHERE usuario_id = $1) as prazos,
                (SELECT COUNT(*) FROM clientes WHERE usuario_id = $1) as clientes
            `,
            [id]
        );

        const vinculos = vinculosResult.rows[0];
        const temVinculos = 
            parseInt(vinculos.processos) > 0 || 
            parseInt(vinculos.prazos) > 0 || 
            parseInt(vinculos.clientes) > 0;

        if (temVinculos) {
            return res.status(400).json({ 
                erro: 'Não é possível excluir usuário com processos, prazos ou clientes vinculados. Desative o usuário ao invés de excluí-lo.',
                vinculos: {
                    processos: parseInt(vinculos.processos),
                    prazos: parseInt(vinculos.prazos),
                    clientes: parseInt(vinculos.clientes)
                }
            });
        }

        const result = await pool.query(
            'DELETE FROM usuarios WHERE id = $1 AND escritorio_id = $2 RETURNING *',
            [id, escritorioId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        res.json({ mensagem: 'Usuário excluído com sucesso' });

    } catch (err) {
        console.error('❌ Erro ao excluir usuário:', err);
        res.status(500).json({ erro: 'Erro ao excluir usuário' });
    }
};

/**
 * ============================================================
 * 8. OBTER INFORMAÇÕES DE LIMITES E USO
 * ============================================================
 */
exports.obterLimitesUsuarios = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const verificacao = await verificarLimiteUsuarios(escritorioId);

        res.json({
            permitido: verificacao.permitido,
            ilimitado: verificacao.ilimitado || false,
            detalhes: verificacao.detalhes || null
        });

    } catch (err) {
        console.error('❌ Erro ao obter limites:', err);
        res.status(500).json({ erro: 'Erro ao obter limites de usuários' });
    }
};