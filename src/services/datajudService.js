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
 * Mapeamento de códigos CNJ TPU → tipo interno.
 * Contém apenas códigos verificados na documentação oficial do CNJ.
 * Códigos não mapeados aqui são classificados pelo nome do movimento.
 */
const CODIGO_TIPO_MAP = {
  // ── Sentença ─────────────────────────────────────────────────────────────
  196: 'sentenca',  // Sentença
  955: 'sentenca',  // Sentença Homologatória

  // ── Acórdão ──────────────────────────────────────────────────────────────
  198: 'acordao',   // Acórdão

  // ── Decisão interlocutória ───────────────────────────────────────────────
  202: 'decisao',   // Decisão
  11009: 'decisao', // Decisão Interlocutória
  11010: 'decisao', // Decisão Monocrática
  548:  'decisao',  // Decisão de Admissibilidade
  549:  'decisao',  // Decisão de Inadmissibilidade

  // ── Despacho ─────────────────────────────────────────────────────────────
  201: 'despacho',  // Despacho
  60:  'despacho',  // Conclusão ao Juiz / Desembargador
  132: 'despacho',  // Despacho de Mero Expediente

  // ── Audiência ────────────────────────────────────────────────────────────
  871: 'audiencia', // Audiência de Instrução e Julgamento
  872: 'audiencia', // Audiência de Conciliação
  873: 'audiencia', // Audiência Una
  874: 'audiencia', // Audiência de Custódia
  875: 'audiencia', // Audiência Especial

  // ── Citação / Intimação ──────────────────────────────────────────────────
  971: 'citacao',   // Citação
  972: 'citacao',   // Citação por Edital
  973: 'citacao',   // Citação por Hora Certa
  974: 'citacao',   // Citação pelo Correio
  975: 'citacao',   // Intimação
  976: 'citacao',   // Intimação por Edital
  977: 'citacao',   // Intimação pelo Correio
  978: 'citacao',   // Notificação
  979: 'citacao',   // Notificação por Edital

  // ── Trânsito em Julgado ──────────────────────────────────────────────────
  848: 'transito',  // Trânsito em Julgado

  // ── Recurso ──────────────────────────────────────────────────────────────
  85:  'recurso',   // Recurso Inominado
  86:  'recurso',   // Apelação
  237: 'recurso',   // Agravo Regimental
  238: 'recurso',   // Agravo Interno
  239: 'recurso',   // Embargos de Declaração
  240: 'recurso',   // Embargos Infringentes
  241: 'recurso',   // Recurso Especial
  950: 'recurso',   // Recurso Extraordinário
  951: 'recurso',   // Recurso Ordinário

  // ── Contrarrazões ─────────────────────────────────────────────────────────
  168: 'contrarrazoes', // Juntada de Contrarrazões

  // ── Petição / Juntada ────────────────────────────────────────────────────
  57:  'peticao',   // Petição
  165: 'peticao',   // Juntada de Petição
  166: 'contestacao', // Juntada de Contestação
  167: 'peticao',   // Juntada de Recurso (é a juntada física, não o recurso em si)
  169: 'peticao',   // Juntada de Manifestação

  // ── Arquivamento / Baixa ──────────────────────────────────────────────────
  22:  'arquivamento', // Baixa Definitiva
  267: 'arquivamento', // Arquivamento
};

/**
 * Infere o tipo do andamento a partir do código CNJ TPU (preferencial)
 * e do nome do movimento (fallback). Normaliza acentos para comparação segura.
 *
 * Tipos disponíveis (espelham TIPO_META no frontend):
 * distribuicao | despacho | decisao | sentenca | acordao | transito |
 * peticao | contestacao | recurso | contrarrazoes |
 * audiencia | citacao | expedicao | publicacao |
 * cumprimento | execucao | pericia | conciliacao |
 * certidao | alvara | arquivamento | remessa | outros
 */
