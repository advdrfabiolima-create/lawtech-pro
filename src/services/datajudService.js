const axios = require('axios');
const logger = require('../utils/logger');

const DATAJUD_BASE = 'https://api-publica.datajud.cnj.jus.br';

/**
 * Mapeamento de J.TT (segmento.tribunal do número CNJ) → slug do endpoint DataJud
 * Baseado na Resolução CNJ nº 65/2008
 *
 * Segmentos:
 *   1 = STF  |  2 = CNJ  |  3 = STJ
 *   4 = Justiça Federal (TRF)
 *   5 = Justiça do Trabalho (TST + TRT)
 *   6 = Justiça Eleitoral (TSE + TRE)
 *   7 = Justiça Militar da União (STM)
 *   8 = Justiça Estadual (TJ)
 *   9 = Justiça Militar Estadual (TJM)
 */
const TRIBUNAL_MAP = {
  // ── Tribunais Superiores ──────────────────────────────────────────────────
  // STF (1.00) — não disponível no DataJud
  '3.00': 'stj',

  // ── Justiça Federal ───────────────────────────────────────────────────────
  '4.01': 'trf1', '4.02': 'trf2', '4.03': 'trf3',
  '4.04': 'trf4', '4.05': 'trf5', '4.06': 'trf6',

  // ── Justiça do Trabalho ───────────────────────────────────────────────────
  '5.00': 'tst',
  '5.01': 'trt1',  '5.02': 'trt2',  '5.03': 'trt3',
  '5.04': 'trt4',  '5.05': 'trt5',  '5.06': 'trt6',
  '5.07': 'trt7',  '5.08': 'trt8',  '5.09': 'trt9',
  '5.10': 'trt10', '5.11': 'trt11', '5.12': 'trt12',
  '5.13': 'trt13', '5.14': 'trt14', '5.15': 'trt15',
  '5.16': 'trt16', '5.17': 'trt17', '5.18': 'trt18',
  '5.19': 'trt19', '5.20': 'trt20', '5.21': 'trt21',
  '5.22': 'trt22', '5.23': 'trt23', '5.24': 'trt24',

  // ── Justiça Eleitoral ─────────────────────────────────────────────────────
  '6.00': 'tse',
  '6.01': 'tre-ac', '6.02': 'tre-al', '6.03': 'tre-ap',
  '6.04': 'tre-am', '6.05': 'tre-ba', '6.06': 'tre-ce',
  '6.07': 'tre-df', '6.08': 'tre-es', '6.09': 'tre-go',
  '6.10': 'tre-ma', '6.11': 'tre-mt', '6.12': 'tre-ms',
  '6.13': 'tre-mg', '6.14': 'tre-pa', '6.15': 'tre-pb',
  '6.16': 'tre-pr', '6.17': 'tre-pe', '6.18': 'tre-pi',
  '6.19': 'tre-rj', '6.20': 'tre-rn', '6.21': 'tre-rs',
  '6.22': 'tre-ro', '6.23': 'tre-rr', '6.24': 'tre-sc',
  '6.25': 'tre-se', '6.26': 'tre-sp', '6.27': 'tre-to',

  // ── Justiça Militar da União ──────────────────────────────────────────────
  '7.00': 'stm',

  // ── Justiça Estadual — ordem conforme Resolução CNJ 65/2008 ──────────────
  // 01=AC 02=AL 03=AP 04=AM 05=BA 06=CE 07=DF 08=ES 09=GO 10=MA
  // 11=MT 12=MS 13=MG 14=PA 15=PB 16=PR 17=PE 18=PI 19=RJ 20=RN
  // 21=RS 22=RO 23=RR 24=SC 25=SE 26=SP 27=TO
  '8.01': 'tjac',  '8.02': 'tjal',  '8.03': 'tjap',
  '8.04': 'tjam',  '8.05': 'tjba',  '8.06': 'tjce',
  '8.07': 'tjdft', '8.08': 'tjes',  '8.09': 'tjgo',
  '8.10': 'tjma',  '8.11': 'tjmt',  '8.12': 'tjms',
  '8.13': 'tjmg',  '8.14': 'tjpa',  '8.15': 'tjpb',
  '8.16': 'tjpr',  '8.17': 'tjpe',  '8.18': 'tjpi',
  '8.19': 'tjrj',  '8.20': 'tjrn',  '8.21': 'tjrs',
  '8.22': 'tjro',  '8.23': 'tjrr',  '8.24': 'tjsc',
  '8.25': 'tjse',  '8.26': 'tjsp',  '8.27': 'tjto',

  // ── Justiça Militar Estadual ──────────────────────────────────────────────
  '9.01': 'tjmmg', '9.02': 'tjmrs', '9.03': 'tjmsp',
};

