const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const logger = require('../utils/logger');

logger.info('CRM public routes carregadas');

router.post('/onboarding', async (req, res) => {
    logger.info({ body: req.body }, 'Onboarding iniciando');

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
            endereco,
            numero,
            complemento,
            bairro
        } = req.body;

        // ✅ Validação
        if (!leadId || !nome || !documento || !cidade || !uf || !telefone) {
            logger.error('Onboarding: dados obrigatorios ausentes');
            return res.status(400).json({ 
                ok: false, 
                erro: 'Dados obrigatórios ausentes' 
            });
        }

        // 🔎 Buscar lead + escritorio_id
        
        const leadResult = await pool.query(
            `SELECT id, escritorio_id FROM leads WHERE id = $1`,
            [leadId]
        );

        if (leadResult.rowCount === 0) {
            logger.error({ leadId }, 'Onboarding: lead nao encontrado');
            return res.status(404).json({ 
                ok: false, 
                erro: 'Lead não encontrado' 
            });
        }

        const { escritorio_id } = leadResult.rows[0];
        logger.info({ leadId, escritorioId: escritorio_id }, 'Onboarding: lead encontrado');

        // 📝 Montar endereço completo
        const enderecoCompleto = [
            endereco,
            numero ? `nº ${numero}` : '',
            complemento,
            bairro,
            `${cidade}/${uf}`,
            cep ? `CEP ${cep}` : ''
        ].filter(Boolean).join(', ');

        // 1️⃣ ATUALIZAR LEAD (apenas campos básicos que existem)
        
        await pool.query(
            `UPDATE leads SET
                nome = $1,
                email = $2,
                telefone = $3,
                status = 'Ganho',
                mensagem = $4
            WHERE id = $5`,
            [
                nome,
                email || null,
                telefone,
                `Onboarding completo\nDocumento: ${documento}\nEndereço: ${enderecoCompleto}`,
                leadId
            ]
        );

        logger.info({ leadId }, 'Onboarding: lead atualizado');

        // 2️⃣ VERIFICAR SE CLIENTE JÁ EXISTE
        
        let clienteExiste = await pool.query(
            `SELECT id FROM clientes 
             WHERE (email = $1 OR cpf_cnpj = $2) 
             AND escritorio_id = $3`,
            [email || '', documento, escritorio_id]
        );

        // 3️⃣ CRIAR OU ATUALIZAR CLIENTE
        if (clienteExiste.rowCount === 0) {
            
            await pool.query(
                `INSERT INTO clientes (
                    escritorio_id,
                    nome,
                    email,
                    telefone,
                    cpf_cnpj,
                    tipo_pessoa,
                    data_nascimento,
                    cep,
                    endereco,
                    cidade,
                    estado
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [
                    escritorio_id,
                    nome,
                    email || null,
                    telefone,
                    documento,
                    tipoPessoa === 'PF' ? 'Física' : 'Jurídica',
                    nascimento || null,
                    cep || null,
                    enderecoCompleto,
                    cidade,
                    uf
                ]
            );

            logger.info({ leadId }, 'Onboarding: cliente criado');
        } else {
            
            await pool.query(
                `UPDATE clientes SET
                    nome = $1,
                    email = $2,
                    telefone = $3,
                    cpf_cnpj = $4,
                    tipo_pessoa = $5,
                    data_nascimento = $6,
                    cep = $7,
                    endereco = $8,
                    cidade = $9,
                    estado = $10
                WHERE id = $11`,
                [
                    nome,
                    email || null,
                    telefone,
                    documento,
                    tipoPessoa === 'PF' ? 'Física' : 'Jurídica',
                    nascimento || null,
                    cep || null,
                    enderecoCompleto,
                    cidade,
                    uf,
                    clienteExiste.rows[0].id
                ]
            );

            logger.info({ leadId }, 'Onboarding: cliente atualizado');
        }

        logger.info({ leadId }, 'Onboarding concluido com sucesso');

        return res.json({
            ok: true,
            mensagem: 'Dados salvos com sucesso!'
        });

    } catch (err) {
        logger.error({ err: err.message, stack: err.stack, code: err.code }, 'Erro no onboarding');
        
        return res.status(500).json({ 
            ok: false,
            erro: 'Erro ao salvar dados',
            detalhe: err.message
        });
    }
});

module.exports = router;