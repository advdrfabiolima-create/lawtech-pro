const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const planMiddleware = require('../middlewares/planMiddleware');

// ============================================================
// ROTAS PÚBLICAS (SEM AUTENTICAÇÃO)
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

router.post('/public/onboarding', async (req, res) => {
    const { leadId, nome, documento, email, nascimento, cep, endereco, cidade, uf, tipoPessoa } = req.body;

    if (!leadId || !nome || !documento) {
        return res.status(400).json({ ok: false, mensagem: "Dados incompletos." });
    }

    try {
        const leadResult = await pool.query('SELECT escritorio_id, telefone FROM leads WHERE id = $1', [leadId]);
        
        if (leadResult.rowCount === 0) {
            return res.status(404).json({ ok: false, mensagem: "Lead não localizado." });
        }

        const { escritorio_id, telefone } = leadResult.rows[0];

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
            `${endereco}, ${cidade}/${uf}`, 
            escritorio_id
        ]);

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

const crmController = require('../controllers/crmController'); // Garanta que o require existe

// Rota que a ficha-cliente.html está tentando chamar
router.post('/proposta/:id/completar-dados', crmController.completarDadosLead);

// ============================================================
// 🔒 ROTAS PRIVADAS - APENAS PREMIUM
// ============================================================

router.get('/leads', 
    authMiddleware,
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const escritorioId = req.user.escritorio_id;
            console.log('📋 [GET /leads] Buscando leads do escritório:', escritorioId);
            
            const query = "SELECT * FROM leads WHERE escritorio_id = $1 ORDER BY data_criacao DESC";
            const resultado = await pool.query(query, [escritorioId]);
            
            console.log('✅ [GET /leads] Retornando', resultado.rows.length, 'leads');
            res.json(resultado.rows);
        } catch (err) {
            console.error('❌ [GET /leads] Erro:', err);
            res.status(500).json({ ok: false, erro: err.message });
        }
    }
);

router.get('/metricas', 
    authMiddleware,
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const id = req.user.escritorio_id;
            console.log('📊 [GET /metricas] Calculando métricas do escritório:', id);
            
            const query = `
                SELECT 
                    COUNT(*) FILTER (WHERE status IN ('Novo', 'Novo Lead')) as leads,
                    COUNT(*) FILTER (WHERE status = 'Reunião' OR status LIKE '%Reuni%') as reuniao,
                    COUNT(*) FILTER (WHERE status = 'Proposta') as proposta,
                    COUNT(*) FILTER (WHERE status = 'Ganho') as ganho
                FROM leads WHERE escritorio_id = $1
            `;
            const result = await pool.query(query, [id]);
            
            console.log('✅ [GET /metricas] Métricas:', result.rows[0]);
            res.json(result.rows[0]);
        } catch (err) {
            console.error('❌ [GET /metricas] Erro:', err);
            res.status(500).json({ erro: err.message });
        }
    }
);

router.patch('/lead/:id/status', 
    authMiddleware,
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;
            const escritorioId = req.user.escritorio_id;

            console.log('🔄 [PATCH /lead/:id/status] Atualizando status:', { id, status, escritorioId });

            await pool.query(
                'UPDATE leads SET status = $1 WHERE id = $2 AND escritorio_id = $3',
                [status, id, escritorioId]
            );
            
            console.log('✅ [PATCH /lead/:id/status] Status atualizado com sucesso');
            res.json({ ok: true });
        } catch (err) {
            console.error('❌ [PATCH /lead/:id/status] Erro:', err);
            res.status(500).json({ error: err.message });
        }
    }
);

// ✅ ROTA CORRIGIDA - CRIAR LEAD MANUAL (SEM EXIGIR EMAIL)
router.post('/leads', 
    authMiddleware,
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const { nome, telefone, area_interesse } = req.body;
            const escritorioId = req.user.escritorio_id;

            console.log('📝 [POST /leads] Dados recebidos:', { 
                nome, 
                telefone, 
                area_interesse,
                escritorioId 
            });

            // ✅ VALIDAÇÃO: APENAS NOME E TELEFONE
            if (!nome || nome.trim() === '') {
                console.log('❌ Validação: nome vazio');
                return res.status(400).json({ 
                    ok: false,
                    error: 'Nome é obrigatório' 
                });
            }

            if (!telefone || telefone.trim() === '') {
                console.log('❌ Validação: telefone vazio');
                return res.status(400).json({ 
                    ok: false,
                    error: 'Telefone é obrigatório' 
                });
            }

            // ✅ INSERT - EMAIL NÃO É OBRIGATÓRIO
            const query = `
                INSERT INTO leads 
                (escritorio_id, nome, telefone, status, origem, assunto)
                VALUES ($1, $2, $3, 'Novo', 'Manual', $4)
                RETURNING *
            `;

            const values = [
                escritorioId,
                nome.trim(),
                telefone.trim(),
                area_interesse && area_interesse.trim() !== '' ? area_interesse.trim() : null
            ];

            console.log('💾 Executando INSERT com valores:', values);
            const result = await pool.query(query, values);

            console.log('✅ Lead criado! ID:', result.rows[0].id);

            res.status(201).json({ 
                ok: true, 
                lead: result.rows[0],
                mensagem: 'Lead criado com sucesso!'
            });

        } catch (err) {
            console.error('❌ ERRO COMPLETO:', err);
            
            // Erros específicos do PostgreSQL
            if (err.code === '23502') {
                return res.status(400).json({ 
                    ok: false,
                    error: 'Campo obrigatório faltando no banco de dados',
                    detalhe: err.message 
                });
            }
            
            if (err.code === '23503') {
                return res.status(400).json({ 
                    ok: false,
                    error: 'Escritório não encontrado',
                    detalhe: err.message 
                });
            }
            
            res.status(500).json({ 
                ok: false,
                error: 'Erro ao criar lead',
                detalhe: err.message 
            });
        }
    }
);

router.put('/leads/:id/notas', 
    authMiddleware,
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { notas } = req.body;
            const escritorioId = req.user.escritorio_id;
            
            console.log('📝 [PUT /leads/:id/notas] Salvando notas:', { id, notasLength: notas?.length, escritorioId });
            
            await pool.query(
                'UPDATE leads SET mensagem = $1 WHERE id = $2 AND escritorio_id = $3',
                [notas, id, escritorioId]
            );
            
            console.log('✅ [PUT /leads/:id/notas] Notas salvas com sucesso');
            res.json({ ok: true });
        } catch (err) {
            console.error('❌ [PUT /leads/:id/notas] Erro:', err);
            res.status(500).json({ error: err.message });
        }
    }
);

router.delete('/leads/:id', 
    authMiddleware,
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const escritorioId = req.user.escritorio_id;
            
            console.log('🗑️ [DELETE /leads/:id] Excluindo lead:', { id, escritorioId });
            
            const result = await pool.query(
                'DELETE FROM leads WHERE id = $1 AND escritorio_id = $2 RETURNING *',
                [id, escritorioId]
            );
            
            if (result.rowCount === 0) {
                console.log('⚠️ [DELETE /leads/:id] Lead não encontrado');
                return res.status(404).json({ error: 'Lead não encontrado' });
            }
            
            console.log('✅ [DELETE /leads/:id] Lead excluído com sucesso');
            res.json({ ok: true });
        } catch (err) {
            console.error('❌ [DELETE /leads/:id] Erro:', err);
            res.status(500).json({ error: err.message });
        }
    }
);

module.exports = router;