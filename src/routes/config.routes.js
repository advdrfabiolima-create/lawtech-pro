const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios'); // 🚀 Adicionado para falar com o Escavador
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
    
    console.log(`📡 [ESCALA] Registrando OAB no Escavador: ${termoFormatado}`);

    // Verificar se escritório tem chave API própria
    const verificarChave = await pool.query(
        'SELECT escavador_api_key FROM escritorios WHERE id = $1',
        [escritorioId]
    );
    
    const chaveApi = verificarChave.rows[0]?.escavador_api_key;
    
    // Se não tem chave própria, pula criação de monitoramento
    if (!chaveApi || chaveApi.trim() === '') {
        console.log(`⚠️ [ESCALA] Escritório ${escritorioId} sem chave API própria.`);
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
            console.log(`✅ [ESCALA] Sucesso: ${termoFormatado} - ID: ${monitoramentoId}`);
            
            // Salvar ID no banco
            try {
                await pool.query(
                    'UPDATE escritorios SET monitoramento_id = $1 WHERE id = $2',
                    [monitoramentoId, escritorioId]
                );
                console.log(`   ✅ ID salvo no banco`);
            } catch (errDb) {
                console.error(`   ❌ Erro ao salvar ID:`, errDb.message);
            }
        }).catch(err => {
            if (err.response?.status === 409) {
                console.log(`ℹ️ [ESCALA] Monitoramento ${termoFormatado} já existe`);
                
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
                        console.log(`   ✅ Encontrado: ID ${monExistente.id}`);
                        try {
                            await pool.query(
                                'UPDATE escritorios SET monitoramento_id = $1 WHERE id = $2',
                                [monExistente.id, escritorioId]
                            );
                            console.log(`   ✅ ID salvo no banco`);
                        } catch (errDb) {
                            console.error(`   ❌ Erro:`, errDb.message);
                        }
                    }
                }).catch(() => {});
            } else {
                console.log(`⚠️ [ESCALA] Erro: ${err.message}`);
            }
        });
    }
}

        res.json({ ok: true, mensagem: 'Configurações salvas e Radar DJEN ativado para sua OAB!' });

    } catch (err) {
        console.error("❌ ERRO SQL NO SALVAMENTO:", err.message);
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
                    pix_chave, renda_mensal, plano_id, plano_financeiro_status
             FROM escritorios WHERE id = $1`,
            [escritorioId]
        );

        if (resultado.rowCount > 0) {
            res.json({ ok: true, dados: resultado.rows[0] });
        } else {
            res.json({ ok: false, mensagem: "Escritório não encontrado." });
        }
    } catch (err) {
        console.error('Erro ao buscar escritório:', err.message);
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
        console.error('Erro ao alterar senha:', err.message);
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

        console.log(`✅ Nome atualizado: ${nome} (ID: ${req.user.id})`);
        res.json({ ok: true, mensagem: 'Nome atualizado com sucesso', nome: result.rows[0].nome });
    } catch (err) {
        console.error('❌ Erro ao atualizar nome:', err.message);
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

        console.log(`✅ Chave API do Escavador ${chave ? 'salva' : 'removida'} para escritório ${escritorioId}`);

        res.json({ 
            ok: true, 
            mensagem: chave 
                ? 'Chave API salva! Agora você pode usar sincronização automática.' 
                : 'Chave API removida. Use inserção manual de publicações.'
        });
    } catch (err) {
        console.error('❌ Erro ao salvar chave API do Escavador:', err.message);
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

        console.log(`✅ [REATIVAÇÃO] Assinatura reativada para o escritório: ${escritorioId}`);
        
        res.json({ ok: true, msg: "Sua assinatura foi reativada com sucesso, Doutor! A renovação automática está ativa novamente." });
    } catch (err) {
        console.error('❌ Erro ao reativar assinatura:', err.message);
        res.status(500).json({ error: "Erro ao reativar plano no servidor." });
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
    try {
        await pool.query(
            'UPDATE escritorios SET logo_arquivo = $1 WHERE id = $2',
            [logoArquivo, req.user.escritorio_id]
        );
        res.json({ ok: true, logo_arquivo: logoArquivo });
    } catch (err) {
        console.error('[Config] Erro ao salvar logo:', err.message);
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
        await pool.query('UPDATE escritorios SET logo_arquivo = NULL WHERE id = $1', [req.user.escritorio_id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('[Config] Erro ao remover logo:', err.message);
        res.status(500).json({ ok: false, erro: err.message });
    }
});

module.exports = router;