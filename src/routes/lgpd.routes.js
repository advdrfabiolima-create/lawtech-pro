const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const { registrarAudit, dadosReq } = require('../utils/auditLog');
const logger = require('../utils/logger');

/* ======================================================
   LGPD - Exportar dados pessoais (Direito de Portabilidade)
   Art. 18, V - Lei 13.709/2018
===================================================== */

router.get('/meus-dados', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const escritorioId = req.user.escritorio_id;

        // Dados do usuário
        const usuario = await pool.query(
            `SELECT id, nome, email, role, data_criacao
             FROM usuarios WHERE id = $1`,
            [userId]
        );

        // Dados do escritório
        const escritorio = await pool.query(
            `SELECT id, nome, advogado_responsavel, oab, documento, email,
                    endereco, cidade, estado, cep, plano_id,
                    plano_financeiro_status, data_criacao
             FROM escritorios WHERE id = $1`,
            [escritorioId]
        );

        // Processos
        const processos = await pool.query(
            `SELECT id, numero, status
             FROM processos WHERE escritorio_id = $1`,
            [escritorioId]
        );

        // Clientes cadastrados
        const clientes = await pool.query(
            `SELECT id, nome, email, telefone
             FROM clientes WHERE escritorio_id = $1`,
            [escritorioId]
        );

        // Transações financeiras
        const transacoes = await pool.query(
            `SELECT id, gateway, valor, status, descricao, created_at
             FROM transacoes WHERE escritorio_id = $1
             ORDER BY created_at DESC`,
            [escritorioId]
        );

        // Audit log do usuário
        const auditLog = await pool.query(
            `SELECT acao, descricao, ip, created_at
             FROM audit_log WHERE usuario_id = $1
             ORDER BY created_at DESC LIMIT 100`,
            [userId]
        );

        registrarAudit({
            usuario_id: userId,
            email: req.user.email,
            escritorio_id: escritorioId,
            acao: 'LGPD_EXPORTACAO_DADOS',
            descricao: 'Exportação de dados pessoais solicitada',
            ...dadosReq(req)
        });

        res.json({
            ok: true,
            exportado_em: new Date().toISOString(),
            dados: {
                usuario: usuario.rows[0] || null,
                escritorio: escritorio.rows[0] || null,
                processos: processos.rows,
                clientes: clientes.rows,
                transacoes: transacoes.rows,
                historico_acesso: auditLog.rows
            }
        });

    } catch (err) {
        logger.error({ err: err.message }, 'LGPD - Erro na exportação');
        res.status(500).json({ erro: 'Erro ao exportar dados' });
    }
});

/* ======================================================
   LGPD - Solicitar exclusão de conta (Direito ao Esquecimento)
   Art. 18, VI - Lei 13.709/2018
===================================================== */

router.delete('/minha-conta', authMiddleware, async (req, res) => {
    const client = await pool.connect();

    try {
        const userId = req.user.id;
        const escritorioId = req.user.escritorio_id;
        const { confirmacao } = req.body;

        if (confirmacao !== 'EXCLUIR MINHA CONTA') {
            return res.status(400).json({
                erro: 'Para confirmar, envie { "confirmacao": "EXCLUIR MINHA CONTA" }'
            });
        }

        // Verificar se é o admin do escritório
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                erro: 'Apenas o administrador pode solicitar exclusão da conta'
            });
        }

        // Master não pode ser excluído por esta rota
        if (req.user.eh_master) {
            return res.status(403).json({
                erro: 'Conta master não pode ser excluída por esta rota'
            });
        }

        await client.query('BEGIN');

        // Anonimizar dados pessoais (manter registros para compliance financeira)
        await client.query(`
            UPDATE usuarios
            SET nome = 'Usuário Removido',
                email = CONCAT('removido_', id, '@excluido.lgpd'),
                senha = 'CONTA_EXCLUIDA',
                updated_at = NOW()
            WHERE escritorio_id = $1
        `, [escritorioId]);

        await client.query(`
            UPDATE escritorios
            SET nome = 'Escritório Removido',
                advogado_responsavel = NULL,
                oab = NULL,
                documento = NULL,
                email = NULL,
                endereco = NULL,
                cidade = NULL,
                estado = NULL,
                cep = NULL,
                plano_financeiro_status = 'excluido',
                renovacao_automatica = false
            WHERE id = $1
        `, [escritorioId]);

        // Remover dados de cartão
        await client.query(
            'DELETE FROM cartoes WHERE escritorio_id = $1',
            [escritorioId]
        );

        // Anonimizar clientes
        await client.query(`
            UPDATE clientes
            SET nome = 'Cliente Removido',
                email = NULL,
                telefone = NULL,
                cpf = NULL
            WHERE escritorio_id = $1
        `, [escritorioId]);

        // Registrar no audit log antes de anonimizar
        await client.query(`
            INSERT INTO audit_log (usuario_id, email, escritorio_id, acao, descricao, created_at)
            VALUES ($1, $2, $3, 'LGPD_EXCLUSAO_CONTA', 'Conta excluída por solicitação do titular', NOW())
        `, [userId, req.user.email, escritorioId]);

        await client.query('COMMIT');

        logger.info({ escritorioId }, 'LGPD: Conta excluída');

        res.json({
            ok: true,
            mensagem: 'Sua conta foi excluída. Dados pessoais foram anonimizados conforme LGPD.'
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err: err.message }, 'LGPD - Erro na exclusão');
        res.status(500).json({ erro: 'Erro ao processar exclusão' });
    } finally {
        client.release();
    }
});

/* ======================================================
   LGPD - Registrar consentimento
===================================================== */

router.post('/consentimento', authMiddleware, async (req, res) => {
    try {
        const { tipo, aceito } = req.body;
        const userId = req.user.id;

        if (!tipo || aceito === undefined) {
            return res.status(400).json({ erro: 'Informe tipo e aceito' });
        }

        const tiposValidos = ['termos_uso', 'politica_privacidade', 'comunicacoes_marketing'];
        if (!tiposValidos.includes(tipo)) {
            return res.status(400).json({ erro: `Tipo inválido. Use: ${tiposValidos.join(', ')}` });
        }

        await pool.query(`
            INSERT INTO consentimentos (usuario_id, tipo, aceito, ip, created_at)
            VALUES ($1, $2, $3, $4, NOW())
        `, [userId, tipo, aceito, req.ip]);

        registrarAudit({
            usuario_id: userId,
            email: req.user.email,
            escritorio_id: req.user.escritorio_id,
            acao: 'LGPD_CONSENTIMENTO',
            descricao: `Consentimento ${tipo}: ${aceito ? 'aceito' : 'revogado'}`,
            ...dadosReq(req)
        });

        res.json({ ok: true, mensagem: 'Consentimento registrado' });

    } catch (err) {
        logger.error({ err: err.message }, 'LGPD - Erro no consentimento');
        res.status(500).json({ erro: 'Erro ao registrar consentimento' });
    }
});

module.exports = router;
