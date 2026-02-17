const pool = require('../config/db');

// Helper: converte ?periodo= em {inicio, fim}
function getDateRange(req) {
    const periodo = req.query.periodo || '30d';
    let inicio = req.query.inicio;
    let fim = req.query.fim;

    if (periodo !== 'custom' || !inicio || !fim) {
        fim = new Date().toISOString().split('T')[0];
        const now = new Date();
        switch (periodo) {
            case '90d':  now.setDate(now.getDate() - 90); break;
            case '6m':   now.setMonth(now.getMonth() - 6); break;
            case '12m':  now.setFullYear(now.getFullYear() - 1); break;
            default:     now.setDate(now.getDate() - 30); break;
        }
        inicio = now.toISOString().split('T')[0];
    }

    return { inicio, fim };
}

// 1. FINANCEIRO
exports.financeiro = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const { inicio, fim } = getDateRange(req);

        // Receitas vs Despesas mensal
        const mensal = await pool.query(`
            SELECT TO_CHAR(f.data_vencimento, 'YYYY-MM') as mes,
                   COALESCE(SUM(CASE WHEN f.tipo = 'Receita' THEN f.valor ELSE 0 END), 0) as receitas,
                   COALESCE(SUM(CASE WHEN f.tipo = 'Despesa' THEN f.valor ELSE 0 END), 0) as despesas
            FROM financeiro f
            JOIN usuarios u ON u.id = f.usuario_id
            WHERE u.escritorio_id = $1
              AND f.data_vencimento BETWEEN $2 AND $3
            GROUP BY mes ORDER BY mes
        `, [escritorioId, inicio, fim]);

        // Totais
        const totais = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN f.tipo = 'Receita' AND f.status = 'Pago' THEN f.valor ELSE 0 END), 0) as recebido,
                COALESCE(SUM(CASE WHEN f.tipo = 'Receita' AND f.status != 'Pago' THEN f.valor ELSE 0 END), 0) as a_receber,
                COALESCE(SUM(CASE WHEN f.tipo = 'Despesa' AND f.status = 'Pago' THEN f.valor ELSE 0 END), 0) as pago,
                COALESCE(SUM(CASE WHEN f.tipo = 'Despesa' AND f.status != 'Pago' THEN f.valor ELSE 0 END), 0) as a_pagar
            FROM financeiro f
            JOIN usuarios u ON u.id = f.usuario_id
            WHERE u.escritorio_id = $1
              AND f.data_vencimento BETWEEN $2 AND $3
        `, [escritorioId, inicio, fim]);

        // Top categorias
        const categorias = await pool.query(`
            SELECT f.descricao as categoria,
                   f.tipo,
                   COALESCE(SUM(f.valor), 0) as total
            FROM financeiro f
            JOIN usuarios u ON u.id = f.usuario_id
            WHERE u.escritorio_id = $1
              AND f.data_vencimento BETWEEN $2 AND $3
            GROUP BY f.descricao, f.tipo
            ORDER BY total DESC
            LIMIT 10
        `, [escritorioId, inicio, fim]);

        res.json({
            ok: true,
            mensal: mensal.rows,
            totais: totais.rows[0],
            categorias: categorias.rows
        });
    } catch (err) {
        console.error('[RELATORIOS] Erro financeiro:', err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// 2. PRAZOS
exports.prazos = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const { inicio, fim } = getDateRange(req);

        // Cumprimento geral
        const cumprimento = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'concluido') as concluidos,
                COUNT(*) FILTER (WHERE status = 'atrasado') as atrasados,
                COUNT(*) FILTER (WHERE status IN ('aberto', 'hoje', 'pendente')) as abertos,
                COUNT(*) as total
            FROM prazos
            WHERE escritorio_id = $1 AND deletado = false
              AND created_at BETWEEN $2 AND $3
        `, [escritorioId, inicio, fim]);

        // Por tipo
        const porTipo = await pool.query(`
            SELECT COALESCE(tipo, 'Outros') as tipo, COUNT(*) as total
            FROM prazos
            WHERE escritorio_id = $1 AND deletado = false
              AND created_at BETWEEN $2 AND $3
            GROUP BY tipo ORDER BY total DESC
        `, [escritorioId, inicio, fim]);

        // Evolução mensal
        const evolucao = await pool.query(`
            SELECT TO_CHAR(created_at, 'YYYY-MM') as mes,
                   COUNT(*) FILTER (WHERE status = 'concluido') as concluidos,
                   COUNT(*) FILTER (WHERE status = 'atrasado') as atrasados,
                   COUNT(*) FILTER (WHERE status IN ('aberto', 'hoje', 'pendente')) as abertos
            FROM prazos
            WHERE escritorio_id = $1 AND deletado = false
              AND created_at BETWEEN $2 AND $3
            GROUP BY mes ORDER BY mes
        `, [escritorioId, inicio, fim]);

        res.json({
            ok: true,
            cumprimento: cumprimento.rows[0],
            porTipo: porTipo.rows,
            evolucao: evolucao.rows
        });
    } catch (err) {
        console.error('[RELATORIOS] Erro prazos:', err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// 3. PROCESSOS
exports.processos = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;

        const porTribunal = await pool.query(`
            SELECT COALESCE(tribunal, 'Não informado') as tribunal, COUNT(*) as total
            FROM processos WHERE escritorio_id = $1
            GROUP BY tribunal ORDER BY total DESC LIMIT 15
        `, [escritorioId]);

        const porEsfera = await pool.query(`
            SELECT COALESCE(esfera, 'Não informada') as esfera, COUNT(*) as total
            FROM processos WHERE escritorio_id = $1
            GROUP BY esfera ORDER BY total DESC
        `, [escritorioId]);

        const porUf = await pool.query(`
            SELECT COALESCE(uf, 'N/A') as uf, COUNT(*) as total
            FROM processos WHERE escritorio_id = $1
            GROUP BY uf ORDER BY total DESC
        `, [escritorioId]);

        const porStatus = await pool.query(`
            SELECT COALESCE(status, 'Ativo') as status, COUNT(*) as total
            FROM processos WHERE escritorio_id = $1
            GROUP BY status ORDER BY total DESC
        `, [escritorioId]);

        const totalProcessos = await pool.query(`
            SELECT COUNT(*) as total FROM processos WHERE escritorio_id = $1
        `, [escritorioId]);

        res.json({
            ok: true,
            porTribunal: porTribunal.rows,
            porEsfera: porEsfera.rows,
            porUf: porUf.rows,
            porStatus: porStatus.rows,
            total: parseInt(totalProcessos.rows[0].total)
        });
    } catch (err) {
        console.error('[RELATORIOS] Erro processos:', err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// 4. PRODUTIVIDADE
exports.produtividade = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const { inicio, fim } = getDateRange(req);

        // Prazos por usuário
        const prazosPorUsuario = await pool.query(`
            SELECT u.nome as usuario,
                   COUNT(*) as total,
                   COUNT(*) FILTER (WHERE p.status = 'concluido') as concluidos,
                   COUNT(*) FILTER (WHERE p.status = 'atrasado') as atrasados
            FROM prazos p
            JOIN usuarios u ON u.id = p.usuario_id
            WHERE p.escritorio_id = $1 AND p.deletado = false
              AND p.created_at BETWEEN $2 AND $3
            GROUP BY u.nome ORDER BY total DESC
        `, [escritorioId, inicio, fim]);

        // Audiências por usuário
        const audienciasPorUsuario = await pool.query(`
            SELECT u.nome as usuario, COUNT(*) as total
            FROM audiencias a
            JOIN processos pr ON pr.id = a.processo_id
            JOIN usuarios u ON u.id = a.usuario_id
            WHERE pr.escritorio_id = $1
              AND a.data_audiencia BETWEEN $2 AND $3
            GROUP BY u.nome ORDER BY total DESC
        `, [escritorioId, inicio, fim]);

        res.json({
            ok: true,
            prazosPorUsuario: prazosPorUsuario.rows,
            audienciasPorUsuario: audienciasPorUsuario.rows
        });
    } catch (err) {
        console.error('[RELATORIOS] Erro produtividade:', err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
};

// 5. CRM
exports.crm = async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const { inicio, fim } = getDateRange(req);

        // Funil por status
        const funil = await pool.query(`
            SELECT status, COUNT(*) as total
            FROM leads
            WHERE escritorio_id = $1
              AND data_criacao BETWEEN $2 AND $3
            GROUP BY status
            ORDER BY CASE status
                WHEN 'Novo' THEN 1
                WHEN 'Novo Lead' THEN 2
                WHEN 'Em Contato' THEN 3
                WHEN 'Agendado' THEN 4
                WHEN 'Ganho' THEN 5
                WHEN 'Perdido' THEN 6
                ELSE 7
            END
        `, [escritorioId, inicio, fim]);

        // Por origem
        const porOrigem = await pool.query(`
            SELECT COALESCE(origem, 'Não informada') as origem, COUNT(*) as total
            FROM leads
            WHERE escritorio_id = $1
              AND data_criacao BETWEEN $2 AND $3
            GROUP BY origem ORDER BY total DESC
        `, [escritorioId, inicio, fim]);

        // Taxa de conversão
        const conversao = await pool.query(`
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'Ganho') as ganhos
            FROM leads
            WHERE escritorio_id = $1
              AND data_criacao BETWEEN $2 AND $3
        `, [escritorioId, inicio, fim]);

        // Evolução mensal
        const evolucao = await pool.query(`
            SELECT TO_CHAR(data_criacao, 'YYYY-MM') as mes,
                   COUNT(*) as total,
                   COUNT(*) FILTER (WHERE status = 'Ganho') as ganhos
            FROM leads
            WHERE escritorio_id = $1
              AND data_criacao BETWEEN $2 AND $3
            GROUP BY mes ORDER BY mes
        `, [escritorioId, inicio, fim]);

        res.json({
            ok: true,
            funil: funil.rows,
            porOrigem: porOrigem.rows,
            conversao: conversao.rows[0],
            evolucao: evolucao.rows
        });
    } catch (err) {
        console.error('[RELATORIOS] Erro CRM:', err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
};
