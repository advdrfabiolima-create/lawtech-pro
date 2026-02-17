const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET não configurado. Defina a variável de ambiente JWT_SECRET antes de iniciar o servidor.');
  }
  if (secret.length < 32) {
    console.warn('⚠️ JWT_SECRET muito curto (mín. 32 caracteres). Gere uma chave forte com: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  }
  return secret;
}

module.exports = {
  getJwtSecret,
  sign: (payload, options = { expiresIn: '2h' }) => {
    return jwt.sign(payload, getJwtSecret(), options);
  },
  verify: (token) => {
    return jwt.verify(token, getJwtSecret());
  }
};
