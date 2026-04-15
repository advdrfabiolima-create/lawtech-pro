/* ======================================================
   ENDPOINTS DE CANCELAMENTO DE ASSINATURA
   
   Adicionar estas rotas ao arquivo: /routes/pagamentos.routes.js
   OU criar um arquivo separado: /routes/assinatura.routes.js
===================================================== */

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const logger = require('../utils/logger');
const { enviarEmail } = require('../services/emailService');
const { decrypt } = require('../utils/crypto');
const { processarCobrancaCartao, registrarTransacao } = require('../services/chargeService');
const cache = require('../utils/cache');

async function invalidarCacheEscritorio(escritorioId) {
    try {
        const users = await pool.query('SELECT id FROM usuarios WHERE escritorio_id = $1', [escritorioId]);
        for (const u of users.rows) await cache.del(`auth:user:${u.id}`);
    } catch (_) {}
}

/* ======================================================
   🗑️ CANCELAR RENOVAÇÃO AUTOMÁTICA
   
   Usuário continua com acesso até o fim do período pago
   Mas não será cobrado novamente
===================================================== */

router.post('/cancelar-assinatura', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        
        logger.info({ email: req.user.email }, '[CANCELAMENTO] Solicitacao recebida');

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

        // Marcar como cancelada (renovacao_automatica = false) e agendar expiração
        await pool.query(
            `UPDATE escritorios
             SET renovacao_automatica = false,
                 data_cancelamento_agendado = proxima_cobranca
             WHERE id = $1`,
            [escritorioId]
        );

        logger.info({ email: req.user.email, acesso_ate: proxima_cobranca }, '[CANCELAMENTO] Renovacao automatica desativada');

        const dataAcesso = proxima_cobranca
            ? new Date(proxima_cobranca).toLocaleDateString('pt-BR')
            : 'fim do período atual';

        enviarEmail({
            para: req.user.email,
            assunto: 'Renovação automática cancelada — LawTech Pro',
            html: `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
                <div style="background:#1E3A5F;padding:24px;text-align:center;">
                    <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:160px;height:auto;" />
                </div>
                <div style="padding:28px 24px;background:#fff;">
                    <h2 style="color:#1E3A5F;margin:0 0 16px;">Cancelamento confirmado</h2>
                    <p style="color:#374151;font-size:14px;">Olá! A renovação automática da sua assinatura foi <strong>cancelada com sucesso</strong>.</p>
                    <p style="color:#374151;font-size:14px;">Seu acesso ao LawTech Pro permanece ativo até <strong>${dataAcesso}</strong>. Após essa data, sem pagamento, o acesso será encerrado.</p>
                    <p style="color:#374151;font-size:14px;">Se mudar de ideia, você pode reativar a renovação automática a qualquer momento em <strong>Configurações → Pagamento</strong>.</p>
                    <p style="color:#6b7280;font-size:12px;margin-top:24px;">Dúvidas? contato@lawtechpro.com.br</p>
                </div>
            </div>`
        }).catch(err => logger.warn({ err: err.message }, '[CANCELAMENTO] Falha ao enviar email de confirmação'));

        res.json({
            ok: true, 
            mensagem: 'Renovação automática cancelada com sucesso',
            acesso_ate: proxima_cobranca,
            detalhes: 'Seu acesso continuará ativo até o fim do período já pago. Não haverá novas cobranças.'
        });

    } catch (err) {
        logger.error({ err: err.message }, '[CANCELAMENTO] Erro');
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

router.post('/reativar-assinatura', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        
        logger.info({ email: req.user.email }, '[REATIVACAO] Solicitacao recebida');

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

        logger.info({ email: req.user.email, proxima_cobranca }, '[REATIVACAO] Renovacao automatica reativada');

        const dataProxima = proxima_cobranca
            ? new Date(proxima_cobranca).toLocaleDateString('pt-BR')
            : null;

        enviarEmail({
            para: req.user.email,
            assunto: 'Renovação automática reativada — LawTech Pro',
            html: `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
                <div style="background:#1E3A5F;padding:24px;text-align:center;">
                    <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:160px;height:auto;" />
                </div>
                <div style="padding:28px 24px;background:#fff;">
                    <h2 style="color:#1E3A5F;margin:0 0 16px;">Renovação automática reativada</h2>
                    <p style="color:#374151;font-size:14px;">Olá! Sua renovação automática foi <strong>reativada com sucesso</strong>.</p>
                    ${dataProxima ? `<p style="color:#374151;font-size:14px;">Sua próxima cobrança está prevista para <strong>${dataProxima}</strong>. O valor será debitado automaticamente no cartão cadastrado.</p>` : ''}
                    <p style="color:#374151;font-size:14px;">Para gerenciar sua assinatura, acesse <strong>Configurações → Pagamento</strong>.</p>
                    <p style="color:#6b7280;font-size:12px;margin-top:24px;">Dúvidas? contato@lawtechpro.com.br</p>
                </div>
            </div>`
        }).catch(err => logger.warn({ err: err.message }, '[REATIVACAO] Falha ao enviar email de confirmação'));

        res.json({
            ok: true, 
            mensagem: 'Renovação automática reativada com sucesso',
            proxima_cobranca: proxima_cobranca,
            detalhes: 'Sua assinatura voltará a ser renovada automaticamente.'
        });

    } catch (err) {
        logger.error({ err: err.message }, '[REATIVACAO] Erro');
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
        logger.error({ err: err.message }, '[STATUS ASSINATURA] Erro');
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
        logger.error({ err: err.message }, '[HISTORICO] Erro');
        res.status(500).json({ 
            erro: 'Erro ao buscar histórico de transações' 
        });
    }
});

