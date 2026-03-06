const express = require('express');
const router = express.Router();
const c = require('../controllers/documentosController');
const { checkFeature } = require('../middlewares/planMiddleware');

const temGed = checkFeature('ged');

// ── GET /documentos/modelos (DEVE vir antes de /:id) ──────────────────────────
router.get('/documentos/modelos',    c.roleAdminOp, temGed, (req, res) => { req.query.eh_modelo = 'true'; return c.listarDocumentos(req, res); });

// ── GET /documentos ───────────────────────────────────────────────────────────
router.get('/documentos',            c.roleAdminOp, temGed, c.listarDocumentos);

// ── POST /documentos ──────────────────────────────────────────────────────────
router.post('/documentos',           c.roleAdminOp, temGed, c.uploadMiddleware('arquivo'), c.criarDocumento);

// ── POST /documentos/:id/versao ───────────────────────────────────────────────
router.post('/documentos/:id/versao',c.roleAdminOp, temGed, c.uploadMiddleware('arquivo'), c.criarVersao);

// ── GET /documentos/:id/versoes ───────────────────────────────────────────────
router.get('/documentos/:id/versoes',c.roleAdminOp, temGed, c.listarVersoes);

// ── GET /documentos/:id/arquivo ───────────────────────────────────────────────
router.get('/documentos/:id/arquivo',c.roleAdminOp, temGed, c.servirArquivo);

// ── PATCH /documentos/:id ─────────────────────────────────────────────────────
router.patch('/documentos/:id',      c.roleAdminOp, temGed, c.editarDocumento);

// ── DELETE /documentos/:id ────────────────────────────────────────────────────
router.delete('/documentos/:id',     c.roleAdmin,   temGed, c.excluirDocumento);

module.exports = router;