/**
 * Extrai o código J.TT do número CNJ
 * Formato: NNNNNNN-DD.AAAA.J.TT.OOOO  →  ex: "8.05"
 */
function extrairCodigoTribunal(numeroCNJ) {
  const match = numeroCNJ.match(/\d{7}-\d{2}\.\d{4}\.(\d+\.\d+)\.\d+/);
  return match ? match[1] : null;
}

/**
 * Mapeamento de códigos CNJ TPU → tipo interno
 * Fonte: Tabela Processual Unificada do CNJ (Resolução 46/2007)
 */
const CODIGO_TIPO_MAP = {
  // Sentença
  196: 'sentenca', 942: 'sentenca', 12228: 'sentenca', 22: 'sentenca',

  // Acórdão
  198: 'acordao', 941: 'acordao', 15045: 'acordao',

  // Decisão interlocutória / monocrática
  202: 'decisao', 11009: 'decisao', 11010: 'decisao', 11011: 'decisao',
  11012: 'decisao', 548: 'decisao', 549: 'decisao', 550: 'decisao',
  193: 'decisao', 955: 'decisao', 11018: 'decisao', 14772: 'decisao',

  // Despacho / conclusão
  201: 'despacho', 60: 'despacho', 130: 'despacho', 131: 'despacho',
  132: 'despacho', 133: 'despacho', 134: 'despacho', 11014: 'despacho',
  14007: 'despacho',

  // Audiência
  848: 'audiencia', 849: 'audiencia', 850: 'audiencia', 851: 'audiencia',
  852: 'audiencia', 853: 'audiencia', 854: 'audiencia', 871: 'audiencia',
  872: 'audiencia', 873: 'audiencia', 874: 'audiencia', 875: 'audiencia',
  11013: 'audiencia',

  // Citação / intimação / notificação
  971: 'citacao', 972: 'citacao', 973: 'citacao', 974: 'citacao',
  975: 'citacao', 976: 'citacao', 977: 'citacao', 978: 'citacao',
  979: 'citacao', 980: 'citacao', 981: 'citacao', 12428: 'citacao',
  12429: 'citacao',

  // Recurso / apelação / agravo / embargos
  85:  'recurso', 86:  'recurso', 55:  'recurso', 237: 'recurso',
  238: 'recurso', 239: 'recurso', 240: 'recurso', 241: 'recurso',
  950: 'recurso', 951: 'recurso', 952: 'recurso', 953: 'recurso',
  954: 'recurso', 11401: 'recurso', 11402: 'recurso', 11403: 'recurso',

  // Petição / juntada / manifestação / memorial
  51:  'peticao', 57:  'peticao', 165: 'peticao', 166: 'peticao',
  167: 'peticao', 168: 'peticao', 169: 'peticao', 11007: 'peticao',
  11008: 'peticao', 14737: 'peticao',
};

/**
 * Infere o tipo do andamento a partir do código CNJ e/ou nome do movimento
 */