/* ======================================================
   💳 REATIVAR CONTA SUSPENSA

   Cobra o cartão já cadastrado e reativa a assinatura.
   Não usa verificarPagamento (conta está suspensa).
===================================================== */

router.post('/reativar-suspenso', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;

        // 1. Verifica se realmente está suspenso
        const escResult = await pool.query(
            `SELECT e.plano_financeiro_status, e.plano_id,
                    p.nome as plano_nome, p.preco_mensal,
                    c.token as cartao_token, c.gateway, c.last4, c.brand,
                    u.email as email_admin
             FROM escritorios e
             JOIN planos p ON p.id = e.plano_id
             LEFT JOIN cartoes c ON c.escritorio_id = e.id
             JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
             WHERE e.id = $1`,
            [escritorioId]
        );

        if (!escResult.rows.length) {
            return res.status(404).json({ ok: false, erro: 'Escritório não encontrado' });
        }

        const esc = escResult.rows[0];

        if (esc.plano_financeiro_status !== 'suspenso') {
            return res.status(400).json({
                ok: false,
                erro: 'Conta não está suspensa',
                status_atual: esc.plano_financeiro_status
            });
        }

        if (!esc.cartao_token || !esc.gateway) {
            return res.status(400).json({
                ok: false,
                erro: 'Nenhum cartão cadastrado. Adicione um cartão em Configurações → Pagamento antes de reativar.'
            });
        }

        const valorEmCentavos = Math.round(parseFloat(esc.preco_mensal) * 100);

        logger.info({ escritorioId, plano: esc.plano_nome, valor: esc.preco_mensal }, '[REATIVAR SUSPENSO] Iniciando cobrança');

        // 2. Cobra o cartão cadastrado
        const cobranca = await processarCobrancaCartao({
            escritorioId,
            valor: valorEmCentavos,
            cartaoToken: decrypt(esc.cartao_token),
            gateway: esc.gateway,
            descricao: `Reativação de conta — ${esc.plano_nome}`
        });

        if (!cobranca.sucesso) {
            logger.warn({ escritorioId, erro: cobranca.erro }, '[REATIVAR SUSPENSO] Cobrança recusada');
            return res.status(402).json({
                ok: false,
                erro: `Pagamento recusado: ${cobranca.erro}. Verifique os dados do cartão em Configurações → Pagamento.`
            });
        }

        // 3. Idempotência: evita registrar transação duplicada
        const jaExiste = await pool.query(
            'SELECT id FROM transacoes WHERE gateway_id = $1', [cobranca.transacaoId]
        );
        if (jaExiste.rows.length > 0) {
            return res.json({ ok: true, mensagem: 'Conta já foi reativada anteriormente.' });
        }

        // 4. Reativa a conta
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `UPDATE escritorios
                 SET plano_financeiro_status = 'pago',
                     ultimo_pagamento = NOW(),
                     proxima_cobranca = NOW() + INTERVAL '1 month',
                     retry_count = 0
                 WHERE id = $1`,
                [escritorioId]
            );

            await registrarTransacao(client, {
                escritorioId,
                gateway_id: cobranca.transacaoId,
                gateway: esc.gateway,
                valor: valorEmCentavos,
                status: 'aprovada',
                descricao: `Reativação pós-suspensão — ${esc.plano_nome}`
            });

            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

        await invalidarCacheEscritorio(escritorioId);
        logger.info({ escritorioId, transacaoId: cobranca.transacaoId }, '[REATIVAR SUSPENSO] Conta reativada com sucesso');

        // 5. Email de confirmação (fire-and-forget)
        enviarEmail({
            para: esc.email_admin,
            assunto: '✅ Conta reativada — LawTech Pro',
            html: `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
                <div style="background:#1E3A5F;padding:24px;text-align:center;">
                    <img src="https://www.lawtechpro.com.br/Logo%20LawTech%20Pro_transparente.png" alt="LawTech Pro" style="max-width:160px;height:auto;" />
                </div>
                <div style="padding:28px 24px;background:#fff;">
                    <h2 style="color:#166534;margin:0 0 16px;">Sua conta foi reativada!</h2>
                    <p style="color:#374151;font-size:14px;">O pagamento do plano <strong>${esc.plano_nome}</strong> (R$ ${esc.preco_mensal}/mês) foi aprovado e seu acesso ao LawTech Pro está <strong>totalmente restaurado</strong>.</p>
                    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
                        <tr style="background:#f0fdf4;">
                            <td style="padding:10px 14px;color:#6b7280;">Plano</td>
                            <td style="padding:10px 14px;color:#111827;font-weight:600;">${esc.plano_nome}</td>
                        </tr>
                        <tr>
                            <td style="padding:10px 14px;color:#6b7280;">Cartão</td>
                            <td style="padding:10px 14px;color:#111827;font-weight:600;">${esc.brand || ''} **** ${esc.last4}</td>
                        </tr>
                        <tr style="background:#f0fdf4;">
                            <td style="padding:10px 14px;color:#6b7280;">Próxima cobrança</td>
                            <td style="padding:10px 14px;color:#111827;font-weight:600;">Em 30 dias (renovação automática)</td>
                        </tr>
                    </table>
                    <p style="color:#6b7280;font-size:12px;margin-top:24px;">Dúvidas? contato@lawtechpro.com.br</p>
                </div>
            </div>`
        }).catch(err => logger.warn({ err: err.message }, '[REATIVAR SUSPENSO] Falha ao enviar email'));

        res.json({
            ok: true,
            mensagem: 'Conta reativada com sucesso! Seu acesso foi restaurado.',
            proxima_cobranca: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });

    } catch (err) {
        logger.error({ err: err.message }, '[REATIVAR SUSPENSO] Erro interno');
        res.status(500).json({ ok: false, erro: 'Erro ao processar reativação. Tente novamente.' });
    }
});

module.exports = router;