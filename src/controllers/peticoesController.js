/**
 * ============================================
 * PETIÇÕES CONTROLLER
 * Gerencia geração de petições com IA
 * ============================================
 */

const pool = require('../config/db');
const Anthropic = require('@anthropic-ai/sdk');
const PDFGeneratorService = require('../services/pdfGenerator.service');
const logger = require('../utils/logger');

const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY
});

class PeticoesController {
    
    /**
     * Gerar petição com IA
     */
    static async gerarPeticaoComIA(req, res) {
        try {
            const {
                tipo,
                autor,
                reu,
                resumo_fatos,
                pedidos,
                processo_id,
                tribunal,
                vara,
                cidade
            } = req.body;

            const escritorioId = req.user.escritorio_id;
            const usuarioId = req.user.id;

            // Validações
            if (!tipo || !autor || !resumo_fatos || !pedidos) {
                return res.status(400).json({
                    ok: false,
                    erro: 'Campos obrigatórios: tipo, autor, resumo_fatos, pedidos'
                });
            }

            logger.info({ tipo, autor }, '[PETIÇÕES] Gerando petição com IA...');

            // ===== PROMPT PARA CLAUDE =====
            const prompt = PeticoesController.construirPromptIA(tipo, {
                autor,
                reu,
                resumo_fatos,
                pedidos,
                tribunal: tribunal || 'Tribunal competente',
                vara: vara || 'Vara competente'
            });

            // ===== CHAMAR IA =====
            const message = await anthropic.messages.create({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 4096,
                temperature: 0.3, // Mais determinístico para textos jurídicos
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            });

            const conteudoGerado = message.content[0].text;

            // ===== SALVAR NO BANCO =====
            const titulo = PeticoesController.gerarTituloPeticao(tipo, autor, reu);
            
            const query = `
                INSERT INTO peticoes (
                    escritorio_id, processo_id, usuario_id,
                    tipo, titulo, autor, reu,
                    resumo_fatos, pedidos, conteudo_gerado,
                    status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'gerado')
                RETURNING *
            `;

            const values = [
                escritorioId,
                processo_id || null,
                usuarioId,
                tipo,
                titulo,
                autor,
                reu || null,
                resumo_fatos,
                pedidos,
                conteudoGerado
            ];

            const result = await pool.query(query, values);
            const peticao = result.rows[0];

            logger.info({ id: peticao.id }, '[PETIÇÕES] Petição gerada com sucesso');

            return res.status(201).json({
                ok: true,
                peticao: {
                    id: peticao.id,
                    tipo: peticao.tipo,
                    titulo: peticao.titulo,
                    autor: peticao.autor,
                    reu: peticao.reu,
                    conteudo: peticao.conteudo_gerado,
                    status: peticao.status,
                    created_at: peticao.created_at
                }
            });

        } catch (error) {
            logger.error({ err: error.message }, '[PETIÇÕES] Erro ao gerar petição');
            
            if (error.status === 401) {
                return res.status(500).json({
                    ok: false,
                    erro: 'Chave da API Claude não configurada'
                });
            }

            return res.status(500).json({
                ok: false,
                erro: 'Erro ao gerar petição',
                detalhe: error.message
            });
        }
    }

    /**
     * Gerar PDF da petição
     */
    static async gerarPDF(req, res) {
        try {
            const { id } = req.params;
            const escritorioId = req.user.escritorio_id;

            // Buscar petição
            const query = `
                SELECT p.*, u.nome as advogado_nome, e.oab_numero as advogado_oab
                FROM peticoes p
                JOIN usuarios u ON p.usuario_id = u.id
                LEFT JOIN escritorios e ON p.escritorio_id = e.id
                WHERE p.id = $1 AND p.escritorio_id = $2
            `;

            const result = await pool.query(query, [id, escritorioId]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    ok: false,
                    erro: 'Petição não encontrada'
                });
            }

            const peticao = result.rows[0];

            logger.info({ id }, '[PETIÇÕES] Gerando PDF para petição');

            // Gerar PDF
            const pdfResult = await PDFGeneratorService.gerarPeticaoPDF({
                id: peticao.id,
                tipo: peticao.tipo,
                titulo: peticao.titulo,
                autor: peticao.autor,
                reu: peticao.reu,
                conteudo_gerado: peticao.conteudo_gerado,
                conteudo_editado: peticao.conteudo_editado,
                advogado_nome: peticao.advogado_nome,
                advogado_oab: peticao.advogado_oab,
                tribunal: peticao.tribunal,
                vara: peticao.vara,
                cidade: peticao.cidade || 'Cidade'
            });