function inferirTipo(nomeMovimento, codigoMovimento) {
  // 1. Código CNJ verificado — maior precisão
  if (codigoMovimento && CODIGO_TIPO_MAP[codigoMovimento]) {
    return CODIGO_TIPO_MAP[codigoMovimento];
  }

  // 2. Matching por nome (normalizado: sem acentos, minúsculas)
  const n = (nomeMovimento || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // ── Trânsito em Julgado — antes de qualquer outro check ─────────────────
  if (n.includes('transito em julgado') || n.includes('transito julgado') ||
      n.includes('coisa julgada'))                                      return 'transito';

  // ── Sentença ─────────────────────────────────────────────────────────────
  if (n.includes('sentenca') || n.startsWith('sentenc'))               return 'sentenca';

  // ── Acórdão ──────────────────────────────────────────────────────────────
  if (n.includes('acordao'))                                            return 'acordao';

  // ── Audiência / Sessão ────────────────────────────────────────────────────
  if (n.includes('audiencia') || n.includes('sessao de julgamento') ||
      n.includes('sessao plenaria'))                                    return 'audiencia';

  // ── Conciliação / Mediação ────────────────────────────────────────────────
  if (n.includes('conciliacao') || n.includes('mediacao') ||
      n.includes('autocomposicao'))                                     return 'conciliacao';

  // ── Decisão — depois de sentença/acórdão para não colidir ────────────────
  if (n.includes('decisao') || n.includes('julgamento antecipado') ||
      n.includes('improcedencia liminar') || n.includes('procedencia liminar') ||
      n.includes('tutela') || n.includes('liminar'))                   return 'decisao';

  // ── Despacho / Conclusão ──────────────────────────────────────────────────
  if (n.includes('despacho') || n.includes('conclusao') ||
      n.includes('concluso') || n.startsWith('vista') ||
      n.includes('carga') || n.startsWith('devolvido'))                return 'despacho';

  // ── Contrarrazões — antes de recurso para não ser engolido ───────────────
  if (n.includes('contrarrazoes') || n.includes('contrarrazao'))       return 'contrarrazoes';

  // ── Recurso / Apelação / Agravo / Embargos ────────────────────────────────
  if (n.startsWith('recurso') || n.startsWith('apelacao') ||
      n.startsWith('agravo') || n.startsWith('embargo') ||
      n.includes('recurso especial') || n.includes('recurso extraordinario') ||
      n.includes('recurso inominado') || n.includes('recurso adesivo'))  return 'recurso';

  // ── Citação / Intimação / Notificação ─────────────────────────────────────
  if (n.includes('citacao') || n.includes('intimacao') ||
      n.includes('notificacao') || n.includes('mandado de citacao') ||
      n.includes('mandado de intimacao'))                               return 'citacao';

  // ── Contestação ───────────────────────────────────────────────────────────
  if (n.includes('contestacao') || n.includes('resposta do reu') ||
      n.includes('defesa'))                                             return 'contestacao';

  // ── Petição / Juntada / Manifestação ─────────────────────────────────────
  if (n.includes('peticao') || n.includes('juntada') ||
      n.includes('manifestacao') || n.includes('memorial') ||
      n.includes('replica') || n.includes('impugnacao') ||
      n.includes('excepcao') || n.includes('incidente'))               return 'peticao';

  // ── Cumprimento de Sentença / Decisão ────────────────────────────────────
  if (n.includes('cumprimento') || n.includes('satisfacao'))           return 'cumprimento';

  // ── Execução ──────────────────────────────────────────────────────────────
  if (n.startsWith('execucao') || n.includes('penhora') ||
      n.includes('arresto') || n.includes('hasta publica') ||
      n.includes('leilao'))                                             return 'execucao';

  // ── Perícia / Laudo ───────────────────────────────────────────────────────
  if (n.includes('pericia') || n.includes('laudo') ||
      n.includes('vistoria'))                                           return 'pericia';

  // ── Expedição de documento ────────────────────────────────────────────────
  if (n.includes('expedicao') || n.startsWith('expedicao') ||
      n.includes('carta de sentenca') || n.includes('precatorio'))     return 'expedicao';

  // ── Publicação ────────────────────────────────────────────────────────────
  if (n.includes('publicacao') || n.includes('diario') ||
      n.includes('djen') || n.includes('dje'))                         return 'publicacao';

  // ── Certidão ──────────────────────────────────────────────────────────────
  if (n.includes('certidao') || n.includes('certificado'))             return 'certidao';

  // ── Alvará ────────────────────────────────────────────────────────────────
  if (n.includes('alvara'))                                             return 'alvara';

  // ── Remessa ───────────────────────────────────────────────────────────────
  if (n.includes('remessa') || n.includes('redistribuicao') ||
      n.includes('redistribuido'))                                      return 'remessa';

  // ── Distribuição ──────────────────────────────────────────────────────────
  if (n.includes('distribuicao') || n.startsWith('distribuido'))       return 'distribuicao';

  // ── Arquivamento / Baixa ──────────────────────────────────────────────────
  if (n.includes('arquivamento') || n.includes('baixa') ||
      n.includes('encerramento') || n.includes('extincao'))            return 'arquivamento';

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
