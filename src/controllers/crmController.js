const axios = require('axios');
const pool = require('../config/db');

/**
 * 1. OBTER MÉTRICAS DO FUNIL
 * Contagem robusta para os 4 cards do pipeline:
 * leads    → Novos Leads
 * reuniao  → Em Triagem
 * proposta → Propostas
 * ganho    → Ganhos
 */
async function obterMetricasFunil(req, res) {
    try {
        const escritorioId = req.user.escritorio_id;

        const query = `
            SELECT status, COUNT(*) as total 
            FROM leads 
            WHERE escritorio_id = $1 
              AND status IS NOT NULL
              AND LOWER(status) NOT IN ('perdido', 'arquivado', 'excluido', 'cancelado', 'recusado')
            GROUP BY status
        `;

        const result = await pool.query(query, [escritorioId]);

        const stats = {
            leads: 0,
            reuniao: 0,
            proposta: 0,
            ganho: 0
        };

        result.rows.forEach(row => {
            const statusRaw = (row.status || '').trim();
            const statusNorm = statusRaw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // remove acentos
            const count = parseInt(row.total, 10) || 0;

            // Mapeamento ultra-tolerante baseado nos valores reais do seu banco
            if (
                statusNorm.includes('novo') ||
                statusNorm === 'novo' ||
                statusRaw === 'Novo' ||
                statusNorm.includes('lead') ||
                statusNorm.includes('pista')
            ) {
                stats.leads += count;
            }
            else if (
                statusNorm.includes('reuniao') ||
                statusNorm.includes('reunio') ||
                statusNorm.includes('reuni') ||
                statusNorm.includes('triagem') ||
                statusRaw.includes('Reunião') ||
                statusRaw.includes('Triagem')
            ) {
                stats.reuniao += count;
            }
            else if (
                statusNorm.includes('proposta') ||
                statusNorm.includes('propost') ||
                statusRaw.includes('Proposta') ||
                statusRaw.includes('Propostas')
            ) {
                stats.proposta += count;
            }
            else if (
                statusNorm.includes('ganho') ||
                statusNorm.includes('ganhar') ||
                statusNorm.includes('ganhho') ||
                statusNorm.includes('ganhos') ||
                statusNorm.includes('contrato') ||
                statusNorm.includes('fechado') ||
                statusNorm.includes('ganh') ||
                statusRaw.includes('Ganho') ||
                statusRaw.includes('Ganhar') ||
                statusRaw.includes('GANHO')
            ) {
                stats.ganho += count;
                console.log(`Mapeado como GANHO: "${statusRaw}" → ${count}`);
            }
        });

        console.log(`Métricas reais retornadas para escritório ${escritorioId}:`, stats);
        res.json(stats);
    } catch (error) {
        console.error('Erro CRM Metricas:', error.message);
        res.status(500).json({ erro: 'Erro ao carregar métricas do pipeline' });
    }
}

