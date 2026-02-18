const pool = require('../config/db');

// GET /api/chat/mensagens?tipo=geral&ultimo_id=0
// GET /api/chat/mensagens?tipo=dm&usuario_id=X&ultimo_id=0
exports.listarMensagens = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const userId = req.user.id;
        const { tipo, usuario_id, ultimo_id } = req.query;
        const lastId = parseInt(ultimo_id) || 0;

        let result;

        if (tipo === 'dm' && usuario_id) {
            const outroId = parseInt(usuario_id);

            // Marcar como lidas as mensagens recebidas nesta DM
            await pool.query(
                `UPDATE chat_mensagens SET lida = true
                 WHERE escritorio_id = $1 AND remetente_id = $2 AND destinatario_id = $3 AND lida = false`,
                [escritorioId, outroId, userId]
            );

            result = await pool.query(
                `SELECT m.id, m.conteudo,
                        (m.criado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') AS criado_em,
                        m.remetente_id, m.destinatario_id, m.lida, m.arquivo_nome,
                        u.nome AS remetente_nome
                 FROM chat_mensagens m
                 JOIN usuarios u ON u.id = m.remetente_id
                 WHERE m.escritorio_id = $1
                   AND ((m.remetente_id = $2 AND m.destinatario_id = $3) OR (m.remetente_id = $3 AND m.destinatario_id = $2))
                   AND m.id > $4
                 ORDER BY m.id ASC
                 LIMIT 100`,
                [escritorioId, userId, outroId, lastId]
            );
        } else {
            // Chat geral
            // Marcar como lidas as mensagens gerais (de outros) ao buscar
            await pool.query(
                `UPDATE chat_mensagens SET lida = true
                 WHERE escritorio_id = $1 AND destinatario_id IS NULL AND remetente_id != $2 AND lida = false`,
                [escritorioId, userId]
            );

            result = await pool.query(
                `SELECT m.id, m.conteudo,
                        (m.criado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') AS criado_em,
                        m.remetente_id, m.destinatario_id, m.lida, m.arquivo_nome,
                        u.nome AS remetente_nome
                 FROM chat_mensagens m
                 JOIN usuarios u ON u.id = m.remetente_id
                 WHERE m.escritorio_id = $1 AND m.destinatario_id IS NULL AND m.id > $2
                 ORDER BY m.id ASC
                 LIMIT 100`,
                [escritorioId, lastId]
            );
        }

        res.json({ ok: true, mensagens: result.rows });
    } catch (err) {
        console.error('[CHAT] Erro ao listar mensagens:', err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// POST /api/chat/mensagens
exports.enviarMensagem = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const remetenteId = req.user.id;
        const { conteudo, destinatario_id } = req.body;

        if (!conteudo || !conteudo.trim()) {
            return res.status(400).json({ ok: false, erro: 'Conteúdo da mensagem é obrigatório.' });
        }

        const destId = destinatario_id ? parseInt(destinatario_id) : null;

        const result = await pool.query(
            `INSERT INTO chat_mensagens (escritorio_id, remetente_id, destinatario_id, conteudo)
             VALUES ($1, $2, $3, $4)
             RETURNING id, (criado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') AS criado_em`,
            [escritorioId, remetenteId, destId, conteudo.trim()]
        );

        res.json({
            ok: true,
            mensagem: {
                id: result.rows[0].id,
                criado_em: result.rows[0].criado_em,
                remetente_id: remetenteId,
                remetente_nome: req.user.nome,
                destinatario_id: destId,
                conteudo: conteudo.trim(),
                lida: false
            }
        });
    } catch (err) {
        console.error('[CHAT] Erro ao enviar mensagem:', err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// GET /api/chat/usuarios
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
        console.error('[CHAT] Erro ao listar usuários:', err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// PUT /api/chat/heartbeat
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

// GET /api/chat/nao-lidas
exports.contarNaoLidas = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const userId = req.user.id;

        // Não lidas no chat geral (de outros usuários)
        const geralResult = await pool.query(
            `SELECT COUNT(*)::int AS total FROM chat_mensagens
             WHERE escritorio_id = $1 AND destinatario_id IS NULL AND remetente_id != $2 AND lida = false`,
            [escritorioId, userId]
        );

        // Não lidas em DMs agrupadas por remetente
        const dmResult = await pool.query(
            `SELECT remetente_id, COUNT(*)::int AS total FROM chat_mensagens
             WHERE escritorio_id = $1 AND destinatario_id = $2 AND lida = false
             GROUP BY remetente_id`,
            [escritorioId, userId]
        );

        const naoLidas = { geral: geralResult.rows[0].total };
        dmResult.rows.forEach(r => {
            naoLidas[r.remetente_id] = r.total;
        });

        res.json({ ok: true, naoLidas });
    } catch (err) {
        console.error('[CHAT] Erro ao contar não lidas:', err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// POST /api/chat/mensagens/arquivo
exports.enviarArquivo = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' });
        }

        const escritorioId = req.user.escritorio_id;
        const remetenteId = req.user.id;
        const { destinatario_id } = req.body;
        const destId = destinatario_id ? parseInt(destinatario_id) : null;

        const result = await pool.query(
            `INSERT INTO chat_mensagens (escritorio_id, remetente_id, destinatario_id, conteudo, arquivo_nome, arquivo_path)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, (criado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') AS criado_em`,
            [escritorioId, remetenteId, destId, `📎 ${req.file.originalname}`, req.file.originalname, req.file.path]
        );

        res.json({
            ok: true,
            mensagem: {
                id: result.rows[0].id,
                criado_em: result.rows[0].criado_em,
                remetente_id: remetenteId,
                remetente_nome: req.user.nome,
                destinatario_id: destId,
                conteudo: `📎 ${req.file.originalname}`,
                arquivo_nome: req.file.originalname,
                lida: false
            }
        });
    } catch (err) {
        console.error('[CHAT] Erro ao enviar arquivo:', err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// GET /api/chat/arquivo/:id
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
        const path = require('path');
        const fs = require('fs');

        if (!fs.existsSync(arquivo_path)) {
            return res.status(404).json({ ok: false, erro: 'Arquivo não encontrado no servidor.' });
        }

        res.download(arquivo_path, arquivo_nome);
    } catch (err) {
        console.error('[CHAT] Erro ao baixar arquivo:', err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// PUT /api/chat/mensagens/ler?tipo=geral  ou  ?tipo=dm&usuario_id=X
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
        console.error('[CHAT] Erro ao marcar como lidas:', err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
};
