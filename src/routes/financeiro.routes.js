const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const axios = require('axios');

const raw_token = String.raw`$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjFiN2I3NTQ3LWQyMmEtNGIyMS1iODU3LWU1MjBjYTJlNzgxODo6JGFhY2hfNGIxZDIxMDktOTZlYS00YzNhLWEzMGYtOTVkOTEwZWY2NjBm`;
const TOKEN_ASAAS = raw_token.trim();

// --- 1. OPERAÇÕES DE PERSISTÊNCIA (CORRIGIDAS PARA 'usuario_id') ---

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
        console.error('Erro ao buscar dados financeiros:', err.message);
        res.status(500).send('Erro ao buscar dados financeiros.');
    }
});

router.post('/financeiro', authMiddleware, async (req, res) => {
    const { descricao, valor, tipo, data_vencimento } = req.body;
    try {
        if (!descricao || !valor || !tipo || !data_vencimento) {
            return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios' });
        }

        const query = `
            INSERT INTO financeiro (descricao, valor, tipo, data_vencimento, usuario_id, status) 
            VALUES ($1, $2, $3, $4, $5, 'Pendente') RETURNING *
        `;
        const values = [descricao, valor, tipo, data_vencimento, req.user.id];

        const resultado = await pool.query(query, values);
        res.status(201).json(resultado.rows[0]);
    } catch (err) {
        console.error('ERRO AO SALVAR LANÇAMENTO:', err.message);
        res.status(500).json({ erro: 'Erro ao salvar lançamento: ' + err.message });
    }
});

router.put('/financeiro/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { descricao, valor, tipo, data_vencimento } = req.body;
    try {
        const query = `
            UPDATE financeiro 
            SET descricao = $1, valor = $2, tipo = $3, data_vencimento = $4 
            WHERE id = $5 AND usuario_id = $6 
            RETURNING *
        `;
        const values = [descricao, valor, tipo, data_vencimento, id, req.user.id];
        const resultado = await pool.query(query, values);
        res.json(resultado.rows[0]);
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao atualizar: ' + err.message });
    }
});

// Rota para marcar como Pago (Ação do botão verde)
router.patch('/financeiro/:id/pagar', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const query = `
            UPDATE financeiro 
            SET status = 'Pago' 
            WHERE id = $1 AND usuario_id = $2 
            RETURNING *
        `;
        const result = await pool.query(query, [id, req.user.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Lançamento não encontrado' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Erro ao pagar:', err.message);
        res.status(500).json({ erro: 'Erro interno ao processar pagamento' });
    }
});

router.delete('/financeiro/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM financeiro WHERE id = $1 AND usuario_id = $2', [id, req.user.id]);
        res.json({ mensagem: 'Excluído com sucesso' });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao excluir: ' + err.message });
    }
});

router.get('/financeiro/saldo-real', authMiddleware, async (req, res) => {
    try {
        const query = `
            SELECT 
                COALESCE(SUM(CASE WHEN tipo = 'Receita' AND status = 'Pago' THEN valor ELSE 0 END), 0) as receitas_reais,
                COALESCE(SUM(CASE WHEN tipo = 'Despesa' AND status = 'Pago' THEN valor ELSE 0 END), 0) as despesas_pagas,
                COALESCE(SUM(CASE WHEN tipo = 'Receita' AND status != 'Pago' THEN valor ELSE 0 END), 0) as a_receber,
                COALESCE(SUM(CASE WHEN tipo = 'Despesa' AND status != 'Pago' THEN valor ELSE 0 END), 0) as a_pagar
            FROM financeiro
            WHERE usuario_id = $1
        `;
        const result = await pool.query(query, [req.user.id]);
        const row = result.rows[0];
        res.json({
            receitasReais: row.receitas_reais,
            despesasPagas: row.despesas_pagas,
            aReceber: row.a_receber,
            aPagar: row.a_pagar,
            saldoLiquido: row.receitas_reais - row.despesas_pagas
        });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao calcular saldo: ' + err.message });
    }
});

// --- 2. SERVIÇOS DE INTEGRAÇÃO API V3 (CORRIGIDOS) ---

