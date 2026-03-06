module.exports = (...rolesPermitidos) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({ ok: false, erro: 'Perfil não identificado' });
    }

    if (!rolesPermitidos.includes(req.user.role)) {
      return res.status(403).json({ ok: false, erro: 'Acesso negado' });
    }

    next();
  };
};
