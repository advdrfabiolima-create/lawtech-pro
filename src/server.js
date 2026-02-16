require('dotenv').config();
const express = require('express');
const cors = require('cors');
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

// --- 2. MIDDLEWARES DE AUTENTICAÃ‡ÃƒO ---
const authMiddleware = require('./middlewares/authMiddleware');
const roleMiddleware = require('./middlewares/roleMiddleware');
const verificarPagamento = require('./middlewares/financeiroMiddleware');

// ðŸš€ 3. INICIALIZAÃ‡ÃƒO DO APP
const app = express();

// --- 4. 🔴 WEBHOOK DO STRIPE (ANTES DOS MIDDLEWARES DE PARSING) ---
// CRÍTICO: Esta rota DEVE vir ANTES do express.json() para receber raw body
app.use('/webhook', stripeWebhookRoutes);

// --- 5. MIDDLEWARE DE SEGURANÃ‡A MÃXIMA (MASTER ADMIN) ---
const masterAdminOnly = (req, res, next) => {
    if (req.user && req.user.email === 'adv.limaesilva@hotmail.com') {
        return next();
    }
    console.warn(`[SEGURANÃ‡A] Acesso nÃ£o autorizado ao Monitor por: ${req.user?.email || 'Desconhecido'}`);
    return res.status(403).json({ error: "Acesso restrito ao proprietÃ¡rio do sistema." });
};

// --- 6. CONFIGURAÃ‡Ã•ES GLOBAIS ---
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
app.use(cors());

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

app.get('/pagamento-pendente', (req, res) => {
    const filePath = path.resolve(publicPath, 'pagamento-pendente.html');
    res.sendFile(filePath);
});

// --- 10. CONFIGURAÃ‡Ã•ES ESPECÃFICAS ---
app.get('/api/config/meu-escritorio', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT e.* FROM escritorios e JOIN usuarios u ON u.escritorio_id = e.id WHERE u.id = $1',
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
require('./cron/auditoriaStripeCron');

(async function iniciarSistema() {
    try {
        console.log("â³ Conectando ao Neon e validando acesso master...");

        const hash = await bcrypt.hash('Lei@2026', 10);
        await pool.query(`
            INSERT INTO usuarios (nome, email, senha, role, escritorio_id)
            VALUES ('Dr. FÃ¡bio Lima', 'adv.limaesilva@hotmail.com', $1, 'admin', 1)
            ON CONFLICT (email) DO NOTHING
        `, [hash]);

        console.log("âœ… [SISTEMA] VerificaÃ§Ã£o de Acesso Master concluÃ­da.");

        iniciarAgendamentos();

    } catch (err) {
        console.error("âš ï¸ [BOOTSTRAP] Erro na inicializaÃ§Ã£o:", err.message);
        // NÃƒO derruba o servidor no Railway
    }
})();