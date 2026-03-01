const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const planMiddleware = require('../middlewares/planMiddleware');
const crmEmailService = require('../services/crmEmailService');

console.log('[CRM] Arquivo CRM.ROUTES.JS carregado - Versao 4.0 AUTOMAÇÃO');

const crmController = require('../controllers/crmController');
router.post('/proposta/:id/completar-dados', crmController.completarDadosLead);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function registrarAtividade(leadId, escritorioId, tipo, descricao) {
    try {
        await pool.query(
            `INSERT INTO lead_atividades (lead_id, escritorio_id, tipo, descricao)
             VALUES ($1, $2, $3, $4)`,
            [leadId, escritorioId, tipo, descricao]
        );
    } catch (err) {
        console.error('[CRM] Erro ao registrar atividade:', err.message);
    }
}

function calcularScore(lead) {
    let score = 0;
    if (lead.email) score += 15;
    if ((lead.mensagem || '').length > 10) score += 10;
    const areas = ['trabalhista', 'cível', 'civil', 'consumidor', 'família', 'familia'];
    if (areas.some(a => (lead.assunto || '').toLowerCase().includes(a))) score += 20;
    else score += 10;
    const dias = Math.floor((Date.now() - new Date(lead.data_criacao || Date.now())) / 86400000);
    if (dias <= 2) score += 20;
    else if (dias <= 7) score += 10;
    else score += 5;
    const etapas = { 'Novo': 0, 'Reunião': 15, 'Reuniao': 15, 'Proposta': 25, 'Ganho': 40 };
    score += etapas[lead.status] || 0;
    return Math.min(score, 100);
}

async function buscarInfoEscritorio(escritorioId) {
    const result = await pool.query(`
        SELECT u.id AS usuario_id, u.nome AS nome_advogado, u.email AS email_advogado,
               e.nome AS nome_escritorio
        FROM usuarios u
        JOIN escritorios e ON u.escritorio_id = e.id
        WHERE u.escritorio_id = $1
        LIMIT 1
    `, [escritorioId]);
    return result.rows[0] || {};
}

// ─── GET /leads/:id/atividades — REGISTRADA ANTES DE QUALQUER ROTA COM :id ────
router.get('/leads/:id/atividades',
    async (req, res) => {
        try {
            const { id } = req.params;
            const escritorioId = req.user.escritorio_id;
            const result = await pool.query(`
                SELECT tipo, descricao, criado_em
                FROM lead_atividades
                WHERE lead_id = $1 AND escritorio_id = $2
                ORDER BY criado_em DESC
                LIMIT 50
            `, [id, escritorioId]);
            res.json(result.rows);
        } catch (err) {
            console.error('[GET /leads/:id/atividades] Erro:', err);
            res.status(500).json({ erro: 'Erro interno do servidor' });
        }
    }
);

