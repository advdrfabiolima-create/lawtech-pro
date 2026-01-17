require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
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
const publicacoesRoutes = require('./routes/publicacoes.routes.js');
const iaRoutes = require('./routes/ia.routes'); 
const crmRoutes = require('./routes/crm.routes');

// --- AUTOMAÇÃO ---
const { iniciarAgendamentos } = require('./cron/prazosCron');

const app = express();

// --- CONFIGURAÇÕES GLOBAIS ---
app.use(express.json());

/* ========================= APIs (ROTAS DE DADOS) ========================= */
// 🛡️ SEGURANÇA: As rotas de API vêm PRIMEIRO para garantir que o login siga a lógica do Controller

app.use('/api/auth', authRoutes); // Aqui está o segredo: ele usa o authController blindado
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
app.use('/api/pagamentos', pagamentosRoutes);
app.use('/api', publicacoesRoutes);

// Ajuste para servir arquivos estáticos
const publicPath = path.join(__dirname, '..', 'public'); 
app.use(express.static(publicPath));

/* ========================= PÁGINAS (FRONTEND) ========================= */

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

/* ========================= CONFIGURAÇÕES DO SISTEMA ========================= */
// (Mantidas conforme seu original, mas protegidas pelo authMiddleware)

app.put('/api/config/senha', authMiddleware, async (req, res) => {
    try {
        const senhaCripto = await bcrypt.hash(req.body.senha, 10);
        await pool.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [senhaCripto, req.user.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ erro: "Erro ao processar nova senha" }); }
});

app.put('/api/config/perfil', authMiddleware, async (req, res) => {
    try {
        await pool.query('UPDATE usuarios SET nome = $1 WHERE id = $2', [req.body.nome, req.user.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/config/escritorio', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT e.* FROM escritorios e JOIN usuarios u ON u.escritorio_id = e.id WHERE u.id = $1',
            [req.user.id]
        );
        res.json(result.rows[0] || {});
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.put('/api/config/escritorio', authMiddleware, async (req, res) => {
    const { nome, oab, banco_codigo, agencia, conta, conta_digito, pix_chave } = req.body;
    try {
        await pool.query(
            `UPDATE escritorios SET nome=$1, oab=$2, banco_codigo=$3, agencia=$4, conta=$5, conta_digito=$6, pix_chave=$7 
             WHERE id = (SELECT escritorio_id FROM usuarios WHERE id = $8)`,
            [nome, oab, banco_codigo, agencia, conta, conta_digito, pix_chave, req.user.id]
        );
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ========================= FINALIZAÇÃO ========================= */

app.use((err, req, res, next) => {
    console.error('SERVER_ERROR:', err.stack);
    res.status(err.status || 500).json({ ok: false, erro: err.message || 'Erro interno do servidor' });
});

iniciarAgendamentos();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 LawTech Pro Rodando em: http://localhost:${PORT}/dashboard`);
});