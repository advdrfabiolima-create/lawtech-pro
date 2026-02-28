const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// ============================================================
// 🔧 CORRIGIDO: Listar audiências DO ESCRITÓRIO (não só do usuário)
// ============================================================
router.get('/audiencias', authMiddleware, async (req, res) => {
    try {
        console.log('🔍 [GET AUDIENCIAS] Buscando para escritorio_id:', req.user.escritorio_id);
        
        // ✅ MUDANÇA: Busca por escritorio_id em vez de usuario_id
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
        const result = await pool.query(`
            SELECT a.*,
                   p.numero as processo_numero,
                   COALESCE(c.nome, p.cliente) as cliente,
                   c.telefone,
                   a.ata_audiencia,
                   u.nome as cadastrado_por
            FROM audiencias a
            JOIN processos p ON a.processo_id = p.id
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN usuarios u ON a.usuario_id = u.id
            WHERE p.escritorio_id = $1
            ORDER BY a.data_audiencia ASC
            LIMIT $2`,
            [req.user.escritorio_id, limit]
        );
        
        console.log('📊 [GET AUDIENCIAS] Total encontrado:', result.rows.length);
        console.log('📋 [GET AUDIENCIAS] IDs:', result.rows.map(r => r.id));
        res.json(result.rows);
    } catch (err) {
        console.error('❌ [GET AUDIENCIAS] Erro:', err.message);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Cadastrar nova audiência
router.post('/audiencias', authMiddleware, roleMiddleware('admin', 'operador'), async (req, res) => {
    const { processo_id, tipo_audiencia, data_audiencia, hora_audiencia, local_virtual } = req.body;
    
    console.log('🔍 [POST AUDIENCIA] Criando:', { processo_id, tipo_audiencia, data_audiencia });
    
    try {
        // ✅ Mantém usuario_id para saber quem cadastrou
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
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// ============================================================
// 🔧 CORRIGIDO: Excluir audiência DO ESCRITÓRIO
// ============================================================
router.delete('/audiencias/:id', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    const { id } = req.params;
    const escritorioId = req.user.escritorio_id;

    try {
        // ✅ Verifica se a audiência pertence ao escritório do usuário
        const result = await pool.query(
            `DELETE FROM audiencias 
             WHERE id = $1 
             AND processo_id IN (SELECT id FROM processos WHERE escritorio_id = $2)`, 
            [id, escritorioId]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ erro: 'Audiência não encontrada ou sem permissão.' });
        }

        console.log(`✅ [DELETE AUDIENCIA] ID ${id} excluída do escritório ${escritorioId}`);
        res.json({ mensagem: 'Audiência excluída!' });
    } catch (err) {
        console.error('❌ [DELETE AUDIENCIA]:', err);
        res.status(500).json({ erro: 'Erro ao excluir audiência' });
    }
});

// ============================================================
// 🔧 CORRIGIDO: Registrar ATA (qualquer usuário do escritório)
// ============================================================
router.put('/audiencias/:id/ata', authMiddleware, roleMiddleware('admin', 'operador'), async (req, res) => {
    const { id } = req.params;
    const { ata_audiencia } = req.body;
    const escritorioId = req.user.escritorio_id;
    
    try {
        // ✅ Permite qualquer usuário do escritório editar a ATA
        const result = await pool.query(
            `UPDATE audiencias a
             SET ata_audiencia = $1, updated_at = NOW()
             FROM processos p
             WHERE a.id = $2 
             AND a.processo_id = p.id 
             AND p.escritorio_id = $3`,
            [ata_audiencia, id, escritorioId]
        );
        
        if (result.rowCount === 0) {
            return res.status(403).json({ erro: 'Audiência não encontrada.' });
        }
        
        console.log(`✅ [ATA] Registrada para audiência ${id} por usuário ${req.user.id}`);
        res.json({ ok: true, mensagem: 'ATA registrada!' });
    } catch (err) {
        console.error('❌ [ATA]:', err);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// ============================================================
// 🔧 CORRIGIDO: Marcar como realizada (qualquer usuário do escritório)
// ============================================================
router.put('/audiencias/:id/realizada', authMiddleware, roleMiddleware('admin', 'operador'), async (req, res) => {
    const { id } = req.params;
    const escritorioId = req.user.escritorio_id;

    try {
        // ✅ Permite qualquer usuário do escritório marcar como realizada
        const result = await pool.query(
            `UPDATE audiencias a
             SET realizada = true
             FROM processos p
             WHERE a.id = $1 
             AND a.processo_id = p.id 
             AND p.escritorio_id = $2`,
            [id, escritorioId]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ erro: 'Audiência não encontrada' });
        }

        console.log(`✅ [REALIZADA] Audiência ${id} marcada pelo usuário ${req.user.id}`);
        res.json({ ok: true, mensagem: 'Marcada como realizada' });
    } catch (err) {
        console.error('❌ [REALIZADA]:', err);
        res.status(500).json({ erro: 'Erro ao atualizar' });
    }
});

// Atualizar endereço/link virtual da audiência
router.patch('/audiencias/:id/local', authMiddleware, roleMiddleware('admin', 'operador'), async (req, res) => {
    const { id } = req.params;
    const { local_virtual } = req.body;
    const escritorioId = req.user.escritorio_id;

    try {
        const result = await pool.query(
            `UPDATE audiencias a
             SET local_virtual = $1
             FROM processos p
             WHERE a.id = $2
               AND a.processo_id = p.id
               AND p.escritorio_id = $3`,
            [local_virtual || null, id, escritorioId]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ erro: 'Audiência não encontrada.' });
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('❌ [PATCH LOCAL]:', err.message);
        res.status(500).json({ erro: 'Erro ao atualizar endereço.' });
    }
});

module.exports = router;