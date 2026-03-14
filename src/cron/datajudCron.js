const cron = require('node-cron');
const pool = require('../config/db');
const { buscarMovimentos } = require('../services/datajudService');
const logger = require('../utils/logger');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Sincroniza andamentos processuais via DataJud (CNJ).
 * Percorre todos os processos ativos, consulta a API pública e insere
 * movimentos novos com fonte = 'datajud' e visivel_cliente = true.
 */
async function sincronizarAndamentosDatajud() {
  if (!process.env.DATAJUD_API_KEY) {
    logger.warn('[DataJud] Cron ignorado — DATAJUD_API_KEY não configurada');
    return;
  }

  logger.info('[DataJud] Iniciando sincronização de andamentos processuais...');

  const { rows: processos } = await pool.query(`
    SELECT id, numero, escritorio_id
    FROM processos
    WHERE status = 'ativo'
      AND numero IS NOT NULL
      AND numero <> ''
    ORDER BY id
  `);

  logger.info(`[DataJud] ${processos.length} processos ativos encontrados`);

  let inseridos = 0;
  let semDados = 0;
  let erros = 0;

  for (const processo of processos) {
    try {
      const movimentos = await buscarMovimentos(processo.numero);

      if (!movimentos || movimentos.length === 0) {
        semDados++;
        await sleep(300);
        continue;
      }

      for (const mov of movimentos) {
        // Deduplicação: não insere se já existe andamento do DataJud
        // com mesma data e título para este processo
        const { rows } = await pool.query(
          `SELECT id FROM andamentos_processuais
           WHERE processo_id   = $1
             AND fonte         = 'datajud'
             AND data_andamento = $2
             AND titulo        = $3`,
          [processo.id, mov.data, mov.titulo]
        );

        if (rows.length > 0) continue;

        await pool.query(
          `INSERT INTO andamentos_processuais
             (processo_id, escritorio_id, data_andamento, tipo, titulo, descricao, visivel_cliente, fonte)
           VALUES ($1, $2, $3, $4, $5, $6, true, 'datajud')`,
          [
            processo.id,
            processo.escritorio_id,
            mov.data,
            mov.tipo,
            mov.titulo,
            mov.descricao
          ]
        );
        inseridos++;
      }
    } catch (err) {
      logger.error({ err: err.message, processo_id: processo.id, numero: processo.numero },
        '[DataJud] Erro ao processar processo');
      erros++;
    }

    // Pausa entre requisições para respeitar rate limiting da API
    await sleep(400);
  }

  logger.info(`[DataJud] Sincronização concluída — inseridos: ${inseridos} | sem dados: ${semDados} | erros: ${erros}`);
}

// Executa diariamente às 6h (antes dos demais crons de alerta)
cron.schedule('0 6 * * *', async () => {
  try {
    await sincronizarAndamentosDatajud();
  } catch (err) {
    logger.error({ err: err.message }, '[DataJud] Falha geral no cron');
  }
});

logger.info('[DataJud] Cron de sincronização agendado — 06:00 diário');

module.exports = { sincronizarAndamentosDatajud };
