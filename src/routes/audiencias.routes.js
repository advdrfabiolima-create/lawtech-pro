const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');

// Listar audiências com dados do processo e cliente
router.get('/audiencias', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.*, p.numero as processo_numero, c.nome as cliente, c.telefone -- AGORA BUSCA O TELEFONE
            FROM audiencias a
            JOIN processos p ON a.processo_id = p.id
            JOIN clientes c ON p.cliente = c.nome -- FAZ O VÍNCULO COM O CLIENTE
            WHERE a.usuario_id = $1
            ORDER BY a.data_audiencia ASC`, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cadastrar nova audiência
// Cadastrar nova audiência - VERSÃO CORRIGIDA MASTER
router.post('/audiencias', authMiddleware, async (req, res) => {
    const { processo_id, tipo_audiencia, data_audiencia, hora_audiencia, local_virtual } = req.body;
    try {
        await pool.query(
            `INSERT INTO audiencias (usuario_id, processo_id, tipo_audiencia, data_audiencia, hora_audiencia, local_virtual)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [req.user.id, processo_id, tipo_audiencia, data_audiencia, hora_audiencia, local_virtual]
        );
        res.status(201).json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// Rota para EXCLUIR audiência
router.delete('/audiencias/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const escritorioId = req.user.escritorio_id;

    try {
        // Agora deletamos garantindo que a audiência pertence a um processo do escritório do usuário
        const result = await pool.query(
            `DELETE FROM audiencias 
             WHERE id = $1 
             AND processo_id IN (SELECT id FROM processos WHERE escritorio_id = $2)`, 
            [id, escritorioId]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ erro: 'Audiência não encontrada ou você não tem permissão para excluí-la.' });
        }

        res.json({ mensagem: 'Audiência excluída com sucesso!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao excluir audiência no banco de dados' });
    }
});
module.exports = router;