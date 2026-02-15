/* ======================================================
   ENDPOINTS DE CANCELAMENTO DE ASSINATURA
   
   Adicionar estas rotas ao arquivo: /routes/pagamentos.routes.js
   OU criar um arquivo separado: /routes/assinatura.routes.js
===================================================== */

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');

/* ======================================================
   🗑️ CANCELAR RENOVAÇÃO AUTOMÁTICA
   
   Usuário continua com acesso até o fim do período pago
   Mas não será cobrado novamente
===================================================== */

router.post('/cancelar-assinatura', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        
        console.log('🗑️ [CANCELAMENTO] Solicitação recebida:', req.user.email);

        // Verificar status atual
        const check = await pool.query(
            'SELECT plano_financeiro_status, proxima_cobranca FROM escritorios WHERE id = $1',
            [escritorioId]
        );

        if (check.rows.length === 0) {
            return res.status(404).json({ 
                erro: 'Escritório não encontrado' 
            });
        }

        const { plano_financeiro_status, proxima_cobranca } = check.rows[0];

        // Verificar se pode cancelar
        if (plano_financeiro_status !== 'pago' && plano_financeiro_status !== 'ativo') {
            return res.status(400).json({ 
                erro: 'Apenas assinaturas ativas podem ser canceladas',
                status_atual: plano_financeiro_status
            });
        }

        // Marcar como cancelada (renovacao_automatica = false)
        await pool.query(
            `UPDATE escritorios 
             SET renovacao_automatica = false
             WHERE id = $1`,
            [escritorioId]
        );

        console.log('✅ [CANCELAMENTO] Renovação automática desativada:', req.user.email);
        console.log('   Acesso até:', proxima_cobranca ? new Date(proxima_cobranca).toLocaleDateString('pt-BR') : 'Indefinido');

        // TODO: Enviar email de confirmação de cancelamento

        res.json({ 
            ok: true, 
            mensagem: 'Renovação automática cancelada com sucesso',
            acesso_ate: proxima_cobranca,
            detalhes: 'Seu acesso continuará ativo até o fim do período já pago. Não haverá novas cobranças.'
        });

    } catch (err) {
        console.error('❌ [CANCELAMENTO] Erro:', err);
        res.status(500).json({ 
            erro: 'Erro ao processar cancelamento',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

/* ======================================================
   🔄 REATIVAR RENOVAÇÃO AUTOMÁTICA
   
   Usuário volta a ser cobrado mensalmente
===================================================== */

router.post('/reativar-assinatura', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        
        console.log('🔄 [REATIVAÇÃO] Solicitação recebida:', req.user.email);

        // Verificar status atual
        const check = await pool.query(
            `SELECT plano_financeiro_status, renovacao_automatica, proxima_cobranca 
             FROM escritorios WHERE id = $1`,
            [escritorioId]
        );

        if (check.rows.length === 0) {
            return res.status(404).json({ 
                erro: 'Escritório não encontrado' 
            });
        }

        const { plano_financeiro_status, renovacao_automatica, proxima_cobranca } = check.rows[0];

        // Verificar se já está ativa
        if (renovacao_automatica !== false) {
            return res.status(400).json({ 
                erro: 'Renovação automática já está ativa',
                status: plano_financeiro_status
            });
        }

        // Reativar
        await pool.query(
            `UPDATE escritorios 
             SET renovacao_automatica = true
             WHERE id = $1`,
            [escritorioId]
        );

        console.log('✅ [REATIVAÇÃO] Renovação automática reativada:', req.user.email);
        console.log('   Próxima cobrança:', proxima_cobranca ? new Date(proxima_cobranca).toLocaleDateString('pt-BR') : 'A definir');

        // TODO: Enviar email de confirmação

        res.json({ 
            ok: true, 
            mensagem: 'Renovação automática reativada com sucesso',
            proxima_cobranca: proxima_cobranca,
            detalhes: 'Sua assinatura voltará a ser renovada automaticamente.'
        });

    } catch (err) {
        console.error('❌ [REATIVAÇÃO] Erro:', err);
        res.status(500).json({ 
            erro: 'Erro ao processar reativação',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

/* ======================================================
   📊 VERIFICAR STATUS DA ASSINATURA
   
   Retorna informações detalhadas sobre a assinatura
===================================================== */

router.get('/status-assinatura', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        
        const result = await pool.query(
            `SELECT 
                e.plano_financeiro_status,
                e.renovacao_automatica,
                e.ultimo_pagamento,
                e.proxima_cobranca,
                e.trial_expira_em,
                p.nome as plano_nome,
                p.preco_mensal,
                c.last4,
                c.brand,
                c.gateway
             FROM escritorios e
             JOIN planos p ON p.id = e.plano_id
             LEFT JOIN cartoes c ON c.escritorio_id = e.id
             WHERE e.id = $1`,
            [escritorioId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                erro: 'Escritório não encontrado' 
            });
        }

        const dados = result.rows[0];

        res.json({ 
            ok: true,
            status: dados.plano_financeiro_status,
            renovacao_automatica: dados.renovacao_automatica !== false,
            plano: dados.plano_nome,
            valor_mensal: dados.preco_mensal,
            ultimo_pagamento: dados.ultimo_pagamento,
            proxima_cobranca: dados.proxima_cobranca,
            trial_expira_em: dados.trial_expira_em,
            cartao: dados.last4 ? {
                ultimos_digitos: dados.last4,
                bandeira: dados.brand,
                gateway: dados.gateway
            } : null
        });

    } catch (err) {
        console.error('❌ [STATUS ASSINATURA] Erro:', err);
        res.status(500).json({ 
            erro: 'Erro ao buscar status da assinatura' 
        });
    }
});

/* ======================================================
   📋 HISTÓRICO DE TRANSAÇÕES
   
   Lista todas as cobranças do escritório
===================================================== */

router.get('/historico-transacoes', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        
        const result = await pool.query(
            `SELECT 
                id,
                gateway_id,
                gateway,
                valor / 100.0 as valor_reais,
                status,
                descricao,
                mensagem_erro,
                created_at
             FROM transacoes
             WHERE escritorio_id = $1
             ORDER BY created_at DESC
             LIMIT 50`,
            [escritorioId]
        );

        res.json({ 
            ok: true,
            total: result.rowCount,
            transacoes: result.rows
        });

    } catch (err) {
        console.error('❌ [HISTÓRICO] Erro:', err);
        res.status(500).json({ 
            erro: 'Erro ao buscar histórico de transações' 
        });
    }
});

module.exports = router;