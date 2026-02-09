const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const planMiddleware = require('../middlewares/planMiddleware');

console.log('[CRM] Arquivo CRM.ROUTES.JS carregado - Versao 3.0 LIMPA');

const crmController = require('../controllers/crmController');
router.post('/proposta/:id/completar-dados', crmController.completarDadosLead);

// GET /leads
router.get('/leads',
    authMiddleware,
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const escritorioId = req.user.escritorio_id;

            const query = `
                SELECT
                    id,
                    nome,
                    email,
                    telefone,
                    COALESCE(NULLIF(TRIM(assunto), ''), NULLIF(TRIM(area_interesse), ''), 'Nao informado') AS assunto
                    mensagem,
                    status,
                    origem,
                    data_criacao
                FROM leads
                WHERE escritorio_id = $1
                ORDER BY data_criacao DESC
            `;

            const resultado = await pool.query(query, [escritorioId]);

            console.log('[GET /leads] Retornando', resultado.rows.length, 'leads');
            res.json(resultado.rows);

        } catch (err) {
            console.error('[GET /leads] Erro:', err);
            res.status(500).json({ ok: false, erro: err.message });
        }
    }
);
router.post('/teste-post',
    (req, res) => {
        console.log('[TESTE] ROTA TESTE EXECUTADA COM SUCESSO!');
        res.json({ ok: true, mensagem: 'Rota de teste funcionou!' });
    }
);
// POST /leads
router.post('/leads',
    authMiddleware,
    planMiddleware.checkFeature('crm'),
    (req, res, next) => {
        console.log('[POST /leads] ===== HANDLER FINAL EXECUTADO =====');
        console.log('[POST /leads] req.user:', req.user);
        console.log('[POST /leads] req.body:', req.body);
        next();
    },
    async (req, res) => {
        console.log('[POST /leads] FUNCAO ASYNC EXECUTADA!');
        
        try {
            const { nome, email, telefone, interesse } = req.body;
            const escritorioId = req.user.escritorio_id;

            console.log('[POST /leads] Dados:', { nome, email, telefone, interesse, escritorioId });

            if (!nome || !telefone) {
                return res.status(400).json({ ok: false, error: 'Campos obrigatorios' });
            }

            let interesseFinal = interesse && interesse.trim() !== '' ? interesse.trim() : 'Nao informado';
            
            const query = `INSERT INTO leads (escritorio_id, nome, email, telefone, assunto, status, origem) VALUES ($1, $2, $3, $4, $5, 'Novo', 'Manual') RETURNING *`;
            const values = [escritorioId, nome.trim(), email?.trim() || null, telefone.trim(), interesseFinal];

            const result = await pool.query(query, values);

            console.log('[POST /leads] Lead criado! ID:', result.rows[0].id, 'Assunto:', result.rows[0].assunto);

            res.status(201).json({ ok: true, lead: result.rows[0] });

        } catch (err) {
            console.error('[POST /leads] ERRO:', err);
            res.status(500).json({ ok: false, error: err.message });
        }
    }
);

console.log('[CRM] Rota POST /leads registrada no Express');

// GET /metricas
router.get('/metricas',
    authMiddleware,
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const id = req.user.escritorio_id;
            console.log('[GET /metricas] Calculando metricas do escritorio:', id);
            
            const query = `
                SELECT 
                    COUNT(*) FILTER (WHERE status IN ('Novo', 'Novo Lead')) as leads,
                    COUNT(*) FILTER (WHERE status = 'Reuniao' OR status LIKE '%Reuni%') as reuniao,
                    COUNT(*) FILTER (WHERE status = 'Proposta') as proposta,
                    COUNT(*) FILTER (WHERE status = 'Ganho') as ganho
                FROM leads WHERE escritorio_id = $1
            `;
            const result = await pool.query(query, [id]);
            
            console.log('[GET /metricas] Metricas:', result.rows[0]);
            res.json(result.rows[0]);
        } catch (err) {
            console.error('[GET /metricas] Erro:', err);
            res.status(500).json({ erro: err.message });
        }
    }
);

// PATCH /lead/:id/status
router.patch('/lead/:id/status',
    authMiddleware,
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;
            const escritorioId = req.user.escritorio_id;

            console.log('[PATCH /lead/:id/status] Atualizando status:', { id, status, escritorioId });

            await pool.query(
                'UPDATE leads SET status = $1 WHERE id = $2 AND escritorio_id = $3',
                [status, id, escritorioId]
            );
            
            console.log('[PATCH /lead/:id/status] Status atualizado com sucesso');
            res.json({ ok: true });
        } catch (err) {
            console.error('[PATCH /lead/:id/status] Erro:', err);
            res.status(500).json({ error: err.message });
        }
    }
);

// PUT /leads/:id/notas
router.put('/leads/:id/notas',
    authMiddleware,
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { notas } = req.body;
            const escritorioId = req.user.escritorio_id;
            
            console.log('[PUT /leads/:id/notas] Salvando notas:', { id, notasLength: notas?.length, escritorioId });
            
            await pool.query(
                'UPDATE leads SET mensagem = $1 WHERE id = $2 AND escritorio_id = $3',
                [notas, id, escritorioId]
            );
            
            console.log('[PUT /leads/:id/notas] Notas salvas com sucesso');
            res.json({ ok: true });
        } catch (err) {
            console.error('[PUT /leads/:id/notas] Erro:', err);
            res.status(500).json({ error: err.message });
        }
    }
);

// DELETE /leads/:id
router.delete('/leads/:id',
    authMiddleware,
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const escritorioId = req.user.escritorio_id;
            
            console.log('[DELETE /leads/:id] Excluindo lead:', { id, escritorioId });
            
            const result = await pool.query(
                'DELETE FROM leads WHERE id = $1 AND escritorio_id = $2 RETURNING *',
                [id, escritorioId]
            );
            
            if (result.rowCount === 0) {
                console.log('[DELETE /leads/:id] Lead nao encontrado');
                return res.status(404).json({ error: 'Lead nao encontrado' });
            }
            
            console.log('[DELETE /leads/:id] Lead excluido com sucesso');
            res.json({ ok: true });
        } catch (err) {
            console.error('[DELETE /leads/:id] Erro:', err);
            res.status(500).json({ error: err.message });
        }
    }
);

module.exports = router;