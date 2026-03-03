const token = localStorage.getItem('token');
        if (!token) window.location.href = 'login.html';

        // Som de notificação - usando URL externa confiável
        const somNotificacao = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        
        // Som alternativo caso o primeiro falhe
        const somAlternativo = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBjOM0fPTgjMGHm7A7+OZVA8PVKjn77BdGgo+ltzy0XwqBSd6ye/bk0MKEmK47OykUhELTKXm77FlHAY3j9Xz0oAuBSJ1xfDck0MLFGCy6+2kVBIMUanp8LJgGgpBmNzyu3AbBjaP1PLRfiwGKX3J79qRQQoTYbjr7aVUEgtKouXwtWYdBjiP1fPSgS4FI3fG8NyTQwsUYbTo7aRTEA1MpejwsmEaBECY3PLCcSQGN47U8tKALgUjdsXv3JNDCxRgsujspFMRDUqm6PCxYBsGPZjc8sFwJAU7kNbz1YMvBiR4yfDdlEQLFWK06+2kVBIMSqXo8LRkGwdAl9zyxHImBTeO1PPRfi4FI3bE8NyUQwsVYbPp7aRUEg1Kp+jwsWEbBz2X2/LCcSUGNo/U8tJ/LgUjdsXx3JNDCxRis+ntpFQSDUqn6PCxYRsHPpfc8sFxJQY2jtTy0n8uBSN2xfDck0MLFGGz6e2kVBINSqfo8LFhGwc+mNzywnElBjaO1PLSfy4FI3bF8NyTQwsUYbLo7aRUEg1Kp+fwsGEbBz2X2/LBcSUFNo3U8tJ/LgUjdsXv3JNDCxRhsujspFQSDEqm5/CxYRsHPZjc8sFxJQY2jtTy0n8uBSN2xfDck0MLFGGy6O2kVBINSqbn8LFhGwc9l9vywXElBjaO1PLSfy4FI3bF79yTQwsUYbLo7aRUEg1KpufwsWEbBzyY2/LBcSUGN47U8tJ/LgUjdsXw3JNDCxRhsujspFQSDUql6PCxYRsHPZjb8sJxJQY2jtTy0n8uBSN2xfDck0MLFGGy6O2kVBINSqXo8LBhGwc9mNvywXElBjaO1PLSfy4FI3bF8NyTQwsUYbLo7aRUEg1Kpejws2IbBz2Y3PLCcSUGN47T8tJ/LgUjdcbw3JNDCxRhsujspFMRDUql6PCzYRsGPZjc8sFxJQY2j9Py0n8uBSN1xfDck0MLFGGy6O2kUxENSqXo8LNhGwY9mNzywXElBjaP1PLSfy4FI3XG79yTQwsUYLLo7aRTEQ1Kp+jwsWAaBz2Y2/LBcSUGNo7U8tJ/LgUjdcbv3JNDCxRhs+jtpFMRDUmm6PCxYBoHPZjb8sFxJQY2jtTy0n8uBSN1xu/ck0MLFGCz6O2kUxEOSqbo8LFgGgc9l9vywHElBjaO1fLSfy4FI3TF79yTQwsTYLPo7aRTEQ5Jpejws2AaBz2Y2/LAcSUGNo7U8tJ/LgQkdMTv3JRDCxRfsujspFMRDkql6PCzYRoHPZjb8r9wJAU2j9Ty0n8uBSN0xe/dk0MLFGCy6OykUxEOSaXo8LNgGgc9mNvyv3EkBjaN1PLSfi4FJHTF79yTQwsUX7Lo7KRTERBKpejws2AaBz2Y2/K/cCQFN4/U8tJ+LQUkdMXw3ZRDCxNfsujspFMRDkql6fCzYBkHPZjb8r5wJAU3j9Ty0n4uBSR0xfDek0ILE2Cy6OykUxEOSaXp8LRgGQc9mNvyv3AkBTiP1PLRfi4FJHTFz9yUQwsTX7Lo7KRTERBKpenwsmAZBz2Y2/K/cCQGN4/U8tJ+LgUkdMXw3JRDCxNfsujspFMRDkqm6fCzYBkHPJjb8r9wJAY3j9Ty0n4uBSR0xe/ck0ILE16z6OykUxEPSqbp8LRgGQc9mNvyvnAkBjeP1PLRfi4FJHTFz9yUQwsUXrPo7KRTERBKpunwtGAZBzyY2/K+cCQGN4/U8tF+LgUkdMXv3JRCCxNes+jtpFIRD0mm6fC0YRkHPZjb8r9wJAY3jtTy0X4uBSRzxe/dlEILE16z6OykUxEQSqbp8LRgGQc8l9vyvnAkBjeP1PLRfi4FJHTGz9yUQgsUXrTo7KRSERBKpunwtWAZBzyY2/K+cCQFN4/U8tF+LgUkdMbv3ZRCCxRdsujspFIRD0qm6fC1YRkHPJjb8r5wJAU4j9Ty0X4tBSRzxe/dlEILE12z6OykUhEQSqbp8LVgGQc8l9vyu3AkBjaN1PLRfi4FJHTGz9yUQgsUXbPo7KRSERBKpunwtWAZBzyY2/K+cCQGNo/U8tF+LgUjdMbv3JRCCxRds+jspFIRD0qm6fC1YRkHO5jb8rtvJAY3j9Ty0X4uBSJ0xs/clEILFF2z6OykUhEQSqbp8LVgGQc8l9vyu3AkBjeP1PLRfi4FI3TGz9yUQgoUXbPp7KRSERBKpunwtWAZBzyX2/K7cCQGN4/U8tF+LgUjdMbP3JRCCxRds+nspFIRD0qm6fC1YRkHPJjb8rtwJAY3j9Ty0X4uBSN0xs/clEILFFyz6eykUhEQS6bp8LVgGQc8l9vyu3AkBjeP1PLRfi4FI3PGz9yUQgsUXLPp7KRSERBLpun');


        // ============================================
        // CACHE DE CLIENTES EM MEMÓRIA
        // ============================================
        let clientesCache = [];
        let paginaAtual = 1;
        const LIMITE_POR_PAGINA = 20;
        let termoBusca = '';

        // ============================================
        // INICIALIZAÇÃO DA PÁGINA
        // ============================================
        async function inicializarPagina() {
            try {
                console.log('🔄 Inicializando página de clientes...');
                
                // 1. Busca Info do Usuário
                const resUser = await fetch('/api/auth/me', { 
                    headers: { 'Authorization': `Bearer ${token}` } 
                });
                const dataUser = await resUser.json();
                
                if (dataUser.ok) {
                    const user = dataUser.usuario;
                    
                    // Atualizar email no rodapé
                    const emailElement = document.getElementById('footerEmail');
                    if (emailElement) {
                        emailElement.innerText = user.email || 'não disponível';
                        console.log('✅ Email atualizado:', user.email);
                    }
                    
                    // Atualizar nome no header (primeiro nome apenas)
                    const nomeCompleto = user.nome || 'Advogado';
                    const primeiroNome = nomeCompleto.trim().split(' ')[0];
                    const nameHeader = document.getElementById('userNameHeader');
                    if (nameHeader) nameHeader.innerText = primeiroNome;

                    // Atualizar iniciais no círculo (Primeira + Última)
                    const partes = nomeCompleto.trim().split(' ').filter(n => n);
                    let iniciais = partes[0][0];
                    if (partes.length > 1) {
                        iniciais += partes[partes.length - 1][0];
                    }
                    
                    const circulo = document.getElementById('userCircle');
                    if (circulo) circulo.innerText = iniciais.toUpperCase();
                    
                    console.log('✅ Usuário carregado:', user);
                    window._userRole = user.role || 'visualizador';
                    aplicarPermissoesRoleUI(window._userRole);
                }

                // 2. Busca Info do Plano
                const resPlan = await fetch('/api/plano-consumo', { 
                    headers: { Authorization: `Bearer ${token}` } 
                });
                const dataPlan = await resPlan.json();
                
                const planoElement = document.getElementById('footerPlano');
                if (planoElement) {
                    planoElement.innerText = dataPlan.plano || 'Free';
                    console.log('✅ Plano atualizado:', dataPlan.plano);
                }

                // 3. Carrega Clientes
                await carregarClientes();
                
            } catch (err) { 
                console.error("❌ Erro na inicialização:", err); 
            }
        }
        
        // ============================================
        // TOGGLE MENU DO USUÁRIO
        // ============================================
        function toggleUserMenu() {
            const dropdown = document.getElementById('userDropdown');
            if (dropdown) {
                dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
            }
        }

        // Fechar dropdown ao clicar fora
        document.addEventListener('click', function(event) {
            const dropdown = document.getElementById('userDropdown');
            const userCircle = document.getElementById('userCircle');
            
            if (dropdown && userCircle) {
                if (!userCircle.contains(event.target) && !dropdown.contains(event.target)) {
                    dropdown.style.display = 'none';
                }
            }
        });
        
        // ============================================
        // LOGOUT
        // ============================================
        function logout() {
            localStorage.removeItem('token');
            window.location.href = '/login.html';
        }

        function limparBolinha() {
            const dot = document.getElementById('dotNotificacao');
            if (dot) dot.style.display = 'none';
        }

        // Badge de novo lead CRM — polling global em todas as páginas
        (function() {
            const _tk = localStorage.getItem('token');
            if (!_tk) return;
            function _checkLeadBadge() {
                fetch('/api/crm/metricas', { headers: { Authorization: 'Bearer ' + _tk } })
                    .then(r => r.ok ? r.json() : null)
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

        // ============================================
        // CARREGAR CLIENTES - APENAS INICIAL
        // ============================================
        async function carregarClientes(page = 1, search = '') {
    paginaAtual = page;
    termoBusca = search;
    const tbody = document.getElementById('listaClientes');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#64748b;">Carregando...</td></tr>';
    try {
        const searchQS = search ? `&search=${encodeURIComponent(search)}` : '';
        const [resClientes, resProcessos] = await Promise.all([
            fetch(`/api/clientes?page=${page}&limit=${LIMITE_POR_PAGINA}${searchQS}`, { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch('/api/processos?limit=200', { headers: { 'Authorization': `Bearer ${token}` } })
        ]);

        if (resClientes.status === 401) {
            alert("SESSÃO EXPIRADA! REDIRECIONANDO...");
            localStorage.removeItem('token');
            window.location.href = '/login.html';
            return;
        }

        const respClientes = await resClientes.json();
        const respProcessos = await resProcessos.json();
        const clientes = respClientes.data || respClientes;
        const todosProcessos = respProcessos.data || respProcessos;

        clientesCache = clientes;
        // Só limpa o campo se não há busca ativa
        if (!search) {
            termoBusca = '';
            const searchInput = document.getElementById('searchClientes');
            if (searchInput) searchInput.value = '';
        }

        document.getElementById('totalClientes').innerText = respClientes.total ?? clientes.length;

        const clientesComProcessosSet = new Set(
            todosProcessos.map(p => p.cliente_id).filter(Boolean)
        );
        document.getElementById('clientesAtivos').innerText = clientesComProcessosSet.size;
        document.getElementById('processosVinculados').innerText = respProcessos.total ?? todosProcessos.length;

        renderizarClientes(clientes);
        const totalItens = respClientes.total ?? clientes.length;
        const totalPags = respClientes.totalPages ?? Math.ceil(totalItens / LIMITE_POR_PAGINA);
        renderizarPaginacao(totalItens, page, totalPags);
        // Always show pagination container when there are results
        const paginacaoEl = document.getElementById('paginacaoClientes');
        if (paginacaoEl) paginacaoEl.style.display = totalItens > 0 ? '' : 'none';

    } catch (err) {
        console.error("Erro ao carregar clientes:", err);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--danger); font-weight:600;">❌ ERRO AO CARREGAR CLIENTES</td></tr>';
    }
}

        // ============================================
        // RENDERIZAR LISTA DE CLIENTES
        // ============================================
        function renderizarClientes(clientes) {
            const tbody = document.getElementById('listaClientes');
            
            if (clientes.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:60px 20px; color:var(--text-tertiary);"><i class="lucide lucide-user-x" style="font-size:48px; margin-bottom:16px;"></i><p style="font-weight:600; font-size:16px;">NENHUM CLIENTE CADASTRADO</p><p style="font-size:13px; margin-top:8px;">CLIQUE EM "NOVO CLIENTE" PARA COMEÇAR</p></td></tr>';
                lucide.createIcons();
                return;
            }

            tbody.innerHTML = clientes.map(c => `
                <tr id="cliente-${c.id}" data-cliente-id="${c.id}">
                    <td style="font-weight:700; color:var(--text-primary);">${c.nome}</td>
                    <td style="font-family:'JetBrains Mono', monospace; font-size:12px; color:var(--text-secondary);">${c.documento}</td>
                    <td style="color:var(--text-secondary);">${c.email}</td>
                    <td style="color:var(--text-secondary);">${c.telefone || '---'}</td>
                    <td style="color:var(--text-secondary);">${c.cidade || '---'}${c.estado ? '/' + c.estado : ''}</td>
                    <td>
                        <span class="status-badge status-ativo">
                            <i class="lucide lucide-check-circle"></i>
                            ATIVO
                        </span>
                    </td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-action btn-view" onclick="visualizarProcessosCliente(${c.id}, '${c.nome.replace(/'/g, "\\'")}')" title="VER PROCESSOS">
                                <i class="lucide lucide-eye"></i>
                                <span>VER</span>
                            </button>
                            <button class="btn-action btn-portal" onclick="gerarLinkPortal(${c.id}, '${c.nome.replace(/'/g, "\\'")}')" title="LINK PORTAL DO CLIENTE">
                                <i class="lucide lucide-link-2"></i>
                                <span>LINK</span>
                            </button>
                            <button class="btn-action btn-contract" onclick="abrirModalContratos(${c.id}, '${c.nome.replace(/'/g, "\\'")}')" title="CONTRATOS DE HONORÁRIOS">
                                <i class="lucide lucide-file-signature"></i>
                                <span>CONTRATOS</span>
                            </button>
                            <button class="btn-action btn-edit" onclick="prepararEdicao(${c.id}, '${c.nome.replace(/'/g, "\\'")}', '${c.documento}', '${c.email}', '${c.telefone || ''}', '${c.cep || ''}', '${c.endereco || ''}', '${c.cidade || ''}', '${c.estado || ''}', '${c.tipo_pessoa || 'fisica'}', '${c.data_nascimento || ''}')" title="EDITAR">
                                <i class="lucide lucide-pencil"></i>
                                <span>EDITAR</span>
                            </button>
                            <button class="btn-action btn-delete" onclick="excluirCliente(${c.id})" title="EXCLUIR">
                                <i class="lucide lucide-trash-2"></i>
                                <span>EXCLUIR</span>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');

            lucide.createIcons();
        }

        // ============================================
        // PAGINAÇÃO
        // ============================================
        function renderizarPaginacao(total, page, totalPages) {
            const container = document.getElementById('paginacaoClientes');
            if (!container) return;

            if (!totalPages || totalPages <= 1) {
                container.classList.remove('ativo');
                return;
            }

            const inicio = ((page - 1) * LIMITE_POR_PAGINA) + 1;
            const fim = Math.min(page * LIMITE_POR_PAGINA, total);

            const delta = 2;
            const left = Math.max(1, page - delta);
            const right = Math.min(totalPages, page + delta);
            let nums = '';
            if (left > 1) nums += '<button onclick="carregarClientes(1, termoBusca)" class="pag-num' + (1===page?' pag-ativo':'') + '">1</button>';
            if (left > 2) nums += '<span class="pag-ellipsis">…</span>';
            for (let i = left; i <= right; i++) {
                nums += '<button onclick="carregarClientes(' + i + ', termoBusca)" class="pag-num' + (i===page?' pag-ativo':'') + '">' + i + '</button>';
            }
            if (right < totalPages - 1) nums += '<span class="pag-ellipsis">…</span>';
            if (right < totalPages) nums += '<button onclick="carregarClientes(' + totalPages + ', termoBusca)" class="pag-num' + (totalPages===page?' pag-ativo':'') + '">' + totalPages + '</button>';

            container.innerHTML =
                '<span class="pag-info">Mostrando <strong>' + inicio + '–' + fim + '</strong> de <strong>' + total + '</strong> clientes</span>' +
                '<div class="pag-controles">' +
                    '<button onclick="carregarClientes(' + (page-1) + ', termoBusca)" ' + (page<=1?'disabled':'') + ' class="pag-nav">← Anterior</button>' +
                    nums +
                    '<button onclick="carregarClientes(' + (page+1) + ', termoBusca)" ' + (page>=totalPages?'disabled':'') + ' class="pag-nav">Próximo →</button>' +
                '</div>';

            container.classList.add('ativo');
        }

        // ============================================
        // ADICIONAR CLIENTE NO DOM (SEM RECARREGAR)
        // ============================================
        function adicionarClienteNaTabela(cliente) {
            const tbody = document.getElementById('listaClientes');
            
            // Remove mensagem "nenhum cliente" se existir
            const mensagemVazia = tbody.querySelector('tr td[colspan="7"]');
            if (mensagemVazia) {
                tbody.innerHTML = '';
            }

            const novaLinha = document.createElement('tr');
            novaLinha.id = `cliente-${cliente.id}`;
            novaLinha.setAttribute('data-cliente-id', cliente.id);
            novaLinha.style.animation = 'fadeInSlide 0.3s ease-out';
            
            novaLinha.innerHTML = `
                <td style="font-weight:700; color:var(--text-primary);">${cliente.nome}</td>
                <td style="font-family:'JetBrains Mono', monospace; font-size:12px; color:var(--text-secondary);">${cliente.documento}</td>
                <td style="color:var(--text-secondary);">${cliente.email}</td>
                <td style="color:var(--text-secondary);">${cliente.telefone || '---'}</td>
                <td style="color:var(--text-secondary);">${cliente.cidade || '---'}${cliente.estado ? '/' + cliente.estado : ''}</td>
                <td>
                    <span class="status-badge status-ativo">
                        <i class="lucide lucide-check-circle"></i>
                        ATIVO
                    </span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action btn-view" onclick="visualizarProcessosCliente(${cliente.id}, '${cliente.nome.replace(/'/g, "\\'")}')" title="VER PROCESSOS">
                            <i class="lucide lucide-eye"></i>
                            <span>VER</span>
                        </button>
                        <button class="btn-action btn-portal" onclick="gerarLinkPortal(${cliente.id}, '${cliente.nome.replace(/'/g, "\\'")}')" title="LINK PORTAL DO CLIENTE">
                            <i class="lucide lucide-link-2"></i>
                            <span>LINK</span>
                        </button>
                            <button class="btn-action btn-contract" onclick="abrirModalContratos(${c.id}, '${c.nome.replace(/'/g, "\\'")}')" title="CONTRATOS DE HONORÁRIOS">
                                <i class="lucide lucide-file-signature"></i>
                                <span>CONTRATOS</span>
                            </button>
                        <button class="btn-action btn-edit" onclick="prepararEdicao(${cliente.id}, '${cliente.nome.replace(/'/g, "\\'")}', '${cliente.documento}', '${cliente.email}', '${cliente.telefone || ''}', '${cliente.cep || ''}', '${cliente.endereco || ''}', '${cliente.cidade || ''}', '${cliente.estado || ''}', '${cliente.tipo_pessoa || 'fisica'}', '${cliente.data_nascimento || ''}')" title="EDITAR">
                            <i class="lucide lucide-pencil"></i>
                            <span>EDITAR</span>
                        </button>
                        <button class="btn-action btn-delete" onclick="excluirCliente(${cliente.id})" title="EXCLUIR">
                            <i class="lucide lucide-trash-2"></i>
                            <span>EXCLUIR</span>
                        </button>
                    </div>
                </td>
            `;

            tbody.insertBefore(novaLinha, tbody.firstChild);
            lucide.createIcons();
            
            // Adiciona ao cache
            clientesCache.unshift(cliente);
            
            // Atualiza contador
            const totalElement = document.getElementById('totalClientes');
            if (totalElement) {
                totalElement.innerText = parseInt(totalElement.innerText) + 1;
            }
        }

        // ============================================
        // ATUALIZAR CLIENTE NO DOM (SEM RECARREGAR)
        // ============================================
        function atualizarClienteNaTabela(cliente) {
            const linhaExistente = document.getElementById(`cliente-${cliente.id}`);
            if (!linhaExistente) return;

            linhaExistente.innerHTML = `
                <td style="font-weight:700; color:var(--text-primary);">${cliente.nome}</td>
                <td style="font-family:'JetBrains Mono', monospace; font-size:12px; color:var(--text-secondary);">${cliente.documento}</td>
                <td style="color:var(--text-secondary);">${cliente.email}</td>
                <td style="color:var(--text-secondary);">${cliente.telefone || '---'}</td>
                <td style="color:var(--text-secondary);">${cliente.cidade || '---'}${cliente.estado ? '/' + cliente.estado : ''}</td>
                <td>
                    <span class="status-badge status-ativo">
                        <i class="lucide lucide-check-circle"></i>
                        ATIVO
                    </span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action btn-view" onclick="visualizarProcessosCliente(${cliente.id}, '${cliente.nome.replace(/'/g, "\\'")}')" title="VER PROCESSOS">
                            <i class="lucide lucide-eye"></i>
                            <span>VER</span>
                        </button>
                        <button class="btn-action btn-portal" onclick="gerarLinkPortal(${cliente.id}, '${cliente.nome.replace(/'/g, "\\'")}')" title="LINK PORTAL DO CLIENTE">
                            <i class="lucide lucide-link-2"></i>
                            <span>LINK</span>
                        </button>
                            <button class="btn-action btn-contract" onclick="abrirModalContratos(${c.id}, '${c.nome.replace(/'/g, "\\'")}')" title="CONTRATOS DE HONORÁRIOS">
                                <i class="lucide lucide-file-signature"></i>
                                <span>CONTRATOS</span>
                            </button>
                        <button class="btn-action btn-edit" onclick="prepararEdicao(${cliente.id}, '${cliente.nome.replace(/'/g, "\\'")}', '${cliente.documento}', '${cliente.email}', '${cliente.telefone || ''}', '${cliente.cep || ''}', '${cliente.endereco || ''}', '${cliente.cidade || ''}', '${cliente.estado || ''}', '${cliente.tipo_pessoa || 'fisica'}', '${cliente.data_nascimento || ''}')" title="EDITAR">
                            <i class="lucide lucide-pencil"></i>
                            <span>EDITAR</span>
                        </button>
                        <button class="btn-action btn-delete" onclick="excluirCliente(${cliente.id})" title="EXCLUIR">
                            <i class="lucide lucide-trash-2"></i>
                            <span>EXCLUIR</span>
                        </button>
                    </div>
                </td>
            `;

            lucide.createIcons();

            // Atualiza no cache
            const index = clientesCache.findIndex(c => c.id === cliente.id);
            if (index !== -1) clientesCache[index] = cliente;
        }

        // ============================================
        // REMOVER CLIENTE DO DOM (SEM RECARREGAR)
        // ============================================
        function removerClienteDaTabela(id) {
            const linha = document.getElementById(`cliente-${id}`);
            if (!linha) return;

            // Adiciona animação de saída
            linha.style.animation = 'fadeOutSlide 0.3s ease-out forwards';
            
            // Remove após animação
            setTimeout(() => {
                linha.remove();
                
                // Remove do cache
                clientesCache = clientesCache.filter(c => c.id !== id);
                
                // Atualiza contador
                const totalElement = document.getElementById('totalClientes');
                if (totalElement) {
                    totalElement.innerText = Math.max(0, parseInt(totalElement.innerText) - 1);
                }
                
                // Se não houver mais clientes, mostra mensagem
                const tbody = document.getElementById('listaClientes');
                if (tbody.children.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:60px 20px; color:var(--text-tertiary);"><i class="lucide lucide-user-x" style="font-size:48px; margin-bottom:16px;"></i><p style="font-weight:600; font-size:16px;">NENHUM CLIENTE CADASTRADO</p><p style="font-size:13px; margin-top:8px;">CLIQUE EM "NOVO CLIENTE" PARA COMEÇAR</p></td></tr>';
                    lucide.createIcons();
                }
            }, 300);
        }

        // ============================================
        // FILTRAR CLIENTES
        // ============================================
        let _searchDebounce = null;

        function filtrarClientes() {
            clearTimeout(_searchDebounce);
            _searchDebounce = setTimeout(async () => {
                termoBusca = document.getElementById('searchClientes').value.trim();
                await carregarClientes(1, termoBusca);
            }, 300);
        }

        // ============================================
        // MODAL
        // ============================================
        function abrirModal() {
            document.getElementById('modalCliente').style.display = 'flex';
            document.getElementById('badgeClientes').style.display = 'none';
            aplicarMascaras();
        }

        function fecharModal() { 
            document.getElementById('modalCliente').style.display = 'none'; 
            document.getElementById('formCliente').reset();
            delete document.getElementById('formCliente').dataset.editId;
            document.getElementById('modalTitle').innerHTML = '<i class="lucide lucide-user-plus"></i> NOVO CLIENTE';
            lucide.createIcons();
        }

        function alternarCamposPessoa(tipo) {
            const labelDoc = document.getElementById('labelDoc');
            const groupNasc = document.getElementById('groupNascimento');
            if (tipo === 'fisica') {
                labelDoc.innerText = "CPF *";
                groupNasc.style.display = "flex";
            } else {
                labelDoc.innerText = "CNPJ *";
                groupNasc.style.display = "none";
            }
        }

        // ============================================
        // SALVAR/EDITAR - COM ATUALIZAÇÃO OTIMISTA
        // ============================================
        document.getElementById('formCliente').addEventListener('submit', async (e) => {
            e.preventDefault();
            const editId = e.target.dataset.editId;
            const metodo = editId ? 'PUT' : 'POST';
            const url = editId ? `/api/clientes/${editId}` : '/api/clientes';

            const dados = {
                nome: document.getElementById('cliNome').value,
                documento: document.getElementById('cliDocumento').value,
                email: document.getElementById('cliEmail').value,
                telefone: document.getElementById('cliTelefone').value,
                cep: document.getElementById('cliCep').value,
                endereco: document.getElementById('cliEndereco').value,
                cidade: document.getElementById('cliCidade').value,
                estado: document.getElementById('cliUf').value,
                tipo_pessoa: document.querySelector('input[name="tipoPessoa"]:checked').value,
                data_nascimento: document.getElementById('cliDataNascimento').value || null
            };

            // Verificar conflito de interesses apenas em novos cadastros
            if (!editId && (dados.nome || dados.documento)) {
                try {
                    const resConflito = await fetch('/api/processos/verificar-conflito', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ nome: dados.nome, documento: dados.documento, polo_verificar: 'ativo' })
                    });
                    const conflitoData = await resConflito.json();
                    if (conflitoData.conflito) {
                        const processos = conflitoData.processos;
                        const lista = processos.map(p => `• Proc. ${p.numero || 'S/N'}${p.esfera ? ` (${p.esfera})` : ''}`).join('\n');
                        const prosseguir = confirm(
                            `⚠️ POSSÍVEL CONFLITO DE INTERESSES\n\n"${dados.nome}" aparece como parte contrária (polo passivo) em:\n\n${lista}\n\nO Art. 20 do CED/OAB veda a representação de interesses conflitantes.\n\nDeseja cadastrar mesmo assim?`
                        );
                        if (!prosseguir) return;
                    }
                } catch (_) { /* não bloquear em caso de erro de rede */ }
            }

            try {
                const res = await fetch(url, {
                    method: metodo,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(dados)
                });

                if (res.ok) {
                    const clienteSalvo = await res.json();
                    
                    // Se for NOVO cliente (não edição), tocar som e mostrar badge
                    if (!editId) {
                        // Tocar som de notificação
                        try {
                            const playPromise = somNotificacao.play();
                            if (playPromise !== undefined) {
                                playPromise.then(() => {
                                    console.log('✅ Som reproduzido com sucesso');
                                }).catch(error => {
                                    console.log('⚠️ Navegador bloqueou reprodução automática de áudio:', error);
                                    // Tenta tocar um beep alternativo do sistema
                                    console.log('\x07'); // Beep do sistema (pode não funcionar em todos navegadores)
                                });
                            }
                        } catch(e) {
                            console.log('⚠️ Erro ao reproduzir som:', e);
                        }
                        
                        // Mostrar badge NOVO por 5 segundos
                        const badge = document.getElementById('badgeClientes');
                        if (badge) {
                            badge.style.display = 'inline-block';
                            setTimeout(() => {
                                badge.style.display = 'none';
                            }, 5000);
                        }
                    }
                    
                    alert("✅ CLIENTE SALVO COM SUCESSO!");
                    fecharModal();
                    
                    // ATUALIZAÇÃO OTIMISTA - sem recarregar tudo
                    if (editId) {
                        atualizarClienteNaTabela(clienteSalvo);
                    } else {
                        adicionarClienteNaTabela(clienteSalvo);
                    }
                } else {
                    const erro = await res.json();
                    alert("❌ ERRO: " + (erro.erro || "FALHA AO SALVAR"));
                }
            } catch (err) { 
                console.error("Erro na requisição:", err);
                alert("❌ ERRO DE CONEXÃO");
            }
        });

        // ============================================
        // EXCLUIR - COM ATUALIZAÇÃO OTIMISTA
        // ============================================
        async function excluirCliente(id) {
            if (!confirm("DESEJA REALMENTE EXCLUIR?")) return;
            
            try {
                const res = await fetch(`/api/clientes/${id}`, { 
                    method: 'DELETE', 
                    headers: { 'Authorization': `Bearer ${token}` } 
                });
                
                if (res.ok) {
                    // ATUALIZAÇÃO OTIMISTA - remove do DOM imediatamente
                    removerClienteDaTabela(id);
                    console.log(`✅ Cliente ${id} removido com sucesso`);
                } else {
                    alert("❌ ERRO AO EXCLUIR CLIENTE");
                }
            } catch (err) {
                console.error("Erro ao excluir:", err);
                alert("❌ ERRO DE CONEXÃO");
            }
        }

        // ============================================
        // PORTAL DO CLIENTE — GERAR MAGIC LINK
        // ============================================
        async function gerarLinkPortal(clienteId, nomeCliente) {
            try {
                const res = await fetch('/api/portal/gerar-token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + localStorage.getItem('token')
                    },
                    body: JSON.stringify({ cliente_id: clienteId })
                });
                const data = await res.json();
                if (!data.ok) {
                    alert('❌ Erro ao gerar link: ' + (data.erro || 'Tente novamente.'));
                    return;
                }
                const url = window.location.origin + data.url;
                const mensagem = `Acesse o Portal do Cliente para ter acesso ao andamento do seu processo: ${url}`;
                await navigator.clipboard.writeText(mensagem);
                alert(`✅ Link do portal de ${nomeCliente} copiado! Válido por 90 dias.`);
            } catch (err) {
                console.error('Erro ao gerar link portal:', err);
                alert('❌ Erro de conexão ao gerar link.');
            }
        }

        // ============================================
        // PREPARAR EDIÇÃO
        // ============================================
        function prepararEdicao(id, nome, documento, email, telefone, cep, endereco, cidade, estado, tipo_pessoa, data_nascimento) {
            // Primeiro: preencher os campos
            document.getElementById('cliNome').value = nome;
            document.getElementById('cliDocumento').value = documento;
            document.getElementById('cliEmail').value = email;
            document.getElementById('cliTelefone').value = telefone || '';
            document.getElementById('cliCep').value = cep || '';
            document.getElementById('cliEndereco').value = endereco || '';
            document.getElementById('cliCidade').value = cidade || '';
            document.getElementById('cliUf').value = estado || '';
            
            // Selecionar o radio button correto
            const tipoPessoaVal = tipo_pessoa || 'fisica';
            if (tipoPessoaVal === 'fisica') {
                document.getElementById('cliTipoFisica').checked = true;
            } else {
                document.getElementById('cliTipoJuridica').checked = true;
            }
            
            // Formatar e preencher data de nascimento
            if (data_nascimento) {
                // Se vier no formato ISO completo (2024-01-15T00:00:00.000Z), extrair apenas a data
                const dataFormatada = data_nascimento.split('T')[0];
                document.getElementById('cliDataNascimento').value = dataFormatada;
            } else {
                document.getElementById('cliDataNascimento').value = '';
            }
            
            document.getElementById('formCliente').dataset.editId = id;
            
            // Ajustar visibilidade do campo data de nascimento
            alternarCamposPessoa(tipoPessoaVal);
            
            // Depois: mudar título
            document.getElementById('modalTitle').innerHTML = '<i class="lucide lucide-pencil"></i> EDITAR CLIENTE';
            
            // Por último: abrir o modal (isso vai aplicar as máscaras NOS VALORES JÁ PREENCHIDOS)
            abrirModal();
            lucide.createIcons();
        }

        // ============================================
        // VISUALIZAR PROCESSOS
        // ============================================
        async function visualizarProcessosCliente(clienteId, clienteNome) {
            const container = document.getElementById('listaProcessosCliente');
            const modal = document.getElementById('modalVisualizarProcessos');
            const titulo = document.getElementById('tituloModalProcessos');

            titulo.innerHTML = `<i class="lucide lucide-briefcase"></i> PROCESSOS: ${clienteNome}`;
            container.innerHTML = '<p style="text-align:center; padding:20px;">CARREGANDO PROCESSOS...</p>';
            modal.style.display = 'flex';
            lucide.createIcons();

            try {
                const res = await fetch(`/api/por-cliente/${clienteId}`, { 
                    method: 'GET',
                    headers: { 
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    } 
                });

                if (!res.ok) throw new Error("Erro na resposta do servidor");
                const processos = await res.json();

                if (processos.length === 0) {
                    container.innerHTML = '<p style="text-align:center; color:var(--muted); padding:20px;">ESTE CLIENTE NÃO POSSUI PROCESSOS CADASTRADOS.</p>';
                    return;
                }

                container.innerHTML = processos.map(p => `
                    <div style="padding:16px; border:1px solid var(--border); border-radius:12px; background: white; display:flex; justify-content:space-between; align-items:center; box-shadow: 0 2px 4px rgba(0,0,0,0.02); margin-bottom:10px;">
                        <div style="flex: 1;">
                            <strong style="display:block; color:var(--primary); font-family:monospace; font-size:14px; margin-bottom:4px;">${p.numero}</strong>
                            
                            <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
                                <span style="color:var(--danger); font-size:10px; font-weight:800;">VS</span>
                                <span style="font-size:13px; font-weight:600; color:var(--text-main);">${p.parte_contraria || 'PARTE NÃO INFORMADA'}</span>
                            </div>

                            <div style="display:flex; gap:8px; align-items:center; flex-wrap: wrap;">
                                <span style="background: #e0f2fe; color: #0369a1; font-size:9px; font-weight:800; padding:2px 6px; border-radius:4px; text-transform:uppercase;">
                                    ${p.esfera || 'N/A'}
                                </span>
                                <span style="color:var(--muted); font-size:11px; font-weight:600;">${p.tribunal || '---'}</span>
                                <small style="color:var(--muted); font-size:11px;">${p.instancia || '1'}º GRAU - ${p.uf || '--'}</small>
                            </div>
                        </div>
                    </div>
                `).join('');

                lucide.createIcons();

            } catch (err) {
                console.error("Erro detalhado:", err);
                container.innerHTML = '<p style="color:var(--danger); text-align:center; padding:20px; font-weight:600;">❌ FALHA AO CARREGAR PROCESSOS. VERIFIQUE SUA CONEXÃO.</p>';
            }
        }

        function fecharModalProcessos() {
            document.getElementById('modalVisualizarProcessos').style.display = 'none';
        }

        // ============================================
        // BUSCAR CEP
        // ============================================
        async function buscarEnderecoPorCep(cep) {
            const valorCep = cep.replace(/\D/g, '');
            if (valorCep.length !== 8) return;
            try {
                const response = await fetch(`https://viacep.com.br/ws/${valorCep}/json/`);
                const data = await response.json();
                if (!data.erro) {
                    document.getElementById('cliEndereco').value = `${data.logradouro}, ${data.bairro}`;
                    document.getElementById('cliCidade').value = data.localidade;
                    document.getElementById('cliUf').value = data.uf;
                }
            } catch (err) { console.error("Erro CEP:", err); }
        }

        // ============================================
        // MÁSCARAS
        // ============================================
        function aplicarMascaras() {
            IMask(document.getElementById('cliDocumento'), {
                mask: [ 
                    { mask: '000.000.000-00', type: 'CPF' }, 
                    { mask: '00.000.000/0000-00', type: 'CNPJ' } 
                ]
            });
            IMask(document.getElementById('cliTelefone'), { mask: '(00) 00000-0000' });
            IMask(document.getElementById('cliCep'), { mask: '00000-000' });
        }

        // ============================================
        // ANIMAÇÕES CSS
        // ============================================
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeInSlide {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            @keyframes fadeOutSlide {
                from {
                    opacity: 1;
                    transform: translateX(0);
                }
                to {
                    opacity: 0;
                    transform: translateX(-20px);
                }
            }
        `;
        document.head.appendChild(style);

        // ============================================
        // EXPORTAR CLIENTES PARA CSV
        // ============================================
        async function exportarCSV() {
            try {
                const res = await fetch('/api/clientes?page=1&limit=9999', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const rExport = await res.json();
                const clientes = rExport.data || rExport;

                if (!clientes || clientes.length === 0) {
                    alert('⚠️ Nenhum cliente para exportar');
                    return;
                }

                // Cabeçalhos do CSV
                let csv = 'ID,Nome,Email,Telefone,CPF/CNPJ,CEP,Endereço,Cidade,Estado,Data Cadastro\n';

                // Adicionar dados
                clientes.forEach(c => {
                    csv += `${c.id || ''},`;
                    csv += `"${(c.nome || '').replace(/"/g, '""')}",`;
                    csv += `"${(c.email || '').replace(/"/g, '""')}",`;
                    csv += `"${(c.telefone || '').replace(/"/g, '""')}",`;
                    csv += `"${(c.documento || '').replace(/"/g, '""')}",`;
                    csv += `"${(c.cep || '').replace(/"/g, '""')}",`;
                    csv += `"${(c.endereco || '').replace(/"/g, '""')}",`;
                    csv += `"${(c.cidade || '').replace(/"/g, '""')}",`;
                    csv += `"${(c.estado || '').replace(/"/g, '""')}",`;
                    csv += `"${c.data_criacao ? new Date(c.data_criacao).toLocaleDateString('pt-BR') : ''}"\n`;
                });

                // Criar blob e download
                const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                const url = URL.createObjectURL(blob);
                
                link.setAttribute('href', url);
                link.setAttribute('download', `clientes_backup_${new Date().toISOString().split('T')[0]}.csv`);
                link.style.visibility = 'hidden';
                
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                console.log('✅ CSV exportado com sucesso:', clientes.length, 'clientes');
                alert(`✅ Backup realizado! ${clientes.length} clientes exportados.`);
            } catch (err) {
                console.error('❌ Erro ao exportar CSV:', err);
                alert('❌ Erro ao exportar CSV. Tente novamente.');
            }
        }

        // ============================================
        // INICIALIZAÇÃO - SEM POLLING EXCESSIVO
        // ============================================
        window.onload = () => {
            inicializarPagina(); // Carrega apenas uma vez
            aplicarMascaras();
            somNotificacao.load();
            
            // REMOVIDO: setInterval(carregarClientes, 40000);
            // Se precisar de atualização automática, implemente WebSocket ou aumente para 5+ minutos
            
            lucide.createIcons();
        };

    function toggleIaMenu(event) {
    event.preventDefault(); // impede navegação imediata
    const submenu = document.getElementById('submenu-ia');
    submenu.classList.toggle('open');
}

        function aplicarPermissoesRoleUI(role) {
            if (role === 'admin') return;
            const s = document.createElement('style');
            if (role === 'operador') {
                s.textContent = '.btn-action.btn-delete { display: none !important; }';
            } else {
                s.textContent = '.btn-action.btn-edit, .btn-action.btn-delete, button[onclick*="abrirModal()"] { display: none !important; }';
            }
            document.head.appendChild(s);
        }

        // Fix: evita que o header seja empurrado quando a tabela carrega
        (function() {
            const fixStyle = document.createElement('style');
            fixStyle.textContent = [
                '.main { min-height: 100vh; }',
                '.content { min-height: calc(100vh - 72px); }',
                '#paginacaoClientes { margin-top: -1px; }'
            ].join('');
            document.head.appendChild(fixStyle);
        })();
    

