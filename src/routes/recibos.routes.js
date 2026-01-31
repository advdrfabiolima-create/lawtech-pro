const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
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
                margin: 50,
                bufferPages: true
            });

            const fileName = `recibo-${numeroRecibo || Date.now()}.pdf`;
            const tempDir = path.join(__dirname, '../temp');
            await fs.mkdir(tempDir, { recursive: true });
            const filePath = path.join(tempDir, fileName);

            const writeStream = require('fs').createWriteStream(filePath);
            doc.pipe(writeStream);

            // ============================================================
            // 🎨 CABEÇALHO PROFISSIONAL
            // ============================================================

            const headerTop = 60;
            const logoSize = 85;

            // Logo do escritório
            if (escritorio.logo_path) {
                try {
                    const logoFullPath = path.join(__dirname, '..', escritorio.logo_path);
                    await fs.access(logoFullPath);
                    
                    // Logo com borda sutil
                    doc.rect(50, headerTop, logoSize, logoSize)
                       .strokeColor('#e2e8f0')
                       .lineWidth(1)
                       .stroke();
                    
                    doc.image(logoFullPath, 52, headerTop + 2, { 
                        width: logoSize - 4, 
                        height: logoSize - 4,
                        fit: [logoSize - 4, logoSize - 4],
                        align: 'center',
                        valign: 'center'
                    });
                } catch (err) {
                    console.log('⚠️ Logo não encontrada');
                }
            }

            // Informações do escritório (lado direito)
            const infoX = 150;
            
            doc.font('Helvetica-Bold')
               .fontSize(16)
               .fillColor('#1e293b')
               .text(
                   escritorio.nome || 'Nome do Escritório',
                   infoX,
                   headerTop,
                   { width: 395, align: 'right' }
               );

            doc.font('Helvetica')
               .fontSize(9)
               .fillColor('#64748b')
               .text(
                   `CNPJ: ${escritorio.documento || '00.000.000/0000-00'}`,
                   infoX,
                   headerTop + 22,
                   { width: 395, align: 'right' }
               );

            // Linha azul separadora
            doc.moveTo(50, 170)
               .lineTo(545, 170)
               .strokeColor('#3b82f6')
               .lineWidth(3)
               .stroke();

            // ============================================================
            // 📋 TÍTULO DO RECIBO
            // ============================================================

            doc.fontSize(28)
               .fillColor('#3b82f6')
               .font('Helvetica-Bold')
               .text('RECIBO DE PAGAMENTO', 50, 195, { 
                   align: 'center',
                   width: 495
               });

            // Número do recibo
            doc.fontSize(11)
               .fillColor('#64748b')
               .font('Helvetica')
               .text(`Nº ${numeroRecibo || 'REC-0001'}`, 50, 230, { 
                   align: 'center',
                   width: 495
               });

            // ============================================================
            // 💰 VALOR EM DESTAQUE (Box verde)
            // ============================================================

            const valorBoxY = 265;
            const valorBoxHeight = 70;

            // Box com gradiente simulado (fundo verde)
            doc.rect(50, valorBoxY, 495, valorBoxHeight)
               .fillAndStroke('#10b981', '#059669')
               .lineWidth(0);

            // Label "VALOR"
            doc.fontSize(12)
               .fillColor('#ffffff')
               .font('Helvetica-Bold')
               .text('VALOR', 50, valorBoxY + 15, { 
                   align: 'center',
                   width: 495
               });

            // Valor em destaque
            doc.fontSize(36)
               .fillColor('#ffffff')
               .font('Helvetica-Bold')
               .text(
                   `R$ ${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                   50,
                   valorBoxY + 32,
                   { align: 'center', width: 495 }
               );

            // ============================================================
            // 📝 DADOS DO RECIBO (Tabela limpa)
            // ============================================================

            let currentY = 370;
            const lineHeight = 28;
            const labelX = 50;
            const valueX = 200;

            // Função helper para adicionar linha
            const addField = (label, value, options = {}) => {
                // Label
                doc.fontSize(11)
                   .fillColor('#64748b')
                   .font('Helvetica')
                   .text(label, labelX, currentY);

                // Valor
                doc.fontSize(12)
                   .fillColor('#1e293b')
                   .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
                   .text(value, valueX, currentY, { 
                       width: 345,
                       ...(options.italic && { oblique: true })
                   });

                // Linha separadora sutil
                currentY += lineHeight;
                doc.moveTo(50, currentY - 5)
                   .lineTo(545, currentY - 5)
                   .strokeColor('#f1f5f9')
                   .lineWidth(1)
                   .stroke();
            };

            // Campos do recibo
            addField('Recebemos de:', clienteNome, { bold: true });
            
            addField('CPF/CNPJ:', clienteDocumento || 'Não informado', { bold: true });
            
            addField('A importância de:', extenso(Number(valor)), { italic: true });
            
            addField('Referente a:', descricao);
            
            addField('Forma de pagamento:', formaPagamento || 'Não especificado', { bold: true });
            
            addField('Data:', new Date().toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }), { bold: true });

            // ============================================================
// ✍️ ASSINATURA (IMAGEM + LINHA + NOME) — AJUSTE DEFINITIVO
// ============================================================

const linhaAssinaturaY = 620;
const assinaturaWidth = 110; // reduz largura → reduz altura proporcionalmente
const assinaturaY = linhaAssinaturaY - 110; // margem segura acima da linha

// Assinatura em imagem (100% acima da linha)
if (escritorio.assinatura_path) {
    try {
        const assinaturaFullPath = path.join(__dirname, '..', escritorio.assinatura_path);
        await fs.access(assinaturaFullPath);

        doc.image(
            assinaturaFullPath,
            385,          // X centralizado
            assinaturaY,  // Y calculado (sempre acima da linha)
            {
                width: assinaturaWidth
            }
        );
    } catch (err) {
        console.log('⚠️ Assinatura não encontrada ou inválida');
    }
}

// Linha da assinatura
doc.moveTo(350, linhaAssinaturaY)
   .lineTo(545, linhaAssinaturaY)
   .strokeColor('#64748b')
   .lineWidth(1)
   .stroke();

// Nome do escritório abaixo da linha
doc.fontSize(10)
   .font('Helvetica-Bold')
   .fillColor('#64748b')
   .text(
       escritorio.nome || '',
       350,
       linhaAssinaturaY + 10,
       { width: 195, align: 'center' }
   );

            // ============================================================
            // 📌 RODAPÉ COM INFORMAÇÕES DO ESCRITÓRIO
            // ============================================================

            const footerY = 755;

            // Linha separadora do rodapé
            doc.moveTo(50, footerY)
               .lineTo(545, footerY)
               .strokeColor('#e2e8f0')
               .lineWidth(1)
               .stroke();

            // Endereço completo
            const enderecoCompleto = [
                escritorio.endereco,
                escritorio.cidade,
                escritorio.estado,
                escritorio.cep ? `CEP ${escritorio.cep}` : null
            ].filter(Boolean).join(' – ');

            doc.fontSize(8)
               .fillColor('#94a3b8')
               .font('Helvetica')
               .text(
                   enderecoCompleto || 'Endereço do escritório',
                   50,
                   footerY + 10,
                   { width: 495, align: 'center' }
               );

            // E-mail
            doc.text(
                escritorio.email || 'contato@escritorio.com',
                50,
                footerY + 23,
                { width: 495, align: 'center' }
            );

            // ============================================================
            // 🏁 FINALIZAÇÃO
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