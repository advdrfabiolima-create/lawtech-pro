const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const roleMiddleware = require('../middlewares/roleMiddleware');

// ─── Upload dir ──────────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '..', 'uploads', 'documentos');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('📁 Diretório uploads/documentos criado:', uploadDir);
}

// ─── Multer ───────────────────────────────────────────────────────────────────
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

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const escritorioId = req.user ? req.user.escritorio_id : 'x';
        const ext = path.extname(file.originalname).toLowerCase();
        const rand = Math.floor(1000 + Math.random() * 9000);
        cb(null, `doc_${escritorioId}_${Date.now()}_${rand}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    if (TIPOS_ACEITOS.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Tipo de arquivo não permitido. Aceitos: PDF, DOC, DOCX, JPG, PNG'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
});

// Wrapper que converte erros Multer em JSON antes de chegar no handler
function uploadMiddleware(field) {
    return (req, res, next) => {
        upload.single(field)(req, res, (err) => {
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// ─── GET /documentos/modelos  (DEVE vir antes de /:id) ───────────────────────
router.get('/documentos/modelos', roleAdminOp, async (req, res) => {
    req.query.eh_modelo = 'true';
    // Reutiliza a lógica de listagem
    return listarDocumentos(req, res);
});

// ─── GET /documentos ─────────────────────────────────────────────────────────
router.get('/documentos', roleAdminOp, async (req, res) => {
    return listarDocumentos(req, res);
});

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
                   u.nome   AS usuario_nome,
                   (SELECT COUNT(*) FROM documentos v
                    WHERE v.id = COALESCE(d.documento_pai_id, d.id)
                       OR v.documento_pai_id = COALESCE(d.documento_pai_id, d.id)
                   ) AS total_versoes,
                   a.assinatura_id,
                   a.assinatura_status
            FROM documentos d
            LEFT JOIN processos  p ON p.id = d.processo_id
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
        console.error('[GED] Erro ao listar documentos:', err.message);
        res.status(500).json({ erro: 'Erro ao listar documentos' });
    }
}

// ─── POST /documentos ─────────────────────────────────────────────────────────
router.post('/documentos', roleAdminOp, uploadMiddleware('arquivo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });

    const { nome, descricao, categoria, tags, processo_id, eh_modelo } = req.body;

    if (!nome || !nome.trim()) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ erro: 'Nome do documento é obrigatório' });
    }
    const cat = CATEGORIAS_VALIDAS.includes(categoria) ? categoria : 'outros';

    try {
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
            req.file.filename,
            req.file.originalname,
            req.file.mimetype,
            req.file.size,
            eh_modelo === 'true' || eh_modelo === true
        ]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('[GED] Erro ao criar documento:', err.message);
        res.status(500).json({ erro: 'Erro ao salvar documento' });
    }
});

// ─── POST /documentos/:id/versao ─────────────────────────────────────────────
router.post('/documentos/:id/versao', roleAdminOp, uploadMiddleware('arquivo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });

    const escritorioId = req.user.escritorio_id;
    const docId = parseInt(req.params.id);

    try {
        // Buscar documento original (raiz da família)
        const orig = await pool.query(
            `SELECT * FROM documentos WHERE id = $1 AND escritorio_id = $2`,
            [docId, escritorioId]
        );
        if (orig.rows.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ erro: 'Documento não encontrado' });
        }
        const doc = orig.rows[0];
        const paiId = doc.documento_pai_id || doc.id;

        // Próxima versão
        const maxRes = await pool.query(
            `SELECT MAX(versao) AS max_v FROM documentos WHERE id = $1 OR documento_pai_id = $1`,
            [paiId]
        );
        const proximaVersao = (maxRes.rows[0].max_v || 1) + 1;

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
            req.file.filename,
            req.file.originalname,
            req.file.mimetype,
            req.file.size,
            proximaVersao,
            paiId,
            doc.eh_modelo
        ]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('[GED] Erro ao criar versão:', err.message);
        res.status(500).json({ erro: 'Erro ao salvar nova versão' });
    }
});

// ─── GET /documentos/:id/versoes ─────────────────────────────────────────────
router.get('/documentos/:id/versoes', roleAdminOp, async (req, res) => {
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
            WHERE d.escritorio_id = $1
              AND (d.id = $2 OR d.documento_pai_id = $2)
            ORDER BY d.versao ASC
        `, [escritorioId, paiId]);

        res.json(result.rows);
    } catch (err) {
        console.error('[GED] Erro ao listar versões:', err.message);
        res.status(500).json({ erro: 'Erro ao listar versões' });
    }
});

