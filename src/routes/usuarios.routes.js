const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const { validarSenha } = require('../utils/validators');
const logger = require('../utils/logger');
const { registrarLog } = require('../utils/auditLog');

// Carregar limites dos planos
const planLimits = require('../config/planLimits.json');

/**
 * 📌 ROTA: ADICIONAR MEMBRO À EQUIPE (CONVIDAR FUNCIONÁRIO)
 * POST /api/auth/convidar-funcionario
 */
router.post('/auth/convidar-funcionario', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    const { nome, email, senha, role } = req.body;

    // Validação básica
    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: 'Nome, e-mail e senha são obrigatórios' });
    }

    const senhaCheck = validarSenha(senha);
    if (!senhaCheck.valida) {
        return res.status(400).json({ erro: senhaCheck.mensagem });
    }

    try {
        const escritorioId = req.user.escritorio_id;

        // 1. Verificar o plano atual do escritório
        const escritorioResult = await pool.query(
            'SELECT plano_id FROM escritorios WHERE id = $1',
            [escritorioId]
        );

        if (escritorioResult.rowCount === 0) {
            return res.status(404).json({ erro: 'Escritório não encontrado' });
        }

        // 2. Buscar slug do plano via JOIN (evita hardcode de IDs)
        const planoResult = await pool.query(
            'SELECT slug, nome FROM planos WHERE id = $1',
            [escritorioResult.rows[0].plano_id]
        );

        const planoSlug = planoResult.rows[0]?.slug || 'basico';
        const planoConfig = planLimits[planoSlug];

        if (!planoConfig) {
            return res.status(500).json({ erro: 'Configuração de plano não encontrada' });
        }

        // 3. Contar usuários atuais do escritório
        const countResult = await pool.query(
            'SELECT COUNT(*) as total FROM usuarios WHERE escritorio_id = $1',
            [escritorioId]
        );

        const usuariosAtuais = parseInt(countResult.rows[0].total);
        const limiteUsuarios = planoConfig.usuarios.max;

        // 4. Verificar se atingiu o limite (apenas se não for ilimitado)
        if (!planoConfig.usuarios.ilimitado && usuariosAtuais >= limiteUsuarios) {
            return res.status(402).json({
                erro: 'Limite de usuários atingido',
                message: `Você atingiu o limite de ${limiteUsuarios} usuários do plano ${planoConfig.nome}.`,
                max: limiteUsuarios,
                current: usuariosAtuais,
                current_plan: planoConfig.nome
            });
        }

        // 5. Verificar se o e-mail já está cadastrado
        const emailExiste = await pool.query(
            'SELECT id FROM usuarios WHERE email = $1',
            [email.toLowerCase().trim()]
        );

        if (emailExiste.rowCount > 0) {
            return res.status(409).json({ erro: 'Este e-mail já está cadastrado no sistema' });
        }

        // 6. Hash da senha
        const senhaHash = await bcrypt.hash(senha, 10);

        // 7. Criar o novo usuário
        const result = await pool.query(
            `INSERT INTO usuarios (nome, email, senha, role, escritorio_id, tour_desativado, primeiro_acesso)
             VALUES ($1, $2, $3, $4, $5, FALSE, TRUE)
             RETURNING id, nome, email, role`,
            [nome.trim(), email.toLowerCase().trim(), senhaHash, role || 'operador', escritorioId]
        );

        logger.info({ nome, email, escritorioId }, 'Novo membro adicionado');

        res.status(201).json({
            ok: true,
            mensagem: 'Membro adicionado com sucesso!',
            usuario: result.rows[0]
        });

    } catch (error) {
        logger.error({ err: error.message }, 'Erro ao adicionar membro');
        registrarLog({
            escritorio_id: req.user?.escritorio_id || null,
            servico: 'POST /auth/convidar-funcionario',
            tipo_erro: 'SQL_ERROR',
            mensagem_erro: error.message
        });
        res.status(500).json({ ok: false, erro: 'Erro ao adicionar membro à equipe: ' + error.message });
    }
});

/**
 * 📌 ROTA: LISTAR MEMBROS DA EQUIPE
 * GET /api/auth/equipe (compatível com o frontend)
 */
router.get('/auth/equipe', authMiddleware, async (req, res) => {
    try {
        logger.info({ email: req.user.email, escritorioId: req.user.escritorio_id }, '[EQUIPE] Listagem solicitada');
        
        const escritorioId = req.user.escritorio_id;

        if (!escritorioId) {
            logger.error('[EQUIPE] escritorio_id nao encontrado no token');
            return res.status(400).json({ erro: 'Escritório não identificado' });
        }

        // Query mais simples e robusta - só seleciona campos essenciais que sempre existem
        let query = `SELECT id, nome, email,
                     COALESCE(role, 'operador') as role
                     FROM usuarios
                     WHERE escritorio_id = $1
                     ORDER BY id DESC`;
        
        const result = await pool.query(query, [escritorioId]);

        logger.info({ total: result.rows.length, escritorioId }, '[EQUIPE] Membros encontrados');

        // Retorna diretamente o array, conforme esperado pelo frontend
        res.json(result.rows);

    } catch (error) {
        logger.error({ err: error.message, stack: error.stack }, '[EQUIPE] Erro ao listar equipe');
        res.status(500).json({ erro: 'Erro ao carregar membros da equipe' });
    }
});

/**
 * 📌 ROTA: REMOVER MEMBRO DA EQUIPE
 * DELETE /api/auth/equipe/:id (compatível com o frontend)
 */
router.delete('/auth/equipe/:id', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    const { id } = req.params;

    try {
        const escritorioId = req.user.escritorio_id;

        // Verificar se o usuário pertence ao mesmo escritório
        const checkResult = await pool.query(
            'SELECT id, role FROM usuarios WHERE id = $1 AND escritorio_id = $2',
            [id, escritorioId]
        );

        if (checkResult.rowCount === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        // Não permitir remover o próprio usuário
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ erro: 'Você não pode remover sua própria conta' });
        }

        // Remover o usuário
        await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);

        logger.info({ id, escritorioId }, 'Membro removido');

        res.json({ ok: true, mensagem: 'Membro removido com sucesso' });

    } catch (error) {
        logger.error({ err: error.message }, 'Erro ao remover membro');
        res.status(500).json({ erro: 'Erro ao remover membro da equipe' });
    }
});

/**
 * 📌 ROTA: ATUALIZAR PERMISSÃO DE MEMBRO
 * PUT /api/usuarios/:id/role
 */
router.put('/usuarios/:id/role', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    if (!role || !['admin', 'operador', 'visualizador'].includes(role)) {
        return res.status(400).json({ erro: 'Permissão inválida' });
    }

    try {
        const escritorioId = req.user.escritorio_id;

        // Verificar se o usuário pertence ao mesmo escritório
        const checkResult = await pool.query(
            'SELECT id FROM usuarios WHERE id = $1 AND escritorio_id = $2',
            [id, escritorioId]
        );

        if (checkResult.rowCount === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        // Atualizar a permissão
        await pool.query(
            'UPDATE usuarios SET role = $1 WHERE id = $2',
            [role, id]
        );

        logger.info({ id, role }, 'Permissao atualizada');

        res.json({ ok: true, mensagem: 'Permissão atualizada com sucesso' });

    } catch (error) {
        logger.error({ err: error.message }, 'Erro ao atualizar permissao');
        res.status(500).json({ erro: 'Erro ao atualizar permissão' });
    }
});

module.exports = router;