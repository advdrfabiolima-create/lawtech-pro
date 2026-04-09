(function () {
    'use strict';

    var TOKEN_KEY = 'token';
    var USER_KEY = 'usuario';
    var deferredInstallPrompt = null;
    var tabAtual = 'clientes';
    var dadosCarregados = {};
    var todosOsPrazos = [];
    var filtroAtivo = 'todos';
    var searchTimerClientes = null;
    var searchTimerProcessos = null;

    // ─── UTILITÁRIOS ──────────────────────────────────────────────────────────

    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function apiGet(endpoint) {
        return fetch(endpoint, {
            headers: { 'Authorization': 'Bearer ' + getToken() }
        }).then(function (r) {
            if (r.status === 401 || r.status === 402) {
                logout();
                return null;
            }
            return r.json();
        });
    }

    function mostrarToast(msg) {
        var t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(function () { t.classList.remove('show'); }, 2500);
    }

    function formatarData(str) {
        if (!str) return '—';
        var d = new Date(str);
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    }

    function formatarHora(str) {
        if (!str) return '';
        var d = new Date(str);
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    }

    function diaNumero(str) {
        if (!str) return '--';
        var d = new Date(str);
        return d.toLocaleDateString('pt-BR', { day: '2-digit', timeZone: 'America/Sao_Paulo' });
    }

    function mesAbrev(str) {
        if (!str) return '';
        var d = new Date(str);
        return d.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'America/Sao_Paulo' }).replace('.', '').toUpperCase();
    }

    function diasParaPrazo(str) {
        if (!str) return null;
        var hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        var prazo = new Date(str);
        prazo.setHours(0, 0, 0, 0);
        return Math.round((prazo - hoje) / 86400000);
    }

    function badgeStatus(status) {
        var map = {
            ativo: ['badge-verde', 'Ativo'],
            arquivado: ['badge-cinza', 'Arquivado'],
            encerrado: ['badge-cinza', 'Encerrado'],
            aberto: ['badge-azul', 'Aberto'],
            hoje: ['badge-laranja', 'Hoje'],
            atrasado: ['badge-vermelho', 'Atrasado'],
            virtual: ['badge-roxo', 'Virtual'],
            presencial: ['badge-azul', 'Presencial']
        };
        var r = map[status] || ['badge-cinza', status || ''];
        return '<span class="badge ' + r[0] + '">' + r[1] + '</span>';
    }

    function iconeVazio(icone, msg) {
        return '<div class="empty">' +
            '<i data-lucide="' + icone + '"></i>' +
            '<p>' + msg + '</p>' +
            '</div>';
    }

    // ─── AUTH ─────────────────────────────────────────────────────────────────

    function logout() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        window.location.href = '/login?redirect=/app';
    }

    function carregarUsuario() {
        var cached = localStorage.getItem(USER_KEY);
        if (cached) {
            try {
                var u = JSON.parse(cached);
                var nome = u.nome || u.name || '';
                document.getElementById('userName').textContent = nome.split(' ')[0];
                return;
            } catch (e) { /* ignora */ }
        }
    }

    // ─── NAVEGAÇÃO ────────────────────────────────────────────────────────────

    function mostrarTab(nome) {
        tabAtual = nome;

        // Atualiza botões nav
        document.querySelectorAll('.nav-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === nome);
        });

        // Mostra seção
        document.querySelectorAll('.tab-content').forEach(function (el) {
            el.classList.remove('active');
        });
        var tab = document.getElementById('tab' + nome.charAt(0).toUpperCase() + nome.slice(1));
        if (tab) tab.classList.add('active');

        // Carrega dados
        if (!dadosCarregados[nome]) {
            dadosCarregados[nome] = true;
            if (nome === 'clientes') carregarClientes();
            if (nome === 'prazos') carregarPrazos();
            if (nome === 'processos') carregarProcessos();
            if (nome === 'audiencias') carregarAudiencias();
        }

        // Renderizar ícones na seção ativa
        if (window.lucide) lucide.createIcons();
    }

    // ─── CLIENTES ─────────────────────────────────────────────────────────────

    function carregarClientes(busca) {
        var url = '/api/clientes?limit=100';
        if (busca) url += '&search=' + encodeURIComponent(busca);

        var lista = document.getElementById('listaClientes');
        lista.innerHTML = '<div class="empty"><div class="spinner"></div></div>';

        apiGet(url).then(function (data) {
            if (!data) return;
            var clientes = data.data || data.clientes || (Array.isArray(data) ? data : []);
            var total = data.total || clientes.length;
            document.getElementById('countClientes').textContent = total;
            renderClientes(clientes);
        }).catch(function () {
            lista.innerHTML = iconeVazio('wifi-off', 'Erro ao carregar clientes');
            if (window.lucide) lucide.createIcons();
        });
    }

    function renderClientes(lista) {
        var el = document.getElementById('listaClientes');
        if (!lista.length) {
            el.innerHTML = iconeVazio('users', 'Nenhum cliente encontrado');
            if (window.lucide) lucide.createIcons();
            return;
        }

        el.innerHTML = lista.map(function (c) {
            return '<div class="card">' +
                '<div class="card-header">' +
                '<span class="card-title">' + esc(c.nome) + '</span>' +
                (c.total_processos > 0
                    ? '<span class="badge badge-azul">' + c.total_processos + ' proc.</span>'
                    : '') +
                '</div>' +
                '<div class="card-meta">' +
                (c.telefone ? '<span class="meta-item"><i data-lucide="phone"></i>' + esc(c.telefone) + '</span>' : '') +
                (c.email ? '<span class="meta-item"><i data-lucide="mail"></i>' + esc(c.email) + '</span>' : '') +
                (c.cidade ? '<span class="meta-item"><i data-lucide="map-pin"></i>' + esc(c.cidade) + (c.estado ? '/' + c.estado : '') + '</span>' : '') +
                '</div>' +
                '</div>';
        }).join('');

        if (window.lucide) lucide.createIcons();
    }

    // ─── PRAZOS ───────────────────────────────────────────────────────────────

    function carregarPrazos() {
        var lista = document.getElementById('listaPrazos');
        lista.innerHTML = '<div class="empty"><div class="spinner"></div></div>';

        apiGet('/api/prazos?limit=200').then(function (data) {
            if (!data) return;
            todosOsPrazos = data.data || (Array.isArray(data) ? data : []);
            renderPrazos();
        }).catch(function () {
            lista.innerHTML = iconeVazio('wifi-off', 'Erro ao carregar prazos');
            if (window.lucide) lucide.createIcons();
        });
    }

    function renderPrazos() {
        var lista = document.getElementById('listaPrazos');
        var hoje = new Date(); hoje.setHours(0, 0, 0, 0);

        var filtrados = todosOsPrazos.filter(function (p) {
            if (filtroAtivo === 'todos') return true;
            if (filtroAtivo === 'atrasado') return p.status === 'atrasado';
            if (filtroAtivo === 'hoje') return p.status === 'hoje';
            if (filtroAtivo === 'semana') {
                var dias = diasParaPrazo(p.data_limite);
                return dias !== null && dias >= 0 && dias <= 7;
            }
            return true;
        });

        if (!filtrados.length) {
            lista.innerHTML = iconeVazio('clock', 'Nenhum prazo encontrado');
            if (window.lucide) lucide.createIcons();
            return;
        }

        lista.innerHTML = filtrados.map(function (p) {
            var dias = diasParaPrazo(p.data_limite);
            var corBloco = '#dbeafe';
            var corTexto = '#1e40af';
            if (p.status === 'atrasado') { corBloco = '#fee2e2'; corTexto = '#991b1b'; }
            else if (p.status === 'hoje') { corBloco = '#fef3c7'; corTexto = '#92400e'; }

            var diasTexto = '';
            if (dias === null) diasTexto = '';
            else if (dias < 0) diasTexto = Math.abs(dias) + 'd atraso';
            else if (dias === 0) diasTexto = 'Hoje';
            else diasTexto = 'em ' + dias + 'd';

            return '<div class="card">' +
                '<div class="card-row">' +
                '<div class="prazo-left" style="background:' + corBloco + ';color:' + corTexto + '">' +
                '<div class="prazo-data">' + diaNumero(p.data_limite) + '</div>' +
                '<div class="prazo-mes">' + mesAbrev(p.data_limite) + '</div>' +
                '</div>' +
                '<div class="prazo-right">' +
                '<div class="card-header" style="margin-bottom:4px">' +
                '<span class="card-title">' + esc(p.titulo || 'Sem título') + '</span>' +
                badgeStatus(p.status) +
                '</div>' +
                '<div class="card-meta">' +
                (p.cliente_nome ? '<span class="meta-item"><i data-lucide="user"></i>' + esc(p.cliente_nome) + '</span>' : '') +
                (p.processo_numero ? '<span class="meta-item"><i data-lucide="folder"></i>' + esc(p.processo_numero) + '</span>' : '') +
                (diasTexto ? '<span class="meta-item" style="color:' + corTexto + ';font-weight:600;">' + diasTexto + '</span>' : '') +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>';
        }).join('');

        if (window.lucide) lucide.createIcons();
    }

    // ─── PROCESSOS ────────────────────────────────────────────────────────────

    function carregarProcessos(busca) {
        var url = '/api/processos?limit=100&status=ativo';
        if (busca) url += '&busca=' + encodeURIComponent(busca);

        var lista = document.getElementById('listaProcessos');
        lista.innerHTML = '<div class="empty"><div class="spinner"></div></div>';

        apiGet(url).then(function (data) {
            if (!data) return;
            var processos = data.data || (Array.isArray(data) ? data : []);
            var total = data.total || processos.length;
            document.getElementById('countProcessos').textContent = total;
            renderProcessos(processos);
        }).catch(function () {
            lista.innerHTML = iconeVazio('wifi-off', 'Erro ao carregar processos');
            if (window.lucide) lucide.createIcons();
        });
    }

    function renderProcessos(lista) {
        var el = document.getElementById('listaProcessos');
        if (!lista.length) {
            el.innerHTML = iconeVazio('folder-open', 'Nenhum processo encontrado');
            if (window.lucide) lucide.createIcons();
            return;
        }

        el.innerHTML = lista.map(function (p) {
            return '<div class="card">' +
                '<div class="card-header">' +
                '<span class="card-title" style="font-size:14px;font-family:monospace;">' + esc(p.numero) + '</span>' +
                badgeStatus(p.status) +
                '</div>' +
                '<div class="card-meta">' +
                (p.cliente ? '<span class="meta-item"><i data-lucide="user"></i>' + esc(p.cliente) + '</span>' : '') +
                (p.parte_contraria ? '<span class="meta-item"><i data-lucide="shield"></i>' + esc(p.parte_contraria) + '</span>' : '') +
                (p.tribunal ? '<span class="meta-item"><i data-lucide="landmark"></i>' + esc(p.tribunal) + '</span>' : '') +
                (p.uf ? '<span class="meta-item"><i data-lucide="map-pin"></i>' + esc(p.uf) + '</span>' : '') +
                '</div>' +
                '</div>';
        }).join('');

        if (window.lucide) lucide.createIcons();
    }

    // ─── AUDIÊNCIAS ───────────────────────────────────────────────────────────

    function carregarAudiencias() {
        var lista = document.getElementById('listaAudiencias');
        lista.innerHTML = '<div class="empty"><div class="spinner"></div></div>';

        apiGet('/api/audiencias?limit=100').then(function (data) {
            if (!data) return;
            var aud = Array.isArray(data) ? data : (data.data || []);

            // Ordena por data
            aud.sort(function (a, b) {
                return new Date(a.data_audiencia) - new Date(b.data_audiencia);
            });

            // Separa futuras e passadas
            var agora = new Date();
            var futuras = aud.filter(function (a) { return new Date(a.data_audiencia) >= agora; });
            var passadas = aud.filter(function (a) { return new Date(a.data_audiencia) < agora; }).reverse();

            renderAudiencias(futuras.concat(passadas), lista);
        }).catch(function () {
            lista.innerHTML = iconeVazio('wifi-off', 'Erro ao carregar audiências');
            if (window.lucide) lucide.createIcons();
        });
    }

    function renderAudiencias(lista, el) {
        if (!lista.length) {
            el.innerHTML = iconeVazio('calendar-check', 'Nenhuma audiência encontrada');
            if (window.lucide) lucide.createIcons();
            return;
        }

        var agora = new Date();

        el.innerHTML = lista.map(function (a) {
            var isPast = new Date(a.data_audiencia) < agora;
            var tipo = a.tipo ? a.tipo.replace(/_/g, ' ') : 'Audiência';
            tipo = tipo.charAt(0).toUpperCase() + tipo.slice(1);

            return '<div class="card" style="' + (isPast ? 'opacity:0.65;' : '') + '">' +
                '<div class="card-row">' +
                '<div class="aud-data-bloco" style="' + (isPast ? 'background:#64748b;' : '') + '">' +
                '<div class="aud-dia">' + diaNumero(a.data_audiencia) + '</div>' +
                '<div class="aud-mes">' + mesAbrev(a.data_audiencia) + '</div>' +
                '<div class="aud-hora">' + formatarHora(a.data_audiencia) + '</div>' +
                '</div>' +
                '<div style="flex:1">' +
                '<div class="card-header" style="margin-bottom:4px">' +
                '<span class="card-title">' + esc(tipo) + '</span>' +
                (a.virtual ? '<span class="badge badge-roxo">Virtual</span>' : '<span class="badge badge-azul">Presencial</span>') +
                '</div>' +
                '<div class="card-meta">' +
                (a.processo_numero ? '<span class="meta-item"><i data-lucide="folder"></i>' + esc(a.processo_numero) + '</span>' : '') +
                (a.cliente ? '<span class="meta-item"><i data-lucide="user"></i>' + esc(a.cliente) + '</span>' : '') +
                (a.local && !a.virtual ? '<span class="meta-item"><i data-lucide="map-pin"></i>' + esc(a.local) + '</span>' : '') +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>';
        }).join('');

        if (window.lucide) lucide.createIcons();
    }

    // ─── ESCAPE HTML ─────────────────────────────────────────────────────────

    function esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ─── INIT ─────────────────────────────────────────────────────────────────

    function init() {
        if (!getToken()) {
            window.location.href = '/login?redirect=/app';
            return;
        }

        carregarUsuario();

        // Registra service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/service-worker.js').catch(function () {});
        }

        // Nav buttons
        document.querySelectorAll('.nav-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                mostrarTab(btn.getAttribute('data-tab'));
            });
        });

        // Logout
        document.getElementById('btnLogout').addEventListener('click', function () {
            if (confirm('Deseja sair?')) logout();
        });

        // Filtros prazos
        document.querySelectorAll('.filtro-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.filtro-btn').forEach(function (b) { b.classList.remove('ativo'); });
                btn.classList.add('ativo');
                filtroAtivo = btn.getAttribute('data-filtro');
                renderPrazos();
            });
        });

        // Refresh prazos
        document.getElementById('btnRefreshPrazos').addEventListener('click', function () {
            dadosCarregados['prazos'] = false;
            carregarPrazos();
        });

        // Refresh audiências
        document.getElementById('btnRefreshAudiencias').addEventListener('click', function () {
            dadosCarregados['audiencias'] = false;
            carregarAudiencias();
        });

        // Search clientes (debounce 400ms)
        document.getElementById('searchClientes').addEventListener('input', function () {
            var val = this.value.trim();
            clearTimeout(searchTimerClientes);
            searchTimerClientes = setTimeout(function () {
                carregarClientes(val || null);
            }, 400);
        });

        // Search processos (debounce 400ms)
        document.getElementById('searchProcessos').addEventListener('input', function () {
            var val = this.value.trim();
            clearTimeout(searchTimerProcessos);
            searchTimerProcessos = setTimeout(function () {
                dadosCarregados['processos'] = true;
                carregarProcessos(val || null);
            }, 400);
        });

        // Tab inicial via query param ou padrão clientes
        var urlParams = new URLSearchParams(window.location.search);
        var tabInicial = urlParams.get('tab') || 'clientes';

        // Oculta loading e mostra app
        document.getElementById('loadingState').style.display = 'none';

        // Renderiza ícones e abre tab
        if (window.lucide) lucide.createIcons();
        mostrarTab(tabInicial);
    }

    // ─── PWA INSTALL ──────────────────────────────────────────────────────────

    // Android: captura o prompt de instalação nativo
    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredInstallPrompt = e;
        var btn = document.getElementById('btnInstalar');
        if (btn) btn.style.display = 'inline-block';
    });

    // iOS: detecta Safari no iPhone/iPad e mostra banner de instrução
    function verificarInstalavelIos() {
        var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
        var isStandalone = window.navigator.standalone === true;
        var jaDismissed = localStorage.getItem('ios_banner_dismissed');
        if (isIos && !isStandalone && !jaDismissed) {
            var banner = document.getElementById('bannerIos');
            if (banner) {
                setTimeout(function () { banner.style.display = 'block'; }, 1500);
            }
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        // Botão instalar Android
        var btnInstalar = document.getElementById('btnInstalar');
        if (btnInstalar) {
            btnInstalar.addEventListener('click', function () {
                if (!deferredInstallPrompt) return;
                deferredInstallPrompt.prompt();
                deferredInstallPrompt.userChoice.then(function () {
                    deferredInstallPrompt = null;
                    btnInstalar.style.display = 'none';
                });
            });
        }

        // Fechar banner iOS
        var btnFecharIos = document.getElementById('btnFecharIos');
        if (btnFecharIos) {
            btnFecharIos.addEventListener('click', function () {
                document.getElementById('bannerIos').style.display = 'none';
                localStorage.setItem('ios_banner_dismissed', '1');
            });
        }

        verificarInstalavelIos();
        init();
    });
})();