(function(){var t=localStorage.getItem('token');if(!t)return;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){return r.json()}).then(function(d){if(d.ok){var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}}).catch(function(){})}checkChat();setInterval(checkChat,30000)})();
        // ============================================================
        // CONTRATOS DE HONORÁRIOS
        // ============================================================
        let _contratoClienteId   = null;
        let _contratoClienteNome = null;
        let _contratoEditandoId  = null;
        let _contratoUploadId    = null;

        // ── Abrir modal de listagem ──────────────────────────────────
        async function abrirModalContratos(clienteId, clienteNome) {
            _contratoClienteId   = clienteId;
            _contratoClienteNome = clienteNome;

            document.getElementById('tituloModalContratos').innerHTML =
                `<i class="lucide lucide-file-signature"></i> CONTRATOS — ${clienteNome}`;

            document.getElementById('corpoModalContratos').innerHTML =
                '<p style="text-align:center;padding:32px;color:var(--muted);">CARREGANDO...</p>';
            document.getElementById('modalContratos').style.display = 'flex';

            await _carregarListaContratos();
            lucide.createIcons();
        }

        function fecharModalContratos() {
            document.getElementById('modalContratos').style.display = 'none';
            _contratoClienteId   = null;
            _contratoClienteNome = null;
        }

        // ── Carregar e renderizar lista ──────────────────────────────
        async function _carregarListaContratos() {
            try {
                const res  = await API.get(`/api/clientes/${_contratoClienteId}/contratos`);
                const data = await res.json();

                const corpo = document.getElementById('corpoModalContratos');

                const header = `
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
                        <span style="font-size:13px;color:var(--text-secondary);font-weight:600;">
                            ${data.length} contrato${data.length !== 1 ? 's' : ''} cadastrado${data.length !== 1 ? 's' : ''}
                        </span>
                        <button class="btn-primary" style="padding:8px 18px;font-size:12px;" onclick="abrirNovoContrato()">
                            <i class="lucide lucide-plus"></i> NOVO CONTRATO
                        </button>
                    </div>`;

                if (!data || data.length === 0) {
                    corpo.innerHTML = header + `
                        <div style="text-align:center;padding:48px 20px;color:var(--muted);">
                            <i class="lucide lucide-file-x" style="font-size:48px;margin-bottom:12px;display:block;"></i>
                            <p style="font-weight:600;">NENHUM CONTRATO CADASTRADO</p>
                            <p style="font-size:12px;margin-top:4px;">Clique em "NOVO CONTRATO" para começar.</p>
                        </div>`;
                    lucide.createIcons();
                    return;
                }

                const tipoLabel = { fixo:'Fixo', exito:'Êxito', misto:'Misto', consultoria:'Consultoria', outros:'Outros' };
                const statusColor = { ativo:'#10b981', encerrado:'#6b7280', suspenso:'#f59e0b' };

                const cards = data.map(c => {
                    const valorTxt = c.tipo_honorario === 'fixo' && c.valor_fixo
                        ? `R$ ${parseFloat(c.valor_fixo).toLocaleString('pt-BR',{minimumFractionDigits:2})}`
                        : c.tipo_honorario === 'exito' && c.percentual_exito
                        ? `${c.percentual_exito}% êxito`
                        : c.tipo_honorario === 'misto'
                        ? [c.valor_fixo ? `R$ ${parseFloat(c.valor_fixo).toLocaleString('pt-BR',{minimumFractionDigits:2})}` : null, c.percentual_exito ? `${c.percentual_exito}%` : null].filter(Boolean).join(' + ')
                        : '—';

                    const dataAss = c.data_assinatura
                        ? new Date(c.data_assinatura).toLocaleDateString('pt-BR')
                        : '—';

                    return `
                    <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:16px 20px;margin-bottom:12px;background:#fafafa;">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
                            <div>
                                <div style="font-weight:700;font-size:14px;color:var(--text-primary);margin-bottom:4px;">${c.titulo}</div>
                                <div style="font-size:12px;color:var(--text-secondary);display:flex;gap:12px;flex-wrap:wrap;">
                                    <span><strong>Tipo:</strong> ${tipoLabel[c.tipo_honorario] || c.tipo_honorario}</span>
                                    <span><strong>Valor:</strong> ${valorTxt}</span>
                                    ${c.processo_numero ? `<span><strong>Processo:</strong> ${c.processo_numero}</span>` : ''}
                                    <span><strong>Assinado:</strong> ${dataAss}</span>
                                </div>
                                ${c.observacoes ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;font-style:italic;">${c.observacoes.substring(0,120)}${c.observacoes.length>120?'…':''}</div>` : ''}
                            </div>
                            <span style="background:${statusColor[c.status]||'#6b7280'};color:#fff;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;text-transform:uppercase;flex-shrink:0;">${c.status}</span>
                        </div>
                        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
                            <button onclick="_gerarTemplate(${c.id})" style="${_btnSmall('#3b82f6')}">
                                <i class="lucide lucide-file-text" style="width:13px;height:13px;"></i> VER TEMPLATE
                            </button>
                            ${c.tem_arquivo
                                ? `<button onclick="_downloadContrato(${c.id})" style="${_btnSmall('#10b981')}"><i class="lucide lucide-download" style="width:13px;height:13px;"></i> BAIXAR PDF</button>`
                                : `<button onclick="_abrirUpload(${c.id})" style="${_btnSmall('#6366f1')}"><i class="lucide lucide-upload" style="width:13px;height:13px;"></i> ENVIAR PDF ASSINADO</button>`
                            }
                            <button onclick="_editarContrato(${c.id},'${c.titulo.replace(/'/g,"\\'")}','${c.tipo_honorario}',${c.valor_fixo||'null'},${c.percentual_exito||'null'},'${c.data_assinatura||''}',${c.processo_id||'null'},'${(c.observacoes||'').replace(/'/g,"\\'")}','${c.status}')" style="${_btnSmall('#f59e0b')}">
                                <i class="lucide lucide-pencil" style="width:13px;height:13px;"></i> EDITAR
                            </button>
                            <button onclick="_excluirContrato(${c.id},'${c.titulo.replace(/'/g,"\\'")}')\" style="${_btnSmall('#ef4444')}">
                                <i class="lucide lucide-trash-2" style="width:13px;height:13px;"></i> EXCLUIR
                            </button>
                        </div>
                    </div>`;
                }).join('');

                corpo.innerHTML = header + cards;
                lucide.createIcons();
            } catch (err) {
                console.error('Contratos: erro ao carregar', err);
                document.getElementById('corpoModalContratos').innerHTML =
                    '<p style="color:var(--danger);text-align:center;padding:32px;font-weight:600;">❌ ERRO AO CARREGAR CONTRATOS</p>';
            }
        }

        function _btnSmall(color) {
            return `background:${color};color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px;font-family:inherit;text-transform:uppercase;`;
        }

        // ── Abrir template em nova aba ───────────────────────────────
        function _gerarTemplate(contratoId) {
            const token = localStorage.getItem('token');
            window.open(`/api/clientes/${_contratoClienteId}/contratos/${contratoId}/template?token=${token}`, '_blank');
        }

        // ── Download PDF assinado ────────────────────────────────────
        function _downloadContrato(contratoId) {
            const token = localStorage.getItem('token');
            window.open(`/api/contratos/${contratoId}/arquivo?token=${token}`, '_blank');
        }

        // ── Upload PDF assinado ──────────────────────────────────────
        function _abrirUpload(contratoId) {
            _contratoUploadId = contratoId;
            document.getElementById('inputPdfContrato').value = '';
            document.getElementById('modalUploadContrato').style.display = 'flex';
        }

        function fecharModalUpload() {
            document.getElementById('modalUploadContrato').style.display = 'none';
            _contratoUploadId = null;
        }

        async function confirmarUploadContrato() {
            const file = document.getElementById('inputPdfContrato').files[0];
            if (!file) { alert('Selecione um arquivo PDF.'); return; }
            if (file.type !== 'application/pdf') { alert('Apenas arquivos PDF são aceitos.'); return; }

            const formData = new FormData();
            formData.append('arquivo', file);

            try {
                const res = await fetch(`/api/contratos/${_contratoUploadId}/upload`, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') },
                    body: formData
                });
                const data = await res.json();
                if (!res.ok) { alert('❌ Erro: ' + (data.erro || 'Falha no upload')); return; }

                fecharModalUpload();
                alert('✅ PDF assinado vinculado com sucesso!');
                await _carregarListaContratos();
            } catch (err) {
                console.error('Upload contrato:', err);
                alert('❌ Erro de conexão ao fazer upload.');
            }
        }

        // ── Novo contrato ────────────────────────────────────────────
        async function abrirNovoContrato() {
            _contratoEditandoId = null;
            document.getElementById('tituloFormContrato').innerHTML =
                '<i class="lucide lucide-plus-circle"></i> NOVO CONTRATO';
            document.getElementById('textoSalvarContrato').textContent = 'SALVAR CONTRATO';
            document.getElementById('formContrato').reset();
            document.getElementById('campoValorFixo').style.display  = 'none';
            document.getElementById('campoPercentual').style.display = 'none';
            await _carregarProcessosSelect();
            document.getElementById('modalFormContrato').style.display = 'flex';
            lucide.createIcons();
        }

        // ── Editar contrato ──────────────────────────────────────────
        async function _editarContrato(id, titulo, tipo, valorFixo, percentual, dataAss, processoId, obs, status) {
            _contratoEditandoId = id;
            document.getElementById('tituloFormContrato').innerHTML =
                '<i class="lucide lucide-pencil"></i> EDITAR CONTRATO';
            document.getElementById('textoSalvarContrato').textContent = 'SALVAR ALTERAÇÕES';

            await _carregarProcessosSelect(processoId);

            document.getElementById('ctTitulo').value         = titulo || '';
            document.getElementById('ctTipo').value           = tipo   || '';
            document.getElementById('ctValorFixo').value      = valorFixo   || '';
            document.getElementById('ctPercentual').value     = percentual  || '';
            document.getElementById('ctDataAssinatura').value = dataAss ? dataAss.split('T')[0] : '';
            document.getElementById('ctObs').value            = obs    || '';

            atualizarCamposHonorario();
            document.getElementById('modalFormContrato').style.display = 'flex';
            lucide.createIcons();
        }

        function fecharModalFormContrato() {
            document.getElementById('modalFormContrato').style.display = 'none';
            _contratoEditandoId = null;
        }

        function atualizarCamposHonorario() {
            const tipo = document.getElementById('ctTipo').value;
            document.getElementById('campoValorFixo').style.display  = ['fixo','misto','consultoria'].includes(tipo) ? '' : 'none';
            document.getElementById('campoPercentual').style.display = ['exito','misto'].includes(tipo)             ? '' : 'none';
        }

        async function _carregarProcessosSelect(selecionado) {
            const sel = document.getElementById('ctProcesso');
            sel.innerHTML = '<option value="">SEM PROCESSO VINCULADO</option>';
            try {
                const res  = await API.get(`/api/processos?limit=200`);
                const data = await res.json();
                const lista = data.data || data;
                lista.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.numero + (p.cliente ? ` — ${p.cliente}` : '');
                    if (selecionado && p.id == selecionado) opt.selected = true;
                    sel.appendChild(opt);
                });
            } catch(e) { /* silencioso */ }
        }

        // ── Submeter formulário ──────────────────────────────────────
        document.getElementById('formContrato').addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                titulo:           document.getElementById('ctTitulo').value,
                tipo_honorario:   document.getElementById('ctTipo').value,
                valor_fixo:       document.getElementById('ctValorFixo').value   || null,
                percentual_exito: document.getElementById('ctPercentual').value  || null,
                data_assinatura:  document.getElementById('ctDataAssinatura').value || null,
                processo_id:      document.getElementById('ctProcesso').value    || null,
                observacoes:      document.getElementById('ctObs').value         || null,
            };

            try {
                let res;
                if (_contratoEditandoId) {
                    res = await API.put(`/api/contratos/${_contratoEditandoId}`, payload);
                } else {
                    res = await API.post(`/api/clientes/${_contratoClienteId}/contratos`, payload);
                }
                const data = await res.json();
                if (!res.ok) { alert('❌ Erro: ' + (data.erro || 'Falha ao salvar')); return; }

                fecharModalFormContrato();
                await _carregarListaContratos();
            } catch (err) {
                console.error('Salvar contrato:', err);
                alert('❌ Erro de conexão ao salvar contrato.');
            }
        });

        // ── Excluir contrato ─────────────────────────────────────────
        async function _excluirContrato(id, titulo) {
            if (!confirm(`EXCLUIR o contrato "${titulo}"?\n\nO PDF vinculado também será removido.`)) return;
            try {
                const res = await API.delete(`/api/contratos/${id}`);
                if (!res.ok) { alert('❌ Erro ao excluir contrato'); return; }
                await _carregarListaContratos();
            } catch (err) {
                console.error('Excluir contrato:', err);
                alert('❌ Erro de conexão ao excluir.');
            }
        }