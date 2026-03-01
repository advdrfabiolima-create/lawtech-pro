const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

function requestLogger(req, res, next) {
    req.id = randomUUID();
    const start = Date.now();

    res.on('finish', () => {
        logger.info({
            reqId: req.id,
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration: Date.now() - start
        }, 'request completed');
    });

    next();
}

module.exports = requestLogger;
