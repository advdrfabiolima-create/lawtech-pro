require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path'); // ADICIONADA: Esta linha resolve o erro ReferenceError
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

// --- AUTOMAÇÃO ---
const { iniciarAgendamentos } = require('./cron/prazosCron');

const app = express();

// --- CONFIGURAÇÕES GLOBAIS ---
app.use(express.json());

/* ========================= APIs (ROTAS DE DADOS) ========================= */
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
app.use('/api/pagamentos', pagamentosRoutes);
app.use('/api', publicacoesRoutes);
app.use('/api/crm', crmRoutes);

// Servir arquivos estáticos (Ajustado para a pasta public)
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

/* ========================= CONFIGURAÇÕES DO SISTEMA (CORRIGIDAS) ========================= */

// BUSCA DADOS (GET) - Ajustada para o seu config.html
app.get('/api/config/meu-escritorio', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT e.* FROM escritorios e JOIN usuarios u ON u.escritorio_id = e.id WHERE u.id = $1',
            [req.user.id]
        );
        // Enviando no formato que o seu config.html espera
        res.json({ ok: true, dados: result.rows[0] || {} });
    } catch (err) { 
        res.status(500).json({ ok: false, erro: err.message }); 
    }
});

// SALVA DADOS (PUT) - Incluindo Advogado Responsável
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

/* ========================= FINALIZAÇÃO E INICIALIZAÇÃO ========================= */

// Middleware de Erro Global
app.use((err, req, res, next) => {
    console.error('SERVER_ERROR:', err.stack);
    res.status(err.status || 500).json({ ok: false, erro: err.message || 'Erro interno do servidor' });
});

// Função para Reset de Senha Master e Inicialização do Servidor
async function iniciarSistema() {
    try {
        console.log("⏳ Conectando ao Neon e validando acesso master...");
        const hash = await bcrypt.hash('Lei@2026', 10);
        
        await pool.query(`
            INSERT INTO usuarios (nome, email, senha, role, escritorio_id)
            VALUES ('Dr. Fábio Lima', 'adv.limaesilva@hotmail.com', $1, 'admin', 1)
            ON CONFLICT (email) 
            DO UPDATE SET senha = $1, role = 'admin', escritorio_id = 1
        `, [hash]);
        
        console.log("✅ [SISTEMA] Acesso Master restaurado: adv.limaesilva@hotmail.com / Lei@2026");
        
        // Inicia os agendamentos automáticos do Cron
        iniciarAgendamentos();
        
        // Define a porta e inicia o servidor uma única vez
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`\n🚀 LawTech Pro Rodando em: http://localhost:${PORT}/login`);
        });
        
    } catch (err) {
        console.error("❌ [ERRO CRÍTICO] Falha ao iniciar sistema:", err.message);
        console.log("Dica: Verifique se sua DATABASE_URL no .env está correta e se o Neon está ativo.");
    }
}

// Chama a inicialização única
iniciarSistema();