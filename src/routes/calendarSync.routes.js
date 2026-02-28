const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../config/db');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// ── Helpers iCal ──────────────────────────────────────────────────────────────

/**
 * Normaliza qualquer valor de data (Date object ou string) para 'YYYY-MM-DD'.
 * O driver pg retorna DATE como string '2026-03-15' mas TIMESTAMP como Date.
 */
function normalizeDate(val) {
    if (val instanceof Date) return val.toISOString().split('T')[0];
    // string pode ser '2026-03-15' ou '2026-03-15T00:00:00.000Z'
    return String(val).split('T')[0];
}

function toICalDate(dateVal) {
    // '2026-03-15' → '20260315'
    return normalizeDate(dateVal).replace(/-/g, '');
}

function addOneDay(dateVal) {
    const dateStr = normalizeDate(dateVal);
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split('T')[0].replace(/-/g, '');
}

function toICalDateTime(dateVal, timeStr) {
    // '2026-03-15', '14:30:00' → '20260315T143000'
    const d = normalizeDate(dateVal).replace(/-/g, '');
    const t = String(timeStr).replace(/:/g, '').slice(0, 6);
    return `${d}T${t}`;
}

function addOneHour(timeStr) {
    // '14:30:00' → '153000'
    const parts = String(timeStr).split(':');
    const h = parseInt(parts[0] || 0);
    const m = parts[1] || '00';
    const s = parts[2] || '00';
    const newH = String(Math.min(h + 1, 23)).padStart(2, '0');
    return `${newH}${m}${s}`;
}

function escapeIcal(str) {
    if (!str) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '');
}

function foldLine(line) {
    // RFC 5545 says fold at 75 octets, but splitting bytes can corrupt multibyte
    // UTF-8 characters (e.g. emojis). Folding at character boundaries is safe
    // and accepted by all major calendar clients (Google, Apple, Outlook).
    if (line.length <= 75) return line;
    const chunks = [];
    let offset = 0;
    let first = true;
    while (offset < line.length) {
        const limit = first ? 75 : 74;
        chunks.push(line.slice(offset, offset + limit));
        offset += limit;
        first = false;
    }
    return chunks.join('\r\n ');
}

