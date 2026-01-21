const pool = require('../config/db');

async function salvarCalculo(req, res) {
    try {
        const { processo, credor, devedor, total, memoria } = req.body;
        const usuarioId = req.user.id;

        // Query alinhada com as colunas que acabamos de criar no Neon
        const query = `
            INSERT INTO historico_calculos 
            (processo_numero, parte_credora, parte_devedora, total_devido, memoria_calculo, usuario_id, data_calculo)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING *
        `;

        const values = [processo, credor, devedor, total, memoria, usuarioId];
        const result = await pool.query(query, values);

        res.status(201).json({ ok: true, calculo: result.rows[0] });
    } catch (err) {
        console.error("Erro ao salvar cálculo:", err.message);
        res.status(500).json({ erro: "Erro interno: " + err.message });
    }
}

/**
 * LISTAR HISTÓRICO RECENTE
 */
async function listarHistorico(req, res) {
    try {
        const result = await pool.query(
            "SELECT * FROM historico_calculos WHERE usuario_id = $1 ORDER BY data_calculo DESC LIMIT 10",
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
}

// Adicionar ao final do calculosController.js
async function excluirCalculo(req, res) {
    try {
        const { id } = req.params;
        const usuarioId = req.user.id;

        const result = await pool.query(
            "DELETE FROM historico_calculos WHERE id = $1 AND usuario_id = $2",
            [id, usuarioId]
        );

        if (result.rowCount > 0) {
            res.json({ ok: true, mensagem: "Cálculo excluído com sucesso." });
        } else {
            res.status(404).json({ erro: "Cálculo não encontrado ou sem permissão." });
        }
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
}

// Não esqueça de exportar a nova função:
module.exports = { salvarCalculo, listarHistorico, excluirCalculo };
