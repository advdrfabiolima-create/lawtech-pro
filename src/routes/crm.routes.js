const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');

// ============================================================
// ROTA PÚBLICA: Captura de Lead vindo do Link de Atendimento
// ============================================================
router.post('/public/captura-lead', async (req, res) => {
    const { escritorio_id, nome, email, telefone, assunto, mensagem } = req.body;

    if (!escritorio_id || !nome || !telefone) {
        return res.status(400).json({ 
            ok: false, 
            mensagem: "Campos obrigatórios: Escritório, Nome e Telefone." 
        });
    }

    try {
        const query = `
            INSERT INTO leads (escritorio_id, nome, email, telefone, assunto, mensagem, status, origem)
            VALUES ($1, $2, $3, $4, $5, $6, 'Novo', 'Landing Page')
            RETURNING id
        `;

        const values = [escritorio_id, nome, email, telefone, assunto, mensagem];
        const resultado = await pool.query(query, values);

        res.status(201).json({ 
            ok: true, 
            mensagem: "Sua solicitação foi enviada com sucesso!",
            leadId: resultado.rows[0].id 
        });

    } catch (err) {
        console.error("❌ ERRO AO CAPTURAR LEAD:", err.message);
        res.status(500).json({ ok: false, mensagem: "Erro interno ao processar contato." });
    }
});

// ============================================================
// ROTAS PRIVADAS (EXIGEM LOGIN)
// ============================================================

// 1. LISTAR LEADS DO ESCRITÓRIO (Para preencher o Kanban)
router.get('/leads', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const query = "SELECT * FROM leads WHERE escritorio_id = $1 ORDER BY data_criacao DESC";
        const resultado = await pool.query(query, [escritorioId]);
        res.json(resultado.rows);
    } catch (err) {
        res.status(500).json({ ok: false, erro: err.message });
    }
});

// 2. BUSCAR MÉTRICAS (Para os cards do Dashboard)
router.get('/metricas', authMiddleware, async (req, res) => {
    try {
        const id = req.user.escritorio_id;
        const query = `
            SELECT 
                COUNT(*) FILTER (WHERE status IN ('Novo', 'Novo Lead')) as leads,
                COUNT(*) FILTER (WHERE status = 'Reunião') as reuniao,
                COUNT(*) FILTER (WHERE status = 'Proposta') as proposta,
                COUNT(*) FILTER (WHERE status = 'Ganho') as ganho
            FROM leads WHERE escritorio_id = $1
        `;
        const result = await pool.query(query, [id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// 3. ATUALIZAR STATUS (Para mover o card no Kanban)
router.patch('/lead/:id/status', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const escritorioId = req.user.escritorio_id;

        await pool.query(
            'UPDATE leads SET status = $1 WHERE id = $2 AND escritorio_id = $3',
            [status, id, escritorioId]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. CADASTRO MANUAL DE LEAD (Botão "Novo Lead" no CRM)
router.post('/manual-lead', authMiddleware, async (req, res) => {
    try {
        const { nome, telefone, email } = req.body;
        const escritorioId = req.user.escritorio_id;

        await pool.query(
            'INSERT INTO leads (escritorio_id, nome, telefone, email, status, origem) VALUES ($1, $2, $3, $4, $5, $6)',
            [escritorioId, nome, telefone, email, 'Novo', 'Manual']
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;