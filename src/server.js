require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./config/db');
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

// --- 5. MIDDLEWARE DE SEGURANÃ‡A MÃXIMA (MASTER ADMIN) ---
const masterAdminOnly = (req, res, next) => {
    if (req.user && req.user.eh_master) {
        return next();
    }
    console.warn(`[SEGURANÃ‡A] Acesso nÃ£o autorizado ao Monitor por: ${req.user?.email || 'Desconhecido'}`);
    return res.status(403).json({ error: "Acesso restrito ao proprietÃ¡rio do sistema." });
};

// --- 6. CONFIGURAÃ‡Ã•ES GLOBAIS ---
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
    contentSecurityPolicy: false, // Desabilitado para não quebrar scripts inline do frontend
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

// Rate limiting para endpoints de pagamento
const paymentLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 5, // 5 tentativas por minuto
    message: { erro: 'Muitas tentativas de pagamento. Aguarde um momento.' }
});
app.use('/api/pagamentos/assinar-plano', paymentLimiter);
app.use('/api/pagamentos/cobrar-renovacao', paymentLimiter);
app.use('/api/pagamentos/salvar-cartao', paymentLimiter);

// Rate limiting para endpoints de IA (custo alto por request)
const iaLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 10, // 10 requests por minuto
    message: { erro: 'Limite de uso da IA atingido. Aguarde um momento.' }
});
app.use('/api/ia', iaLimiter);
app.use('/api/peticoes/gerar', iaLimiter);
app.use('/api/analisar-prazo', iaLimiter);

// --- 7. SERVIR ARQUIVOS ESTÃTICOS ---
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// --- 8. APIs (ROTAS DE DADOS) ---
app.use('/api/auth', authRoutes);
app.use('/api', iaRoutes);
app.use('/api/crm/public', crmPublicRoutes); // ðŸ"" pÃºblico
app.use('/api/crm', authMiddleware, crmRoutes);
console.log('âœ… Rotas CRM registradas no servidor principal');
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
app.get('/recuperar-senha', (req, res) => res.sendFile(path.join(publicPath, 'recuperar-senha.html')));
app.get('/termos', (req, res) => res.sendFile(path.join(publicPath, 'termos.html')));
app.get('/privacidade', (req, res) => res.sendFile(path.join(publicPath, 'privacidade.html')));
app.get('/tribunais-page', (req, res) => res.sendFile(path.join(publicPath, 'tribunais.html')));
app.get('/blog', (req, res) => res.sendFile(path.join(publicPath, 'blog.html')));
app.get('/sobre-nos', (req, res) => res.sendFile(path.join(publicPath, 'sobre-nos.html')));
app.get('/lgpd', (req, res) => res.sendFile(path.join(publicPath, 'lgpd.html')));
app.get('/relatorios-page', (req, res) => res.sendFile(path.join(publicPath, 'relatorios.html')));
app.get('/chat-page', (req, res) => res.sendFile(path.join(publicPath, 'chat.html')));

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
                    e.plano_id, e.plano_financeiro_status, e.trial_expira_em, e.proxima_cobranca
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
app.use((err, req, res, next) => {
    console.error('SERVER_ERROR:', err.stack);
    res.status(err.status || 500).json({ ok: false, erro: err.message || 'Erro interno do servidor' });
});

