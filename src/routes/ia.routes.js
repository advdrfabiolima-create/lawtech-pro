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
 * ✅ CORRIGIDO: Usa tabela 'leads' ao invés de 'crm_leads'
 * ============================================================
 */
router.post('/crm/public/captura-lead', async (req, res) => {
    console.log('\n================================');
    console.log('🎯 [CAPTURA LEAD] INICIANDO...');
    console.log('================================');
    
    try {
        console.log('📦 [1/5] Body recebido:', JSON.stringify(req.body, null, 2));
        
        const {
            escritorio_id,
            nome,
            telefone,
            email,
            assunto,
            mensagem
        } = req.body;

        console.log('📋 [2/5] Dados extraídos:', {
            escritorio_id,
            nome,
            telefone,
            email: email || 'não fornecido',
            assunto: assunto || 'não fornecido'
        });

        // Validação de dados obrigatórios
        if (!escritorio_id || !nome || !telefone) {
            console.error('❌ [3/5] VALIDAÇÃO FALHOU - Dados obrigatórios faltando');
            
            return res.status(400).json({
                erro: 'Dados obrigatórios não informados',
                detalhe: {
                    escritorio_id: !!escritorio_id,
                    nome: !!nome,
                    telefone: !!telefone
                }
            });
        }

        console.log('✅ [3/5] Validação OK');
        console.log('💾 [4/5] Inserindo na tabela LEADS...');

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

        console.log('📝 Query:', query.substring(0, 100) + '...');
        console.log('📝 Values:', values);

        const result = await pool.query(query, values);

        console.log('✅ [5/5] Lead inserido com sucesso!');
        console.log('📊 Resultado:', result.rows[0]);
        console.log('================================\n');

        return res.status(201).json({ 
            ok: true,
            leadId: result.rows[0].id,
            mensagem: 'Lead cadastrado com sucesso!',
            lead: result.rows[0]
        });

    } catch (error) {
        console.error('\n❌❌❌ ERRO CAPTURADO ❌❌❌');
        console.error('Tipo:', error.name);
        console.error('Mensagem:', error.message);
        console.error('Código:', error.code);
        console.error('Stack:', error.stack);
        console.error('================================\n');
        
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
            const { pergunta, pdf } = req.body;

            console.log('📊 [IA JURÍDICA] Nova pergunta:', {
                temPDF: !!pdf,
                tamanhoPergunta: pergunta?.length
            });

            if (!pergunta || !pergunta.trim()) {
                return res.status(400).json({ 
                    erro: 'Pergunta não informada.',
                    detalhe: 'O campo "pergunta" é obrigatório'
                });
            }

            if (pdf) {
                if (!pdf.base64 || !pdf.nome) {
                    return res.status(400).json({ 
                        erro: 'PDF inválido',
                        detalhe: 'O arquivo PDF está incompleto'
                    });
                }

                const estimatedSizeMB = (pdf.base64.length * 3/4) / (1024 * 1024);
                if (estimatedSizeMB > 15) {
                    return res.status(400).json({ 
                        erro: 'PDF muito grande',
                        detalhe: `O arquivo tem ${estimatedSizeMB.toFixed(2)}MB. Máximo: 15MB`
                    });
                }
            }

            const anthropic = new Anthropic({
                apiKey: process.env.CLAUDE_API_KEY,
            });

            if (!process.env.CLAUDE_API_KEY) {
                return res.status(500).json({ 
                    erro: 'Configuração inválida',
                    detalhe: 'CLAUDE_API_KEY não configurada'
                });
            }

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

            const messages = [];

            if (pdf && pdf.base64) {
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
            } else {
                messages.push({
                    role: 'user',
                    content: pergunta
                });
            }

            const message = await anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: pdf ? 4096 : 2048,
                temperature: 0.4,
                system: systemPrompt,
                messages: messages
            });

            const respostaIA = message.content[0].text;

            return res.json({ resposta: respostaIA });

        } catch (err) {
            console.error('❌ ERRO NO ASSISTENTE JURÍDICO:', err.message);

            if (err.status === 401) {
                return res.status(401).json({ 
                    erro: 'Chave API da Claude inválida.'
                });
            }

            if (err.status === 429) {
                return res.status(429).json({ 
                    erro: 'Muitas requisições. Aguarde um momento.'
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

/**
 * ============================================================
 * 🔐 ROTAS DO CRM - APENAS PLANO PREMIUM
 * ============================================================
 */

router.post('/crm/leads', 
    authMiddleware, 
    planMiddleware.checkFeature('crm'),
    async (req, res) => {
        try {
            const { nome, email, telefone, origem, observacoes } = req.body;
            const escritorioId = req.user.escritorio_id;

            if (!nome || !email) {
                return res.status(400).json({ erro: 'Nome e email são obrigatórios' });
            }

            const query = `
                INSERT INTO leads (nome, email, telefone, origem, mensagem, escritorio_id, status, data_criacao)
                VALUES ($1, $2, $3, $4, $5, $6, 'Novo', NOW())
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
            console.error('❌ ERRO AO BUSCAR LEADS:', err.message);
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
            console.error('❌ ERRO AO ATUALIZAR LEAD:', err.message);
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
            console.error('❌ ERRO AO EXCLUIR LEAD:', err.message);
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
            console.error('❌ ERRO AO BUSCAR PIPELINE:', err.message);
            res.status(500).json({ erro: 'Erro ao buscar pipeline' });
        }
    }
);

module.exports = router;