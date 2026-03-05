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

        const enderecoCliente = [cliente.endereco, cliente.cidade, cliente.estado].filter(Boolean).join(', ') || 'não informado';
        const cidadeContrato = cliente.cidade || escritorio.cidade || 'domicílio do Contratante';

        const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Contrato de Prestação de Serviços Advocatícios</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
<style>
  @page { margin: 2.5cm; }
  body { font-family: 'Aptos', 'Plus Jakarta Sans', 'Calibri', 'Segoe UI', Arial, sans-serif; font-size: 14px; color: #1a1a1a; line-height: 1.9; max-width: 780px; margin: 0 auto; padding: 40px; }
  .cabecalho { text-align: center; border-bottom: 3px double #1E3A5F; padding-bottom: 20px; margin-bottom: 28px; }
  .cabecalho .escritorio-nome { font-size: 17px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; color: #1E3A5F; }
  .cabecalho .escritorio-info { font-size: 11px; color: #666; margin-top: 4px; }
  h1 { text-align: center; font-size: 15px; text-transform: uppercase; letter-spacing: 2px; margin: 24px 0 4px; font-weight: bold; }
  h2 { font-size: 12px; text-align: center; font-weight: normal; color: #555; margin: 0 0 8px; font-style: italic; }
  .numero-contrato { text-align: center; font-size: 11px; color: #888; margin-bottom: 20px; }
  hr.divider { border: none; border-top: 1px solid #c0c0c0; margin: 20px 0; }
  .clausula { margin: 18px 0; }
  .clausula-titulo { font-weight: bold; text-transform: uppercase; font-size: 13px; letter-spacing: 0.5px; color: #1E3A5F; margin-bottom: 8px; border-left: 3px solid #1E3A5F; padding-left: 10px; }
  .clausula p { text-align: left; margin: 8px 0; }
  .partes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 14px 0; }
  .parte-box { border: 1px solid #ddd; border-radius: 4px; padding: 14px; background: #fafafa; }
  .parte-box .parte-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 6px; }
  .parte-box .parte-nome { font-weight: bold; font-size: 14px; color: #1E3A5F; margin-bottom: 6px; }
  .parte-box .parte-info { font-size: 13px; color: #444; line-height: 1.8; }
  .honorarios-box { border: 2px solid #1E3A5F; border-radius: 4px; padding: 16px; background: #f0f4f8; margin: 14px 0; }
  .honorarios-box .valor { font-size: 18px; font-weight: bold; color: #1E3A5F; }
  .honorarios-box .modalidade { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
  .obs-box { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 14px 0; font-size: 13px; border-radius: 0 4px 4px 0; }
  .assinatura-area { margin-top: 60px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .assinatura-box { text-align: center; }
  .assinatura-linha { border-top: 1px solid #333; padding-top: 8px; font-size: 13px; line-height: 1.8; }
  .assinatura-cidade { text-align: center; margin-top: 50px; font-size: 12px; color: #444; margin-bottom: 10px; }
  .rodape { text-align: center; font-size: 10px; color: #aaa; margin-top: 50px; border-top: 1px solid #eee; padding-top: 12px; }
  .testemunhas { margin-top: 50px; }
  .testemunha-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 20px; }
</style>
</head>
<body>

<div class="cabecalho">
  <div class="escritorio-nome">${escritorio.nome || 'Escritório de Advocacia'}</div>
  <div class="escritorio-info">
    ${escritorio.oab ? `OAB: ${escritorio.oab} &nbsp;|&nbsp; ` : ''}${escritorio.email ? `${escritorio.email} &nbsp;|&nbsp; ` : ''}${escritorio.telefone ? `${escritorio.telefone}` : ''}
  </div>
</div>

<h1>Contrato de Prestação de Serviços Advocatícios</h1>
<h2>${tipoLabel}</h2>
<div class="numero-contrato">Contrato nº ${String(contrato.id).padStart(4,'0')}/${new Date().getFullYear()}</div>
<hr class="divider">

<div class="clausula">
  <div class="clausula-titulo">Das Partes Contratantes</div>
  <div class="partes-grid">
    <div class="parte-box">
      <div class="parte-label">Contratante</div>
      <div class="parte-nome">${cliente.nome}</div>
      <div class="parte-info">
        CPF/CNPJ: ${cliente.documento || 'não informado'}<br>
        Endereço: ${enderecoCliente}<br>
        ${cliente.email ? `E-mail: ${cliente.email}<br>` : ''}${cliente.telefone ? `Telefone: ${cliente.telefone}` : ''}
      </div>
    </div>
    <div class="parte-box">
      <div class="parte-label">Contratado</div>
      <div class="parte-nome" style="text-transform:uppercase;">${escritorio.nome || 'Escritório de Advocacia'}</div>
      ${escritorio.advogado_responsavel ? `<div style="font-size:12px; color:#555; margin-bottom:6px;">${escritorio.advogado_responsavel}</div>` : ''}
      <div class="parte-info">
        ${escritorio.oab ? `OAB: ${escritorio.oab}<br>` : ''}${escritorio.email ? `E-mail: ${escritorio.email}<br>` : ''}${escritorio.telefone ? `Telefone: ${escritorio.telefone}` : ''}
      </div>
    </div>
  </div>
</div>

<div class="clausula">
  <div class="clausula-titulo">Cláusula 1ª — Do Objeto</div>
  <p>O presente instrumento particular de prestação de serviços advocatícios tem por objeto a contratação do <strong>CONTRATADO</strong> pelo <strong>CONTRATANTE</strong> para a prestação de serviços jurídicos profissionais, consistentes no patrocínio, acompanhamento e defesa dos interesses do CONTRATANTE${contrato.processo_numero ? `, referente ao processo nº <strong>${contrato.processo_numero}</strong>` : ''}, compreendendo todos os atos, diligências e providências necessárias à condução da demanda, nos termos do instrumento denominado <strong>"${contrato.titulo}"</strong>.</p>
  <p>Os serviços advocatícios ora contratados abrangem a prática de todos os atos processuais e extrajudiciais pertinentes ao objeto deste contrato, incluindo, sem limitação: elaboração de petições, recursos, memoriais e manifestações; participação em audiências; realização de diligências junto a órgãos públicos e privados; e acompanhamento processual em todas as instâncias competentes.</p>
</div>

<div class="clausula">
  <div class="clausula-titulo">Cláusula 2ª — Dos Honorários Advocatícios</div>
  <div class="honorarios-box">
    <div class="modalidade">Modalidade de Honorários</div>
    <div class="valor">${valorTexto}</div>
    <div style="font-size:12px; color:#555; margin-top:4px;">${tipoLabel}${contrato.data_assinatura ? ` — Vigência a partir de ${dataAssinatura}` : ''}</div>
  </div>
  <p>Os honorários advocatícios pactuados no presente instrumento são devidos em contraprestação aos serviços jurídicos ora contratados, nos termos do art. 22 e seguintes da Lei nº 8.906/1994 (Estatuto da Advocacia e da OAB) e do Código de Ética e Disciplina da Ordem dos Advogados do Brasil.</p>
  ${(contrato.tipo_honorario === 'exito' || contrato.tipo_honorario === 'misto') ? `<p>Os honorários de êxito tornam-se devidos no momento em que houver decisão favorável ao CONTRATANTE, ainda que sujeita a recurso, compreendendo-se como êxito o resultado que atinja, total ou parcialmente, os objetivos pretendidos, inclusive por meio de acordo, transação ou desistência da parte contrária.</p>` : ''}
  ${(contrato.tipo_honorario === 'fixo' || contrato.tipo_honorario === 'misto' || contrato.tipo_honorario === 'consultoria') ? `<p>O valor fixo pactuado deverá ser quitado conforme condições ajustadas entre as partes, sendo que o atraso no pagamento implicará incidência de multa moratória de 2% (dois por cento), acrescida de correção monetária pelo IPCA, a partir do vencimento.</p>` : ''}
  <p>Os honorários sucumbenciais eventualmente fixados pelo juízo pertencem exclusivamente ao advogado, nos termos do art. 85, §14, do Código de Processo Civil, não se confundindo com os honorários ora contratados. As despesas processuais, custas judiciais e emolumentos não estão incluídos nos honorários pactuados, devendo ser custeados pelo CONTRATANTE.</p>
</div>

<div class="clausula">
  <div class="clausula-titulo">Cláusula 3ª — Das Obrigações do Contratado</div>
  <p>O CONTRATADO, no exercício do mandato ora outorgado, obriga-se a:</p>
  <p><strong>I.</strong> Prestar os serviços advocatícios com diligência, competência técnica e estrita observância dos princípios éticos previstos no Código de Ética e Disciplina da OAB e na Lei nº 8.906/1994;</p>
  <p><strong>II.</strong> Manter o CONTRATANTE regularmente informado sobre o andamento do processo e dos atos praticados, inclusive comunicando decisões relevantes no prazo máximo de 48 (quarenta e oito) horas de seu conhecimento;</p>
  <p><strong>III.</strong> Guardar sigilo absoluto sobre todas as informações e documentos que lhe forem confiados, em observância ao dever de sigilo profissional previsto no art. 34, VII, da Lei nº 8.906/1994;</p>
  <p><strong>IV.</strong> Agir sempre no melhor interesse do CONTRATANTE, adotando as medidas jurídicas cabíveis para a defesa de seus direitos, sem incorrer em lide temerária ou prática de ato atentatório à dignidade da Justiça;</p>
  <p><strong>V.</strong> Restituir ao CONTRATANTE, quando do encerramento do mandato, todos os documentos originais que lhe tenham sido entregues, no prazo de 10 (dez) dias úteis.</p>
</div>

<div class="clausula">
  <div class="clausula-titulo">Cláusula 4ª — Das Obrigações do Contratante</div>
  <p>O CONTRATANTE, por sua vez, obriga-se a:</p>
  <p><strong>I.</strong> Fornecer ao CONTRATADO, com presteza e veracidade, todos os documentos, informações e esclarecimentos necessários à condução do processo, sendo integralmente responsável pela exatidão das informações prestadas;</p>
  <p><strong>II.</strong> Efetuar o pagamento dos honorários advocatícios nas condições e prazos ajustados, bem como ressarcir as despesas processuais devidamente comprovadas;</p>
  <p><strong>III.</strong> Comparecer às audiências, diligências e demais atos processuais para os quais for convocado, mediante comunicação prévia com antecedência mínima de 5 (cinco) dias úteis, salvo urgência justificada;</p>
  <p><strong>IV.</strong> Abster-se de praticar atos que possam prejudicar o andamento do processo ou contratar outros profissionais para atuar na mesma causa sem prévia e expressa anuência do CONTRATADO;</p>
  <p><strong>V.</strong> Comunicar ao CONTRATADO, no prazo de 48 (quarenta e oito) horas, qualquer fato superveniente que possa influenciar no andamento ou no desfecho da demanda.</p>
</div>

<div class="clausula">
  <div class="clausula-titulo">Cláusula 5ª — Da Vigência e da Rescisão</div>
  <p>O presente contrato vigorará pelo prazo necessário à conclusão dos serviços ora contratados, iniciando-se na data de sua assinatura.</p>
  <p><strong>I.</strong> Em caso de rescisão por iniciativa do CONTRATANTE, serão devidos ao CONTRATADO os honorários proporcionais aos trabalhos realizados até a data da rescisão, calculados sobre o valor total pactuado, sem prejuízo do reembolso das despesas já efetuadas;</p>
  <p><strong>II.</strong> Em caso de rescisão por iniciativa do CONTRATADO, este se obriga a comunicar o CONTRATANTE com antecedência suficiente para que providencie novo patrocinador, não podendo abandonar a causa em momento que cause prejuízo irreparável, conforme art. 5º, II, do Código de Ética da OAB;</p>
  <p><strong>III.</strong> O inadimplemento dos honorários por prazo superior a 30 (trinta) dias, após prévia notificação, faculta ao CONTRATADO a rescisão imediata deste instrumento, sem prejuízo da cobrança judicial dos valores devidos.</p>
</div>

<div class="clausula">
  <div class="clausula-titulo">Cláusula 6ª — Da Confidencialidade e Proteção de Dados</div>
  <p>As partes comprometem-se a manter em absoluto sigilo todas as informações trocadas no âmbito deste contrato, ficando vedada a divulgação a terceiros, salvo mediante autorização expressa ou por determinação judicial.</p>
  <p>O tratamento de dados pessoais realizado no âmbito deste instrumento observará as disposições da Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais — LGPD), sendo os dados coletados utilizados exclusivamente para a finalidade de prestação dos serviços advocatícios ora contratados.</p>
</div>

<div class="clausula">
  <div class="clausula-titulo">Cláusula 7ª — Das Disposições Gerais</div>
  <p>O presente contrato é celebrado em caráter personalíssimo, sendo vedada a cessão ou transferência de quaisquer direitos ou obrigações sem o prévio e expresso consentimento da outra parte.</p>
  <p>A tolerância de qualquer das partes quanto ao descumprimento de obrigação pela outra não constituirá novação, renúncia ou alteração do pactuado.</p>
  <p>Este contrato constitui título executivo extrajudicial, nos termos do art. 784, inciso III, do Código de Processo Civil, obrigando as partes e seus sucessores a qualquer título.</p>
  <p>A eventual invalidade de qualquer cláusula deste instrumento não contaminará as demais, que permanecerão válidas e eficazes em sua integralidade.</p>
</div>

${contrato.observacoes ? `<div class="clausula">
  <div class="clausula-titulo">Cláusula 8ª — Das Condições Específicas</div>
  <div class="obs-box">${contrato.observacoes.replace(/\n/g, '<br>')}</div>
</div>` : ''}

<div class="clausula">
  <div class="clausula-titulo">Cláusula ${contrato.observacoes ? '9ª' : '8ª'} — Do Foro</div>
  <p>Fica eleito o foro da Comarca de <strong>${cidadeContrato}</strong> para dirimir quaisquer controvérsias decorrentes do presente contrato, com expressa renúncia a qualquer outro, por mais privilegiado que seja.</p>
  <p>E, por estarem assim justas e contratadas, as partes assinam o presente instrumento em 2 (duas) vias de igual teor e forma, na presença das testemunhas abaixo identificadas.</p>
</div>

<div class="assinatura-cidade">${cidadeContrato}, ${dataAssinatura}.</div>

<div class="assinatura-area">
  <div class="assinatura-box">
    <br><br>
    <div class="assinatura-linha">
      <strong>${cliente.nome}</strong><br>
      CPF/CNPJ: ${cliente.documento || '—'}<br>
      <em>Contratante</em>
    </div>
  </div>
  <div class="assinatura-box">
    <br><br>
    <div class="assinatura-linha">
      <strong style="text-transform:uppercase;">${escritorio.nome || 'Escritório de Advocacia'}</strong><br>
      ${escritorio.advogado_responsavel ? `${escritorio.advogado_responsavel}<br>` : ''}
      ${escritorio.oab ? `${escritorio.oab}<br>` : ''}<em>Contratado</em>
    </div>
  </div>
</div>

<div class="testemunhas">
  <div class="clausula-titulo" style="font-size:11px; margin-top:40px;">Testemunhas</div>
  <div class="testemunha-grid">
    <div class="assinatura-box">
      <br><br>
      <div class="assinatura-linha">
        Nome: ________________________________<br>
        CPF: __________________________________<br>
        <em>1ª Testemunha</em>
      </div>
    </div>
    <div class="assinatura-box">
      <br><br>
      <div class="assinatura-linha">
        Nome: ________________________________<br>
        CPF: __________________________________<br>
        <em>2ª Testemunha</em>
      </div>
    </div>
  </div>
</div>

<div class="rodape">
  ${escritorio.nome || ''} &nbsp;|&nbsp; Contrato nº ${String(contrato.id).padStart(4,'0')}/${new Date().getFullYear()} &nbsp;|&nbsp; Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}<br>
  Documento gerado pelo sistema LawTech Pro — Este instrumento possui validade jurídica nos termos da legislação vigente.
</div>

</body>
</html>`
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