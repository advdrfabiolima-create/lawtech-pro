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

// ... (mantenha os imports iniciais)

// 4. CADASTRO MANUAL DE LEAD (Padronizado para coincidir com o frontend)
router.post('/leads', authMiddleware, async (req, res) => {
    try {
        const { nome, telefone, email, area_interesse } = req.body;
        const escritorioId = req.user.escritorio_id;
        await pool.query(
            'INSERT INTO leads (escritorio_id, nome, telefone, email, status, origem, assunto) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [escritorioId, nome, telefone, email || null, 'Novo', 'Manual', area_interesse]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. ATUALIZAR NOTAS DO LEAD (Nova rota necessária para o modal de detalhes)
router.put('/leads/:id/notas', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { notas } = req.body;
        const escritorioId = req.user.escritorio_id;
        await pool.query(
            'UPDATE leads SET mensagem = $1 WHERE id = $2 AND escritorio_id = $3',
            [notas, id, escritorioId]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. EXCLUIR LEAD
router.delete('/leads/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const escritorioId = req.user.escritorio_id;
        await pool.query('DELETE FROM leads WHERE id = $1 AND escritorio_id = $2', [id, escritorioId]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// AUTO-ONBOARDING: Recebe dados da Ficha do Cliente
// ============================================================
router.post('/public/onboarding', async (req, res) => {
    const { leadId, nome, documento, email, nascimento, cep, endereco, tipoPessoa } = req.body;

    if (!leadId || !nome || !documento) {
        return res.status(400).json({ ok: false, mensagem: "Dados incompletos." });
    }

    try {
        // 1. Buscar o lead para saber a qual escritório ele pertence
        const leadResult = await pool.query('SELECT escritorio_id, telefone FROM leads WHERE id = $1', [leadId]);
        
        if (leadResult.rowCount === 0) {
            return res.status(404).json({ ok: false, mensagem: "Lead não localizado." });
        }

        const { escritorio_id, telefone } = leadResult.rows[0];

        // 2. Inserir na tabela de CLIENTES (Dados completos)
        const queryCliente = `
            INSERT INTO clientes (nome, documento, email, telefone, data_nascimento, cep, endereco, escritorio_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        await pool.query(queryCliente, [
            nome, 
            documento, 
            email, 
            telefone, 
            tipoPessoa === 'PJ' ? null : nascimento, 
            cep, 
            endereco, 
            escritorio_id
        ]);

        // 3. Atualizar o LEAD no CRM para status 'Ganho' e salvar os dados na mensagem
        const resumoMensagem = `Ficha preenchida pelo cliente. Doc: ${documento} | End: ${endereco}`;
        await pool.query(
            "UPDATE leads SET status = 'Ganho', mensagem = $1 WHERE id = $2",
            [resumoMensagem, leadId]
        );

        res.status(201).json({ ok: true, mensagem: "Dados processados com sucesso!" });

    } catch (err) {
        console.error("❌ ERRO NO AUTO-ONBOARDING:", err.message);
        res.status(500).json({ ok: false, mensagem: "Erro ao processar cadastro automático." });
    }
});

module.exports = router;