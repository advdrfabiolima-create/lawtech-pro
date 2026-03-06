require('dotenv').config();

// ── Validação de variáveis de ambiente ────────────────────────────────────────
const _REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY'];
const _CRITICAL = ['BREVO_API_KEY', 'MASTER_EMAIL', 'MASTER_PASSWORD'];
const _missing = _REQUIRED.filter(v => !process.env[v]);
if (_missing.length > 0) {
    console.error(`[FATAL] Variáveis obrigatórias ausentes: ${_missing.join(', ')}`);
    console.error('[FATAL] Configure no Railway → Variables e faça novo deploy.');
    process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
    const _warn = _CRITICAL.filter(v => !process.env[v]);
    if (_warn.length > 0)
        console.warn(`[WARN] Variáveis críticas não configuradas: ${_warn.join(', ')}`);
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Sentry: inicializar antes de qualquer require de rotas ───────────────────
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'production'
    });
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./config/db');
const logger = require('./utils/logger');
const requestLogger = require('./middlewares/requestLogger');
const recibosRoutes = require('./routes/recibos.routes');

// --- 1. IMPORTAÃ‡ÃƒO DE ROTAS ---
const authRoutes = require('./routes/auth.routes');
const prazosRoutes = require('./routes/prazos.routes');
const planosRoutes = require('./routes/planos.routes');
const financeiroRoutes = require('./routes/financeiro.routes');
const audienciasRoutes = require('./routes/audiencias.routes');
const processosRoutes = require('./routes/processos.routes');
const calculosRoutes = require('./routes/calculos.routes');
const pagamentosRoutes = require('./routes/pagamentos.routes');
const clientesRoutes = require('./routes/clientes.routes');
const configRoutes = require('./routes/config.routes');
const publicacoesRoutes = require('./routes/publicacoes.routes');
const iaRoutes = require('./routes/ia.routes');
const crmPublicRoutes = require('./routes/crm.public.routes');
const crmRoutes = require('./routes/crm.routes');
const usuariosRoutes = require('./routes/usuarios.routes');
const adminRoutes = require('./routes/admin.routes');
const partesProcessoRoutes = require('./routes/partesProcesso.routes');
const peticoesRoutes = require('./routes/peticoes.routes');
const syncRoutes = require('./routes/sync.routes');
const assinaturaRoutes = require('./routes/assinatura_routes');
const stripeWebhookRoutes = require('./routes/stripe.webhook.routes');
const lgpdRoutes = require('./routes/lgpd.routes');
const calendarioRoutes = require('./routes/calendario.routes');
const notificacoesRoutes = require('./routes/notificacoes.routes');
const relatoriosRoutes = require('./routes/relatorios.routes');
const chatRoutes = require('./routes/chat.routes');
const contatoRoutes = require('./routes/contato.routes');
const documentosRoutes = require('./routes/documentos.routes');
const assinaturaDigitalRoutes = require('./routes/assinaturaDigital.routes');
const addonClicksignRoutes = require('./routes/addonClicksign.routes');
const calendarSyncRoutes = require('./routes/calendarSync.routes');
const andamentosRoutes = require('./routes/andamentos.routes');
const portalClienteRoutes = require('./routes/portalCliente.routes');
const reunioesRoutes = require('./routes/reunioes.routes');
const fileStorage = require('./utils/storage');
const cache = require('./utils/cache');
const { version: APP_VERSION } = require('../package.json');

// --- 2. MIDDLEWARES DE AUTENTICAÃ‡ÃƒO ---
const authMiddleware = require('./middlewares/authMiddleware');
const roleMiddleware = require('./middlewares/roleMiddleware');
const verificarPagamento = require('./middlewares/financeiroMiddleware');

// ðŸš€ 3. INICIALIZAÃ‡ÃƒO DO APP
const app = express();

// Confiar no proxy reverso (Railway, Heroku, etc.) para obter IP real dos usuários
app.set('trust proxy', 1);

// --- 4a. HTTPS ENFORCEMENT EM PRODUÇÃO ---
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        const proto = req.header('x-forwarded-proto');
        // Só redireciona quando atrás de proxy (header presente) e não é HTTPS
        if (proto && proto !== 'https') {
            return res.redirect(301, `https://${req.header('host')}${req.url}`);
        }
        if (proto === 'https') {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }
        next();
    });
}

