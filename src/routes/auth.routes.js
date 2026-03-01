/**
 * auth.routes.js — Barrel
 * Agrega todos os sub-módulos de autenticação.
 */
const express = require('express');
const router = express.Router();

router.use(require('./auth/registro.routes'));
router.use(require('./auth/login.routes'));
router.use(require('./auth/senha.routes'));
router.use(require('./auth/pagamento.routes'));
router.use(require('./auth/2fa.routes'));

module.exports = router;
