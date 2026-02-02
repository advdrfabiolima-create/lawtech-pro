const pool = require('../config/db');

/**
 * CONTROLLER: Partes do Processo
 * Gerencia múltiplas partes (autores, réus, litisconsortes) de um processo
 */

// ============================================================
// 1. LISTAR TODAS AS PARTES DE UM PROCESSO
// ============================================================
async function listarPartesPorProcesso(req, res) {
    const { processoId } = req.params;
    const escritorioId = req.user.escritorio_id;

    try {
        const query = `
            SELECT 
                pp.id,
                pp.processo_id,
                pp.pessoa_id,
                pp.pessoa_nome,
                pp.polo,
                pp.tipo_parte,
                pp.eh_principal,
                pp.observacoes,
                c.email as pessoa_email,
                c.telefone as pessoa_telefone,
                c.documento as pessoa_documento
            FROM partes_processo pp
            LEFT JOIN clientes c ON pp.pessoa_id = c.id
            WHERE pp.processo_id = $1 
            AND pp.escritorio_id = $2
            ORDER BY 
                pp.polo ASC,
                pp.eh_principal DESC,
                pp.pessoa_nome ASC
        `;

        const result = await pool.query(query, [processoId, escritorioId]);

        // Organizar por polo
        const partesOrganizadas = {
            ativo: result.rows.filter(p => p.polo === 'ativo'),
            passivo: result.rows.filter(p => p.polo === 'passivo')
        };

        res.json({
            ok: true,
            partes: result.rows,
            partesOrganizadas
        });

    } catch (err) {
        console.error('Erro ao listar partes:', err.message);
        res.status(500).json({ 
            erro: 'Erro ao carregar partes do processo',
            detalhes: err.message 
        });
    }
}

// ============================================================
// 2. ADICIONAR NOVA PARTE AO PROCESSO
// ============================================================
async function adicionarParte(req, res) {
    const { processoId } = req.params;
    const { pessoa_id, pessoa_nome, polo, tipo_parte, eh_principal, observacoes } = req.body;
    const escritorioId = req.user.escritorio_id;

    // Validações
    if (!pessoa_nome || !polo) {
        return res.status(400).json({ 
            erro: 'Nome da pessoa e polo são obrigatórios' 
        });
    }

    if (!['ativo', 'passivo'].includes(polo)) {
        return res.status(400).json({ 
            erro: 'Polo deve ser "ativo" ou "passivo"' 
        });
    }

    try {
        // Verificar se o processo pertence ao escritório
        const processoCheck = await pool.query(
            'SELECT id FROM processos WHERE id = $1 AND escritorio_id = $2',
            [processoId, escritorioId]
        );

        if (processoCheck.rows.length === 0) {
            return res.status(404).json({ 
                erro: 'Processo não encontrado ou sem permissão' 
            });
        }

        // Se marcar como principal, desmarcar as outras partes principais do mesmo polo
        if (eh_principal) {
            await pool.query(
                `UPDATE partes_processo 
                 SET eh_principal = FALSE 
                 WHERE processo_id = $1 
                 AND polo = $2 
                 AND escritorio_id = $3`,
                [processoId, polo, escritorioId]
            );
        }

        // Inserir nova parte
        const result = await pool.query(
            `INSERT INTO partes_processo (
                processo_id, pessoa_id, pessoa_nome, polo, 
                tipo_parte, eh_principal, observacoes, escritorio_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *`,
            [
                processoId,
                pessoa_id || null,
                pessoa_nome.trim(),
                polo,
                tipo_parte || (polo === 'ativo' ? 'autor' : 'reu'),
                eh_principal || false,
                observacoes || null,
                escritorioId
            ]
        );

        console.log(`✅ Parte adicionada ao processo ${processoId}: ${pessoa_nome} (${polo})`);

        res.status(201).json({
            ok: true,
            mensagem: 'Parte adicionada com sucesso',
            parte: result.rows[0]
        });

    } catch (err) {
        console.error('Erro ao adicionar parte:', err.message);
        
        if (err.code === '23505') { // Violação de unique constraint
            return res.status(400).json({ 
                erro: 'Esta parte já está cadastrada neste processo' 
            });
        }

        res.status(500).json({ 
            erro: 'Erro ao adicionar parte',
            detalhes: err.message 
        });
    }
}

