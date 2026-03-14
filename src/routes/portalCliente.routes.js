const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');
const { sign: jwtSign } = require('../config/jwt');
const authMiddleware = require('../middlewares/authMiddleware');
const portalMiddleware = require('../middlewares/portalMiddleware');
const logger = require('../utils/logger');
const { enviarEmail } = require('../services/emailService');
// dailyService não é mais necessário no portal (Jitsi não usa tokens)

// Rate limiting para autenticação do portal — protege contra brute-force de tokens
const portalAuthLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutos
    max: 5,                   // máximo 5 tentativas por IP a cada 10 min
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, erro: 'Muitas tentativas de autenticação. Aguarde 10 minutos e tente novamente.' }
});

// Rate limiting para solicitação de acesso por CPF — anti-enumeração
const solicitarAcessoLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, erro: 'Muitas tentativas. Tente novamente em 1 hora.' }
});

// GET /api/portal/escritorio/:slug  (público — retorna info do escritório para a página de acesso)
router.get('/escritorio/:slug', async (req, res) => {
    const slug = req.params.slug.toLowerCase().trim();
    try {
        const result = await pool.query(
            `SELECT nome, advogado_responsavel, logo_base64, logo_arquivo
             FROM escritorios WHERE portal_slug = $1`,
            [slug]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Escritório não encontrado.' });
        }
        const e = result.rows[0];
        res.json({ ok: true, escritorio: { nome: e.nome, advogado: e.advogado_responsavel, logo_base64: e.logo_base64, logo_arquivo: e.logo_arquivo } });
    } catch (err) {
        logger.error({ err: err.message }, '[Portal] GET /escritorio/:slug erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// POST /api/portal/solicitar-acesso  (público, rate-limited)
// Recebe { cpf, escritorio_slug } → envia e-mail com magic link se CPF cadastrado
router.post('/solicitar-acesso', solicitarAcessoLimiter, async (req, res) => {
    // Resposta genérica — não revela se o CPF existe ou não
    const RESP_GENERICA = { ok: true, mensagem: 'Se o CPF estiver cadastrado, você receberá um e-mail com o link de acesso em breve.' };

    const { cpf, escritorio_slug } = req.body;
    if (!cpf || !escritorio_slug) {
        return res.status(400).json({ ok: false, erro: 'Dados incompletos.' });
    }

    // Normaliza CPF: remove tudo que não é dígito
    const cpfLimpo = String(cpf).replace(/\D/g, '');
    if (cpfLimpo.length < 11) return res.json(RESP_GENERICA);

    try {
        const escResult = await pool.query(
            'SELECT id, nome FROM escritorios WHERE portal_slug = $1',
            [escritorio_slug.toLowerCase().trim()]
        );
        if (escResult.rows.length === 0) return res.json(RESP_GENERICA);
        const escritorio = escResult.rows[0];

        // Busca cliente pelo documento (CPF/CNPJ) dentro do escritório
        const clienteResult = await pool.query(
            `SELECT id, nome, email FROM clientes
             WHERE escritorio_id = $1 AND REGEXP_REPLACE(documento, '[^0-9]', '', 'g') = $2
             LIMIT 1`,
            [escritorio.id, cpfLimpo]
        );

        if (clienteResult.rows.length === 0) {
            logger.info({ escritorio_id: escritorio.id }, '[Portal] Solicitação de acesso: CPF não encontrado');
            return res.json(RESP_GENERICA);
        }

        const cliente = clienteResult.rows[0];

        if (!cliente.email) {
            logger.info({ cliente_id: cliente.id }, '[Portal] Solicitação de acesso: cliente sem e-mail cadastrado');
            return res.json(RESP_GENERICA);
        }

        // Gera/renova o token do portal (90 dias)
        const novoToken = crypto.randomBytes(32).toString('hex');
        await pool.query(
            `UPDATE clientes
             SET portal_token = $1, portal_token_expira_em = NOW() + INTERVAL '90 days'
             WHERE id = $2`,
            [novoToken, cliente.id]
        );

        const baseUrl = process.env.BASE_URL || 'https://www.lawtechpro.com.br';
        const linkPortal = `${baseUrl}/portal-cliente?token=${novoToken}`;

        // Envia e-mail com o link
        await enviarEmail({
            para: cliente.email,
            assunto: `Acesso ao seu portal — ${escritorio.nome}`,
            html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafb;">
  <div style="background:#1E3A5F;padding:32px 24px;text-align:center;border-radius:12px 12px 0 0;">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">${escritorio.nome}</h1>
    <p style="color:#93c5fd;margin:8px 0 0;font-size:14px;">Portal do Cliente</p>
  </div>
  <div style="background:#fff;padding:32px 28px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;border-top:none;">
    <p style="font-size:16px;color:#1e293b;margin:0 0 8px;">Olá, <strong>${cliente.nome}</strong>!</p>
    <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px;">
      Você solicitou acesso ao seu portal de acompanhamento processual.<br>
      Clique no botão abaixo para acessar seus processos:
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${linkPortal}"
         style="display:inline-block;background:#1E3A5F;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.3px;">
        Acessar meu Portal
      </a>
    </div>
    <p style="font-size:12px;color:#94a3b8;margin:24px 0 0;text-align:center;">
      Este link é válido por <strong>90 dias</strong> e é pessoal — não compartilhe.<br>
      Se você não solicitou este acesso, ignore este e-mail.
    </p>
  </div>
  <p style="font-size:11px;color:#cbd5e1;text-align:center;margin:16px 0 0;">
    Enviado por <a href="https://www.lawtechpro.com.br" style="color:#93c5fd;">LawTech Pro</a>
  </p>
</div>`
        });

        logger.info({ cliente_id: cliente.id, escritorio_id: escritorio.id }, '[Portal] Link de acesso enviado por e-mail');
        return res.json(RESP_GENERICA);

    } catch (err) {
        logger.error({ err: err.message }, '[Portal] POST /solicitar-acesso erro');
        return res.json(RESP_GENERICA); // ainda genérico mesmo em erro
    }
});

// GET /api/portal/autenticar?token=xxx  (público)
router.get('/autenticar', portalAuthLimiter, async (req, res) => {
    const { token } = req.query;

    if (!token || token.length !== 64) {
        return res.status(400).json({ ok: false, erro: 'Token inválido.' });
    }

    try {
        const result = await pool.query(
            `SELECT id, nome, email, escritorio_id, portal_token_expira_em
             FROM clientes
             WHERE portal_token = $1`,
            [token]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ ok: false, erro: 'Link inválido ou expirado. Solicite um novo ao seu advogado.' });
        }

        const cliente = result.rows[0];

        if (!cliente.portal_token_expira_em || new Date(cliente.portal_token_expira_em) < new Date()) {
            return res.status(401).json({ ok: false, erro: 'Link expirado. Solicite um novo ao seu advogado.' });
        }

        const escritorioResult = await pool.query(
            'SELECT nome, advogado_responsavel, logo_arquivo, logo_base64 FROM escritorios WHERE id = $1',
            [cliente.escritorio_id]
        );
        const escritorio = escritorioResult.rows[0] || {};

        const portalToken = jwtSign(
            { cliente_id: cliente.id, escritorio_id: cliente.escritorio_id, scope: 'portal_cliente' },
            { expiresIn: '7d' }
        );

        res.json({
            ok: true,
            token: portalToken,
            nome: cliente.nome,
            escritorio: {
                nome: escritorio.nome || '',
                advogado: escritorio.advogado_responsavel || '',
                logo_arquivo: escritorio.logo_arquivo || null,
                logo_base64: escritorio.logo_base64 || null
            }
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Portal] GET /autenticar erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// POST /api/portal/gerar-token  (advogado autenticado)
router.post('/gerar-token', authMiddleware, async (req, res) => {
    const { cliente_id } = req.body;
    const escritorio_id = req.user.escritorio_id;

    if (!cliente_id) {
        return res.status(400).json({ ok: false, erro: 'cliente_id é obrigatório.' });
    }

    try {
        const check = await pool.query(
            'SELECT id FROM clientes WHERE id = $1 AND escritorio_id = $2',
            [cliente_id, escritorio_id]
        );

        if (check.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Cliente não encontrado.' });
        }

        const novoToken = crypto.randomBytes(32).toString('hex'); // 64 chars

        await pool.query(
            `UPDATE clientes
             SET portal_token = $1, portal_token_expira_em = NOW() + INTERVAL '90 days'
             WHERE id = $2`,
            [novoToken, cliente_id]
        );

        res.json({
            ok: true,
            token: novoToken,
            url: '/portal-cliente?token=' + novoToken
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Portal] POST /gerar-token erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// GET /api/portal/meus-processos  (portal JWT)
router.get('/meus-processos', portalMiddleware, async (req, res) => {
    const cliente_id = req.cliente.id;
    const escritorio_id = req.cliente.escritorio_id;

    try {
        const result = await pool.query(
            `SELECT DISTINCT ON (p.id)
                p.id, p.numero, p.tribunal, p.esfera, p.instancia, p.status, p.uf,
                (
                    SELECT string_agg(pp2.pessoa_nome, ' · ' ORDER BY pp2.eh_principal DESC, pp2.id ASC)
                    FROM partes_processo pp2
                    WHERE pp2.processo_id = p.id
                      AND pp2.polo = 'ativo'
                      AND pp2.escritorio_id = $2
                ) AS polo_ativo,
                (
                    SELECT string_agg(pp2.pessoa_nome, ' · ' ORDER BY pp2.eh_principal DESC, pp2.id ASC)
                    FROM partes_processo pp2
                    WHERE pp2.processo_id = p.id
                      AND pp2.polo = 'passivo'
                      AND pp2.escritorio_id = $2
                ) AS polo_passivo
             FROM processos p
             JOIN partes_processo pp ON pp.processo_id = p.id
             WHERE pp.pessoa_id = $1
               AND p.escritorio_id = $2
               AND p.status != 'excluido'
             ORDER BY p.id DESC`,
            [cliente_id, escritorio_id]
        );

        res.json({ ok: true, processos: result.rows });
    } catch (err) {
        logger.error({ err: err.message }, '[Portal] GET /meus-processos erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// GET /api/portal/processos/:id/andamentos  (portal JWT)
router.get('/processos/:id/andamentos', portalMiddleware, async (req, res) => {
    const { id } = req.params;
    const cliente_id = req.cliente.id;
    const escritorio_id = req.cliente.escritorio_id;

    try {
        // Verifica que o cliente tem acesso a esse processo
        const acesso = await pool.query(
            `SELECT 1 FROM processos p
             JOIN partes_processo pp ON pp.processo_id = p.id
             WHERE p.id = $1 AND p.escritorio_id = $2 AND pp.pessoa_id = $3
             LIMIT 1`,
            [id, escritorio_id, cliente_id]
        );

        if (acesso.rows.length === 0) {
            return res.status(403).json({ ok: false, erro: 'Acesso negado a este processo.' });
        }

        const result = await pool.query(
            `SELECT id, data_andamento, tipo, titulo, descricao, criado_em
             FROM andamentos_processuais
             WHERE processo_id = $1
               AND escritorio_id = $2
               AND visivel_cliente = true
             ORDER BY data_andamento DESC, criado_em DESC`,
            [id, escritorio_id]
        );

        res.json({ ok: true, andamentos: result.rows });
    } catch (err) {
        logger.error({ err: err.message }, '[Portal] GET /processos/:id/andamentos erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// GET /api/portal/reunioes  (portal JWT)
router.get('/reunioes', portalMiddleware, async (req, res) => {
    const cliente_id = req.cliente.id;
    const escritorio_id = req.cliente.escritorio_id;

    try {
        const result = await pool.query(
            `SELECT id, titulo, descricao, data_hora, duracao_minutos, status
             FROM reunioes
             WHERE cliente_id = $1
               AND escritorio_id = $2
               AND status != 'cancelada'
             ORDER BY data_hora DESC`,
            [cliente_id, escritorio_id]
        );

        res.json({ ok: true, reunioes: result.rows });
    } catch (err) {
        logger.error({ err: err.message }, '[Portal] GET /reunioes erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

// GET /api/portal/reunioes/:id/token  (portal JWT)
// Retorna a URL da sala Jitsi — sem tokens, sem API key
router.get('/reunioes/:id/token', portalMiddleware, async (req, res) => {
    const { id } = req.params;
    const cliente_id = req.cliente.id;
    const escritorio_id = req.cliente.escritorio_id;

    try {
        const result = await pool.query(
            `SELECT id, titulo, data_hora, daily_room_url, status, peer_host_id FROM reunioes
             WHERE id = $1 AND cliente_id = $2 AND escritorio_id = $3`,
            [id, cliente_id, escritorio_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ ok: false, erro: 'Reunião não encontrada.' });
        }

        const reuniao = result.rows[0];

        if (reuniao.status === 'cancelada') {
            return res.status(400).json({ ok: false, erro: 'Esta reunião foi cancelada.' });
        }

        res.json({
            ok: true,
            room_url: reuniao.daily_room_url,
            peer_host_id: reuniao.peer_host_id || null,
            titulo: reuniao.titulo,
            data_hora: reuniao.data_hora
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Portal] GET /reunioes/:id/token erro');
        res.status(500).json({ ok: false, erro: 'Erro ao obter URL da sala.' });
    }
});

module.exports = router;
