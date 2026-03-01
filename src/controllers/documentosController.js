const multer = require('multer');
const path = require('path');
const pool = require('../config/db');
const storage = require('../utils/storage');
const logger = require('../utils/logger');

// ── Constants ─────────────────────────────────────────────────────────────────
const TIPOS_ACEITOS = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/jpg',
    'image/png'
];

const CATEGORIAS_VALIDAS = [
    'peticao', 'contrato', 'procuracao', 'decisao', 'citacao',
    'recurso', 'laudo', 'acordo', 'comprovante', 'modelo', 'outros'
];

// ── Multer ────────────────────────────────────────────────────────────────────
const _upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (TIPOS_ACEITOS.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de arquivo não permitido. Aceitos: PDF, DOC, DOCX, JPG, PNG'), false);
        }
    },
    limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
});

function uploadMiddleware(field) {
    return (req, res, next) => {
        _upload.single(field)(req, res, (err) => {
            if (err instanceof multer.MulterError) {
                return res.status(400).json({ erro: `Erro de upload: ${err.message}` });
            }
            if (err) {
                return res.status(400).json({ erro: err.message });
            }
            next();
        });
    };
}

// ── Role helpers ──────────────────────────────────────────────────────────────
function roleAdminOp(req, res, next) {
    if (!req.user || !['admin', 'operador'].includes(req.user.role)) {
        return res.status(403).json({ erro: 'Acesso negado' });
    }
    next();
}

function roleAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ erro: 'Apenas administradores podem excluir documentos' });
    }
    next();
}

// ── Handlers ──────────────────────────────────────────────────────────────────
async function listarDocumentos(req, res) {
    try {
        const escritorioId = req.user.escritorio_id;
        const processoId = req.query.processo_id ? parseInt(req.query.processo_id) : null;
        const q = req.query.q ? `%${req.query.q}%` : null;
        const categoria = req.query.categoria || null;
        const ehModelo = req.query.eh_modelo === 'true' ? true : req.query.eh_modelo === 'false' ? false : null;

        const result = await pool.query(`
            SELECT d.*,
                   p.numero AS processo_numero,
                   c.nome   AS cliente_nome,
                   u.nome   AS usuario_nome,
                   (SELECT COUNT(*) FROM documentos v
                    WHERE v.id = COALESCE(d.documento_pai_id, d.id)
                       OR v.documento_pai_id = COALESCE(d.documento_pai_id, d.id)
                   ) AS total_versoes,
                   a.assinatura_id,
                   a.assinatura_status
            FROM documentos d
            LEFT JOIN processos  p ON p.id = d.processo_id
            LEFT JOIN clientes   c ON c.id = p.cliente_id
            LEFT JOIN usuarios   u ON u.id = d.usuario_id
            LEFT JOIN (
                SELECT DISTINCT ON (documento_id) documento_id, id AS assinatura_id, status AS assinatura_status
                FROM assinaturas_digitais
                WHERE status NOT IN ('cancelado', 'erro')
                ORDER BY documento_id, criado_em DESC
            ) a ON a.documento_id = d.id
            WHERE d.escritorio_id = $1
              AND NOT EXISTS (
                  SELECT 1 FROM documentos newer
                  WHERE newer.documento_pai_id = COALESCE(d.documento_pai_id, d.id)
                    AND newer.versao > d.versao
              )
              AND ($2::int  IS NULL OR d.processo_id = $2)
              AND ($3::text IS NULL OR d.nome ILIKE $3 OR d.descricao ILIKE $3 OR d.tags ILIKE $3)
              AND ($4::text IS NULL OR d.categoria = $4)
              AND ($5::bool IS NULL OR d.eh_modelo  = $5)
            ORDER BY d.criado_em DESC
            LIMIT 200
        `, [escritorioId, processoId, q, categoria, ehModelo]);

        res.json(result.rows);
    } catch (err) {
        logger.error({ err: err.message }, 'GED: erro ao listar documentos');
        res.status(500).json({ erro: 'Erro ao listar documentos' });
    }
}

