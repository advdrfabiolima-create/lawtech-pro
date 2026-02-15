const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../config/db');
const enviarEmail = require('./emailService');

async function registrarLog(escritorioId, evento, descricao, gravidade) {
    await pool.query(`
        INSERT INTO auditoria_logs (escritorio_id, evento, descricao, gravidade)
        VALUES ($1, $2, $3, $4)
    `, [escritorioId, evento, descricao, gravidade]);
}

async function auditarEscritorio(escritorio) {
    try {
        const { id, stripe_customer_id } = escritorio;

        if (!stripe_customer_id) {
            await registrarLog(id, 'cliente_sem_stripe', 'Cliente sem stripe_customer_id', 'critica');
            return;
        }

        const subscriptions = await stripe.subscriptions.list({
            customer: stripe_customer_id,
            limit: 1
        });

        if (!subscriptions.data.length) {
            await registrarLog(id, 'sem_assinatura', 'Nenhuma assinatura encontrada', 'critica');

            await pool.query(`
                UPDATE escritorios
                SET plano_financeiro_status = 'suspenso'
                WHERE id = $1
            `, [id]);

            await enviarEmail(
                escritorio.email,
                '⚠️ Problema na sua assinatura',
                'Detectamos ausência de assinatura ativa. Regularize para evitar bloqueio.'
            );

            return;
        }

        const assinatura = subscriptions.data[0];

        // 🔁 AUTO CORREÇÃO
        if (assinatura.status === 'active') {

            await pool.query(`
                UPDATE escritorios
                SET plano_financeiro_status = 'ativo'
                WHERE id = $1
            `, [id]);

            await registrarLog(id, 'status_corrigido', 'Status corrigido para ativo automaticamente', 'baixa');
        }

        if (assinatura.status === 'past_due' || assinatura.status === 'unpaid') {

            await pool.query(`
                UPDATE escritorios
                SET plano_financeiro_status = 'suspenso'
                WHERE id = $1
            `, [id]);

            await registrarLog(id, 'inadimplente', 'Assinatura inadimplente detectada', 'alta');

            await enviarEmail(
                escritorio.email,
                '⚠️ Pagamento não aprovado',
                'Seu pagamento não foi aprovado. Atualize seu cartão para continuar usando o sistema.'
            );
        }

    } catch (error) {
        await registrarLog(escritorio.id, 'erro_auditoria', error.message, 'critica');
    }
}

async function executarAuditoriaStripe() {
    const { rows } = await pool.query(`
        SELECT id, stripe_customer_id, email
        FROM escritorios
        WHERE plano_financeiro_status IN ('ativo','suspenso')
    `);

    for (const escritorio of rows) {
        await auditarEscritorio(escritorio);
    }

    console.log('✔ Auditoria Stripe Enterprise concluída.');
}

module.exports = executarAuditoriaStripe;