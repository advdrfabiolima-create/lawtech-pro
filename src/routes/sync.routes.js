const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');

// ============================================================
// CONFIGURAÇÃO DE OAB
// ============================================================

/**
 * GET /api/oab-config
 * Obter configuração de OAB do escritório
 */
router.get('/oab-config', authMiddleware, async (req, res) => {
    try {
        const { escritorio_id } = req.user;
        
        const result = await pool.query(
            `SELECT id, numero_oab, uf_oab, ativo, criado_em, atualizado_em
             FROM oab_configurations
             WHERE escritorio_id = $1 AND ativo = true
             ORDER BY criado_em DESC
             LIMIT 1`,
            [escritorio_id]
        );
        
        if (result.rows.length === 0) {
            return res.json({ configurado: false });
        }
        
        res.json({ 
            configurado: true, 
            config: result.rows[0] 
        });
    } catch (err) {
        console.error('❌ Erro ao buscar configuração OAB:', err);
        res.status(500).json({ erro: 'Erro ao buscar configuração' });
    }
});

/**
 * POST /api/oab-config
 * Salvar configuração de OAB
 */
router.post('/oab-config', authMiddleware, async (req, res) => {
    try {
        const { numero_oab, uf_oab } = req.body;
        const { id: usuario_id, escritorio_id } = req.user;
        
        // Validação
        if (!numero_oab || !uf_oab) {
            return res.status(400).json({ erro: 'OAB e UF são obrigatórios' });
        }
        
        // Desativar configurações antigas
        await pool.query(
            'UPDATE oab_configurations SET ativo = false WHERE escritorio_id = $1',
            [escritorio_id]
        );
        
        // Criar nova configuração
        const result = await pool.query(
            `INSERT INTO oab_configurations (usuario_id, escritorio_id, numero_oab, uf_oab)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [usuario_id, escritorio_id, numero_oab, uf_oab]
        );
        
        console.log(`✅ Configuração OAB salva: ${numero_oab}/${uf_oab} - Escritório ${escritorio_id}`);
        
        res.json({ 
            ok: true, 
            mensagem: 'Configuração salva com sucesso!',
            config: result.rows[0]
        });
    } catch (err) {
        console.error('❌ Erro ao salvar configuração OAB:', err);
        res.status(500).json({ erro: 'Erro ao salvar configuração' });
    }
});

// ============================================================
// SINCRONIZAÇÃO DE PROCESSOS
// ============================================================

/**
 * POST /api/sync/processos
 * Iniciar sincronização de processos
 */
router.post('/sync/processos', authMiddleware, async (req, res) => {
    try {
        const { escritorio_id } = req.user;
        const { tipo = 'pje' } = req.body; // Tipo de tribunal
        
        // Verificar se há configuração de OAB
        const configResult = await pool.query(
            'SELECT * FROM oab_configurations WHERE escritorio_id = $1 AND ativo = true LIMIT 1',
            [escritorio_id]
        );
        
        if (configResult.rows.length === 0) {
            return res.status(400).json({ erro: 'Configure sua OAB primeiro!' });
        }
        
        const config = configResult.rows[0];
        
        // Verificar se já existe job pendente/processando
        const jobAtivo = await pool.query(
            `SELECT * FROM sync_jobs 
             WHERE escritorio_id = $1 AND status IN ('pendente', 'processando')
             ORDER BY criado_em DESC LIMIT 1`,
            [escritorio_id]
        );
        
        if (jobAtivo.rows.length > 0) {
            return res.json({ 
                ok: true,
                mensagem: 'Já existe uma sincronização em andamento',
                job: jobAtivo.rows[0]
            });
        }
        
        // Criar novo job de sincronização
        const jobResult = await pool.query(
            `INSERT INTO sync_jobs (
                escritorio_id, tipo, status, mensagem_status, dados_config
             )
             VALUES ($1, $2, 'pendente', 'Aguardando processamento', $3)
             RETURNING *`,
            [
                escritorio_id, 
                tipo,
                JSON.stringify({
                    numero_oab: config.numero_oab,
                    uf_oab: config.uf_oab,
                    escritorio_id: escritorio_id,
                    usuario_id: req.user.id
                })
            ]
        );
        
        const job = jobResult.rows[0];
        
        console.log(`🚀 Job de sincronização criado: ${job.id} - Tipo: ${tipo}`);
        
        // Processar job em background (não aguardar)
        processarSyncJob(job.id).catch(err => {
            console.error('❌ Erro ao processar job:', err);
        });
        
        res.json({ 
            ok: true,
            mensagem: 'Sincronização iniciada!',
            job: {
                id: job.id,
                status: job.status,
                tipo: job.tipo
            }
        });
    } catch (err) {
        console.error('❌ Erro ao iniciar sincronização:', err);
        res.status(500).json({ erro: 'Erro ao iniciar sincronização' });
    }
});

/**
 * GET /api/sync/status/:jobId
 * Obter status de um job de sincronização
 */
router.get('/sync/status/:jobId', authMiddleware, async (req, res) => {
    try {
        const { jobId } = req.params;
        const { escritorio_id } = req.user;
        
        const result = await pool.query(
            `SELECT * FROM sync_jobs 
             WHERE id = $1 AND escritorio_id = $2`,
            [jobId, escritorio_id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Job não encontrado' });
        }
        
        const job = result.rows[0];
        
        // Buscar últimos logs
        const logsResult = await pool.query(
            `SELECT * FROM sync_logs 
             WHERE sync_job_id = $1 
             ORDER BY criado_em DESC 
             LIMIT 10`,
            [jobId]
        );
        
        res.json({ 
            job,
            logs: logsResult.rows
        });
    } catch (err) {
        console.error('❌ Erro ao buscar status:', err);
        res.status(500).json({ erro: 'Erro ao buscar status' });
    }
});

/**
 * GET /api/sync/history
 * Histórico de sincronizações
 */
router.get('/sync/history', authMiddleware, async (req, res) => {
    try {
        const { escritorio_id } = req.user;
        
        const result = await pool.query(
            `SELECT * FROM sync_jobs 
             WHERE escritorio_id = $1 
             ORDER BY criado_em DESC 
             LIMIT 20`,
            [escritorio_id]
        );
        
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Erro ao buscar histórico:', err);
        res.status(500).json({ erro: 'Erro ao buscar histórico' });
    }
});

// ============================================================
// PROCESSAMENTO DE JOBS (WORKER)
// ============================================================

/**
 * Processar job de sincronização
 */
async function processarSyncJob(jobId) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Buscar job
        const jobResult = await client.query(
            'SELECT * FROM sync_jobs WHERE id = $1',
            [jobId]
        );
        
        if (jobResult.rows.length === 0) {
            throw new Error('Job não encontrado');
        }
        
        const job = jobResult.rows[0];
        
        // Verificar se dados_config já é objeto ou string
        let config;
        if (typeof job.dados_config === 'string') {
            config = JSON.parse(job.dados_config);
        } else {
            config = job.dados_config; // Já é objeto
        }
        
        console.log(`🔄 Processando job ${jobId} - Tipo: ${job.tipo}`);
        
        // Atualizar status para processando
        await client.query(
            `UPDATE sync_jobs 
             SET status = 'processando', 
                 mensagem_status = 'Buscando processos...', 
                 iniciado_em = CURRENT_TIMESTAMP,
                 progresso = 10
             WHERE id = $1`,
            [jobId]
        );
        
        // Log
        await client.query(
            `INSERT INTO sync_logs (sync_job_id, nivel, mensagem)
             VALUES ($1, 'info', 'Iniciando busca de processos no tribunal')`,
            [jobId]
        );
        
        // Processar de acordo com o tipo
        let resultado;
        
        if (job.tipo === 'pje') {
            resultado = await sincronizarPJe(client, jobId, config);
        } else if (job.tipo === 'esaj') {
            resultado = await sincronizarESAJ(client, jobId, config);
        } else {
            throw new Error(`Tipo de tribunal não suportado: ${job.tipo}`);
        }
        
        // Atualizar job como concluído
        await client.query(
            `UPDATE sync_jobs 
             SET status = 'concluido',
                 mensagem_status = 'Sincronização concluída com sucesso',
                 progresso = 100,
                 total_encontrados = $1,
                 total_importados = $2,
                 total_atualizados = $3,
                 finalizado_em = CURRENT_TIMESTAMP
             WHERE id = $4`,
            [resultado.encontrados, resultado.importados, resultado.atualizados, jobId]
        );
        
        // Log final
        await client.query(
            `INSERT INTO sync_logs (sync_job_id, nivel, mensagem, detalhes)
             VALUES ($1, 'success', 'Sincronização concluída', $2)`,
            [jobId, JSON.stringify(resultado)]
        );
        
        await client.query('COMMIT');
        
        console.log(`✅ Job ${jobId} concluído com sucesso!`);
        
    } catch (err) {
        await client.query('ROLLBACK');
        
        console.error(`❌ Erro ao processar job ${jobId}:`, err);
        
        // Marcar job como erro
        await pool.query(
            `UPDATE sync_jobs 
             SET status = 'erro',
                 mensagem_status = 'Erro durante sincronização',
                 erro_detalhes = $1,
                 finalizado_em = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [err.message, jobId]
        );
        
        // Log de erro
        await pool.query(
            `INSERT INTO sync_logs (sync_job_id, nivel, mensagem, detalhes)
             VALUES ($1, 'error', $2, $3)`,
            [jobId, err.message, JSON.stringify({ stack: err.stack })]
        );
    } finally {
        client.release();
    }
}

/**
 * Sincronizar com PJe
 */
async function sincronizarPJe(client, jobId, config) {
    // Atualizar progresso
    await client.query(
        'UPDATE sync_jobs SET progresso = 30, mensagem_status = $1 WHERE id = $2',
        ['Conectando ao PJe...', jobId]
    );
    
    console.log(`🔍 Buscando processos no PJe - OAB: ${config.numero_oab}/${config.uf_oab}`);
    
    // AQUI SERÁ IMPLEMENTADA A INTEGRAÇÃO REAL COM PJe
    // Por enquanto, usamos dados simulados
    
    const processosMock = [
        {
            numero: '0001234-56.2024.4.01.3400',
            tribunal: 'TRF-1',
            esfera: 'Federal',
            instancia: '1º GRAU',
            uf: config.uf_oab,
            partes_ativo: [
                { pessoa_nome: 'Cliente Automático PJe', tipo_parte: 'autor' }
            ],
            partes_passivo: [
                { pessoa_nome: 'União Federal', tipo_parte: 'reu' }
            ]
        },
        {
            numero: '0005678-90.2024.4.01.3400',
            tribunal: 'TRF-1',
            esfera: 'Federal',
            instancia: '2º GRAU',
            uf: config.uf_oab,
            partes_ativo: [
                { pessoa_nome: 'Outro Cliente PJe', tipo_parte: 'recorrente' }
            ],
            partes_passivo: [
                { pessoa_nome: 'INSS', tipo_parte: 'recorrido' }
            ]
        }
    ];
    
    await client.query(
        'UPDATE sync_jobs SET progresso = 50, mensagem_status = $1 WHERE id = $2',
        ['Importando processos encontrados...', jobId]
    );
    
    let importados = 0;
    let atualizados = 0;
    const escritorioId = config.escritorio_id || 1; // Obter do job
    const usuarioId = config.usuario_id || 1; // Obter do job
    
    // Log
    await client.query(
        `INSERT INTO sync_logs (sync_job_id, nivel, mensagem)
         VALUES ($1, 'info', $2)`,
        [jobId, `Encontrados ${processosMock.length} processos no PJe`]
    );
    
    // Importar cada processo
    for (const proc of processosMock) {
        try {
            // Verificar se processo já existe
            const existe = await client.query(
                'SELECT id FROM processos WHERE numero = $1 AND escritorio_id = $2',
                [proc.numero, escritorioId]
            );
            
            if (existe.rows.length === 0) {
                // INSERIR NOVO PROCESSO
                const resultProcesso = await client.query(
                    `INSERT INTO processos (
                        numero, uf, instancia, esfera, tribunal, 
                        usuario_id, escritorio_id, status
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'ativo')
                    RETURNING id`,
                    [
                        proc.numero,
                        proc.uf,
                        proc.instancia,
                        proc.esfera,
                        proc.tribunal,
                        usuarioId,
                        escritorioId
                    ]
                );
                
                const processoId = resultProcesso.rows[0].id;
                
                // Inserir partes do polo ativo
                for (const parte of proc.partes_ativo) {
                    await client.query(
                        `INSERT INTO partes_processo (
                            processo_id, pessoa_nome, polo, tipo_parte, eh_principal, escritorio_id
                        )
                        VALUES ($1, $2, 'ativo', $3, $4, $5)`,
                        [processoId, parte.pessoa_nome, parte.tipo_parte, true, escritorioId]
                    );
                }
                
                // Inserir partes do polo passivo
                for (const parte of proc.partes_passivo) {
                    await client.query(
                        `INSERT INTO partes_processo (
                            processo_id, pessoa_nome, polo, tipo_parte, eh_principal, escritorio_id
                        )
                        VALUES ($1, $2, 'passivo', $3, $4, $5)`,
                        [processoId, parte.pessoa_nome, parte.tipo_parte, true, escritorioId]
                    );
                }
                
                importados++;
                
                // Log de sucesso
                await client.query(
                    `INSERT INTO sync_logs (sync_job_id, nivel, mensagem)
                     VALUES ($1, 'info', $2)`,
                    [jobId, `✅ Processo importado: ${proc.numero}`]
                );
                
                console.log(`✅ Processo importado: ${proc.numero}`);
                
            } else {
                // ATUALIZAR PROCESSO EXISTENTE
                await client.query(
                    `UPDATE processos 
                     SET esfera = $1, tribunal = $2, instancia = $3, uf = $4
                     WHERE id = $5`,
                    [proc.esfera, proc.tribunal, proc.instancia, proc.uf, existe.rows[0].id]
                );
                
                atualizados++;
                
                console.log(`🔄 Processo atualizado: ${proc.numero}`);
            }
            
        } catch (errProcesso) {
            console.error(`❌ Erro ao importar processo ${proc.numero}:`, errProcesso.message);
            
            // Log de erro específico
            await client.query(
                `INSERT INTO sync_logs (sync_job_id, nivel, mensagem, detalhes)
                 VALUES ($1, 'error', $2, $3)`,
                [jobId, `Erro ao importar ${proc.numero}`, JSON.stringify({ erro: errProcesso.message })]
            );
        }
    }
    
    await client.query(
        'UPDATE sync_jobs SET progresso = 90, mensagem_status = $1 WHERE id = $2',
        ['Finalizando sincronização...', jobId]
    );
    
    return {
        encontrados: processosMock.length,
        importados,
        atualizados
    };
}

/**
 * Sincronizar com ESAJ
 */
async function sincronizarESAJ(client, jobId, config) {
    // Será implementado
    throw new Error('ESAJ ainda não implementado');
}

module.exports = router;