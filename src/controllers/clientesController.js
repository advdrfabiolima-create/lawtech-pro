const pool = require('../config/db');

// 1. Listar Clientes (CORRIGIDO: conta processos em ambos os polos)
async function listarClientes(req, res) {
    try {
        const escritorioId = req.user.escritorio_id;

        const query = `
            SELECT
                c.id,
                c.nome,
                c.documento,
                c.email,
                c.telefone,
                c.cep,
                c.endereco,
                c.cidade,
                c.estado,
                c.data_nascimento,
                (SELECT COUNT(DISTINCT pp.processo_id)::int
                 FROM partes_processo pp
                 INNER JOIN processos p ON p.id = pp.processo_id
                 WHERE pp.pessoa_id = c.id
                 AND p.escritorio_id = $1
                 AND p.status != 'excluido'
                ) as total_processos
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
        res.status(500).json({ erro: 'Erro ao salvar cliente' });
    }
}

// 3. Editar Cliente (CORRIGIDO: retorna cliente atualizado)
async function editarCliente(req, res) {
    const { id } = req.params;
    const { nome, documento, email, telefone, endereco, cep, cidade, estado, data_nascimento } = req.body;
    const escritorioId = req.user.escritorio_id;
    
    try {
        // Primeiro: atualizar os dados
        const updateQuery = `
            UPDATE clientes 
            SET nome = $1, 
                documento = $2, 
                email = $3, 
                telefone = $4, 
                endereco = $5, 
                cep = $6, 
                cidade = $7, 
                estado = $8,
                data_nascimento = $9
            WHERE id = $10 AND escritorio_id = $11
        `;
        
        const updateValues = [
            nome, 
            documento, 
            email, 
            telefone, 
            endereco, 
            cep, 
            cidade, 
            estado, 
            data_nascimento || null,
            id, 
            escritorioId
        ];
        
        await pool.query(updateQuery, updateValues);
        
        // Segundo: buscar o cliente atualizado para retornar
        const selectQuery = `
            SELECT 
                c.id, 
                c.nome, 
                c.documento, 
                c.email, 
                c.telefone, 
                c.cep, 
                c.endereco, 
                c.cidade, 
                c.estado,
                c.data_nascimento,
                (SELECT COUNT(DISTINCT pp.processo_id)::int 
                 FROM partes_processo pp
                 INNER JOIN processos p ON p.id = pp.processo_id
                 WHERE pp.pessoa_id = c.id 
                 AND p.escritorio_id = $2
                 AND p.status != 'excluido'
                ) as total_processos
            FROM clientes c 
            WHERE c.id = $1 AND c.escritorio_id = $2
        `;
        
        const result = await pool.query(selectQuery, [id, escritorioId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Cliente não encontrado' });
        }
        
        console.log('✅ Cliente atualizado com sucesso:', result.rows[0].nome);
        res.json(result.rows[0]); // ✅ RETORNA O CLIENTE COMPLETO ATUALIZADO
        
    } catch (error) {
        console.error('❌ Erro ao editar cliente:', error.message);
        res.status(500).json({ erro: 'Erro ao editar cliente' });
    }
}

// 4. Excluir Cliente
async function excluirCliente(req, res) {
    const { id } = req.params;
    const escritorioId = req.user.escritorio_id;
    
    try {
        const result = await pool.query(
            'DELETE FROM clientes WHERE id = $1 AND escritorio_id = $2',
            [id, escritorioId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ erro: 'Cliente não encontrado' });
        }
        
        console.log('✅ Cliente excluído com sucesso, ID:', id);
        res.json({ ok: true });
        
    } catch (error) {
        console.error('❌ Erro ao excluir cliente:', error.message);
        res.status(500).json({ erro: 'Erro ao excluir cliente' });
    }
}

module.exports = { listarClientes, criarCliente, editarCliente, excluirCliente };