async function criarDocumento(req, res) {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });

    const { nome, descricao, categoria, tags, processo_id, eh_modelo } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Nome do documento é obrigatório' });

    const cat = CATEGORIAS_VALIDAS.includes(categoria) ? categoria : 'outros';
    const ext = path.extname(req.file.originalname).toLowerCase();
    const rand = Math.floor(1000 + Math.random() * 9000);
    const arquivo_nome = `doc_${req.user.escritorio_id}_${Date.now()}_${rand}${ext}`;
    const key = `documentos/${arquivo_nome}`;

    try {
        await storage.upload(req.file.buffer, key, req.file.mimetype);

        const result = await pool.query(`
            INSERT INTO documentos
                (escritorio_id, processo_id, usuario_id, nome, descricao, categoria, tags,
                 arquivo_nome, arquivo_original, mimetype, tamanho, versao, eh_modelo)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12)
            RETURNING *
        `, [
            req.user.escritorio_id,
            processo_id ? parseInt(processo_id) : null,
            req.user.id,
            nome.trim(),
            descricao || null,
            cat,
            tags || null,
            arquivo_nome,
            path.basename(req.file.originalname),
            req.file.mimetype,
            req.file.size,
            eh_modelo === 'true' || eh_modelo === true
        ]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        await storage.delete(key).catch(() => {});
        logger.error({ err: err.message }, 'GED: erro ao criar documento');
        res.status(500).json({ erro: 'Erro ao salvar documento' });
    }
}

async function criarVersao(req, res) {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });

    const escritorioId = req.user.escritorio_id;
    const docId = parseInt(req.params.id);
    const ext = path.extname(req.file.originalname).toLowerCase();
    const rand = Math.floor(1000 + Math.random() * 9000);
    const arquivo_nome = `doc_${escritorioId}_${Date.now()}_${rand}${ext}`;
    const key = `documentos/${arquivo_nome}`;

    try {
        const orig = await pool.query(
            `SELECT * FROM documentos WHERE id = $1 AND escritorio_id = $2`,
            [docId, escritorioId]
        );
        if (orig.rows.length === 0) return res.status(404).json({ erro: 'Documento não encontrado' });

        const doc = orig.rows[0];
        const paiId = doc.documento_pai_id || doc.id;

        const maxRes = await pool.query(
            `SELECT MAX(versao) AS max_v FROM documentos WHERE id = $1 OR documento_pai_id = $1`,
            [paiId]
        );
        const proximaVersao = (maxRes.rows[0].max_v || 1) + 1;

        await storage.upload(req.file.buffer, key, req.file.mimetype);

        const result = await pool.query(`
            INSERT INTO documentos
                (escritorio_id, processo_id, usuario_id, nome, descricao, categoria, tags,
                 arquivo_nome, arquivo_original, mimetype, tamanho, versao, documento_pai_id, eh_modelo)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            RETURNING *
        `, [
            escritorioId,
            doc.processo_id,
            req.user.id,
            req.body.nome ? req.body.nome.trim() : doc.nome,
            req.body.descricao || doc.descricao,
            doc.categoria,
            doc.tags,
            arquivo_nome,
            path.basename(req.file.originalname),
            req.file.mimetype,
            req.file.size,
            proximaVersao,
            paiId,
            doc.eh_modelo
        ]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        await storage.delete(key).catch(() => {});
        logger.error({ err: err.message }, 'GED: erro ao criar versao');
        res.status(500).json({ erro: 'Erro ao salvar nova versão' });
    }
}

async function listarVersoes(req, res) {
    const escritorioId = req.user.escritorio_id;
    const docId = parseInt(req.params.id);
    try {
        const orig = await pool.query(
            `SELECT id, documento_pai_id FROM documentos WHERE id = $1 AND escritorio_id = $2`,
            [docId, escritorioId]
        );
        if (orig.rows.length === 0) return res.status(404).json({ erro: 'Documento não encontrado' });

        const paiId = orig.rows[0].documento_pai_id || orig.rows[0].id;
        const result = await pool.query(`
            SELECT d.*, u.nome AS usuario_nome
            FROM documentos d
            LEFT JOIN usuarios u ON u.id = d.usuario_id
            WHERE d.escritorio_id = $1 AND (d.id = $2 OR d.documento_pai_id = $2)
            ORDER BY d.versao ASC
        `, [escritorioId, paiId]);

        res.json(result.rows);
    } catch (err) {
        logger.error({ err: err.message }, 'GED: erro ao listar versoes');
        res.status(500).json({ erro: 'Erro ao listar versões' });
    }
}