// ============================================================
// 3. ATUALIZAR PARTE DO PROCESSO
// ============================================================
async function atualizarParte(req, res) {
    const { parteId } = req.params;
    const { pessoa_nome, tipo_parte, eh_principal, observacoes } = req.body;
    const escritorioId = req.user.escritorio_id;

    try {
        // Buscar parte atual
        const parteAtual = await pool.query(
            'SELECT processo_id, polo FROM partes_processo WHERE id = $1 AND escritorio_id = $2',
            [parteId, escritorioId]
        );

        if (parteAtual.rows.length === 0) {
            return res.status(404).json({ 
                erro: 'Parte não encontrada ou sem permissão' 
            });
        }

        const { processo_id, polo } = parteAtual.rows[0];

        // Se marcar como principal, desmarcar as outras
        if (eh_principal) {
            await pool.query(
                `UPDATE partes_processo 
                 SET eh_principal = FALSE 
                 WHERE processo_id = $1 
                 AND polo = $2 
                 AND id != $3 
                 AND escritorio_id = $4`,
                [processo_id, polo, parteId, escritorioId]
            );
        }

        // Atualizar parte
        const result = await pool.query(
            `UPDATE partes_processo 
             SET pessoa_nome = COALESCE($1, pessoa_nome),
                 tipo_parte = COALESCE($2, tipo_parte),
                 eh_principal = COALESCE($3, eh_principal),
                 observacoes = $4
             WHERE id = $5 
             AND escritorio_id = $6
             RETURNING *`,
            [
                pessoa_nome?.trim(),
                tipo_parte,
                eh_principal,
                observacoes,
                parteId,
                escritorioId
            ]
        );

        console.log(`✅ Parte ${parteId} atualizada`);

        res.json({
            ok: true,
            mensagem: 'Parte atualizada com sucesso',
            parte: result.rows[0]
        });

    } catch (err) {
        console.error('Erro ao atualizar parte:', err.message);
        res.status(500).json({ 
            erro: 'Erro ao atualizar parte',
            detalhes: err.message 
        });
    }
}

// ============================================================
// 4. REMOVER PARTE DO PROCESSO
// ============================================================
async function removerParte(req, res) {
    const { parteId } = req.params;
    const escritorioId = req.user.escritorio_id;

    try {
        // Verificar se é a única parte do polo
        const verificacao = await pool.query(
            `SELECT p.processo_id, p.polo,
                    (SELECT COUNT(*) FROM partes_processo 
                     WHERE processo_id = p.processo_id 
                     AND polo = p.polo) as total_polo
             FROM partes_processo p
             WHERE p.id = $1 AND p.escritorio_id = $2`,
            [parteId, escritorioId]
        );

        if (verificacao.rows.length === 0) {
            return res.status(404).json({ 
                erro: 'Parte não encontrada ou sem permissão' 
            });
        }

        const { total_polo } = verificacao.rows[0];

        if (total_polo === 1) {
            return res.status(400).json({ 
                erro: 'Não é possível remover a única parte deste polo. Todo processo deve ter pelo menos um autor e um réu.',
                sugestao: 'Adicione outra parte antes de remover esta.'
            });
        }

        // Remover parte
        await pool.query(
            'DELETE FROM partes_processo WHERE id = $1 AND escritorio_id = $2',
            [parteId, escritorioId]
        );

        console.log(`✅ Parte ${parteId} removida`);

        res.json({
            ok: true,
            mensagem: 'Parte removida com sucesso'
        });

    } catch (err) {
        console.error('Erro ao remover parte:', err.message);
        res.status(500).json({ 
            erro: 'Erro ao remover parte',
            detalhes: err.message 
        });
    }
}

