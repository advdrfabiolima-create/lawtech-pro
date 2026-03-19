const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cache = require('../utils/cache');
const logger = require('../utils/logger');
const { registrarLog } = require('../utils/auditLog');

// ─── Upload de Logo ───────────────────────────────────────────────────────────
const logoDir = path.join(__dirname, '..', 'uploads', 'logos');
if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });

const logoStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, logoDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.png';
        cb(null, `logo_${req.user.escritorio_id}${ext}`);
    }
});

const logoUpload = multer({
    storage: logoStorage,
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Somente imagens são permitidas (JPG, PNG, GIF, WEBP, SVG)'));
    },
    limits: { fileSize: 2 * 1024 * 1024 } // 2 MB
});

// ============================================================
// ROTA 1: SALVAR/ATUALIZAR DADOS DO ESCRITÓRIO (PUT)
// ============================================================
router.put('/escritorio', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    const { 
        nome, advogado_responsavel, oab, documento, dataNascimento, email, endereco, 
        cidade, estado, cep, banco_codigo, agencia, conta, conta_digito, pix_chave, renda_mensal 
    } = req.body;
    
    const escritorioId = req.user.escritorio_id;

    try {
        // 1. Limpeza e Preparação dos dados
        const oabApenasNumeros = oab ? oab.replace(/\D/g, '') : null;
        const ufFinal = estado ? estado.toUpperCase() : 'BA';
        const rendaTratada = (renda_mensal && renda_mensal !== '') ? parseFloat(renda_mensal) : 0;
        
        // 2. Salva no Banco de Dados Neon
        const query = `
            UPDATE escritorios SET 
                nome = $1, 
                advogado_responsavel = $2, 
                oab = $3, 
                documento = $4, 
                data_nascimento = $5, 
                email = $6, 
                endereco = $7, 
                cidade = $8, 
                estado = $9, 
                cep = $10, 
                banco_codigo = $11, 
                agencia = $12, 
                conta = $13, 
                conta_digito = $14, 
                pix_chave = $15, 
                renda_mensal = $16,
                plano_financeiro_status = 'ativo',
                uf = $9
            WHERE id = $17
        `;

        const values = [
            nome || null, advogado_responsavel || '', oabApenasNumeros, 
            documento || null, dataNascimento || null, email || null, 
            endereco || null, cidade || null, ufFinal, cep || null, 
            banco_codigo || null, agencia || null, conta || null, 
            conta_digito || null, pix_chave || null, rendaTratada, escritorioId
        ];

        await pool.query(query, values);

        // 🚀 3. GATILHO DO RADAR ESCAVADOR (ESCALA AUTOMÁTICA)
if (oabApenasNumeros) {
    // ✅ FORMATO CORRETO: UF-número (sem zeros à esquerda)
    const oabSemZeros = oabApenasNumeros.replace(/^0+/, '');
    const termoFormatado = `${ufFinal}-${oabSemZeros}`;
    
    logger.info({ oab: termoFormatado, escritorioId }, '[ESCALA] Registrando OAB no Escavador');

    // Verificar se escritório tem chave API própria
    const verificarChave = await pool.query(
        'SELECT escavador_api_key FROM escritorios WHERE id = $1',
        [escritorioId]
    );
    
    const chaveApi = verificarChave.rows[0]?.escavador_api_key;
    
    // Se não tem chave própria, pula criação de monitoramento
    if (!chaveApi || chaveApi.trim() === '') {
        logger.info({ escritorioId }, '[ESCALA] Escritorio sem chave API propria');
    } else {
        // Envia para o Escavador com a chave do cliente
        axios.post(`https://api.escavador.com/api/v1/monitoramentos`, {
            tipo: "termo",
            termo: termoFormatado,
            frequencia: "diaria",
            origens_ids: [1, 8, 140]
        }, {
            headers: { 
                'Authorization': `Bearer ${chaveApi.trim()}`,
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/json'
            },
            timeout: 15000
        }).then(async (response) => {
            const monitoramentoId = response.data.id;
            logger.info({ oab: termoFormatado, monitoramentoId }, '[ESCALA] Monitoramento criado');
            
            // Salvar ID no banco
            try {
                await pool.query(
                    'UPDATE escritorios SET monitoramento_id = $1 WHERE id = $2',
                    [monitoramentoId, escritorioId]
                );
                logger.info({ monitoramentoId, escritorioId }, '[ESCALA] ID salvo no banco');
            } catch (errDb) {
                logger.error({ err: errDb.message }, '[ESCALA] Erro ao salvar ID');
            }
        }).catch(err => {
            if (err.response?.status === 409) {
                logger.info({ oab: termoFormatado }, '[ESCALA] Monitoramento ja existe');
                
                // Buscar ID do existente
                axios.get('https://api.escavador.com/api/v1/monitoramentos', {
                    headers: { 
                        'Authorization': `Bearer ${chaveApi.trim()}`,
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                }).then(async (listRes) => {
                    const monExistente = listRes.data.items?.find(m => 
                        m.termo && m.termo.toUpperCase() === termoFormatado.toUpperCase()
                    );
                    
                    if (monExistente) {
                        logger.info({ id: monExistente.id }, '[ESCALA] Monitoramento encontrado');
                        try {
                            await pool.query(
                                'UPDATE escritorios SET monitoramento_id = $1 WHERE id = $2',
                                [monExistente.id, escritorioId]
                            );
                            logger.info({ id: monExistente.id, escritorioId }, '[ESCALA] ID existente salvo no banco');
                        } catch (errDb) {
                            logger.error({ err: errDb.message }, '[ESCALA] Erro ao salvar ID existente');
                        }
                    }
                }).catch(() => {});
            } else {
                logger.warn({ err: err.message }, '[ESCALA] Erro ao criar monitoramento');
            }
        });
    }
}

        res.json({ ok: true, mensagem: 'Configurações salvas e Radar DJEN ativado para sua OAB!' });

    } catch (err) {
        logger.error({ err: err.message }, 'Erro SQL ao salvar configuracoes');
        registrarLog({
            escritorio_id: req.user?.escritorio_id || null,
            servico: 'config.escritorio',
            tipo_erro: 'SQL_ERROR',
            mensagem_erro: err.message
        });
        res.status(500).json({ erro: 'Erro ao salvar configurações' });
    }
});

