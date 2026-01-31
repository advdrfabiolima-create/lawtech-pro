const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const planMiddleware = require('../middlewares/planMiddleware');
const axios = require('axios');

const TOKEN_ASAAS = process.env.ASAAS_API_KEY;

// ============================================================
// ✅ ROTAS BÁSICAS - DISPONÍVEIS EM TODOS OS PLANOS
// (Apenas autenticação, sem restrição de funcionalidade)
// ============================================================

router.get('/financeiro', 
    authMiddleware,  // ✅ Apenas autenticação
    async (req, res) => {
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
    }
);

router.post('/financeiro', 
    authMiddleware,  // ✅ Apenas autenticação
    async (req, res) => {
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
    }
);

router.put('/financeiro/:id', 
    authMiddleware,  // ✅ Apenas autenticação
    async (req, res) => {
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
    }
);

router.patch('/financeiro/:id/pagar', 
    authMiddleware,  // ✅ Apenas autenticação
    async (req, res) => {
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
    }
);

router.delete('/financeiro/:id', 
    authMiddleware,  // ✅ Apenas autenticação
    async (req, res) => {
        const { id } = req.params;
        try {
            await pool.query('DELETE FROM financeiro WHERE id = $1 AND usuario_id = $2', [id, req.user.id]);
            res.json({ mensagem: 'Excluído com sucesso' });
        } catch (err) {
            res.status(500).json({ erro: 'Erro ao excluir: ' + err.message });
        }
    }
);

router.get('/financeiro/saldo-real', 
    authMiddleware,  // ✅ Apenas autenticação
    async (req, res) => {
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
    }
);

// ==========================================
// 📊 RELATÓRIO DE FATURAMENTO
// ==========================================

router.get('/financeiro/relatorio', 
    authMiddleware,
    async (req, res) => {
        try {
            const { dataInicio, dataFim } = req.query;
            
            if (!dataInicio || !dataFim) {
                return res.status(400).json({ erro: 'Datas de início e fim são obrigatórias' });
            }
            
            const query = `
                SELECT f.* 
                FROM financeiro f
                JOIN usuarios u ON u.id = f.usuario_id
                WHERE u.escritorio_id = $1
                  AND f.data_vencimento BETWEEN $2 AND $3
                ORDER BY f.data_vencimento ASC, f.tipo DESC
            `;
            
            const result = await pool.query(query, [
                req.user.escritorio_id,
                dataInicio,
                dataFim
            ]);
            
            res.json(result.rows);
            
        } catch (err) {
            console.error('Erro ao buscar dados do relatório:', err.message);
            res.status(500).json({ erro: 'Erro ao buscar dados do relatório' });
        }
    }
);

// ==========================================
// 📊 GERAR PDF DO RELATÓRIO - USANDO PUPPETEER
// ==========================================

// SUBSTITUA A ROTA router.post('/financeiro/relatorio-pdf') PELO CÓDIGO ABAIXO:

