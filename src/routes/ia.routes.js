const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const planMiddleware = require('../middlewares/planMiddleware');
const logger = require('../utils/logger');
const { analisarPrazoComClaude } = require('../controllers/iaController');
const Anthropic = require('@anthropic-ai/sdk');


/**
 * ============================================================
 * ROTA PÚBLICA – CAPTAÇÃO DE LEAD (FORMULÁRIO EXTERNO)
 * Uso: p.html?id=ESCRITORIO_ID
 * Não requer autenticação
 * ✅ CORRIGIDO: Usa tabela 'leads' ao invés de 'crm_leads'
 * ============================================================
 */
router.post('/crm/public/captura-lead', async (req, res) => {
    logger.info({ body: req.body }, 'Captura de lead iniciando');

    try {
        const {
            escritorio_id,
            nome,
            telefone,
            email,
            assunto,
            mensagem
        } = req.body;

        logger.info({ escritorio_id, nome, telefone, email: email || null, assunto: assunto || null }, 'Captura de lead dados extraidos');

        // Validação de dados obrigatórios
        if (!escritorio_id || !nome || !telefone) {
            logger.error('Captura lead: dados obrigatorios faltando');
            
            return res.status(400).json({
                erro: 'Dados obrigatórios não informados',
                detalhe: {
                    escritorio_id: !!escritorio_id,
                    nome: !!nome,
                    telefone: !!telefone
                }
            });
        }

        // ✅ USANDO TABELA 'leads' que já existe
        const query = `
            INSERT INTO leads (
                escritorio_id,
                nome,
                telefone,
                email,
                assunto,
                mensagem,
                origem,
                status,
                data_criacao
            ) VALUES (
                $1, $2, $3, $4, $5, $6, 'Landing Page', 'Novo', NOW()
            )
            RETURNING id, nome, telefone, email, data_criacao
        `;
        
        const values = [
            parseInt(escritorio_id),
            nome.trim(),
            telefone.trim(),
            email ? email.trim() : null,
            assunto || null,
            mensagem ? mensagem.trim() : null
        ];

        const result = await pool.query(query, values);

        logger.info({ lead: result.rows[0] }, 'Captura lead: lead inserido com sucesso');

        return res.status(201).json({ 
            ok: true,
            leadId: result.rows[0].id,
            mensagem: 'Lead cadastrado com sucesso!',
            lead: result.rows[0]
        });

    } catch (error) {
        logger.error({ err: error.message, stack: error.stack, code: error.code, type: error.name }, 'Erro na captura de lead');
        
        // Erros específicos do PostgreSQL
        if (error.code === '42P01') {
            return res.status(500).json({
                erro: 'Tabela leads não existe',
                detalhe: 'Verifique a estrutura do banco de dados',
                codigo: error.code
            });
        }
        
        if (error.code === '23503') {
            return res.status(400).json({
                erro: 'Escritório não encontrado',
                detalhe: `O escritório com ID ${req.body.escritorio_id} não existe`,
                codigo: error.code
            });
        }

        return res.status(500).json({
            erro: 'Erro ao registrar lead',
            detalhe: error.message,
            codigo: error.code || 'UNKNOWN'
        });
    }
});

/**
 * ============================================================
 * 🔐 ROTA PRINCIPAL: ASSISTENTE JURÍDICO (CHAT IA)
 * Usa: Claude Haiku 4.5 (Anthropic)
 * Restrição: Apenas plano Premium
 * ✅ NOVO: Suporte a análise de PDF
 * ============================================================
 */
