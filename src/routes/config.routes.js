const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');

router.put('/config/escritorio', authMiddleware, async (req, res) => {
    const { 
        nome, oab, documento, dataNascimento, email, endereco, 
        cidade, estado, cep, banco_codigo, agencia, conta, conta_digito, pix_chave, renda_mensal 
    } = req.body;
    
    const escritorioId = req.user.escritorio_id;

    try {
        // Tratamento da renda para garantir que o banco receba um número válido
        const rendaTratada = (renda_mensal && renda_mensal !== '') ? parseFloat(renda_mensal) : 0;
        
        const query = `
            UPDATE escritorios SET 
                nome = $1, oab = $2, documento = $3, data_nascimento = $4, 
                email = $5, endereco = $6, cidade = $7, estado = $8, cep = $9, 
                banco_codigo = $10, agencia = $11, conta = $12, 
                conta_digito = $13, pix_chave = $14, renda_mensal = $15
            WHERE id = $16
        `;

        const values = [
            nome, oab, documento, dataNascimento || null, 
            email, endereco, cidade, estado, cep, 
            banco_codigo, agencia, conta, conta_digito, 
            pix_chave, rendaTratada, escritorioId
        ];

        await pool.query(query, values);
        res.json({ ok: true, mensagem: 'Configurações salvas com sucesso!' });
    } catch (err) {
        console.error("❌ ERRO SQL NO SALVAMENTO:", err.message);
        res.status(500).json({ erro: 'Erro ao salvar no banco local: ' + err.message });
    }
});

module.exports = router;