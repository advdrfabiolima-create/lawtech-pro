const pool = require('../config/db');

async function salvarCalculo(req, res) {
    try {
        const { processo, credor, devedor, dataFinal, total, detalhes } = req.body;
        const escritorioId = req.user.escritorio_id;
        const usuarioId = req.user.id;

        const query = `
            INSERT INTO historico_calculos 
            (escritorio_id, usuario_id, processo_numero, credor, devedor, data_final, total_devido, detalhes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
        `;

        const values = [escritorioId, usuarioId, processo, credor, devedor, dataFinal, total, JSON.stringify(detalhes)];
        const result = await pool.query(query, values);

        res.status(201).json({ ok: true, id: result.rows[0].id });
    } catch (error) {
        console.error('Erro ao salvar cálculo:', error);
        res.status(500).json({ erro: 'Erro ao salvar histórico' });
    }
}

async function listarHistorico(req, res) {
    try {
        const escritorioId = req.user.escritorio_id;
        const query = `
            SELECT * FROM historico_calculos 
            WHERE escritorio_id = $1 
            ORDER BY criado_em DESC
        `;
        const result = await pool.query(query, [escritorioId]);
        res.json(result.rows || []);
    } catch (error) {
        console.error('Erro ao listar histórico:', error);
        res.status(500).json({ erro: 'Erro ao buscar histórico' });
    }
}

module.exports = { 
    salvarCalculo, 
    listarHistorico 
};