function buildIcal(escritorio, prazos, audiencias, feriados) {
    const lines = [];

    const push = (line) => lines.push(foldLine(line));

    // DTSTAMP: timestamp atual em UTC — obrigatório em todo VEVENT (RFC 5545)
    const now = new Date();
    const dtstamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    push('BEGIN:VCALENDAR');
    push('VERSION:2.0');
    push('PRODID:-//LawTech Pro//Calendario Juridico//PT');
    push('CALSCALE:GREGORIAN');
    push('METHOD:PUBLISH');
    push(`X-WR-CALNAME:LawTech Pro - ${escapeIcal(escritorio.nome)}`);
    push('X-WR-CALDESC:Prazos\\, Audiências e Feriados');
    push('X-WR-TIMEZONE:America/Sao_Paulo');

    // VTIMEZONE block (America/Sao_Paulo — UTC-3 sem DST desde 2019)
    push('BEGIN:VTIMEZONE');
    push('TZID:America/Sao_Paulo');
    push('BEGIN:STANDARD');
    push('DTSTART:19700101T000000');
    push('TZOFFSETFROM:-0300');
    push('TZOFFSETTO:-0300');
    push('TZNAME:BRT');
    push('END:STANDARD');
    push('END:VTIMEZONE');

    // ── Prazos ──────────────────────────────────────────────────────────────
    for (const p of prazos) {
        const dtstart = toICalDate(p.data_limite);
        const dtend   = addOneDay(p.data_limite);
        const cliente = p.cliente_nome || p.processo_numero || 'Processo';
        const summary = `[Prazo] ${escapeIcal(p.tipo)} - ${escapeIcal(cliente)}`;
        const desc = [
            p.processo_numero ? `Processo: ${p.processo_numero}` : null,
            p.cliente_nome    ? `Cliente: ${p.cliente_nome}`     : null,
            p.descricao       ? `Observacoes: ${p.descricao}`    : null,
        ].filter(Boolean).join('\\n');

        push('BEGIN:VEVENT');
        push(`UID:prazo-${p.id}@lawtechpro.com.br`);
        push(`DTSTAMP:${dtstamp}`);
        push(`SEQUENCE:0`);
        push(`DTSTART;VALUE=DATE:${dtstart}`);
        push(`DTEND;VALUE=DATE:${dtend}`);
        push(`SUMMARY:${summary}`);
        if (desc) push(`DESCRIPTION:${desc}`);
        push('STATUS:CONFIRMED');
        push('END:VEVENT');
    }

    // ── Audiências ──────────────────────────────────────────────────────────
    for (const a of audiencias) {
        const dateStr = a.data_audiencia instanceof Date
            ? a.data_audiencia.toISOString().split('T')[0]
            : String(a.data_audiencia).split('T')[0];
        const timeStr = a.hora_audiencia ? String(a.hora_audiencia) : '09:00:00';
        const dtstart = toICalDateTime(dateStr, timeStr);
        const dtendT  = addOneHour(timeStr);
        const dtend   = `${String(dateStr).replace(/-/g, '').slice(0, 8)}T${dtendT}`;
        const cliente = a.cliente_nome || a.processo_numero || 'Processo';
        const summary = `[Audiencia] ${escapeIcal(a.tipo_audiencia)} - ${escapeIcal(cliente)}`;
        const desc = [
            a.processo_numero ? `Processo: ${a.processo_numero}` : null,
            a.local_virtual   ? `Local: ${a.local_virtual}`      : null,
        ].filter(Boolean).join('\\n');

        push('BEGIN:VEVENT');
        push(`UID:audiencia-${a.id}@lawtechpro.com.br`);
        push(`DTSTAMP:${dtstamp}`);
        push(`SEQUENCE:0`);
        push(`DTSTART;TZID=America/Sao_Paulo:${dtstart}`);
        push(`DTEND;TZID=America/Sao_Paulo:${dtend}`);
        push(`SUMMARY:${summary}`);
        if (desc)             push(`DESCRIPTION:${desc}`);
        if (a.local_virtual)  push(`LOCATION:${escapeIcal(a.local_virtual)}`);
        push('STATUS:CONFIRMED');
        push('END:VEVENT');
    }

    // ── Feriados / Suspensões ────────────────────────────────────────────────
    for (const f of feriados) {
        const dateStr = f.data instanceof Date
            ? f.data.toISOString().split('T')[0]
            : String(f.data).split('T')[0];
        const dtstart = toICalDate(dateStr);
        const dtend   = addOneDay(dateStr);
        const prefix  = f.tipo === 'feriado' ? '[Feriado]' : '[Suspensao]';
        const summary = `${prefix} ${escapeIcal(f.titulo)}`;

        push('BEGIN:VEVENT');
        push(`UID:feriado-${f.id}@lawtechpro.com.br`);
        push(`DTSTAMP:${dtstamp}`);
        push(`SEQUENCE:0`);
        push(`DTSTART;VALUE=DATE:${dtstart}`);
        push(`DTEND;VALUE=DATE:${dtend}`);
        push(`SUMMARY:${summary}`);
        if (f.recorrente) push('RRULE:FREQ=YEARLY');
        push('END:VEVENT');
    }

    push('END:VCALENDAR');

    return lines.join('\r\n') + '\r\n';
}

// ── Rotas ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/calendario/ical/status
 * Retorna (e cria lazily) o token iCal do escritório, mais a URL montada.
 */
router.get('/api/calendario/ical/status', authMiddleware, async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;

        // Busca token atual
        let result = await pool.query(
            'SELECT ical_token, nome FROM escritorios WHERE id = $1',
            [escritorioId]
        );
        let row = result.rows[0];
        if (!row) return res.status(404).json({ ok: false, erro: 'Escritório não encontrado' });

        // Lazy generation: cria token se ainda não existe
        if (!row.ical_token) {
            const newToken = crypto.randomBytes(24).toString('hex');
            await pool.query(
                'UPDATE escritorios SET ical_token = $1 WHERE id = $2',
                [newToken, escritorioId]
            );
            row.ical_token = newToken;
        }

        const host = req.get('host');
        const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
        const url = `${protocol}://${host}/calendario/ical/${row.ical_token}.ics`;

        return res.json({ ok: true, token: row.ical_token, url });
    } catch (err) {
        console.error('[iCal] Erro em GET /status:', err.message);
        return res.status(500).json({ ok: false, erro: err.message });
    }
});

