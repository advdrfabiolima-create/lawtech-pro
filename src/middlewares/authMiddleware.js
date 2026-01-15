const jwt = require('jsonwebtoken');
const pool = require('../config/db');

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Token não informado' });
  }

  const [, token] = authHeader.split(' ');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      `
      SELECT 
        id,
        email,
        role,
        escritorio_id
      FROM usuarios
      WHERE id = $1
      `,
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    // 🔑 USUÁRIO COMPLETO DISPONÍVEL NO BACKEND
    req.user = result.rows[0];

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};
