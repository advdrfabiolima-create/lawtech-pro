const pool    = require('../config/db');
const storage = require('../utils/storage');
const logger  = require('../utils/logger');
const multer  = require('multer');
const path    = require('path');

// ── Multer (reusa mesma lógica do documentosController) ──────────────────────
const _upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') return cb(null, true);
        cb(new Error('Apenas arquivos PDF são aceitos para contratos'), false);
    },
    limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
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
        // Garante que o cliente pertence ao escritório
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
            WHERE ch.cliente_id  = $1
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
// 2. CRIAR contrato (metadados — sem arquivo ainda)
// POST /api/clientes/:id/contratos
// ─────────────────────────────────────────────────────────────────────────────
async function criarContrato(req, res) {
    const escritorioId = req.user.escritorio_id;
    const clienteId    = parseInt(req.params.id);
    const {
        titulo, tipo_honorario, valor_fixo, percentual_exito,
        data_assinatura, processo_id, observacoes
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
                 status, tem_arquivo)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ativo',false)
            RETURNING *
        `, [
            escritorioId,
            clienteId,
            processo_id ? parseInt(processo_id) : null,
            titulo.trim(),
            tipo,
            valor_fixo   ? parseFloat(valor_fixo)   : null,
            percentual_exito ? parseFloat(percentual_exito) : null,
            data_assinatura  || null,
            observacoes      || null
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

        // Remove arquivo anterior se existir
        if (c.arquivo_nome) {
            await storage.delete(`contratos/${c.arquivo_nome}`).catch(() => {});
        }

        const rand        = Math.floor(1000 + Math.random() * 9000);
        const arquivo_nome = `contrato_${escritorioId}_${contratoId}_${Date.now()}_${rand}.pdf`;
        const key         = `contratos/${arquivo_nome}`;

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
// 4. DOWNLOAD do PDF
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

        const key = `contratos/${c.arquivo_nome}`;
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
// 5. GERAR template HTML → PDF
// GET /api/clientes/:id/contratos/:contratoId/gerar-template
// ─────────────────────────────────────────────────────────────────────────────
async function gerarTemplate(req, res) {
    const escritorioId = req.user.escritorio_id;
    const clienteId    = parseInt(req.params.id);
    const contratoId   = parseInt(req.params.contratoId);

    try {
        const [cliRes, contratoRes, escritorioRes] = await Promise.all([
            pool.query('SELECT * FROM clientes  WHERE id = $1 AND escritorio_id = $2', [clienteId,  escritorioId]),
            pool.query('SELECT ch.*, p.numero AS processo_numero FROM contratos_honorarios ch LEFT JOIN processos p ON p.id = ch.processo_id WHERE ch.id = $1 AND ch.escritorio_id = $2', [contratoId, escritorioId]),
            pool.query('SELECT * FROM escritorios WHERE id = $1', [escritorioId])
        ]);

        if (cliRes.rows.length === 0)      return res.status(404).json({ erro: 'Cliente não encontrado' });
        if (contratoRes.rows.length === 0) return res.status(404).json({ erro: 'Contrato não encontrado' });

        const cliente    = cliRes.rows[0];
        const contrato   = contratoRes.rows[0];
        const escritorio = escritorioRes.rows[0] || {};

        const dataAssinatura = contrato.data_assinatura
            ? new Date(contrato.data_assinatura).toLocaleDateString('pt-BR')
            : new Date().toLocaleDateString('pt-BR');

        const valorTexto = (() => {
            if (contrato.tipo_honorario === 'fixo' && contrato.valor_fixo)
                return `R$ ${parseFloat(contrato.valor_fixo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
            if (contrato.tipo_honorario === 'exito' && contrato.percentual_exito)
                return `${contrato.percentual_exito}% sobre o êxito`;
            if (contrato.tipo_honorario === 'misto')
                return [
                    contrato.valor_fixo ? `R$ ${parseFloat(contrato.valor_fixo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} fixo` : null,
                    contrato.percentual_exito ? `${contrato.percentual_exito}% sobre o êxito` : null
                ].filter(Boolean).join(' + ');
            return 'Conforme acordado entre as partes';
        })();

        const tipoLabel = {
            fixo: 'Honorários Fixos', exito: 'Honorários de Êxito',
            misto: 'Honorários Mistos (Fixo + Êxito)',
            consultoria: 'Honorários de Consultoria', outros: 'Honorários'
        }[contrato.tipo_honorario] || 'Honorários Advocatícios';

        const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #1a1a1a; margin: 40px; line-height: 1.7; }
  h1 { text-align: center; font-size: 18px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  h2 { font-size: 13px; text-align: center; font-weight: normal; color: #555; margin-top: 0; }
  .divider { border: none; border-top: 2px solid #1E3A5F; margin: 24px 0; }
  .section-title { font-weight: bold; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; color: #1E3A5F; margin: 20px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  td { padding: 5px 8px; vertical-align: top; }
  td:first-child { font-weight: bold; width: 40%; color: #444; }
  .assinatura-area { margin-top: 60px; display: flex; justify-content: space-between; }
  .assinatura-box { width: 44%; text-align: center; }
  .assinatura-linha { border-top: 1px solid #333; padding-top: 6px; font-size: 12px; }
  .obs { background: #f8f9fa; border-left: 3px solid #1E3A5F; padding: 10px 14px; margin-top: 12px; font-size: 12px; }
  .rodape { text-align: center; font-size: 10px; color: #999; margin-top: 40px; }
  p { text-align: justify; }
</style>
</head>
<body>

<h1>Contrato de Prestação de Serviços Advocatícios</h1>
<h2>${tipoLabel}</h2>
<hr class="divider">

<div class="section-title">Identificação das Partes</div>
<table>
  <tr><td>Contratante:</td><td>${cliente.nome}</td></tr>
  <tr><td>CPF/CNPJ:</td><td>${cliente.documento || '—'}</td></tr>
  <tr><td>Endereço:</td><td>${[cliente.endereco, cliente.cidade, cliente.estado].filter(Boolean).join(', ') || '—'}</td></tr>
  <tr><td>E-mail:</td><td>${cliente.email || '—'}</td></tr>
  <tr><td>Telefone:</td><td>${cliente.telefone || '—'}</td></tr>
</table>

<table style="margin-top:8px;">
  <tr><td>Contratado:</td><td>${escritorio.nome || 'Escritório de Advocacia'}</td></tr>
  ${escritorio.oab ? `<tr><td>OAB:</td><td>${escritorio.oab}</td></tr>` : ''}
  ${escritorio.email ? `<tr><td>E-mail:</td><td>${escritorio.email}</td></tr>` : ''}
  ${escritorio.telefone ? `<tr><td>Telefone:</td><td>${escritorio.telefone}</td></tr>` : ''}
</table>

<div class="section-title">Objeto do Contrato</div>
<p>O presente instrumento tem por objeto a prestação de serviços advocatícios pelo Contratado ao Contratante, 
referente ao processo${contrato.processo_numero ? ` nº <strong>${contrato.processo_numero}</strong>` : ' a ser identificado'}, 
nos termos do <strong>${contrato.titulo}</strong>.</p>

<div class="section-title">Honorários</div>
<table>
  <tr><td>Modalidade:</td><td>${tipoLabel}</td></tr>
  <tr><td>Valor / Condições:</td><td>${valorTexto}</td></tr>
  ${contrato.data_assinatura ? `<tr><td>Data de Vigência:</td><td>${dataAssinatura}</td></tr>` : ''}
</table>

${contrato.observacoes ? `
<div class="section-title">Observações e Condições Específicas</div>
<div class="obs">${contrato.observacoes.replace(/\n/g, '<br>')}</div>
` : ''}

<div class="section-title">Cláusulas Gerais</div>
<p><strong>1. Obrigações do Contratado:</strong> O advogado contratado obriga-se a prestar os serviços com diligência, 
competência e ética profissional, mantendo o cliente informado sobre o andamento do processo.</p>
<p><strong>2. Obrigações do Contratante:</strong> O contratante compromete-se a fornecer todos os documentos e 
informações necessárias à condução do processo, além de efetuar o pagamento dos honorários nas condições ajustadas.</p>
<p><strong>3. Rescisão:</strong> Qualquer das partes poderá rescindir o presente contrato mediante comunicação prévia 
de 15 (quinze) dias, sendo devidos os honorários proporcionais ao trabalho já realizado.</p>
<p><strong>4. Foro:</strong> Fica eleito o foro da comarca de ${cliente.cidade || 'domicílio do Contratante'} para 
dirimir quaisquer dúvidas oriundas do presente contrato.</p>

<div class="assinatura-area">
  <div class="assinatura-box">
    <div class="assinatura-linha">
      ${cliente.nome}<br>
      <small>CPF: ${cliente.documento || '—'}</small><br>
      <small>Contratante</small>
    </div>
  </div>
  <div class="assinatura-box">
    <div class="assinatura-linha">
      ${escritorio.nome || 'Advogado(a)'}<br>
      ${escritorio.oab ? `<small>${escritorio.oab}</small><br>` : ''}
      <small>Contratado</small>
    </div>
  </div>
</div>

<div class="rodape">
  ${escritorio.nome || ''} — Documento gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}
</div>

</body>
</html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);

    } catch (err) {
        logger.error({ err: err.message }, 'Contratos: erro ao gerar template');
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
        data_assinatura, processo_id, observacoes, status
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
                atualizado_em     = NOW()
            WHERE id = $9 AND escritorio_id = $10
            RETURNING *
        `, [
            titulo ? titulo.trim() : null,
            tipo || null,
            valor_fixo        != null ? parseFloat(valor_fixo)        : null,
            percentual_exito  != null ? parseFloat(percentual_exito)  : null,
            data_assinatura   || null,
            processo_id       ? parseInt(processo_id) : null,
            observacoes       !== undefined ? observacoes : null,
            status            || null,
            contratoId,
            escritorioId
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