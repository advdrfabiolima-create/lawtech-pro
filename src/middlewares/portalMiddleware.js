const { verify: jwtVerify } = require('../config/jwt');
const pool = require('../config/db');

const portalMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ ok: false, erro: 'Token não informado' });
    }

    const [, token] = authHeader.split(' ');

    try {
        const decoded = jwtVerify(token);

        if (decoded.scope !== 'portal_cliente') {
            return res.status(401).json({ ok: false, erro: 'Token inválido para o portal do cliente.' });
        }

        const result = await pool.query(
            'SELECT id, nome, email, escritorio_id FROM clientes WHERE id = $1',
            [decoded.cliente_id]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ ok: false, erro: 'Cliente não encontrado.' });
        }

        req.cliente = result.rows[0];
        next();
    } catch (err) {
        console.error('❌ [PORTAL] Erro de autenticação:', err.message);
        return res.status(401).json({ ok: false, erro: 'Token inválido ou expirado.' });
    }
};

module.exports = portalMiddleware;
