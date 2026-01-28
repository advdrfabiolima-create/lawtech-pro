const pool = require('../config/db');

/**
 * LawTech Systems - Painel de Diagnóstico
 * Retorna os logs de erro de todos os escritórios
 */
exports.getLogsSistema = async (req, res) => {
    try {
        // Busca logs e o nome do advogado responsável
        const result = await pool.query(`
            SELECT 
                l.id, 
                l.servico, 
                l.tipo_erro, 
                l.mensagem_erro, 
                l.criado_em,
                e.advogado_responsavel,
                e.oab,
                e.uf
            FROM logs_sistema l
            JOIN escritorios e ON l.escritorio_id = e.id
            ORDER BY l.criado_em DESC
            LIMIT 50
        `);

        res.json({
            ok: true,
            total: result.rowCount,
            logs: result.rows
        });
    } catch (err) {
        console.error('Erro no LawTech Systems:', err.message);
        res.status(500).json({ error: 'Erro ao carregar logs administrativos' });
    }
};