// ============================================================
// 5. DEFINIR PARTE PRINCIPAL
// ============================================================
async function definirPartePrincipal(req, res) {
    const { parteId } = req.params;
    const escritorioId = req.user.escritorio_id;

    try {
        // Buscar parte
        const parteResult = await pool.query(
            'SELECT processo_id, polo FROM partes_processo WHERE id = $1 AND escritorio_id = $2',
            [parteId, escritorioId]
        );

        if (parteResult.rows.length === 0) {
            return res.status(404).json({ 
                erro: 'Parte não encontrada' 
            });
        }

        const { processo_id, polo } = parteResult.rows[0];

        // Desmarcar todas as partes principais do mesmo polo
        await pool.query(
            `UPDATE partes_processo 
             SET eh_principal = FALSE 
             WHERE processo_id = $1 
             AND polo = $2 
             AND escritorio_id = $3`,
            [processo_id, polo, escritorioId]
        );

        // Marcar esta como principal
        await pool.query(
            'UPDATE partes_processo SET eh_principal = TRUE WHERE id = $1',
            [parteId]
        );

        console.log(`✅ Parte ${parteId} definida como principal`);

        res.json({
            ok: true,
            mensagem: 'Parte principal definida com sucesso'
        });

    } catch (err) {
        console.error('Erro ao definir parte principal:', err.message);
        res.status(500).json({ 
            erro: 'Erro ao definir parte principal',
            detalhes: err.message 
        });
    }
}

// ============================================================
// 6. ADICIONAR MÚLTIPLAS PARTES DE UMA VEZ
// ============================================================
async function adicionarMultiplasPartes(req, res) {
    const { processoId } = req.params;
    const { partes } = req.body; // Array de objetos com dados das partes
    const escritorioId = req.user.escritorio_id;

    if (!Array.isArray(partes) || partes.length === 0) {
        return res.status(400).json({ 
            erro: 'Envie um array de partes para adicionar' 
        });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Verificar se processo existe
        const processoCheck = await client.query(
            'SELECT id FROM processos WHERE id = $1 AND escritorio_id = $2',
            [processoId, escritorioId]
        );

        if (processoCheck.rows.length === 0) {
            throw new Error('Processo não encontrado');
        }

        const partesInseridas = [];

        for (const parte of partes) {
            const { pessoa_id, pessoa_nome, polo, tipo_parte, eh_principal, observacoes } = parte;

            // Se marcar como principal, desmarcar outras
            if (eh_principal) {
                await client.query(
                    `UPDATE partes_processo 
                     SET eh_principal = FALSE 
                     WHERE processo_id = $1 
                     AND polo = $2 
                     AND escritorio_id = $3`,
                    [processoId, polo, escritorioId]
                );
            }

            // Inserir parte
            const result = await client.query(
                `INSERT INTO partes_processo (
                    processo_id, pessoa_id, pessoa_nome, polo, 
                    tipo_parte, eh_principal, observacoes, escritorio_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (processo_id, pessoa_nome, polo) DO NOTHING
                RETURNING *`,
                [
                    processoId,
                    pessoa_id || null,
                    pessoa_nome.trim(),
                    polo,
                    tipo_parte || (polo === 'ativo' ? 'autor' : 'reu'),
                    eh_principal || false,
                    observacoes || null,
                    escritorioId
                ]
            );

            if (result.rows.length > 0) {
                partesInseridas.push(result.rows[0]);
            }
        }

        await client.query('COMMIT');

        console.log(`✅ ${partesInseridas.length} partes adicionadas ao processo ${processoId}`);

        res.status(201).json({
            ok: true,
            mensagem: `${partesInseridas.length} parte(s) adicionada(s) com sucesso`,
            partes: partesInseridas
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro ao adicionar múltiplas partes:', err.message);
        res.status(500).json({ 
            erro: 'Erro ao adicionar partes',
            detalhes: err.message 
        });
    } finally {
        client.release();
    }
}

module.exports = {
    listarPartesPorProcesso,
    adicionarParte,
    atualizarParte,
    removerParte,
    definirPartePrincipal,
    adicionarMultiplasPartes
};