const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');

// ============================================================
// ROTA 1: SALVAR/ATUALIZAR DADOS DO ESCRITÓRIO (PUT)
// ============================================================
router.put('/escritorio', authMiddleware, async (req, res) => {
    const { 
        nome, advogado_responsavel, oab, documento, dataNascimento, email, endereco, 
        cidade, estado, cep, banco_codigo, agencia, conta, conta_digito, pix_chave, renda_mensal 
    } = req.body;
    
    const escritorioId = req.user.escritorio_id;

    try {
        // Limpeza da OAB para o robô nacional
        const oabLimpa = oab ? oab.replace(/\D/g, '') : null;
        
        // Tratamento da Renda
        const rendaTratada = (renda_mensal && renda_mensal !== '') ? parseFloat(renda_mensal) : 0;
        
        const query = `
            UPDATE escritorios SET 
                nome = $1, 
                advogado_responsavel = $2, 
                oab = $3, 
                documento = $4, 
                data_nascimento = $5, 
                email = $6, 
                endereco = $7, 
                cidade = $8, 
                estado = $9, 
                cep = $10, 
                banco_codigo = $11, 
                agencia = $12, 
                conta = $13, 
                conta_digito = $14, 
                pix_chave = $15, 
                renda_mensal = $16,
                plano_financeiro_status = 'ativo',
                uf = $9
            WHERE id = $17
        `;

        const values = [
            nome || null, 
            advogado_responsavel || '', 
            oabLimpa, 
            documento || null, 
            dataNascimento || null, 
            email || null, 
            endereco || null, 
            cidade || null, 
            estado ? estado.toUpperCase() : 'BA', 
            cep || null, 
            banco_codigo || null, 
            agencia || null, 
            conta || null, 
            conta_digito || null, 
            pix_chave || null, 
            rendaTratada, 
            escritorioId
        ];

        await pool.query(query, values);
        res.json({ ok: true, mensagem: 'Configurações salvas e Monitoramento Premium ativado!' });
    } catch (err) {
        console.error("❌ ERRO SQL NO SALVAMENTO:", err.message);
        res.status(500).json({ erro: 'Erro ao salvar no banco Neon: ' + err.message });
    }
});

// ============================================================
// ROTA 2: BUSCAR DADOS DO ESCRITÓRIO (GET)
// ============================================================
router.get('/meu-escritorio', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        
        const query = "SELECT * FROM escritorios WHERE id = $1";
        const resultado = await pool.query(query, [escritorioId]);

        if (resultado.rowCount > 0) {
            // Retorna os dados para preencher o config.html automaticamente
            res.json({ ok: true, dados: resultado.rows[0] });
        } else {
            res.json({ ok: false, mensagem: "Escritório não encontrado." });
        }
    } catch (err) {
        console.error("❌ ERRO AO BUSCAR DADOS:", err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
});

module.exports = router;