/**
 * ROTAS — Procurações
 *
 * Migration (rodar uma vez no banco):
 *
 * CREATE TABLE IF NOT EXISTS procuracoes (
 *   id                SERIAL PRIMARY KEY,
 *   cliente_id        INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
 *   escritorio_id     INTEGER NOT NULL,
 *   tipo              VARCHAR(40) NOT NULL,
 *   finalidade        TEXT NOT NULL,
 *   nacionalidade     VARCHAR(80),
 *   estado_civil      VARCHAR(40),
 *   profissao         VARCHAR(80),
 *   parte_contraria   TEXT,
 *   cidade_assinatura VARCHAR(120),
 *   data_assinatura   DATE,
 *   processo_id       INTEGER REFERENCES processos(id) ON DELETE SET NULL,
 *   obs               TEXT,
 *   poderes           JSONB DEFAULT '{}',
 *   status            VARCHAR(20) DEFAULT 'ativa',
 *   criado_em         TIMESTAMPTZ DEFAULT NOW(),
 *   atualizado_em     TIMESTAMPTZ DEFAULT NOW()
 * );
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

async function getProcuracao(id, escritorioId) {
    const { rows } = await pool.query(
        'SELECT * FROM procuracoes WHERE id = $1 AND escritorio_id = $2',
        [id, escritorioId]
    );
    return rows[0] || null;
}

// GET /api/clientes/:clienteId/procuracoes
router.get('/clientes/:clienteId/procuracoes', async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const { rows } = await pool.query(
            `SELECT p.*, pr.numero AS processo_numero
             FROM procuracoes p
             LEFT JOIN processos pr ON pr.id = p.processo_id
             WHERE p.cliente_id = $1 AND p.escritorio_id = $2
             ORDER BY p.criado_em DESC`,
            [req.params.clienteId, escritorioId]
        );
        res.json(rows);
    } catch (err) {
        console.error('GET procuracoes:', err);
        res.status(500).json({ erro: 'Erro ao buscar procurações' });
    }
});

// POST /api/clientes/:clienteId/procuracoes
router.post('/clientes/:clienteId/procuracoes', async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const { tipo, finalidade, nacionalidade, estado_civil, profissao,
                parte_contraria, cidade_assinatura,
                data_assinatura, processo_id, obs, poderes } = req.body;

        if (!tipo || !finalidade)
            return res.status(400).json({ erro: 'Tipo e finalidade são obrigatórios' });

        const { rows } = await pool.query(
            `INSERT INTO procuracoes
               (cliente_id, escritorio_id, tipo, finalidade, nacionalidade, estado_civil, profissao,
                parte_contraria, cidade_assinatura, data_assinatura, processo_id, obs, poderes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING *`,
            [
                req.params.clienteId, escritorioId, tipo, finalidade,
                nacionalidade     || null,
                estado_civil      || null,
                profissao         || null,
                parte_contraria   || null,
                cidade_assinatura || null,
                data_assinatura   || null,
                processo_id       || null,
                obs               || null,
                JSON.stringify(poderes || {})
            ]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error('POST procuracao:', err);
        res.status(500).json({ erro: 'Erro ao criar procuração' });
    }
});

// PUT /api/procuracoes/:id
router.put('/procuracoes/:id', async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const proc = await getProcuracao(req.params.id, escritorioId);
        if (!proc) return res.status(404).json({ erro: 'Procuração não encontrada' });

        const { tipo, finalidade, nacionalidade, estado_civil, profissao,
                parte_contraria, cidade_assinatura,
                data_assinatura, processo_id, obs, poderes, status } = req.body;

        const { rows } = await pool.query(
            `UPDATE procuracoes SET
               tipo              = COALESCE($1, tipo),
               finalidade        = COALESCE($2, finalidade),
               nacionalidade     = $3,
               estado_civil      = $4,
               profissao         = $5,
               parte_contraria   = $6,
               cidade_assinatura = $7,
               data_assinatura   = $8,
               processo_id       = $9,
               obs               = $10,
               poderes           = COALESCE($11, poderes),
               status            = COALESCE($12, status),
               atualizado_em     = NOW()
             WHERE id = $13 AND escritorio_id = $14
             RETURNING *`,
            [
                tipo || null, finalidade || null,
                nacionalidade     || null,
                estado_civil      || null,
                profissao         || null,
                parte_contraria   || null,
                cidade_assinatura || null,
                data_assinatura   || null,
                processo_id       || null,
                obs               || null,
                poderes ? JSON.stringify(poderes) : null,
                status  || null,
                req.params.id, escritorioId
            ]
        );
        res.json(rows[0]);
    } catch (err) {
        console.error('PUT procuracao:', err);
        res.status(500).json({ erro: 'Erro ao atualizar procuração' });
    }
});

// DELETE /api/procuracoes/:id
router.delete('/procuracoes/:id', async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const proc = await getProcuracao(req.params.id, escritorioId);
        if (!proc) return res.status(404).json({ erro: 'Procuração não encontrada' });

        await pool.query('DELETE FROM procuracoes WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('DELETE procuracao:', err);
        res.status(500).json({ erro: 'Erro ao excluir procuração' });
    }
});

// GET /api/clientes/:clienteId/procuracoes/:id/template
router.get('/clientes/:clienteId/procuracoes/:id/template', async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;

        const proc = await getProcuracao(req.params.id, escritorioId);
        if (!proc) return res.status(404).json({ erro: 'Procuração não encontrada' });

        const { rows: cRows } = await pool.query(
            'SELECT * FROM clientes WHERE id = $1 AND escritorio_id = $2',
            [req.params.clienteId, escritorioId]
        );
        const cliente = cRows[0];
        if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });

        const { rows: eRows } = await pool.query(
            `SELECT nome, advogado_responsavel, oab, endereco, cidade,
                    estado, cep, email, logo_base64
             FROM escritorios
             WHERE id = $1`,
            [escritorioId]
        );
        const escritorio = eRows[0] || {};

        let processoNum = null;
        if (proc.processo_id) {
            const { rows: pr } = await pool.query(
                'SELECT numero FROM processos WHERE id = $1', [proc.processo_id]
            );
            processoNum = pr[0]?.numero || null;
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(gerarHtmlProcuracao({ proc, cliente, escritorio, processoNum, logoBase64: escritorio.logo_base64 || null }));
    } catch (err) {
        console.error('GET template procuracao:', err);
        res.status(500).json({ erro: 'Erro ao gerar template' });
    }
});

function gerarHtmlProcuracao({ proc, cliente, escritorio, processoNum, logoBase64 }) {
    const poderes = typeof proc.poderes === 'string' ? JSON.parse(proc.poderes) : (proc.poderes || {});

    const tipoLabel = {
        ad_judicia:               'AD JUDICIA',
        extrajudicial:            'EXTRAJUDICIAL',
        ad_judicia_extrajudicial: 'AD JUDICIA E EXTRAJUDICIAL'
    };

    const dataObj = proc.data_assinatura ? new Date(proc.data_assinatura) : new Date();
    const meses = ['janeiro','fevereiro','março','abril','maio','junho',
                   'julho','agosto','setembro','outubro','novembro','dezembro'];
    const dataExtenso = `${dataObj.getDate()} de ${meses[dataObj.getMonth()]} de ${dataObj.getFullYear()}`;

    const docCliente = cliente.documento
        ? `, inscrito no ${cliente.tipo_pessoa === 'juridica' ? 'CNPJ' : 'CPF'} nº ${cliente.documento}` : '';
    const rgCliente  = cliente.rg ? `, portador da cédula de identidade RG nº ${cliente.rg}` : '';
    const endCliente = cliente.endereco
        ? `, residente e domiciliado na ${cliente.endereco}${cliente.cidade ? ', ' + cliente.cidade : ''}${cliente.estado ? '/' + cliente.estado : ''}` : '';

    // Dados pessoais do outorgante (da procuração, não do cadastro)
    const nacStr  = proc.nacionalidade ? `, ${proc.nacionalidade}` : '';
    const ecStr   = proc.estado_civil  ? `, ${proc.estado_civil}`  : '';
    const profStr = proc.profissao     ? `, ${proc.profissao}`     : '';

    const advNome     = (escritorio.advogado_responsavel || escritorio.nome || 'ADVOGADO').toUpperCase();
    const advOab      = escritorio.oab      || '';
    const escNome     = escritorio.nome     || '';
    const escEndereco = escritorio.endereco || '';
    const escCidade   = escritorio.cidade   || '';
    const escEstado   = escritorio.estado   || 'BA';
    const escCep      = escritorio.cep      ? `, CEP ${escritorio.cep}` : '';
    const escEmail    = escritorio.email    || '';

    const poderesTexto = [];
    if (poderes.desistir)        poderesTexto.push('desistir, transigir, firmar compromissos ou acordos');
    if (poderes.receberValores)  poderesTexto.push('receber valores em espécie ou cheques, inclusive endossá-los e dar quitação');
    if (poderes.justicaGratuita) poderesTexto.push('requerer Justiça Gratuita e realizar declarações de pobreza');
    if (poderes.substabelecer)   poderesTexto.push('substabelecer, com ou sem reservas de iguais poderes');

    const clausulaJudicial = proc.tipo !== 'extrajudicial'
        ? 'ao qual confere amplos poderes para o foro em geral, com cláusula <em>ad judicia</em>, em qualquer juízo, instância ou Tribunal, podendo propor as ações competentes, defender nas contrárias, acompanhar processos até a decisão final, usando dos recursos legais necessários. '
        : 'ao qual confere amplos poderes para a prática de todos os atos necessários ao objeto desta procuração, incluindo assinar documentos, firmar acordos e transações extrajudiciais, representar o outorgante perante qualquer órgão público ou privado. ';

    const clausulaPoderesEspeciais = poderesTexto.length
        ? `Confere, ainda, <strong>poderes especiais</strong> para ${poderesTexto.join(', ')}. ` : '';

    const clausulaIrrevogavel = poderes.irrevogavel !== false
        ? 'Este mandato é de caráter <strong><em>IRRETRATÁVEL E IRREVOGÁVEL</em></strong>, ficando o mandante impedido de conceder esses poderes a outrem sem o consentimento do mandatário. ' : '';

    const clausulaObjeto = proc.parte_contraria
        ? `<p style="text-indent:4cm;">A presente procuração é conferida especialmente para <strong>${proc.finalidade.toUpperCase()}</strong> em face de <strong>${proc.parte_contraria}</strong>.${processoNum ? ` Processo nº ${processoNum}.` : ''}</p>`
        : `<p style="text-indent:4cm;">A presente procuração é conferida especialmente para <strong>${proc.finalidade.toUpperCase()}</strong>.${processoNum ? ` Processo nº ${processoNum}.` : ''}</p>`;

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Procuração — ${cliente.nome}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000; background: #fff; }
  .page { width: 21cm; min-height: 29.7cm; margin: 0 auto; padding: 1.5cm 3cm 3cm 3cm; }
  h1 { text-align: center; font-size: 14pt; font-weight: bold; margin-bottom: 2em; letter-spacing: 1px; }
  p { text-align: justify; line-height: 1.8; margin-bottom: 1em; }
  .cabecalho-logo { text-align: center; margin-bottom: 0.5cm; }
  .cabecalho-logo img { width: 100%; height: 120px; object-fit: contain; object-position: center; display: block; }
  .cabecalho-linha { border: none; border-top: 1px solid #999; margin: 0.3cm 0 0.8cm 0; }
  .assinatura { margin-top: 4cm; text-align: center; }
  .assinatura .linha { border-top: 1px solid #000; width: 10cm; margin: 0 auto 6px auto; }
  .assinatura p { text-align: center; margin: 0; line-height: 1.6; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
<div class="page">
  <div class="no-print" style="text-align:right;margin-bottom:16px;">
    <button id="btnImprimir" style="padding:8px 20px;background:#1E3A5F;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-family:sans-serif;">
      🖨️ Imprimir / Salvar PDF
    </button>
  </div>
  ${logoBase64 ? `<div class="cabecalho-logo"><img src="${logoBase64}" alt="Logo ${escNome}"></div><hr class="cabecalho-linha">` : ''}
  <h1>PROCURAÇÃO ${tipoLabel[proc.tipo] || proc.tipo.toUpperCase()}</h1>
  <p style="text-indent:4cm;">
    <strong>${cliente.nome.toUpperCase()}</strong>${nacStr}${ecStr}${profStr}${rgCliente}${docCliente}${endCliente}.
  </p>
  <p style="text-indent:4cm;">
    Pelo presente instrumento de procuração, nomeia e constitui como seu bastante procurador o(a) advogado(a)
    <strong>Dr(a). ${advNome}</strong>${advOab ? `, inscrito(a) na OAB/${escEstado} sob nº ${advOab}` : ''}${escNome ? `, sócio(a) do escritório <strong>${escNome.toUpperCase()}</strong>` : ''}${escEndereco ? `, com sede na ${escEndereco}${escCep}, ${escCidade}/${escEstado}` : ''}${escEmail ? `, e-mail ${escEmail}` : ''},
    ${clausulaJudicial}${clausulaPoderesEspeciais}${clausulaIrrevogavel}
  </p>
  ${clausulaObjeto}
  ${proc.obs ? `<p style="text-indent:4cm;"><em>Observação: ${proc.obs}</em></p>` : ''}
  <p style="text-align:center; margin-top: 2em;">
    ${proc.cidade_assinatura || escCidade || '_______________'}, ${dataExtenso}.
  </p>
  <div class="assinatura">
    <div class="linha"></div>
    <p><strong>${cliente.nome.toUpperCase()}</strong></p>
    ${cliente.documento ? `<p>${cliente.tipo_pessoa === 'juridica' ? 'CNPJ' : 'CPF'} nº ${cliente.documento}</p>` : ''}
  </div>
</div>
</body>
</html>`;
}

module.exports = router;