// --- 4b. 🔴 WEBHOOK DO STRIPE (ANTES DOS MIDDLEWARES DE PARSING) ---
// CRÍTICO: Esta rota DEVE vir ANTES do express.json() para receber raw body
app.use('/webhook', stripeWebhookRoutes);

// --- 4c. WEBHOOK CLICKSIGN — captura raw body para verificação HMAC ---
// Deve vir ANTES do express.json() para ter acesso ao body bruto
app.use('/webhook/clicksign', express.raw({ type: 'application/json', limit: '5mb' }), (req, res, next) => {
    if (Buffer.isBuffer(req.body)) {
        req.rawBody = req.body.toString('utf8');
        try { req.body = JSON.parse(req.rawBody); } catch (e) { req.body = {}; }
    }
    next();
});

// --- 5. MIDDLEWARE DE SEGURANÇA MÁXIMA (MASTER ADMIN) ---
const masterAdminOnly = (req, res, next) => {
    if (req.user && req.user.eh_master) {
        return next();
    }
    logger.warn({ email: req.user?.email || 'Desconhecido' }, '[SEGURANÇA] Acesso não autorizado ao Monitor');
    return res.status(403).json({ ok: false, erro: "Acesso restrito ao proprietário do sistema." });
};

// --- 6. CONFIGURAÇÕES GLOBAIS ---
app.use(requestLogger);
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// Sanitização XSS global em todos os inputs
const { sanitizeBody } = require('./middlewares/sanitizeMiddleware');
app.use(sanitizeBody);

// CORS restritivo - apenas domínios autorizados
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
    origin: function (origin, callback) {
        // Permitir requests sem origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        // Em desenvolvimento, permitir localhost
        if (!allowedOrigins.length || origin.includes('localhost') || origin.includes('127.0.0.1')) {
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Bloqueado por CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Headers de segurança
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "https://cdn.jsdelivr.net",
                "https://unpkg.com",
                "https://cdn.tailwindcss.com",
                "https://cdnjs.cloudflare.com",
                "https://js.stripe.com"
            ],
            scriptSrcAttr: ["'unsafe-inline'"], // permite onclick/onsubmit inline nas páginas ainda não migradas
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: [
    "'self'",
    "https://api.brevo.com",
    "https://api.asaas.com",
    "https://sandbox.asaas.com",
    "https://*.peerjs.com",
    "wss://*.peerjs.com",      // WebSocket do PeerJS
    "https://unpkg.com"        // source maps do unpkg
],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            frameSrc: ["'self'", "https://*.daily.co", "https://js.stripe.com"],
            frameAncestors: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

// Rate limiting global
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 500, // 500 requests por IP a cada 15 min
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas requisições. Tente novamente em alguns minutos.' }
});
app.use('/api', globalLimiter);

// Rate limiting mais permissivo para chat (polling frequente)
const chatLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1500, // 1500 requests por IP a cada 15 min (polling de chat)
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas requisições de chat. Aguarde um momento.' }
});
app.use('/api/chat', chatLimiter);

// Rate limiting rigoroso para autenticação
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15, // 15 tentativas a cada 15 min
    message: { erro: 'Muitas tentativas de login. Aguarde 15 minutos.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/recuperar-senha', authLimiter);
app.use('/api/auth/nova-senha', authLimiter);

// Rate limiting para endpoints de pagamento
const paymentLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 5, // 5 tentativas por minuto
    message: { erro: 'Muitas tentativas de pagamento. Aguarde um momento.' }
});
app.use('/api/pagamentos/assinar-plano', paymentLimiter);
app.use('/api/pagamentos/cobrar-renovacao', paymentLimiter);
app.use('/api/pagamentos/salvar-cartao', paymentLimiter);

// Rate limiting para pagamento de trial expirado (permite polling PIX a cada 5s)
const trialPaymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 150, // generoso para cobrir polling de ~12 minutos + tentativas de pagamento
    message: { erro: 'Muitas tentativas. Aguarde alguns minutos.' }
});
app.use('/api/auth/pagar-trial-pix', trialPaymentLimiter);
app.use('/api/auth/verificar-pix', trialPaymentLimiter);
app.use('/api/auth/pagar-trial-cartao', trialPaymentLimiter);

