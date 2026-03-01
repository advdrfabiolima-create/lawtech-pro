const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const PDFDocument = require('pdfkit');

// ============================================================
// 📁 CONFIGURAÇÃO DE UPLOAD DE LOGOMARCA
// ============================================================

const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads/logos');
        try {
            await fs.mkdir(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (err) {
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        const escritorioId = req.user.escritorio_id;
        const ext = path.extname(file.originalname);
        cb(null, `logo-escritorio-${escritorioId}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Apenas imagens (PNG, JPG, GIF) são permitidas'));
        }
    }
});

// ============================================================
// 📤 UPLOAD DE LOGOMARCA
// ============================================================

router.post('/recibos/upload-logo',
    authMiddleware,
    roleMiddleware('admin'),
    (req, res, next) => {
        upload.single('logo')(req, res, (err) => {
            if (err) {
                console.error('Erro no upload:', err);
                return res.status(400).json({ 
                    ok: false,
                    erro: err.message || 'Erro ao fazer upload do arquivo' 
                });
            }
            next();
        });
    },
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ 
                    ok: false,
                    erro: 'Nenhum arquivo enviado' 
                });
            }

            const logoPath = `/uploads/logos/${req.file.filename}`;
            const escritorioId = req.user.escritorio_id;

            // Salva o caminho da logo no banco de dados
            await pool.query(
                'UPDATE escritorios SET logo_path = $1 WHERE id = $2',
                [logoPath, escritorioId]
            );

            console.log('✅ Logo salva com sucesso:', logoPath);

            res.json({
                ok: true,
                mensagem: 'Logo atualizada com sucesso!',
                logoPath: logoPath
            });
        } catch (err) {
            console.error('Erro ao salvar logo no banco:', err);
            res.status(500).json({ 
                ok: false,
                erro: 'Erro ao salvar logo no banco de dados' 
            });
        }
    }
);

// ============================================================
// 📤 UPLOAD DA ASSINATURA
// ============================================================

const assinaturaStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const dir = path.join(__dirname, '../uploads/assinaturas');
        await fs.mkdir(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `assinatura-escritorio-${req.user.escritorio_id}${ext}`);
    }
});

const uploadAssinatura = multer({
    storage: assinaturaStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = /png|jpg|jpeg/.test(file.mimetype);
        ok ? cb(null, true) : cb(new Error('Assinatura deve ser PNG ou JPG'));
    }
});

// ============================================================
// 🔍 BUSCAR LOGOMARCA ATUAL
// ============================================================

router.get('/recibos/logo',
    authMiddleware,
    async (req, res) => {
        try {
            const result = await pool.query(
                'SELECT logo_path FROM escritorios WHERE id = $1',
                [req.user.escritorio_id]
            );

            if (result.rows.length === 0 || !result.rows[0].logo_path) {
                return res.json({ 
                    ok: true,
                    logoPath: null 
                });
            }

            res.json({ 
                ok: true,
                logoPath: result.rows[0].logo_path 
            });
        } catch (err) {
            console.error('Erro ao buscar logo:', err);
            res.status(500).json({ 
                ok: false,
                erro: 'Erro ao buscar logo' 
            });
        }
    }
);

// ============================================================
// 🔍 BUSCAR ASSINATURA ATUAL
// ============================================================

router.post(
    '/recibos/upload-assinatura',
    authMiddleware,
    roleMiddleware('admin'),
    uploadAssinatura.single('assinatura'),
    async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ erro: 'Nenhuma assinatura enviada' });
        }

        const assinaturaPath = `/uploads/assinaturas/${req.file.filename}`;

        await pool.query(
            'UPDATE escritorios SET assinatura_path = $1 WHERE id = $2',
            [assinaturaPath, req.user.escritorio_id]
        );

        res.json({
            ok: true,
            assinaturaPath
        });
    }
);

// ============================================================
// 📄 GERAR RECIBO EM PDF - VERSÃO PROFISSIONAL MELHORADA
// ============================================================
// 
// INSTRUÇÕES:
// Substitua a função router.post('/recibos/gerar', ...) 
// no seu arquivo recibos_routes.js por esta versão
//
// ============================================================

router.post('/recibos/gerar',
    authMiddleware,
    roleMiddleware('admin', 'operador'),
    async (req, res) => {
        try {
            const {
                lancamentoId,
                clienteNome,
                clienteDocumento,
                valor,
                descricao,
                formaPagamento,
                numeroRecibo
            } = req.body;

            if (!clienteNome || !valor || !descricao) {
                return res.status(400).json({
                    erro: 'Preencha todos os campos obrigatórios'
                });
            }

            const escritorioResult = await pool.query(
                `SELECT nome, documento, endereco, cidade, estado, cep, email, logo_path, assinatura_path
                 FROM escritorios WHERE id = $1`,
                [req.user.escritorio_id]
            );

            if (escritorioResult.rows.length === 0) {
                return res.status(400).json({ erro: 'Escritório não encontrado' });
            }

            const escritorio = escritorioResult.rows[0];

            // Criar documento PDF
            const doc = new PDFDocument({
                size: 'A4',
                margins: { top: 40, bottom: 40, left: 50, right: 50 },
                bufferPages: true
            });

            const fileName = `recibo-${numeroRecibo || Date.now()}.pdf`;
            const tempDir = path.join(__dirname, '../temp');
            await fs.mkdir(tempDir, { recursive: true });
            const filePath = path.join(tempDir, fileName);

            const writeStream = require('fs').createWriteStream(filePath);
            doc.pipe(writeStream);

            // ── Constantes de layout ─────────────────────────────────
            const L = 50;   // left
            const R = 545;  // right
            const W = 495;  // content width
            const NAVY  = '#1e3a5f';
            const DARK  = '#1e293b';
            const GRAY  = '#64748b';
            const LGRAY = '#94a3b8';
            const LINE  = '#e2e8f0';

            // ============================================================
            // CABEÇALHO
            // ============================================================

            // Barra navy topo
            doc.rect(L, 40, W, 4).fill(NAVY);

            // Logo (máx 95×95)
            const LOGO_MAX = 114;
            let logoBottomY = 55;
            if (escritorio.logo_path) {
                try {
                    const lp = path.join(__dirname, '..', escritorio.logo_path);
                    await fs.access(lp);
                    doc.image(lp, L, 52, { fit: [LOGO_MAX, LOGO_MAX] });
                    logoBottomY = 52 + LOGO_MAX;
                } catch { /* logo ausente */ }
            }

            // Bloco de dados do escritório (direita)
            let iy = 52;
            const IX = 160;
            doc.font('Helvetica-Bold').fontSize(13).fillColor(DARK)
               .text(escritorio.nome || 'Escritório', IX, iy, { width: R - IX, align: 'right' });
            iy += 18;
            if (escritorio.documento) {
                doc.font('Helvetica').fontSize(8).fillColor(GRAY)
                   .text(`CPF/CNPJ: ${escritorio.documento}`, IX, iy, { width: R - IX, align: 'right' });
                iy += 13;
            }
            const addr = [escritorio.endereco, escritorio.cidade, escritorio.estado].filter(Boolean).join(', ');
            if (addr) {
                doc.font('Helvetica').fontSize(8).fillColor(GRAY)
                   .text(addr, IX, iy, { width: R - IX, align: 'right' });
                iy += 13;
            }
            if (escritorio.email) {
                doc.font('Helvetica').fontSize(8).fillColor(GRAY)
                   .text(escritorio.email, IX, iy, { width: R - IX, align: 'right' });
                iy += 13;
            }

            // Linha divisória
            const divY = Math.max(logoBottomY, iy) + 12;
            doc.moveTo(L, divY).lineTo(R, divY).strokeColor(NAVY).lineWidth(1).stroke();

            // ============================================================
            // IDENTIFICAÇÃO DO DOCUMENTO
            // ============================================================

            const titleY = divY + 16;
            doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY)
               .text('RECIBO  DE  PAGAMENTO', L, titleY, { width: W, align: 'center' });

            const numY = titleY + 22;
            const dataEmissao = new Date().toLocaleDateString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric'
            });
            doc.font('Helvetica').fontSize(8.5).fillColor(GRAY)
               .text(`Nº ${numeroRecibo || 'REC-0001'}`, L, numY, { width: W, align: 'left' })
               .text(`Data de emissão: ${dataEmissao}`, L, numY, { width: W, align: 'right' });

            // ============================================================
            // BOX DE VALOR
            // ============================================================

            const boxY  = numY + 20;
            const boxH  = 66;
            doc.roundedRect(L, boxY, W, boxH, 5).fill(NAVY);

            doc.font('Helvetica').fontSize(8).fillColor('#93c5fd')
               .text('VALOR RECEBIDO', L + 18, boxY + 11);

            const valorFmt = Number(valor).toLocaleString('pt-BR', {
                minimumFractionDigits: 2, maximumFractionDigits: 2
            });
            doc.font('Helvetica-Bold').fontSize(22).fillColor('#ffffff')
               .text(`R$ ${valorFmt}`, L + 18, boxY + 22, { width: W - 36, align: 'right' });

            doc.font('Helvetica').fontSize(8).fillColor('#bfdbfe')
               .text(`Por extenso: ${extenso(Number(valor))}`, L + 18, boxY + 50, { width: W - 36 });

            // ============================================================
            // DADOS DO PAGAMENTO
            // ============================================================

            const secY = boxY + boxH + 22;
            doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
               .text('DADOS DO PAGAMENTO', L, secY);
            doc.moveTo(L, secY + 14).lineTo(R, secY + 14)
               .strokeColor(NAVY).lineWidth(0.5).stroke();

            let rowY = secY + 24;
            const LABEL_W = 145;
            const VAL_X  = L + 155;
            const VAL_W  = W - 155;
            const ROW_H  = 28;

            const drawRow = (label, value, bold = false) => {
                doc.font('Helvetica').fontSize(8.5).fillColor(GRAY)
                   .text(label, L, rowY + 6, { width: LABEL_W });
                doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(DARK)
                   .text(value || '—', VAL_X, rowY + 5, { width: VAL_W });
                rowY += ROW_H;
                doc.moveTo(L, rowY).lineTo(R, rowY)
                   .strokeColor(LINE).lineWidth(0.5).stroke();
            };

            drawRow('Recebemos de:', clienteNome, true);
            if (clienteDocumento) drawRow('CPF / CNPJ:', clienteDocumento);
            drawRow('Referente a:', descricao);
            drawRow('Forma de pagamento:', formaPagamento || 'Não especificado');
            drawRow('Por extenso:', extenso(Number(valor)));

            // ============================================================
            // ASSINATURA  (Y fixo — não depende do conteúdo das linhas)
            // ============================================================

            const SIG_X    = R - 210;   // x inicial do bloco
            const SIG_W    = 210;
            const SIG_IMG_W = 192;      // largura máxima da imagem
            const SIG_IMG_H = 102;      // altura máxima da imagem
            const sigLineY  = 660;      // Y fixo da linha de assinatura

            if (escritorio.assinatura_path) {
                try {
                    const sp = path.join(__dirname, '..', escritorio.assinatura_path);
                    await fs.access(sp);
                    // Centraliza a imagem horizontalmente no bloco, com base inferior colada à linha
                    const imgX = SIG_X + (SIG_W - SIG_IMG_W) / 2;
                    const imgY = sigLineY - SIG_IMG_H - 2;  // 2pt de gap acima da linha
                    doc.image(sp, imgX, imgY, { fit: [SIG_IMG_W, SIG_IMG_H] });
                } catch { /* assinatura ausente */ }
            }

            doc.moveTo(SIG_X, sigLineY).lineTo(SIG_X + SIG_W, sigLineY)
               .strokeColor(LGRAY).lineWidth(0.8).stroke();

            doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK)
               .text(escritorio.nome || '', SIG_X, sigLineY + 8, { width: SIG_W, align: 'center' });
            doc.font('Helvetica').fontSize(8).fillColor(GRAY)
               .text('Responsável pelo recebimento', SIG_X, sigLineY + 22, { width: SIG_W, align: 'center' });

            // ============================================================
            // RODAPÉ
            // ============================================================

            // Rodapé em Y fixo — nunca depende do conteúdo acima
            const footerY = 755;
            doc.moveTo(L, footerY).lineTo(R, footerY)
               .strokeColor(LINE).lineWidth(0.5).stroke();

            const enderecoCompleto = [
                escritorio.endereco,
                escritorio.cidade,
                escritorio.estado,
                escritorio.cep ? `CEP ${escritorio.cep}` : null
            ].filter(Boolean).join(' – ');

            doc.font('Helvetica').fontSize(7.5).fillColor(LGRAY);
            let ftY = footerY + 9;
            if (enderecoCompleto) {
                doc.text(enderecoCompleto, L, ftY, { width: W, align: 'center', lineBreak: false });
                ftY += 12;
            }
            if (escritorio.email) {
                doc.text(escritorio.email, L, ftY, { width: W, align: 'center', lineBreak: false });
            }

            // ============================================================
            // FINALIZAÇÃO
            // ============================================================

            doc.end();

            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });

            // Enviar arquivo para download
            res.download(filePath, fileName, async () => {
                try {
                    await fs.unlink(filePath);
                } catch {}
            });

        } catch (err) {
            console.error('❌ Erro ao gerar recibo:', err);
            res.status(500).json({ erro: 'Erro ao gerar recibo' });
        }
    }
);
// ============================================================
// 📊 LISTAR RECIBOS EMITIDOS
// ============================================================

router.get('/recibos/historico',
    authMiddleware,
    async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT * FROM recibos_emitidos 
                 WHERE escritorio_id = $1 
                 ORDER BY data_emissao DESC 
                 LIMIT 50`,
                [req.user.escritorio_id]
            );

            res.json(result.rows);
        } catch (err) {
            console.error('Erro ao buscar histórico:', err);
            res.status(500).json({ erro: 'Erro ao buscar histórico' });
        }
    }
);

