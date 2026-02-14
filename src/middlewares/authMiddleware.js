const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const authMiddleware = async (req, res, next) => {
  console.log('🔐 [AUTH] Middleware chamado:', req.method, req.originalUrl);
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Token não informado' });
  }

  const [, token] = authHeader.split(' ');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'segredo_temporario');

    const result = await pool.query(
      `SELECT u.id, u.nome, u.email, u.role, u.escritorio_id, 
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
    let diasRestantes = 7; // padrão se não houver data

    if (usuario.trial_expira_em) {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const expiracao = new Date(usuario.trial_expira_em);
      expiracao.setHours(0, 0, 0, 0);
      const diffMs = expiracao - hoje;
      diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }

    // 🛡️ REGRA DE IMUNIDADE MASTER
    const ehMaster = usuario.email === 'adv.limaesilva@hotmail.com';

    console.log('📊 [AUTH] Dados do usuário:', {
      email: usuario.email,
      dias_restantes: diasRestantes,
      status: usuario.plano_financeiro_status,
      trial_expira_em: usuario.trial_expira_em,
      eh_master: ehMaster
    });

    // 🚨 REGRA DE BLOQUEIO
    if (!ehMaster && diasRestantes <= 0 && usuario.plano_financeiro_status !== 'pago') {
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

    console.log('✅ [AUTH] Usuário autenticado:', req.user.email);
    console.log('   Dias restantes:', req.user.dias_restantes);
    next();

  } catch (err) {
    console.error('❌ [AUTH] Erro:', err.message);
    return res.status(401).json({ error: 'Token inválido' });
  }
};

module.exports = authMiddleware;