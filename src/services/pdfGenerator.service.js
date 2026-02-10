/**
 * ============================================
 * PDF GENERATOR SERVICE
 * Gera PDFs profissionais para petições
 * ============================================
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class PDFGeneratorService {
    /**
     * Gera PDF de petição com formatação profissional
     */
    static async gerarPeticaoPDF(dados) {
        return new Promise((resolve, reject) => {
            try {
                // Criar diretório se não existir
                const pdfDir = path.join(__dirname, '../../public/peticoes');
                if (!fs.existsSync(pdfDir)) {
                    fs.mkdirSync(pdfDir, { recursive: true });
                }

                // Nome do arquivo
                const timestamp = Date.now();
                const filename = `peticao_${dados.id || timestamp}.pdf`;
                const filepath = path.join(pdfDir, filename);

                // Criar documento PDF
                const doc = new PDFDocument({
                    size: 'A4',
                    margins: {
                        top: 72,    // 2.5cm
                        bottom: 72,
                        left: 72,
                        right: 72
                    }
                });

                // Pipe para arquivo
                const stream = fs.createWriteStream(filepath);
                doc.pipe(stream);

                // ===== CABEÇALHO =====
                doc.fontSize(10)
                   .font('Helvetica')
                   .text('PODER JUDICIÁRIO', { align: 'center' })
                   .moveDown(0.3);

                if (dados.tribunal) {
                    doc.text(dados.tribunal.toUpperCase(), { align: 'center' })
                       .moveDown(0.3);
                }

                if (dados.vara) {
                    doc.text(dados.vara.toUpperCase(), { align: 'center' })
                       .moveDown(1);
                }

                // ===== TÍTULO DA PETIÇÃO =====
                doc.fontSize(12)
                   .font('Helvetica-Bold')
                   .text(dados.titulo.toUpperCase(), { align: 'center' })
                   .moveDown(2);

                // ===== QUALIFICAÇÃO DAS PARTES =====
                doc.fontSize(11)
                   .font('Helvetica-Bold')
                   .text(`${dados.tipo === 'inicial' ? 'AUTOR(A)' : 'REQUERENTE'}:`, { continued: true })
                   .font('Helvetica')
                   .text(` ${dados.autor}`)
                   .moveDown(0.5);

                if (dados.reu) {
                    doc.font('Helvetica-Bold')
                       .text(`${dados.tipo === 'inicial' ? 'RÉU/RÉ' : 'REQUERIDO(A)'}:`, { continued: true })
                       .font('Helvetica')
                       .text(` ${dados.reu}`)
                       .moveDown(1.5);
                }

                // ===== CONTEÚDO PRINCIPAL =====
                const conteudo = dados.conteudo_editado || dados.conteudo_gerado;
                
                // Dividir em parágrafos
                const paragrafos = conteudo.split('\n\n');
                
                paragrafos.forEach((paragrafo, index) => {
                    // Verificar se é um título/seção (geralmente em maiúsculas)
                    if (paragrafo.trim() === paragrafo.trim().toUpperCase() && 
                        paragrafo.trim().length < 100) {
                        // É um título
                        doc.moveDown(0.5)
                           .fontSize(11)
                           .font('Helvetica-Bold')
                           .text(paragrafo.trim(), {
                               align: 'left',
                               indent: 0
                           })
                           .moveDown(0.5);
                    } else {
                        // É parágrafo normal
                        doc.fontSize(11)
                           .font('Helvetica')
                           .text(paragrafo.trim(), {
                               align: 'justify',
                               indent: 40, // Recuo de parágrafo
                               lineGap: 2
                           })
                           .moveDown(0.8);
                    }

                    // Adicionar nova página se necessário
                    if (doc.y > 700) {
                        doc.addPage();
                    }
                });

                // ===== FECHO =====
                doc.moveDown(2)
                   .fontSize(11)
                   .font('Helvetica')
                   .text('Nestes termos,', { indent: 40 })
                   .text('Pede deferimento.', { indent: 40 })
                   .moveDown(2);

                // ===== LOCAL E DATA =====
                const dataAtual = new Date().toLocaleDateString('pt-BR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                });

                const cidade = dados.cidade || 'Cidade';
                
                doc.text(`${cidade}, ${dataAtual}.`, { indent: 40 })
                   .moveDown(3);

                // ===== ASSINATURA =====
                doc.fontSize(11)
                   .font('Helvetica')
                   .text('_'.repeat(50), { align: 'center' })
                   .moveDown(0.3)
                   .font('Helvetica-Bold')
                   .text(dados.advogado_nome || 'ADVOGADO(A)', { align: 'center' })
                   .font('Helvetica')
                   .text(`OAB/${dados.advogado_oab || 'XX 00000'}`, { align: 'center' });

                // ===== RODAPÉ (em todas as páginas) =====
                const range = doc.bufferedPageRange();
                for (let i = range.start; i < range.start + range.count; i++) {
                    doc.switchToPage(i);
                    
                    doc.fontSize(9)
                       .font('Helvetica')
                       .text(
                           `Página ${i + 1} de ${range.count}`,
                           72,
                           doc.page.height - 50,
                           { align: 'center' }
                       );
                }

                // Finalizar PDF
                doc.end();

                // Aguardar conclusão
                stream.on('finish', () => {
                    resolve({
                        success: true,
                        filepath: filepath,
                        filename: filename,
                        url: `/peticoes/${filename}`
                    });
                });

                stream.on('error', (err) => {
                    reject(err);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Assinar PDF com certificado digital A1
     * (Placeholder - requer biblioteca específica para assinatura)
     */
    static async assinarPDF(pdfPath, certificado) {
        // TODO: Implementar assinatura digital real
        // Requer biblioteca como node-signpdf ou jsrsasign
        
        console.log('[PDF] Assinatura digital - implementação futura');
        console.log('[PDF] Certificado:', certificado ? 'Presente' : 'Ausente');
        
        // Por enquanto, retorna o mesmo arquivo
        return {
            success: true,
            filepath: pdfPath,
            assinado: false,
            mensagem: 'Assinatura digital será implementada com certificado A1'
        };
    }

    /**
     * Deletar arquivo PDF
     */
    static async deletarPDF(filename) {
        try {
            const filepath = path.join(__dirname, '../../public/peticoes', filename);
            
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
                return { success: true };
            }
            
            return { success: false, error: 'Arquivo não encontrado' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

module.exports = PDFGeneratorService;