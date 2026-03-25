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

// ─── Interceptor global de 401 / 403 ─────────────────────────────────────────
// captura fetch() direto em qualquer página
(function () {
    const _fetch = window.fetch;
    window.fetch = async function (url, opts) {
        const res = await _fetch(url, opts);
        const urlStr = typeof url === 'string' ? url : '';

        // 401 — token inválido/expirado
        if (
            res.status === 401 &&
            urlStr.startsWith('/api/') &&
            !urlStr.startsWith('/api/auth/') &&
            (localStorage.getItem('token') || sessionStorage.getItem('token'))
        ) {
            localStorage.removeItem('token');
            sessionStorage.removeItem('token');
            window.location.href = '/login';
        }

        // 403 — e-mail não verificado
        if (
            res.status === 403 &&
            urlStr.startsWith('/api/') &&
            !urlStr.includes('/reenviar-verificacao') &&
            !window.location.pathname.includes('/verificar-email')
        ) {
            window.location.href = '/verificar-email.html?pendente=1';
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

// ─── Badge de novos andamentos na sidebar ─────────────────────────────────────
// Consulta a cada 5 min quantos processos têm andamentos não vistos e exibe
// um badge numérico vermelho ao lado do link "Processos" em qualquer página.
(function () {
    if (!localStorage.getItem('token') && !sessionStorage.getItem('token')) return;

    // Não executar em páginas públicas sem sidebar autenticada
    const paginasPublicas = ['/nova-senha', '/recuperar-senha', '/login', '/portal-cliente', '/verificar-email', '/registro'];
    if (paginasPublicas.some(p => window.location.pathname.includes(p))) return;

    function atualizarBadgeProcessos(total) {
        const link = document.querySelector('a[href="/processos-page"]');
        if (!link) return;

        let badge = document.getElementById('badge-processos-novos');
        if (!badge) {
            badge = document.createElement('span');
            badge.id = 'badge-processos-novos';
            badge.style.cssText = [
                'display:inline-flex', 'align-items:center', 'justify-content:center',
                'min-width:18px', 'height:18px', 'padding:0 5px',
                'background:#ef4444', 'color:#fff',
                'border-radius:9px', 'font-size:11px', 'font-weight:700',
                'margin-left:6px', 'line-height:1'
            ].join(';');
            link.appendChild(badge);
        }

        if (total > 0) {
            badge.textContent = total > 99 ? '99+' : total;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    function verificarNovosAndamentos() {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        if (!token) return;
        fetch('/api/processos/novos-andamentos', {
            headers: { 'Authorization': 'Bearer ' + token }
        })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) { if (d && d.ok) atualizarBadgeProcessos(d.total); })
        .catch(function() {});
    }

    // Executa ao carregar a página e depois a cada 5 minutos
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(verificarNovosAndamentos, 1500); // pequeno delay para sidebar renderizar
        setInterval(verificarNovosAndamentos, 5 * 60 * 1000);
    });

    // Expõe para que processos.js possa atualizar o badge ao marcar como visto
    window.atualizarBadgeProcessos = atualizarBadgeProcessos;
    window.verificarNovosAndamentos = verificarNovosAndamentos;
})();