// ─── GET /documentos/:id/arquivo ─────────────────────────────────────────────
router.get('/documentos/:id/arquivo', roleAdminOp, async (req, res) => {
    const escritorioId = req.user.escritorio_id;
    const docId = parseInt(req.params.id);

    try {
        const result = await pool.query(
            `SELECT * FROM documentos WHERE id = $1 AND escritorio_id = $2`,
            [docId, escritorioId]
        );
        if (result.rows.length === 0) return res.status(404).json({ erro: 'Documento não encontrado' });

        const doc = result.rows[0];
        const filePath = path.join(uploadDir, doc.arquivo_nome);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ erro: 'Arquivo não encontrado no servidor' });
        }

        const stats = fs.statSync(filePath);
        const isInline = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'].includes(doc.mimetype);
        const disposition = isInline
            ? `inline; filename="${encodeURIComponent(doc.arquivo_original)}"`
            : `attachment; filename="${encodeURIComponent(doc.arquivo_original)}"`;

        res.setHeader('Content-Type', doc.mimetype);
        res.setHeader('Content-Disposition', disposition);
        res.setHeader('Content-Length', stats.size);

        fs.createReadStream(filePath).pipe(res);
    } catch (err) {
        console.error('[GED] Erro ao servir arquivo:', err.message);
        res.status(500).json({ erro: 'Erro ao servir arquivo' });
    }
});

// ─── PATCH /documentos/:id ───────────────────────────────────────────────────
router.patch('/documentos/:id', roleAdminOp, async (req, res) => {
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
        console.error('[GED] Erro ao editar documento:', err.message);
        res.status(500).json({ erro: 'Erro ao editar documento' });
    }
});

// ─── DELETE /documentos/:id ──────────────────────────────────────────────────
router.delete('/documentos/:id', roleAdmin, async (req, res) => {
    const escritorioId = req.user.escritorio_id;
    const docId = parseInt(req.params.id);

    try {
        const orig = await pool.query(
            `SELECT id, documento_pai_id FROM documentos WHERE id = $1 AND escritorio_id = $2`,
            [docId, escritorioId]
        );
        if (orig.rows.length === 0) return res.status(404).json({ erro: 'Documento não encontrado' });

        const paiId = orig.rows[0].documento_pai_id || orig.rows[0].id;

        // Buscar todos os arquivos da família
        const familia = await pool.query(
            `SELECT arquivo_nome FROM documentos
             WHERE escritorio_id = $1 AND (id = $2 OR documento_pai_id = $2)`,
            [escritorioId, paiId]
        );

        // Deletar registros
        await pool.query(
            `DELETE FROM documentos WHERE escritorio_id = $1 AND (id = $2 OR documento_pai_id = $2)`,
            [escritorioId, paiId]
        );

        // Deletar arquivos do disco
        for (const row of familia.rows) {
            const fp = path.join(uploadDir, row.arquivo_nome);
            if (fs.existsSync(fp)) {
                try { fs.unlinkSync(fp); } catch (e) { /* ignora */ }
            }
        }

        res.json({ ok: true, mensagem: 'Documento e todas as versões foram excluídos' });
    } catch (err) {
        console.error('[GED] Erro ao excluir documento:', err.message);
        res.status(500).json({ erro: 'Erro ao excluir documento' });
    }
});

module.exports = router;
