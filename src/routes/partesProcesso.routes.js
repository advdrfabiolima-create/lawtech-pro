const express = require('express');
const router = express.Router();
const partesProcessoController = require('../controllers/partesProcessoController');
const authMiddleware = require('../middlewares/authMiddleware');

/**
 * ROTAS: Partes do Processo
 * Gerenciamento de múltiplas partes (autores, réus, litisconsortes)
 */

// Listar todas as partes de um processo
router.get(
    '/processos/:processoId/partes',
    authMiddleware,
    partesProcessoController.listarPartesPorProcesso
);

// Adicionar uma nova parte ao processo
router.post(
    '/processos/:processoId/partes',
    authMiddleware,
    partesProcessoController.adicionarParte
);

// Adicionar múltiplas partes de uma vez
router.post(
    '/processos/:processoId/partes/multiplas',
    authMiddleware,
    partesProcessoController.adicionarMultiplasPartes
);

// Atualizar dados de uma parte
router.put(
    '/partes/:parteId',
    authMiddleware,
    partesProcessoController.atualizarParte
);

// Definir parte como principal
router.patch(
    '/partes/:parteId/principal',
    authMiddleware,
    partesProcessoController.definirPartePrincipal
);

// Remover uma parte do processo
router.delete(
    '/partes/:parteId',
    authMiddleware,
    partesProcessoController.removerParte
);

module.exports = router;