const jwt = require('jsonwebtoken');

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET não configurado. Defina a variável de ambiente JWT_SECRET antes de iniciar o servidor.');
  }
  return process.env.JWT_SECRET;
}

module.exports = {
  getJwtSecret,
  sign: (payload, options = { expiresIn: '7d' }) => {
    return jwt.sign(payload, getJwtSecret(), options);
  },
  verify: (token) => {
    return jwt.verify(token, getJwtSecret());
  }
};