// Rate limiting para endpoints de IA (custo alto por request)
const iaLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 10, // 10 requests por minuto
    message: { erro: 'Limite de uso da IA atingido. Aguarde um momento.' }
});
app.use('/api/ia', iaLimiter);
app.use('/api/peticoes/gerar', iaLimiter);
app.use('/api/analisar-prazo', iaLimiter);

// Rate limiting para formulário de contato (anti-spam)
const contatoLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 5, // máximo 5 envios por hora por IP
    message: { erro: 'Muitos envios de contato. Tente novamente em uma hora.' }
});
app.use('/api/contato', contatoLimiter);

// --- 7. SERVIR ARQUIVOS ESTÃTICOS ---
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));
// Uploads locais — servidos apenas quando R2 não está ativo (fallback disco)
if (!fileStorage.isR2Active()) {
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
    app.use('/logos', express.static(path.join(__dirname, 'uploads', 'logos')));
}

// --- 7b. HEALTH CHECK (público, fora do rate limiter /api) ---
app.get('/health', async (req, res) => {
    const checks = {};

    // Banco de dados — crítico
    try {
        await pool.query('SELECT 1');
        checks.database = 'ok';
    } catch (_) {
        checks.database = 'error';
    }

    // Redis — opcional
    try {
        const redisUp = await cache.ping();
        checks.redis = redisUp ? 'ok' : (process.env.REDIS_URL ? 'error' : 'not_configured');
    } catch (_) {
        checks.redis = 'error';
    }

    const dbOk = checks.database === 'ok';
    res.status(dbOk ? 200 : 503).json({
        status: dbOk ? 'ok' : 'degraded',
        version: APP_VERSION,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        checks
    });
});

// --- 8. APIs (ROTAS DE DADOS) ---
app.use('/api/auth', authRoutes);
app.use('/api/portal', portalClienteRoutes); // Portal do Cliente — cada rota gerencia seu próprio middleware
app.use('/api/contato', contatoRoutes); // 📬 público — formulário de contato do site
app.use('/api', iaRoutes);
app.use('/api/crm/public', crmPublicRoutes); // ðŸ"" pÃºblico
app.use('/api/crm', authMiddleware, crmRoutes);
logger.info('Rotas CRM registradas no servidor principal');
app.use('/api', authMiddleware, verificarPagamento, prazosRoutes);
app.use('/api', authMiddleware, verificarPagamento, processosRoutes);
app.use('/api', calculosRoutes);
app.use('/api', audienciasRoutes);
app.use('/api', planosRoutes);
app.use('/api', authMiddleware, verificarPagamento, financeiroRoutes);
app.use('/api', authMiddleware, verificarPagamento, clientesRoutes);
app.use('/api', configRoutes);
app.use('/api', usuariosRoutes);
app.use('/api/pagamentos', pagamentosRoutes);
app.use('/api', publicacoesRoutes);
app.use('/api', recibosRoutes);
app.use('/api', partesProcessoRoutes);
app.use('/api/peticoes', authMiddleware, peticoesRoutes);
app.use('/api', syncRoutes);
app.use('/api/pagamentos', assinaturaRoutes);
app.use('/api/lgpd', lgpdRoutes);
app.use('/api', authMiddleware, verificarPagamento, calendarioRoutes);
app.use('/api', notificacoesRoutes);
app.use('/api', authMiddleware, verificarPagamento, relatoriosRoutes);
app.use('/api', authMiddleware, verificarPagamento, chatRoutes);
app.use('/api', authMiddleware, verificarPagamento, documentosRoutes);
app.use('/api', authMiddleware, verificarPagamento, andamentosRoutes);
app.use('/api', authMiddleware, verificarPagamento, reunioesRoutes);
app.use('/webhook', assinaturaDigitalRoutes); // ClickSign webhook — público (APÓS express.json)
app.use('/api', authMiddleware, verificarPagamento, assinaturaDigitalRoutes);
app.use('/api', authMiddleware, verificarPagamento, addonClicksignRoutes);
app.use('/', calendarSyncRoutes);

// âœ… Rota do monitor admin
app.get('/systems/monitor', (req, res) => {
    res.sendFile(path.join(publicPath, 'admin-monitor.html'));
});

// âœ… ProteÃ§Ã£o das rotas de dados do admin
app.use('/systems', authMiddleware, masterAdminOnly, adminRoutes);


if (process.env.NODE_ENV === 'production') {
require('./cron/djen_scraper_cron');
//console.log('âœ… Cron DJEN ativado');
}

