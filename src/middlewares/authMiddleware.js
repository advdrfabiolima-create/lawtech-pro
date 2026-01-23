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

    // 🛡️ BUSCA USUÁRIO E O TEMPO DE TRIAL
    const result = await pool.query(
      `SELECT u.id, u.nome, u.email, u.role, u.escritorio_id, 
              e.plano_financeiro_status, e.plano_id,
              EXTRACT(DAY FROM (NOW() - e.criado_em)) as dias_passados
       FROM usuarios u
       JOIN escritorios e ON u.escritorio_id = e.id
       WHERE u.id = $1`,
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const usuario = result.rows[0];
    const dias = parseInt(usuario.dias_passados);
    const diasRestantes = 7 - dias;

    console.log(`--- VIGILÂNCIA: ${usuario.email} | Dias Usados: ${dias} | Faltam: ${diasRestantes} ---`);

    // 🚨 1. REGRA DE BLOQUEIO (7 dias ou mais)
    // Se quiser testar o bloqueio agora, deixe como está.
    // Se quiser testar o AVISO, mude a data no banco para 5 dias atrás.
    if (dias >= 7) {
      console.log("!!! [BLOQUEIO ATIVADO] -> ENVIANDO ERRO 402 !!!");
      return res.status(402).json({ error: 'Trial expirado' });
    }

    // ✅ 2. ANEXA OS DADOS PARA O DASHBOARD
    // Enviamos 'dias_restantes' para o frontend conseguir mostrar o alerta amarelo
    req.user = {
        ...usuario,
        dias_restantes: diasRestantes
    };

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

module.exports = authMiddleware;