// ─── GET /leads ────────────────────────────────────────────────────────────────
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
                    COALESCE(NULLIF(TRIM(assunto), ''), NULLIF(TRIM(area_interesse), ''), 'Não informado') AS assunto,
                    mensagem,
                    status,
                    origem,
                    data_criacao,
                    COALESCE(score, 0) AS score,
                    ultima_movimentacao
                FROM leads
                WHERE escritorio_id = $1
                ORDER BY data_criacao DESC
                LIMIT 500
            `;
            const resultado = await pool.query(query, [escritorioId]);
            console.log('[GET /leads] Retornando', resultado.rows.length, 'leads');
            res.json(resultado.rows);
        } catch (err) {
            console.error('[GET /leads] Erro:', err);
            res.status(500).json({ ok: false, erro: 'Erro interno do servidor' });
        }
    }
);

// ─── POST /teste-post ──────────────────────────────────────────────────────────
router.post('/teste-post', (req, res) => {
    console.log('[TESTE] ROTA TESTE EXECUTADA COM SUCESSO!');
    res.json({ ok: true, mensagem: 'Rota de teste funcionou!' });
});

// ─── POST /leads ───────────────────────────────────────────────────────────────
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

            const interesseFinal = interesse && interesse.trim() !== '' ? interesse.trim() : 'Não informado';

            const result = await pool.query(
                `INSERT INTO leads (escritorio_id, nome, email, telefone, assunto, status, origem, ultima_movimentacao)
                 VALUES ($1, $2, $3, $4, $5, 'Novo', 'Manual', NOW()) RETURNING *`,
                [escritorioId, nome.trim(), email?.trim() || null, telefone.trim(), interesseFinal]
            );

            const lead = result.rows[0];
            const leadId = lead.id;

            // Registrar atividade de criação
            await registrarAtividade(leadId, escritorioId, 'criado', 'Lead criado via Manual');

            // Calcular e persistir score
            const score = calcularScore(lead);
            await pool.query('UPDATE leads SET score = $1 WHERE id = $2', [score, leadId]);

            // Buscar info do escritório (uma vez para reuso)
            const info = await buscarInfoEscritorio(escritorioId);

            // E-mail de boas-vindas ao lead
            if (lead.email) {
                await crmEmailService.enviarBoasVindasLead({
                    nomeAdvogado: info.nome_advogado || 'Advogado',
                    nomeEscritorio: info.nome_escritorio || 'Escritório',
                    nomeLead: lead.nome,
                    emailLead: lead.email,
                    areaInteresse: lead.assunto
                });
                await registrarAtividade(leadId, escritorioId, 'email_enviado', 'E-mail de boas-vindas enviado');
                await pool.query(
                    'UPDATE leads SET email_boas_vindas_enviado = TRUE WHERE id = $1',
                    [leadId]
                );
            }

            // Notificação in-app para o advogado
            if (info.usuario_id) {
                try {
                    await pool.query(`
                        INSERT INTO notificacoes (escritorio_id, usuario_id, prazo_id, tipo, titulo, mensagem)
                        VALUES ($1, $2, NULL, 'inapp', $3, $4)
                    `, [
                        escritorioId,
                        info.usuario_id,
                        `👤 Novo lead: ${lead.nome}`,
                        `Novo lead cadastrado — ${lead.assunto || 'interesse não informado'}`
                    ]);
                } catch (e) {
                    console.warn('[CRM] Notificação in-app falhou:', e.message);
                }
            }

            console.log('[POST /leads] Lead criado! ID:', leadId, '| Score:', score, '| Assunto:', lead.assunto);
            res.status(201).json({ ok: true, lead: { ...lead, score } });

        } catch (err) {
            console.error('[POST /leads] ERRO:', err);
            res.status(500).json({ ok: false, error: 'Erro interno do servidor' });
        }
    }
);

console.log('[CRM] Rota POST /leads registrada no Express');

// ─── GET /metricas ─────────────────────────────────────────────────────────────
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
            res.status(500).json({ erro: 'Erro interno do servidor' });
        }
    }
);

// ─── PATCH /lead/:id/status ────────────────────────────────────────────────────
router.patch('/lead/:id/status',
    authMiddleware,
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;
            const escritorioId = req.user.escritorio_id;

            console.log('[PATCH /lead/:id/status] Atualizando status:', { id, status, escritorioId });

            // Buscar status anterior
            const anterior = await pool.query(
                'SELECT status FROM leads WHERE id = $1 AND escritorio_id = $2',
                [id, escritorioId]
            );
            const statusAnterior = anterior.rows[0]?.status || 'Novo';

            await pool.query(
                'UPDATE leads SET status = $1, ultima_movimentacao = NOW() WHERE id = $2 AND escritorio_id = $3',
                [status, id, escritorioId]
            );

            await registrarAtividade(id, escritorioId, 'status_alterado',
                `Etapa alterada: ${statusAnterior} → ${status}`);

            // Buscar lead atualizado para score e e-mail
            const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
            const lead = leadResult.rows[0];

            if (lead) {
                const score = calcularScore(lead);
                await pool.query('UPDATE leads SET score = $1 WHERE id = $2', [score, id]);

                // Mapear status para etapa de e-mail
                const mapeamento = {
                    'Reuniao': 'triagem',
                    'Reunião': 'triagem',
                    'Proposta': 'proposta',
                    'Ganho': 'ganho'
                };
                const etapa = mapeamento[status];

                if (etapa && lead.email) {
                    const info = await buscarInfoEscritorio(escritorioId);
                    const linkFicha = etapa === 'ganho'
                        ? `https://lawtechpro.com.br/ficha-cliente.html?leadId=${id}`
                        : null;
                    await crmEmailService.enviarEmailEtapa({
                        etapa,
                        nomeAdvogado: info.nome_advogado || 'Advogado',
                        nomeEscritorio: info.nome_escritorio || 'Escritório',
                        nomeLead: lead.nome,
                        emailLead: lead.email,
                        areaInteresse: lead.assunto,
                        linkFicha
                    });
                    await registrarAtividade(id, escritorioId, 'email_enviado',
                        `E-mail de ${etapa} enviado`);
                }
            }

            console.log('[PATCH /lead/:id/status] Status atualizado com sucesso');
            res.json({ ok: true });
        } catch (err) {
            console.error('[PATCH /lead/:id/status] Erro:', err);
            res.status(500).json({ ok: false, erro: 'Erro interno do servidor' });
        }
    }
);

// ─── PUT /leads/:id/notas ─────────────────────────────────────────────────────
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

            await registrarAtividade(id, escritorioId, 'nota_salva', 'Nota atualizada');

            const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
            const lead = leadResult.rows[0];
            if (lead) {
                const score = calcularScore(lead);
                await pool.query('UPDATE leads SET score = $1 WHERE id = $2', [score, id]);
            }

            console.log('[PUT /leads/:id/notas] Notas salvas com sucesso');
            res.json({ ok: true });
        } catch (err) {
            console.error('[PUT /leads/:id/notas] Erro:', err);
            res.status(500).json({ ok: false, erro: 'Erro interno do servidor' });
        }
    }
);

// ─── DELETE /leads/:id ────────────────────────────────────────────────────────
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
                return res.status(404).json({ ok: false, erro: 'Lead nao encontrado' });
            }

            console.log('[DELETE /leads/:id] Lead excluido com sucesso');
            res.json({ ok: true });
        } catch (err) {
            console.error('[DELETE /leads/:id] Erro:', err);
            res.status(500).json({ ok: false, erro: 'Erro interno do servidor' });
        }
    }
);

module.exports = router;
