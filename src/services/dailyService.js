const axios = require('axios');

const DAILY_BASE = 'https://api.daily.co/v1';

function dailyApi() {
    return axios.create({
        baseURL: DAILY_BASE,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.DAILY_API_KEY}`
        },
        timeout: 15000
    });
}

/**
 * Cria uma sala privada no Daily.co.
 * @param {number} reuniaoId - ID da reunião no banco
 * @param {number} expTimestamp - Expiração em segundos Unix
 * @returns {{ name: string, url: string }}
 */
async function criarSala(reuniaoId, expTimestamp) {
    const name = `reuniao-${reuniaoId}-${Date.now()}`;
    const body = {
        name,
        privacy: 'private',
        properties: {
            exp: expTimestamp,
            max_participants: 10
        }
    };

    const res = await dailyApi().post('/rooms', body);
    return { name: res.data.name, url: res.data.url };
}

/**
 * Cria um token de acesso Daily.co para entrar na sala.
 * @param {string} roomName - Nome da sala
 * @param {boolean} isOwner - true = advogado (owner), false = cliente (participante)
 * @param {number} expTimestamp - Expiração em segundos Unix
 * @returns {string} token JWT do Daily.co
 */
async function criarToken(roomName, isOwner, expTimestamp) {
    const body = {
        properties: {
            room_name: roomName,
            exp: expTimestamp,
            is_owner: isOwner
        }
    };

    const res = await dailyApi().post('/meeting-tokens', body);
    return res.data.token;
}

/**
 * Deleta uma sala do Daily.co.
 * @param {string} roomName - Nome da sala a deletar
 */
async function deletarSala(roomName) {
    await dailyApi().delete(`/rooms/${roomName}`);
}

module.exports = { criarSala, criarToken, deletarSala };