// --- 9. PÃGINAS FRONTEND ---
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(publicPath, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(publicPath, 'register.html')));
app.get('/planos-page', (req, res) => res.sendFile(path.join(publicPath, 'planos.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(publicPath, 'dashboard-modern.html')));
app.get('/dashboard-modern', (req, res) => res.sendFile(path.join(publicPath, 'dashboard-modern.html')));
app.get('/prazos-page', (req, res) => res.sendFile(path.join(publicPath, 'prazos.html')));
app.get('/processos-page', (req, res) => res.sendFile(path.join(publicPath, 'processos.html')));
app.get('/financeiro-page', (req, res) => res.sendFile(path.join(publicPath, 'financeiro.html')));
app.get('/publicacoes-page', (req, res) => res.sendFile(path.join(publicPath, 'publicacoes.html')));
app.get('/audiencias-page', (req, res) => res.sendFile(path.join(publicPath, 'audiencias.html')));
app.get('/calculos-page', (req, res) => res.sendFile(path.join(publicPath, 'calculos.html')));
app.get('/clientes-page', (req, res) => res.sendFile(path.join(publicPath, 'clientes.html')));
app.get('/config-page', (req, res) => res.sendFile(path.join(publicPath, 'config.html')));
app.get('/ia-page', (req, res) => res.sendFile(path.join(publicPath, 'ia.html')));
app.get('/crm-page', (req, res) => res.sendFile(path.join(publicPath, 'crm.html')));
app.get('/documentos-page', (req, res) => res.sendFile(path.join(publicPath, 'documentos.html')));
app.get('/recuperar-senha', (req, res) => res.sendFile(path.join(publicPath, 'recuperar-senha.html')));
app.get('/nova-senha', (req, res) => res.sendFile(path.join(publicPath, 'nova-senha.html')));
app.get('/termos', (req, res) => res.sendFile(path.join(publicPath, 'termos.html')));
app.get('/privacidade', (req, res) => res.sendFile(path.join(publicPath, 'privacidade.html')));
app.get('/tribunais-page', (req, res) => res.sendFile(path.join(publicPath, 'tribunais.html')));
app.get('/blog', (req, res) => res.sendFile(path.join(publicPath, 'blog.html')));
app.get('/sobre-nos', (req, res) => res.sendFile(path.join(publicPath, 'sobre-nos.html')));
app.get('/lgpd', (req, res) => res.sendFile(path.join(publicPath, 'lgpd.html')));
app.get('/relatorios-page', (req, res) => res.sendFile(path.join(publicPath, 'relatorios.html')));
app.get('/chat-page', (req, res) => res.sendFile(path.join(publicPath, 'chat.html')));
app.get('/portal-cliente', (req, res) => res.sendFile(path.join(publicPath, 'portal-cliente.html')));
app.get('/reunioes-page', (req, res) => res.sendFile(path.join(publicPath, 'reunioes.html')));
app.get('/verificar-email', (req, res) => res.sendFile(path.join(publicPath, 'verificar-email.html')));

app.get('/pagamento-pendente', (req, res) => {
    const filePath = path.resolve(publicPath, 'pagamento-pendente.html');
    res.sendFile(filePath);
});

// --- 10. CONFIGURAÃ‡Ã•ES ESPECÃFICAS ---
app.get('/api/config/meu-escritorio', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT e.id, e.nome, e.advogado_responsavel, e.oab, e.documento, e.data_nascimento,
                    e.email, e.endereco, e.cidade, e.estado, e.cep, e.banco_codigo,
                    e.agencia, e.conta, e.conta_digito, e.pix_chave, e.renda_mensal,
                    e.plano_id, e.plano_financeiro_status, e.trial_expira_em, e.proxima_cobranca,
                    e.logo_arquivo
             FROM escritorios e JOIN usuarios u ON u.escritorio_id = e.id WHERE u.id = $1`,
            [req.user.id]
        );
        res.json({ ok: true, dados: result.rows[0] || {} });
    } catch (err) {
        res.status(500).json({ ok: false, erro: err.message });
    }
});

app.put('/api/config/escritorio', authMiddleware, async (req, res) => {
    const {
        nome, advogado_responsavel, oab, documento, dataNascimento, email,
        endereco, cidade, estado, cep, banco_codigo,
        agencia, conta, conta_digito, pix_chave, renda_mensal
    } = req.body;

    try {
        await pool.query(
            `UPDATE escritorios SET
                nome=$1, advogado_responsavel=$2, oab=$3, documento=$4, data_nascimento=$5, email=$6,
                endereco=$7, cidade=$8, estado=$9, cep=$10, banco_codigo=$11,
                agencia=$12, conta=$13, conta_digito=$14, pix_chave=$15, renda_mensal=$16
             WHERE id = (SELECT escritorio_id FROM usuarios WHERE id = $17)`,
            [
                nome, advogado_responsavel, oab, documento, dataNascimento || null, email,
                endereco, cidade, estado, cep, banco_codigo,
                agencia, conta, conta_digito, pix_chave, renda_mensal,
                req.user.id
            ]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({ ok: true, usuario: req.user });
});

// --- 11. TRATAMENTO DE ERROS GLOBAL ---
if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
}

app.use((err, req, res, next) => {
    logger.error({ err: err.stack, reqId: req.id }, 'SERVER_ERROR');
    res.status(err.status || 500).json({ ok: false, erro: err.message || 'Erro interno do servidor' });
});

// ============================
// ðŸš€ START DO SERVIDOR (IMEDIATO)
// ============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, 'LAWTECH PRO - SISTEMA ATIVO');
});

// Captura erros não tratados
process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandledRejection');
    if (process.env.SENTRY_DSN) Sentry.captureException(reason);
});
process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaughtException');
    if (process.env.SENTRY_DSN) Sentry.captureException(err);
});

// --- 12. INICIALIZAÃ‡ÃƒO E AUTOMAÃ‡ÃƒO (BACKGROUND) ---
const { iniciarAgendamentos } = require('./cron/prazosCron');
require('./cron/cobrancasTrial');
require('./cron/cobrancasRecorrentes');
require('./cron/djen_scraper_cron');
require('./cron/crmFollowup');
// require('./cron/auditoriaStripeCron'); // Desativado: coluna stripe_customer_id não existe ainda

(async function iniciarSistema() {
    try {
        logger.info('Conectando ao Neon e validando acesso master...');

        // Garantir que a coluna is_master exista (necessário antes do upsert abaixo)
        await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS is_master BOOLEAN DEFAULT false`);

        const masterEmail = process.env.MASTER_EMAIL;
        const masterPassword = process.env.MASTER_PASSWORD;
        if (!masterEmail || !masterPassword) {
            logger.warn('[SISTEMA] MASTER_EMAIL ou MASTER_PASSWORD não configurados. Pulando criação de conta master.');
        } else {
            const hash = await bcrypt.hash(masterPassword, 10);
            await pool.query(`
                INSERT INTO usuarios (nome, email, senha, role, escritorio_id, is_master)
                VALUES ('Dr. Fábio Lima', $1, $2, 'admin', 1, true)
                ON CONFLICT (email) DO UPDATE SET is_master = true
            `, [masterEmail, hash]);
        }

        logger.info('✅ [SISTEMA] Verificação de Acesso Master concluída.');

        // Migrar clicksign_api_key plain-text existentes → AES-256-GCM encriptado
        try {
            const { encrypt: encryptKey } = require('./utils/crypto');
            const keysToMigrate = await pool.query(
                `SELECT id, clicksign_api_key FROM escritorios WHERE clicksign_api_key IS NOT NULL`
            );
            let migrated = 0;
            for (const row of keysToMigrate.rows) {
                // Formato encriptado tem exatamente 3 partes separadas por ":"
                if (row.clicksign_api_key.split(':').length !== 3) {
                    const encrypted = encryptKey(row.clicksign_api_key);
                    await pool.query('UPDATE escritorios SET clicksign_api_key = $1 WHERE id = $2', [encrypted, row.id]);
                    migrated++;
                }
            }
            if (migrated > 0) logger.info(`✅ [SISTEMA] ${migrated} chave(s) ClickSign migrada(s) para formato encriptado.`);
        } catch (migrErr) {
            logger.warn({ err: migrErr.message }, '[SISTEMA] Migração clicksign_api_key (sem ENCRYPTION_KEY?)');
        }

        iniciarAgendamentos();

    } catch (err) {
        logger.error({ err: err.message }, '[BOOTSTRAP] Erro na inicialização');
        // NÃO derruba o servidor no Railway
    }
})();