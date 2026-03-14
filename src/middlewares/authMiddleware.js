const { verify: jwtVerify } = require('../config/jwt');
const pool = require('../config/db');
const logger = require('../utils/logger');
const cache = require('../utils/cache');
const crypto = require('crypto');

let Sentry = null;
try { Sentry = require('@sentry/node'); } catch (_) {}

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ ok: false, erro: 'Token não informado' });
  }

  const [, token] = authHeader.split(' ');

  try {
    const decoded = jwtVerify(token);

    // ─── Blacklist: token revogado via logout ─────────────────────────────────
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
    const blacklisted = await cache.get(`jwt:blacklist:${tokenHash}`);
    if (blacklisted) {
      return res.status(401).json({ ok: false, erro: 'Token revogado. Faça login novamente.' });
    }

    if (decoded.scope === '2fa') {
      return res.status(401).json({ ok: false, erro: 'Token temporário. Complete a verificação 2FA.' });
    }

    if (decoded.scope === 'portal_cliente') {
      return res.status(401).json({ ok: false, erro: 'Token de portal não é válido para esta rota.' });
    }

    // ─── Redis cache lookup ───────────────────────────────────────────────────
    const cacheKey = `auth:user:${decoded.id}`;
    let usuario = await cache.get(cacheKey);

    if (!usuario) {
      const result = await pool.query(
        `SELECT u.id, u.nome, u.email, u.role, u.escritorio_id, u.is_master,
                u.email_verificado,
                e.plano_financeiro_status, e.plano_id, e.trial_expira_em
         FROM usuarios u
         JOIN escritorios e ON u.escritorio_id = e.id
         WHERE u.id = $1`,
        [decoded.id]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ ok: false, erro: 'Usuário não encontrado' });
      }

      usuario = result.rows[0];
      await cache.set(cacheKey, usuario, 60);
    }

    // ✅ CALCULAR DIAS RESTANTES CORRETAMENTE
    let diasRestantes = 0;

    if (usuario.trial_expira_em) {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const expiracao = new Date(usuario.trial_expira_em);
      expiracao.setHours(0, 0, 0, 0);
      const diffMs = expiracao - hoje;
      diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }

    // 🛡️ REGRA DE IMUNIDADE MASTER (via banco de dados)
    const ehMaster = usuario.is_master === true || usuario.email === process.env.MASTER_EMAIL;

    // 🚨 REGRA DE BLOQUEIO — grace period de 3 dias após expiração
    if (!ehMaster && diasRestantes < -3 && !['pago', 'ativo'].includes(usuario.plano_financeiro_status)) {
      logger.warn({ email: usuario.email, diasRestantes, status: usuario.plano_financeiro_status }, '[BLOQUEIO ATIVADO] Trial Expirado');
      return res.status(402).json({
        ok: false,
        erro: 'Trial expirado',
        dias_restantes: diasRestantes,
        trial_expira_em: usuario.trial_expira_em
      });
    }

    // 🔐 HARD-BLOCK: e-mail não verificado
    const rotasLiberadasVerificacao = ['/reenviar-verificacao', '/logout'];
    const rotaLiberada = rotasLiberadasVerificacao.some(r => req.originalUrl.includes(r));
    if (!ehMaster && !usuario.email_verificado && !rotaLiberada) {
      logger.warn({ email: usuario.email }, '[BLOQUEIO] E-mail não verificado');
      return res.status(403).json({
        ok: false,
        erro: 'email_nao_verificado',
        mensagem: 'Confirme seu e-mail para acessar o sistema. Verifique sua caixa de entrada.'
      });
    }

    // ✅ ANEXA OS DADOS PARA O DASHBOARD
    req.user = {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      role: usuario.role,
      escritorio_id: usuario.escritorio_id,
      plano_financeiro_status: usuario.plano_financeiro_status,
      plano_id: usuario.plano_id,
      dias_restantes: diasRestantes,
      trial_expira_em: usuario.trial_expira_em,
      eh_master: ehMaster,
      email_verificado: usuario.email_verificado || false
    };

    // 🔭 Sentry user context
    if (Sentry) {
      Sentry.setUser({ id: usuario.id, email: usuario.email, username: usuario.role });
    }

    next();

  } catch (err) {
    logger.error({ err: err.message }, '[AUTH] Erro');
    return res.status(401).json({ ok: false, erro: 'Token inválido' });
  }
};

module.exports = authMiddleware;