router.post('/financeiro/relatorio-pdf', 
    authMiddleware,
    async (req, res) => {
        try {
            const { periodo, dataInicio, dataFim, lancamentos } = req.body;
            
            // Buscar dados do escritório - SEM TELEFONE
            const escritorioRes = await pool.query(
                'SELECT nome, documento, email, endereco, cidade, estado FROM escritorios WHERE id = $1',
                [req.user.escritorio_id]
            );
            const escritorio = escritorioRes.rows[0] || {};
            
            // Calcular totais
            let totalReceitas = 0;
            let totalDespesas = 0;
            
            lancamentos.forEach(lanc => {
                const valor = parseFloat(lanc.valor);
                if (lanc.tipo === 'Receita') {
                    totalReceitas += valor;
                } else {
                    totalDespesas += valor;
                }
            });
            
            const lucroLiquido = totalReceitas - totalDespesas;
            
            // Agrupar por mês para relatórios anuais
            const porMes = {};
            lancamentos.forEach(lanc => {
                const mes = lanc.data_vencimento.substring(0, 7); // YYYY-MM
                if (!porMes[mes]) {
                    porMes[mes] = { receitas: 0, despesas: 0 };
                }
                
                const valor = parseFloat(lanc.valor);
                if (lanc.tipo === 'Receita') {
                    porMes[mes].receitas += valor;
                } else {
                    porMes[mes].despesas += valor;
                }
            });
            
            // Gerar HTML completo para o PDF
            const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Relatório de Faturamento</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Helvetica', 'Arial', sans-serif;
            padding: 40px;
            color: #1e293b;
            line-height: 1.6;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 3px solid #2563eb;
        }
        
        .header h1 {
            font-size: 28px;
            font-weight: 800;
            color: #0f172a;
            margin-bottom: 8px;
        }
        
        .header .periodo {
            font-size: 18px;
            color: #2563eb;
            font-weight: 600;
            margin-bottom: 12px;
        }
        
        .header .gerado {
            font-size: 11px;
            color: #64748b;
        }
        
        .escritorio-info {
            background: #f8fafc;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
            border-left: 4px solid #2563eb;
        }
        
        .escritorio-info h3 {
            font-size: 16px;
            font-weight: 700;
            margin-bottom: 12px;
            color: #0f172a;
        }
        
        .escritorio-info p {
            font-size: 12px;
            color: #475569;
            margin: 4px 0;
        }
        
        .resumo-financeiro {
            background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
            padding: 30px;
            border-radius: 12px;
            margin-bottom: 30px;
            border: 2px solid #2563eb;
        }
        
        .resumo-financeiro h2 {
            text-align: center;
            font-size: 20px;
            font-weight: 800;
            margin-bottom: 25px;
            color: #0f172a;
        }
        
        .resumo-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
        }
        
        .resumo-item {
            text-align: center;
            padding: 15px;
            background: white;
            border-radius: 8px;
        }
        
        .resumo-label {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            color: #64748b;
            margin-bottom: 8px;
            letter-spacing: 0.5px;
        }
        
        .resumo-valor {
            font-size: 32px;
            font-weight: 900;
        }
        
        .valor-positivo {
            color: #10b981;
        }
        
        .valor-negativo {
            color: #ef4444;
        }
        
        .secao-titulo {
            font-size: 18px;
            font-weight: 800;
            margin: 30px 0 15px 0;
            color: #0f172a;
            padding-bottom: 8px;
            border-bottom: 2px solid #e2e8f0;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
        }
        
        thead {
            background: #f1f5f9;
        }
        
        th {
            padding: 12px;
            text-align: left;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            color: #475569;
            border-bottom: 2px solid #cbd5e1;
        }
        
        td {
            padding: 12px;
            font-size: 12px;
            border-bottom: 1px solid #e2e8f0;
        }
        
        tbody tr:hover {
            background: #f8fafc;
        }
        
        .badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
        }
        
        .badge-receita {
            background: #d1fae5;
            color: #065f46;
        }
        
        .badge-despesa {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .badge-pago {
            background: #d1fae5;
            color: #065f46;
        }
        
        .badge-pendente {
            background: #fef3c7;
            color: #92400e;
        }
        
        .rodape {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
            text-align: center;
            font-size: 10px;
            color: #94a3b8;
        }
        
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #94a3b8;
        }
        
        .empty-state .icon {
            font-size: 48px;
            margin-bottom: 15px;
            opacity: 0.3;
        }
        
        @media print {
            body {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 RELATÓRIO DE FATURAMENTO</h1>
        <div class="periodo">${periodo}</div>
        <div class="gerado">Gerado em ${new Date().toLocaleString('pt-BR')}</div>
    </div>
    
    <div class="escritorio-info">
        <h3>${escritorio.nome || 'Escritório'}</h3>
        ${escritorio.documento ? `<p><strong>CNPJ/CPF:</strong> ${escritorio.documento}</p>` : ''}
        ${escritorio.endereco ? `<p><strong>Endereço:</strong> ${escritorio.endereco}, ${escritorio.cidade}/${escritorio.estado}</p>` : ''}
        ${escritorio.email ? `<p><strong>Email:</strong> ${escritorio.email}</p>` : ''}
    </div>
    
    <div class="resumo-financeiro">
        <h2>💰 Resumo Financeiro</h2>
        <div class="resumo-grid">
            <div class="resumo-item">
                <div class="resumo-label">Total Receitas</div>
                <div class="resumo-valor valor-positivo">R$ ${totalReceitas.toFixed(2).replace('.', ',')}</div>
            </div>
            <div class="resumo-item">
                <div class="resumo-label">Total Despesas</div>
                <div class="resumo-valor valor-negativo">R$ ${totalDespesas.toFixed(2).replace('.', ',')}</div>
            </div>
            <div class="resumo-item">
                <div class="resumo-label">Lucro Líquido</div>
                <div class="resumo-valor ${lucroLiquido >= 0 ? 'valor-positivo' : 'valor-negativo'}">
                    R$ ${lucroLiquido.toFixed(2).replace('.', ',')}
                </div>
            </div>
        </div>
    </div>
    
    ${Object.keys(porMes).length > 1 ? `
        <h2 class="secao-titulo">📅 Breakdown Mensal</h2>
        <table>
            <thead>
                <tr>
                    <th>Mês</th>
                    <th style="text-align: right;">Receitas</th>
                    <th style="text-align: right;">Despesas</th>
                    <th style="text-align: right;">Saldo</th>
                </tr>
            </thead>
            <tbody>
                ${Object.keys(porMes).sort().map(mesKey => {
                    const mes = porMes[mesKey];
                    const saldo = mes.receitas - mes.despesas;
                    const [ano, mesNum] = mesKey.split('-');
                    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                    const mesNome = `${meses[parseInt(mesNum) - 1]}/${ano}`;
                    
                    return `
                        <tr>
                            <td><strong>${mesNome}</strong></td>
                            <td style="text-align: right; color: #10b981; font-weight: 600;">R$ ${mes.receitas.toFixed(2).replace('.', ',')}</td>
                            <td style="text-align: right; color: #ef4444; font-weight: 600;">R$ ${mes.despesas.toFixed(2).replace('.', ',')}</td>
                            <td style="text-align: right; font-weight: 700; color: ${saldo >= 0 ? '#10b981' : '#ef4444'};">
                                R$ ${saldo.toFixed(2).replace('.', ',')}
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    ` : ''}
    
    ${lancamentos.length > 0 ? `
        <h2 class="secao-titulo">📋 Lançamentos Detalhados</h2>
        <table>
            <thead>
                <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th>Tipo</th>
                    <th style="text-align: right;">Valor</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                ${lancamentos.map(lanc => {
                    const valor = parseFloat(lanc.valor);
                    return `
                        <tr>
                            <td>${new Date(lanc.data_vencimento).toLocaleDateString('pt-BR')}</td>
                            <td>${lanc.descricao}</td>
                            <td>
                                <span class="badge badge-${lanc.tipo.toLowerCase()}">
                                    ${lanc.tipo}
                                </span>
                            </td>
                            <td style="text-align: right; font-weight: 700; color: ${lanc.tipo === 'Receita' ? '#10b981' : '#ef4444'};">
                                R$ ${valor.toFixed(2).replace('.', ',')}
                            </td>
                            <td>
                                <span class="badge badge-${lanc.status === 'Pago' ? 'pago' : 'pendente'}">
                                    ${lanc.status}
                                </span>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    ` : `
        <div class="empty-state">
            <div class="icon">📭</div>
            <h3>Nenhum lançamento encontrado neste período</h3>
        </div>
    `}
    
    <div class="rodape">
        <p><strong>LawTech Pro</strong> - Sistema de Gestão Jurídica</p>
        <p>Relatório gerado automaticamente pelo sistema</p>
    </div>
</body>
</html>
            `;
            
            // Gerar PDF com Puppeteer
            const puppeteer = require('puppeteer');
            
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            
            const page = await browser.newPage();
            await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
            
            const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: {
                    top: '20mm',
                    right: '15mm',
                    bottom: '20mm',
                    left: '15mm'
                }
            });
            
            await browser.close();
            
            // Enviar PDF como download
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=Relatorio_Faturamento_${periodo.replace(/ /g, '_')}.pdf`);
            res.send(pdfBuffer);
            
        } catch (err) {
            console.error('❌ Erro ao gerar PDF:', err.message);
            res.status(500).json({ erro: 'Erro ao gerar PDF do relatório: ' + err.message });
        }
    }
);

// Função auxiliar para gerar HTML do PDF (não usado com PDFKit, mas útil para futuro)
function gerarHTMLPDF(escritorio, periodo, lancamentos, totais) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Relatório de Faturamento</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 40px; }
                .header { text-align: center; margin-bottom: 30px; }
                .resumo { background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th { background: #f1f5f9; padding: 10px; text-align: left; }
                td { padding: 10px; border-bottom: 1px solid #e2e8f0; }
                .positivo { color: #10b981; font-weight: bold; }
                .negativo { color: #ef4444; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>RELATÓRIO DE FATURAMENTO</h1>
                <h2>${periodo}</h2>
                <p>${escritorio.nome}</p>
            </div>
            
            <div class="resumo">
                <h3>Resumo Financeiro</h3>
                <p>Total Receitas: <span class="positivo">R$ ${totais.totalReceitas.toFixed(2)}</span></p>
                <p>Total Despesas: <span class="negativo">R$ ${totais.totalDespesas.toFixed(2)}</span></p>
                <p>Lucro Líquido: <span class="${totais.lucroLiquido >= 0 ? 'positivo' : 'negativo'}">R$ ${totais.lucroLiquido.toFixed(2)}</span></p>
            </div>
            
            <h3>Lançamentos Detalhados</h3>
            <table>
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Descrição</th>
                        <th>Tipo</th>
                        <th>Valor</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${lancamentos.map(lanc => `
                        <tr>
                            <td>${new Date(lanc.data_vencimento).toLocaleDateString('pt-BR')}</td>
                            <td>${lanc.descricao}</td>
                            <td>${lanc.tipo}</td>
                            <td class="${lanc.tipo === 'Receita' ? 'positivo' : 'negativo'}">R$ ${parseFloat(lanc.valor).toFixed(2)}</td>
                            <td>${lanc.status}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </body>
        </html>
    `;
}

// ============================================================
// 🔒 ROTAS AVANÇADAS - INTERMEDIÁRIO, AVANÇADO E PREMIUM
// (Integração com Asaas, geração de boletos)
// ============================================================

router.post('/financeiro/configurar-subconta', 
    authMiddleware, 
    planMiddleware.checkFeature('financeiro_avancado'),  // ✅ Feature diferente
    async (req, res) => {
        try {
            const escritorioId = req.user.escritorio_id;
            
            const esc = await pool.query(
                `SELECT nome, documento, email, TO_CHAR(data_nascimento, 'YYYY-MM-DD') as data_nascimento, 
                 endereco, cidade, estado, cep, banco_codigo, agencia, conta, conta_digito, renda_mensal 
                 FROM escritorios WHERE id = $1`, 
                [escritorioId]
            );
            const e = esc.rows[0];

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
                    accountDigit: String(e.conta_digito || '0'),
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
    }
);

router.post('/financeiro/gerar-boleto-honorarios', authMiddleware, async (req, res) => {
    try {
        const { clienteId, valor, vencimento, descricao } = req.body;

        // 1. BUSCAR A CHAVE DE API (SUBCONTA) DO ESCRITÓRIO LOGADO
        const escRes = await pool.query('SELECT asaas_api_key FROM escritorios WHERE id = $1', [req.user.escritorio_id]);
        const tokenCliente = escRes.rows[0]?.asaas_api_key;

        if (!tokenCliente) {
            return res.status(400).json({ erro: '⚠️ Este escritório não ativou o faturamento próprio nas configurações.' });
        }

        // 2. BUSCAR DADOS DO CLIENTE (PAGADOR) NO SEU BANCO
        const clienteRes = await pool.query('SELECT nome, documento, email FROM clientes WHERE id = $1', [clienteId]);
        const cliente = clienteRes.rows[0];

        if (!cliente) {
            return res.status(404).json({ erro: 'Cliente não encontrado no sistema.' });
        }

        const documentoLimpo = cliente.documento ? cliente.documento.replace(/\D/g, '') : '';

        // 3. BUSCAR OU CRIAR O CLIENTE DENTRO DA SUBCONTA DO ASAAS
        let asaasClienteId;
        try {
            // Busca usando o token do escritório cliente
            const buscaAsaas = await axios.get(
                `${process.env.ASAAS_URL}/customers?cpfCnpj=${documentoLimpo}`,
                { headers: { 'access_token': tokenCliente } }
            );

            if (buscaAsaas.data.data.length > 0) {
                asaasClienteId = buscaAsaas.data.data[0].id;
            } else {
                // Se não existe na subconta, cria um novo cliente lá dentro
                const novoClienteAsaas = await axios.post(`${process.env.ASAAS_URL}/customers`, {
                    name: cliente.nome,
                    cpfCnpj: documentoLimpo,
                    email: cliente.email
                }, { headers: { 'access_token': tokenCliente } });
                asaasClienteId = novoClienteAsaas.data.id;
            }
        } catch (e) {
            console.error('Erro ao gerenciar cliente no Asaas:', e.message);
            throw new Error('Falha ao sincronizar cliente com o gateway de pagamento.');
        }

        // 4. GERAR A COBRANÇA USANDO O TOKEN DO ESCRITÓRIO (BENEFICIÁRIO CORRETO)
        const cobranca = await axios.post(`${process.env.ASAAS_URL}/payments`, {
            customer: asaasClienteId,
            billingType: 'BOLETO',
            value: valor,
            dueDate: vencimento,
            description: descricao || 'Honorários Advocatícios',
            externalReference: `HON-${Date.now()}`
        }, { headers: { 'access_token': tokenCliente } }); // 🚀 Identidade do cliente garantida

        // Retorna a URL do boleto gerado com o cabeçalho do escritório dele
        res.json({ 
            ok: true, 
            url: cobranca.data.bankInvoiceUrl,
            invoiceId: cobranca.data.id 
        });

    } catch (err) {
        const msg = err.response?.data?.errors?.[0]?.description || err.message;
        console.error('❌ Erro ao gerar boleto:', msg);
        res.status(500).json({ erro: 'Erro ao gerar boleto: ' + msg });
    }
});

// Webhook Produção - Identifica automaticamente a subconta
router.post('/webhook/financeiro', async (req, res) => {
    // Responde 200 imediatamente para o Asaas não reenviar o post
    res.status(200).json({ received: true }); 

    try {
        const { event, payment, accountId } = req.body;

        // Filtramos apenas eventos de pagamento confirmado
        if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
            console.log(`💰 Pagamento confirmado: ${payment.id} para a subconta: ${accountId}`);

            // 1. Localizamos qual escritório possui esse asaas_id
            const escRes = await pool.query(
                'SELECT id FROM escritorios WHERE asaas_id = $1', 
                [accountId]
            );

            if (escRes.rows.length > 0) {
                const escritorioId = escRes.rows[0].id;

                // 2. Damos baixa no lançamento financeiro deste escritório
                // Usamos o asaas_id do pagamento para garantir que é a fatura correta
                await pool.query(
                    `UPDATE financeiro 
                     SET status = 'Pago', data_pagamento = NOW() 
                     WHERE asaas_id = $1 AND escritorio_id = $2`, 
                    [payment.id, escritorioId]
                );
                
                console.log(`✅ Baixa automática realizada para o escritório ID: ${escritorioId}`);
            } else {
                console.warn(`⚠️ Recebido pagamento para accountId ${accountId}, mas subconta não encontrada no banco.`);
            }
        }
    } catch (err) {
        console.error('❌ Erro no processamento do Webhook:', err.message);
    }
});

module.exports = router;