const pool = require('../config/db');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/mensagens?tipo=geral&ultimo_id=0
// GET /api/chat/mensagens?tipo=dm&usuario_id=X&ultimo_id=0
// ─────────────────────────────────────────────────────────────────────────────
exports.listarMensagens = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const userId = req.user.id;
        const { tipo, usuario_id, ultimo_id } = req.query;
        const lastId = parseInt(ultimo_id) || 0;

        let result;

        if (tipo === 'dm' && usuario_id) {
            const outroId = parseInt(usuario_id);

            await pool.query(
                `UPDATE chat_mensagens SET lida = true
                 WHERE escritorio_id = $1 AND remetente_id = $2 AND destinatario_id = $3 AND lida = false`,
                [escritorioId, outroId, userId]
            );

            result = await pool.query(
                `SELECT
                    m.id, m.conteudo, m.criado_em,
                    m.remetente_id, m.destinatario_id, m.lida, m.arquivo_nome,
                    m.reply_to_id,
                    u.nome AS remetente_nome,
                    -- Conteúdo da mensagem-pai (para exibir cotação)
                    rm.conteudo AS reply_to_conteudo,
                    ru.nome     AS reply_to_autor,
                    -- Contagem de respostas neste tópico
                    (SELECT COUNT(*) FROM chat_mensagens th
                     WHERE th.reply_to_id = m.id
                       AND th.escritorio_id = m.escritorio_id)::int AS thread_count
                 FROM chat_mensagens m
                 JOIN usuarios u ON u.id = m.remetente_id
                 LEFT JOIN chat_mensagens rm ON rm.id = m.reply_to_id
                 LEFT JOIN usuarios ru ON ru.id = rm.remetente_id
                 WHERE m.escritorio_id = $1
                   AND (
                       (m.remetente_id = $2 AND m.destinatario_id = $3)
                    OR (m.remetente_id = $3 AND m.destinatario_id = $2)
                   )
                   AND m.id > $4
                   AND m.reply_to_id IS NULL   -- mensagens-raiz; tópicos carregados separadamente
                 ORDER BY m.id ASC
                 LIMIT 100`,
                [escritorioId, userId, outroId, lastId]
            );
        } else {
            // Chat geral
            await pool.query(
                `UPDATE chat_mensagens SET lida = true
                 WHERE escritorio_id = $1 AND destinatario_id IS NULL AND remetente_id != $2 AND lida = false`,
                [escritorioId, userId]
            );

            result = await pool.query(
                `SELECT
                    m.id, m.conteudo, m.criado_em,
                    m.remetente_id, m.destinatario_id, m.lida, m.arquivo_nome,
                    m.reply_to_id,
                    u.nome AS remetente_nome,
                    rm.conteudo AS reply_to_conteudo,
                    ru.nome     AS reply_to_autor,
                    (SELECT COUNT(*) FROM chat_mensagens th
                     WHERE th.reply_to_id = m.id
                       AND th.escritorio_id = m.escritorio_id)::int AS thread_count
                 FROM chat_mensagens m
                 JOIN usuarios u ON u.id = m.remetente_id
                 LEFT JOIN chat_mensagens rm ON rm.id = m.reply_to_id
                 LEFT JOIN usuarios ru ON ru.id = rm.remetente_id
                 WHERE m.escritorio_id = $1
                   AND m.destinatario_id IS NULL
                   AND m.id > $2
                   AND m.reply_to_id IS NULL
                 ORDER BY m.id ASC
                 LIMIT 100`,
                [escritorioId, lastId]
            );
        }

        res.json({ ok: true, mensagens: result.rows });
    } catch (err) {
        logger.error({ err: err.message }, '[CHAT] Erro ao listar mensagens');
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/thread/:msgId  — respostas de um tópico específico
// ─────────────────────────────────────────────────────────────────────────────
exports.listarThread = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const msgId = parseInt(req.params.msgId);

        const result = await pool.query(
            `SELECT
                m.id, m.conteudo, m.criado_em,
                m.remetente_id, m.destinatario_id, m.lida, m.arquivo_nome,
                m.reply_to_id,
                u.nome AS remetente_nome
             FROM chat_mensagens m
             JOIN usuarios u ON u.id = m.remetente_id
             WHERE m.escritorio_id = $1 AND m.reply_to_id = $2
             ORDER BY m.id ASC`,
            [escritorioId, msgId]
        );

        res.json({ ok: true, mensagens: result.rows });
    } catch (err) {
        logger.error({ err: err.message }, '[CHAT] Erro ao listar thread');
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat/mensagens
// Body: { conteudo, destinatario_id?, reply_to_id? }
// ─────────────────────────────────────────────────────────────────────────────
exports.enviarMensagem = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const remetenteId = req.user.id;
        const { conteudo, destinatario_id, reply_to_id } = req.body;

        if (!conteudo || !conteudo.trim()) {
            return res.status(400).json({ ok: false, erro: 'Conteúdo da mensagem é obrigatório.' });
        }

        const destId      = destinatario_id ? parseInt(destinatario_id) : null;
        const replyToId   = reply_to_id     ? parseInt(reply_to_id)     : null;

        const result = await pool.query(
            `INSERT INTO chat_mensagens
                (escritorio_id, remetente_id, destinatario_id, conteudo, reply_to_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, criado_em`,
            [escritorioId, remetenteId, destId, conteudo.trim(), replyToId]
        );

        res.json({
            ok: true,
            mensagem: {
                id:              result.rows[0].id,
                criado_em:       result.rows[0].criado_em,
                remetente_id:    remetenteId,
                remetente_nome:  req.user.nome,
                destinatario_id: destId,
                reply_to_id:     replyToId,
                conteudo:        conteudo.trim(),
                lida:            false,
                thread_count:    0
            }
        });
    } catch (err) {
        logger.error({ err: err.message }, '[CHAT] Erro ao enviar mensagem');
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/usuarios
// ─────────────────────────────────────────────────────────────────────────────
exports.listarUsuarios = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const userId = req.user.id;

        const result = await pool.query(
            `SELECT id, nome, email,
                    CASE WHEN ultimo_acesso > NOW() - INTERVAL '2 minutes' THEN true ELSE false END AS online
             FROM usuarios WHERE escritorio_id = $1 AND id != $2 ORDER BY nome`,
            [escritorioId, userId]
        );

        res.json({ ok: true, usuarios: result.rows });
    } catch (err) {
        logger.error({ err: err.message }, '[CHAT] Erro ao listar usuários');
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/chat/heartbeat
// ─────────────────────────────────────────────────────────────────────────────
exports.heartbeat = async (req, res) => {
    try {
        await pool.query(
            `UPDATE usuarios SET ultimo_acesso = NOW() WHERE id = $1`,
            [req.user.id]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/nao-lidas
// ─────────────────────────────────────────────────────────────────────────────
exports.contarNaoLidas = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const userId = req.user.id;

        const geralResult = await pool.query(
            `SELECT COUNT(*)::int AS total FROM chat_mensagens
             WHERE escritorio_id = $1 AND destinatario_id IS NULL AND remetente_id != $2 AND lida = false`,
            [escritorioId, userId]
        );

        const dmResult = await pool.query(
            `SELECT remetente_id, COUNT(*)::int AS total FROM chat_mensagens
             WHERE escritorio_id = $1 AND destinatario_id = $2 AND lida = false
             GROUP BY remetente_id`,
            [escritorioId, userId]
        );

        const naoLidas = { geral: geralResult.rows[0].total };
        dmResult.rows.forEach(r => { naoLidas[r.remetente_id] = r.total; });

        res.json({ ok: true, naoLidas });
    } catch (err) {
        logger.error({ err: err.message }, '[CHAT] Erro ao contar não lidas');
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat/mensagens/arquivo  — tratado em chat_routes.js
// ─────────────────────────────────────────────────────────────────────────────
exports.enviarArquivo = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' });
        }

        const escritorioId = req.user.escritorio_id;
        const remetenteId  = req.user.id;
        const { destinatario_id } = req.body;
        const destId = destinatario_id ? parseInt(destinatario_id) : null;

        const result = await pool.query(
            `INSERT INTO chat_mensagens
                (escritorio_id, remetente_id, destinatario_id, conteudo, arquivo_nome, arquivo_path)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, criado_em`,
            [escritorioId, remetenteId, destId, `📎 ${req.file.originalname}`, req.file.originalname, req.file.path]
        );

        res.json({
            ok: true,
            mensagem: {
                id:              result.rows[0].id,
                criado_em:       result.rows[0].criado_em,
                remetente_id:    remetenteId,
                remetente_nome:  req.user.nome,
                destinatario_id: destId,
                conteudo:        `📎 ${req.file.originalname}`,
                arquivo_nome:    req.file.originalname,
                lida:            false
            }
        });
    } catch (err) {
        logger.error({ err: err.message }, '[CHAT] Erro ao enviar arquivo');
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/arquivo/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.baixarArquivo = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const msgId = parseInt(req.params.id);

        const result = await pool.query(
            `SELECT arquivo_nome, arquivo_path FROM chat_mensagens WHERE id = $1 AND escritorio_id = $2`,
            [msgId, escritorioId]
        );

        if (result.rows.length === 0 || !result.rows[0].arquivo_path) {
            return res.status(404).json({ ok: false, erro: 'Arquivo não encontrado.' });
        }

        const { arquivo_nome, arquivo_path } = result.rows[0];

        if (arquivo_path.startsWith('chat/')) {
            const fileStorage = require('../utils/storage');
            const found = await fileStorage.download(arquivo_path, res, { filename: arquivo_nome });
            if (found === null) return res.status(404).json({ ok: false, erro: 'Arquivo não encontrado no servidor.' });
            return;
        }

        const fs = require('fs');
        if (!fs.existsSync(arquivo_path)) {
            return res.status(404).json({ ok: false, erro: 'Arquivo não encontrado no servidor.' });
        }
        res.download(arquivo_path, arquivo_nome);
    } catch (err) {
        logger.error({ err: err.message }, '[CHAT] Erro ao baixar arquivo');
        if (!res.headersSent) res.status(500).json({ ok: false, erro: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/chat/mensagens/ler?tipo=geral  ou  ?tipo=dm&usuario_id=X
// ─────────────────────────────────────────────────────────────────────────────
exports.marcarComoLidas = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const userId = req.user.id;
        const { tipo, usuario_id } = req.query;

        if (tipo === 'dm' && usuario_id) {
            await pool.query(
                `UPDATE chat_mensagens SET lida = true
                 WHERE escritorio_id = $1 AND remetente_id = $2 AND destinatario_id = $3 AND lida = false`,
                [escritorioId, parseInt(usuario_id), userId]
            );
        } else {
            await pool.query(
                `UPDATE chat_mensagens SET lida = true
                 WHERE escritorio_id = $1 AND destinatario_id IS NULL AND remetente_id != $2 AND lida = false`,
                [escritorioId, userId]
            );
        }

        res.json({ ok: true });
    } catch (err) {
        logger.error({ err: err.message }, '[CHAT] Erro ao marcar como lidas');
        res.status(500).json({ ok: false, erro: err.message });
    }
};