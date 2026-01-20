const pool = require('../config/db');

// 1. Listar Clientes (Nomes de colunas alinhados com o Neon)
async function listarClientes(req, res) {
    try {
        const escritorioId = req.user.escritorio_id;
        // Trocamos 'cpf' por 'documento' para bater com o seu banco
        const query = `
            SELECT id, nome, documento, email, telefone, cep, endereco, cidade, estado, 
            (SELECT COUNT(*)::int FROM processos p WHERE p.cliente = c.nome AND p.escritorio_id = $1) as total_processos
            FROM clientes c 
            WHERE c.escritorio_id = $1 
            ORDER BY c.nome ASC
        `;
        const result = await pool.query(query, [escritorioId]);
        res.json(result.rows || []); 
    } catch (error) {
        console.error('❌ Erro ao listar clientes:', error.message);
        res.status(500).json({ erro: 'Erro ao carregar lista de clientes' });
    }
}

// 2. Criar Cliente (Sem Asaas e com nomes de colunas corretos)
async function criarCliente(req, res) {
    const { nome, documento, email, telefone, cep, endereco, cidade, estado, data_nascimento } = req.body;
    const escritorioId = req.user.escritorio_id;

    try {
        const query = `
            INSERT INTO clientes (
                nome, documento, email, telefone, cep, endereco, cidade, estado, escritorio_id, data_nascimento
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `;

        const values = [
            nome, documento, email, telefone, cep, endereco, cidade, estado, escritorioId, data_nascimento || null
        ];

        const resultado = await pool.query(query, values);
        console.log("✅ Cliente salvo com sucesso no banco local!");
        res.status(201).json(resultado.rows[0]);

    } catch (err) {
        console.error("❌ Erro ao criar cliente:", err.message);
        res.status(500).json({ erro: "Erro ao salvar: " + err.message });
    }
}

// 3. Editar Cliente (Sincronizado com Documento e Endereço)
async function editarCliente(req, res) {
    const { id } = req.params;
    const { nome, documento, email, telefone, endereco, cep, cidade, estado } = req.body;
    try {
        const query = `
            UPDATE clientes 
            SET nome = $1, documento = $2, email = $3, telefone = $4, endereco = $5, cep = $6, cidade = $7, estado = $8 
            WHERE id = $9 AND escritorio_id = $10
        `;
        const values = [nome, documento, email, telefone, endereco, cep, cidade, estado, id, req.user.escritorio_id];
        
        await pool.query(query, values);
        res.json({ ok: true });
    } catch (error) {
        console.error('❌ Erro ao editar cliente:', error.message);
        res.status(500).json({ erro: 'Erro ao editar' });
    }
}

// 4. Excluir Cliente
async function excluirCliente(req, res) {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM clientes WHERE id = $1 AND escritorio_id = $2', [id, req.user.escritorio_id]);
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ erro: 'Erro ao excluir' });
    }
}

module.exports = { listarClientes, criarCliente, editarCliente, excluirCliente };