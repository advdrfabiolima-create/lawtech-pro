/**
 * API — Utilitário global de fetch autenticado
 * Centraliza: Authorization header, tratamento de 401, e métodos HTTP.
 * Incluir ANTES de qualquer script de página.
 */
const API = (() => {
    function getToken() {
        return localStorage.getItem('token');
    }

    function authHeaders(extra) {
        const h = { 'Authorization': 'Bearer ' + getToken() };
        if (extra) Object.assign(h, extra);
        return h;
    }

    function handleUnauth() {
        localStorage.removeItem('token');
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
        authHeaders: authHeaders
    };
})();