// ============================================================
// ROTA 2: BUSCAR DADOS DO ESCRITÓRIO (GET)
// ============================================================
router.get('/meu-escritorio', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const resultado = await pool.query(
            `SELECT id, nome, advogado_responsavel, oab, documento, data_nascimento, email,
                    endereco, cidade, estado, cep, banco_codigo, agencia, conta, conta_digito,
                    pix_chave, renda_mensal, plano_id, plano_financeiro_status, logo_arquivo,
                    logo_base64, portal_slug
             FROM escritorios WHERE id = $1`,
            [escritorioId]
        );

        if (resultado.rowCount > 0) {
            res.json({ ok: true, dados: resultado.rows[0] });
        } else {
            res.json({ ok: false, mensagem: "Escritório não encontrado." });
        }
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao buscar escritorio');
        res.status(500).json({ ok: false, erro: 'Erro ao carregar configurações' });
    }
});

// ============================================================
// ROTA PARA ALTERAR SENHA DO USUÁRIO LOGADO (PUT)
// ============================================================
router.put('/senha', authMiddleware, async (req, res) => {
    const { senha } = req.body;

    if (!senha || senha.length < 6) {
        return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres' });
    }

    try {
        const hashedSenha = await bcrypt.hash(senha, 10);

        // Atualiza a senha do usuário logado (usando req.user.id do middleware de auth)
        const result = await pool.query(
        'UPDATE usuarios SET senha = $1 WHERE id = $2 RETURNING id',
        [hashedSenha, req.user.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        res.json({ ok: true, mensagem: 'Senha alterada com sucesso' });
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao alterar senha');
        res.status(500).json({ erro: 'Erro interno ao alterar senha' });
    }
});
// ============================================================
// ROTA PARA ATUALIZAR NOME DO USUÁRIO (PUT)
// Adicione esta rota APÓS a rota PUT /senha e ANTES da rota PUT /config/escavador-key
// ============================================================
router.put('/config/perfil', authMiddleware, async (req, res) => {
    const { nome } = req.body;

    if (!nome || nome.trim() === '') {
        return res.status(400).json({ erro: 'Nome não pode estar vazio' });
    }

    try {
        const result = await pool.query(
            'UPDATE usuarios SET nome = $1 WHERE id = $2 RETURNING id, nome',
            [nome.trim(), req.user.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        logger.info({ nome, userId: req.user.id }, 'Nome atualizado');
        res.json({ ok: true, mensagem: 'Nome atualizado com sucesso', nome: result.rows[0].nome });
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao atualizar nome');
        res.status(500).json({ erro: 'Erro ao atualizar nome' });
    }
});

// ADICIONE ESTA ROTA NO FINAL DO ARQUIVO src/routes/config.routes.js
// (antes do module.exports = router;)

/**
 * 🔌 SALVAR CHAVE API DO ESCAVADOR (CLIENTE PRÓPRIO)
 */
router.put('/config/escavador-key', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    try {
        const { escavador_api_key } = req.body;
        const escritorioId = req.user.escritorio_id;

        // Permite salvar vazio (para desativar) ou com valor
        const chave = escavador_api_key && escavador_api_key.trim() !== '' 
            ? escavador_api_key.trim() 
            : null;

        await pool.query(
            'UPDATE escritorios SET escavador_api_key = $1 WHERE id = $2',
            [chave, escritorioId]
        );

        logger.info({ escritorioId, hasKey: !!chave }, 'Chave API do Escavador atualizada');

        res.json({ 
            ok: true, 
            mensagem: chave 
                ? 'Chave API salva! Agora você pode usar sincronização automática.' 
                : 'Chave API removida. Use inserção manual de publicações.'
        });
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao salvar chave API do Escavador');
        res.status(500).json({ erro: 'Erro ao salvar chave API' });
    }
});

// ROTA PARA REATIVAR ASSINATURA (DESFAZER CANCELAMENTO)
router.put('/planos/reativar', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        
        // Volta a renovação para true e limpa a data de agendamento do cancelamento
        await pool.query(
            "UPDATE escritorios SET renovacao_automatica = true, data_cancelamento_agendado = NULL WHERE id = $1",
            [escritorioId]
        );

        // Invalida cache do usuário para refletir mudança de plano
        await cache.del(`auth:user:${req.user.id}`);
        logger.info({ escritorioId }, '[REATIVAÇÃO] Assinatura reativada');

        res.json({ ok: true, msg: "Sua assinatura foi reativada com sucesso, Doutor! A renovação automática está ativa novamente." });
    } catch (err) {
        logger.error({ err: err.message }, 'Erro ao reativar assinatura');
        res.status(500).json({ ok: false, erro: "Erro ao reativar plano no servidor." });
    }
});

// ============================================================
// UPLOAD DE LOGO DO ESCRITÓRIO (POST /config/logo)
// ============================================================
router.post('/config/logo', authMiddleware, (req, res, next) => {
    logoUpload.single('logo')(req, res, (err) => {
        if (err) return res.status(400).json({ ok: false, erro: err.message });
        next();
    });
}, async (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' });

    const logoArquivo = `logos/${req.file.filename}`;
    // Converte para base64 e salva no banco — garante persistência entre deploys
    const fileContent = fs.readFileSync(req.file.path);
    const logoBase64 = `data:${req.file.mimetype};base64,${fileContent.toString('base64')}`;

    try {
        await pool.query(
            'UPDATE escritorios SET logo_arquivo = $1, logo_base64 = $2 WHERE id = $3',
            [logoArquivo, logoBase64, req.user.escritorio_id]
        );
        res.json({ ok: true, logo_arquivo: logoArquivo, logo_base64: logoBase64 });
    } catch (err) {
        logger.error({ err: err.message }, '[Config] Erro ao salvar logo');
        res.status(500).json({ ok: false, erro: err.message });
    }
});

// ============================================================
// REMOVER LOGO DO ESCRITÓRIO (DELETE /config/logo)
// ============================================================
router.delete('/config/logo', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT logo_arquivo FROM escritorios WHERE id = $1',
            [req.user.escritorio_id]
        );
        const logoArquivo = result.rows[0]?.logo_arquivo;
        if (logoArquivo) {
            const filePath = path.join(__dirname, '..', 'uploads', logoArquivo);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await pool.query('UPDATE escritorios SET logo_arquivo = NULL, logo_base64 = NULL WHERE id = $1', [req.user.escritorio_id]);
        res.json({ ok: true });
    } catch (err) {
        logger.error({ err: err.message }, '[Config] Erro ao remover logo');
        res.status(500).json({ ok: false, erro: err.message });
    }
});