/**
 * POST /api/calendario/ical/regenerar
 * Gera novo token (invalida o antigo). Apenas admin.
 */
router.post('/api/calendario/ical/regenerar', authMiddleware, roleMiddleware('admin'), async (req, res) => {
    try {
        const escritorioId = req.user.escritorio_id;
        const newToken = crypto.randomBytes(24).toString('hex');

        await pool.query(
            'UPDATE escritorios SET ical_token = $1 WHERE id = $2',
            [newToken, escritorioId]
        );

        const host = req.get('host');
        const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
        const url = `${protocol}://${host}/calendario/ical/${newToken}.ics`;

        return res.json({ ok: true, token: newToken, url });
    } catch (err) {
        console.error('[iCal] Erro em POST /regenerar:', err.message);
        return res.status(500).json({ ok: false, erro: err.message });
    }
});

/**
 * GET /calendario/ical/:token.ics
 * Feed iCal público — autenticação via token na URL.
 * Retorna text/calendar com prazos + audiências + feriados do escritório.
 */
router.get('/calendario/ical/:tokenFile', async (req, res) => {
    try {
        // tokenFile = "abc123...ics" — strip .ics
        const tokenFile = req.params.tokenFile;
        const token = tokenFile.endsWith('.ics')
            ? tokenFile.slice(0, -4)
            : tokenFile;

        if (!token || token.length < 32) {
            return res.status(404).send('Feed não encontrado.');
        }

        // Identificar escritório pelo token
        const escResult = await pool.query(
            'SELECT id, nome FROM escritorios WHERE ical_token = $1',
            [token]
        );
        if (!escResult.rows.length) {
            return res.status(404).send('Feed não encontrado.');
        }
        const escritorio = escResult.rows[0];
        const escritorioId = escritorio.id;

        // Prazos ativos (aberto, atrasado, hoje)
        const prazosResult = await pool.query(`
            SELECT p.id, p.tipo, p.descricao, p.data_limite,
                   pr.numero AS processo_numero, c.nome AS cliente_nome
            FROM prazos p
            LEFT JOIN processos pr ON pr.id = p.processo_id
            LEFT JOIN clientes c   ON c.id  = p.cliente_id
            WHERE p.escritorio_id = $1
              AND p.deletado = false
              AND p.status IN ('aberto', 'atrasado', 'hoje')
            ORDER BY p.data_limite ASC
        `, [escritorioId]);

        // Audiências futuras (não realizadas)
        const audienciasResult = await pool.query(`
            SELECT a.id, a.tipo_audiencia, a.data_audiencia, a.hora_audiencia, a.local_virtual,
                   pr.numero AS processo_numero, c.nome AS cliente_nome
            FROM audiencias a
            LEFT JOIN processos pr ON pr.id  = a.processo_id
            LEFT JOIN clientes c   ON c.id   = pr.cliente_id
            WHERE pr.escritorio_id = $1
              AND a.realizada = false
            ORDER BY a.data_audiencia ASC, a.hora_audiencia ASC
        `, [escritorioId]);

        // Feriados / Suspensões
        const feriadosResult = await pool.query(`
            SELECT id, titulo, data, tipo, recorrente
            FROM feriados_suspensoes
            WHERE escritorio_id = $1
            ORDER BY data ASC
        `, [escritorioId]);

        const ical = buildIcal(
            escritorio,
            prazosResult.rows,
            audienciasResult.rows,
            feriadosResult.rows
        );

        res.set('Content-Type', 'text/calendar; charset=utf-8');
        res.set('Content-Disposition', 'inline; filename="lawtechpro.ics"');
        res.set('Cache-Control', 'public, max-age=300');
        return res.send(ical);

    } catch (err) {
        console.error('[iCal] Erro ao gerar feed:', err.message);
        return res.status(500).send('Erro interno ao gerar calendário.');
    }
});

module.exports = router;
