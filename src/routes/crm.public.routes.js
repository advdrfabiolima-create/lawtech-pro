const express = require('express');
const router = express.Router();
const pool = require('../config/db');

console.log('[CRM PUBLIC] Rotas públicas carregadas');

router.post('/onboarding', async (req, res) => {
    console.log('\n========================================');
    console.log('📝 [ONBOARDING] INICIANDO PROCESSO...');
    console.log('========================================');
    
    try {
        console.log('📦 Body recebido:', JSON.stringify(req.body, null, 2));
        
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
            console.error('❌ Dados obrigatórios ausentes');
            return res.status(400).json({ 
                ok: false, 
                erro: 'Dados obrigatórios ausentes' 
            });
        }

        console.log('✅ Validação OK');

        // 🔎 Buscar lead + escritorio_id
        console.log('🔍 Buscando lead ID:', leadId);
        
        const leadResult = await pool.query(
            `SELECT id, escritorio_id FROM leads WHERE id = $1`,
            [leadId]
        );

        if (leadResult.rowCount === 0) {
            console.error('❌ Lead não encontrado:', leadId);
            return res.status(404).json({ 
                ok: false, 
                erro: 'Lead não encontrado' 
            });
        }

        const { escritorio_id } = leadResult.rows[0];
        console.log('✅ Lead encontrado! Escritório:', escritorio_id);

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
        console.log('💾 Atualizando lead...');
        
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

        console.log('✅ Lead atualizado!');

        // 2️⃣ VERIFICAR SE CLIENTE JÁ EXISTE
        console.log('🔍 Verificando se cliente existe...');
        
        let clienteExiste = await pool.query(
            `SELECT id FROM clientes 
             WHERE (email = $1 OR cpf_cnpj = $2) 
             AND escritorio_id = $3`,
            [email || '', documento, escritorio_id]
        );

        // 3️⃣ CRIAR OU ATUALIZAR CLIENTE
        if (clienteExiste.rowCount === 0) {
            console.log('📝 Criando novo cliente...');
            
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

            console.log('✅ Cliente criado com sucesso!');
        } else {
            console.log('📝 Atualizando cliente existente...');
            
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

            console.log('✅ Cliente atualizado com sucesso!');
        }

        console.log('========================================');
        console.log('✅ ONBOARDING CONCLUÍDO!');
        console.log('========================================\n');

        return res.json({ 
            ok: true,
            mensagem: 'Dados salvos com sucesso!' 
        });

    } catch (err) {
        console.error('\n========================================');
        console.error('❌ ERRO NO ONBOARDING');
        console.error('========================================');
        console.error('Mensagem:', err.message);
        console.error('Código:', err.code);
        console.error('Stack:', err.stack);
        console.error('========================================\n');
        
        return res.status(500).json({ 
            ok: false,
            erro: 'Erro ao salvar dados',
            detalhe: err.message
        });
    }
});

module.exports = router;