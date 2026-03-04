const pool = require('../config/db');
const crypto = require('crypto');

function getFeriadosNacionais(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
    const d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mesPascoa = Math.floor((h + l - 7 * m + 114) / 31);
    const diaPascoa = ((h + l - 7 * m + 114) % 31) + 1;
    const pascoa = new Date(ano, mesPascoa - 1, diaPascoa);

    function offsetDate(base, dias) {
        const d = new Date(base); d.setDate(d.getDate() + dias);
        return d.toISOString().split('T')[0];
    }
    const fmt = (m, d) => `${ano}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

    return [
        { titulo: 'Confraternização Universal',       data: fmt(1,1),              tipo: 'feriado',   abrangencia: 'nacional' },
        { titulo: 'Carnaval',                          data: offsetDate(pascoa,-47),tipo: 'feriado',   abrangencia: 'nacional' },
        { titulo: 'Quarta-feira de Cinzas (até 14h)', data: offsetDate(pascoa,-46),tipo: 'suspensao', abrangencia: 'nacional' },
        { titulo: 'Sexta-feira Santa',                 data: offsetDate(pascoa,-2), tipo: 'feriado',   abrangencia: 'nacional' },
        { titulo: 'Tiradentes',                        data: fmt(4,21),             tipo: 'feriado',   abrangencia: 'nacional' },
        { titulo: 'Dia do Trabalho',                   data: fmt(5,1),              tipo: 'feriado',   abrangencia: 'nacional' },
        { titulo: 'Corpus Christi',                    data: offsetDate(pascoa,60), tipo: 'feriado',   abrangencia: 'nacional' },
        { titulo: 'Independência do Brasil',           data: fmt(9,7),              tipo: 'feriado',   abrangencia: 'nacional' },
        { titulo: 'Nossa Sra. Aparecida',              data: fmt(10,12),            tipo: 'feriado',   abrangencia: 'nacional' },
        { titulo: 'Finados',                           data: fmt(11,2),             tipo: 'feriado',   abrangencia: 'nacional' },
        { titulo: 'Proclamação da República',          data: fmt(11,15),            tipo: 'feriado',   abrangencia: 'nacional' },
        { titulo: 'Dia da Justiça',                    data: fmt(12,8),             tipo: 'suspensao', abrangencia: 'nacional' },
        { titulo: 'Natal',                             data: fmt(12,25),            tipo: 'feriado',   abrangencia: 'nacional' },
        { titulo: 'Recesso Forense',                   data: fmt(12,20),            tipo: 'suspensao', abrangencia: 'nacional' },
        { titulo: 'Dia do Advogado',                   data: fmt(8,11),             tipo: 'suspensao', abrangencia: 'nacional' },
    ];
}

const TIPOS_COMPROMISSO = ['pagamento', 'reuniao', 'audiencia_externa', 'outro'];

const calendarioController = {

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
                  AND EXTRACT(YEAR FROM data)  = $3
                ORDER BY data
            `, [escritorioId, mes, ano]);
            res.json({ ok: true, feriados: result.rows });
        } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
    },

    async criarFeriado(req, res) {
        try {
            const escritorioId = req.user.escritorio_id;
            const { titulo, data, tipo, abrangencia, recorrente } = req.body;
            if (!titulo || !data || !tipo)
                return res.status(400).json({ ok: false, erro: 'Título, data e tipo são obrigatórios' });
            if (!['feriado','suspensao'].includes(tipo))
                return res.status(400).json({ ok: false, erro: 'Tipo deve ser feriado ou suspensao' });
            const result = await pool.query(`
                INSERT INTO feriados_suspensoes (escritorio_id, titulo, data, tipo, abrangencia, recorrente)
                VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
            `, [escritorioId, titulo, data, tipo, abrangencia || 'local', recorrente || false]);
            res.json({ ok: true, feriado: result.rows[0] });
        } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
    },

    async deletarFeriado(req, res) {
        try {
            const { id } = req.params;
            const result = await pool.query(
                'DELETE FROM feriados_suspensoes WHERE id = $1 AND escritorio_id = $2 RETURNING id',
                [id, req.user.escritorio_id]
            );
            if (result.rowCount === 0)
                return res.status(404).json({ ok: false, erro: 'Feriado não encontrado' });
            res.json({ ok: true });
        } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
    },

    async inicializarFeriados(req, res) {
        try {
            const escritorioId = req.user.escritorio_id;
            const ano = parseInt(req.body.ano) || new Date().getFullYear();
            const feriados = getFeriadosNacionais(ano);
            let inseridos = 0;
            for (const f of feriados) {
                const existe = await pool.query(
                    'SELECT id FROM feriados_suspensoes WHERE escritorio_id=$1 AND data=$2 AND titulo=$3',
                    [escritorioId, f.data, f.titulo]
                );
                if (existe.rowCount === 0) {
                    await pool.query(
                        'INSERT INTO feriados_suspensoes (escritorio_id,titulo,data,tipo,abrangencia,recorrente) VALUES ($1,$2,$3,$4,$5,false)',
                        [escritorioId, f.titulo, f.data, f.tipo, f.abrangencia]
                    );
                    inseridos++;
                }
            }
            res.json({ ok: true, mensagem: `${inseridos} feriados nacionais de ${ano} carregados`, total: feriados.length });
        } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
    },

    // GET /api/calendario/mensal?mes=MM&ano=YYYY
    async dadosMensal(req, res) {
        try {
            const escritorioId = req.user.escritorio_id;
            const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
            const ano = parseInt(req.query.ano) || new Date().getFullYear();

            const [prazosResult, feriadosResult, compromissosResult] = await Promise.all([
                pool.query(`
                    SELECT p.id, p.tipo, p.descricao, p.data_limite, p.status,
                           pr.numero AS processo, c.nome AS cliente
                    FROM prazos p
                    LEFT JOIN processos pr ON p.processo_id = pr.id
                    LEFT JOIN clientes c   ON p.cliente_id  = c.id
                    WHERE p.escritorio_id = $1
                      AND EXTRACT(MONTH FROM p.data_limite) = $2
                      AND EXTRACT(YEAR  FROM p.data_limite) = $3
                      AND p.status NOT IN ('concluido','deletado')
                      AND (p.deletado IS NULL OR p.deletado = false)
                    ORDER BY p.data_limite
                `, [escritorioId, mes, ano]),

                pool.query(`
                    SELECT id, titulo, data, tipo, abrangencia, recorrente
                    FROM feriados_suspensoes
                    WHERE escritorio_id = $1
                      AND EXTRACT(MONTH FROM data) = $2
                      AND EXTRACT(YEAR  FROM data) = $3
                    ORDER BY data
                `, [escritorioId, mes, ano]),

                pool.query(`
                    SELECT c.id, c.titulo, TO_CHAR(c.data, 'YYYY-MM-DD') AS data, c.tipo, c.valor,
                           c.observacao, c.parcela_atual, c.total_parcelas, c.grupo_id,
                           COALESCE(cl.nome, cl2.nome) AS cliente_nome,
                           pr.numero AS processo_numero
                    FROM compromissos c
                    LEFT JOIN clientes  cl  ON c.cliente_id  = cl.id
                    LEFT JOIN processos pr  ON c.processo_id = pr.id
                    LEFT JOIN clientes  cl2 ON pr.cliente_id = cl2.id
                    WHERE c.escritorio_id = $1
                      AND EXTRACT(MONTH FROM c.data) = $2
                      AND EXTRACT(YEAR  FROM c.data) = $3
                    ORDER BY c.data
                `, [escritorioId, mes, ano])
            ]);

            res.json({
                ok: true, mes, ano,
                prazos:       prazosResult.rows,
                feriados:     feriadosResult.rows,
                compromissos: compromissosResult.rows
            });
        } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
    },

    // POST /api/calendario/compromissos
    async criarCompromisso(req, res) {
        try {
            const escritorioId = req.user.escritorio_id;
            const { titulo, data, tipo, valor, processo_id, cliente_id, observacao, recorrente_meses } = req.body;

            if (!titulo || !data || !tipo)
                return res.status(400).json({ ok: false, erro: 'Título, data e tipo são obrigatórios' });
            if (!TIPOS_COMPROMISSO.includes(tipo))
                return res.status(400).json({ ok: false, erro: 'Tipo inválido' });

            const totalParcelas = Math.max(1, parseInt(recorrente_meses) || 1);
            const grupoId = totalParcelas > 1 ? crypto.randomUUID() : null;
            const dataBase = new Date(data + 'T12:00:00Z');
            const inseridos = [];

            for (let i = 0; i < totalParcelas; i++) {
                const dataParc = new Date(dataBase);
                dataParc.setMonth(dataParc.getMonth() + i);
                const dataStr = dataParc.toISOString().split('T')[0];
                const tituloParc = totalParcelas > 1 ? `${titulo} (${i+1}/${totalParcelas})` : titulo;

                const result = await pool.query(`
                    INSERT INTO compromissos
                        (escritorio_id, titulo, data, tipo, valor,
                         processo_id, cliente_id, observacao,
                         parcela_atual, total_parcelas, grupo_id)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                    RETURNING *
                `, [
                    escritorioId, tituloParc, dataStr, tipo,
                    valor       || null,
                    processo_id || null,
                    cliente_id  || null,
                    observacao  || null,
                    i + 1, totalParcelas, grupoId
                ]);
                inseridos.push(result.rows[0]);
            }

            res.json({ ok: true, compromissos: inseridos, total: inseridos.length });
        } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
    },

    // DELETE /api/calendario/compromissos/:id?todos_do_grupo=true
    async deletarCompromisso(req, res) {
        try {
            const escritorioId = req.user.escritorio_id;
            const { id } = req.params;
            const todosGrupo = req.query.todos_do_grupo === 'true';

            if (todosGrupo) {
                const ref = await pool.query(
                    'SELECT grupo_id FROM compromissos WHERE id=$1 AND escritorio_id=$2',
                    [id, escritorioId]
                );
                if (ref.rowCount > 0 && ref.rows[0].grupo_id) {
                    await pool.query(
                        'DELETE FROM compromissos WHERE grupo_id=$1 AND escritorio_id=$2',
                        [ref.rows[0].grupo_id, escritorioId]
                    );
                    return res.json({ ok: true, mensagem: 'Todas as parcelas removidas' });
                }
            }

            const result = await pool.query(
                'DELETE FROM compromissos WHERE id=$1 AND escritorio_id=$2 RETURNING id',
                [id, escritorioId]
            );
            if (result.rowCount === 0)
                return res.status(404).json({ ok: false, erro: 'Compromisso não encontrado' });

            res.json({ ok: true });
        } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
    }
};

module.exports = calendarioController;