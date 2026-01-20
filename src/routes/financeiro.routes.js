const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const axios = require('axios');

/**
 * ======================================================
 * CAMADA DE SEGURANÇA FINAL - ASAAS SANDBOX
 * ======================================================
 */
// APLICANDO A NOVA CHAVE GERADA (15/01/2026)
const raw_token = String.raw`$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjFiN2I3NTQ3LWQyMmEtNGIyMS1iODU3LWU1MjBjYTJlNzgxODo6JGFhY2hfNGIxZDIxMDktOTZlYS00YzNhLWEzMGYtOTVkOTEwZWY2NjBm`;
const TOKEN_ASAAS = raw_token.trim();

console.log('✅ STAFF DEBUG: Nova chave injetada e pronta para emissão.');

console.log('🚀 SISTEMA ASAAS BLINDADO E OPERACIONAL');
// O Log de Debug agora deve vir APÓS a inicialização completa
console.log('🔍 DEBUG - Chave operacional carregada com sucesso.');

// Certifique-se de que nas rotas de Saldo e Boleto, o cabeçalho esteja exatamente assim:
// headers: { 'access_token': TOKEN_ASAAS }
// --- 1. OPERAÇÕES DE PERSISTÊNCIA (MANTIDAS) ---

router.get('/financeiro', authMiddleware, async (req, res) => {
    try {
        const query = `
            SELECT f.* FROM financeiro f
            JOIN usuarios u ON u.id = f.usuario_id
            WHERE u.escritorio_id = $1
            ORDER BY f.data_vencimento DESC
        `;
        const resultado = await pool.query(query, [req.user.escritorio_id]);
        res.json(resultado.rows);
    } catch (err) {
        res.status(500).send('Erro ao buscar dados financeiros.');
    }
});

router.post('/financeiro', authMiddleware, async (req, res) => {
    const { descricao, valor, tipo, data_vencimento } = req.body;
    try {
        const query = `
            INSERT INTO financeiro (descricao, valor, tipo, data_vencimento, usuario_id) 
            VALUES ($1, $2, $3, $4, $5) RETURNING *`;
        const values = [descricao, valor, tipo, data_vencimento, req.user.id];
        const resultado = await pool.query(query, values);
        res.status(201).json(resultado.rows[0]);
    } catch (err) {
        res.status(500).send('Erro ao salvar lançamento.');
    }
});

router.patch('/financeiro/:id/pagar', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const query = "UPDATE financeiro SET status = 'Pago' WHERE id = $1 RETURNING *";
        const resultado = await pool.query(query, [id]);
        res.json(resultado.rows[0]);
    } catch (err) {
        res.status(500).send('Erro ao atualizar status.');
    }
});

router.delete('/financeiro/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM financeiro WHERE id = $1', [id]);
        res.json({ mensagem: 'Excluído com sucesso' });
    } catch (err) {
        res.status(500).send('Erro ao excluir.');
    }
});

// --- 2. SERVIÇOS DE INTEGRAÇÃO API V3 (CORRIGIDOS) ---

router.post('/financeiro/configurar-subconta', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        
        // Busca os dados e já formata a data para o padrão do Asaas (YYYY-MM-DD)
        const esc = await pool.query(
            `SELECT nome, documento, email, TO_CHAR(data_nascimento, 'YYYY-MM-DD') as data_nascimento, 
            endereco, cidade, estado, cep, banco_codigo, agencia, conta, conta_digito, renda_mensal 
             FROM escritorios WHERE id = $1`, 
            [escritorioId]
        );
        const e = esc.rows[0];

        // LOG DE SEGURANÇA: Verificando o que o servidor capturou do banco
        console.log(`📡 ENVIANDO DATA: ${e.data_nascimento} PARA O ESCRITÓRIO: ${e.nome}`);

        const payloadAsaas = {
            name: String(e.nome),
            email: String(e.email),
            cpfCnpj: String(e.documento).replace(/\D/g, ''),
            birthDate: String(e.data_nascimento), // Força a conversão para texto puro
            companyType: String(e.documento).replace(/\D/g, '').length > 11 ? 'LIMITED' : 'INDIVIDUAL',
            incomeValue: parseFloat(e.renda_mensal) || 1000,
            address: String(e.endereco),
            province: String(e.cidade),
            postalCode: String(e.cep).replace(/\D/g, ''),
            mobilePhone: '71987654321', 
            bankAccount: {
                bank: String(e.banco_codigo),
                agency: String(e.agencia),
                account: String(e.conta),
                accountDigit: String(e.conta_digito),
                bankAccountType: 'CONTA_CORRENTE',
                ownerName: String(e.nome),
                cpfCnpj: String(e.documento).replace(/\D/g, ''),
                // Adicionando os dados de contato conforme sua sugestão:
                email: String(e.email),
                mobilePhone: '71987654321', // O mesmo celular validado anteriormente
                address: String(e.endereco),
                province: String(e.cidade),
                postalCode: String(e.cep).replace(/\D/g, ''),
                addressNumber: 'S/N' // Campo que costuma ser obrigatório junto com endereço
            }
        };

        // USANDO SEMPRE A URL E CHAVE DO .ENV (Para facilitar a troca para Real depois)
        const response = await axios.post(`${process.env.ASAAS_URL}/accounts`, payloadAsaas, {
            headers: { 'access_token': process.env.ASAAS_API_KEY }
        });

        // Atualiza as colunas que o senhor criou no Neon
        await pool.query(
            'UPDATE escritorios SET asaas_id = $1, asaas_api_key = $2, plano_financeiro_status = $3 WHERE id = $4',
            [response.data.id, response.data.apiKey, 'ativo', escritorioId]
        );

        res.json({ ok: true, mensagem: 'Subconta ativada com sucesso!' });
    } catch (err) {
        // Log detalhado para o senhor ver o erro exato do Asaas no terminal
        const erroMsg = err.response?.data?.errors?.[0]?.description || 'Falha na comunicação com gateway.';
        console.error("❌ ERRO NO ASAAS:", erroMsg);
        res.status(500).json({ erro: erroMsg });
    }
});

