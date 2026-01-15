const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');


// 🔓 LOGIN (público)
router.post('/login', authController.login);

// 🔐 REGISTER (somente ADMIN)
router.post(
  '/register',
  authMiddleware,
  roleMiddleware('admin'),
  authController.register
);

router.post('/alterar-senha', authMiddleware, authController.alterarSenha);

router.get('/me', authMiddleware, (req, res) => res.json({ ok: true, usuario: req.user }));

module.exports = router;