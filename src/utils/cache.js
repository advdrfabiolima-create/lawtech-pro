const Redis = require('ioredis');
const logger = require('./logger');

let client = null;

if (process.env.REDIS_URL) {
    client = new Redis(process.env.REDIS_URL, { lazyConnect: true });
    client.on('error', (err) => logger.warn({ err: err.message }, 'Redis error — usando DB diretamente'));
    logger.info('Redis configurado via REDIS_URL');
}

async function get(key) {
    if (!client) return null;
    try {
        const val = await client.get(key);
        return val ? JSON.parse(val) : null;
    } catch (err) {
        logger.warn({ err: err.message, key }, 'Redis get falhou');
        return null;
    }
}

async function set(key, value, ttlSec = 60) {
    if (!client) return;
    try {
        await client.set(key, JSON.stringify(value), 'EX', ttlSec);
    } catch (err) {
        logger.warn({ err: err.message, key }, 'Redis set falhou');
    }
}

async function del(key) {
    if (!client) return;
    try {
        await client.del(key);
    } catch (err) {
        logger.warn({ err: err.message, key }, 'Redis del falhou');
    }
}

module.exports = { get, set, del };