// ============================================================
// 🔢 FUNÇÃO AUXILIAR - CONVERTER NÚMERO PARA EXTENSO
// ============================================================

function extenso(valor) {
    const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
    const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
    const especiais = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
    const centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

    const partes = valor.toFixed(2).split('.');
    const reais = parseInt(partes[0]);
    const centavos = parseInt(partes[1]);

    function converterGrupo(num) {
        if (num === 0) return '';
        if (num < 10) return unidades[num];
        if (num < 20) return especiais[num - 10];
        if (num < 100) {
            const dez = Math.floor(num / 10);
            const uni = num % 10;
            return dezenas[dez] + (uni > 0 ? ' e ' + unidades[uni] : '');
        }
        if (num < 1000) {
            const cen = Math.floor(num / 100);
            const resto = num % 100;
            if (num === 100) return 'cem';
            return centenas[cen] + (resto > 0 ? ' e ' + converterGrupo(resto) : '');
        }
        return '';
    }

    function converterReais(num) {
        if (num === 0) return 'zero';
        
        const milhares = Math.floor(num / 1000);
        const resto = num % 1000;
        
        let resultado = '';
        
        if (milhares > 0) {
            resultado += converterGrupo(milhares) + (milhares === 1 ? ' mil' : ' mil');
            if (resto > 0) resultado += (resto < 100 ? ' e ' : ' ');
        }
        
        if (resto > 0) {
            resultado += converterGrupo(resto);
        }
        
        return resultado;
    }

    let texto = converterReais(reais) + (reais === 1 ? ' real' : ' reais');
    
    if (centavos > 0) {
        texto += ' e ' + converterGrupo(centavos) + (centavos === 1 ? ' centavo' : ' centavos');
    }

    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

module.exports = router;