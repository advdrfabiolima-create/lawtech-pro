require('dotenv').config();

const express = require('express');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const planosRoutes = require('./routes/planos.routes'); // ✅ ADICIONADO

const app = express();

app.use(express.json());

// rota inicial
app.get('/', (req, res) => {
  res.send('Servidor juridico rodando 🚀');
});

// 🔐 auth
app.use('/auth', authRoutes);

// 📦 planos (upgrade)
app.use('/api/planos', planosRoutes); // ✅ ESSENCIAL

// dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

module.exports = app;

