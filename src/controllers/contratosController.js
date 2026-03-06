const pool    = require('../config/db');
const storage = require('../utils/storage');
const logger  = require('../utils/logger');
const multer  = require('multer');
const path    = require('path');

// ── Multer ────────────────────────────────────────────────────────────────────
const _upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') return cb(null, true);
        cb(new Error('Apenas arquivos PDF são aceitos para contratos'), false);
    },
    limits: { fileSize: 20 * 1024 * 1024 }
});

function uploadMiddleware(req, res, next) {
    _upload.single('arquivo')(req, res, (err) => {
        if (err instanceof multer.MulterError)
            return res.status(400).json({ erro: `Erro de upload: ${err.message}` });
        if (err)
            return res.status(400).json({ erro: err.message });
        next();
    });
}

// ── Tipos de honorário ────────────────────────────────────────────────────────
const TIPOS_HONORARIO = ['fixo', 'exito', 'misto', 'consultoria', 'outros'];

// ─────────────────────────────────────────────────────────────────────────────
// 1. LISTAR contratos de um cliente
// GET /api/clientes/:id/contratos
// ─────────────────────────────────────────────────────────────────────────────
async function listarContratos(req, res) {
    const escritorioId = req.user.escritorio_id;
    const clienteId    = parseInt(req.params.id);

    try {
        const cli = await pool.query(
            'SELECT id, nome FROM clientes WHERE id = $1 AND escritorio_id = $2',
            [clienteId, escritorioId]
        );
        if (cli.rows.length === 0)
            return res.status(404).json({ erro: 'Cliente não encontrado' });

        const result = await pool.query(`
            SELECT
                ch.id,
                ch.cliente_id,
                ch.processo_id,
                ch.titulo,
                ch.tipo_honorario,
                ch.valor_fixo,
                ch.percentual_exito,
                ch.data_assinatura,
                ch.status,
                ch.observacoes,
                ch.arquivo_nome,
                ch.arquivo_original,
                ch.tem_arquivo,
                ch.criado_em,
                ch.atualizado_em,
                p.numero AS processo_numero
            FROM contratos_honorarios ch
            LEFT JOIN processos p ON p.id = ch.processo_id
            WHERE ch.cliente_id   = $1
              AND ch.escritorio_id = $2
            ORDER BY ch.criado_em DESC
        `, [clienteId, escritorioId]);

        res.json(result.rows);
    } catch (err) {
        logger.error({ err: err.message }, 'Contratos: erro ao listar');
        res.status(500).json({ erro: 'Erro ao listar contratos' });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. CRIAR contrato
// POST /api/clientes/:id/contratos
// ─────────────────────────────────────────────────────────────────────────────
async function criarContrato(req, res) {
    const escritorioId = req.user.escritorio_id;
    const clienteId    = parseInt(req.params.id);
    const {
        titulo, tipo_honorario, valor_fixo, percentual_exito,
        data_assinatura, processo_id, observacoes,
        forma_pagamento, vencimento_pgto, num_parcelas
    } = req.body;

    if (!titulo || !titulo.trim())
        return res.status(400).json({ erro: 'Título do contrato é obrigatório' });

    const tipo = TIPOS_HONORARIO.includes(tipo_honorario) ? tipo_honorario : 'outros';

    try {
        const cli = await pool.query(
            'SELECT id FROM clientes WHERE id = $1 AND escritorio_id = $2',
            [clienteId, escritorioId]
        );
        if (cli.rows.length === 0)
            return res.status(404).json({ erro: 'Cliente não encontrado' });

        const result = await pool.query(`
            INSERT INTO contratos_honorarios
                (escritorio_id, cliente_id, processo_id, titulo, tipo_honorario,
                 valor_fixo, percentual_exito, data_assinatura, observacoes,
                 forma_pagamento, vencimento_pgto, num_parcelas,
                 status, tem_arquivo)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ativo',false)
            RETURNING *
        `, [
            escritorioId,
            clienteId,
            processo_id ? parseInt(processo_id) : null,
            titulo.trim(),
            tipo,
            valor_fixo        ? parseFloat(valor_fixo)        : null,
            percentual_exito  ? parseFloat(percentual_exito)  : null,
            data_assinatura   || null,
            observacoes       || null,
            forma_pagamento   || null,
            vencimento_pgto   || null,
            num_parcelas      ? parseInt(num_parcelas)        : null
        ]);

        logger.info({ id: result.rows[0].id }, 'Contrato criado');
        res.status(201).json(result.rows[0]);
    } catch (err) {
        logger.error({ err: err.message }, 'Contratos: erro ao criar');
        res.status(500).json({ erro: 'Erro ao criar contrato' });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. UPLOAD do PDF assinado
// POST /api/contratos/:contratoId/upload
// ─────────────────────────────────────────────────────────────────────────────
async function uploadContratoAssinado(req, res) {
    const escritorioId = req.user.escritorio_id;
    const contratoId   = parseInt(req.params.contratoId);

    if (!req.file)
        return res.status(400).json({ erro: 'Nenhum arquivo enviado' });

    try {
        const contrato = await pool.query(
            'SELECT * FROM contratos_honorarios WHERE id = $1 AND escritorio_id = $2',
            [contratoId, escritorioId]
        );
        if (contrato.rows.length === 0)
            return res.status(404).json({ erro: 'Contrato não encontrado' });

        const c = contrato.rows[0];

        if (c.arquivo_nome) {
            await storage.delete(`contratos/${c.arquivo_nome}`).catch(() => {});
        }

        const rand         = Math.floor(1000 + Math.random() * 9000);
        const arquivo_nome = `contrato_${escritorioId}_${contratoId}_${Date.now()}_${rand}.pdf`;
        const key          = `contratos/${arquivo_nome}`;

        await storage.upload(req.file.buffer, key, 'application/pdf');

        const result = await pool.query(`
            UPDATE contratos_honorarios
            SET arquivo_nome     = $1,
                arquivo_original = $2,
                tem_arquivo      = true,
                atualizado_em    = NOW()
            WHERE id = $3 AND escritorio_id = $4
            RETURNING *
        `, [arquivo_nome, req.file.originalname, contratoId, escritorioId]);

        logger.info({ id: contratoId }, 'PDF assinado vinculado ao contrato');
        res.json(result.rows[0]);
    } catch (err) {
        logger.error({ err: err.message }, 'Contratos: erro ao fazer upload');
        res.status(500).json({ erro: 'Erro ao salvar arquivo do contrato' });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. DOWNLOAD do PDF assinado
// GET /api/contratos/:contratoId/arquivo
// ─────────────────────────────────────────────────────────────────────────────
async function downloadContrato(req, res) {
    const escritorioId = req.user.escritorio_id;
    const contratoId   = parseInt(req.params.contratoId);

    try {
        const result = await pool.query(
            'SELECT * FROM contratos_honorarios WHERE id = $1 AND escritorio_id = $2',
            [contratoId, escritorioId]
        );
        if (result.rows.length === 0)
            return res.status(404).json({ erro: 'Contrato não encontrado' });

        const c = result.rows[0];
        if (!c.tem_arquivo || !c.arquivo_nome)
            return res.status(404).json({ erro: 'Este contrato ainda não tem PDF anexado' });

        const key   = `contratos/${c.arquivo_nome}`;
        const found = await storage.download(key, res, {
            mimetype: 'application/pdf',
            filename: c.arquivo_original || c.arquivo_nome
        });
        if (found === null)
            return res.status(404).json({ erro: 'Arquivo não encontrado no servidor' });

    } catch (err) {
        logger.error({ err: err.message }, 'Contratos: erro ao fazer download');
        if (!res.headersSent) res.status(500).json({ erro: 'Erro ao baixar contrato' });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. GERAR template do contrato como HTML (abre direto no browser / imprimir PDF)
// GET /api/clientes/:id/contratos/:contratoId/template
// ─────────────────────────────────────────────────────────────────────────────
async function gerarTemplate(req, res) {
    const escritorioId = req.user.escritorio_id;
    const clienteId    = parseInt(req.params.id);
    const contratoId   = parseInt(req.params.contratoId);

    try {
        const [cliRes, contratoRes, escritorioRes] = await Promise.all([
            pool.query(
                'SELECT * FROM clientes WHERE id = $1 AND escritorio_id = $2',
                [clienteId, escritorioId]
            ),
            pool.query(
                `SELECT ch.*, p.numero AS processo_numero
                 FROM contratos_honorarios ch
                 LEFT JOIN processos p ON p.id = ch.processo_id
                 WHERE ch.id = $1 AND ch.escritorio_id = $2`,
                [contratoId, escritorioId]
            ),
            pool.query('SELECT * FROM escritorios WHERE id = $1', [escritorioId])
        ]);

        if (cliRes.rows.length === 0)
            return res.status(404).json({ erro: 'Cliente não encontrado' });
        if (contratoRes.rows.length === 0)
            return res.status(404).json({ erro: 'Contrato não encontrado' });

        const cliente    = cliRes.rows[0];
        const contrato   = contratoRes.rows[0];
        const escritorio = escritorioRes.rows[0] || {};

        // ── Helpers de texto ──────────────────────────────────────────────────
        const _mesesPtBR = ['janeiro','fevereiro','março','abril','maio','junho',
                             'julho','agosto','setembro','outubro','novembro','dezembro'];
        const _dataFormatada = (raw) => {
            if (!raw) return null;
            // Se vier como objeto Date do postgres ou string ISO, extrair apenas a parte da data
            const s = (raw instanceof Date)
                ? raw.toISOString().slice(0, 10)          // "2026-03-05"
                : String(raw).slice(0, 10);                // "2026-03-05T..." → "2026-03-05"
            const [ano, mes, dia] = s.split('-');
            return `${dia} de ${_mesesPtBR[parseInt(mes, 10) - 1]} de ${ano}`;
        };
        const dataAssinatura = _dataFormatada(contrato.data_assinatura)
            || _dataFormatada(new Date());

        const valorTexto = (() => {
            if (contrato.tipo_honorario === 'fixo' && contrato.valor_fixo)
                return `R$ ${parseFloat(contrato.valor_fixo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
            if (contrato.tipo_honorario === 'exito' && contrato.percentual_exito)
                return `${contrato.percentual_exito}% sobre o êxito`;
            if (contrato.tipo_honorario === 'misto')
                return [
                    contrato.valor_fixo
                        ? `R$ ${parseFloat(contrato.valor_fixo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} fixo`
                        : null,
                    contrato.percentual_exito
                        ? `${contrato.percentual_exito}% sobre o êxito`
                        : null
                ].filter(Boolean).join(' + ');
            return 'Conforme acordado entre as partes';
        })();

        // Texto apenas do valor fixo (sem percentual de êxito) — usado na cláusula de pagamento
        const valorFixoTexto = contrato.valor_fixo
            ? `R$ ${parseFloat(contrato.valor_fixo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
            : 'valor acordado';

        const tipoLabel = {
            fixo:        'Honorários Fixos',
            exito:       'Honorários de Êxito',
            misto:       'Honorários Mistos (Fixo + Êxito)',
            consultoria: 'Honorários de Consultoria',
            outros:      'Honorários'
        }[contrato.tipo_honorario] || 'Honorários Advocatícios';

        const enderecoCliente = [cliente.endereco, cliente.cidade, cliente.estado]
            .filter(Boolean).join(', ') || 'não informado';

        const cidadeContrato = cliente.cidade || escritorio.cidade || 'domicílio do Contratante';

        const numeroContrato = `${String(contrato.id).padStart(4, '0')}/${new Date().getFullYear()}`;

        // ── Cláusula de honorários condicional ────────────────────────────────
        const honParasHtml = [
            `<p>Os honorários advocatícios pactuados no presente instrumento são devidos em contraprestação aos serviços jurídicos ora contratados, nos termos do art. 22 e seguintes da Lei nº 8.906/1994 (Estatuto da Advocacia e da OAB) e do Código de Ética e Disciplina da Ordem dos Advogados do Brasil.</p>`
        ];
        if (['exito', 'misto'].includes(contrato.tipo_honorario)) {
            honParasHtml.push(`<p>Os honorários de êxito tornam-se devidos no momento em que houver decisão favorável ao CONTRATANTE, ainda que sujeita a recurso, compreendendo-se como êxito o resultado que atinja, total ou parcialmente, os objetivos pretendidos, inclusive por meio de acordo, transação ou desistência da parte contrária.</p>`);
        }
        if (['fixo', 'misto', 'consultoria'].includes(contrato.tipo_honorario)) {
            // Montar texto de pagamento detalhado e juridicamente sólido
            const formaLabels = {
                pix: 'transferência via PIX', dinheiro: 'pagamento em dinheiro',
                transferencia: 'transferência bancária', cartao_credito: 'cartão de crédito',
                cartao_debito: 'cartão de débito', boleto: 'boleto bancário'
            };
            const formaTexto = formaLabels[contrato.forma_pagamento] || 'meio de pagamento acordado entre as partes';

            let vencTexto = 'na data de assinatura do presente instrumento';
            if (contrato.vencimento_pgto === '7dias')  vencTexto = 'no prazo de 7 (sete) dias corridos contados da data de assinatura';
            if (contrato.vencimento_pgto === '15dias') vencTexto = 'no prazo de 15 (quinze) dias corridos contados da data de assinatura';
            if (contrato.vencimento_pgto === '30dias') vencTexto = 'no prazo de 30 (trinta) dias corridos contados da data de assinatura';
            if (contrato.vencimento_pgto === 'parcelado' && contrato.num_parcelas) {
                const n = contrato.num_parcelas;
                const vlrParcela = contrato.valor_fixo
                    ? `de R$ ${(parseFloat(contrato.valor_fixo) / parseInt(n)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} cada`
                    : '';
                vencTexto = `em ${n} (${n === '2' ? 'duas' : n === '3' ? 'três' : n === '4' ? 'quatro' : n === '5' ? 'cinco' : n === '6' ? 'seis' : n === '10' ? 'dez' : n === '12' ? 'doze' : n}) parcelas mensais e consecutivas ${vlrParcela}, vencendo-se a primeira na data da assinatura e as demais no mesmo dia dos meses subsequentes`;
            }

            honParasHtml.push(`<p>O valor fixo pactuado de <strong>${valorFixoTexto}</strong> deverá ser pago mediante <strong>${formaTexto}</strong>, ${vencTexto}. O não pagamento na data acordada implicará, de pleno direito e independentemente de notificação, incidência de multa moratória de 2% (dois por cento) sobre o valor devido, acrescida de juros de mora de 1% (um por cento) ao mês e correção monetária pelo IPCA, contados da data do vencimento até a data do efetivo pagamento. O presente instrumento constitui título executivo extrajudicial nos termos do art. 784, inciso III, do Código de Processo Civil, sendo a obrigação de pagamento líquida, certa e exigível na forma aqui pactuada.</p>`);
        }
        honParasHtml.push(`<p>Os honorários sucumbenciais eventualmente fixados pelo juízo pertencem exclusivamente ao advogado, nos termos do art. 85, §14, do Código de Processo Civil, não se confundindo com os honorários ora contratados. As despesas processuais, custas judiciais e emolumentos não estão incluídos nos honorários pactuados, devendo ser custeados pelo CONTRATANTE.</p>`);

        // ── Cláusula de observações ───────────────────────────────────────────
        const clausulaObs = contrato.observacoes
            ? `<div class="clausula">
                 <div class="clausula-titulo">Cláusula 9ª — Das Condições Específicas</div>
                 <div class="obs-box">${contrato.observacoes.replace(/\n/g, '<br>')}</div>
               </div>`
            : '';

        const numForo = contrato.observacoes ? '10ª' : '9ª';

        // ── Info do escritório contratado ─────────────────────────────────────
        const infoContratadoHtml = [
            escritorio.advogado_responsavel ? `Advogado: Dr(a). ${escritorio.advogado_responsavel}` : '',
            escritorio.oab                  ? `OAB: ${escritorio.oab}`                              : '',
            escritorio.email                ? `E-mail: ${escritorio.email}`                         : '',
            (escritorio.telefone || escritorio.telefone_escritorio || escritorio.fone)
                ? `Telefone: ${escritorio.telefone || escritorio.telefone_escritorio || escritorio.fone}` : ''
        ].filter(Boolean).map(l => `<br>${l}`).join('');

        // ── HTML completo ─────────────────────────────────────────────────────
        const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Contrato nº ${numeroContrato}</title>
<style>
  @page { margin: 1.8cm 2cm; }

  * { box-sizing: border-box; }

  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 12px;
    color: #1a1a1a;
    line-height: 1.85;
    max-width: 800px;
    margin: 0 auto;
    padding: 24px 40px;
    background: #fff;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .conteudo-principal { flex: 1; }

  /* ── Cabeçalho ── */
  .cabecalho {
    text-align: center;
    padding-bottom: 14px;
    margin-bottom: 16px;
    border-bottom: 3px double #1E3A5F;
  }
  .esc-nome {
    font-size: 15px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #1E3A5F;
  }
  .esc-info { font-size: 11px; color: #666; margin-top: 4px; }

  /* ── Título ── */
  h1 {
    text-align: center;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin: 14px 0 3px;
    font-weight: bold;
  }
  .subtitulo {
    text-align: center;
    font-size: 11px;
    font-style: italic;
    color: #555;
    margin: 0 0 2px;
  }
  .num-contrato { text-align: center; font-size: 10px; color: #999; margin-bottom: 12px; }
  hr.div { border: none; border-top: 1px solid #ccc; margin: 16px 0; }

  /* ── Cláusulas ── */
  .clausula { margin: 16px 0; }
  .clausula-titulo {
    font-weight: bold;
    text-transform: uppercase;
    font-size: 13px;
    letter-spacing: 0.5px;
    color: #1E3A5F;
    border-left: 3px solid #1E3A5F;
    padding-left: 9px;
    margin-bottom: 7px;
  }
  .clausula p { text-align: justify; margin: 7px 0; }

  /* ── Caixas das partes ── */
  .partes-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin: 14px 0;
  }
  .parte-box {
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 8px 12px;
    background: #fafafa;
    font-size: 11px;
  }
  .parte-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #999;
    margin-bottom: 5px;
  }
  .parte-nome { font-weight: bold; font-size: 12px; color: #1E3A5F; margin-bottom: 3px; }

  /* ── Caixa de honorários ── */
  .hon-box {
    border: 2px solid #1E3A5F;
    border-radius: 4px;
    padding: 12px 14px;
    background: #f0f4f8;
    margin: 14px 0;
  }
  .hon-modalidade { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
  .hon-valor { font-size: 15px; font-weight: bold; color: #1E3A5F; margin: 2px 0; }
  .hon-vigencia { font-size: 11px; color: #666; }

  /* ── Observações ── */
  .obs-box {
    background: #fffbeb;
    border-left: 4px solid #f59e0b;
    padding: 6px 10px;
    margin: 6px 0;
    font-size: 11px;
    border-radius: 0 4px 4px 0;
  }

  /* ── Assinaturas ── */
  .ass-cidade { text-align: center; font-size: 11px; color: #444; margin: 30px 0 20px; }
  .ass-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
    margin-top: 12px;
  }
  .ass-box { text-align: center; }
  .ass-linha {
    border-top: 1px solid #333;
    padding-top: 8px;
    font-size: 12px;
    line-height: 1.8;
    margin-top: 50px;
  }

  /* ── Testemunhas ── */
  .test-titulo {
    font-size: 12px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #1E3A5F;
    border-left: 3px solid #1E3A5F;
    padding-left: 9px;
    margin: 28px 0 0;
  }
  .test-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
    margin-top: 14px;
  }
  .test-linha {
    border-top: 1px solid #333;
    padding-top: 8px;
    font-size: 12px;
    line-height: 2.4;
    margin-top: 40px;
  }

  /* ── Rodapé ── */
  .rodape-wrapper {
    margin-top: auto;
    padding-top: 100px;
  }
  .rodape {
    text-align: center;
    font-size: 10px;
    color: #bbb;
    border-top: 1px solid #eee;
    padding-top: 10px;
  }

  /* ── Botão imprimir (não aparece no PDF) ── */
  .print-bar {
    position: fixed;
    top: 0; left: 0; right: 0;
    background: #1E3A5F;
    color: #fff;
    padding: 8px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: Arial, sans-serif;
    font-size: 13px;
    z-index: 9999;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }
  .print-bar span { opacity: 0.85; }
  .btn-print {
    background: #fff;
    color: #1E3A5F;
    border: none;
    padding: 7px 20px;
    border-radius: 5px;
    font-weight: bold;
    font-size: 13px;
    cursor: pointer;
    font-family: Arial, sans-serif;
  }
  .btn-print:hover { background: #e8f0fe; }

  @media print {
    .print-bar { display: none !important; }
    .print-hide { display: none !important; }
    body { padding: 0; margin: 0; }
  }
</style>
</head>
<body>

<!-- Barra de impressão -->
<div class="print-bar">
  <span>Contrato nº ${numeroContrato} — ${cliente.nome}</span>
  <button class="btn-print" onclick="window.print()">🖨️ Salvar / Imprimir PDF</button>
</div>

<!-- Espaço para a barra fixa não sobrepor o conteúdo -->
<div style="height:42px;" class="print-hide"></div>
<div class="conteudo-principal">

<!-- Cabeçalho -->
<div class="cabecalho">
  <div class="esc-nome">${escritorio.nome || 'Escritório de Advocacia'}</div>
  <div class="esc-info">${[
      escritorio.oab      ? `OAB: ${escritorio.oab}`  : '',
      escritorio.email    ? escritorio.email           : '',
      escritorio.telefone ? escritorio.telefone        : ''
  ].filter(Boolean).join('  |  ')}</div>
</div>

<h1>Contrato de Prestação de Serviços Advocatícios</h1>
<div class="subtitulo">${tipoLabel}</div>
<div class="num-contrato">Contrato nº ${numeroContrato}</div>
<hr class="div">

<!-- Das Partes -->
<div class="clausula">
  <div class="clausula-titulo">Das Partes Contratantes</div>
  <div class="partes-grid">
    <div class="parte-box">
      <div class="parte-label">Contratante</div>
      <div class="parte-nome">${cliente.nome}</div>
      CPF/CNPJ: ${cliente.documento || 'não informado'}<br>
      Endereço: ${enderecoCliente}
      ${cliente.email    ? `<br>E-mail: ${cliente.email}`       : ''}
      ${cliente.telefone ? `<br>Telefone: ${cliente.telefone}`  : ''}
    </div>
    <div class="parte-box">
      <div class="parte-label">Contratado</div>
      <div class="parte-nome" style="text-transform:uppercase;">${escritorio.nome || 'Escritório de Advocacia'}</div>
      ${[
        escritorio.advogado_responsavel ? 'Advogado: Dr(a). ' + escritorio.advogado_responsavel : '',
        escritorio.oab    ? 'OAB: '      + escritorio.oab    : '',
        escritorio.email  ? 'E-mail: '   + escritorio.email  : '',
        (escritorio.telefone || escritorio.telefone_escritorio || escritorio.fone)
          ? 'Telefone: ' + (escritorio.telefone || escritorio.telefone_escritorio || escritorio.fone) : ''
      ].filter(Boolean).join('<br>')}
    </div>
  </div>
</div>

<!-- Cláusula 1 -->
<div class="clausula">
  <div class="clausula-titulo">Cláusula 1ª — Do Objeto</div>
  <p>O presente instrumento particular de prestação de serviços advocatícios tem por objeto a contratação do <strong>CONTRATADO</strong> pelo <strong>CONTRATANTE</strong> para a prestação de serviços jurídicos profissionais, consistentes no patrocínio, acompanhamento e defesa dos interesses do CONTRATANTE${contrato.processo_numero ? `, referente ao processo nº <strong>${contrato.processo_numero}</strong>` : ''}, compreendendo todos os atos, diligências e providências necessárias à condução da demanda, nos termos do instrumento denominado <strong>"${contrato.titulo}"</strong>.</p>
  <p>Os serviços advocatícios ora contratados abrangem a prática de todos os atos processuais e extrajudiciais pertinentes ao objeto deste contrato, incluindo, sem limitação: elaboração de petições, recursos, memoriais e manifestações; participação em audiências; realização de diligências junto a órgãos públicos e privados; e acompanhamento processual em todas as instâncias competentes.</p>
</div>

<!-- Cláusula 2 -->
<div class="clausula">
  <div class="clausula-titulo">Cláusula 2ª — Dos Honorários Advocatícios</div>
  <div class="hon-box">
    <div class="hon-modalidade">Modalidade de Honorários</div>
    <div class="hon-valor">${valorTexto}</div>
    <div class="hon-vigencia">${tipoLabel}${contrato.data_assinatura ? ` — Vigência a partir de ${dataAssinatura}` : ''}</div>
  </div>
  ${honParasHtml.join('\n  ')}
</div>

<!-- Cláusula 3 -->
<div class="clausula">
  <div class="clausula-titulo">Cláusula 3ª — Das Obrigações do Contratado</div>
  <p>O CONTRATADO, no exercício do mandato ora outorgado, obriga-se a:</p>
  <p><strong>I.</strong> Prestar os serviços advocatícios com diligência, competência técnica e estrita observância dos princípios éticos previstos no Código de Ética e Disciplina da OAB e na Lei nº 8.906/1994;</p>
  <p><strong>II.</strong> Manter o CONTRATANTE regularmente informado sobre o andamento do processo e dos atos praticados, inclusive comunicando decisões relevantes no prazo máximo de 48 (quarenta e oito) horas de seu conhecimento, podendo tal comunicação ser realizada por escrito, e-mail ou aplicativo de mensagens (WhatsApp);</p>
  <p><strong>III.</strong> Guardar sigilo absoluto sobre todas as informações e documentos que lhe forem confiados, em observância ao dever de sigilo profissional previsto no art. 34, VII, da Lei nº 8.906/1994, estendendo-se tal obrigação às informações recebidas por meio eletrônico;</p>
  <p><strong>IV.</strong> Agir sempre no melhor interesse do CONTRATANTE, adotando as medidas jurídicas cabíveis para a defesa de seus direitos, sem incorrer em lide temerária ou prática de ato atentatório à dignidade da Justiça;</p>
  <p><strong>V.</strong> Restituir ao CONTRATANTE, quando do encerramento do mandato, todos os documentos originais que lhe tenham sido entregues, no prazo de 10 (dez) dias úteis;</p>
  <p><strong>VI.</strong> Os documentos físicos digitalizados e os arquivos digitais enviados pelo CONTRATANTE ao CONTRATADO, por qualquer meio eletrônico (e-mail, WhatsApp, aplicativos de armazenamento em nuvem ou sistema do escritório), serão armazenados na base de dados do escritório pelo prazo mínimo de 5 (cinco) anos após o encerramento do mandato, nos termos do art. 40 do Código de Ética e Disciplina da OAB. O CONTRATANTE autoriza expressamente o armazenamento, tratamento e uso de tais documentos e dados exclusivamente para fins da presente representação, em conformidade com a Lei nº 13.709/2018 (LGPD). Findo o prazo de guarda, os arquivos digitais poderão ser eliminados sem necessidade de comunicação prévia, salvo disposição em contrário;</p>
  <p><strong>VII.</strong> Zelar pelos interesses do CONTRATANTE no processo objeto deste contrato e naqueles que dele derivarem, sem que tal implique em adicional de honorários, salvo ajuste expresso entre as partes;</p>
  <p><strong>VIII.</strong> Colocar à disposição do CONTRATANTE relatório de andamento do processo sob seu patrocínio, pela via eletrônica ou por meio impresso, tão logo seja requerido.</p>
</div>

<!-- Cláusula 4 -->
<div class="clausula">
  <div class="clausula-titulo">Cláusula 4ª — Das Obrigações do Contratante</div>
  <p>O CONTRATANTE, por sua vez, obriga-se a:</p>
  <p><strong>I.</strong> Fornecer ao CONTRATADO, com presteza e veracidade, todos os documentos, informações e esclarecimentos necessários à condução do processo, sendo integralmente responsável pela exatidão das informações prestadas. O não cumprimento dos prazos informados pelo CONTRATADO para entrega de documentos afastará quaisquer responsabilidades deste pelo eventual prejuízo decorrente;</p>
  <p><strong>II.</strong> Efetuar o pagamento dos honorários advocatícios nas condições e prazos ajustados, bem como ressarcir as despesas processuais (custas, emolumentos, diligências e outras de natureza judicial ou extrajudicial) devidamente comprovadas, que correrão por sua conta exclusiva;</p>
  <p><strong>III.</strong> Comparecer às audiências, diligências e demais atos processuais para os quais for convocado, mediante comunicação prévia com antecedência mínima de 5 (cinco) dias úteis, salvo urgência justificada. As eventuais despesas de transporte, hospedagem e alimentação do CONTRATADO, devidamente comprovadas e previamente autorizadas pelo CONTRATANTE, serão por este custeadas;</p>
  <p><strong>IV.</strong> Abster-se de realizar acordo com a parte adversa sem a anuência expressa e prévia do CONTRATADO, sob pena de rescisão imediata do presente contrato com o pagamento integral dos honorários pactuados, como se êxito houvesse na demanda;</p>
  <p><strong>V.</strong> Abster-se de contratar outros profissionais para atuar na mesma causa sem prévia e expressa anuência do CONTRATADO;</p>
  <p><strong>VI.</strong> Comunicar ao CONTRATADO, no prazo de 48 (quarenta e oito) horas, qualquer fato superveniente que possa influenciar no andamento ou no desfecho da demanda;</p>
  <p><strong>VII.</strong> Responsabilizar-se pela remessa, guarda e retorno dos documentos físicos originais solicitados pelo CONTRATADO. Caso figure mais de um CONTRATANTE no presente instrumento, todos serão devedores solidários entre si, nos termos do art. 275 do Código Civil.</p>
</div>

<!-- Cláusula 5 — Das Comunicações -->
<div class="clausula">
  <div class="clausula-titulo">Cláusula 5ª — Das Comunicações</div>
  <p>Todas as comunicações e notificações entre as partes relativas a este contrato, quando feitas por escrito, e-mail ou aplicativo de mensagens (WhatsApp), serão consideradas recebidas: (i) quando enviadas por escrito, no momento do recebimento mediante assinatura; (ii) quando enviadas por e-mail ou WhatsApp, no momento em que for confirmado o recebimento pela parte destinatária.</p>
  <p>Em caso de mudança de endereço físico, eletrônico ou de número de telefone, as partes deverão comunicar imediatamente a atualização, sob pena de arcar com os ônus decorrentes da omissão.</p>
</div>

<!-- Cláusula 6 — Da Vigência e Rescisão -->
<div class="clausula">
  <div class="clausula-titulo">Cláusula 6ª — Da Vigência e da Rescisão</div>
  <p>O presente contrato vigorará pelo prazo necessário à conclusão dos serviços ora contratados, iniciando-se na data de sua assinatura.</p>
  <p><strong>I.</strong> Em caso de rescisão por iniciativa do CONTRATANTE, serão devidos ao CONTRATADO os honorários proporcionais aos trabalhos realizados até a data da rescisão, calculados sobre o valor total pactuado, sem prejuízo do reembolso das despesas já efetuadas;</p>
  <p><strong>II.</strong> Em caso de rescisão por iniciativa do CONTRATADO, este se obriga a comunicar o CONTRATANTE com antecedência suficiente para que providencie novo patrocinador, não podendo abandonar a causa em momento que cause prejuízo irreparável, conforme art. 5º, II, do Código de Ética da OAB;</p>
  <p><strong>III.</strong> O inadimplemento dos honorários por prazo superior a 30 (trinta) dias, após prévia notificação, faculta ao CONTRATADO a rescisão imediata deste instrumento, sem prejuízo da cobrança judicial dos valores devidos.</p>
</div>

<!-- Cláusula 6 -->
<div class="clausula">
  <div class="clausula-titulo">Cláusula 7ª — Da Confidencialidade e Proteção de Dados</div>
  <p>As partes comprometem-se a manter em absoluto sigilo todas as informações trocadas no âmbito deste contrato, ficando vedada a divulgação a terceiros, salvo mediante autorização expressa ou por determinação judicial.</p>
  <p>O tratamento de dados pessoais realizado no âmbito deste instrumento observará as disposições da Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais — LGPD), sendo os dados coletados utilizados exclusivamente para a finalidade de prestação dos serviços advocatícios ora contratados.</p>
</div>

<!-- Cláusula 7 -->
<div class="clausula">
  <div class="clausula-titulo">Cláusula 8ª — Das Disposições Gerais</div>
  <p>O presente contrato é celebrado em caráter personalíssimo, sendo vedada a cessão ou transferência de quaisquer direitos ou obrigações sem o prévio e expresso consentimento da outra parte.</p>
  <p>A tolerância de qualquer das partes quanto ao descumprimento de obrigação pela outra não constituirá novação, renúncia ou alteração do pactuado.</p>
  <p>Este contrato constitui título executivo extrajudicial, nos termos do art. 784, inciso III, do Código de Processo Civil, obrigando as partes e seus sucessores a qualquer título.</p>
  <p>A eventual invalidade de qualquer cláusula deste instrumento não contaminará as demais, que permanecerão válidas e eficazes em sua integralidade.</p>
</div>

<!-- Cláusula 8 (observações, se houver) -->
${clausulaObs}

<!-- Cláusula do Foro -->
<div class="clausula">
  <div class="clausula-titulo">Cláusula ${numForo} — Do Foro</div>
  <p>Fica eleito o foro da Comarca de <strong>${cidadeContrato}</strong> para dirimir quaisquer controvérsias decorrentes do presente contrato, com expressa renúncia a qualquer outro, por mais privilegiado que seja.</p>
  <p>E, por estarem assim justas e contratadas, as partes assinam o presente instrumento em 2 (duas) vias de igual teor e forma, na presença das testemunhas abaixo identificadas.</p>
</div>

<!-- Assinaturas -->
<div class="ass-cidade">${cidadeContrato}/BA, ${dataAssinatura}.</div>

<div class="ass-grid">
  <div class="ass-box">
    <div class="ass-linha">
      <strong>${cliente.nome}</strong><br>
      CPF/CNPJ: ${cliente.documento || '—'}<br>
      <em>Contratante</em>
    </div>
  </div>
  <div class="ass-box">
    <div class="ass-linha">
      <strong style="text-transform:uppercase;">${escritorio.nome || 'Escritório de Advocacia'}</strong><br>
      ${escritorio.advogado_responsavel
          ? `${escritorio.oab
              ? `Dr(a). ${escritorio.advogado_responsavel} — OAB nº ${escritorio.oab}`
              : `Dr(a). ${escritorio.advogado_responsavel}`}<br>`
          : (escritorio.oab ? `OAB nº ${escritorio.oab}<br>` : '')}
      <em>Contratado</em>
    </div>
  </div>
</div>

<!-- Testemunhas -->
<div class="test-titulo">Testemunhas</div>
<div class="test-grid">
  <div class="ass-box">
    <div class="test-linha">
      Nome: _________________________________________________<br>
      CPF: ____________________________<br>
      <em>1ª Testemunha</em>
    </div>
  </div>
  <div class="ass-box">
    <div class="test-linha">
      Nome: _________________________________________________<br>
      CPF: ____________________________<br>
      <em>2ª Testemunha</em>
    </div>
  </div>
</div>

<!-- Fim do conteúdo principal -->
</div>

<!-- Rodapé — empurrado ao final da última página -->
<div class="rodape-wrapper">
  <div class="rodape">
    ${escritorio.nome || ''} &nbsp;|&nbsp; Contrato nº ${numeroContrato} &nbsp;|&nbsp;
    Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}<br>
    Documento gerado pelo sistema LawTech Pro — Este instrumento possui validade jurídica nos termos da legislação vigente.
  </div>
</div>

</body>
</html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);

    } catch (err) {
        logger.error({ err: err.message }, 'Contratos: erro ao gerar template');
        if (!res.headersSent)
            res.status(500).json({ erro: 'Erro ao gerar template do contrato' });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. EDITAR metadados do contrato
// PUT /api/contratos/:contratoId
// ─────────────────────────────────────────────────────────────────────────────
async function editarContrato(req, res) {
    const escritorioId = req.user.escritorio_id;
    const contratoId   = parseInt(req.params.contratoId);
    const {
        titulo, tipo_honorario, valor_fixo, percentual_exito,
        data_assinatura, processo_id, observacoes, status,
        forma_pagamento, vencimento_pgto, num_parcelas
    } = req.body;

    try {
        const tipo   = tipo_honorario && TIPOS_HONORARIO.includes(tipo_honorario) ? tipo_honorario : undefined;
        const result = await pool.query(`
            UPDATE contratos_honorarios SET
                titulo            = COALESCE($1, titulo),
                tipo_honorario    = COALESCE($2, tipo_honorario),
                valor_fixo        = COALESCE($3, valor_fixo),
                percentual_exito  = COALESCE($4, percentual_exito),
                data_assinatura   = COALESCE($5, data_assinatura),
                processo_id       = COALESCE($6, processo_id),
                observacoes       = COALESCE($7, observacoes),
                status            = COALESCE($8, status),
                forma_pagamento   = COALESCE($11, forma_pagamento),
                vencimento_pgto   = COALESCE($12, vencimento_pgto),
                num_parcelas      = COALESCE($13, num_parcelas),
                atualizado_em     = NOW()
            WHERE id = $9 AND escritorio_id = $10
            RETURNING *
        `, [
            titulo            ? titulo.trim()                : null,
            tipo              || null,
            valor_fixo        != null ? parseFloat(valor_fixo)       : null,
            percentual_exito  != null ? parseFloat(percentual_exito) : null,
            data_assinatura   || null,
            processo_id       ? parseInt(processo_id) : null,
            observacoes       !== undefined ? observacoes : null,
            status            || null,
            contratoId,
            escritorioId,
            forma_pagamento   || null,
            vencimento_pgto   || null,
            num_parcelas      ? parseInt(num_parcelas) : null
        ]);

        if (result.rows.length === 0)
            return res.status(404).json({ erro: 'Contrato não encontrado' });

        res.json(result.rows[0]);
    } catch (err) {
        logger.error({ err: err.message }, 'Contratos: erro ao editar');
        res.status(500).json({ erro: 'Erro ao editar contrato' });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. EXCLUIR contrato
// DELETE /api/contratos/:contratoId
// ─────────────────────────────────────────────────────────────────────────────
async function excluirContrato(req, res) {
    const escritorioId = req.user.escritorio_id;
    const contratoId   = parseInt(req.params.contratoId);

    try {
        const c = await pool.query(
            'SELECT arquivo_nome FROM contratos_honorarios WHERE id = $1 AND escritorio_id = $2',
            [contratoId, escritorioId]
        );
        if (c.rows.length === 0)
            return res.status(404).json({ erro: 'Contrato não encontrado' });

        if (c.rows[0].arquivo_nome) {
            await storage.delete(`contratos/${c.rows[0].arquivo_nome}`).catch(() => {});
        }

        await pool.query(
            'DELETE FROM contratos_honorarios WHERE id = $1 AND escritorio_id = $2',
            [contratoId, escritorioId]
        );

        res.json({ ok: true });
    } catch (err) {
        logger.error({ err: err.message }, 'Contratos: erro ao excluir');
        res.status(500).json({ erro: 'Erro ao excluir contrato' });
    }
}

module.exports = {
    uploadMiddleware,
    listarContratos,
    criarContrato,
    uploadContratoAssinado,
    downloadContrato,
    gerarTemplate,
    editarContrato,
    excluirContrato
};