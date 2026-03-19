// ========== VERSÃO ATUALIZADA - 13/02/2026 11:30 ==========
        console.log('🎯 AUDIENCIAS.HTML CARREGADO - VERSÃO 13/02/2026 11:30');
        console.log('✅ Função abrirModalRegistrarAta: ', typeof abrirModalRegistrarAta !== 'undefined' ? 'EXISTE' : 'NÃO EXISTE');

        if (!API.getToken()) window.location.href = '/login';

        // ── Helpers obrigatórios ─────────────────────────────────────────────
        function navegarPara(url) { window.location.href = url; }
        function removerElemento(id) { const el = document.getElementById(id); if (el) el.remove(); }
        function clicarElemento(id) { const el = document.getElementById(id); if (el) el.click(); }

        // Toggle menu do usuário
        function toggleUserMenu() {
            const m = document.getElementById('userDropdown');
            if (m) m.style.display = m.style.display === 'none' || m.style.display === '' ? 'block' : 'none';
        }

        // Fechar dropdown ao clicar fora
        window.addEventListener('click', (e) => {
            if (!e.target.closest('#userCircle') && !e.target.closest('#userDropdown')) {
                const m = document.getElementById('userDropdown');
                if (m) m.style.display = 'none';
            }
            if (!e.target.closest('.action-menu')) {
                document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
            }
        });

        // Toggle dropdown de ações da linha
        function toggleDropdown(btn) {
            const menu = btn.nextElementSibling;
            const isOpen = menu.classList.contains('open');
            document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
            if (!isOpen) menu.classList.add('open');
        }
        
        // Logout
        function logout() {
            localStorage.removeItem('token');
            window.location.href = '/login';
        }

        function limparBolinha() {
            const dot = document.getElementById('dotNotificacao');
            if (dot) dot.style.display = 'none';
        }

        // Badge de novo lead CRM — polling global em todas as páginas
        (function() {
            if (!API.getToken()) return;
            function _checkLeadBadge() {
                API.get('/api/crm/metricas')
                    .then(r => r && r.ok ? r.json() : null)
                    .then(d => {
                        if (!d) return;
                        const atual = d.leads || 0;
                        const vs = localStorage.getItem('crm_leads_visto');
                        if (vs === null) { localStorage.setItem('crm_leads_visto', atual); return; }
                        const dot = document.getElementById('dotNotificacao');
                        if (dot) dot.style.display = atual > parseInt(vs) ? 'inline-block' : 'none';
                    }).catch(() => {});
            }
            _checkLeadBadge();
            setInterval(_checkLeadBadge, 60000);
        })();

        // Carregar informações do usuário
        async function carregarInfoUsuario() {
            try {
                const res = await API.get('/api/auth/me');
                const data = await res.json();
                
                if (data.ok) {
                    const user = data.usuario;
                    
                    // Sidebar
                    document.getElementById('userEmail').innerText = user.email || '...';
                    document.getElementById('userNameHeader').innerText = user.nome ? user.nome.split(' ')[0] : 'ADVOGADO';
                    
                    // Iniciais
                    const partes = (user.nome || '').split(' ').filter(n => n);
                    let iniciais = partes[0] ? partes[0][0] : '-';
                    if (partes.length > 1) iniciais += partes[partes.length - 1][0];
                    document.getElementById('userCircle').innerText = iniciais.toUpperCase();
                    window._userRole = user.role || 'visualizador';
                    aplicarPermissoesRoleUI(window._userRole);
                }
            } catch (err) { 
                console.error("Erro ao carregar perfil:", err); 
            }
        }

        // Carregar plano
        async function carregarPlano() {
            try {
                const res = await API.get('/api/plano-consumo');
                const data = await res.json();
                document.getElementById('footerPlano').innerText = data.plano || 'free';
            } catch (err) { 
                console.error("Erro ao carregar plano:", err); 
            }
        }

        // Trocar aba
        function trocarAba(aba) {
            // Remover active de todas
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            // Ativar aba selecionada
            if (aba === 'agendadas') {
                document.querySelector('.tab:first-child').classList.add('active');
                document.getElementById('abaAgendadas').classList.add('active');
            } else {
                document.querySelector('.tab:last-child').classList.add('active');
                document.getElementById('abaRealizadas').classList.add('active');
            }
        }

        // ── Estado de paginação ──────────────────────────────────────────────
        const PAG_LIMITE = 10;
        let _todasFuturas    = [];
        let _todasRealizadas = [];
        let _pagFuturas      = 1;
        let _pagRealizadas   = 1;
        let _carregandoAud   = false;
        let _termoBusca      = '';

        // ── Filtro de busca por cliente ou número de processo ────────────────
        function filtrarAudiencias() {
            _termoBusca = (document.getElementById('buscaAudiencia')?.value || '').toLowerCase().trim();
            _pagFuturas    = 1;
            _pagRealizadas = 1;
            renderizarPaginaFuturas(1);
            renderizarPaginaRealizadas(1);
        }

        function _aplicarFiltro(lista) {
            if (!_termoBusca) return lista;
            return lista.filter(a => {
                const cliente  = (a.cliente || '').toLowerCase();
                const numero   = (a.processo_numero || '').toLowerCase();
                return cliente.includes(_termoBusca) || numero.includes(_termoBusca);
            });
        }

        // ── Renderizar controles de paginação ────────────────────────────────
        function renderizarPaginacaoAud(containerId, total, pagina, callbackFn) {
            const container = document.getElementById(containerId);
            if (!container) return;
            const totalPags = Math.ceil(total / PAG_LIMITE);
            if (totalPags <= 1) { container.classList.remove('ativo'); return; }

            const inicio = (pagina - 1) * PAG_LIMITE + 1;
            const fim    = Math.min(pagina * PAG_LIMITE, total);
            const delta  = 2;
            const left   = Math.max(1, pagina - delta);
            const right  = Math.min(totalPags, pagina + delta);

            let nums = '';
            if (left > 1)  nums += `<button data-action="${callbackFn}" data-args='[1]' class="pag-num${1===pagina?' pag-ativo':''}">1</button>`;
            if (left > 2)  nums += '<span class="pag-ellipsis">…</span>';
            for (let i = left; i <= right; i++) {
                nums += `<button data-action="${callbackFn}" data-args='[${i}]' class="pag-num${i===pagina?' pag-ativo':''}">${i}</button>`;
            }
            if (right < totalPags - 1) nums += '<span class="pag-ellipsis">…</span>';
            if (right < totalPags)     nums += `<button data-action="${callbackFn}" data-args='[${totalPags}]' class="pag-num${totalPags===pagina?' pag-ativo':''}">${totalPags}</button>`;

            container.innerHTML =
                `<span class="pag-info">Mostrando <strong>${inicio}–${fim}</strong> de <strong>${total}</strong></span>` +
                `<div class="pag-controles">` +
                    `<button data-action="${callbackFn}" data-args='[${pagina-1}]' ${pagina<=1?'disabled':''} class="pag-nav">← Anterior</button>` +
                    nums +
                    `<button data-action="${callbackFn}" data-args='[${pagina+1}]' ${pagina>=totalPags?'disabled':''} class="pag-nav">Próximo →</button>` +
                `</div>`;
            container.classList.add('ativo');
        }

        // ── Renderizar página de audiências AGENDADAS ────────────────────────
        function renderizarPaginaFuturas(pagina) {
            _pagFuturas = pagina;
            const corpo = document.getElementById('listaAudiencias');
            const hoje  = new Date(); hoje.setHours(0,0,0,0);
            const filtradas = _aplicarFiltro(_todasFuturas);
            const inicio = (pagina - 1) * PAG_LIMITE;
            const fatia  = filtradas.slice(inicio, inicio + PAG_LIMITE);

            if (filtradas.length === 0) {
                corpo.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:60px 20px;color:var(--muted);"><i class="lucide lucide-calendar-x" style="font-size:48px;margin-bottom:16px;"></i><p style="font-weight:600;font-size:16px;">' + (_termoBusca ? 'NENHUM RESULTADO ENCONTRADO' : 'NENHUMA AUDIÊNCIA AGENDADA') + '</p></td></tr>';
                document.getElementById('paginacaoAgendadas').classList.remove('ativo');
                lucide.createIcons(); return;
            }

            corpo.innerHTML = fatia.map(a => {
                const dataFormatada = a.data_audiencia ? new Date(a.data_audiencia).toLocaleDateString('pt-BR') : '---';
                const horaFormatada = a.hora_audiencia ? a.hora_audiencia.slice(0,5) : '--:--';
                let alertaBadge = '', alertaStyle = '';
                if (a.data_audiencia) {
                    let dataAud = a.data_audiencia.includes('T') ? new Date(a.data_audiencia) : new Date(a.data_audiencia + 'T00:00:00');
                    dataAud.setHours(0,0,0,0);
                    const diff = Math.ceil((dataAud - hoje) / 86400000);
                    if (diff === 0)      { alertaBadge = '<span class="badge badge-hoje">HOJE</span>';           alertaStyle = 'background:rgba(239,68,68,.05);border-left:3px solid #ef4444;'; }
                    else if (diff === 1) { alertaBadge = '<span class="badge badge-amanha">AMANHÃ</span>';       alertaStyle = 'background:rgba(245,158,11,.05);border-left:3px solid #f59e0b;'; }
                    else                { alertaBadge = `<span class="badge badge-proximo">FALTAM ${diff} DIAS</span>`; }
                }
                const parteContraria = a.parte_contraria || a.reu || '—';
                return `<tr style="${alertaStyle}">
                    <td><strong style="color:var(--primary);display:block;margin-bottom:4px;">${dataFormatada}</strong><span style="font-size:12px;font-weight:600;color:var(--muted);">${horaFormatada}</span>${alertaBadge}</td>
                    <td><div style="font-weight:700;color:var(--text-main);margin-bottom:4px;">${a.processo_numero||'SEM NÚMERO'}</div><div style="font-size:12px;color:var(--muted);">${a.cliente||'CLIENTE NÃO INFORMADO'}</div></td>
                    <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0;font-size:13px;color:var(--text-main);" title="${parteContraria}">${parteContraria}</td>
                    <td><span style="background:#f1f5f9;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;">${(a.tipo_audiencia||a.tipo||'AUDIÊNCIA').toUpperCase()}</span></td>
                    <td style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0;">${a.local_virtual||a.local||'---'}</td>
                    <td><div class="action-buttons">
                        <button class="btn-action btn-whatsapp btn-zap-icon" data-action="avisarZap" data-args='[${JSON.stringify(a.cliente||'')},${JSON.stringify(a.processo_numero||'')},${JSON.stringify(a.tipo_audiencia||'')},${JSON.stringify(a.data_audiencia||'')},${JSON.stringify(a.hora_audiencia||'')},${JSON.stringify(a.local_virtual||'')},${JSON.stringify(a.telefone||'')}]' title="Avisar pelo WhatsApp"><svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></button>
                        <div class="action-menu">
                            <button class="btn-toggle-menu" data-action="toggleDropdown"><i data-lucide="more-vertical"></i></button>
                            <div class="dropdown-menu">
                                <button class="dropdown-item" data-local-id="${a.id}" data-local-valor="${(a.local_virtual||'').replace(/"/g,'&quot;')}" data-action="abrirModalEditarLocalSeguro"><i data-lucide="link" style="color:#6366f1;"></i> Editar Link</button>
                                <button class="dropdown-item" data-action="abrirModalRegistrarAta" data-args='[${a.id}]'><i data-lucide="check-circle" style="color:#52B788;"></i> Realizada</button>
                                <button class="dropdown-item btn-menu-delete" data-action="excluirAudiencia" data-args='[${a.id}]'><i data-lucide="trash-2"></i> Excluir</button>
                            </div>
                        </div>
                    </div></td>
                </tr>`;
            }).join('');

            lucide.createIcons();
            renderizarPaginacaoAud('paginacaoAgendadas', filtradas.length, pagina, 'renderizarPaginaFuturas');
        }

        // ── Renderizar página de audiências REALIZADAS ───────────────────────
        function renderizarPaginaRealizadas(pagina) {
            _pagRealizadas = pagina;
            const corpo  = document.getElementById('listaAudienciasRealizadas');
            const filtradas = _aplicarFiltro(_todasRealizadas);
            const inicio = (pagina - 1) * PAG_LIMITE;
            const fatia  = filtradas.slice(inicio, inicio + PAG_LIMITE);

            if (filtradas.length === 0) {
                corpo.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:60px 20px;color:var(--muted);"><i class="lucide lucide-calendar-check" style="font-size:48px;margin-bottom:16px;"></i><p style="font-weight:600;font-size:16px;">' + (_termoBusca ? 'NENHUM RESULTADO ENCONTRADO' : 'NENHUMA AUDIÊNCIA REALIZADA') + '</p></td></tr>';
                document.getElementById('paginacaoRealizadas').classList.remove('ativo');
                lucide.createIcons(); return;
            }

            corpo.innerHTML = fatia.map(a => {
                const dataFormatada = a.data_audiencia ? new Date(a.data_audiencia).toLocaleDateString('pt-BR') : '---';
                const horaFormatada = a.hora_audiencia ? a.hora_audiencia.slice(0,5) : '--:--';
                const parteContraria = a.parte_contraria || a.reu || '—';
                return `<tr>
                    <td><strong style="color:var(--muted);display:block;margin-bottom:4px;">${dataFormatada}</strong><span style="font-size:12px;font-weight:600;color:var(--muted);">${horaFormatada}</span></td>
                    <td><div style="font-weight:700;color:var(--text-main);margin-bottom:4px;">${a.processo_numero||'SEM NÚMERO'}</div><div style="font-size:12px;color:var(--muted);">${a.cliente||'CLIENTE NÃO INFORMADO'}</div></td>
                    <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0;font-size:13px;color:var(--text-main);" title="${parteContraria}">${parteContraria}</td>
                    <td><span style="background:#f1f5f9;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;">${(a.tipo_audiencia||a.tipo||'AUDIÊNCIA').toUpperCase()}</span></td>
                    <td style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0;">${a.local_virtual||a.local||'---'}</td>
                    <td><div class="action-buttons">
                        <div class="action-menu">
                            <button class="btn-toggle-menu" data-action="toggleDropdown"><i data-lucide="more-vertical"></i></button>
                            <div class="dropdown-menu">
                                <button class="dropdown-item" data-ata-id="${a.id}" data-ata-texto="${(a.ata_audiencia||'').replace(/"/g,'&quot;').replace(/\n/g,'&#10;')}" data-action="abrirModalVerAtaSeguro"><i data-lucide="file-text" style="color:#f59e0b;"></i> Ver Ata</button>
                                <button class="dropdown-item btn-menu-delete" data-action="excluirAudiencia" data-args='[${a.id}]'><i data-lucide="trash-2"></i> Excluir</button>
                            </div>
                        </div>
                    </div></td>
                </tr>`;
            }).join('');

            lucide.createIcons();
            renderizarPaginacaoAud('paginacaoRealizadas', filtradas.length, pagina, 'renderizarPaginaRealizadas');
        }

        // Carregar audiências
        async function carregarAudiencias() {
            if (_carregandoAud) return;
            _carregandoAud = true;
            try {
                const res   = await API.get('/api/audiencias');
                const dados = await res.json();

                const hoje = new Date(); hoje.setHours(0,0,0,0);
                _todasFuturas    = [];
                _todasRealizadas = [];

                if (dados && dados.length > 0) {
                    dados.forEach(a => {
                        if (!a.data_audiencia) return;
                        let dataAud = a.data_audiencia.includes('T') ? new Date(a.data_audiencia) : new Date(a.data_audiencia + 'T00:00:00');
                        dataAud.setHours(0,0,0,0);
                        if (a.realizada === true || dataAud < hoje) _todasRealizadas.push(a);
                        else _todasFuturas.push(a);
                    });
                }

                // Contadores
                document.getElementById('totalAudiencias').innerText       = dados ? dados.length : 0;
                document.getElementById('audienciasAgendadas').innerText   = _todasFuturas.length;
                document.getElementById('audienciasRealizadas').innerText  = _todasRealizadas.length;
                document.getElementById('contadorFuturas').innerText       = _todasFuturas.length;
                document.getElementById('contadorRealizadas').innerText    = _todasRealizadas.length;

                // Renderizar página 1 de cada aba
                _pagFuturas    = 1;
                _pagRealizadas = 1;
                renderizarPaginaFuturas(1);
                renderizarPaginaRealizadas(1);

            } catch (err) {
                console.error("Erro ao carregar audiências:", err);
                document.getElementById('listaAudiencias').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--danger);font-weight:600;">❌ ERRO AO CARREGAR AUDIÊNCIAS</td></tr>';
            } finally {
                _carregandoAud = false;
            }
        }

        // Modal
        function abrirModal() {
            document.getElementById('modalAudiencia').style.display = 'flex';
            carregarProcessosModal();
            carregarClientesModal();
            aplicarMascaraTelefone();
        }

        function fecharModal() {
            document.getElementById('modalAudiencia').style.display = 'none';
            document.getElementById('formAudiencia').reset();
        }

        // Carregar processos no select
        async function carregarProcessosModal() {
            try {
                const res = await API.get('/api/processos?limit=200');
                const respAud = await res.json();
                const processos = respAud.data || respAud;
                
                const select = document.getElementById('audProcesso');
                select.innerHTML = '<option value="">SELECIONE UM PROCESSO</option>';
                
                processos.forEach(p => {
                    const option = document.createElement('option');
                    option.value = p.id; // ID do processo para enviar ao backend
                    option.textContent = p.numero; // Apenas o número do processo
                    option.dataset.cliente = p.cliente || '';
                    option.dataset.clienteId = p.cliente_id || '';
                    select.appendChild(option);
                });
            } catch (err) {
                console.error("Erro ao carregar processos:", err);
            }
        }

        // Carregar clientes no select
        async function carregarClientesModal() {
            try {
                const res = await API.get('/api/clientes?limit=200');
                const respCli = await res.json();
                const clientes = respCli.data || respCli;
                
                const select = document.getElementById('audCliente');
                select.innerHTML = '<option value="">SELECIONE UM CLIENTE</option>';
                
                clientes.forEach(c => {
                    const option = document.createElement('option');
                    option.value = c.nome;
                    option.textContent = c.nome;
                    option.dataset.telefone = c.telefone || '';
                    select.appendChild(option);
                });
            } catch (err) {
                console.error("Erro ao carregar clientes:", err);
            }
        }

        // Quando selecionar um processo, preencher o cliente automaticamente
        function carregarDadosProcesso() {
            const select = document.getElementById('audProcesso');
            const selectedOption = select.options[select.selectedIndex];
            
            if (selectedOption && selectedOption.dataset.cliente) {
                const selectCliente = document.getElementById('audCliente');
                
                // Buscar a opção do cliente no select
                for (let i = 0; i < selectCliente.options.length; i++) {
                    if (selectCliente.options[i].value === selectedOption.dataset.cliente) {
                        selectCliente.selectedIndex = i;
                        
                        // Preencher telefone se disponível
                        if (selectCliente.options[i].dataset.telefone) {
                            document.getElementById('audTelefone').value = selectCliente.options[i].dataset.telefone;
                        }
                        break;
                    }
                }
            }
        }

        // Preencher telefone quando cliente for selecionado diretamente
        function preencherTelefoneCliente() {
            const select = document.getElementById('audCliente');
            const selectedOption = select.options[select.selectedIndex];
            
            if (selectedOption && selectedOption.dataset.telefone) {
                document.getElementById('audTelefone').value = selectedOption.dataset.telefone;
            }
        }

        // Aplicar máscara de telefone
        function aplicarMascaraTelefone() {
            const telefoneInput = document.getElementById('audTelefone');
            if (telefoneInput) {
                IMask(telefoneInput, {
                    mask: '(00) 00000-0000'
                });
            }
        }

        // Salvar audiência
        document.getElementById('formAudiencia').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const dados = {
                processo_id: document.getElementById('audProcesso').value, // ID do processo
                tipo_audiencia: document.getElementById('audTipo').value,
                data_audiencia: document.getElementById('audData').value,
                hora_audiencia: document.getElementById('audHora').value,
                local_virtual: document.getElementById('audLocal').value
            };

            try {
                const res = await API.post('/api/audiencias', dados);

                if (res.ok) {
                    alert("✅ AUDIÊNCIA CADASTRADA COM SUCESSO!");
                    fecharModal();
                    document.getElementById('formAudiencia').reset();
                    await carregarAudiencias();
                } else {
                    const erro = await res.text();
                    alert("❌ ERRO AO SALVAR: " + erro);
                }
            } catch (err) { 
                console.error("Erro na requisição:", err);
                alert("❌ ERRO DE COMUNICAÇÃO: " + err.message);
            }
        });

        // ========== FUNÇÕES ATA ==========
        let audienciaAtaId = null;
        let modoRegistrarAta = false; // true = registrar (ao marcar realizada), false = visualizar/editar

        // Abrir modal para REGISTRAR ATA (quando clica em REALIZADA)
        function abrirModalRegistrarAta(id) {
            console.log('🎯 Abrindo modal para REGISTRAR ATA, ID:', id);
            audienciaAtaId = id;
            modoRegistrarAta = true;
            
            document.getElementById('tituloModalAta').textContent = 'REGISTRAR ATA DA AUDIÊNCIA';
            document.getElementById('textoSalvarAta').textContent = 'SALVAR ATA E MARCAR COMO REALIZADA';
            document.getElementById('ataTexto').value = '';
            document.getElementById('ataTexto').required = true;
            document.getElementById('modalAta').style.display = 'flex';
            
            setTimeout(() => lucide.createIcons(), 100);
        }

        // Abrir modal para VER/EDITAR ATA (audiências já realizadas)
        function abrirModalVerAta(id, ataAtual) {
            console.log('👁️ Abrindo modal para VER ATA, ID:', id);
            audienciaAtaId = id;
            modoRegistrarAta = false;
            
            document.getElementById('tituloModalAta').textContent = 'VER/EDITAR ATA DA AUDIÊNCIA';
            document.getElementById('textoSalvarAta').textContent = 'SALVAR ALTERAÇÕES';
            document.getElementById('ataTexto').value = ataAtual || '';
            document.getElementById('ataTexto').required = false;
            document.getElementById('modalAta').style.display = 'flex';
            
            setTimeout(() => lucide.createIcons(), 100);
        }

        // Versão segura que pega do data-attribute
        function abrirModalVerAtaSeguro(button) {
            const id = button.getAttribute('data-ata-id');
            const ataTexto = button.getAttribute('data-ata-texto');
            
            // Decodificar entities HTML
            const textarea = document.createElement('textarea');
            textarea.innerHTML = ataTexto;
            const ataDecodificada = textarea.value;
            
            abrirModalVerAta(id, ataDecodificada);
        }

        // Fechar modal de ATA
        function fecharModalAta() {
            document.getElementById('modalAta').style.display = 'none';
            document.getElementById('ataTexto').value = '';
            audienciaAtaId = null;
            modoRegistrarAta = false;
        }

        // Salvar ATA
        async function salvarAta(event) {
            event.preventDefault();
            
            if (!audienciaAtaId) {
                alert("❌ ERRO: ID DA AUDIÊNCIA NÃO ENCONTRADO!");
                return;
            }

            const ataTexto = document.getElementById('ataTexto').value;

            try {
                // 1. Salvar ATA
                const resAta = await API.put(`/api/audiencias/${audienciaAtaId}/ata`, { ata_audiencia: ataTexto });

                if (!resAta.ok) {
                    const erro = await resAta.json();
                    alert("❌ ERRO AO SALVAR ATA: " + (erro.erro || erro.error || 'Erro desconhecido'));
                    return;
                }

                // 2. Se estiver no modo REGISTRAR, marcar como realizada
                if (modoRegistrarAta) {
                    const resRealizada = await API.put(`/api/audiencias/${audienciaAtaId}/realizada`, {});

                    if (resRealizada.ok) {
                        alert("✅ ATA REGISTRADA E AUDIÊNCIA MARCADA COMO REALIZADA!");
                        fecharModalAta();
                        await carregarAudiencias();
                        trocarAba('realizadas');
                    } else {
                        alert("⚠️ ATA SALVA, MAS ERRO AO MARCAR COMO REALIZADA");
                    }
                } else {
                    // Modo VER/EDITAR - apenas salva as alterações
                    alert("✅ ATA ATUALIZADA COM SUCESSO!");
                    fecharModalAta();
                    await carregarAudiencias();
                }
            } catch (err) {
                console.error("Erro ao salvar ATA:", err);
                alert("❌ ERRO DE COMUNICAÇÃO COM SERVIDOR: " + err.message);
            }
        }

        // Excluir audiência
        async function excluirAudiencia(id) {
            if (!confirm("DESEJA REALMENTE EXCLUIR ESTA AUDIÊNCIA?")) return;
            
            try {
                const res = await API.delete(`/api/audiencias/${id}`);
                
                if (res.ok) {
                    alert("✅ AUDIÊNCIA EXCLUÍDA!");
                    carregarAudiencias();
                } else {
                    alert("❌ ERRO AO EXCLUIR");
                }
            } catch (err) {
                console.error("Erro:", err);
            }
        }

        // WhatsApp
        function avisarZap(cliente, processo, tipo, data, hora, local, telefone) {
            if (!telefone) {
                alert("❌ TELEFONE NÃO CADASTRADO PARA ESTE CLIENTE!");
                return;
            }

            const primeiroNome = (cliente || 'Cliente').trim().split(' ')[0];
            const dataFormatada = data ? new Date(data).toLocaleDateString('pt-BR') : '---';
            const horaFormatada = hora ? hora.slice(0,5) : '--:--';

            const mensagem =
                `Ola, *${primeiroNome}*!\n\n` +
                `*LEMBRETE DE AUDIENCIA*\n\n` +
                `*Processo:* ${processo}\n` +
                `*Data:* ${dataFormatada}\n` +
                `*Horario:* ${horaFormatada}\n` +
                `*Tipo:* ${tipo}\n` +
                `*Local:* ${local || 'A informar'}\n\n` +
                `Por favor, confirme seu comparecimento.`;

            const tel = telefone.replace(/\D/g, '');
            const url = `https://wa.me/55${tel}?text=${encodeURIComponent(mensagem)}`;
            window.open(url, '_blank');
        }

        // ── Listeners migrados de inline handlers ────────────────────────────
        document.addEventListener('DOMContentLoaded', function() {
            // toggleIaMenu — regra especial
            const linkIaMenu = document.getElementById('linkIaMenu');
            if (linkIaMenu) linkIaMenu.addEventListener('click', toggleIaMenu);

            // onchange nos selects do modal de nova audiência
            const buscaAudiencia = document.getElementById('buscaAudiencia');
            if (buscaAudiencia) buscaAudiencia.addEventListener('input', filtrarAudiencias);

            const audProcesso = document.getElementById('audProcesso');
            if (audProcesso) audProcesso.addEventListener('change', carregarDadosProcesso);

            const audCliente = document.getElementById('audCliente');
            if (audCliente) audCliente.addEventListener('change', preencherTelefoneCliente);

            // onsubmit nos formulários de ata e editar local
            const formAta = document.getElementById('formAta');
            if (formAta) formAta.addEventListener('submit', salvarAta);

            const formEditarLocal = document.getElementById('formEditarLocal');
            if (formEditarLocal) formEditarLocal.addEventListener('submit', salvarLocalAudiencia);
        });

        // Inicialização
        window.onload = async () => {
            await carregarInfoUsuario();
            await carregarPlano();
            await carregarAudiencias();
            
            // Garantir que os ícones sejam renderizados após tudo carregar
            setTimeout(() => {
                lucide.createIcons();
                console.log('✅ Ícones Lucide renderizados');
            }, 500);
            
            setInterval(carregarAudiencias, 60000); // Atualiza a cada 1 minuto
        };

        // Chamar também imediatamente para os elementos estáticos
        lucide.createIcons();

        function toggleIaMenu(event) {
    event.preventDefault(); // impede navegação imediata
    const submenu = document.getElementById('submenu-ia');
    submenu.classList.toggle('open');
}

        // ─── Editar Link/Endereço da Audiência ────────────────────────────────
        let audienciaLocalId = null;

        function abrirModalEditarLocalSeguro(btn) {
            audienciaLocalId = btn.getAttribute('data-local-id');
            const raw = btn.getAttribute('data-local-valor') || '';
            // Decodificar entities HTML (mesmo padrão da ata)
            const ta = document.createElement('textarea');
            ta.innerHTML = raw;
            document.getElementById('localVirtualInput').value = ta.value;
            document.getElementById('modalEditarLocal').style.display = 'flex';
            setTimeout(() => lucide.createIcons(), 100);
        }

        function fecharModalEditarLocal() {
            document.getElementById('modalEditarLocal').style.display = 'none';
            audienciaLocalId = null;
        }

        async function salvarLocalAudiencia(event) {
            event.preventDefault();
            if (!audienciaLocalId) return;
            const local = document.getElementById('localVirtualInput').value.trim();

            try {
                const res = await API.patch(`/api/audiencias/${audienciaLocalId}/local`, { local_virtual: local });
                const d = await res.json();
                if (!res.ok) { alert('Erro ao salvar: ' + (d.erro || d.error || 'Erro')); return; }
                fecharModalEditarLocal();
                await carregarAudiencias();
            } catch (err) {
                alert('Erro de conexão: ' + err.message);
            }
        }

        function aplicarPermissoesRoleUI(role) {
            if (role === 'admin') return;
            const s = document.createElement('style');
            if (role === 'operador') {
                s.textContent = `.dropdown-item.btn-menu-delete { display: none !important; }`;
            } else {
                // visualizador: esconde delete, editar link e criar
                s.textContent = `.dropdown-item.btn-menu-delete, button[data-action='abrirModalEditarLocalSeguro'], button[data-action='abrirModal'] { display: none !important; }`;
            }
            document.head.appendChild(s);
        }
    

(function(){var t=localStorage.getItem('token');if(!t)return;var _ci;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){if(r.status===402){clearInterval(_ci);return null;}return r.json()}).then(function(d){if(!d||!d.ok)return;var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}).catch(function(){})}checkChat();_ci=setInterval(checkChat,30000);})();