// ============================================================
// SINCRONIZAÇÃO MANUAL DATAJUD
// POST /api/config/datajud/sincronizar  (admin)
// ============================================================
router.post('/config/datajud/sincronizar', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    try {
        const { sincronizarAndamentosDatajud } = require('../cron/datajudCron');
        logger.info({ usuario_id: req.user.id }, '[DataJud] Sincronização manual disparada');

        // Executa em background para não travar a resposta
        sincronizarAndamentosDatajud().catch(err =>
            logger.error({ err: err.message }, '[DataJud] Erro na sincronização manual')
        );

        res.json({ ok: true, mensagem: 'Sincronização iniciada. Os andamentos serão atualizados em instantes.' });
    } catch (err) {
        logger.error({ err: err.message }, '[DataJud] Erro ao iniciar sincronização manual');
        res.status(500).json({ ok: false, erro: err.message });
    }
});

// ============================================================
// RE-SINCRONIZAÇÃO DATAJUD — apaga andamentos DataJud e reimporta
// POST /api/config/datajud/ressincronizar  (admin)
// ============================================================
router.post('/config/datajud/ressincronizar', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    try {
        const escritorio_id = req.user.escritorio_id;

        // Apaga todos os andamentos importados pelo DataJud deste escritório
        const { rowCount } = await pool.query(
            `DELETE FROM andamentos_processuais WHERE escritorio_id = $1 AND fonte = 'datajud'`,
            [escritorio_id]
        );
        logger.info({ escritorio_id, removidos: rowCount }, '[DataJud] Andamentos removidos para re-sincronização');

        // Dispara nova sincronização em background
        const { sincronizarAndamentosDatajud } = require('../cron/datajudCron');
        sincronizarAndamentosDatajud().catch(err =>
            logger.error({ err: err.message }, '[DataJud] Erro na re-sincronização')
        );

        res.json({ ok: true, removidos: rowCount, mensagem: `${rowCount} andamentos removidos. Re-importação iniciada em background.` });
    } catch (err) {
        logger.error({ err: err.message }, '[DataJud] Erro ao re-sincronizar');
        res.status(500).json({ ok: false, erro: err.message });
    }
});

