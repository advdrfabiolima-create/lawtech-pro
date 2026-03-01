const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { sign: jwtSign, verify: jwtVerify } = require('../../config/jwt');
const pool = require('../../config/db');
const { encrypt, decrypt } = require('../../utils/crypto');
const { registrarAudit } = require('../../utils/auditLog');
const authMiddleware = require('../../middlewares/authMiddleware');
const logger = require('../../utils/logger');
const rateLimit = require('express-rate-limit');

const limiter2FA = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    message: { ok: false, erro: 'Muitas tentativas. Aguarde 10 minutos.' }
});

/* ======================================================
   2FA — CONFIGURAR (gerar QR code)
   GET /api/auth/2fa/configurar  (requer authMiddleware)
===================================================== */
router.get('/2fa/configurar', authMiddleware, async (req, res) => {
    try {
        const secretObj = speakeasy.generateSecret({ name: `LawTechPro:${req.user.email}` });
        const secret = secretObj.base32;
        const encryptedSecret = encrypt(secret);

        await pool.query(
            `UPDATE usuarios SET totp_secret = $1, totp_ativo = false WHERE id = $2`,
            [encryptedSecret, req.user.id]
        );

        const email = req.user.email;
        const otpauthUrl = speakeasy.otpauthURL({ secret, label: email, issuer: 'LawTechPro', encoding: 'base32' });
        const qrcode = await QRCode.toDataURL(otpauthUrl);

        res.json({ qrcode, secret, email });
    } catch (err) {
        logger.error(`❌ [2FA] Erro ao configurar: ${err.message}`);
        res.status(500).json({ ok: false, erro: 'Erro ao gerar configuração 2FA' });
    }
});

/* ======================================================
   2FA — ATIVAR (validar e ativar)
   POST /api/auth/2fa/ativar  (requer authMiddleware)
===================================================== */
router.post('/2fa/ativar', authMiddleware, async (req, res) => {
    try {
        const { codigo } = req.body;
        if (!codigo) return res.status(400).json({ ok: false, erro: 'Código obrigatório' });

        const result = await pool.query(
            `SELECT totp_secret FROM usuarios WHERE id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });

        const encryptedSecret = result.rows[0].totp_secret;
        if (!encryptedSecret) return res.status(400).json({ ok: false, erro: 'Configure o 2FA primeiro' });

        const secret = decrypt(encryptedSecret);
        const valido = speakeasy.totp.verify({ secret, encoding: 'base32', token: codigo, window: 1 });
        if (!valido) return res.status(400).json({ ok: false, erro: 'Código inválido' });

        const backupCodesPlain = Array.from({ length: 8 }, () =>
            crypto.randomBytes(5).toString('hex')
        );
        const backupCodesHash = await Promise.all(
            backupCodesPlain.map(c => bcrypt.hash(c, 10))
        );

        await pool.query(
            `UPDATE usuarios SET totp_ativo = true, totp_backup_codes = $1, totp_ativado_em = NOW() WHERE id = $2`,
            [JSON.stringify(backupCodesHash), req.user.id]
        );

        registrarAudit({
            usuario_id: req.user.id, email: req.user.email,
            escritorio_id: req.user.escritorio_id,
            acao: '2FA_ATIVADO', descricao: '2FA ativado com sucesso'
        });

        res.json({ ok: true, backup_codes: backupCodesPlain });
    } catch (err) {
        logger.error(`❌ [2FA] Erro ao ativar: ${err.message}`);
        res.status(500).json({ ok: false, erro: 'Erro ao ativar 2FA' });
    }
});

/* ======================================================
   2FA — DESATIVAR
   POST /api/auth/2fa/desativar  (requer authMiddleware)
===================================================== */
router.post('/2fa/desativar', authMiddleware, async (req, res) => {
    try {
        const { senha } = req.body;
        if (!senha) return res.status(400).json({ ok: false, erro: 'Senha obrigatória' });

        const result = await pool.query(
            `SELECT senha FROM usuarios WHERE id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });

        const senhaValida = await bcrypt.compare(senha, result.rows[0].senha);
        if (!senhaValida) return res.status(401).json({ ok: false, erro: 'Senha incorreta' });

        await pool.query(
            `UPDATE usuarios SET totp_ativo = false, totp_secret = NULL, totp_backup_codes = NULL, totp_ativado_em = NULL WHERE id = $1`,
            [req.user.id]
        );

        registrarAudit({
            usuario_id: req.user.id, email: req.user.email,
            escritorio_id: req.user.escritorio_id,
            acao: '2FA_DESATIVADO', descricao: '2FA desativado'
        });

        res.json({ ok: true });
    } catch (err) {
        logger.error(`❌ [2FA] Erro ao desativar: ${err.message}`);
        res.status(500).json({ ok: false, erro: 'Erro ao desativar 2FA' });
    }
});

/* ======================================================
   2FA — STATUS
   GET /api/auth/2fa/status  (requer authMiddleware)
===================================================== */
router.get('/2fa/status', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT totp_ativo, totp_ativado_em FROM usuarios WHERE id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });
        const { totp_ativo, totp_ativado_em } = result.rows[0];
        res.json({ ativo: totp_ativo || false, ativado_em: totp_ativado_em || null });
    } catch (err) {
        res.status(500).json({ ok: false, erro: 'Erro ao buscar status 2FA' });
    }
});