async function listarLeads(req, res) {
    try {
        const escritorioId = req.user.escritorio_id;
        const result = await pool.query(
            'SELECT * FROM leads WHERE escritorio_id = $1 ORDER BY criado_em DESC',
            [escritorioId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao listar leads:', error.message);
        res.status(500).json({ erro: 'Erro ao buscar lista de leads' });
    }
}

async function criarLeadPublico(req, res) {
    const { nome, email, telefone } = req.body;
    const MEU_ESCRITORIO_ID = 1;

    try {
        const query = `
            INSERT INTO leads (nome, email, telefone, origem, status, escritorio_id)
            VALUES ($1, $2, $3, 'Landing Page', 'novo', $4)
            RETURNING id
        `;
        await pool.query(query, [nome, email, telefone, MEU_ESCRITORIO_ID]);

        if (process.env.BREVO_API_KEY) {
            try {
                await axios.post('https://api.brevo.com/v3/smtp/email', {
                    sender: { name: 'LawTech Pro', email: process.env.BREVO_SENDER },
                    to: [{ email: process.env.ALERTA_EMAIL_DESTINO }],
                    subject: '🚀 Novo Lead na Landing Page',
                    htmlContent: `
                        <h2>Novo Contato Recebido</h2>
                        <p><strong>Nome:</strong> ${nome}</p>
                        <p><strong>E-mail:</strong> ${email || '—'}</p>
                        <p><strong>WhatsApp:</strong> ${telefone || '—'}</p>
                    `
                }, { headers: { 'api-key': process.env.BREVO_API_KEY } });
            } catch (mailErr) {
                console.warn("E-mail de alerta falhou:", mailErr.message);
            }
        }

        res.status(201).json({ ok: true, mensagem: 'Lead captado!' });
    } catch (error) {
        console.error('Erro ao criar lead público:', error.message);
        res.status(500).json({ erro: 'Falha ao processar lead' });
    }
}

async function atualizarStatusLead(req, res) {
    const { id } = req.params;
    let { status } = req.body;
    const escritorioId = req.user.escritorio_id;

    try {
        const statusMap = {
            'lead': 'Novo',
            'triagem': 'Reunião',
            'proposta': 'Proposta',
            'ganho': 'Ganho'
        };
        const statusFinal = statusMap[status.toLowerCase()] || status.trim();

        const result = await pool.query(
            'UPDATE leads SET status = $1 WHERE id = $2 AND escritorio_id = $3 RETURNING id',
            [statusFinal, id, escritorioId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ erro: 'Lead não encontrado ou sem permissão' });
        }

        res.json({ ok: true, status: statusFinal });
    } catch (err) {
        console.error('Erro ao atualizar status:', err.message);
        res.status(500).json({ erro: 'Erro ao mover lead' });
    }
}

/**
 * ✅ FUNÇÃO CORRIGIDA - COMPLETAR DADOS DO LEAD
 * Recebe os dados da ficha-cliente.html e atualiza o lead
 */
async function completarDadosLead(req, res) {
    const { leadId, nome, documento, email, nascimento, cep, endereco, cidade, uf, tipoPessoa } = req.body;

    console.log('📝 [completarDadosLead] Dados recebidos:', { leadId, nome, documento, tipoPessoa });

    if (!leadId || !nome || !documento) {
        console.error('❌ Validação falhou: dados incompletos');
        return res.status(400).json({ 
            ok: false, 
            mensagem: 'Dados obrigatórios não fornecidos (leadId, nome, documento).' 
        });
    }

    try {
        // 1. Busca o escritorio_id do lead
        const leadResult = await pool.query(
            'SELECT escritorio_id, telefone FROM leads WHERE id = $1', 
            [leadId]
        );

        if (leadResult.rowCount === 0) {
            console.error('❌ Lead não encontrado:', leadId);
            return res.status(404).json({ 
                ok: false, 
                mensagem: 'Lead não localizado no sistema.' 
            });
        }

        const { escritorio_id, telefone } = leadResult.rows[0];
        console.log('✅ Lead encontrado. Escritório:', escritorio_id);

        // 2. Cria registro na tabela clientes
        const enderecoCompleto = `${endereco}, ${cidade}/${uf}`;
        
        const queryCliente = `
            INSERT INTO clientes (
                nome, 
                documento, 
                email, 
                telefone, 
                data_nascimento, 
                cep, 
                endereco, 
                escritorio_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        `;

        const clienteResult = await pool.query(queryCliente, [
            nome.trim(),
            documento,
            email || null,
            telefone || null,
            tipoPessoa === 'PJ' ? null : nascimento,
            cep,
            enderecoCompleto,
            escritorio_id
        ]);

        const clienteId = clienteResult.rows[0].id;
        console.log('✅ Cliente criado com ID:', clienteId);

        // 3. Atualiza o lead para status "Ganho"
        const resumo = `Cliente cadastrado. Doc: ${documento} | Endereço: ${enderecoCompleto}`;
        
        await pool.query(
            `UPDATE leads 
             SET status = 'Ganho', mensagem = $1 
             WHERE id = $2`,
            [resumo, leadId]
        );

        console.log('✅ Lead atualizado para status Ganho');

        res.status(201).json({ 
            ok: true, 
            mensagem: 'Cadastro realizado com sucesso!',
            clienteId: clienteId
        });

    } catch (err) {
        console.error('❌ ERRO CRÍTICO ao completar dados:', err);
        
        // Erros específicos do PostgreSQL
        if (err.code === '23505') { // Violação de constraint UNIQUE
            return res.status(400).json({ 
                ok: false, 
                mensagem: 'Este documento já está cadastrado no sistema.' 
            });
        }

        res.status(500).json({ 
            ok: false, 
            mensagem: 'Erro interno ao processar cadastro.',
            erro: err.message 
        });
    }
}

module.exports = { 
    obterMetricasFunil, 
    listarLeads, 
    criarLeadPublico, 
    atualizarStatusLead,
    completarDadosLead  // ✅ Exportando a nova função
};