const express = require('express');
const router = express.Router();
const pool = require('../config/db');

console.log('[CRM PUBLIC] Rotas públicas carregadas');

router.post('/onboarding', async (req, res) => {
    try {
        const {
            leadId,
            nome,
            tipoPessoa,
            documento,
            email,
            telefone,
            nascimento,
            cep,
            cidade,
            uf,
            endereco
        } = req.body;

        // ✅ Validação mínima
        if (!leadId || !nome || !documento || !cidade || !uf || !telefone) {
            return res.status(400).json({ error: 'Dados obrigatórios ausentes' });
        }

        // 🔎 Buscar lead + escritorio_id
        const leadResult = await pool.query(
            `SELECT id, escritorio_id FROM leads WHERE id = $1`,
            [leadId]
        );

        if (leadResult.rowCount === 0) {
            return res.status(404).json({ error: 'Lead não encontrado' });
        }

        const { escritorio_id } = leadResult.rows[0];

        // 🧾 Texto de onboarding (para histórico do lead)
        const dadosOnboarding = `
TIPO DE PESSOA: ${tipoPessoa}
DOCUMENTO: ${documento}
NASCIMENTO: ${nascimento || 'NÃO INFORMADO'}
CEP: ${cep}
CIDADE: ${cidade}/${uf}
ENDEREÇO: ${endereco}
        `.trim();

        // 1️⃣ Atualiza LEAD
        await pool.query(
            `
            UPDATE leads SET
                nome = $1,
                email = $2,
                mensagem = $3,
                status = 'Ganho'
            WHERE id = $4
            `,
            [
                nome,
                email || null,
                dadosOnboarding,
                leadId
            ]
        );

        // 2️⃣ Verifica se CLIENTE já existe
        const clienteExiste = await pool.query(
            `SELECT id FROM clientes WHERE email = $1 AND escritorio_id = $2`,
            [email, escritorio_id]
        );

        // 3️⃣ Cria CLIENTE se não existir
        if (clienteExiste.rowCount === 0) {
            await pool.query(
                `
                INSERT INTO clientes (
                    escritorio_id,
                    nome,
                    email,
                    telefone,
                    cpf_cnpj,
                    documento,
                    cep,
                    endereco,
                    cidade,
                    estado,
                    tipo_pessoa,
                    data_nascimento
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                `,
                [
                    escritorio_id,      // $1
                    nome,               // $2
                    email || null,      // $3
                    telefone || null,   // $4
                    documento || null,  // $5 - cpf_cnpj
                    documento || null,  // $6 - documento
                    cep || null,        // $7
                    endereco || null,   // $8
                    cidade || null,     // $9
                    uf || null,         // $10 - estado
                    tipoPessoa || null, // $11 - tipo_pessoa
                    nascimento || null  // $12 - data_nascimento ✅ CORRIGIDO
                ]
            );

            console.log('[CRM PUBLIC] Cliente criado com sucesso para lead', leadId);
        } else {
            console.log('[CRM PUBLIC] Cliente já existente, apenas lead atualizado');
        }

        return res.json({ ok: true });

    } catch (err) {
        console.error('[CRM PUBLIC] Erro:', err);
        console.error('[CRM PUBLIC] Stack trace:', err.stack);
        return res.status(500).json({ 
            error: err.message,
            details: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

module.exports = router;