/* ======================================================
   2FA — VERIFICAR código TOTP (rota pública, usa temp_token)
   POST /api/auth/2fa/verificar
===================================================== */
router.post('/2fa/verificar', limiter2FA, async (req, res) => {
    try {
        const { temp_token, codigo } = req.body;
        if (!temp_token || !codigo) return res.status(400).json({ ok: false, erro: 'Dados obrigatórios' });

        let payload;
        try {
            payload = jwtVerify(temp_token);
        } catch (_) {
            return res.status(401).json({ ok: false, erro: 'Token inválido ou expirado' });
        }

        if (payload.scope !== '2fa') return res.status(401).json({ ok: false, erro: 'Token inválido' });

        const result = await pool.query(
            `SELECT u.id, u.nome, u.email, u.role, u.escritorio_id, u.totp_secret,
                    e.plano_id, e.plano_financeiro_status, e.ultimo_pagamento, e.proxima_cobranca,
                    e.trial_expira_em, p.preco_mensal
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             LEFT JOIN planos p ON e.plano_id = p.id
             WHERE u.id = $1`,
            [payload.id]
        );

        if (result.rows.length === 0) return res.status(401).json({ ok: false, erro: 'Usuário não encontrado' });

        const usuario = result.rows[0];
        const secret = decrypt(usuario.totp_secret);
        const valido = speakeasy.totp.verify({ secret, encoding: 'base32', token: codigo, window: 1 });
        if (!valido) return res.status(401).json({ ok: false, erro: 'Código inválido. Tente novamente.' });

        const token = jwtSign({
            id: usuario.id,
            email: usuario.email,
            escritorio_id: usuario.escritorio_id,
            role: usuario.role
        });

        let diasRestantes = 0;
        if (usuario.trial_expira_em) {
            diasRestantes = Math.ceil((new Date(usuario.trial_expira_em) - new Date()) / (1000 * 60 * 60 * 24));
        }

        registrarAudit({
            usuario_id: usuario.id, email: usuario.email, escritorio_id: usuario.escritorio_id,
            acao: 'LOGIN_2FA', descricao: 'Login com 2FA bem-sucedido',
            ip: req.ip, user_agent: req.get('user-agent')
        });

        res.json({
            ok: true,
            token,
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                role: usuario.role,
                escritorio_id: usuario.escritorio_id,
                plano_id: usuario.plano_id,
                plano_financeiro_status: usuario.plano_financeiro_status,
                ultimo_pagamento: usuario.ultimo_pagamento,
                proxima_cobranca: usuario.proxima_cobranca,
                dias_restantes: diasRestantes
            }
        });
    } catch (err) {
        logger.error(`❌ [2FA] Erro ao verificar: ${err.message}`);
        res.status(500).json({ ok: false, erro: 'Erro ao verificar código' });
    }
});

/* ======================================================
   2FA — USAR BACKUP CODE (rota pública, usa temp_token)
   POST /api/auth/2fa/usar-backup
===================================================== */
router.post('/2fa/usar-backup', limiter2FA, async (req, res) => {
    try {
        const { temp_token, codigo_backup } = req.body;
        if (!temp_token || !codigo_backup) return res.status(400).json({ ok: false, erro: 'Dados obrigatórios' });

        let payload;
        try {
            payload = jwtVerify(temp_token);
        } catch (_) {
            return res.status(401).json({ ok: false, erro: 'Token inválido ou expirado' });
        }

        if (payload.scope !== '2fa') return res.status(401).json({ ok: false, erro: 'Token inválido' });

        const result = await pool.query(
            `SELECT u.id, u.nome, u.email, u.role, u.escritorio_id, u.totp_backup_codes,
                    e.plano_id, e.plano_financeiro_status, e.ultimo_pagamento, e.proxima_cobranca,
                    e.trial_expira_em
             FROM usuarios u
             JOIN escritorios e ON u.escritorio_id = e.id
             WHERE u.id = $1`,
            [payload.id]
        );

        if (result.rows.length === 0) return res.status(401).json({ ok: false, erro: 'Usuário não encontrado' });

        const usuario = result.rows[0];
        let backupCodes = [];
        try { backupCodes = JSON.parse(usuario.totp_backup_codes || '[]'); } catch (_) {}

        let indiceEncontrado = -1;
        for (let i = 0; i < backupCodes.length; i++) {
            const valido = await bcrypt.compare(codigo_backup.trim(), backupCodes[i]);
            if (valido) { indiceEncontrado = i; break; }
        }

        if (indiceEncontrado === -1) return res.status(401).json({ ok: false, erro: 'Código de backup inválido' });

        backupCodes.splice(indiceEncontrado, 1);
        await pool.query(
            `UPDATE usuarios SET totp_backup_codes = $1 WHERE id = $2`,
            [JSON.stringify(backupCodes), usuario.id]
        );

        const token = jwtSign({
            id: usuario.id,
            email: usuario.email,
            escritorio_id: usuario.escritorio_id,
            role: usuario.role
        });

        let diasRestantes = 0;
        if (usuario.trial_expira_em) {
            diasRestantes = Math.ceil((new Date(usuario.trial_expira_em) - new Date()) / (1000 * 60 * 60 * 24));
        }

        registrarAudit({
            usuario_id: usuario.id, email: usuario.email, escritorio_id: usuario.escritorio_id,
            acao: 'LOGIN_2FA_BACKUP', descricao: 'Login com código de backup 2FA',
            ip: req.ip, user_agent: req.get('user-agent')
        });

        res.json({
            ok: true,
            token,
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                role: usuario.role,
                escritorio_id: usuario.escritorio_id,
                plano_id: usuario.plano_id,
                plano_financeiro_status: usuario.plano_financeiro_status,
                ultimo_pagamento: usuario.ultimo_pagamento,
                proxima_cobranca: usuario.proxima_cobranca,
                dias_restantes: diasRestantes
            }
        });
    } catch (err) {
        logger.error(`❌ [2FA] Erro ao usar backup: ${err.message}`);
        res.status(500).json({ ok: false, erro: 'Erro ao processar código de backup' });
    }
});

module.exports = router;
