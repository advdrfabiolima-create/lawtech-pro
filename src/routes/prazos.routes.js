const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authMiddleware = require('../middlewares/authMiddleware');
const planMiddleware = require('../middlewares/planMiddleware');
const controller = require('../controllers/prazosController');

/**
 * ============================================================
 * 1. ROTAS DE LISTAGEM (O QUE APARECE NA TELA)
 * ============================================================
 */

// Página Principal de Prazos (Resolve o sumição dos dados na listagem geral)
router.get('/prazos', authMiddleware, controller.listarPrazosGeral);
router.get('/todos-prazos-ativos', authMiddleware, controller.listarPrazosGeral);
router.get('/plano-consumo', authMiddleware, controller.planoEConsumo);

// Histórico de Concluídos
router.get('/prazos-concluidos', authMiddleware, controller.listarPrazosConcluidos);

/**
 * ============================================================
 * 2. ROTAS DO DASHBOARD (CARDS COLORIDOS E LISTA REDUZIDA)
 * ============================================================
 */

// Card de Vencidos (Bolinha vermelha do Dashboard)
router.get(
  '/dashboard/prazos-vencidos',
  authMiddleware,
  controller.listarPrazosVencidos
);

// Card da Semana (Bolinha amarela do Dashboard)
router.get('/dashboard/prazos-semana', authMiddleware, controller.listarPrazosSemana);

// Lista de 10 Próximos (Onde as Tags de dias agora vão funcionar)
router.get('/dashboard/prazos-geral', authMiddleware, controller.listarPrazosDashboard);

/**
 * ============================================================
 * 3. ROTAS DE AÇÃO (CRIAR, CONCLUIR, EDITAR E LIMPAR)
 * ============================================================
 */

// 🚨 PRIORIDADE MÁXIMA: Limpeza de lixeira (Deve vir antes de rotas com :id)
// Resolve o erro 404 ao clicar em "Limpar Concluídos"
router.delete('/prazos/concluidos/limpar', authMiddleware, controller.limparPrazosConcluidos);

// Concluir um prazo específico (Check verde)
router.put('/prazos/:id/concluir', authMiddleware, controller.concluirPrazo);

// Operações Básicas (CRUD)
// 🔒 TRAVA: Limite de prazos por mês aplicado aqui
router.post('/prazos', 
    authMiddleware, 
    planMiddleware.checkLimit('prazos'),
    controller.criarPrazo
);

router.put('/prazos/:id', authMiddleware, controller.atualizarPrazo);
router.delete('/prazos/:id', authMiddleware, controller.excluirPrazo);

/**
 * ============================================================
 * 4. CONFIGURAÇÃO DE UPLOAD DE ARQUIVOS (MULTER)
 * ============================================================
 */

// Criar diretório de uploads se não existir
const uploadDir = path.join(__dirname, '..', 'uploads', 'prazos');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('📁 Diretório de uploads criado:', uploadDir);
}

// Configuração do storage do Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Gera nome único: prazo_ID_TIMESTAMP.pdf
        const uniqueName = `prazo_${req.params.id}_${Date.now()}.pdf`;
        cb(null, uniqueName);
    }
});

// Filtro para aceitar apenas PDFs
const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Apenas arquivos PDF são permitidos!'), false);
    }
};

// Configuração completa do Multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB máximo
    }
});

/**
 * ============================================================
 * 5. ROTAS DE ANEXOS PDF
 * ============================================================
 */

// Upload de PDF para um prazo
router.post('/prazos/:id/anexo', 
    authMiddleware, 
    upload.single('pdf'), 
    controller.uploadAnexo
);

// Visualizar/Baixar PDF de um prazo
router.get('/prazos/:id/anexo', 
    authMiddleware, 
    controller.visualizarAnexo
);

// Deletar PDF de um prazo
router.delete('/prazos/:id/anexo', 
    authMiddleware, 
    controller.deletarAnexo
);

module.exports = router;