router.post('/financeiro/configurar-subconta', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        
        const esc = await pool.query(
            `SELECT nome, documento, email, TO_CHAR(data_nascimento, 'YYYY-MM-DD') as data_nascimento, 
             endereco, cidade, estado, cep, banco_codigo, agencia, conta, conta_digito, renda_mensal 
             FROM escritorios WHERE id = $1`, 
            [escritorioId]
        );
        const e = esc.rows[0];

        // 🛡️ TRAVA DE SEGURANÇA PARA ESCALABILIDADE (SAAS)
        // Se algum desses dados estiver faltando no banco, o sistema para aqui e avisa o usuário.
        if (!e.banco_codigo || !e.agencia || !e.conta || !e.documento) {
            return res.status(400).json({ 
                erro: '⚠️ Dados incompletos! Por favor, preencha sua OAB, CPF e Dados Bancários em "Configurações" antes de ativar o financeiro.' 
            });
        }

        console.log(`📡 [ASAAS] Iniciando ativação para: ${e.nome}`);

        const payloadAsaas = {
            name: String(e.nome),
            email: String(e.email).trim().toLowerCase(),
            cpfCnpj: String(e.documento).replace(/\D/g, ''),
            birthDate: String(e.data_nascimento),
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
                accountDigit: String(e.conta_digito || '0'), // Garante o dígito mesmo se vazio
                bankAccountType: 'CONTA_CORRENTE',
                ownerName: String(e.nome),
                cpfCnpj: String(e.documento).replace(/\D/g, ''),
                email: String(e.email),
                mobilePhone: '71987654321',
                address: String(e.endereco),
                province: String(e.cidade),
                postalCode: String(e.cep).replace(/\D/g, ''),
                addressNumber: 'S/N'
            }
        };

        const response = await axios.post(`${process.env.ASAAS_URL}/accounts`, payloadAsaas, {
            headers: { 'access_token': process.env.ASAAS_API_KEY }
        });

        await pool.query(
            'UPDATE escritorios SET asaas_id = $1, asaas_api_key = $2, plano_financeiro_status = $3 WHERE id = $4',
            [response.data.id, response.data.apiKey, 'ativo', escritorioId]
        );

        res.json({ ok: true, mensagem: 'Subconta ativada com sucesso!' });
    } catch (err) {
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
        // 1. Busca dados do cliente no seu banco
        const clienteRes = await pool.query('SELECT * FROM clientes WHERE id = $1', [clienteId]);
        const cliente = clienteRes.rows[0];

        if (!cliente) return res.status(400).json({ erro: 'Cliente não encontrado.' });

        const documentoLimpo = cliente.documento ? cliente.documento.replace(/\D/g, '') : '';

        // 2. Busca o nome correto do escritório/usuário logado (PF)
        const userRes = await pool.query(
            `SELECT u.nome AS nome_usuario, e.nome AS nome_escritorio, e.documento 
             FROM usuarios u 
             LEFT JOIN escritorios e ON u.escritorio_id = e.id 
             WHERE u.id = $1`,
            [req.user.id]
        );
        const userData = userRes.rows[0];

        // Usa o nome do usuário (PF) como prioridade
        const nomeCorreto = userData.nome_usuario || userData.nome_escritorio || cliente.nome;

        // 3. Verifica se o cliente já existe no Asaas pelo CPF
        let asaasClienteId;
        try {
            const buscaCliente = await axios.get(
                `${process.env.ASAAS_URL}/customers?cpfCnpj=${documentoLimpo}`,
                { headers: { 'access_token': TOKEN_ASAAS } }
            );

            if (buscaCliente.data.data.length > 0) {
                // Cliente existe → atualiza o nome
                asaasClienteId = buscaCliente.data.data[0].id;
                await axios.put(
                    `${process.env.ASAAS_URL}/customers/${asaasClienteId}`,
                    { name: nomeCorreto },
                    { headers: { 'access_token': TOKEN_ASAAS } }
                );
                console.log(`Cliente Asaas atualizado: ${nomeCorreto}`);
            }
        } catch (e) {
            console.log('Cliente não encontrado no Asaas, criando novo...');
        }

        // 4. Cria ou usa o cliente com nome correto
        if (!asaasClienteId) {
            const novoCliente = await axios.post(`${process.env.ASAAS_URL}/customers`, {
                name: nomeCorreto,  // ← Nome correto sempre usado
                cpfCnpj: documentoLimpo,
                email: cliente.email || req.user.email
            }, { headers: { 'access_token': TOKEN_ASAAS } });

            asaasClienteId = novoCliente.data.id;
        }

        // 5. Gera a cobrança
        const cobranca = await axios.post(`${process.env.ASAAS_URL}/payments`, {
            customer: asaasClienteId,
            billingType: 'BOLETO',
            value: valor,
            dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
            description: `Honorários: ${descricao}`,
            externalReference: String(lancamentoId)
        }, { headers: { 'access_token': TOKEN_ASAAS } });

        res.json({ url: cobranca.data.bankInvoiceUrl || cobranca.data.invoiceUrl });

    } catch (err) {
        const msg = err.response?.data?.errors?.[0]?.description || 'Erro ao comunicar com Asaas.';
        console.error("ERRO BOLETO:", msg);
        res.status(500).json({ erro: msg });
    }
});
router.post('/financeiro', authMiddleware, async (req, res) => {
    const { descricao, valor, tipo, data_vencimento } = req.body;

    try {
        if (!descricao || !valor || !tipo || !data_vencimento) {
            return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios' });
        }

        const query = `
            INSERT INTO financeiro (descricao, valor, tipo, data_vencimento, "usario_id") 
            VALUES ($1, $2, $3, $4, $5) RETURNING *
        `;
        const values = [descricao, valor, tipo, data_vencimento, req.user.id];

        const resultado = await pool.query(query, values);

        res.status(201).json(resultado.rows[0]);
    } catch (err) {
        console.error('ERRO AO SALVAR LANÇAMENTO:', err.message, err.stack);
        res.status(500).json({ erro: 'Erro ao salvar lançamento: ' + err.message });
    }
});
module.exports = router;