require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./config/db');

// --- MIDDLEWARES ---
const authMiddleware = require('./middlewares/authMiddleware');
const roleMiddleware = require('./middlewares/roleMiddleware');

// --- IMPORTAÇÃO DE ROTAS ---
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
const crmRoutes = require('./routes/crm.routes');
const usuariosRoutes = require('./routes/usuarios.routes'); // 🆕 ADICIONADO

// --- AUTOMAÇÃO ---
const { iniciarAgendamentos } = require('./cron/prazosCron');

const app = express();

// --- CONFIGURAÇÕES GLOBAIS ---
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
app.use(cors());

// --- APIs (ROTAS DE DADOS) ---
app.use('/api/auth', authRoutes);
app.use('/api', iaRoutes);
app.use('/api', crmRoutes);
app.use('/api', prazosRoutes);
app.use('/api', processosRoutes);
app.use('/api', calculosRoutes);
app.use('/api', audienciasRoutes);
app.use('/api', planosRoutes);
app.use('/api', financeiroRoutes);
app.use('/api', clientesRoutes);
app.use('/api', configRoutes);
app.use('/api', usuariosRoutes); // 🆕 ADICIONADO
app.use('/api/pagamentos', pagamentosRoutes);
app.use('/api', publicacoesRoutes);

// Servir arquivos estáticos (pasta public)
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// --- PÁGINAS (FRONTEND) ---
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
app.get('/pagamento-pendente', (req, res) => {
    const filePath = path.resolve(__dirname, '..', 'public', 'pagamento-pendente.html');
    console.log("Tentando carregar arquivo em:", filePath);
    res.sendFile(filePath);
});

// --- CONFIGURAÇÕES DO SISTEMA ---
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
        console.error("ERRO SQL NO SALVAMENTO:", err.message);
        res.status(500).json({ erro: err.message });
    }
});

// --- ROTA DE VERIFICAÇÃO RÁPIDA DE USUÁRIO ---
app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({ ok: true, usuario: req.user });
});

// --- Middleware de Erro Global ---
app.use((err, req, res, next) => {
    console.error('SERVER_ERROR:', err.stack);
    res.status(err.status || 500).json({ ok: false, erro: err.message || 'Erro interno do servidor' });
});

// --- INICIALIZAÇÃO DO SISTEMA (VERSÃO PROTEGIDA) ---
async function iniciarSistema() {
    try {
        console.log("⏳ Conectando ao Neon e validando acesso master...");
        
        // Esta senha só será usada no primeiríssimo acesso ou se o senhor deletar o usuário
        const hash = await bcrypt.hash('Lei@2026', 10);

        await pool.query(`
            INSERT INTO usuarios (nome, email, senha, role, escritorio_id)
            VALUES ('Dr. Fábio Lima', 'adv.limaesilva@hotmail.com', $1, 'admin', 1)
            ON CONFLICT (email) 
            DO NOTHING
        `, [hash]);

        console.log("✅ [SISTEMA] Verificação de Acesso Master concluída.");

        iniciarAgendamentos();

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`\n🚀 LawTech Pro Rodando em: http://localhost:${PORT}/login`);
        });
    } catch (err) {
        console.error("❌ [ERRO CRÍTICO] Falha ao iniciar sistema:", err.message);
        console.log("Dica: Verifique se sua DATABASE_URL no .env está correta e se o Neon está ativo.");
    }
}

// Chama a inicialização
iniciarSistema();