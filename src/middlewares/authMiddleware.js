const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Token não informado' });
  }

  const [, token] = authHeader.split(' ');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'segredo_temporario');

    const result = await pool.query(
      `SELECT u.id, u.nome, u.email, u.role, u.escritorio_id, 
              e.plano_financeiro_status, e.plano_id, e.trial_expira_em,
              CASE 
                WHEN e.trial_expira_em IS NOT NULL 
                THEN (e.trial_expira_em::date - CURRENT_DATE)
                ELSE 7
              END as dias_restantes
       FROM usuarios u
       JOIN escritorios e ON u.escritorio_id = e.id
       WHERE u.id = $1`,
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const usuario = result.rows[0];
    const diasRestantes = parseInt(usuario.dias_restantes);
    
    // 🛡️ REGRA DE IMUNIDADE MASTER: Dr. Fábio nunca é bloqueado
    const ehMaster = usuario.email === 'adv.limaesilva@hotmail.com';

    // 🚨 REGRA DE BLOQUEIO (Apenas para clientes comuns)
    if (!ehMaster && diasRestantes <= 0 && usuario.plano_financeiro_status !== 'pago') {
      console.log(`!!! [BLOQUEIO ATIVADO] Trial Expirado para: ${usuario.email} !!!`);
      return res.status(402).json({ error: 'Trial expirado' });
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
        eh_master: ehMaster
    };

    next();
  } catch (err) {
    console.error('Erro no authMiddleware:', err.message);
    return res.status(401).json({ error: 'Token inválido' });
  }
};

module.exports = authMiddleware;