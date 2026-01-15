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

// --- 2. SERVIÇOS DE INTEGRAÇÃO API V3 ---

router.post('/financeiro/configurar-subconta', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const esc = await pool.query(
            'SELECT nome, documento, email, data_nascimento, endereco, cidade, cep, banco_codigo, agencia, conta, conta_digito, renda_mensal FROM escritorios WHERE id = $1', 
            [escritorioId]
        );
        const e = esc.rows[0];

        const payloadAsaas = {
            name: e.nome,
            email: e.email,
            cpfCnpj: e.documento.replace(/\D/g, ''),
            incomeValue: parseFloat(e.renda_mensal) || 1000,
            address: e.endereco,
            province: e.cidade,
            postalCode: e.cep,
            bankAccount: {
                bank: { code: e.banco_codigo },
                agency: e.agencia,
                account: e.conta,
                accountDigit: e.conta_digito,
                type: 'CONTA_CORRENTE'
            }
        };

        const response = await axios.post('https://sandbox.asaas.com/api/v3/accounts', payloadAsaas, {
            headers: { 'access_token': TOKEN_ASAAS }
        });

        await pool.query(
            'UPDATE escritorios SET asaas_wallet_id = $1, asaas_api_key_subconta = $2 WHERE id = $3',
            [response.data.id, response.data.apiKey, escritorioId]
        );

        res.json({ ok: true, mensagem: 'Subconta ativada!' });
    } catch (err) {
        res.status(500).json({ erro: 'Falha na comunicação com gateway.' });
    }
});

router.get('/financeiro/saldo-real', authMiddleware, async (req, res) => {
    try {
        const response = await axios.get('https://sandbox.asaas.com/api/v3/finance/balance', {
            headers: { 'access_token': TOKEN_ASAAS }
        });
        res.json({ apiKeyExiste: true, saldo: response.data.balance });
    } catch (err) {
        res.status(500).json({ erro: 'Timeout ou erro de autenticação no gateway.' });
    }
});

router.post('/financeiro/gerar-boleto-honorarios', authMiddleware, async (req, res) => {
    const { valor, descricao, clienteId } = req.body; 
    try {
        const clienteRes = await pool.query('SELECT asaas_customer_id, nome FROM clientes WHERE id = $1', [clienteId]);
        const cliente = clienteRes.rows[0];

        const response = await axios.post('https://sandbox.asaas.com/api/v3/payments', {
            customer: cliente.asaas_customer_id, 
            billingType: 'BOLETO',
            value: valor,
            dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            description: `${descricao} - Cliente: ${cliente.nome}`,
            externalReference: `LANC_CLI_${Date.now()}`
        }, {
            headers: { 'access_token': TOKEN_ASAAS }
        });

        res.json({ url: response.data.invoiceUrl });
    } catch (err) {
        console.error("❌ STACK TRACE GATEWAY:", err.response?.data || err.message);
        res.status(500).json({ erro: 'Erro na emissão do título.' });
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

module.exports = router;