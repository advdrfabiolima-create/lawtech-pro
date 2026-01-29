const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const planMiddleware = require('../middlewares/planMiddleware');
const { analisarPrazoComClaude } = require('../controllers/iaController');
const Anthropic = require('@anthropic-ai/sdk');

/**
 * ============================================================
 * ROTA PÚBLICA – CAPTAÇÃO DE LEAD (FORMULÁRIO EXTERNO)
 * Uso: p.html?id=ESCRITORIO_ID
 * Não requer autenticação
 * ============================================================
 */
router.post('/crm/public/captura-lead', async (req, res) => {
    try {
        const {
            escritorio_id,
            nome,
            telefone,
            email,
            assunto,
            mensagem
        } = req.body;

        console.log('📥 [CAPTURA LEAD] Recebendo dados:', { escritorio_id, nome, telefone, email, assunto });

        if (!escritorio_id || !nome || !telefone) {
            console.error('❌ [CAPTURA LEAD] Dados obrigatórios faltando');
            return res.status(400).json({
                erro: 'Dados obrigatórios não informados'
            });
        }

        // ✅ CORREÇÃO: Usar pool ao invés de req.app.locals.db
        const result = await pool.query(`
            INSERT INTO crm_leads (
                escritorio_id,
                nome,
                telefone,
                email,
                assunto,
                mensagem,
                origem,
                status,
                criado_em
            ) VALUES (
                $1, $2, $3, $4, $5, $6, 'form_publico', 'novo', NOW()
            )
            RETURNING id
        `, [
            escritorio_id,
            nome,
            telefone,
            email || null,
            assunto || null,
            mensagem || null
        ]);

        console.log('✅ [CAPTURA LEAD] Lead cadastrado com sucesso! ID:', result.rows[0].id);

        return res.status(201).json({ 
            ok: true,
            leadId: result.rows[0].id,
            mensagem: 'Lead cadastrado com sucesso!'
        });

    } catch (error) {
        console.error('❌ [CAPTURA LEAD] Erro ao registrar:', error.message);
        console.error('Stack:', error.stack);
        return res.status(500).json({
            erro: 'Erro ao registrar lead',
            detalhe: error.message
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
    planMiddleware.checkFeature('ia_juridica'),  // ✅ Apenas Premium
    async (req, res) => {
        try {
            const { pergunta, pdf } = req.body;

            console.log('📊 [IA JURÍDICA] Nova pergunta:', {
                temPDF: !!pdf,
                tamanhoPergunta: pergunta?.length,
                pdfNome: pdf?.nome,
                pdfBase64Length: pdf?.base64?.length
            });

            // Validação básica
            if (!pergunta || !pergunta.trim()) {
                console.error('❌ [IA JURÍDICA] Erro: Pergunta não informada');
                return res.status(400).json({ 
                    erro: 'Pergunta não informada.',
                    detalhe: 'O campo "pergunta" é obrigatório'
                });
            }

            // ✅ VALIDAÇÃO DO PDF (se presente)
            if (pdf) {
                if (!pdf.base64) {
                    console.error('❌ [IA JURÍDICA] Erro: PDF sem base64');
                    return res.status(400).json({ 
                        erro: 'PDF inválido',
                        detalhe: 'O arquivo PDF não possui dados base64'
                    });
                }

                if (!pdf.nome) {
                    console.error('❌ [IA JURÍDICA] Erro: PDF sem nome');
                    return res.status(400).json({ 
                        erro: 'PDF inválido',
                        detalhe: 'O arquivo PDF não possui nome'
                    });
                }

                // Validar tamanho do base64 (aprox. 13MB após conversão)
                const estimatedSizeMB = (pdf.base64.length * 3/4) / (1024 * 1024);
                if (estimatedSizeMB > 15) {
                    console.error('❌ [IA JURÍDICA] Erro: PDF muito grande:', estimatedSizeMB.toFixed(2), 'MB');
                    return res.status(400).json({ 
                        erro: 'PDF muito grande',
                        detalhe: `O arquivo tem aproximadamente ${estimatedSizeMB.toFixed(2)}MB. Máximo: 15MB`
                    });
                }

                console.log('✅ [IA JURÍDICA] PDF validado:', {
                    nome: pdf.nome,
                    tamanhoEstimado: estimatedSizeMB.toFixed(2) + ' MB'
                });
            }

            // Configuração da Claude API
            const anthropic = new Anthropic({
                apiKey: process.env.CLAUDE_API_KEY,
            });

            // Validar se a chave API existe
            if (!process.env.CLAUDE_API_KEY) {
                console.error('❌ [IA JURÍDICA] CLAUDE_API_KEY não configurada no .env');
                return res.status(500).json({ 
                    erro: 'Configuração inválida',
                    detalhe: 'CLAUDE_API_KEY não está configurada no servidor'
                });
            }

            // Prompt otimizado para contexto jurídico brasileiro
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

            // ✅ CONSTRUIR MENSAGEM COM OU SEM PDF
            const messages = [];

            if (pdf && pdf.base64) {
                // ✅ TEM PDF: Enviar como document
                console.log('📄 [IA JURÍDICA] Processando PDF:', pdf.nome);
                
                try {
                    messages.push({
                        role: 'user',
                        content: [
                            {
                                type: 'document',
                                source: {
                                    type: 'base64',
                                    media_type: 'application/pdf',
                                    data: pdf.base64
                                }
                            },
                            {
                                type: 'text',
                                text: `Documento anexado: ${pdf.nome}\n\nPergunta: ${pergunta}`
                            }
                        ]
                    });
                } catch (pdfError) {
                    console.error('❌ [IA JURÍDICA] Erro ao processar PDF:', pdfError);
                    return res.status(400).json({ 
                        erro: 'Erro ao processar PDF',
                        detalhe: 'O arquivo PDF pode estar corrompido ou em formato inválido'
                    });
                }
            } else {
                // ✅ SEM PDF: Apenas texto
                messages.push({
                    role: 'user',
                    content: pergunta
                });
            }

            console.log('🚀 [IA JURÍDICA] Enviando para Claude API...', {
                model: 'claude-haiku-4-5-20251001',
                maxTokens: pdf ? 4096 : 2048,
                temPDF: !!pdf
            });

            // ✅ FAZER CHAMADA À API CLAUDE
            const message = await anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: pdf ? 4096 : 2048,  // Mais tokens se tiver PDF
                temperature: 0.4,
                system: systemPrompt,
                messages: messages
            });

            // Extração da resposta
            const respostaIA = message.content[0].text;

            console.log('✅ [IA JURÍDICA] Resposta gerada:', {
                tamanhoResposta: respostaIA.length,
                temPDF: !!pdf,
                stopReason: message.stop_reason
            });

            return res.json({ resposta: respostaIA });

        } catch (err) {
            console.error('❌ ERRO NO ASSISTENTE JURÍDICO (CLAUDE):', {
                message: err.message,
                status: err.status,
                type: err.type,
                stack: err.stack
            });

            // Tratamento de erros específicos da Anthropic
            if (err.status === 401) {
                return res.status(401).json({ 
                    erro: 'Chave API da Claude inválida.',
                    detalhe: 'Configure a chave correta no arquivo .env (CLAUDE_API_KEY)'
                });
            }

            if (err.status === 429) {
                return res.status(429).json({ 
                    erro: 'Muitas requisições. Aguarde um momento.',
                    detalhe: 'Limite de taxa da API atingido.'
                });
            }

            if (err.status === 400) {
                return res.status(400).json({ 
                    erro: 'Requisição inválida.',
                    detalhe: err.message || 'Verifique o formato dos dados enviados'
                });
            }

            if (err.message?.includes('overloaded')) {
                return res.status(503).json({ 
                    erro: 'Serviço temporariamente indisponível',
                    detalhe: 'A API da Claude está sobrecarregada. Tente novamente em alguns segundos.'
                });
            }

            return res.status(500).json({ 
                erro: 'O assistente jurídico está temporariamente offline.',
                detalhe: err.message 
            });
        }
    }
);

/**
 * ============================================================
 * ROTA SECUNDÁRIA: ANÁLISE DE PRAZO ESPECÍFICO (DASHBOARD)
 * Usa: Claude Haiku para análise técnica rápida
 * Restrição: Apenas plano Premium
 * ============================================================
 */
router.post('/analisar-prazo', 
    authMiddleware, 
    planMiddleware.checkFeature('ia_juridica'),  // ✅ Apenas Premium
    analisarPrazoComClaude
);

/**
 * ============================================================
 * 🔐 TODAS AS ROTAS DO CRM - APENAS PLANO PREMIUM
 * ============================================================
 */

router.post('/crm/leads', 
    authMiddleware, 
    planMiddleware.checkFeature('crm'),  // 🔐 Apenas Premium
    async (req, res) => {
        try {
            const { nome, email, telefone, origem, observacoes } = req.body;
            const escritorioId = req.user.escritorio_id;

            // Validação
            if (!nome || !email) {
                return res.status(400).json({ erro: 'Nome e email são obrigatórios' });
            }

            // Inserir lead
            const query = `
                INSERT INTO crm_leads (nome, email, telefone, origem, observacoes, escritorio_id, status, criado_em)
                VALUES ($1, $2, $3, $4, $5, $6, 'novo', NOW())
                RETURNING *
            `;
            
            const result = await pool.query(query, [
                nome, 
                email, 
                telefone || null, 
                origem || 'site', 
                observacoes || null, 
                escritorioId
            ]);

            res.status(201).json(result.rows[0]);

        } catch (err) {
            console.error('❌ ERRO AO ADICIONAR LEAD:', err.message);
            res.status(500).json({ erro: 'Erro ao adicionar lead: ' + err.message });
        }
    }
);

router.get('/crm/leads', 
    authMiddleware, 
    planMiddleware.checkFeature('crm'),  // 🔐 Apenas Premium
    async (req, res) => {
        try {
            const escritorioId = req.user.escritorio_id;
            
            const query = `
                SELECT * FROM crm_leads 
                WHERE escritorio_id = $1 
                ORDER BY criado_em DESC
            `;
            
            const result = await pool.query(query, [escritorioId]);
            res.json(result.rows);

        } catch (err) {
            console.error('❌ ERRO AO BUSCAR LEADS:', err.message);
            res.status(500).json({ erro: 'Erro ao buscar leads' });
        }
    }
);

router.put('/crm/leads/:id', 
    authMiddleware, 
    planMiddleware.checkFeature('crm'),  // 🔐 Apenas Premium
    async (req, res) => {
        try {
            const { id } = req.params;
            const { nome, email, telefone, origem, observacoes, status } = req.body;
            const escritorioId = req.user.escritorio_id;

            const query = `
                UPDATE crm_leads 
                SET nome = $1, email = $2, telefone = $3, origem = $4, 
                    observacoes = $5, status = $6, atualizado_em = NOW()
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
            console.error('❌ ERRO AO ATUALIZAR LEAD:', err.message);
            res.status(500).json({ erro: 'Erro ao atualizar lead' });
        }
    }
);

router.delete('/crm/leads/:id', 
    authMiddleware, 
    planMiddleware.checkFeature('crm'),  // 🔐 Apenas Premium
    async (req, res) => {
        try {
            const { id } = req.params;
            const escritorioId = req.user.escritorio_id;

            const result = await pool.query(
                'DELETE FROM crm_leads WHERE id = $1 AND escritorio_id = $2 RETURNING *',
                [id, escritorioId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ erro: 'Lead não encontrado' });
            }

            res.json({ mensagem: 'Lead excluído com sucesso' });

        } catch (err) {
            console.error('❌ ERRO AO EXCLUIR LEAD:', err.message);
            res.status(500).json({ erro: 'Erro ao excluir lead' });
        }
    }
);

router.get('/crm/pipeline', 
    authMiddleware, 
    planMiddleware.checkFeature('crm'),  // 🔐 Apenas Premium
    async (req, res) => {
        try {
            const escritorioId = req.user.escritorio_id;
            
            const query = `
                SELECT 
                    status,
                    COUNT(*) as quantidade,
                    COALESCE(SUM(valor_estimado), 0) as valor_total
                FROM crm_leads
                WHERE escritorio_id = $1
                GROUP BY status
            `;
            
            const result = await pool.query(query, [escritorioId]);
            res.json(result.rows);

        } catch (err) {
            console.error('❌ ERRO AO BUSCAR PIPELINE:', err.message);
            res.status(500).json({ erro: 'Erro ao buscar pipeline' });
        }
    }
);

router.post('/crm/automacao', 
    authMiddleware, 
    planMiddleware.checkFeature('crm'),  // 🔐 Apenas Premium
    async (req, res) => {
        try {
            // Implementar automações de CRM
            res.json({ message: 'Automação CRM - Premium' });
        } catch (err) {
            res.status(500).json({ erro: err.message });
        }
    }
);

module.exports = router;