const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');

// Listar audiências com dados do processo e cliente - CORRIGIDO
router.get('/audiencias', authMiddleware, async (req, res) => {
    try {
        console.log('🔍 [GET AUDIENCIAS] Buscando para usuario_id:', req.user.id);
        
        const result = await pool.query(`
            SELECT a.*, 
                   p.numero as processo_numero, 
                   COALESCE(c.nome, p.cliente) as cliente, 
                   c.telefone, 
                   a.ata_audiencia
            FROM audiencias a
            JOIN processos p ON a.processo_id = p.id
            LEFT JOIN clientes c ON p.cliente_id = c.id
            WHERE a.usuario_id = $1
            ORDER BY a.data_audiencia ASC`, [req.user.id]);
        
        console.log('📊 [GET AUDIENCIAS] Total encontrado:', result.rows.length);
        console.log('📋 [GET AUDIENCIAS] IDs:', result.rows.map(r => r.id));
        res.json(result.rows);
    } catch (err) {
        console.error('❌ [GET AUDIENCIAS] Erro:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Cadastrar nova audiência
router.post('/audiencias', authMiddleware, async (req, res) => {
    const { processo_id, tipo_audiencia, data_audiencia, hora_audiencia, local_virtual } = req.body;
    
    console.log('📝 [POST AUDIENCIA] Criando:', { processo_id, tipo_audiencia, data_audiencia });
    
    try {
        const result = await pool.query(
            `INSERT INTO audiencias (usuario_id, processo_id, tipo_audiencia, data_audiencia, hora_audiencia, local_virtual)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [req.user.id, processo_id, tipo_audiencia, data_audiencia, hora_audiencia, local_virtual]
        );
        
        console.log('✅ [POST AUDIENCIA] Criada com ID:', result.rows[0].id);
        res.status(201).json({ ok: true, audiencia: result.rows[0] });
    } catch (err) {
        console.error('❌ [POST AUDIENCIA] Erro:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Excluir audiência
router.delete('/audiencias/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const escritorioId = req.user.escritorio_id;

    try {
        const result = await pool.query(
            `DELETE FROM audiencias 
             WHERE id = $1 
             AND processo_id IN (SELECT id FROM processos WHERE escritorio_id = $2)`, 
            [id, escritorioId]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ erro: 'Audiência não encontrada.' });
        }

        res.json({ mensagem: 'Audiência excluída!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao excluir audiência' });
    }
});

// Registrar ATA
router.put('/audiencias/:id/ata', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { ata_audiencia } = req.body;
    
    try {
        await pool.query(
            `UPDATE audiencias 
             SET ata_audiencia = $1, updated_at = NOW()
             WHERE id = $2 AND usuario_id = $3`,
            [ata_audiencia, id, req.user.id]
        );
        res.json({ ok: true, mensagem: 'ATA registrada!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Marcar como realizada
router.put('/audiencias/:id/realizada', authMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `UPDATE audiencias
             SET realizada = true
             WHERE id = $1 AND usuario_id = $2`,
            [id, req.user.id]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ erro: 'Audiência não encontrada' });
        }

        res.json({ ok: true, mensagem: 'Marcada como realizada' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao atualizar' });
    }
});

module.exports = router;