router.post('/webhook/financeiro', async (req, res) => {
    // 1. AVISA O ASAAS IMEDIATAMENTE QUE RECEBEU (Evita Erro 408/Read Timeout)
    res.status(200).json({ received: true }); 

    // 2. SÓ DEPOIS PROCESSA A LÓGICA NO BANCO
    try {
        const { event, payment } = req.body;

        if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
            console.log(`💰 Pagamento recebido: ${payment.id}`);
            
            // Aqui entra sua lógica de update no banco (UPDATE faturas SET status = 'PAGO'...)
            await pool.query('UPDATE faturas SET status = $1 WHERE asaas_id = $2', ['PAGO', payment.id]);
        }
    } catch (err) {
        // Se der erro aqui, o Asaas não saberá, pois já enviamos o 200 lá em cima.
        // Isso impede que a sua fila seja pausada por erros internos de lógica.
        console.error('❌ Erro interno no processamento do Webhook:', err.message);
    }
});

router.put('/financeiro/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { descricao, valor, tipo, data_vencimento } = req.body;
    try {
        const query = `UPDATE financeiro SET descricao = $1, valor = $2, tipo = $3, data_vencimento = $4 WHERE id = $5 AND usuario_id IN (SELECT id FROM usuarios WHERE escritorio_id = $6) RETURNING *`;
        const values = [descricao, valor, tipo, data_vencimento, id, req.user.escritorio_id];
        const resultado = await pool.query(query, values);
        res.json(resultado.rows[0]);
    } catch (err) {
        res.status(500).send('Erro de consistência de dados.');
    }
});
// ROTA PARA GERAR BOLETO DE HONORÁRIOS (ASAAS)
router.post('/financeiro/gerar-boleto-honorarios', authMiddleware, async (req, res) => {
    const { lancamentoId, valor, descricao, clienteId } = req.body;

    try {
        // 1. Busca os dados do cliente no seu banco
        const clienteRes = await pool.query('SELECT * FROM clientes WHERE id = $1', [clienteId]);
        const cliente = clienteRes.rows[0];

        if (!cliente) return res.status(400).json({ erro: 'Cliente não encontrado.' });

        // 2. Criar o cliente no Asaas (ou recuperar ID se já existir)
        const documentoLimpo = cliente.documento ? cliente.documento.replace(/\D/g, '') : '';
        
        const asaasCliente = await axios.post(`${process.env.ASAAS_URL}/customers`, {
            name: cliente.nome,
            cpfCnpj: documentoLimpo, // Envia apenas os números (11 ou 14 dígitos)
            email: cliente.email
        }, { headers: { 'access_token': TOKEN_ASAAS } });

        // 3. Gerar a cobrança no Asaas
        const cobranca = await axios.post(`${process.env.ASAAS_URL}/payments`, {
            customer: asaasCliente.data.id,
            billingType: 'BOLETO',
            value: valor,
            dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0], // Vence em 3 dias
            description: `Honorários: ${descricao}`,
            externalReference: String(lancamentoId)
        }, { headers: { 'access_token': TOKEN_ASAAS } });

        // 4. Retorna a URL do boleto para o frontend abrir
        res.json({ url: cobranca.data.bankInvoiceUrl || cobranca.data.invoiceUrl });

    } catch (err) {
        const msg = err.response?.data?.errors?.[0]?.description || 'Erro ao comunicar com Asaas.';
        console.error("ERRO BOLETO:", msg);
        res.status(500).json({ erro: msg });
    }
});
module.exports = router;