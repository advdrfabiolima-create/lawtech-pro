const cron = require('node-cron');
const executarAuditoriaStripe = require('../services/auditoriaStripe');

cron.schedule('0 18 * * *', async () => {
    console.log('🔍 Iniciando auditoria Stripe...');
    await executarAuditoriaStripe();
});
