const cron = require('node-cron');
const pool = require('../config/db');
const axios = require('axios');

/**
 * 💳 CRON JOB: Cobrar escritórios cujo trial expirou
 * Executa todo dia às 6h da manhã
 */
cron.schedule('0 6 * * *', async () => {
    console.log('🔔 [CRON] Verificando trials expirados...');
    
    try {
        // Buscar escritórios cujo trial expira hoje
        const result = await pool.query(`
            SELECT 
                e.id,
                e.nome,
                e.plano_id,
                e.cartao_token,
                e.trial_expira_em,
                p.preco_mensal,
                p.nome as plano_nome,
                u.email as email_responsavel
            FROM escritorios e
            JOIN planos p ON e.plano_id = p.id
            JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
            WHERE 
                e.plano_financeiro_status = 'trial'
                AND DATE(e.trial_expira_em) = CURRENT_DATE
                AND e.cartao_token IS NOT NULL
            ORDER BY e.id
        `);

        console.log(`📊 [CRON] Encontrados ${result.rowCount} escritórios para cobrar`);

        for (const escritorio of result.rows) {
            try {
                console.log(`💳 [CRON] Processando cobrança: Escritório ${escritorio.id} - ${escritorio.nome}`);
                
                // ✅ IMPLEMENTAR: Integração com gateway de pagamento
                // Exemplo com Asaas ou outro gateway
                
                const cobranca = await processarCobrancaCartao({
                    escritorioId: escritorio.id,
                    valor: parseFloat(escritorio.preco_mensal),
                    cartaoToken: escritorio.cartao_token,
                    descricao: `Plano ${escritorio.plano_nome} - LawTech Pro`
                });

                if (cobranca.sucesso) {
                    // Atualizar status para 'pago'
                    await pool.query(`
                        UPDATE escritorios 
                        SET plano_financeiro_status = 'pago',
                            data_vencimento = CURRENT_DATE + INTERVAL '30 days',
                            trial_expira_em = NULL
                        WHERE id = $1
                    `, [escritorio.id]);

                    console.log(`✅ [CRON] Cobrança realizada: Escritório ${escritorio.id}`);
                    
                    // TODO: Enviar email de confirmação
                    
                } else {
                    console.error(`❌ [CRON] Falha na cobrança: Escritório ${escritorio.id}`);
                    
                    // Enviar email avisando sobre falha no pagamento
                    // Bloquear acesso após 3 tentativas
                }

            } catch (err) {
                console.error(`❌ [CRON] Erro ao processar escritório ${escritorio.id}:`, err);
            }
        }

        console.log('✅ [CRON] Processamento de cobranças concluído');

    } catch (err) {
        console.error('❌ [CRON] Erro geral:', err);
    }
});

/**
 * Função auxiliar para processar cobrança
 */
async function processarCobrancaCartao({ escritorioId, valor, cartaoToken, descricao }) {
    // ✅ IMPLEMENTAR INTEGRAÇÃO COM GATEWAY
    // Exemplo: Asaas, PagSeguro, Stripe, etc.
    
    // Por enquanto, retorna mock
    return {
        sucesso: true,
        transacaoId: 'TXN_' + Date.now(),
        valor: valor
    };
}

module.exports = { processarCobrancaCartao };