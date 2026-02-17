const pool = require('../config/db');

// Feriados nacionais fixos + móveis (calculados por ano)
function getFeriadosNacionais(ano) {
    // Páscoa (algoritmo de Gauss)
    const a = ano % 19;
    const b = Math.floor(ano / 100);
    const c = ano % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mesPascoa = Math.floor((h + l - 7 * m + 114) / 31);
    const diaPascoa = ((h + l - 7 * m + 114) % 31) + 1;
    const pascoa = new Date(ano, mesPascoa - 1, diaPascoa);

    function offsetDate(base, dias) {
        const d = new Date(base);
        d.setDate(d.getDate() + dias);
        return d.toISOString().split('T')[0];
    }

    const fmt = (m, d) => `${ano}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    return [
        { titulo: 'Confraternização Universal', data: fmt(1, 1), tipo: 'feriado', abrangencia: 'nacional' },
        { titulo: 'Carnaval', data: offsetDate(pascoa, -47), tipo: 'feriado', abrangencia: 'nacional' },
        { titulo: 'Quarta-feira de Cinzas (até 14h)', data: offsetDate(pascoa, -46), tipo: 'suspensao', abrangencia: 'nacional' },
        { titulo: 'Sexta-feira Santa', data: offsetDate(pascoa, -2), tipo: 'feriado', abrangencia: 'nacional' },
        { titulo: 'Tiradentes', data: fmt(4, 21), tipo: 'feriado', abrangencia: 'nacional' },
        { titulo: 'Dia do Trabalho', data: fmt(5, 1), tipo: 'feriado', abrangencia: 'nacional' },
        { titulo: 'Corpus Christi', data: offsetDate(pascoa, 60), tipo: 'feriado', abrangencia: 'nacional' },
        { titulo: 'Independência do Brasil', data: fmt(9, 7), tipo: 'feriado', abrangencia: 'nacional' },
        { titulo: 'Nossa Sra. Aparecida', data: fmt(10, 12), tipo: 'feriado', abrangencia: 'nacional' },
        { titulo: 'Finados', data: fmt(11, 2), tipo: 'feriado', abrangencia: 'nacional' },
        { titulo: 'Proclamação da República', data: fmt(11, 15), tipo: 'feriado', abrangencia: 'nacional' },
        { titulo: 'Dia da Justiça', data: fmt(12, 8), tipo: 'suspensao', abrangencia: 'nacional' },
        { titulo: 'Natal', data: fmt(12, 25), tipo: 'feriado', abrangencia: 'nacional' },
        { titulo: 'Recesso Forense', data: fmt(12, 20), tipo: 'suspensao', abrangencia: 'nacional' },
        { titulo: 'Dia do Advogado', data: fmt(8, 11), tipo: 'suspensao', abrangencia: 'nacional' },
    ];
}

const calendarioController = {
    // GET /api/calendario/feriados?mes=MM&ano=YYYY
    async listarFeriados(req, res) {
        try {
            const escritorioId = req.user.escritorio_id;
            const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
            const ano = parseInt(req.query.ano) || new Date().getFullYear();

            const result = await pool.query(`
                SELECT id, titulo, data, tipo, abrangencia, recorrente
                FROM feriados_suspensoes
                WHERE escritorio_id = $1
                  AND EXTRACT(MONTH FROM data) = $2
                  AND EXTRACT(YEAR FROM data) = $3
                ORDER BY data
            `, [escritorioId, mes, ano]);

            res.json({ ok: true, feriados: result.rows });
        } catch (err) {
            res.status(500).json({ ok: false, erro: err.message });
        }
    },

    // POST /api/calendario/feriados
    async criarFeriado(req, res) {
        try {
            const escritorioId = req.user.escritorio_id;
            const { titulo, data, tipo, abrangencia, recorrente } = req.body;

            if (!titulo || !data || !tipo) {
                return res.status(400).json({ ok: false, erro: 'Título, data e tipo são obrigatórios' });
            }
            if (!['feriado', 'suspensao'].includes(tipo)) {
                return res.status(400).json({ ok: false, erro: 'Tipo deve ser feriado ou suspensao' });
            }

            const result = await pool.query(`
                INSERT INTO feriados_suspensoes (escritorio_id, titulo, data, tipo, abrangencia, recorrente)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `, [escritorioId, titulo, data, tipo, abrangencia || 'local', recorrente || false]);

            res.json({ ok: true, feriado: result.rows[0] });
        } catch (err) {
            res.status(500).json({ ok: false, erro: err.message });
        }
    },

    // DELETE /api/calendario/feriados/:id
    async deletarFeriado(req, res) {
        try {
            const escritorioId = req.user.escritorio_id;
            const { id } = req.params;

            const result = await pool.query(
                'DELETE FROM feriados_suspensoes WHERE id = $1 AND escritorio_id = $2 RETURNING id',
                [id, escritorioId]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({ ok: false, erro: 'Feriado não encontrado' });
            }

            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ ok: false, erro: err.message });
        }
    },

    // GET /api/calendario/mensal?mes=MM&ano=YYYY
    async dadosMensal(req, res) {
        try {
            const escritorioId = req.user.escritorio_id;
            const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
            const ano = parseInt(req.query.ano) || new Date().getFullYear();

            // Prazos do mês (não deletados, não concluídos)
            const prazosResult = await pool.query(`
                SELECT p.id, p.tipo, p.descricao, p.data_limite, p.status,
                       pr.numero AS processo, c.nome AS cliente
                FROM prazos p
                LEFT JOIN processos pr ON p.processo_id = pr.id
                LEFT JOIN clientes c ON p.cliente_id = c.id
                WHERE p.escritorio_id = $1
                  AND EXTRACT(MONTH FROM p.data_limite) = $2
                  AND EXTRACT(YEAR FROM p.data_limite) = $3
                  AND p.status NOT IN ('concluido', 'deletado')
                  AND (p.deletado IS NULL OR p.deletado = false)
                ORDER BY p.data_limite
            `, [escritorioId, mes, ano]);

            // Feriados do mês
            const feriadosResult = await pool.query(`
                SELECT id, titulo, data, tipo, abrangencia, recorrente
                FROM feriados_suspensoes
                WHERE escritorio_id = $1
                  AND EXTRACT(MONTH FROM data) = $2
                  AND EXTRACT(YEAR FROM data) = $3
                ORDER BY data
            `, [escritorioId, mes, ano]);

            res.json({
                ok: true,
                mes, ano,
                prazos: prazosResult.rows,
                feriados: feriadosResult.rows
            });
        } catch (err) {
            res.status(500).json({ ok: false, erro: err.message });
        }
    },

    // POST /api/calendario/feriados/inicializar
    async inicializarFeriados(req, res) {
        try {
            const escritorioId = req.user.escritorio_id;
            const ano = parseInt(req.body.ano) || new Date().getFullYear();
            const feriados = getFeriadosNacionais(ano);

            let inseridos = 0;
            for (const f of feriados) {
                // Evita duplicatas
                const existe = await pool.query(
                    'SELECT id FROM feriados_suspensoes WHERE escritorio_id = $1 AND data = $2 AND titulo = $3',
                    [escritorioId, f.data, f.titulo]
                );
                if (existe.rowCount === 0) {
                    await pool.query(
                        'INSERT INTO feriados_suspensoes (escritorio_id, titulo, data, tipo, abrangencia, recorrente) VALUES ($1, $2, $3, $4, $5, false)',
                        [escritorioId, f.titulo, f.data, f.tipo, f.abrangencia]
                    );
                    inseridos++;
                }
            }

            res.json({ ok: true, mensagem: `${inseridos} feriados nacionais de ${ano} carregados`, total: feriados.length });
        } catch (err) {
            res.status(500).json({ ok: false, erro: err.message });
        }
    }
};

module.exports = calendarioController;
