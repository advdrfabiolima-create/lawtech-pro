/**
 * 🚫 SCRAPER DJEN DESATIVADO NESTE PROJETO
 * 
 * O scraping agora é feito pelo worker externo:
 * lawtech-djen-worker
 * 
 * Este arquivo permanece apenas para evitar quebra
 * de imports antigos.
 */

async function executarScraperDJEN() {
  console.warn('⚠️ DJEN scraper desativado no Juridico_APP');
  return {
    ok: false,
    erro: 'Scraper DJEN agora roda em worker externo'
  };
}

module.exports = {
  executarScraperDJEN
};
