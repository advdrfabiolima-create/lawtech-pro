require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const pool = require('./config/db');

// --- MIDDLEWARES ---
const authMiddleware = require('./middlewares/authMiddleware');
const roleMiddleware = require('./middlewares/roleMiddleware');

// --- IMPORTAÇÃO DE ROTAS ---
const authRoutes = require('./routes/auth.routes');             
const authController = require('./controllers/authController'); 
const prazosRoutes = require('./routes/prazos.routes');         
const planosRoutes = require('./routes/planos.routes');         // <-- ESTA LINHA RESOLVE O ERRO
const financeiroRoutes = require('./routes/financeiro.routes');
const audienciasRoutes = require('./routes/audiencias.routes');
const processosRoutes = require('./routes/processos.routes');
const calculosRoutes = require('./routes/calculos.routes');
const pagamentosRoutes = require('./routes/pagamentos.routes');
const clientesRoutes = require('./routes/clientes.routes');
const configRoutes = require('./routes/config.routes');
const publicacoesRoutes = require('./routes/publicacoes.routes.js');

// --- AUTOMAÇÃO ---
const { iniciarAgendamentos } = require('./cron/prazosCron');

const app = express();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- CONFIGURAÇÕES GLOBAIS ---
app.use(express.json());

/* ========================= APIs (ROTAS DE DADOS) ========================= */
// Padronização com prefixo /api para facilitar a manutenção e segurança

app.use('/api/auth', authRoutes);
app.use('/api', prazosRoutes);
app.use('/api', processosRoutes);
app.use('/api', calculosRoutes);
app.use('/api', audienciasRoutes);
app.use('/api', planosRoutes);        // <-- Aqui a variável agora será reconhecida
app.use('/api', financeiroRoutes);
app.use('/api', clientesRoutes);
app.use('/api', configRoutes);
app.use('/api/pagamentos', pagamentosRoutes);
app.use('/api', publicacoesRoutes);

// Ajuste para servir arquivos estáticos
const publicPath = path.join(__dirname, '..', 'public'); 
app.use(express.static(publicPath));

/* ========================= PÁGINAS (FRONTEND) ========================= */
// Rotas que entregam o HTML para o navegador

app.get('/dashboard', (req, res) => res.sendFile(path.join(publicPath, 'dashboard-modern.html')));
app.get('/dashboard-modern', (req, res) => res.sendFile(path.join(publicPath, 'dashboard-modern.html')));
app.get('/prazos-page', (req, res) => res.sendFile(path.join(publicPath, 'prazos.html')));
app.get('/processos-page', (req, res) => res.sendFile(path.join(publicPath, 'processos.html')));
app.get('/planos-page', (req, res) => res.sendFile(path.join(publicPath, 'planos.html')));
app.get('/financeiro-page', (req, res) => res.sendFile(path.join(publicPath, 'financeiro.html')));
app.get('/publicacoes-page', (req, res) => res.sendFile(path.join(publicPath, 'publicacoes.html')));
app.get('/audiencias-page', (req, res) => res.sendFile(path.join(publicPath, 'audiencias.html')));
app.get('/calculos-page', (req, res) => res.sendFile(path.join(publicPath, 'calculos.html')));
app.get('/clientes-page', (req, res) => res.sendFile(path.join(publicPath, 'clientes.html')));
app.get('/config-page', (req, res) => res.sendFile(path.join(publicPath, 'config.html')));
app.get('/ia-page', (req, res) => res.sendFile(path.join(publicPath, 'ia.html')));
app.get('/recuperar-senha', (req, res) => res.sendFile(path.join(publicPath, 'recuperar-senha.html')));
app.get('/termos', (req, res) => res.sendFile(path.join(publicPath, 'termos.html')));
app.get('/privacidade', (req, res) => res.sendFile(path.join(publicPath, 'privacidade.html')));

/* ========================= AUTENTICAÇÃO ========================= */

app.post('/auth/login', authController.login);
app.post('/auth/register', authMiddleware, roleMiddleware('admin'), authController.register);
app.get('/auth/me', authMiddleware, (req, res) => res.json({ ok: true, usuario: req.user }));

/* ========================= INTELIGÊNCIA ARTIFICIAL ========================= */

app.post('/api/ia/perguntar', authMiddleware, async (req, res) => {
    const { pergunta } = req.body;
    const escritorioId = req.user.escritorio_id;

    try {
        // Verifica Plano Premium
        const planoResult = await pool.query(
            `SELECT p.nome FROM escritorios e 
             JOIN planos p ON p.id = e.plano_id 
             WHERE e.id = $1`, [escritorioId]
        );

        if (planoResult.rows.length === 0 || planoResult.rows[0].nome.toLowerCase() !== 'premium') {
            return res.status(403).json({ erro: 'Recurso exclusivo do plano Premium' });
        }

        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const prompt = `Atue como um advogado sênior brasileiro. 
        Forneça uma resposta técnica, clara e fundamentada em português sobre o tema: ${pergunta}.
        Importante: Use formatação Markdown (negritos e listas) e organize a resposta em parágrafos.`;

        const result = await model.generateContent(prompt);
        const textoResposta = result.response.text();

        if (!textoResposta) throw new Error('IA_EMPTY_RESPONSE');

        return res.json({ resposta: textoResposta });

    } catch (err) {
        console.error('ERRO IA:', err.message);
        const status = err.message.includes('429') ? 429 : 500;
        const msg = status === 429 ? 'Limite de cota atingido. Aguarde 60s.' : 'Erro no assistente jurídico.';
        return res.status(status).json({ erro: msg, detalhe: err.message });
    }
});

/* ========================= CONFIGURAÇÕES DO SISTEMA ========================= */

// Senha
app.put('/api/config/senha', authMiddleware, async (req, res) => {
    try {
        const senhaCripto = await bcrypt.hash(req.body.senha, 10);
        await pool.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [senhaCripto, req.user.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ erro: "Erro ao processar nova senha" }); }
});

// Perfil (Nome)
app.put('/api/config/perfil', authMiddleware, async (req, res) => {
    try {
        await pool.query('UPDATE usuarios SET nome = $1 WHERE id = $2', [req.body.nome, req.user.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

// Dados do Escritório (Leitura e Escrita)
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

// Middleware de Erro Global
app.use((err, req, res, next) => {
    console.error('SERVER_ERROR:', err.stack);
    res.status(err.status || 500).json({ ok: false, erro: err.message || 'Erro interno do servidor' });
});

// Inicia automações
iniciarAgendamentos();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 LawTech Pro Rodando em: http://localhost:${PORT}/dashboard`);
});