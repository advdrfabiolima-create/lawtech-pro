const jwt = require('jsonwebtoken');

module.exports = (payload) => {
  return jwt.sign(
    payload,
    process.env.JWT_SECRET || 'segredo_temporario',
    { expiresIn: '1d' }
  );
};

const token = jwt.sign(
  {
    id: usuario.id,
    email: usuario.email,
    role: usuario.role
  },
  process.env.JWT_SECRET,
  { expiresIn: '1d' }
);