// ============================================================
// DIAGNÓSTICO DATAJUD — testa um número CNJ contra a API
// GET /api/config/datajud/testar?numero=XXXX  (admin)
// ============================================================
router.get('/config/datajud/testar', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    const { numero } = req.query;
    if (!numero) return res.status(400).json({ ok: false, erro: 'Informe ?numero=NNNNNNN-DD.AAAA.J.TT.OOOO' });

    const apiKey = process.env.DATAJUD_API_KEY;
    if (!apiKey) return res.status(400).json({ ok: false, erro: 'DATAJUD_API_KEY não configurada' });

    const match = numero.match(/\d{7}-\d{2}\.\d{4}\.(\d+\.\d+)\.\d+/);
    if (!match) return res.status(400).json({ ok: false, erro: 'Formato CNJ inválido. Esperado: NNNNNNN-DD.AAAA.J.TT.OOOO' });

    const codigoTribunal = match[1];
    const slugMap = {
      '3.00':'stj','4.01':'trf1','4.02':'trf2','4.03':'trf3','4.04':'trf4','4.05':'trf5','4.06':'trf6',
      '5.00':'tst','5.01':'trt1','5.02':'trt2','5.03':'trt3','5.04':'trt4','5.05':'trt5','5.06':'trt6',
      '5.07':'trt7','5.08':'trt8','5.09':'trt9','5.10':'trt10','5.11':'trt11','5.12':'trt12',
      '5.13':'trt13','5.14':'trt14','5.15':'trt15','5.16':'trt16','5.17':'trt17','5.18':'trt18',
      '5.19':'trt19','5.20':'trt20','5.21':'trt21','5.22':'trt22','5.23':'trt23','5.24':'trt24',
      '6.00':'tse',
      '8.01':'tjac','8.02':'tjal','8.03':'tjap','8.04':'tjam','8.05':'tjba','8.06':'tjce',
      '8.07':'tjdft','8.08':'tjes','8.09':'tjgo','8.10':'tjma','8.11':'tjmt','8.12':'tjms',
      '8.13':'tjmg','8.14':'tjpa','8.15':'tjpb','8.16':'tjpr','8.17':'tjpe','8.18':'tjpi',
      '8.19':'tjrj','8.20':'tjrn','8.21':'tjrs','8.22':'tjro','8.23':'tjrr','8.24':'tjsc',
      '8.25':'tjse','8.26':'tjsp','8.27':'tjto',
    };

    const tribunalSlug = slugMap[codigoTribunal];
    if (!tribunalSlug) {
        return res.json({ ok: false, erro: `Tribunal não mapeado: ${codigoTribunal}`, numero, codigoTribunal });
    }

    const numeroSemMascara = numero.replace(/\D/g, '');
    const url = `https://api-publica.datajud.cnj.jus.br/api_publica_${tribunalSlug}/_search`;

    const { inferirTipo } = require('../services/datajudService');

    try {
        const { data } = await axios.post(url, {
            query: { term: { 'numeroProcesso.keyword': numeroSemMascara } }
        }, {
            headers: { 'Authorization': `ApiKey ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: 30000
        });
        const hits = data?.hits?.hits || [];
        if (!hits.length) return res.json({ ok: false, erro: 'Processo não encontrado no DataJud' });

        const src = hits[0]._source || {};
        const movimentos = src.movimento || src.movimentos || src.andamento || src.andamentos || [];

        const lista = movimentos.map(m => ({
            codigo: m.codigo,
            nome:   m.nome,
            data:   m.dataHora ? m.dataHora.split('T')[0] : null,
            tipo_inferido: inferirTipo(m.nome, m.codigo),
        }));

        return res.json({
            ok: true,
            numero_original: numero,
            tribunal_slug: tribunalSlug,
            total_movimentos: lista.length,
            movimentos: lista,
        });
    } catch (err) {
        return res.status(500).json({ ok: false, erro: err.response?.status || err.message });
    }
});

// ============================================================
// PORTAL SLUG — identificador público do escritório
// PUT /api/config/portal-slug  (admin)
// ============================================================
router.put('/config/portal-slug', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    const { portal_slug } = req.body;
    const escritorioId = req.user.escritorio_id;

    if (!portal_slug || portal_slug.trim() === '') {
        return res.status(400).json({ ok: false, erro: 'Slug não pode estar vazio.' });
    }

    // Apenas letras minúsculas, números e hífen
    const slug = portal_slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (slug.length < 3) {
        return res.status(400).json({ ok: false, erro: 'Slug deve ter pelo menos 3 caracteres (letras, números ou hífen).' });
    }

    try {
        await pool.query(
            'UPDATE escritorios SET portal_slug = $1 WHERE id = $2',
            [slug, escritorioId]
        );
        res.json({ ok: true, portal_slug: slug });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ ok: false, erro: 'Este slug já está em uso. Escolha outro.' });
        }
        logger.error({ err: err.message }, '[Config] PUT /config/portal-slug erro');
        res.status(500).json({ ok: false, erro: 'Erro interno.' });
    }
});

module.exports = router;