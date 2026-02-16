const xss = require('xss');

/**
 * Middleware que sanitiza todos os campos string do req.body contra XSS.
 * Aplicar globalmente ou em rotas que recebem input do usuário.
 */
function sanitizeBody(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        sanitizeObject(req.body);
    }
    if (req.query && typeof req.query === 'object') {
        sanitizeObject(req.query);
    }
    if (req.params && typeof req.params === 'object') {
        sanitizeObject(req.params);
    }
    next();
}

function sanitizeObject(obj) {
    for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'string') {
            obj[key] = xss(obj[key]);
        } else if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
            sanitizeObject(obj[key]);
        } else if (Array.isArray(obj[key])) {
            obj[key] = obj[key].map(item =>
                typeof item === 'string' ? xss(item) : item
            );
        }
    }
}

module.exports = { sanitizeBody };
