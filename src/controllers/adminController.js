// src/controllers/adminController.js
const pool = require('../config/db');

/**
 * 📊 LawTech Systems - Estatísticas Gerais
 */
exports.estatisticasGerais = async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM escritorios) as total_escritorios,
                (SELECT COUNT(*) FROM escritorios WHERE plano_ativo = 'BASICO') as plano_basico,
                (SELECT COUNT(*) FROM escritorios WHERE plano_ativo = 'INTERMEDIARIO') as plano_intermediario,
                (SELECT COUNT(*) FROM escritorios WHERE plano_ativo = 'AVANCADO') as plano_avancado,
                (SELECT COUNT(*) FROM escritorios WHERE plano_ativo = 'PREMIUM') as plano_premium,
                (SELECT COUNT(*) FROM usuarios) as total_usuarios,
                (SELECT COUNT(*) FROM processos) as total_processos,
                (SELECT COUNT(*) FROM prazos) as total_prazos,
                (SELECT COUNT(*) FROM prazos WHERE status = 'pendente') as prazos_pendentes,
                (SELECT COUNT(*) FROM publicacoes) as total_publicacoes
        `);

        res.json({
            ok: true,
            stats: stats.rows[0]
        });

    } catch (erro) {
        console.error('❌ [ADMIN] Erro nas estatísticas:', erro);
        res.status(500).json({
            ok: false,
            erro: 'Erro ao buscar estatísticas'
        });
    }
};

/**
 * 📋 LawTech Systems - Listar todos os escritórios
 */
exports.listarEscritorios = async (req, res) => {
    try {
        const query = `
            SELECT 
                e.id,
                e.nome,
                e.advogado_responsavel,
                e.oab,
                e.email,
                e.plano_ativo,
                e.criado_em as data_criacao,
                e.trial_expira_em as plano_expira_em,
                e.asaas_customer_id,
                COUNT(DISTINCT u.id) as total_usuarios,
                COUNT(DISTINCT p.id) as total_processos,
                COUNT(DISTINCT pr.id) as total_prazos
            FROM escritorios e
            LEFT JOIN usuarios u ON u.escritorio_id = e.id
            LEFT JOIN processos p ON p.escritorio_id = e.id
            LEFT JOIN prazos pr ON pr.escritorio_id = e.id
            GROUP BY e.id
            ORDER BY e.criado_em DESC
        `;

        const result = await pool.query(query);

        res.json({
            ok: true,
            total: result.rows.length,
            escritorios: result.rows
        });

    } catch (erro) {
        console.error('❌ [ADMIN] Erro ao listar escritórios:', erro);
        res.status(500).json({
            ok: false,
            erro: 'Erro ao buscar dados dos escritórios'
        });
    }
};

/**
 * 🔍 LawTech Systems - Detalhes de um escritório
 */
exports.detalhesEscritorio = async (req, res) => {
    try {
        const { id } = req.params;

        const escritorio = await pool.query(`
            SELECT 
                e.*,
                COUNT(DISTINCT u.id) as total_usuarios,
                COUNT(DISTINCT p.id) as total_processos,
                COUNT(DISTINCT pr.id) as total_prazos,
                COUNT(DISTINCT c.id) as total_clientes
            FROM escritorios e
            LEFT JOIN usuarios u ON u.escritorio_id = e.id
            LEFT JOIN processos p ON p.escritorio_id = e.id
            LEFT JOIN prazos pr ON pr.escritorio_id = e.id
            LEFT JOIN clientes c ON c.escritorio_id = e.id
            WHERE e.id = $1
            GROUP BY e.id
        `, [id]);

        if (escritorio.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                erro: 'Escritório não encontrado'
            });
        }

        res.json({
            ok: true,
            escritorio: escritorio.rows[0]
        });

    } catch (erro) {
        console.error('❌ [ADMIN] Erro nos detalhes:', erro);
        res.status(500).json({
            ok: false,
            erro: 'Erro ao buscar detalhes do escritório'
        });
    }
};

/**
 * 🗂️ LawTech Systems - Logs do Sistema
 */
exports.getLogsSistema = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                l.id, 
                l.servico, 
                l.tipo_erro, 
                l.mensagem_erro, 
                l.criado_em,
                e.advogado_responsavel,
                e.oab,
                e.uf
            FROM logs_sistema l
            JOIN escritorios e ON l.escritorio_id = e.id
            ORDER BY l.criado_em DESC
            LIMIT 50
        `);

        res.json({
            ok: true,
            total: result.rowCount,
            logs: result.rows
        });
    } catch (err) {
        console.error('❌ [ADMIN] Erro ao carregar logs:', err.message);
        res.status(500).json({ 
            ok: false, 
            erro: 'Erro ao carregar logs administrativos' 
        });
    }
};