/**
 * ============================================
 * PETIÇÕES CONTROLLER
 * Gerencia geração de petições com IA
 * ============================================
 */

const pool = require('../config/db');
const Anthropic = require('@anthropic-ai/sdk');
const multer  = require('multer');
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const PDFGeneratorService = require('../services/pdfGenerator.service');
const logger = require('../utils/logger');

const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY
});

// Aceita qualquer campo de arquivo — filtra por fieldname no handler
const uploadMiddleware = upload.any();

function limparMarkdown(texto) {
    if (!texto) return texto;
    return texto
        .replace(/^#{1,6}\s+(.+)$/gm, function(_, t) { return t.toUpperCase(); })
        .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/_(.+?)_/g, '$1')
        .replace(/^[-*_]{3,}\s*$/gm, '')
        .replace(/^>\s*/gm, '')
        .replace(/^[\s]*[-*+]\s+/gm, '')
        .replace(/^[\s]*\d+\.\s+/gm, '')
        .replace(/\[(.+?)\]\(.+?\)/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

class PeticoesController {
    
    /**
     * Gerar petição com IA
     */
    static async gerarPeticaoComIA(req, res) {
        try {
            const {
                tipo,
                autor,
                cpf_autor,
                endereco_autor,
                reu,
                reu_cpf_cnpj,
                reu_endereco,
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

            const arquivosFiltrados = (req.files || []).filter(f => f.fieldname === 'documentos');
            logger.info({ tipo, autor, arquivos: arquivosFiltrados.length }, '[PETIÇÕES] Gerando petição com IA...');

            // ===== PROMPT PARA CLAUDE =====
            const prompt = PeticoesController.construirPromptIA(tipo, {
                autor,
                cpf_autor,
                endereco_autor,
                reu,
                reu_cpf_cnpj,
                reu_endereco,
                resumo_fatos,
                pedidos,
                tribunal: tribunal || 'Tribunal competente',
                vara: vara || 'Vara competente'
            });

            // ===== MONTAR CONTEÚDO (PDFs primeiro, depois prompt) =====
            const conteudoMensagem = [];
            if (arquivosFiltrados.length > 0) {
                arquivosFiltrados.forEach(function(file) {
                    conteudoMensagem.push({
                        type: 'document',
                        source: {
                            type: 'base64',
                            media_type: 'application/pdf',
                            data: file.buffer.toString('base64')
                        },
                        title: file.originalname,
                        context: 'Documento anexado pelo advogado contendo dados das partes e informações do caso'
                    });
                });
                logger.info({ qtd: arquivosFiltrados.length }, '[PETIÇÕES] PDFs enviados à IA');
            }
            conteudoMensagem.push({ type: 'text', text: prompt });

            // ===== CHAMAR IA =====
            const message = await anthropic.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 8000,
                temperature: 0.3,
                messages: [{
                    role: 'user',
                    content: conteudoMensagem
                }]
            });

            const conteudoGerado = limparMarkdown(message.content[0].text);

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

        const instrucaoBase = [
            'REGRAS OBRIGATÓRIAS — SIGA À RISCA:',
            'NUNCA use Markdown: proibido #, ##, **, *, ---, >, listas com hífen ou asterisco',
            'Escreva em texto puro como documento jurídico impresso',
            'Títulos de seções em LETRAS MAIÚSCULAS, ex: I – DOS FATOS',
            'Parágrafos corridos sem marcadores de lista',
            'Destaques feitos apenas com LETRAS MAIÚSCULAS, nunca com asteriscos',
            'Citações de lei em parágrafo próprio, entre aspas simples',
            'O documento deve parecer uma peça jurídica real pronta para protocolo'
        ].join('\n');

        const tipoLabel = {
            civel_inicial:               'PETIÇÃO INICIAL',
            civel_intermediaria:         'PETIÇÃO INTERMEDIÁRIA',
            civel_contestacao:           'CONTESTAÇÃO',
            civel_replica:               'RÉPLICA',
            civel_cumprimento:           'CUMPRIMENTO DE SENTENÇA',
            civel_cautelar:              'MEDIDA CAUTELAR / TUTELA DE URGÊNCIA',
            civel_juntada:               'PETIÇÃO DE JUNTADA',
            civel_apelacao:              'APELAÇÃO CÍVEL',
            civel_agravo:                'AGRAVO DE INSTRUMENTO',
            civel_embargos_declaracao:   'EMBARGOS DE DECLARAÇÃO',
            civel_embargos_execucao:     'EMBARGOS À EXECUÇÃO',
            civel_impugnacao_calculos:   'IMPUGNAÇÃO AOS CÁLCULOS',
            trab_reclamacao:             'RECLAMAÇÃO TRABALHISTA',
            trab_homologacao_acordo:     'HOMOLOGAÇÃO DE ACORDO EXTRAJUDICIAL',
            trab_consignacao:            'AÇÃO DE CONSIGNAÇÃO EM PAGAMENTO',
            trab_inquerito_falta:        'INQUÉRITO PARA APURAÇÃO DE FALTA GRAVE',
            trab_dano_moral:             'AÇÃO DE DANO MORAL',
            trab_reversao_justa_causa:   'REVERSÃO DE JUSTA CAUSA',
            trab_vinculo:                'RECONHECIMENTO DE VÍNCULO EMPREGATÍCIO',
            trab_rescisao_indireta:      'RESCISÃO INDIRETA',
            trab_contestacao:            'CONTESTAÇÃO TRABALHISTA',
            trab_reconvencao:            'RECONVENÇÃO',
            trab_impugnacao_laudo:       'IMPUGNAÇÃO AO LAUDO PERICIAL',
            trab_acordo:                 'ACORDO JUDICIAL',
            trab_recurso_ordinario:      'RECURSO ORDINÁRIO',
            trab_recurso_revista:        'RECURSO DE REVISTA',
            trab_agravo_peticao:         'AGRAVO DE PETIÇÃO',
            penal_relaxamento:           'RELAXAMENTO DE PRISÃO EM FLAGRANTE',
            penal_revogacao_preventiva:  'REVOGAÇÃO DE PRISÃO PREVENTIVA',
            penal_liberdade_provisoria:  'LIBERDADE PROVISÓRIA',
            penal_habeas_corpus:         'HABEAS CORPUS',
            penal_resposta_acusacao:     'RESPOSTA À ACUSAÇÃO',
            penal_defesa_previa:         'DEFESA PRÉVIA',
            penal_queixa_crime:          'QUEIXA-CRIME',
            penal_representacao:         'REPRESENTAÇÃO CRIMINAL',
            penal_memoriais:             'MEMORIAIS / ALEGAÇÕES FINAIS',
            penal_restituicao:           'RESTITUIÇÃO DE COISA APREENDIDA',
            penal_provas:                'PEDIDO DE PRODUÇÃO DE PROVAS',
            penal_apelacao:              'APELAÇÃO CRIMINAL',
            penal_rese:                  'RECURSO EM SENTIDO ESTRITO',
            inicial:                     'PETIÇÃO INICIAL',
            contestacao:                 'CONTESTAÇÃO',
            recurso:                     'RECURSO DE APELAÇÃO',
            intermediaria:               'PETIÇÃO INTERMEDIÁRIA'
        };

        const label = tipoLabel[tipo] || 'PETIÇÃO';

        const estrutura = [
            'EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(ÍZA) DE DIREITO DA ' + dados.vara + ' DA COMARCA DE ' + dados.tribunal,
            '',
            '[Qualificação da parte em parágrafo corrido: nome, nacionalidade, estado civil, profissão, CPF, endereço — extraia dos documentos PDF anexados se disponíveis]',
            '',
            'vem, respeitosamente, à presença de Vossa Excelência, apresentar a presente ' + label + ', pelos fatos e fundamentos a seguir:',
            '',
            'I – DOS FATOS',
            '',
            '[Narrativa cronológica e detalhada em parágrafos corridos, sem marcadores de lista]',
            '',
            'II – DO DIREITO',
            '',
            '[Fundamentação jurídica com artigos do CC, CDC, CPC, CLT conforme o caso, em parágrafos corridos]',
            '',
            'III – DOS PEDIDOS',
            '',
            'Diante do exposto, requer a Vossa Excelência:',
            'a) [pedido principal];',
            'b) [pedidos acessórios];',
            'c) A condenação em custas processuais e honorários advocatícios.',
            '',
            'IV – DO VALOR DA CAUSA',
            '',
            'Dá-se à causa o valor de R$ [valor estimado].',
            '',
            'Termos em que, pede deferimento.',
            '',
            'Local, ___ de ___ de 2026.',
            '',
            '_______________________________',
            '[Nome do Advogado]',
            'OAB/__ n. _____'
        ].join('\n');

        return 'Você é um advogado brasileiro sênior com 20 anos de experiência, especialista na elaboração de peças processuais.\n\n'
            + instrucaoBase + '\n\n'
            + 'DADOS DA PETIÇÃO:\n'
            + '- Tipo: ' + label + '\n'
            + '- Autor/Requerente: ' + dados.autor + '\n'
            + (dados.cpf_autor ? '- CPF do Autor: ' + dados.cpf_autor + '\n' : '')
            + (dados.endereco_autor ? '- Endereço do Autor: ' + dados.endereco_autor + '\n' : '')
            + '- Réu/Requerido: ' + (dados.reu || 'A ser qualificado') + '\n'
            + (dados.reu_cpf_cnpj ? '- CPF/CNPJ do Réu: ' + dados.reu_cpf_cnpj + '\n' : '')
            + (dados.reu_endereco ? '- Endereço do Réu: ' + dados.reu_endereco + '\n' : '')
            + '- Tribunal/Comarca: ' + dados.tribunal + '\n'
            + '- Vara: ' + dados.vara + '\n\n'
            + 'RESUMO DOS FATOS FORNECIDO PELO ADVOGADO:\n'
            + dados.resumo_fatos + '\n\n'
            + 'PEDIDOS FORMULADOS PELO ADVOGADO:\n'
            + dados.pedidos + '\n\n'
            + 'ATENÇÃO: Se houver documentos PDF anexados, extraia deles os dados de qualificação '
            + 'das partes (nome completo, CPF, RG, endereço, estado civil, profissão) e use-os na petição.\n\n'
            + 'ESTRUTURA DO DOCUMENTO:\n'
            + estrutura + '\n\n'
            + 'INSTRUÇÕES FINAIS:\n'
            + '- Expanda cada seção com base nos dados fornecidos e nos documentos anexados\n'
            + '- Cite artigos de lei, súmulas e jurisprudências pertinentes ao caso concreto\n'
            + '- Mantenha linguagem jurídica formal e culta em todo o texto\n'
            + '- O documento deve estar pronto para protocolo\n'
            + '- NUNCA use #, ##, **, *, --- ou qualquer símbolo Markdown';
    }

        /**
     * Gerar título automático para a petição
     */
    static gerarTituloPeticao(tipo, autor, reu) {
        const tipoLabel = {
            civel_inicial:               'PETIÇÃO INICIAL',
            civel_intermediaria:         'PETIÇÃO INTERMEDIÁRIA',
            civel_contestacao:           'CONTESTAÇÃO',
            civel_replica:               'RÉPLICA',
            civel_cumprimento:           'CUMPRIMENTO DE SENTENÇA',
            civel_cautelar:              'MEDIDA CAUTELAR / TUTELA DE URGÊNCIA',
            civel_juntada:               'PETIÇÃO DE JUNTADA',
            civel_apelacao:              'APELAÇÃO CÍVEL',
            civel_agravo:                'AGRAVO DE INSTRUMENTO',
            civel_embargos_declaracao:   'EMBARGOS DE DECLARAÇÃO',
            civel_embargos_execucao:     'EMBARGOS À EXECUÇÃO',
            civel_impugnacao_calculos:   'IMPUGNAÇÃO AOS CÁLCULOS',
            trab_reclamacao:             'RECLAMAÇÃO TRABALHISTA',
            trab_homologacao_acordo:     'HOMOLOGAÇÃO DE ACORDO EXTRAJUDICIAL',
            trab_consignacao:            'AÇÃO DE CONSIGNAÇÃO EM PAGAMENTO',
            trab_inquerito_falta:        'INQUÉRITO PARA APURAÇÃO DE FALTA GRAVE',
            trab_dano_moral:             'AÇÃO DE DANO MORAL',
            trab_reversao_justa_causa:   'REVERSÃO DE JUSTA CAUSA',
            trab_vinculo:                'RECONHECIMENTO DE VÍNCULO EMPREGATÍCIO',
            trab_rescisao_indireta:      'RESCISÃO INDIRETA',
            trab_contestacao:            'CONTESTAÇÃO TRABALHISTA',
            trab_reconvencao:            'RECONVENÇÃO',
            trab_impugnacao_laudo:       'IMPUGNAÇÃO AO LAUDO PERICIAL',
            trab_acordo:                 'ACORDO JUDICIAL',
            trab_recurso_ordinario:      'RECURSO ORDINÁRIO',
            trab_recurso_revista:        'RECURSO DE REVISTA',
            trab_agravo_peticao:         'AGRAVO DE PETIÇÃO',
            penal_relaxamento:           'RELAXAMENTO DE PRISÃO EM FLAGRANTE',
            penal_revogacao_preventiva:  'REVOGAÇÃO DE PRISÃO PREVENTIVA',
            penal_liberdade_provisoria:  'LIBERDADE PROVISÓRIA',
            penal_habeas_corpus:         'HABEAS CORPUS',
            penal_resposta_acusacao:     'RESPOSTA À ACUSAÇÃO',
            penal_defesa_previa:         'DEFESA PRÉVIA',
            penal_queixa_crime:          'QUEIXA-CRIME',
            penal_representacao:         'REPRESENTAÇÃO CRIMINAL',
            penal_memoriais:             'MEMORIAIS / ALEGAÇÕES FINAIS',
            penal_restituicao:           'RESTITUIÇÃO DE COISA APREENDIDA',
            penal_provas:                'PEDIDO DE PRODUÇÃO DE PROVAS',
            penal_apelacao:              'APELAÇÃO CRIMINAL',
            penal_rese:                  'RECURSO EM SENTIDO ESTRITO',
            inicial:                     'PETIÇÃO INICIAL',
            contestacao:                 'CONTESTAÇÃO',
            recurso:                     'RECURSO DE APELAÇÃO',
            intermediaria:               'PETIÇÃO INTERMEDIÁRIA'
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

PeticoesController.uploadMiddleware = uploadMiddleware;

module.exports = PeticoesController;