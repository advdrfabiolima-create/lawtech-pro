(function () {
    'use strict';

    var TOKEN_KEY = 'token';
    var USER_KEY = 'usuario';
    var deferredInstallPrompt = null;
    var tabAtual = 'dashboard';
    var dadosCarregados = {};
    var todosOsPrazos = [];
    var todosOsClientes = [];
    var todasAsAudiencias = [];
    var filtroAtivo = 'todos';
    var filtroAud = 'agendadas';
    var calMes = new Date().getMonth() + 1;
    var calAno = new Date().getFullYear();
    var calDados = {};
    var calDiaSelecionado = null;
    var vistaAtiva = 'lista'; // 'lista' ou 'calendario'
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
            if (nome === 'dashboard') carregarDashboard();
            if (nome === 'clientes') carregarClientes();
            if (nome === 'prazos') carregarPrazos();
            if (nome === 'processos') carregarProcessos();
            if (nome === 'audiencias') carregarAudiencias();
        }

        // Renderizar ícones na seção ativa
        if (window.lucide) lucide.createIcons();
    }

    // ─── DASHBOARD ────────────────────────────────────────────────────────────

    function carregarDashboard() {
        // Saudação por horário
        var hora = new Date().getHours();
        var saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
        var usuario = localStorage.getItem(USER_KEY);
        var primeiroNome = '';
        try { primeiroNome = JSON.parse(usuario).nome.split(' ')[0]; } catch (e) {}
        document.getElementById('dashGreeting').textContent = saudacao + (primeiroNome ? ', ' + primeiroNome + '!' : '!');

        // Data por extenso
        var agora = new Date();
        document.getElementById('dashDate').textContent = agora.toLocaleDateString('pt-BR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });

        // Carrega contagens em paralelo
        Promise.all([
            apiGet('/api/clientes?limit=1'),
            apiGet('/api/prazos?limit=200'),
            apiGet('/api/processos?limit=1&status=ativo'),
            apiGet('/api/audiencias?limit=200')
        ]).then(function (res) {
            var dataClientes   = res[0];
            var dataPrazos     = res[1];
            var dataProcessos  = res[2];
            var dataAudiencias = res[3];

            // Clientes
            if (dataClientes) {
                document.getElementById('dashCountClientes').textContent = dataClientes.total || 0;
            }

            // Prazos — conta atrasados + hoje e mostra preview
            if (dataPrazos) {
                var prazos = dataPrazos.data || (Array.isArray(dataPrazos) ? dataPrazos : []);
                todosOsPrazos = prazos;
                var urgentes = prazos.filter(function (p) {
                    return p.status === 'atrasado' || p.status === 'hoje';
                });
                document.getElementById('dashCountPrazos').textContent = dataPrazos.total || prazos.length;
                document.getElementById('dashSubPrazos').textContent =
                    urgentes.length > 0 ? urgentes.length + ' urgente' + (urgentes.length > 1 ? 's' : '') : 'pendentes';
                renderDashPrazos(urgentes.slice(0, 5), prazos.slice(0, 5));
            }

            // Processos
            if (dataProcessos) {
                document.getElementById('dashCountProcessos').textContent = dataProcessos.total || 0;
            }

            // Audiências próximas
            if (dataAudiencias) {
                var aud = Array.isArray(dataAudiencias) ? dataAudiencias : (dataAudiencias.data || []);
                todasAsAudiencias = aud;
                var agora2 = new Date();
                var proximas = aud.filter(function (a) { return new Date(a.data_audiencia) >= agora2; });
                document.getElementById('dashCountAudiencias').textContent = proximas.length;
            }

            if (window.lucide) lucide.createIcons();
        });
    }

    function renderDashPrazos(urgentes, todos) {
        var el = document.getElementById('dashPrazosUrgentes');
        var lista = urgentes.length > 0 ? urgentes : todos;

        if (!lista || !lista.length) {
            el.innerHTML = '<div class="dash-empty-msg">Nenhum prazo urgente — tudo em dia! ✓</div>';
            return;
        }

        var titulo = urgentes.length > 0 ? '' : '';

        el.innerHTML = lista.map(function (p) {
            var cor = p.status === 'atrasado' ? '#dc2626' : p.status === 'hoje' ? '#d97706' : '#2563eb';
            var label = p.status === 'atrasado' ? 'Atrasado' : p.status === 'hoje' ? 'Hoje' : formatarData(p.data_limite);
            var bgLabel = p.status === 'atrasado' ? '#fee2e2' : p.status === 'hoje' ? '#fef3c7' : '#dbeafe';
            var corLabel = p.status === 'atrasado' ? '#991b1b' : p.status === 'hoje' ? '#92400e' : '#1e40af';

            return '<div class="dash-prazo-item" data-goto-prazos="1">' +
                '<div class="dash-prazo-dot" style="background:' + cor + ';"></div>' +
                '<div class="dash-prazo-info">' +
                '<div class="dash-prazo-titulo">' + esc(p.tipo || p.titulo || 'Sem título') + '</div>' +
                '<div class="dash-prazo-meta">' + esc(p.cliente_nome || '—') + '</div>' +
                '</div>' +
                '<span class="dash-prazo-badge" style="background:' + bgLabel + ';color:' + corLabel + ';">' + label + '</span>' +
                '</div>';
        }).join('');

        // Click nos prazos → vai para aba prazos
        el.querySelectorAll('[data-goto-prazos]').forEach(function (item) {
            item.addEventListener('click', function () { mostrarTab('prazos'); });
        });
    }

    // ─── CLIENTES ─────────────────────────────────────────────────────────────

    function carregarClientes(busca) {
        // Se já temos dados, filtra localmente (instantâneo)
        if (todosOsClientes.length > 0) {
            filtrarClientesLocal(busca);
            return;
        }

        var lista = document.getElementById('listaClientes');
        lista.innerHTML = '<div class="empty"><div class="spinner"></div></div>';

        apiGet('/api/clientes?limit=300').then(function (data) {
            if (!data) return;
            todosOsClientes = data.data || data.clientes || (Array.isArray(data) ? data : []);
            document.getElementById('countClientes').textContent = data.total || todosOsClientes.length;
            filtrarClientesLocal(busca);
        }).catch(function () {
            lista.innerHTML = iconeVazio('wifi-off', 'Erro ao carregar clientes');
            if (window.lucide) lucide.createIcons();
        });
    }

    function filtrarClientesLocal(busca) {
        var lista = document.getElementById('listaClientes');
        if (!busca || !busca.trim()) {
            document.getElementById('countClientes').textContent = todosOsClientes.length;
            renderClientes(todosOsClientes);
            return;
        }
        var termo = busca.trim().toLowerCase();
        var filtrados = todosOsClientes.filter(function (c) {
            return (c.nome && c.nome.toLowerCase().indexOf(termo) !== -1) ||
                   (c.email && c.email.toLowerCase().indexOf(termo) !== -1) ||
                   (c.telefone && c.telefone.toLowerCase().indexOf(termo) !== -1) ||
                   (c.documento && c.documento.toLowerCase().indexOf(termo) !== -1);
        });
        document.getElementById('countClientes').textContent = filtrados.length;
        renderClientes(filtrados);
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
                (c.telefone ? '<span class="meta-item">' + whatsappBtn(c.telefone) + '</span>' : '') +
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

            return '<div class="card" id="prazo-card-' + p.id + '">' +
                '<div class="card-row">' +
                '<div class="prazo-left" style="background:' + corBloco + ';color:' + corTexto + '">' +
                '<div class="prazo-data">' + diaNumero(p.data_limite) + '</div>' +
                '<div class="prazo-mes">' + mesAbrev(p.data_limite) + '</div>' +
                '</div>' +
                '<div class="prazo-right">' +
                '<div class="card-header" style="margin-bottom:4px">' +
                '<span class="card-title">' + esc(p.tipo || p.titulo || 'Sem título') + '</span>' +
                badgeStatus(p.status) +
                '</div>' +
                '<div class="card-meta">' +
                (p.cliente_nome ? '<span class="meta-item"><i data-lucide="user"></i>' + esc(p.cliente_nome) + '</span>' : '') +
                (p.processo_numero ? '<span class="meta-item"><i data-lucide="folder"></i>' + esc(p.processo_numero) + '</span>' : '') +
                (diasTexto ? '<span class="meta-item" style="color:' + corTexto + ';font-weight:600;">' + diasTexto + '</span>' : '') +
                '</div>' +
                '<div style="margin-top:10px;">' +
                '<button data-concluir-id="' + p.id + '" style="display:inline-flex;align-items:center;gap:6px;background:#059669;color:white;border:none;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;">' +
                '<i data-lucide="check-circle" style="width:15px;height:15px;"></i>Concluir' +
                '</button>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>';
        }).join('');

        // Listeners dos botões concluir
        document.getElementById('listaPrazos').querySelectorAll('[data-concluir-id]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                concluirPrazo(btn.getAttribute('data-concluir-id'), btn);
            });
        });

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

        apiGet('/api/audiencias?limit=200').then(function (data) {
            if (!data) return;
            todasAsAudiencias = Array.isArray(data) ? data : (data.data || []);
            renderAudiencias();
        }).catch(function () {
            lista.innerHTML = iconeVazio('wifi-off', 'Erro ao carregar audiências');
            if (window.lucide) lucide.createIcons();
        });
    }

    function renderAudiencias() {
        var el = document.getElementById('listaAudiencias');
        var agora = new Date();

        var filtradas = todasAsAudiencias.filter(function (a) {
            var data = new Date(a.data_audiencia);
            return filtroAud === 'agendadas' ? data >= agora : data < agora;
        });

        // Agendadas: mais próximas primeiro; Realizadas: mais recentes primeiro
        filtradas.sort(function (a, b) {
            var diff = new Date(a.data_audiencia) - new Date(b.data_audiencia);
            return filtroAud === 'agendadas' ? diff : -diff;
        });

        if (!filtradas.length) {
            el.innerHTML = iconeVazio('calendar-check',
                filtroAud === 'agendadas' ? 'Nenhuma audiência agendada' : 'Nenhuma audiência realizada');
            if (window.lucide) lucide.createIcons();
            return;
        }

        var corBloco = filtroAud === 'agendadas' ? 'var(--azul)' : '#64748b';

        el.innerHTML = filtradas.map(function (a, idx) {
            var tipo = (a.tipo_audiencia || a.tipo || 'Audiência').replace(/_/g, ' ');
            tipo = tipo.charAt(0).toUpperCase() + tipo.slice(1);
            var temTelefone = !!(a.telefone || '').replace(/\D/g, '');

            return '<div class="card">' +
                '<div class="card-row">' +
                '<div class="aud-data-bloco" style="background:' + corBloco + ';">' +
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
                '<div style="margin-top:8px;">' +
                '<button data-aud-idx="' + idx + '" style="display:inline-flex;align-items:center;gap:6px;background:' + (temTelefone ? '#25d366' : '#94a3b8') + ';color:white;border:none;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer;">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zm-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' +
                'Avisar pelo WhatsApp' +
                '</button>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>';
        }).join('');

        // Guarda referência para acesso pelo índice ao clicar
        el._audFiltradas = filtradas;

        // Listener delegado nos botões de WhatsApp
        el.querySelectorAll('[data-aud-idx]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = parseInt(btn.getAttribute('data-aud-idx'));
                avisarAudienciaZap(el._audFiltradas[idx]);
            });
        });

        if (window.lucide) lucide.createIcons();
    }

    // ─── CALENDÁRIO ──────────────────────────────────────────────────────────

    var MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    function alternarVista(vista) {
        vistaAtiva = vista;
        var wrapLista = document.getElementById('listaPrazosWrap');
        var wrapCal = document.getElementById('calendarioView');
        var btnLista = document.getElementById('btnToggleLista');
        var btnCal = document.getElementById('btnToggleCal');

        if (vista === 'lista') {
            wrapLista.classList.remove('oculto');
            wrapCal.classList.remove('ativo');
            btnLista.classList.add('ativo');
            btnCal.classList.remove('ativo');
        } else {
            wrapLista.classList.add('oculto');
            wrapCal.classList.add('ativo');
            btnCal.classList.add('ativo');
            btnLista.classList.remove('ativo');
            carregarCalendario();
        }
        if (window.lucide) lucide.createIcons();
    }

    function carregarCalendario() {
        var grid = document.getElementById('calGrid');
        grid.innerHTML = '<div style="grid-column:span 7;padding:30px;text-align:center;color:var(--cinza);"><div class="spinner" style="margin:0 auto;"></div></div>';

        apiGet('/api/calendario/mensal?mes=' + calMes + '&ano=' + calAno).then(function (data) {
            if (!data || !data.ok) return;
            calDados = data;
            desenharCalendario();
        }).catch(function () {
            grid.innerHTML = '<div style="grid-column:span 7;padding:20px;text-align:center;color:var(--cinza);">Erro ao carregar</div>';
        });
    }

    function desenharCalendario() {
        document.getElementById('calMesTitulo').textContent = MESES[calMes - 1] + ' ' + calAno;

        var hoje = new Date();
        var primeiroDia = new Date(calAno, calMes - 1, 1).getDay();
        var totalDias = new Date(calAno, calMes, 0).getDate();

        // Indexa eventos por dia
        var prazosPorDia = {}, feriadosPorDia = {}, compromissosPorDia = {};
        (calDados.prazos || []).forEach(function (p) {
            var d = new Date(p.data_limite).getUTCDate();
            if (!prazosPorDia[d]) prazosPorDia[d] = [];
            prazosPorDia[d].push(p);
        });
        (calDados.feriados || []).forEach(function (f) {
            var d = new Date(f.data).getUTCDate();
            if (!feriadosPorDia[d]) feriadosPorDia[d] = [];
            feriadosPorDia[d].push(f);
        });
        (calDados.compromissos || []).forEach(function (c) {
            var d = new Date(c.data + 'T12:00:00').getDate();
            if (!compromissosPorDia[d]) compromissosPorDia[d] = [];
            compromissosPorDia[d].push(c);
        });

        var dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        var html = dias.map(function (d) {
            return '<div class="cal-weekday">' + d + '</div>';
        }).join('');

        // Dias vazios
        for (var i = 0; i < primeiroDia; i++) html += '<div class="cal-day vazio"></div>';

        for (var dia = 1; dia <= totalDias; dia++) {
            var ehHoje = dia === hoje.getDate() && calMes === (hoje.getMonth() + 1) && calAno === hoje.getFullYear();
            var ehFeriado = !!feriadosPorDia[dia];
            var ehSelecionado = calDiaSelecionado === dia;

            var classes = 'cal-day';
            if (ehHoje) classes += ' hoje';
            if (ehFeriado) classes += ' feriado';
            if (ehSelecionado) classes += ' selecionado';

            var numHtml = '<div class="cal-day-num">' + dia + '</div>';

            var dots = '';
            if (feriadosPorDia[dia]) dots += '<div class="cal-dot cal-dot-feriado"></div>';
            if (prazosPorDia[dia]) {
                var nPrazos = Math.min(prazosPorDia[dia].length, 3);
                for (var k = 0; k < nPrazos; k++) dots += '<div class="cal-dot cal-dot-prazo"></div>';
            }
            if (compromissosPorDia[dia]) dots += '<div class="cal-dot cal-dot-compromisso"></div>';

            html += '<div class="' + classes + '" data-cal-dia="' + dia + '">' +
                numHtml +
                '<div class="cal-dots">' + dots + '</div>' +
                '</div>';
        }

        document.getElementById('calGrid').innerHTML = html;

        // Listener de toque nos dias
        document.getElementById('calGrid').querySelectorAll('[data-cal-dia]').forEach(function (el) {
            el.addEventListener('click', function () {
                var dia = parseInt(el.getAttribute('data-cal-dia'));
                calDiaSelecionado = dia;
                desenharCalendario(); // re-renderiza para mostrar seleção
                mostrarDetalhesDia(dia, prazosPorDia[dia], feriadosPorDia[dia], compromissosPorDia[dia]);
            });
        });

        if (calDiaSelecionado) {
            mostrarDetalhesDia(calDiaSelecionado, prazosPorDia[calDiaSelecionado], feriadosPorDia[calDiaSelecionado], compromissosPorDia[calDiaSelecionado]);
        }
    }

    function mostrarDetalhesDia(dia, prazos, feriados, compromissos) {
        var panel = document.getElementById('calDetalhePanel');
        var temEventos = (prazos && prazos.length) || (feriados && feriados.length) || (compromissos && compromissos.length);

        if (!temEventos) {
            panel.innerHTML = '<div class="cal-detalhe-header">' + dia + ' de ' + MESES[calMes - 1] + '</div>' +
                '<div class="cal-detalhe-item" style="color:var(--cinza);">Nenhum compromisso neste dia.</div>';
            panel.classList.add('ativo');
            return;
        }

        var items = '';
        (feriados || []).forEach(function (f) {
            items += '<div class="cal-detalhe-item">' +
                '<div class="cal-detalhe-dot" style="background:#dc2626;"></div>' +
                '<div><div class="cal-detalhe-titulo">' + esc(f.titulo) + '</div>' +
                '<div class="cal-detalhe-sub">' + (f.tipo === 'suspensao' ? 'Suspensão de prazo' : 'Feriado') + '</div></div>' +
                '</div>';
        });
        (prazos || []).forEach(function (p) {
            items += '<div class="cal-detalhe-item">' +
                '<div class="cal-detalhe-dot" style="background:#2563eb;"></div>' +
                '<div><div class="cal-detalhe-titulo">' + esc(p.tipo || 'Prazo') + '</div>' +
                '<div class="cal-detalhe-sub">' + esc(p.cliente || '') + (p.processo_numero ? ' · ' + p.processo_numero : '') + '</div></div>' +
                '</div>';
        });
        (compromissos || []).forEach(function (c) {
            var icones = { pagamento: '💰', reuniao: '📋', audiencia_externa: '⚖️', outro: '📌' };
            var ic = icones[c.tipo] || '📅';
            var val = c.valor ? ' · R$ ' + parseFloat(c.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
            items += '<div class="cal-detalhe-item">' +
                '<div class="cal-detalhe-dot" style="background:#d97706;"></div>' +
                '<div><div class="cal-detalhe-titulo">' + ic + ' ' + esc(c.titulo) + '</div>' +
                '<div class="cal-detalhe-sub">' + val + '</div></div>' +
                '</div>';
        });

        panel.innerHTML = '<div class="cal-detalhe-header">' + dia + ' de ' + MESES[calMes - 1] + ' de ' + calAno + '</div>' + items;
        panel.classList.add('ativo');

        // Scroll suave até o painel
        setTimeout(function () { panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
    }

    // ─── CONCLUIR PRAZO ──────────────────────────────────────────────────────

    function concluirPrazo(id, btn) {
        btn.disabled = true;
        btn.style.opacity = '0.6';
        btn.innerHTML = '<i data-lucide="loader" style="width:15px;height:15px;"></i>Salvando...';
        if (window.lucide) lucide.createIcons();

        fetch('/api/prazos/' + id + '/concluir', {
            method: 'PUT',
            headers: {
                'Authorization': 'Bearer ' + getToken(),
                'Content-Type': 'application/json'
            }
        }).then(function (r) { return r.json(); }).then(function (data) {
            if (data.sucesso || data.ok) {
                // Remove da lista local e re-renderiza
                todosOsPrazos = todosOsPrazos.filter(function (p) { return String(p.id) !== String(id); });
                var card = document.getElementById('prazo-card-' + id);
                if (card) {
                    card.style.transition = 'opacity 0.3s, transform 0.3s';
                    card.style.opacity = '0';
                    card.style.transform = 'translateX(40px)';
                    setTimeout(function () {
                        renderPrazos();
                        // Atualiza contador do dashboard se já foi carregado
                        var el = document.getElementById('dashCountPrazos');
                        if (el && el.textContent !== '—') {
                            el.textContent = Math.max(0, parseInt(el.textContent) - 1);
                        }
                    }, 300);
                }
                mostrarToast('Prazo concluído!');
            } else {
                mostrarToast(data.erro || 'Erro ao concluir prazo');
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.innerHTML = '<i data-lucide="check-circle" style="width:15px;height:15px;"></i>Concluir';
                if (window.lucide) lucide.createIcons();
            }
        }).catch(function () {
            mostrarToast('Erro de conexão');
            btn.disabled = false;
            btn.style.opacity = '1';
        });
    }

    // ─── WHATSAPP AUDIÊNCIA ───────────────────────────────────────────────────

    function avisarAudienciaZap(a) {
        var telefone = a.telefone || '';
        if (!telefone) {
            mostrarToast('Telefone não cadastrado para este cliente');
            return;
        }
        var primeiroNome = (a.cliente || 'Cliente').trim().split(' ')[0];
        var dataFormatada = a.data_audiencia ? new Date(a.data_audiencia).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '---';
        var horaFormatada = a.hora_audiencia ? a.hora_audiencia.slice(0, 5) : formatarHora(a.data_audiencia);
        var tipo = a.tipo_audiencia || a.tipo || 'Audiência';
        var local = a.local_virtual || a.local || 'A informar';

        var mensagem =
            'Ola, *' + primeiroNome + '*!\n\n' +
            '*LEMBRETE DE AUDIENCIA*\n\n' +
            '*Processo:* ' + (a.processo_numero || '---') + '\n' +
            '*Data:* ' + dataFormatada + '\n' +
            '*Horario:* ' + horaFormatada + '\n' +
            '*Tipo:* ' + tipo + '\n' +
            '*Local:* ' + local + '\n\n' +
            'Por favor, confirme seu comparecimento.';

        var tel = telefone.replace(/\D/g, '');
        var url = 'https://wa.me/55' + tel + '?text=' + encodeURIComponent(mensagem);
        window.open(url, '_blank');
    }

    // ─── WHATSAPP ─────────────────────────────────────────────────────────────

    function whatsappBtn(telefone) {
        var numeros = (telefone || '').replace(/\D/g, '');
        if (!numeros) return '<i data-lucide="phone"></i>' + esc(telefone);
        // Adiciona DDI 55 se não tiver
        var wa = numeros.length <= 11 ? '55' + numeros : numeros;
        var url = 'https://wa.me/' + wa;
        return '<a href="' + url + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;color:#25d366;text-decoration:none;">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="#25d366">' +
            '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>' +
            '<path d="M12 0C5.373 0 0 5.373 0 12c0 2.12.554 4.112 1.523 5.837L0 24l6.335-1.508A11.948 11.948 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.001-1.368l-.357-.213-3.758.895.952-3.654-.233-.375A9.818 9.818 0 012.182 12c0-5.42 4.398-9.818 9.818-9.818 5.42 0 9.818 4.398 9.818 9.818 0 5.42-4.398 9.818-9.818 9.818z"/>' +
            '</svg>' +
            esc(telefone) + '</a>';
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

        // Toggle Lista / Calendário
        document.getElementById('btnToggleLista').addEventListener('click', function () { alternarVista('lista'); });
        document.getElementById('btnToggleCal').addEventListener('click', function () { alternarVista('calendario'); });

        // Navegação do calendário
        document.getElementById('calBtnAnterior').addEventListener('click', function () {
            calMes--; if (calMes < 1) { calMes = 12; calAno--; }
            calDiaSelecionado = null;
            document.getElementById('calDetalhePanel').classList.remove('ativo');
            carregarCalendario();
        });
        document.getElementById('calBtnProximo').addEventListener('click', function () {
            calMes++; if (calMes > 12) { calMes = 1; calAno++; }
            calDiaSelecionado = null;
            document.getElementById('calDetalhePanel').classList.remove('ativo');
            carregarCalendario();
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

        // Abas audiências
        document.querySelectorAll('[data-aud]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('[data-aud]').forEach(function (b) { b.classList.remove('ativo'); });
                btn.classList.add('ativo');
                filtroAud = btn.getAttribute('data-aud');
                if (todasAsAudiencias.length > 0) {
                    renderAudiencias();
                } else {
                    carregarAudiencias();
                }
            });
        });

        // Refresh audiências
        document.getElementById('btnRefreshAudiencias').addEventListener('click', function () {
            dadosCarregados['audiencias'] = false;
            todasAsAudiencias = [];
            carregarAudiencias();
        });

        // Search clientes — filtra localmente nos dados já carregados
        document.getElementById('searchClientes').addEventListener('input', function () {
            var val = this.value.trim();
            clearTimeout(searchTimerClientes);
            searchTimerClientes = setTimeout(function () {
                if (todosOsClientes.length > 0) {
                    filtrarClientesLocal(val || null);
                } else {
                    carregarClientes(val || null);
                }
            }, 300);
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

        // Cards do dashboard → navegar para módulo
        document.querySelectorAll('[data-goto]').forEach(function (card) {
            card.addEventListener('click', function () {
                mostrarTab(card.getAttribute('data-goto'));
            });
        });

        // Tab inicial via query param ou padrão dashboard
        var urlParams = new URLSearchParams(window.location.search);
        var tabInicial = urlParams.get('tab') || 'dashboard';

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
