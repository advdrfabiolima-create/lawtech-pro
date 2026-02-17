const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authMiddleware = require('../middlewares/authMiddleware');
const controller = require('../controllers/chatController');

// Configuração Multer para uploads de chat
const uploadDir = path.join(__dirname, '..', 'uploads', 'chat');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('📁 Diretório de uploads/chat criado:', uploadDir);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueName = `chat_${Date.now()}_${file.originalname}`;
        cb(null, uniqueName);
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Tipo de arquivo não permitido. Aceitos: PDF, DOC, DOCX, JPG, PNG, XLS, XLSX'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Rotas existentes
router.get('/chat/mensagens', authMiddleware, controller.listarMensagens);
router.post('/chat/mensagens', authMiddleware, controller.enviarMensagem);
router.get('/chat/usuarios', authMiddleware, controller.listarUsuarios);
router.get('/chat/nao-lidas', authMiddleware, controller.contarNaoLidas);
router.put('/chat/mensagens/ler', authMiddleware, controller.marcarComoLidas);

// Rotas de arquivo
router.post('/chat/mensagens/arquivo', authMiddleware, upload.single('arquivo'), controller.enviarArquivo);
router.get('/chat/arquivo/:id', authMiddleware, controller.baixarArquivo);

module.exports = router;
