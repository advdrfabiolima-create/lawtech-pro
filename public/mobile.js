/**
 * LawTech Pro — Mobile Navigation & Sidebar Toggle
 * Script compartilhado injetado em todas as páginas do sistema.
 *
 * - Páginas internas (com <aside class="sidebar">): cria botão
 *   hamburger flutuante que desliza a sidebar sobre o conteúdo.
 * - Páginas públicas (sobre-nos, blog, termos, etc.): injeta
 *   dropdown mobile na nav bar superior.
 * - Tabelas: garante scroll horizontal automático no mobile.
 */
(function () {
    'use strict';

    // ============================================================
    // UTILITÁRIOS
    // ============================================================
    function isMobile() { return window.innerWidth <= 768; }

    // ============================================================
    // TABELAS: scroll horizontal automático
    // ============================================================
    function wrapTables() {
        if (!isMobile()) return;
        document.querySelectorAll('table').forEach(function (table) {
            var parent = table.parentElement;
            if (!parent) return;
            var style = window.getComputedStyle(parent);
            // Já tem overflow-x configurado?
            if (style.overflowX === 'auto' || style.overflowX === 'scroll') return;
            // Evita envolver elementos já marcados
            if (parent.classList.contains('mob-table-wrap')) return;

            var wrap = document.createElement('div');
            wrap.className = 'mob-table-wrap';
            wrap.style.overflowX = 'auto';
            wrap.style.webkitOverflowScrolling = 'touch';
            wrap.style.width = '100%';
            parent.insertBefore(wrap, table);
            wrap.appendChild(table);
        });
    }

    // ============================================================
    // PÁGINAS INTERNAS: sidebar com botão hamburger flutuante
    // ============================================================
    var sidebar = document.querySelector('aside.sidebar');

    if (sidebar) {
        // --- Overlay ---
        var overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        document.body.appendChild(overlay);

        // --- Botão hamburger ---
        var btn = document.createElement('button');
        btn.className = 'mobile-menu-btn';
        btn.setAttribute('aria-label', 'Abrir menu lateral');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = '<span></span><span></span><span></span>';
        document.body.appendChild(btn);

        function openSidebar() {
            sidebar.classList.add('mobile-open');
            overlay.classList.add('active');
            btn.classList.add('open');
            btn.setAttribute('aria-expanded', 'true');
            document.body.style.overflow = 'hidden';
        }

        function closeSidebar() {
            sidebar.classList.remove('mobile-open');
            overlay.classList.remove('active');
            btn.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
            document.body.style.overflow = '';
        }

        btn.addEventListener('click', function () {
            sidebar.classList.contains('mobile-open') ? closeSidebar() : openSidebar();
        });

        overlay.addEventListener('click', closeSidebar);

        // Fecha ao clicar em qualquer link do menu (mobile)
        sidebar.querySelectorAll('a').forEach(function (link) {
            link.addEventListener('click', function () {
                if (isMobile()) closeSidebar();
            });
        });

        // Fecha ao redimensionar para desktop
        window.addEventListener('resize', function () {
            if (!isMobile()) closeSidebar();
        });

        // Tabelas dentro das páginas internas
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', wrapTables);
        } else {
            wrapTables();
        }

        return; // Página interna: fim
    }

    // ============================================================
    // PÁGINAS PÚBLICAS: hamburger na nav superior
    // Pula index.html (já tem #mainNav com hamburger) e login.html
    // ============================================================
    var nav = document.querySelector('nav');
    if (!nav) return;
    if (nav.id === 'mainNav') return;          // index.html — já tem hamburger
    if (!nav.querySelector('.nav-links')) return; // login.html, etc.

    var navLinksEl = nav.querySelector('.nav-links');
    var navBtnsEl  = nav.querySelector('.nav-buttons');

    // --- Monta o menu mobile ---
    var mobileMenu = document.createElement('div');
    mobileMenu.className = 'nav-mobile-pub';

    // Copia os links de navegação
    navLinksEl.querySelectorAll('a').forEach(function (a) {
        var link = document.createElement('a');
        link.setAttribute('href', a.getAttribute('href') || '#');
        link.textContent = a.textContent.trim();
        link.addEventListener('click', closeNavPub);
        mobileMenu.appendChild(link);
    });

    // Copia os botões (Login / Teste Grátis)
    if (navBtnsEl) {
        navBtnsEl.querySelectorAll('a').forEach(function (a, i) {
            var link = document.createElement('a');
            link.setAttribute('href', a.getAttribute('href') || '#');
            link.textContent = a.textContent.trim();
            link.className = 'nmob-btn ' + (i === 0 ? 'nmob-login' : 'nmob-primary');
            link.addEventListener('click', closeNavPub);
            mobileMenu.appendChild(link);
        });
    }

    nav.appendChild(mobileMenu);

    // --- Botão toggle ---
    var toggle = document.createElement('button');
    toggle.className = 'nav-toggle-pub';
    toggle.setAttribute('aria-label', 'Abrir menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span></span><span></span><span></span>';

    // Insere antes dos botões ou no final do container
    var container = nav.querySelector('.container') || nav;
    var refNode = navBtnsEl || null;
    if (refNode) {
        container.insertBefore(toggle, refNode);
    } else {
        container.appendChild(toggle);
    }

    toggle.addEventListener('click', function () {
        var open = nav.classList.toggle('pub-menu-open');
        toggle.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', String(open));
    });

    document.addEventListener('click', function (e) {
        if (!nav.contains(e.target)) closeNavPub();
    });

    window.addEventListener('resize', function () {
        if (!isMobile()) closeNavPub();
    });

    function closeNavPub() {
        nav.classList.remove('pub-menu-open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
    }

})();