function inferirTipo(nomeMovimento, codigoMovimento) {
  // 1. Código CNJ tem precedência — mapeamento preciso
  if (codigoMovimento && CODIGO_TIPO_MAP[codigoMovimento]) {
    return CODIGO_TIPO_MAP[codigoMovimento];
  }

  // 2. Fallback por palavras-chave no nome
  const nome = (nomeMovimento || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // remove acentos

  if (nome.includes('sentenca') || nome.includes('sentencado'))         return 'sentenca';
  if (nome.includes('acordao'))                                         return 'acordao';
  if (nome.includes('audiencia') || nome.includes('sessao'))            return 'audiencia';
  if (nome.includes('decisao') || nome.includes('julgamento') ||
      nome.includes('provimento') || nome.includes('improvimento'))     return 'decisao';
  if (nome.includes('despacho') || nome.includes('conclusao') ||
      nome.includes('concluso') || nome.includes('vista'))              return 'despacho';
  if (nome.includes('recurso') || nome.includes('apelacao') ||
      nome.includes('agravo') || nome.includes('embargo') ||
      nome.includes('contrarrazao'))                                    return 'recurso';
  if (nome.includes('citacao') || nome.includes('intimacao') ||
      nome.includes('notificacao') || nome.includes('mandado'))         return 'citacao';
  if (nome.includes('peticao') || nome.includes('juntada') ||
      nome.includes('manifestacao') || nome.includes('memorial') ||
      nome.includes('contestacao') || nome.includes('resposta'))        return 'peticao';

  return 'outros';
}

/**
 * Consulta os movimentos de um processo no DataJud pelo número CNJ.
 * Retorna array de movimentos normalizados ou null se não encontrar.
 */
async function buscarMovimentos(numeroCNJ) {
  const apiKey = process.env.DATAJUD_API_KEY;
  if (!apiKey) {
    logger.warn('[DataJud] DATAJUD_API_KEY não configurada — sincronização ignorada');
    return null;
  }

  const codigoTribunal = extrairCodigoTribunal(numeroCNJ);
  if (!codigoTribunal) {
    logger.warn({ numeroCNJ }, '[DataJud] Formato CNJ inválido');
    return null;
  }

  const tribunalSlug = TRIBUNAL_MAP[codigoTribunal];
  if (!tribunalSlug) {
    logger.warn({ codigoTribunal, numeroCNJ }, '[DataJud] Tribunal não mapeado');
    return null;
  }

  try {
    // API exige os 20 dígitos sem pontuação
    const numeroSemMascara = numeroCNJ.replace(/\D/g, '');
    const url = `${DATAJUD_BASE}/api_publica_${tribunalSlug}/_search`;

    const { data } = await axios.post(url, {
      query: { term: { 'numeroProcesso.keyword': numeroSemMascara } },
      _source: ['numeroProcesso', 'nivelSigilo', 'movimento', 'movimentos', 'andamento', 'andamentos']
    }, {
      headers: {
        'Authorization': `ApiKey ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const hits = data?.hits?.hits;
    if (!hits || hits.length === 0) {
      logger.debug({ numeroCNJ, url }, '[DataJud] Nenhum hit retornado');
      return null;
    }

    const src = hits[0]._source || {};

    // Processos em segredo de justiça (nivelSigilo >= 1) não expõem movimentos na API pública
    if (src.nivelSigilo >= 1) {
      logger.info({ numeroCNJ, nivelSigilo: src.nivelSigilo }, '[DataJud] Processo em segredo de justiça — movimentos não disponíveis na API pública');
      return null;
    }

    const movimentos = src.movimento || src.movimentos || src.andamento || src.andamentos || [];
    logger.debug({ numeroCNJ, movimentos: movimentos.length }, '[DataJud] Movimentos encontrados');

    return movimentos.map(m => {
      let descricao = null;
      if (m.complementosTabelados?.length) {
        descricao = m.complementosTabelados
          .map(c => c.nome || c.descricao || c.valor)
          .filter(Boolean)
          .join(' | ')
          .substring(0, 2000);
      } else if (m.complementos) {
        descricao = String(m.complementos).substring(0, 2000);
      }
      return {
        data:  m.dataHora ? m.dataHora.split('T')[0] : new Date().toISOString().split('T')[0],
        tipo:  inferirTipo(m.nome, m.codigo),
        titulo: (m.nome || 'Movimentação').substring(0, 200),
        descricao,
      };
    });

  } catch (err) {
    if (err.response?.status === 404) return null;
    logger.error({ err: err.message, numeroCNJ }, '[DataJud] Erro na consulta');
    return null;
  }
}

module.exports = { buscarMovimentos };