router.post('/ia/perguntar', 
    authMiddleware, 
    planMiddleware.checkFeature('ia_juridica'),
    async (req, res) => {
        try {
            const { pergunta, historico, arquivo, pdf } = req.body;
            // arquivo é o novo campo; pdf mantém retrocompatibilidade
            const anexo = arquivo || pdf || null;

            logger.info({
                temAnexo: !!anexo,
                tipoAnexo: anexo?.tipo || (anexo ? 'pdf' : null),
                tamanhoPergunta: pergunta?.length,
                historicoMsgs: (historico || []).length
            }, '[IA JURIDICA] Nova pergunta');

            if (!pergunta || !pergunta.trim()) {
                return res.status(400).json({ 
                    erro: 'Pergunta não informada.',
                    detalhe: 'O campo "pergunta" é obrigatório'
                });
            }

            if (anexo) {
                if (!anexo.base64 || !anexo.nome) {
                    return res.status(400).json({ 
                        erro: 'Arquivo inválido',
                        detalhe: 'O arquivo está incompleto'
                    });
                }
                const estimatedSizeMB = (anexo.base64.length * 3/4) / (1024 * 1024);
                if (estimatedSizeMB > 15) {
                    return res.status(400).json({ 
                        erro: 'Arquivo muito grande',
                        detalhe: `O arquivo tem ${estimatedSizeMB.toFixed(2)}MB. Máximo: 15MB`
                    });
                }
            }

            if (!process.env.CLAUDE_API_KEY) {
                return res.status(500).json({ 
                    erro: 'Configuração inválida',
                    detalhe: 'CLAUDE_API_KEY não configurada'
                });
            }

            const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

            const systemPrompt = `Você é um advogado sênior brasileiro com expertise em:
- Direito Civil e Processual Civil
- Direito do Trabalho e Processual do Trabalho  
- Direito Penal e Processual Penal
- Análise de jurisprudência STF, STJ e Tribunais
- Análise de contratos, petições e documentos jurídicos

Responda sempre:
✓ De forma técnica e fundamentada
✓ Citando artigos de lei quando aplicável
✓ Em português jurídico formal
✓ Com objetividade e clareza
✓ Referenciando jurisprudência relevante quando pertinente`;

            // ── Montar histórico de mensagens ─────────────────────────
            const messages = [];

            // Adicionar histórico anterior (sem arquivos, só texto)
            const hist = Array.isArray(historico) ? historico.slice(-20) : [];
            hist.forEach(msg => {
                if (msg.role && msg.content) {
                    messages.push({ role: msg.role, content: String(msg.content) });
                }
            });

            // Montar mensagem atual (com ou sem arquivo)
            if (anexo && anexo.base64) {
                const isDocx = anexo.tipo === 'docx' ||
                    (anexo.nome && (anexo.nome.endsWith('.docx') || anexo.nome.endsWith('.doc')));

                if (isDocx) {
                    // DOCX: enviar como base64 com media_type correto
                    messages.push({
                        role: 'user',
                        content: [
                            {
                                type: 'document',
                                source: {
                                    type: 'base64',
                                    media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                    data: anexo.base64
                                }
                            },
                            {
                                type: 'text',
                                text: `Documento Word anexado: ${anexo.nome}\n\nPergunta: ${pergunta}`
                            }
                        ]
                    });
                } else {
                    // PDF
                    messages.push({
                        role: 'user',
                        content: [
                            {
                                type: 'document',
                                source: {
                                    type: 'base64',
                                    media_type: 'application/pdf',
                                    data: anexo.base64
                                }
                            },
                            {
                                type: 'text',
                                text: `Documento PDF anexado: ${anexo.nome}\n\nPergunta: ${pergunta}`
                            }
                        ]
                    });
                }
            } else {
                messages.push({ role: 'user', content: pergunta });
            }

            const message = await anthropic.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: anexo ? 6000 : 4000,
                temperature: 0.4,
                system: systemPrompt,
                messages: messages
            });

            const respostaIA = message.content[0].text;
            logger.info({ tokens: message.usage }, '[IA JURIDICA] Resposta gerada');

            return res.json({ resposta: respostaIA });

        } catch (err) {
            logger.error({ err: err.message }, 'Erro no assistente juridico');

            if (err.status === 401) {
                return res.status(401).json({ erro: 'Chave API da Claude inválida.' });
            }
            if (err.status === 429) {
                return res.status(429).json({ erro: 'Muitas requisições. Aguarde um momento.' });
            }
            if (err.message && err.message.includes('100 PDF pages')) {
                return res.status(400).json({
                    erro: 'PDF com muitas páginas',
                    detalhe: 'O PDF excede o limite de 100 páginas da API. Envie um documento menor.'
                });
            }

            return res.status(500).json({ 
                erro: 'O assistente jurídico está temporariamente offline.',
                detalhe: err.message 
            });
        }
    }
);

router.post('/analisar-prazo', 
    authMiddleware, 
    planMiddleware.checkFeature('ia_juridica'),
    analisarPrazoComClaude
);

router.get('/crm/leads', 
    authMiddleware, 
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const escritorioId = req.user.escritorio_id;
            
            const query = `
                SELECT * FROM leads 
                WHERE escritorio_id = $1 
                ORDER BY data_criacao DESC
            `;
            
            const result = await pool.query(query, [escritorioId]);
            res.json(result.rows);

        } catch (err) {
            logger.error({ err: err.message }, 'Erro ao buscar leads');
            res.status(500).json({ erro: 'Erro ao buscar leads' });
        }
    }
);

router.put('/crm/leads/:id', 
    authMiddleware, 
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { nome, email, telefone, origem, observacoes, status } = req.body;
            const escritorioId = req.user.escritorio_id;

            const query = `
                UPDATE leads 
                SET nome = $1, email = $2, telefone = $3, origem = $4, 
                    mensagem = $5, status = $6
                WHERE id = $7 AND escritorio_id = $8
                RETURNING *
            `;
            
            const result = await pool.query(query, [
                nome, email, telefone, origem, observacoes, status, id, escritorioId
            ]);

            if (result.rows.length === 0) {
                return res.status(404).json({ erro: 'Lead não encontrado' });
            }

            res.json(result.rows[0]);

        } catch (err) {
            logger.error({ err: err.message }, 'Erro ao atualizar lead');
            res.status(500).json({ erro: 'Erro ao atualizar lead' });
        }
    }
);

router.delete('/crm/leads/:id', 
    authMiddleware, 
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const escritorioId = req.user.escritorio_id;

            const result = await pool.query(
                'DELETE FROM leads WHERE id = $1 AND escritorio_id = $2 RETURNING *',
                [id, escritorioId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ erro: 'Lead não encontrado' });
            }

            res.json({ mensagem: 'Lead excluído com sucesso' });

        } catch (err) {
            logger.error({ err: err.message }, 'Erro ao excluir lead');
            res.status(500).json({ erro: 'Erro ao excluir lead' });
        }
    }
);

router.get('/crm/pipeline', 
    authMiddleware, 
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const escritorioId = req.user.escritorio_id;
            
            const query = `
                SELECT 
                    status,
                    COUNT(*) as quantidade,
                    COALESCE(SUM(valor_estimado), 0) as valor_total
                FROM leads
                WHERE escritorio_id = $1
                GROUP BY status
            `;
            
            const result = await pool.query(query, [escritorioId]);
            res.json(result.rows);

        } catch (err) {
            logger.error({ err: err.message }, 'Erro ao buscar pipeline');
            res.status(500).json({ erro: 'Erro ao buscar pipeline' });
        }
    }
);

module.exports = router;