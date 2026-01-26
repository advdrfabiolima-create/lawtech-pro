const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios'); // 🚀 Adicionado para falar com o Escavador
const authMiddleware = require('../middlewares/authMiddleware');
const bcrypt = require('bcrypt');

// ============================================================
// ROTA 1: SALVAR/ATUALIZAR DADOS DO ESCRITÓRIO (PUT)
// ============================================================
router.put('/escritorio', authMiddleware, async (req, res) => {
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
            const termoFormatado = `${oabApenasNumeros}-${ufFinal}`;
            console.log(`📡 [ESCALA] Registrando OAB no Escavador: ${termoFormatado}`);

            // Envia para o Escavador em segundo plano (não trava o usuário)
            axios.post(`https://api.escavador.com/api/v1/monitoramentos`, {
                tipo: "termo",
                termo: termoFormatado,
                frequencia: "diaria",
                origens_ids: [1, 8, 140] // DJEN e tribunais base
            }, {
                headers: { 
                    'Authorization': `Bearer ${process.env.ESCAVADOR_API_KEY}`,
                    'X-Requested-With': 'XMLHttpRequest'
                }
            }).then(() => {
                console.log(`✅ [ESCALA] Sucesso: ${termoFormatado} agora está sendo monitorada.`);
            }).catch(err => {
                console.log(`ℹ️ [ESCALA] Aviso: ${termoFormatado} já possui registro ou aguarda saldo.`);
            });
        }

        res.json({ ok: true, mensagem: 'Configurações salvas e Radar DJEN ativado para sua OAB!' });

    } catch (err) {
        console.error("❌ ERRO SQL NO SALVAMENTO:", err.message);
        res.status(500).json({ erro: 'Erro ao salvar no banco: ' + err.message });
    }
});

// ============================================================
// ROTA 2: BUSCAR DADOS DO ESCRITÓRIO (GET)
// ============================================================
router.get('/meu-escritorio', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const resultado = await pool.query("SELECT * FROM escritorios WHERE id = $1", [escritorioId]);

        if (resultado.rowCount > 0) {
            res.json({ ok: true, dados: resultado.rows[0] });
        } else {
            res.json({ ok: false, mensagem: "Escritório não encontrado." });
        }
    } catch (err) {
        res.status(500).json({ ok: false, erro: err.message });
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
router.put('/config/escavador-key', authMiddleware, async (req, res) => {
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
module.exports = router;