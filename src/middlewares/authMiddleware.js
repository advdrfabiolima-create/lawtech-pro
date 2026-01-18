const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Certifique-se de que começa exatamente assim:
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Token não informado' });
  }

  const [, token] = authHeader.split(' ');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      `SELECT u.id, u.email, u.role, u.escritorio_id, e.plano_financeiro_status
       FROM usuarios u
       JOIN escritorios e ON u.escritorio_id = e.id
       WHERE u.id = $1`,
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// ESSA LINHA É VITAL:
module.exports = authMiddleware;