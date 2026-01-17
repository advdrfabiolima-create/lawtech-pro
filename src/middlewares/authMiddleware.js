const jwt = require('jsonwebtoken');
const pool = require('../config/db');

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Token não informado' });
  }

  const [, token] = authHeader.split(' ');

  try {
    // 1. Verifica se o Token é válido usando a chave secreta
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 2. Busca o usuário e o status financeiro do escritório associado
    const result = await pool.query(
      `
      SELECT 
        u.id,
        u.email,
        u.escritorio_id,
        e.plano_financeiro_status
      FROM usuarios u
      JOIN escritorios e ON u.escritorio_id = e.id
      WHERE u.id = $1
      `,
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const usuario = result.rows[0];

    // 🔑 EXCEÇÃO PARA SUPORTE TÉCNICO: Acesso total garantido
    const emailsSuporte = ['admin@lawtechpro.com.br'];
    
    if (emailsSuporte.includes(usuario.email)) {
      req.user = usuario;
      return next(); 
    }

    // 🛡️ TRAVA DE PAGAMENTO EM PRODUÇÃO
    // Se o modo desenvolvedor estiver desativado e o pagamento não estiver aprovado
    if (process.env.MODO_DESENVOLVEDOR === 'false') {
      if (usuario.plano_financeiro_status !== 'aprovado') {
        return res.status(402).json({ 
          error: "Pagamento Pendente",
          message: "Seu acesso está restrito. Regularize sua assinatura no menu financeiro." 
        });
      }
    }

    // 🔑 Usuário liberado e disponível para o restante do sistema
    req.user = usuario;
    next();

  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};