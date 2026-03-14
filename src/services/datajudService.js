const axios = require('axios');
const logger = require('../utils/logger');

const DATAJUD_BASE = 'https://api-publica.datajud.cnj.jus.br';

// Mapeia J.TT do número CNJ para o slug do endpoint DataJud
const TRIBUNAL_MAP = {
  '1.00': 'stf',
  '3.00': 'stj',
  '4.01': 'trf1', '4.02': 'trf2', '4.03': 'trf3',
  '4.04': 'trf4', '4.05': 'trf5', '4.06': 'trf6',
  '5.01': 'trt1',  '5.02': 'trt2',  '5.03': 'trt3',
  '5.04': 'trt4',  '5.05': 'trt5',  '5.06': 'trt6',
  '5.07': 'trt7',  '5.08': 'trt8',  '5.09': 'trt9',
  '5.10': 'trt10', '5.11': 'trt11', '5.12': 'trt12',
  '5.13': 'trt13', '5.14': 'trt14', '5.15': 'trt15',
  '5.16': 'trt16', '5.17': 'trt17', '5.18': 'trt18',
  '5.19': 'trt19', '5.20': 'trt20', '5.21': 'trt21',
  '5.22': 'trt22', '5.23': 'trt23', '5.24': 'trt24',
  '8.01': 'tjal',  '8.02': 'tjap',  '8.03': 'tjam',
  '8.04': 'tjpa',  '8.05': 'tjba',  '8.06': 'tjce',
  '8.07': 'tjdft', '8.08': 'tjes',  '8.09': 'tjgo',
  '8.10': 'tjma',  '8.11': 'tjmt',  '8.12': 'tjms',
  '8.13': 'tjmg',  '8.14': 'tjpr',  '8.15': 'tjpb',
  '8.16': 'tjpe',  '8.17': 'tjpi',  '8.18': 'tjrj',
  '8.19': 'tjrn',  '8.20': 'tjrs',  '8.21': 'tjro',
  '8.22': 'tjrr',  '8.23': 'tjsc',  '8.24': 'tjsp',
  '8.25': 'tjse',  '8.26': 'tjto',
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
 * Infere o tipo do andamento a partir do nome do movimento DataJud
 */
function inferirTipo(nomeMovimento) {
  const nome = (nomeMovimento || '').toLowerCase();
  if (nome.includes('sentença') || nome.includes('sentenca'))           return 'sentenca';
  if (nome.includes('acórdão') || nome.includes('acordao'))             return 'acordao';
  if (nome.includes('audiência') || nome.includes('audiencia'))         return 'audiencia';
  if (nome.includes('decisão') || nome.includes('decisao'))             return 'decisao';
  if (nome.includes('despacho'))                                        return 'despacho';
  if (nome.includes('recurso') || nome.includes('apelação') ||
      nome.includes('agravo') || nome.includes('embargo'))              return 'recurso';
  if (nome.includes('citação') || nome.includes('citacao') ||
      nome.includes('intimação') || nome.includes('intimacao'))         return 'citacao';
  if (nome.includes('petição') || nome.includes('peticao') ||
      nome.includes('manifestação'))                                    return 'peticao';
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
      query: { match: { numeroProcesso: numeroSemMascara } },
      _source: ['numeroProcesso', 'movimento']
    }, {
      headers: {
        'Authorization': `ApiKey ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 12000
    });

    const hits = data?.hits?.hits;
    if (!hits || hits.length === 0) return null;

    const movimentos = hits[0]._source?.movimento || [];

    return movimentos.map(m => ({
      data:     m.dataHora ? m.dataHora.split('T')[0] : new Date().toISOString().split('T')[0],
      tipo:     inferirTipo(m.nome),
      titulo:   (m.nome || 'Movimentação').substring(0, 200),
      descricao: m.complementos ? String(m.complementos).substring(0, 2000) : null,
    }));

  } catch (err) {
    if (err.response?.status === 404) return null;
    logger.error({ err: err.message, numeroCNJ }, '[DataJud] Erro na consulta');
    return null;
  }
}

module.exports = { buscarMovimentos };
