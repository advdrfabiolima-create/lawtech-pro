const { verify: jwtVerify } = require('../config/jwt');
const pool = require('../config/db');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Token não informado' });
  }

  const [, token] = authHeader.split(' ');

  try {
    const decoded = jwtVerify(token);

    const result = await pool.query(
      `SELECT u.id, u.nome, u.email, u.role, u.escritorio_id, u.is_master,
              e.plano_financeiro_status, e.plano_id, e.trial_expira_em
       FROM usuarios u
       JOIN escritorios e ON u.escritorio_id = e.id
       WHERE u.id = $1`,
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const usuario = result.rows[0];

    // ✅ CALCULAR DIAS RESTANTES CORRETAMENTE
    // Padrão 0: sem data de expiração + status trial = expirado imediatamente
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

    // 🚨 REGRA DE BLOQUEIO — sem tolerância/grace period
    if (!ehMaster && diasRestantes <= 0 && !['pago', 'ativo'].includes(usuario.plano_financeiro_status)) {
      console.log(`❌ [BLOQUEIO ATIVADO] Trial Expirado para: ${usuario.email}`);
      console.log(`   Dias restantes: ${diasRestantes}`);
      console.log(`   Status: ${usuario.plano_financeiro_status}`);
      console.log(`   Trial expira em: ${usuario.trial_expira_em}`);
      return res.status(402).json({ 
        error: 'Trial expirado',
        dias_restantes: diasRestantes,
        trial_expira_em: usuario.trial_expira_em
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
      eh_master: ehMaster
    };

    next();

  } catch (err) {
    console.error('❌ [AUTH] Erro:', err.message);
    return res.status(401).json({ error: 'Token inválido' });
  }
};

module.exports = authMiddleware;