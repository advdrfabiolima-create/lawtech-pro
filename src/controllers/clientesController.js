const pool = require('../config/db');
const axios = require('axios');

// 1. Listar Clientes (Com contagem de processos vinculados)
async function listarClientes(req, res) {
    try {
        const escritorioId = req.user.escritorio_id;
        const query = `
            SELECT c.*, 
            (SELECT COUNT(*)::int FROM processos p WHERE p.cliente = c.nome AND p.escritorio_id = $1) as total_processos
            FROM clientes c 
            WHERE c.escritorio_id = $1 
            ORDER BY c.nome ASC
        `;
        const result = await pool.query(query, [escritorioId]);
        res.json(result.rows || []); 
    } catch (error) {
        console.error('Erro ao listar clientes:', error);
        res.status(500).json({ erro: 'Erro ao listar clientes' });
    }
}

// 2. Criar Cliente (Corrigido, Unificado e com Integração Asaas)
async function criarCliente(req, res) {
    const { nome, documento, email, telefone, cep, endereco, cidade, estado } = req.body;
    const escritorioId = req.user.escritorio_id;

    try {
        // Busca a API Key da Subconta do escritório
        const escRes = await pool.query(
            'SELECT asaas_api_key_subconta FROM escritorios WHERE id = $1',
            [escritorioId]
        );
        const apiKey = escRes.rows[0]?.asaas_api_key_subconta;

        let asaas_customer_id = null; // Variável unificada para o banco

        // Se o escritório tiver Asaas ativado, cria o cliente no Asaas
        if (apiKey) {
            try {
                const asaasRes = await axios.post('https://sandbox.asaas.com/api/v3/customers', {
    name: nome,
    cpfCnpj: documento.replace(/\D/g, ''),
    email: email,
    mobilePhone: telefone,
    postalCode: cep.replace(/\D/g, ''),
    address: endereco,
    province: cidade,
    state: estado
}, {
    headers: { 
        'access_token': '$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OmExYWIzNmQ1LTZhZTQtNDcyNS04YzgzLTA5MDVjOWQ3NzAwYzo6JGFhY2hfYTY2YzE5YzQtZDM2YS00MDJjLWE1YWItYjkzNWM4ZDNmZGU5'
    }
});

                asaas_customer_id = asaasRes.data.id;
                console.log(`✅ Cliente "${nome}" espelhado no Asaas com ID: ${asaas_customer_id}`);
            } catch (errAsaas) {
                console.error("❌ Erro Asaas:", errAsaas.response?.data || errAsaas.message);
                // O processo continua para salvar no banco local mesmo se a API falhar
            }
        }

        const query = `
            INSERT INTO clientes (
                nome, documento, email, telefone, cep, endereco, cidade, estado, asaas_customer_id, escritorio_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `;

        const values = [
            nome, 
            documento, 
            email, 
            telefone, 
            cep, 
            endereco, 
            cidade, 
            estado, 
            asaas_customer_id, // Agora a variável coincide com a query
            escritorioId
        ];

        const resultado = await pool.query(query, values);
        res.status(201).json(resultado.rows[0]);

    } catch (err) {
        console.error("❌ Erro ao criar cliente local:", err.message);
        res.status(500).json({ erro: "Erro ao salvar cliente no banco de dados." });
    }
}

// 3. Editar Cliente
async function editarCliente(req, res) {
    const { id } = req.params;
    const { nome, documento, email, telefone } = req.body;
    try {
        await pool.query(
            'UPDATE clientes SET nome = $1, documento = $2, email = $3, telefone = $4 WHERE id = $5 AND escritorio_id = $6',
            [nome, documento, email, telefone, id, req.user.escritorio_id]
        );
        res.json({ ok: true });
    } catch (error) {
        console.error('Erro ao editar cliente:', error);
        res.status(500).json({ erro: 'Erro ao editar cliente' });
    }
}

// 4. Excluir Cliente
async function excluirCliente(req, res) {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM clientes WHERE id = $1 AND escritorio_id = $2', [id, req.user.escritorio_id]);
        res.json({ ok: true });
    } catch (error) {
        console.error('Erro ao excluir cliente:', error);
        res.status(500).json({ erro: 'Erro ao excluir cliente' });
    }
}

// EXPORTAÇÃO ÚNICA - RESOLVE O REFERENCE ERROR DEFINITIVAMENTE
module.exports = { 
    listarClientes, 
    criarCliente, 
    editarCliente, 
    excluirCliente 
};