            // Atualizar URL do PDF no banco
            await pool.query(
                'UPDATE peticoes SET pdf_url = $1 WHERE id = $2',
                [pdfResult.url, id]
            );

            logger.info({ filename: pdfResult.filename }, '[PETIÇÕES] PDF gerado com sucesso');

            return res.json({
                ok: true,
                pdf: {
                    url: pdfResult.url,
                    filename: pdfResult.filename
                }
            });

        } catch (error) {
            logger.error({ err: error.message }, '[PETIÇÕES] Erro ao gerar PDF');
            return res.status(500).json({
                ok: false,
                erro: 'Erro ao gerar PDF',
                detalhe: error.message
            });
        }
    }

    /**
     * Listar petições do escritório
     */
    static async listarPeticoes(req, res) {
        try {
            const escritorioId = req.user.escritorio_id;
            const { status, tipo, limit = 50 } = req.query;

            let query = `
                SELECT p.*, u.nome as usuario_nome, pr.numero as numero_processo
                FROM peticoes p
                JOIN usuarios u ON p.usuario_id = u.id
                LEFT JOIN processos pr ON p.processo_id = pr.id
                WHERE p.escritorio_id = $1
            `;

            const params = [escritorioId];
            let paramCount = 1;

            if (status) {
                paramCount++;
                query += ` AND p.status = $${paramCount}`;
                params.push(status);
            }

            if (tipo) {
                paramCount++;
                query += ` AND p.tipo = $${paramCount}`;
                params.push(tipo);
            }

            query += ` ORDER BY p.created_at DESC LIMIT $${paramCount + 1}`;
            params.push(parseInt(limit));

            const result = await pool.query(query, params);

            return res.json({
                ok: true,
                peticoes: result.rows
            });

        } catch (error) {
            logger.error({ err: error.message }, '[PETIÇÕES] Erro ao listar');
            return res.status(500).json({
                ok: false,
                erro: 'Erro ao listar petições'
            });
        }
    }

    /**
     * Editar conteúdo da petição
     */
    static async editarConteudo(req, res) {
        try {
            const { id } = req.params;
            const { conteudo } = req.body;
            const escritorioId = req.user.escritorio_id;

            await pool.query(
                `UPDATE peticoes 
                 SET conteudo_editado = $1, updated_at = NOW()
                 WHERE id = $2 AND escritorio_id = $3`,
                [conteudo, id, escritorioId]
            );

            return res.json({
                ok: true,
                mensagem: 'Conteúdo atualizado com sucesso'
            });

        } catch (error) {
            logger.error({ err: error.message }, '[PETIÇÕES] Erro ao editar');
            return res.status(500).json({
                ok: false,
                erro: 'Erro ao editar petição'
            });
        }
    }

    /**
     * Deletar petição
     */
    static async deletarPeticao(req, res) {
        try {
            const { id } = req.params;
            const escritorioId = req.user.escritorio_id;

            // Buscar petição para pegar URL do PDF
            const result = await pool.query(
                'SELECT pdf_url FROM peticoes WHERE id = $1 AND escritorio_id = $2',
                [id, escritorioId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    ok: false,
                    erro: 'Petição não encontrada'
                });
            }

            // Deletar PDF se existir
            if (result.rows[0].pdf_url) {
                const filename = result.rows[0].pdf_url.split('/').pop();
                await PDFGeneratorService.deletarPDF(filename);
            }

            // Deletar do banco
            await pool.query(
                'DELETE FROM peticoes WHERE id = $1 AND escritorio_id = $2',
                [id, escritorioId]
            );

            return res.json({
                ok: true,
                mensagem: 'Petição deletada com sucesso'
            });

        } catch (error) {
            logger.error({ err: error.message }, '[PETIÇÕES] Erro ao deletar');
            return res.status(500).json({
                ok: false,
                erro: 'Erro ao deletar petição'
            });
        }
    }

    // ===== MÉTODOS AUXILIARES =====

    /**
     * Construir prompt para IA baseado no tipo de petição
     */
    static construirPromptIA(tipo, dados) {
        const promptsBase = {
            inicial: `Você é um advogado especialista em elaborar petições iniciais.

DADOS DA AÇÃO:
- Autor: ${dados.autor}
- Réu: ${dados.reu || 'A definir'}
- Tribunal: ${dados.tribunal}
- Vara: ${dados.vara}

RESUMO DOS FATOS:
${dados.resumo_fatos}

PEDIDOS:
${dados.pedidos}

INSTRUÇÕES:
Elabore uma PETIÇÃO INICIAL completa e profissional seguindo a estrutura:

1. EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DA [VARA]

2. Qualificação completa do autor (use dados fornecidos + crie CPF/RG/endereço fictícios realistas)

3. DOS FATOS (narrativa detalhada e cronológica dos acontecimentos)

4. DO DIREITO (fundamentação jurídica com citação de artigos de lei aplicáveis)

5. DOS PEDIDOS (estruturado em itens claros)

6. DO VALOR DA CAUSA (estime um valor razoável)

7. DAS PROVAS (liste provas documentais e testemunhais pertinentes)

Use linguagem jurídica formal, seja objetivo e fundamentado. Inclua artigos de lei relevantes (Código Civil, CLT, CDC conforme o caso).`,

            contestacao: `Você é um advogado elaborando uma CONTESTAÇÃO.

DADOS:
- Contestante: ${dados.autor}
- Parte Contrária: ${dados.reu}
- Fatos Alegados pela Parte Contrária: ${dados.resumo_fatos}
- Argumentos de Defesa: ${dados.pedidos}

Elabore uma CONTESTAÇÃO completa com:
1. Preliminares (se aplicável)
2. Mérito (negativa dos fatos, apresentação da versão do contestante)
3. Impugnação aos pedidos
4. Pedidos finais

Use linguagem técnica e seja rigoroso na defesa.`,

            recurso: `Você é um advogado elaborando um RECURSO.

DADOS:
- Recorrente: ${dados.autor}
- Recorrido: ${dados.reu}
- Decisão Recorrida: ${dados.resumo_fatos}
- Fundamentos do Recurso: ${dados.pedidos}

Elabore um RECURSO DE APELAÇÃO com:
1. Juízo de admissibilidade
2. Razões de fato e de direito
3. Demonstração do erro/injustiça da decisão
4. Pedido de reforma

Seja técnico e fundamentado.`,

            intermediaria: `Você é um advogado elaborando uma PETIÇÃO INTERMEDIÁRIA.

DADOS:
- Requerente: ${dados.autor}
- Parte Contrária: ${dados.reu || 'Outra parte'}
- Contexto: ${dados.resumo_fatos}
- Pedido: ${dados.pedidos}

Elabore uma petição intermediária clara, objetiva e fundamentada.`
        };

        return promptsBase[tipo] || promptsBase.intermediaria;
    }

    /**
     * Gerar título automático para a petição
     */
    static gerarTituloPeticao(tipo, autor, reu) {
        const tipoLabel = {
            civel_inicial: 'PETIÇÃO INICIAL',
            civel_intermediaria: 'PETIÇÃO INTERMEDIÁRIA',
            civel_contestacao: 'CONTESTAÇÃO',
            civel_replica: 'RÉPLICA',
            civel_cumprimento: 'CUMPRIMENTO DE SENTENÇA',
            civel_cautelar: 'TUTELA DE URGÊNCIA',
            civel_juntada: 'PETIÇÃO DE JUNTADA',
            civel_apelacao: 'APELAÇÃO',
            civel_agravo: 'AGRAVO DE INSTRUMENTO',
            civel_embargos_declaracao: 'EMBARGOS DE DECLARAÇÃO',
            civel_embargos_execucao: 'EMBARGOS À EXECUÇÃO',
            civel_impugnacao_calculos: 'IMPUGNAÇÃO AOS CÁLCULOS',
            trab_reclamacao: 'RECLAMAÇÃO TRABALHISTA',
            trab_contestacao: 'CONTESTAÇÃO TRABALHISTA',
            trab_recurso_ordinario: 'RECURSO ORDINÁRIO',
            trab_recurso_revista: 'RECURSO DE REVISTA',
            penal_habeas_corpus: 'HABEAS CORPUS',
            penal_apelacao: 'APELAÇÃO CRIMINAL',
            inicial: 'PETIÇÃO INICIAL',
            contestacao: 'CONTESTAÇÃO',
            recurso: 'RECURSO DE APELAÇÃO',
            intermediaria: 'PETIÇÃO INTERMEDIÁRIA'
        };

        const label = tipoLabel[tipo] || 'PETIÇÃO';
        let titulo = reu
            ? `${label} - ${autor.toUpperCase()} vs ${reu.toUpperCase()}`
            : `${label} - ${autor.toUpperCase()}`;

        // Garantir que não exceda 255 caracteres (limite da coluna)
        if (titulo.length > 255) titulo = titulo.substring(0, 252) + '...';
        return titulo;
    }
}

module.exports = PeticoesController;