// ============================
// ðŸš€ START DO SERVIDOR (IMEDIATO)
// ============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
â•"â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
â•'                                                      â•'
â•'           ðŸš€ LAWTECH PRO - SISTEMA ATIVO            â•'
â•'                                                      â•'
â•'  Ambiente: ${process.env.NODE_ENV || 'development'}
â•'  Porta: ${PORT}
â•'  âœ… Webhook Stripe: ATIVO e CONFIGURADO            â•'
â•'                                                      â•'
â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    `);
});

// --- 12. INICIALIZAÃ‡ÃƒO E AUTOMAÃ‡ÃƒO (BACKGROUND) ---
const { iniciarAgendamentos } = require('./cron/prazosCron');
require('./cron/cobrancasTrial');
require('./cron/cobrancasRecorrentes');
require('./cron/djen_scraper_cron');
// require('./cron/auditoriaStripeCron'); // Desativado: coluna stripe_customer_id não existe ainda

(async function iniciarSistema() {
    try {
        console.log("â³ Conectando ao Neon e validando acesso master...");

        // Garantir que a coluna is_master exista
        await pool.query(`
            ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS is_master BOOLEAN DEFAULT false
        `);

        const masterEmail = process.env.MASTER_EMAIL;
        const masterPassword = process.env.MASTER_PASSWORD;
        if (!masterEmail || !masterPassword) {
            console.warn("⚠️ [SISTEMA] MASTER_EMAIL ou MASTER_PASSWORD não configurados. Pulando criação de conta master.");
        } else {
            const hash = await bcrypt.hash(masterPassword, 10);
            await pool.query(`
                INSERT INTO usuarios (nome, email, senha, role, escritorio_id, is_master)
                VALUES ('Dr. Fábio Lima', $2, $1, 'admin', 1, true)
                ON CONFLICT (email) DO UPDATE SET is_master = true
            `, [hash, masterEmail]);
        }

        console.log("âœ… [SISTEMA] VerificaÃ§Ã£o de Acesso Master concluÃ­da.");

        // Criar tabela de controle de idempotência de webhooks
        await pool.query(`
            CREATE TABLE IF NOT EXISTS webhook_events (
                id SERIAL PRIMARY KEY,
                event_id VARCHAR(255) UNIQUE NOT NULL,
                source VARCHAR(50) NOT NULL,
                processed_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log("✅ [SISTEMA] Tabela webhook_events verificada.");

        // Criar tabela de logs do sistema (monitoramento)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS logs_sistema (
                id SERIAL PRIMARY KEY,
                escritorio_id INTEGER,
                servico VARCHAR(100),
                tipo_erro VARCHAR(100),
                mensagem_erro TEXT,
                criado_em TIMESTAMP DEFAULT NOW()
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_logs_sistema_criado ON logs_sistema(criado_em)`);
        console.log("✅ [SISTEMA] Tabela logs_sistema verificada.");

        // Criar tabela de audit log
        await pool.query(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER,
                email VARCHAR(255),
                escritorio_id INTEGER,
                tipo_evento VARCHAR(100),
                acao VARCHAR(100),
                descricao TEXT,
                metadata JSONB,
                ip VARCHAR(45),
                user_agent TEXT,
                criado_em TIMESTAMP DEFAULT NOW()
            )
        `);
        // Colunas extras (caso tabela já exista sem elas)
        await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS tipo_evento VARCHAR(100)`);
        await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP DEFAULT NOW()`);
        // Índices para consultas frequentes
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_acao ON audit_log(acao)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_usuario ON audit_log(usuario_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(criado_em)`);
        console.log("✅ [SISTEMA] Tabela audit_log verificada.");

        // Coluna retry_count para controle de retentativas de cobrança
        await pool.query(`
            ALTER TABLE escritorios ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0
        `);
        console.log("✅ [SISTEMA] Coluna retry_count verificada.");

        // Tabela de consentimentos LGPD
        await pool.query(`
            CREATE TABLE IF NOT EXISTS consentimentos (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER NOT NULL,
                tipo VARCHAR(50) NOT NULL,
                aceito BOOLEAN NOT NULL,
                ip VARCHAR(45),
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_consentimentos_usuario ON consentimentos(usuario_id)`);
        console.log("✅ [SISTEMA] Tabela consentimentos LGPD verificada.");

        // Criar tabela de transações financeiras
        await pool.query(`
            CREATE TABLE IF NOT EXISTS transacoes (
                id SERIAL PRIMARY KEY,
                escritorio_id INTEGER,
                gateway_id VARCHAR(255),
                gateway VARCHAR(50),
                valor NUMERIC(10,2),
                status VARCHAR(50),
                descricao TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        // Unique constraint em gateway_id para idempotência atômica
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_transacoes_gateway_id_unique
            ON transacoes(gateway_id) WHERE gateway_id IS NOT NULL
        `);
        console.log("✅ [SISTEMA] Tabela transacoes verificada.");

        // Tabela de feriados e suspensões (Calendário Jurídico)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS feriados_suspensoes (
                id SERIAL PRIMARY KEY,
                escritorio_id INTEGER NOT NULL,
                titulo VARCHAR(200) NOT NULL,
                data DATE NOT NULL,
                tipo VARCHAR(20) NOT NULL,
                abrangencia VARCHAR(20) DEFAULT 'local',
                recorrente BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log("✅ [SISTEMA] Tabela feriados_suspensoes verificada.");

        // Tabela de configuração de alertas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS config_alertas (
                id SERIAL PRIMARY KEY,
                escritorio_id INTEGER UNIQUE NOT NULL,
                dias_alerta_1 INTEGER DEFAULT 7,
                dias_alerta_2 INTEGER DEFAULT 3,
                dias_alerta_3 INTEGER DEFAULT 1,
                email_ativo BOOLEAN DEFAULT true,
                inapp_ativo BOOLEAN DEFAULT true,
                hora_envio VARCHAR(5) DEFAULT '08:00',
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log("✅ [SISTEMA] Tabela config_alertas verificada.");

        // Tabela de notificações in-app
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notificacoes (
                id SERIAL PRIMARY KEY,
                escritorio_id INTEGER NOT NULL,
                usuario_id INTEGER NOT NULL,
                prazo_id INTEGER NOT NULL,
                tipo VARCHAR(20) NOT NULL,
                titulo VARCHAR(300),
                mensagem TEXT,
                lida BOOLEAN DEFAULT false,
                enviada_em TIMESTAMP DEFAULT NOW()
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON notificacoes(usuario_id, lida)`);
        console.log("✅ [SISTEMA] Tabela notificacoes verificada.");

        // Tabela de chat interno do escritório
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_mensagens (
                id SERIAL PRIMARY KEY,
                escritorio_id INTEGER NOT NULL,
                remetente_id INTEGER NOT NULL,
                destinatario_id INTEGER,
                conteudo TEXT NOT NULL,
                lida BOOLEAN DEFAULT false,
                criado_em TIMESTAMP DEFAULT NOW()
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_escritorio_criado ON chat_mensagens(escritorio_id, criado_em)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_remetente ON chat_mensagens(remetente_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_destinatario ON chat_mensagens(destinatario_id)`);
        await pool.query(`ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS arquivo_nome VARCHAR(255)`);
        await pool.query(`ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS arquivo_path VARCHAR(500)`);
        console.log("✅ [SISTEMA] Tabela chat_mensagens verificada.");

        // Coluna de último acesso para status online
        await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_acesso TIMESTAMPTZ`);
        console.log("✅ [SISTEMA] Coluna ultimo_acesso verificada.");

        iniciarAgendamentos();

    } catch (err) {
        console.error("âš ï¸ [BOOTSTRAP] Erro na inicializaÃ§Ã£o:", err.message);
        // NÃƒO derruba o servidor no Railway
    }
})();