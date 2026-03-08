/**
 * API — Utilitário global de fetch autenticado
 * Centraliza: Authorization header, tratamento de 401, e métodos HTTP.
 * Incluir ANTES de qualquer script de página.
 */

// ─── Event delegation global ──────────────────────────────────────────────────
// Botões com data-action="fn" (+ data-args='[...]' opcional) são despachados
// para window.fn(...args, elemento). Substitui onclick="fn(args)" no HTML.
// Usado para eliminar unsafe-inline do CSP (scriptSrcAttr).
document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = el.dataset.action;
    if (typeof window[fn] !== 'function') return;
    let args = [];
    if (el.dataset.args) {
        try { args = JSON.parse(el.dataset.args); } catch (_) {}
    }
    args.push(el); // elemento sempre disponível como último argumento
    window[fn](...args);
});

// ─── Interceptor global de 401 ────────────────────────────────────────────────
// captura fetch() direto em qualquer página
(function () {
    const _fetch = window.fetch;
    window.fetch = async function (url, opts) {
        const res = await _fetch(url, opts);
        if (
            res.status === 401 &&
            typeof url === 'string' &&
            url.startsWith('/api/') &&
            !url.startsWith('/api/auth/') &&
            (localStorage.getItem('token') || sessionStorage.getItem('token'))
        ) {
            localStorage.removeItem('token');
            sessionStorage.removeItem('token');
            window.location.href = '/login';
        }
        return res;
    };
})();

const API = (() => {
    function getToken() {
        return localStorage.getItem('token') || sessionStorage.getItem('token');
    }

    function authHeaders(extra) {
        const h = { 'Authorization': 'Bearer ' + getToken() };
        if (extra) Object.assign(h, extra);
        return h;
    }

    function handleUnauth() {
        localStorage.removeItem('token');
        sessionStorage.removeItem('token');
        window.location.href = '/login.html';
    }

    async function logout() {
        try {
            await request('POST', '/api/auth/logout', null, false);
        } catch (_) {}
        localStorage.removeItem('token');
        sessionStorage.removeItem('token');
        window.location.href = '/login.html';
    }

    async function request(method, url, body, isJson) {
        const headers = authHeaders(isJson && body ? { 'Content-Type': 'application/json' } : undefined);
        const opts = { method: method, headers: headers };
        if (body && isJson) opts.body = JSON.stringify(body);
        else if (body) opts.body = body; // FormData para upload
        try {
            const res = await fetch(url, opts);
            if (res.status === 401) { handleUnauth(); return null; }
            return res;
        } catch (err) {
            console.error('[API] ' + method + ' ' + url + ':', err.message);
            return null;
        }
    }

    return {
        get:    function(url)       { return request('GET',    url, null,  false); },
        post:   function(url, body) { return request('POST',   url, body,  true);  },
        put:    function(url, body) { return request('PUT',    url, body,  true);  },
        patch:  function(url, body) { return request('PATCH',  url, body,  true);  },
        delete: function(url)       { return request('DELETE', url, null,  false); },
        upload: function(url, fd)   { return request('POST',   url, fd,    false); },
        getToken:    getToken,
        authHeaders: authHeaders,
        logout:      logout
    };
})();