async function servirArquivo(req, res) {
    const escritorioId = req.user.escritorio_id;
    const docId = parseInt(req.params.id);
    try {
        const result = await pool.query(
            `SELECT * FROM documentos WHERE id = $1 AND escritorio_id = $2`,
            [docId, escritorioId]
        );
        if (result.rows.length === 0) return res.status(404).json({ erro: 'Documento não encontrado' });

        const doc = result.rows[0];
        const key = `documentos/${doc.arquivo_nome}`;
        const found = await storage.download(key, res, { mimetype: doc.mimetype, filename: doc.arquivo_original });
        if (found === null) return res.status(404).json({ erro: 'Arquivo não encontrado no servidor' });
    } catch (err) {
        logger.error({ err: err.message }, 'GED: erro ao servir arquivo');
        if (!res.headersSent) res.status(500).json({ erro: 'Erro ao servir arquivo' });
    }
}

async function editarDocumento(req, res) {
    const escritorioId = req.user.escritorio_id;
    const docId = parseInt(req.params.id);
    const { nome, descricao, tags, categoria } = req.body;
    try {
        const cat = categoria && CATEGORIAS_VALIDAS.includes(categoria) ? categoria : undefined;
        const result = await pool.query(`
            UPDATE documentos
            SET nome          = COALESCE($1, nome),
                descricao     = COALESCE($2, descricao),
                tags          = COALESCE($3, tags),
                categoria     = COALESCE($4, categoria),
                atualizado_em = NOW()
            WHERE id = $5 AND escritorio_id = $6
            RETURNING *
        `, [
            nome ? nome.trim() : null,
            descricao !== undefined ? descricao : null,
            tags !== undefined ? tags : null,
            cat || null,
            docId,
            escritorioId
        ]);
        if (result.rows.length === 0) return res.status(404).json({ erro: 'Documento não encontrado' });
        res.json(result.rows[0]);
    } catch (err) {
        logger.error({ err: err.message }, 'GED: erro ao editar documento');
        res.status(500).json({ erro: 'Erro ao editar documento' });
    }
}

async function excluirDocumento(req, res) {
    const escritorioId = req.user.escritorio_id;
    const docId = parseInt(req.params.id);
    try {
        const orig = await pool.query(
            `SELECT id, documento_pai_id FROM documentos WHERE id = $1 AND escritorio_id = $2`,
            [docId, escritorioId]
        );
        if (orig.rows.length === 0) return res.status(404).json({ erro: 'Documento não encontrado' });

        const paiId = orig.rows[0].documento_pai_id || orig.rows[0].id;

        const familia = await pool.query(
            `SELECT arquivo_nome FROM documentos WHERE escritorio_id = $1 AND (id = $2 OR documento_pai_id = $2)`,
            [escritorioId, paiId]
        );

        await pool.query(
            `DELETE FROM documentos WHERE escritorio_id = $1 AND (id = $2 OR documento_pai_id = $2)`,
            [escritorioId, paiId]
        );

        for (const row of familia.rows) {
            await storage.delete(`documentos/${row.arquivo_nome}`).catch(() => {});
        }

        res.json({ ok: true, mensagem: 'Documento e todas as versões foram excluídos' });
    } catch (err) {
        logger.error({ err: err.message }, 'GED: erro ao excluir documento');
        res.status(500).json({ erro: 'Erro ao excluir documento' });
    }
}

module.exports = {
    uploadMiddleware,
    roleAdminOp,
    roleAdmin,
    listarDocumentos,
    criarDocumento,
    criarVersao,
    listarVersoes,
    servirArquivo,
    editarDocumento,
    excluirDocumento
};
