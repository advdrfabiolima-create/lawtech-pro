const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const { checkFeature } = require('../middlewares/planMiddleware');
const controller = require('../controllers/chatController');
const fileStorage = require('../utils/storage');
const logger = require('../utils/logger');

// ─── Multer (memoryStorage — buffer enviado para R2 ou disco via storage.js) ──
const fileFilter = (req, file, cb) => {
    const allowed = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg', 'image/jpg', 'image/png',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Tipo de arquivo não permitido. Aceitos: PDF, DOC, DOCX, JPG, PNG, XLS, XLSX'), false);
};

const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// ─── Feature gate (aplicado por rota, não globalmente) ────────────────────────
const gate = checkFeature('chat_interno');

// ─── Rotas principais ─────────────────────────────────────────────────────────
router.get('/chat/mensagens',          authMiddleware, gate, controller.listarMensagens);
router.post('/chat/mensagens',         authMiddleware, gate, controller.enviarMensagem);
router.get('/chat/usuarios',           authMiddleware, gate, controller.listarUsuarios);
router.get('/chat/nao-lidas',          authMiddleware, gate, controller.contarNaoLidas);
router.put('/chat/mensagens/ler',      authMiddleware, gate, controller.marcarComoLidas);
router.put('/chat/heartbeat',          authMiddleware, gate, controller.heartbeat);

// ─── Thread / tópico ──────────────────────────────────────────────────────────
router.get('/chat/thread/:msgId',      authMiddleware, gate, controller.listarThread);

// ─── Arquivo ─────────────────────────────────────────────────────────────────
router.post('/chat/mensagens/arquivo', upload.single('arquivo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' });

        const escritorioId = req.user.escritorio_id;
        const remetenteId  = req.user.id;
        const { destinatario_id } = req.body;
        const destId = destinatario_id ? parseInt(destinatario_id) : null;

        const key = `chat/chat_${Date.now()}_${req.file.originalname}`;
        await fileStorage.upload(req.file.buffer, key, req.file.mimetype);

        const result = await pool.query(
            `INSERT INTO chat_mensagens
                (escritorio_id, remetente_id, destinatario_id, conteudo, arquivo_nome, arquivo_path)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, criado_em`,
            [escritorioId, remetenteId, destId, `📎 ${req.file.originalname}`, req.file.originalname, key]
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
});

router.get('/chat/arquivo/:id', authMiddleware, controller.baixarArquivo);

module.exports = router;