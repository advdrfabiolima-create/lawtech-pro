const token = localStorage.getItem('token');
    if (!token) window.location.href = '/login.html';
    
    let todosProcessos = [];
    let abaAtual = 'ativo';
    let gerenciadorPartes = null;
    let poloAtual = null;
    let poloAtualEdicao = null;
    // ── Paginação e filtros ──
    let paginaAtualProcessos = 1;
    let totalProcessosPaginados = 0;
    let totalPaginasProcessos = 1;
    const LIMITE_PROCESSOS = 50;
    let termoBuscaProcessos = '';
    let ufsFiltroAtual = '';   // UFs ativas (ex: "SP,RJ" ou "" para todas)
    let buscaTimer = null;

    const regioesMap = {
        'SUL': ['PR', 'RS', 'SC'],
        'SUDESTE': ['ES', 'MG', 'RJ', 'SP'],
        'CENTRO': ['DF', 'GO', 'MT', 'MS'],
        'NORDESTE': ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
        'NORTE': ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO']
    };

    // ============================================
    // CLASSE GERENCIADOR DE PARTES
    // ============================================
/**
 * GERENCIADOR DE MÚLTIPLAS PARTES DO PROCESSO
 * Componente para adicionar/remover múltiplas partes (autores e réus) em um processo
 */

class GerenciadorPartes {
    constructor(containerAtivoId = 'listaPartesAtivo', containerPassivoId = 'listaPartesPassivo', instanceName = 'gerenciadorPartes') {
        this.partesAtivo = [];
        this.partesPassivo = [];
        this.clientesDisponiveis = [];
        this.containerAtivoId = containerAtivoId;
        this.containerPassivoId = containerPassivoId;
        this.contadorAtivoId = 'contadorAtivo';
        this.contadorPassivoId = 'contadorPassivo';
        this.instanceName = instanceName;
    }

    /**
     * Inicializa o gerenciador e carrega clientes
     */
    async inicializar() {
        await this.carregarClientes();
        this.renderizar();
    }

    /**
     * Carrega lista de clientes do backend
     */
    async carregarClientes() {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/clientes?limit=200', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const rC = await response.json();
                this.clientesDisponiveis = rC.data || rC;
            }
        } catch (err) {
            console.error('Erro ao carregar clientes:', err);
        }
    }

    /**
     * Adiciona nova parte ao polo ativo
     */
    adicionarParteAtivo(dados) {
        const parte = {
            id: Date.now(),
            pessoa_id: dados.pessoa_id || null,
            pessoa_nome: dados.pessoa_nome,
            tipo_parte: dados.tipo_parte || 'autor',
            eh_principal: this.partesAtivo.length === 0 // Primeira parte é principal
        };

        this.partesAtivo.push(parte);
        this.renderizar();
    }

    /**
     * Adiciona nova parte ao polo passivo
     */
    adicionarPartePassivo(dados) {
        const parte = {
            id: Date.now(),
            pessoa_id: dados.pessoa_id || null,
            pessoa_nome: dados.pessoa_nome,
            tipo_parte: dados.tipo_parte || 'reu',
            eh_principal: this.partesPassivo.length === 0 // Primeira parte é principal
        };

        this.partesPassivo.push(parte);
        this.renderizar();
    }

    /**
     * Remove parte do polo ativo
     */
    removerParteAtivo(id) {
        const index = this.partesAtivo.findIndex(p => p.id === id);
        if (index === -1) return;

        const ehPrincipal = this.partesAtivo[index].eh_principal;
        this.partesAtivo.splice(index, 1);

        // Se removeu a principal e ainda há partes, marca a primeira como principal
        if (ehPrincipal && this.partesAtivo.length > 0) {
            this.partesAtivo[0].eh_principal = true;
        }

        this.renderizar();
    }

    /**
     * Remove parte do polo passivo
     */
    removerPartePassivo(id) {
        const index = this.partesPassivo.findIndex(p => p.id === id);
        if (index === -1) return;

        const ehPrincipal = this.partesPassivo[index].eh_principal;
        this.partesPassivo.splice(index, 1);

        // Se removeu a principal e ainda há partes, marca a primeira como principal
        if (ehPrincipal && this.partesPassivo.length > 0) {
            this.partesPassivo[0].eh_principal = true;
        }

        this.renderizar();
    }

    /**
     * Define parte como principal no polo ativo
     */
    definirPrincipalAtivo(id) {
        this.partesAtivo.forEach(p => {
            p.eh_principal = (p.id === id);
        });
        this.renderizar();
    }

    /**
     * Define parte como principal no polo passivo
     */
    definirPrincipalPassivo(id) {
        this.partesPassivo.forEach(p => {
            p.eh_principal = (p.id === id);
        });
        this.renderizar();
    }

    /**
     * Limpa todas as partes
     */
    limpar() {
        this.partesAtivo = [];
        this.partesPassivo = [];
        this.renderizar();
    }

    /**
     * Obtém dados para envio ao backend
     */
    obterDados() {
        return {
            ativo: this.partesAtivo.map(p => ({
                pessoa_id: p.pessoa_id,
                pessoa_nome: p.pessoa_nome,
                tipo_parte: p.tipo_parte,
                eh_principal: p.eh_principal
            })),
            passivo: this.partesPassivo.map(p => ({
                pessoa_id: p.pessoa_id,
                pessoa_nome: p.pessoa_nome,
                tipo_parte: p.tipo_parte,
                eh_principal: p.eh_principal
            }))
        };
    }

    /**
     * Valida se os dados estão corretos
     */
    validar() {
        const erros = [];

        if (this.partesAtivo.length === 0) {
            erros.push('É obrigatório adicionar pelo menos uma parte no Polo Ativo (Cliente/Autor)');
        }

        if (this.partesPassivo.length === 0) {
            erros.push('É obrigatório adicionar pelo menos uma parte no Polo Passivo (Réu)');
        }

        // Auto-definir primeira parte como principal se nenhuma estiver marcada
        const temPrincipalAtivo = this.partesAtivo.some(p => p.eh_principal);
        const temPrincipalPassivo = this.partesPassivo.some(p => p.eh_principal);

        if (!temPrincipalAtivo && this.partesAtivo.length > 0) {
            this.partesAtivo[0].eh_principal = true;
        }

        if (!temPrincipalPassivo && this.partesPassivo.length > 0) {
            this.partesPassivo[0].eh_principal = true;
        }

        return {
            valido: erros.length === 0,
            mensagem: erros.join('\n')
        };
    }

    /**
     * Renderiza a interface
     */
    renderizar() {
        this.renderizarPoloAtivo();
        this.renderizarPoloPassivo();
        this.atualizarContadores();
    }

    /**
     * Renderiza lista do polo ativo
     */
    renderizarPoloAtivo() {
        const container = document.getElementById(this.containerAtivoId);
        if (!container) return;

        if (this.partesAtivo.length === 0) {
            container.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #94a3b8; font-size: 13px;">
                    <i data-lucide="user-plus" style="width: 32px; height: 32px; margin-bottom: 8px;"></i>
                    <div>Nenhuma parte adicionada no polo ativo</div>
                    <div style="font-size: 11px; margin-top: 4px;">Clique em "+" para adicionar</div>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        const instanceName = this.instanceName;
        container.innerHTML = this.partesAtivo.map(parte => `
            <div class="parte-item ${parte.eh_principal ? 'principal' : ''}" data-id="${parte.id}">
                <div class="parte-info">
                    ${parte.eh_principal ?
                        '<span class="badge-principal">★ PRINCIPAL</span>' :
                        `<button class="btn-set-principal" data-action="${instanceName}_definirPrincipalAtivo" data-args='[${parte.id}]' title="Definir como principal">☆</button>`
                    }
                    <div class="parte-nome">${parte.pessoa_nome}</div>
                    <div class="parte-tipo">${this.formatarTipoParte(parte.tipo_parte)}</div>
                </div>
                <button class="btn-remover" data-action="${instanceName}_removerParteAtivo" data-args='[${parte.id}]' title="Remover parte">
                    <i data-lucide="x" style="width: 14px; height: 14px;"></i>
                </button>
            </div>
        `).join('');

        lucide.createIcons();
    }

    /**
     * Renderiza lista do polo passivo
     */
    renderizarPoloPassivo() {
        const container = document.getElementById(this.containerPassivoId);
        if (!container) return;

        if (this.partesPassivo.length === 0) {
            container.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #94a3b8; font-size: 13px;">
                    <i data-lucide="user-plus" style="width: 32px; height: 32px; margin-bottom: 8px;"></i>
                    <div>Nenhuma parte adicionada no polo passivo</div>
                    <div style="font-size: 11px; margin-top: 4px;">Clique em "+" para adicionar</div>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        const instanceNameP = this.instanceName;
        container.innerHTML = this.partesPassivo.map(parte => `
            <div class="parte-item ${parte.eh_principal ? 'principal' : ''}" data-id="${parte.id}">
                <div class="parte-info">
                    ${parte.eh_principal ?
                        '<span class="badge-principal">★ PRINCIPAL</span>' :
                        `<button class="btn-set-principal" data-action="${instanceNameP}_definirPrincipalPassivo" data-args='[${parte.id}]' title="Definir como principal">☆</button>`
                    }
                    <div class="parte-nome">${parte.pessoa_nome}</div>
                    <div class="parte-tipo">${this.formatarTipoParte(parte.tipo_parte)}</div>
                </div>
                <button class="btn-remover" data-action="${instanceNameP}_removerPartePassivo" data-args='[${parte.id}]' title="Remover parte">
                    <i data-lucide="x" style="width: 14px; height: 14px;"></i>
                </button>
            </div>
        `).join('');

        lucide.createIcons();
    }

    /**
     * Atualiza contadores de partes
     */
    atualizarContadores() {
        const contadorAtivo = document.getElementById(this.contadorAtivoId);
        const contadorPassivo = document.getElementById(this.contadorPassivoId);

        if (contadorAtivo) {
            contadorAtivo.textContent = this.partesAtivo.length;
        }

        if (contadorPassivo) {
            contadorPassivo.textContent = this.partesPassivo.length;
        }
    }

    /**
     * Formata tipo de parte para exibição
     */
    formatarTipoParte(tipo) {
        const tipos = {
            'autor': 'Autor',
            'reu': 'Réu',
            'litisconsorte_ativo': 'Litisconsorte Ativo',
            'litisconsorte_passivo': 'Litisconsorte Passivo',
            'assistente': 'Assistente',
            'terceiro_interessado': 'Terceiro Interessado',
            'opoente': 'Opoente'
        };
        return tipos[tipo] || tipo;
    }

    /**
     * Carrega partes de um processo existente
     */
    async carregarPartesProcesso(processoId) {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/processos/${processoId}/partes`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const dados = await response.json();
                
                this.partesAtivo = dados.partesOrganizadas.ativo.map((p, i) => ({
                    id: Date.now() + i,
                    pessoa_id: p.pessoa_id,
                    pessoa_nome: p.pessoa_nome,
                    tipo_parte: p.tipo_parte,
                    eh_principal: p.eh_principal
                }));

                this.partesPassivo = dados.partesOrganizadas.passivo.map((p, i) => ({
                    id: Date.now() + 1000 + i,
                    pessoa_id: p.pessoa_id,
                    pessoa_nome: p.pessoa_nome,
                    tipo_parte: p.tipo_parte,
                    eh_principal: p.eh_principal
                }));

                this.renderizar();
            }
        } catch (err) {
            console.error('Erro ao carregar partes do processo:', err);
        }
    }
}

// ✅ Tornar a classe disponível globalmente
window.GerenciadorPartes = GerenciadorPartes;

// Instâncias globais

let gerenciadorPartesEdicao = null;
    // ============================================
    // INICIALIZAÇÃO
    // ============================================
    async function inicializar() {
        try {
            console.log('🔄 Inicializando página de processos...');
            
            // 1. Busca dados do usuário
            const resUser = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
            const dataUser = await resUser.json();

            if (dataUser.ok) {
                const emailElement = document.getElementById('footerEmail');
                if (emailElement) {
                    emailElement.innerText = dataUser.usuario.email || 'Não disponível';
                    console.log('✅ Email atualizado:', dataUser.usuario.email);
                }

                const nomeCompleto = dataUser.usuario.nome || 'Advogado';
                const primeiroNome = nomeCompleto.split(' ')[0];
                
                const nameHeader = document.getElementById('userNameHeader');
                if (nameHeader) nameHeader.innerText = primeiroNome;

                const partes = nomeCompleto.trim().split(' ').filter(n => n);
                let iniciais = partes[0][0];
                if (partes.length > 1) {
                    iniciais += partes[partes.length - 1][0];
                }
                
                const circulo = document.getElementById('userCircle');
                if (circulo) circulo.innerText = iniciais.toUpperCase();

                window._userRole = dataUser.usuario.role || 'visualizador';
                aplicarPermissoesRoleUI(window._userRole);
            }

            // 2. Busca plano
            const resPlan = await fetch('/api/plano-consumo', { headers: { Authorization: `Bearer ${token}` } });
            const dataPlan = await resPlan.json();
            
            const planoElement = document.getElementById('footerPlano');
            if (planoElement) {
                planoElement.innerText = dataPlan.plano || 'Free';
                console.log('✅ Plano atualizado:', dataPlan.plano);
            }

            // 3. Carrega processos
            await carregarProcessos();
            
            // 4. Inicializar gerenciador de partes
            gerenciadorPartes = new GerenciadorPartes('listaPartesAtivo', 'listaPartesPassivo');
            await carregarClientesParaSelect();
            console.log('✅ Gerenciador de partes inicializado');
        
        } catch (err) {
            console.error("❌ Erro na inicialização:", err);
        }
    }

    // ============================================
    // PROCESSOS
    // ============================================
    async function carregarProcessos(page, busca, ufs) {
        page = (page !== undefined) ? page : paginaAtualProcessos;
        busca = (busca !== undefined) ? busca : termoBuscaProcessos;
        ufs = (ufs !== undefined) ? ufs : ufsFiltroAtual;
        paginaAtualProcessos = page;
        termoBuscaProcessos = busca;
        ufsFiltroAtual = ufs;

        const tabela = document.getElementById('listaProcessos');
        if (tabela) tabela.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:50px;color:var(--muted);">Carregando...</td></tr>';

        try {
            const params = new URLSearchParams({ page, limit: LIMITE_PROCESSOS, status: abaAtual });
            if (busca && busca.trim()) params.set('busca', busca.trim());
            if (ufs && ufs.trim()) params.set('ufs', ufs.trim());

            const response = await fetch('/api/processos?' + params.toString(), {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const resp = await response.json();
                todosProcessos = resp.data || resp;
                totalProcessosPaginados = resp.total ?? todosProcessos.length;
                totalPaginasProcessos = resp.totalPages ?? Math.ceil(totalProcessosPaginados / LIMITE_PROCESSOS);

                if (resp.metricas) {
                    const m = resp.metricas;
                    const el = (id) => document.getElementById(id);
                    if (el('totalProcessosCard'))      el('totalProcessosCard').textContent      = m.total      || 0;
                    if (el('processosAtivosCard'))     el('processosAtivosCard').textContent     = m.ativos     || 0;
                    if (el('processosArquivadosCard')) el('processosArquivadosCard').textContent = m.arquivados || 0;
                    if (el('tribunaisCard'))           el('tribunaisCard').textContent           = m.tribunais  || 0;
                }

                renderizarTabela(todosProcessos);
                renderizarPaginacaoProcessos();

                // Pré-filtrar se veio de /documentos-page com ?busca=NUMERO
                const buscaParam = new URLSearchParams(window.location.search).get('busca');
                if (buscaParam && !busca) {
                    const input = document.getElementById('searchProcessos');
                    if (input) input.value = buscaParam;
                    carregarProcessos(1, buscaParam, '');
                }
            } else {
                console.error('Erro na resposta:', response.status);
            }
        } catch (err) {
            console.error("Erro ao carregar lista:", err);
        }
    }

    function atualizarMetricas() {
        // Cards são atualizados via resp.metricas em carregarProcessos
    }

    function renderizarTabela(lista) {
        const tabela = document.getElementById('listaProcessos');
        const listaFiltrada = lista; // Servidor já filtra por status e UF

        // Atualizar métricas
        atualizarMetricas();

        if (listaFiltrada.length === 0) {
            tabela.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:50px; color:var(--muted);">Nenhum processo encontrado.</td></tr>`;
            return;
        }

        tabela.innerHTML = listaFiltrada.map(p => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 16px 12px;">
                    <div style="font-weight: 700; color: #4A90E2; font-size: 14px;">${p.numero || 'N/A'}</div>
                </td>
                <td style="padding: 16px 12px; font-weight: 600;">${p.cliente || '---'}</td>
                <td style="padding: 16px 12px;">${p.parte_contraria || '---'}</td>
                <td style="padding: 16px 12px;">
                    <span style="background: #e0f2fe; color: #0369a1; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase;">
                        ${formatarEsfera(p.esfera) || 'N/A'}
                    </span>
                </td>
                <td style="padding: 16px 12px; font-weight: 500;">${formatarTribunal(p.tribunal) || '—'}</td>
                <td style="padding: 16px 12px; text-align: center; font-weight: 600;">${formatarInstancia(p.instancia)}</td>
                <td style="padding: 16px 12px; text-align: center; font-weight: 700; color: #4A90E2;">${p.uf || '--'}</td>
                <td style="padding: 16px 12px; text-align: right;">
                    ${abaAtual === 'excluido' ? `
                        <div style="text-align: right; line-height: 1.3;">
                            <div style="font-size: 9px; color: #94a3b8; text-transform: uppercase; font-weight: 700; margin-bottom: 2px;">Auditado</div>
                            <div style="font-size: 11px; color: #ef4444; font-weight: 600; margin-bottom: 2px;">
                                ${p.excluido_por ? (p.excluido_por.includes('@') ? p.excluido_por.split('@')[0] : p.excluido_por) : 'Sistema'}
                            </div>
                            <div style="font-size: 10px; color: #7B8794; font-weight: 500;">
                                ${p.data_exclusao ? (() => {
                                    let data = new Date(p.data_exclusao);
                                    if (p.data_exclusao.includes('Z') || data.getTimezoneOffset() === 0) {
                                        data.setHours(data.getHours() - 3);
                                    }
                                    return data.toLocaleString('pt-BR', {
                                        day: '2-digit', month: '2-digit', year: 'numeric',
                                        hour: '2-digit', minute: '2-digit', hour12: false
                                    });
                                })() : 'Data não registrada'}
                            </div>
                        </div>
                    ` : `
                        <div style="position: relative; display: inline-block;">
                            <button class="proc-actions-toggle" data-action="toggleDropdown" data-args='[${p.id}]' title="Ações">
                                <i data-lucide="more-vertical" style="width:16px;height:16px;"></i>
                            </button>
                            <div id="proc-menu-${p.id}" class="proc-actions-menu">
                                <button data-action="editarProcesso" data-args='[${p.id}]'>
                                    <i data-lucide="edit" style="width:14px;height:14px;color:#5BA4DB;"></i> Editar
                                </button>
                                ${abaAtual === 'ativo' ? `
                                <button data-action="arquivarProcesso" data-args='[${p.id}]'>
                                    <i data-lucide="archive" style="width:14px;height:14px;color:#f59e0b;"></i> Arquivar
                                </button>
                                ` : `
                                <button data-action="desarquivarProcesso" data-args='[${p.id}]'>
                                    <i data-lucide="refresh-cw" style="width:14px;height:14px;color:#10b981;"></i> Desarquivar
                                </button>
                                `}
                                <button data-action="abrirAndamentos" data-args='[${p.id},"${(p.numero||'').replace(/"/g,'&quot;')}"]'>
                                    <i data-lucide="clock" style="width:14px;height:14px;color:#6366f1;"></i> Andamentos
                                </button>
                                <button data-action="irParaDocumentos" data-args='[${p.id}]'>
                                    <i data-lucide="folder-open" style="width:14px;height:14px;color:#7E8CE0;"></i> Documentos
                                </button>
                                <hr>
                                <button class="danger" data-action="excluirProcesso" data-args='[${p.id}]'>
                                    <i data-lucide="trash-2" style="width:14px;height:14px;"></i> Excluir
                                </button>
                            </div>
                        </div>
                    `}
                </td>
            </tr>
        `).join('');
        lucide.createIcons();
    }

    // ── Dropdown de ações da tabela ──────────────────────────────────────────
    window.toggleDropdown = function(id) {
        const menu = document.getElementById('proc-menu-' + id);
        if (!menu) return;
        const isOpen = menu.style.display === 'block';
        // Fecha todos os outros menus abertos
        document.querySelectorAll('.proc-actions-menu').forEach(m => { m.style.display = 'none'; });
        if (!isOpen) menu.style.display = 'block';
    };

    // Fecha dropdowns ao clicar fora
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.proc-actions-toggle') && !e.target.closest('.proc-actions-menu')) {
            document.querySelectorAll('.proc-actions-menu').forEach(m => { m.style.display = 'none'; });
        }
    });

    function mudarAba(aba) {
        abaAtual = aba;
        ['btnTabAtivo', 'btnTabArquivado', 'btnTabExcluido'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.toggle('active', id === 'btnTab' + aba.charAt(0).toUpperCase() + aba.slice(1));
        });
        const input = document.getElementById('searchProcessos');
        const btnLimpar = document.getElementById('btnLimparBusca');
        if (input) input.value = '';
        if (btnLimpar) btnLimpar.style.display = 'none';
        // Reset filtros ao mudar aba
        ufsFiltroAtual = '';
        document.querySelectorAll('#region-filter .btn-filter').forEach((btn, i) => {
            btn.classList.toggle('active', i === 0); // reativa "TODOS"
        });
        const stateFilterDiv = document.getElementById('state-filter');
        if (stateFilterDiv) stateFilterDiv.style.display = 'none';
        carregarProcessos(1, '', '');
    }

    // ============================================
    // BUSCA/FILTRO DE PROCESSOS NA TABELA
    // ============================================
    function filtrarProcessosTabela() {
        const termo = document.getElementById('searchProcessos').value;
        const btnLimpar = document.getElementById('btnLimparBusca');
        if (btnLimpar) btnLimpar.style.display = termo ? 'flex' : 'none';
        // Debounce 400ms — respeita filtro de UF ativo
        clearTimeout(buscaTimer);
        buscaTimer = setTimeout(() => { carregarProcessos(1, termo, ufsFiltroAtual); }, 400);
    }

    function limparBuscaProcessos() {
        const input = document.getElementById('searchProcessos');
        const btnLimpar = document.getElementById('btnLimparBusca');
        if (input) input.value = '';
        if (btnLimpar) btnLimpar.style.display = 'none';
        if (input) input.focus();
        // Mantém filtro de UF ativo ao limpar a busca
        carregarProcessos(1, '', ufsFiltroAtual);
    }

    // ============================================
    // PAGINAÇÃO
    // ============================================
    function carregarProcessosPagina(pagina) {
        carregarProcessos(pagina, termoBuscaProcessos, ufsFiltroAtual);
    }
    window.carregarProcessosPagina = carregarProcessosPagina;

    function renderizarPaginacaoProcessos() {
        const container = document.getElementById('paginacaoProcessos');
        if (!container) return;
        const page = paginaAtualProcessos;
        const totalPages = totalPaginasProcessos;
        const total = totalProcessosPaginados;
        if (!totalPages || totalPages <= 1) { container.classList.remove('ativo'); return; }
        const inicio = ((page - 1) * LIMITE_PROCESSOS) + 1;
        const fim = Math.min(page * LIMITE_PROCESSOS, total);
        const delta = 2, left = Math.max(1, page - delta), right = Math.min(totalPages, page + delta);
        let nums = '';
        if (left > 1) nums += '<button data-action="carregarProcessosPagina" data-args=\'[1]\' class="pag-num' + (1===page?' pag-ativo':'') + '">1</button>';
        if (left > 2) nums += '<span class="pag-ellipsis">…</span>';
        for (let i = left; i <= right; i++) nums += '<button data-action="carregarProcessosPagina" data-args=\'[' + i + ']\' class="pag-num' + (i===page?' pag-ativo':'') + '">' + i + '</button>';
        if (right < totalPages - 1) nums += '<span class="pag-ellipsis">…</span>';
        if (right < totalPages) nums += '<button data-action="carregarProcessosPagina" data-args=\'[' + totalPages + ']\' class="pag-num' + (totalPages===page?' pag-ativo':'') + '">' + totalPages + '</button>';
        container.innerHTML =
            '<span class="pag-info">Mostrando <strong>' + inicio + '–' + fim + '</strong> de <strong>' + total + '</strong> processos</span>' +
            '<div class="pag-controles">' +
            '<button data-action="carregarProcessosPagina" data-args=\'[' + (page-1) + ']\' ' + (page<=1?'disabled':'') + ' class="pag-nav">← Anterior</button>' +
            nums +
            '<button data-action="carregarProcessosPagina" data-args=\'[' + (page+1) + ']\' ' + (page>=totalPages?'disabled':'') + ' class="pag-nav">Próximo →</button>' +
            '</div>';
        container.classList.add('ativo');
    }


    // ============================================
    // MODAL DE PROCESSO
    // ============================================
    function abrirModalProcesso() { 
        document.getElementById('modalProcesso').style.display = 'flex'; 
        carregarClientesNoSelect(); 
        document.getElementById('procEsfera').value = '';
        document.getElementById('procTribunal').innerHTML = '<option value="">Aguardando Esfera...</option>';
        
        // Aplicar máscara CNJ no campo número
        setTimeout(() => {
            const campoNumero = document.getElementById('numero');
            if (!campoNumero) {
                console.error('❌ Campo número não encontrado');
                return;
            }
            
            // Limpar campo ao abrir modal
            campoNumero.value = '';
            
            // Remover listeners anteriores se existirem
            if (campoNumero._listeners) {
                campoNumero._listeners.forEach(obj => {
                    campoNumero.removeEventListener(obj.event, obj.handler);
                });
            }
            campoNumero._listeners = [];
            
            // Função para bloquear entrada de letras
            const bloquearLetras = function(e) {
                const teclasPermitidas = [8, 9, 27, 13, 46, 35, 36, 37, 39]; // backspace, tab, esc, enter, delete, home, end, arrows
                
                // Permitir Ctrl/Cmd + A, C, V, X
                if ((e.ctrlKey || e.metaKey) && [65, 67, 86, 88].indexOf(e.keyCode) !== -1) {
                    return true;
                }
                
                // Se for tecla permitida, deixar passar
                if (teclasPermitidas.indexOf(e.keyCode) !== -1) {
                    return true;
                }
                
                // Permitir apenas números (0-9)
                const isNumber = (e.keyCode >= 48 && e.keyCode <= 57) || (e.keyCode >= 96 && e.keyCode <= 105);
                if (!isNumber) {
                    e.preventDefault();
                    return false;
                }
            };
            
            // Função de máscara CNJ
            const aplicarMascaraCNJ = function(e) {
                let valor = e.target.value;
                
                // Remove tudo que não é número
                valor = valor.replace(/\D/g, '');
                
                // Limita a 20 dígitos
                if (valor.length > 20) {
                    valor = valor.substring(0, 20);
                }
                
                // Aplica a máscara: NNNNNNN-DD.AAAA.J.TR.OOOO
                let resultado = '';
                
                // Primeiros 7 dígitos (NNNNNNN)
                if (valor.length > 0) {
                    resultado = valor.substring(0, Math.min(7, valor.length));
                }
                
                // Traço + 2 dígitos (-DD)
                if (valor.length > 7) {
                    resultado += '-' + valor.substring(7, Math.min(9, valor.length));
                }
                
                // Ponto + 4 dígitos (.AAAA)
                if (valor.length > 9) {
                    resultado += '.' + valor.substring(9, Math.min(13, valor.length));
                }
                
                // Ponto + 1 dígito (.J)
                if (valor.length > 13) {
                    resultado += '.' + valor.substring(13, Math.min(14, valor.length));
                }
                
                // Ponto + 2 dígitos (.TR)
                if (valor.length > 14) {
                    resultado += '.' + valor.substring(14, Math.min(16, valor.length));
                }
                
                // Ponto + 4 dígitos (.OOOO)
                if (valor.length > 16) {
                    resultado += '.' + valor.substring(16, Math.min(20, valor.length));
                }
                
                e.target.value = resultado;
                
                console.log('Valor digitado:', valor, '→ Formatado:', resultado);
            };
            
            // Adicionar listeners
            campoNumero.addEventListener('keydown', bloquearLetras);
            campoNumero.addEventListener('input', aplicarMascaraCNJ);
            campoNumero.addEventListener('paste', function(e) {
                setTimeout(() => aplicarMascaraCNJ({target: campoNumero}), 10);
            });
            
            // Guardar referências para poder remover depois
            campoNumero._listeners.push(
                {event: 'keydown', handler: bloquearLetras},
                {event: 'input', handler: aplicarMascaraCNJ}
            );
            
            console.log('✅ Máscara CNJ aplicada ao campo número do processo');
        }, 150);
    }

    function fecharModalProcesso() {
        const modal = document.getElementById('modalProcesso');
        modal.style.display = 'none';
        if (gerenciadorPartes) gerenciadorPartes.limpar();
        document.getElementById('formProcesso').reset();
    }

    // SALVAMENTO DO PROCESSO
    document.getElementById('formProcesso').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        console.log('📝 Iniciando cadastro de processo...');
        
        if (!gerenciadorPartes) {
            alert('❌ Erro: Gerenciador de partes não inicializado');
            return;
        }
        
        const validacao = gerenciadorPartes.validar();
        if (!validacao.valido) {
            alert(validacao.mensagem);
            return;
        }
        
        const dadosPartes = gerenciadorPartes.obterDados();
        
        // Validação adicional
        if (!dadosPartes.ativo || dadosPartes.ativo.length === 0) {
            alert('⚠️ Adicione pelo menos uma parte no Polo Ativo (Cliente/Autor)');
            return;
        }
        
        if (!dadosPartes.passivo || dadosPartes.passivo.length === 0) {
            alert('⚠️ Adicione pelo menos uma parte no Polo Passivo (Parte Contrária/Réu)');
            return;
        }
        
        console.log('✅ Validação de partes OK:', {
            ativo: dadosPartes.ativo.length,
            passivo: dadosPartes.passivo.length
        });
        
        // ✅ IDs CORRETOS dos campos do formulário
        const numero = document.getElementById('numero');
        const esfera = document.getElementById('esfera');
        const tribunal = document.getElementById('tribunal');
        const instancia = document.getElementById('instancia');
        const uf = document.getElementById('uf');
        
        // Verificar se todos os campos existem
        if (!numero || !esfera || !tribunal || !instancia || !uf) {
            console.error('❌ Campos não encontrados:', {
                numero: !!numero,
                esfera: !!esfera,
                tribunal: !!tribunal,
                instancia: !!instancia,
                uf: !!uf
            });
            alert('❌ Erro: Campos do formulário não encontrados');
            return;
        }
        
        const dados = {
            numero: numero.value.trim(),
            esfera: esfera.value,
            tribunal: tribunal.value,
            instancia: instancia.value,
            uf: uf.value,
            partes_ativo: dadosPartes.ativo,
            partes_passivo: dadosPartes.passivo
        };
        
        console.log('📤 Dados a serem enviados:', dados);
        console.log('📊 Partes Ativo:', dadosPartes.ativo);
        console.log('📊 Partes Passivo:', dadosPartes.passivo);
        
        // Validar campos obrigatórios
        if (!dados.numero || !dados.esfera || !dados.tribunal || !dados.instancia || !dados.uf) {
            alert('⚠️ Preencha todos os campos obrigatórios');
            return;
        }
        
        try {
            const response = await fetch('/api/processos', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(dados)
            });
            
            if (response.ok) {
                alert('✅ Processo cadastrado com sucesso!');
                fecharModalProcesso();
                await carregarProcessos();
            } else {
                const erro = await response.json();
                console.error('❌ Erro do servidor:', erro);
                alert('❌ Erro: ' + (erro.erro || erro.error || 'Erro desconhecido'));
            }
        } catch (err) {
            console.error('❌ Erro ao salvar:', err);
            alert('❌ Erro ao salvar processo: ' + err.message);
        }
    });

    function organizarTribunaisPorEsfera() {
        const esfera = document.getElementById('procEsfera').value;
        const tribunalSelect = document.getElementById('procTribunal');
        let html = '<option value="">Selecione o Tribunal...</option>';

        if (esfera === 'estadual') {
            ['TJAC','TJAL','TJAP','TJAM','TJBA','TJCE','TJDFT','TJES','TJGO','TJMA','TJMT','TJMS','TJMG','TJPA','TJPB','TJPR','TJPE','TJPI','TJRJ','TJRN','TJRS','TJRO','TJRR','TJSC','TJSP','TJSE','TJTO'].forEach(tj => html += `<option value="${tj}">${tj}</option>`);
        } else if (esfera === 'federal') {
            ['TRF1','TRF2','TRF3','TRF4','TRF5','TRF6'].forEach(trf => html += `<option value="${trf}">${trf}</option>`);
        } else if (esfera === 'trabalho') {
            for(let i=1; i<=24; i++) html += `<option value="TRT${i}">TRT${i}</option>`;
        } else if (esfera === 'eleitoral') {
            html += `<option value="TRE">TRE (Tribunal Regional Eleitoral)</option>`;
        } else if (esfera === 'superior') {
            ['STJ','STF','TST','TSE','STM','CNJ'].forEach(sup => html += `<option value="${sup}">${sup}</option>`);
        }

        tribunalSelect.innerHTML = html;
    }

    async function carregarClientesNoSelect() {
        try {
            const res = await fetch('/api/clientes?limit=200', { headers: { 'Authorization': `Bearer ${token}` } });
            const rClientes = await res.json();
            const clientes = rClientes.data || rClientes;
            const select = document.getElementById('procClienteId');
            if (select) {
                select.innerHTML = '<option value="">Selecione o Cliente...</option>' +
                    clientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
            }
        } catch (err) { 
            console.error("Erro ao carregar clientes:", err); 
        }
    }

    // ============================================
    // MODAL DE ADICIONAR PARTE
    // ============================================
    async function carregarClientesParaSelect() {
        try {
            const response = await fetch('/api/clientes?limit=200', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const rCli = await response.json();
                const clientes = rCli.data || rCli;
                const select = document.getElementById('clienteSelect');
                
                if (select) {
                    select.innerHTML = '<option value="">Selecionar cliente ou digitar manualmente</option>';
                    clientes.forEach(cliente => {
                        const option = document.createElement('option');
                        option.value = cliente.id;
                        option.textContent = cliente.nome;
                        option.dataset.nome = cliente.nome;
                        select.appendChild(option);
                    });
                }
            }
        } catch (err) {
            console.error('Erro ao carregar clientes:', err);
        }
    }

    function abrirModalAdicionarParte(polo) {
        poloAtual = polo;
        
        const modal = document.getElementById('modalAdicionarParte');
        const titulo = document.getElementById('tituloModalParte');
        const tipoSelect = document.getElementById('parteTipo');
        
        titulo.textContent = polo === 'ativo' ? '👤 Adicionar ao Polo Ativo' : '⚖️ Adicionar ao Polo Passivo';
        
        tipoSelect.innerHTML = '';
        if (polo === 'ativo') {
            tipoSelect.innerHTML = `
                <option value="autor">Autor / Reclamante</option>
                <option value="litisconsorte_ativo">Litisconsorte Ativo</option>
                <option value="assistente">Assistente</option>
                <option value="exequente">Exequente</option>
                <option value="recorrente">Recorrente</option>                
            `;
        } else {
            tipoSelect.innerHTML = `
                <option value="reu">Réu / Reclamado</option>
                <option value="litisconsorte_passivo">Litisconsorte Passivo</option>
                <option value="terceiro_interessado">Terceiro Interessado</option>
                <option value="executado">Executado</option>
                <option value="recorrido">Recorrido</option>
            `;
        }
        
        document.getElementById('formAdicionarParte').reset();
        document.getElementById('clienteSelect').value = '';
        modal.classList.add('ativo');
    }

    function abrirModalAdicionarParteEdicao(polo) {
        poloAtualEdicao = polo;
        
        const modal = document.getElementById('modalAdicionarParte');
        const titulo = document.getElementById('tituloModalParte');
        const tipoSelect = document.getElementById('parteTipo');
        
        titulo.textContent = polo === 'ativo' ? '👤 Adicionar ao Polo Ativo' : '⚖️ Adicionar ao Polo Passivo';
        
        // Limpar campos
        document.getElementById('clienteSelect').value = '';
        document.getElementById('parteNome').value = '';
        
        // Preencher tipos de parte conforme polo
        if (polo === 'ativo') {
            tipoSelect.innerHTML = `
                <option value="autor">Autor</option>
                <option value="requerente">Requerente</option>
                <option value="recorrente">Recorrente</option>
                <option value="impetrante">Impetrante</option>
                <option value="exequente">Exequente</option>
                <option value="litisconsorte_ativo">Litisconsorte Ativo</option>
            `;
        } else {
            tipoSelect.innerHTML = `
                <option value="reu">Réu</option>
                <option value="requerido">Requerido</option>
                <option value="recorrido">Recorrido</option>
                <option value="impetrado">Impetrado</option>
                <option value="executado">Executado</option>
                <option value="litisconsorte_passivo">Litisconsorte Passivo</option>
            `;
        }
        
        modal.classList.add('ativo');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function fecharModalAdicionarParte() {
        const modal = document.getElementById('modalAdicionarParte');
        modal.classList.remove('ativo');
        document.getElementById('formAdicionarParte').reset();
        
        // Limpar referências de polo
        poloAtual = null;
        poloAtualEdicao = null;
    }

    function preencherDadosCliente(clienteId) {
        if (!clienteId) {
            document.getElementById('parteNome').value = '';
            return;
        }
        const select = document.getElementById('clienteSelect');
        const option = select.options[select.selectedIndex];
        document.getElementById('parteNome').value = option.dataset.nome;
    }

    async function adicionarParte() {
        const nome = document.getElementById('parteNome').value.trim();
        const tipo = document.getElementById('parteTipo').value;
        const clienteId = document.getElementById('clienteSelect').value;
        
        if (!nome || !tipo) {
            alert('Preencha todos os campos obrigatórios');
            return;
        }
        
        const dadosParte = {
            pessoa_id: clienteId || null,
            pessoa_nome: nome,
            tipo_parte: tipo
        };
        
        // Verificar se está no modo cadastro ou edição
        const modoEdicao = poloAtualEdicao !== null;
        const gerenciador = modoEdicao ? gerenciadorPartesEdicao : gerenciadorPartes;
        const polo = modoEdicao ? poloAtualEdicao : poloAtual;
        
        if (polo === 'ativo') {
            gerenciador.adicionarParteAtivo(dadosParte);
            fecharModalAdicionarParte();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        } else {
            // Verificar conflito de interesses antes de adicionar parte passiva
            await verificarConflitoEAdicionar(dadosParte, gerenciador);
        }
    }

    // Alias para compatibilidade com HTML que chama adicionarParteFormulario()
    const adicionarParteFormulario = adicionarParte;

    // ============================================
    // CONFLITO DE INTERESSES
    // ============================================
    async function verificarConflitoEAdicionar(dadosParte, gerenciador) {
        const token = localStorage.getItem('token');
        try {
            const res = await fetch('/api/processos/verificar-conflito', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    nome:           dadosParte.pessoa_nome,
                    documento:      null,
                    polo_verificar: 'passivo'
                })
            });
            const data = await res.json();

            if (data.conflito) {
                exibirAlertaConflito(data.processos, dadosParte, gerenciador);
            } else {
                gerenciador.adicionarPartePassivo(dadosParte);
                fecharModalAdicionarParte();
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        } catch (_) {
            // Em caso de erro de rede, não bloquear — adicionar normalmente
            gerenciador.adicionarPartePassivo(dadosParte);
            fecharModalAdicionarParte();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }

    function verProcessoConflito(id) {
        document.getElementById('modalConflito').style.display = 'none';
        abrirDetalhesProcesso(id);
    }
    window.verProcessoConflito = verProcessoConflito;

    function exibirAlertaConflito(processos, dadosParte, gerenciador) {
        const lista = processos.map(p =>
            `<li style="margin-bottom:6px;">
                <strong>${p.numero || 'Nº não informado'}</strong>
                ${p.cliente ? ` — cliente: <em>${p.cliente}</em>` : ''}
                ${p.esfera  ? ` (${p.esfera})` : ''}
                <a href="javascript:void(0)"
                   data-action="verProcessoConflito" data-args='[${p.id}]'
                   style="color:#1e3a8a;font-weight:600;margin-left:6px;text-decoration:underline;">
                   Ver →
                </a>
            </li>`
        ).join('');

        document.getElementById('conflitoLista').innerHTML = `<ul style="padding-left:18px;margin:0;">${lista}</ul>`;
        document.getElementById('modalConflito').style.display = 'flex';

        document.getElementById('btnConflitoIgnorar').onclick = () => {
            document.getElementById('modalConflito').style.display = 'none';
            gerenciador.adicionarPartePassivo(dadosParte);
            fecharModalAdicionarParte();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        };
        document.getElementById('btnConflitoCancelar').onclick = () => {
            document.getElementById('modalConflito').style.display = 'none';
        };
    }

    // ============================================
    // EDIÇÃO DE PROCESSO
    // ============================================
    const tribunaisPorEsfera = {
        'Estadual': ['TJAC', 'TJAL', 'TJAP', 'TJAM', 'TJBA', 'TJCE', 'TJDF', 'TJES', 'TJGO', 'TJMA', 'TJMT', 'TJMS', 'TJMG', 'TJPA', 'TJPB', 'TJPR', 'TJPE', 'TJPI', 'TJRJ', 'TJRN', 'TJRS', 'TJRO', 'TJRR', 'TJSC', 'TJSP', 'TJSE', 'TJTO'],
        'Federal': ['TRF1', 'TRF2', 'TRF3', 'TRF4', 'TRF5', 'TRF6'],
        'Trabalhista': ['TRT1', 'TRT2', 'TRT3', 'TRT4', 'TRT5', 'TRT6', 'TRT7', 'TRT8', 'TRT9', 'TRT10', 'TRT11', 'TRT12', 'TRT13', 'TRT14', 'TRT15', 'TRT16', 'TRT17', 'TRT18', 'TRT19', 'TRT20', 'TRT21', 'TRT22', 'TRT23', 'TRT24'],
        'Eleitoral': ['TRE-AC', 'TRE-AL', 'TRE-AP', 'TRE-AM', 'TRE-BA', 'TRE-CE', 'TRE-DF', 'TRE-ES', 'TRE-GO', 'TRE-MA', 'TRE-MT', 'TRE-MS', 'TRE-MG', 'TRE-PA', 'TRE-PB', 'TRE-PR', 'TRE-PE', 'TRE-PI', 'TRE-RJ', 'TRE-RN', 'TRE-RS', 'TRE-RO', 'TRE-RR', 'TRE-SC', 'TRE-SP', 'TRE-SE', 'TRE-TO', 'TSE'],
        'Militar': ['TJMSP', 'TJMMG', 'TJMRS', 'STM']
    };

    function atualizarTribunaisEdicao() {
        const esfera = document.getElementById('processoEditEsfera').value;
        const selectTribunal = document.getElementById('processoEditTribunal');
        
        selectTribunal.innerHTML = '<option value="">Selecione um tribunal</option>';
        
        if (esfera && tribunaisPorEsfera[esfera]) {
            tribunaisPorEsfera[esfera].forEach(tribunal => {
                const opt = document.createElement('option');
                opt.value = tribunal;
                opt.textContent = tribunal;
                selectTribunal.appendChild(opt);
            });
        }
    }

    // Função para atualizar tribunais no modal de CADASTRO de novo processo
    function atualizarTribunais() {
        const esfera = document.getElementById('esfera').value;
        const selectTribunal = document.getElementById('tribunal');
        
        selectTribunal.innerHTML = '<option value="">Selecione um tribunal</option>';
        
        if (esfera && tribunaisPorEsfera[esfera]) {
            tribunaisPorEsfera[esfera].forEach(tribunal => {
                const opt = document.createElement('option');
                opt.value = tribunal;
                opt.textContent = tribunal;
                selectTribunal.appendChild(opt);
            });
            console.log(`✅ ${tribunaisPorEsfera[esfera].length} tribunais carregados para ${esfera}`);
        } else {
            selectTribunal.innerHTML = '<option value="">Selecione a esfera primeiro</option>';
        }
    }

async function editarProcesso(id) {
    console.log('🔍 Abrindo edição do processo:', id);
    
    const processo = todosProcessos.find(p => p.id === id);
    if (!processo) {
        alert('❌ Processo não encontrado na lista local');
        return;
    }

    console.log('📄 Dados do processo:', processo);

    // ✅ Preencher campos básicos
    document.getElementById('processoEditId').value = processo.id;
    document.getElementById('processoEditNumero').value = processo.numero;
    
    // ✅ Preencher esfera primeiro
    const esferaSelect = document.getElementById('processoEditEsfera');
    esferaSelect.value = processo.esfera || '';
    console.log('✅ Esfera preenchida:', esferaSelect.value);

    // ✅ Atualizar tribunais baseado na esfera e aguardar
    await atualizarTribunaisEdicao();
    
    // ✅ Aguardar um pouco para o DOM atualizar
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // ✅ Preencher tribunal
    const tribunalSelect = document.getElementById('processoEditTribunal');
    tribunalSelect.value = processo.tribunal || '';
    console.log('✅ Tribunal preenchido:', tribunalSelect.value);

    // ✅ Preencher instância
    const instanciaSelect = document.getElementById('processoEditInstancia');
    instanciaSelect.value = processo.instancia || '';
    console.log('✅ Instância preenchida:', instanciaSelect.value);

    // ✅ Preencher UF
    const ufSelect = document.getElementById('processoEditUF');
    ufSelect.value = processo.uf || '';
    console.log('✅ UF preenchida:', ufSelect.value);

    // ✅ Inicializar gerenciador de partes para edição
    if (!window.GerenciadorPartes) {
        console.error('❌ Classe GerenciadorPartes não encontrada!');
        alert('❌ Erro: Sistema de partes não carregado. Recarregue a página.');
        return;
    }

    gerenciadorPartesEdicao = new GerenciadorPartes('listaPartesAtivoEdicao', 'listaPartesPassivoEdicao', 'gerenciadorPartesEdicao');
    gerenciadorPartesEdicao.contadorAtivoId = 'contadorAtivoEdicao';
    gerenciadorPartesEdicao.contadorPassivoId = 'contadorPassivoEdicao';

    console.log('✅ Gerenciador de partes inicializado');

    // ✅ CARREGAR PARTES - Tentar API primeiro, depois usar fallback
    let partesCarregadas = false;

    // Tentativa 1: Buscar via API (se disponível)
    try {
        const token = localStorage.getItem('token');
        const resPartes = await fetch(`/api/processos/${id}/partes`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (resPartes.ok) {
            const dados = await resPartes.json();
            console.log('✅ Resposta da API de partes:', dados);
            
            let partesAtivas = [];
            let partesPassivas = [];
            
            // Suportar diferentes formatos de resposta
            if (dados.partesOrganizadas) {
                partesAtivas = dados.partesOrganizadas.ativo || [];
                partesPassivas = dados.partesOrganizadas.passivo || [];
            } else if (dados.partes) {
                partesAtivas = dados.partes.filter(p => p.polo === 'ativo');
                partesPassivas = dados.partes.filter(p => p.polo === 'passivo');
            } else if (Array.isArray(dados)) {
                partesAtivas = dados.filter(p => p.polo === 'ativo');
                partesPassivas = dados.filter(p => p.polo === 'passivo');
            }
            
            // Adicionar partes do polo ativo
            if (partesAtivas.length > 0) {
                partesAtivas.forEach((p, index) => {
                    gerenciadorPartesEdicao.adicionarParteAtivo({
                        pessoa_id: p.pessoa_id,
                        pessoa_nome: p.pessoa_nome,
                        tipo_parte: p.tipo_parte,
                        eh_principal: p.eh_principal || index === 0
                    });
                });
                console.log(`✅ ${partesAtivas.length} parte(s) ativa(s) carregada(s) da API`);
                partesCarregadas = true;
            }

            // Adicionar partes do polo passivo
            if (partesPassivas.length > 0) {
                partesPassivas.forEach((p, index) => {
                    gerenciadorPartesEdicao.adicionarPartePassivo({
                        pessoa_id: p.pessoa_id,
                        pessoa_nome: p.pessoa_nome,
                        tipo_parte: p.tipo_parte,
                        eh_principal: p.eh_principal || index === 0
                    });
                });
                console.log(`✅ ${partesPassivas.length} parte(s) passiva(s) carregada(s) da API`);
                partesCarregadas = true;
            }
        }
    } catch (err) {
        console.warn('⚠️ API de partes não disponível:', err.message);
    }

    // Tentativa 2: FALLBACK - Usar dados do cache do processo (campos legados)
    if (!partesCarregadas) {
        console.log('📦 API não retornou partes, usando dados dos campos legados do processo');
        
        // Adicionar cliente como parte ativa
        if (processo.cliente && processo.cliente.trim()) {
            gerenciadorPartesEdicao.adicionarParteAtivo({
                pessoa_id: processo.cliente_id || null,
                pessoa_nome: processo.cliente,
                tipo_parte: 'autor',
                eh_principal: true
            });
            console.log('✅ Cliente adicionado do cache:', processo.cliente);
            partesCarregadas = true;
        }
        
        // Adicionar parte contrária como parte passiva
        if (processo.parte_contraria && processo.parte_contraria.trim()) {
            gerenciadorPartesEdicao.adicionarPartePassivo({
                pessoa_id: null,
                pessoa_nome: processo.parte_contraria,
                tipo_parte: 'reu',
                eh_principal: true
            });
            console.log('✅ Parte contrária adicionada do cache:', processo.parte_contraria);
            partesCarregadas = true;
        }
    }

    // Verificação final
    const temPartesAtivo = gerenciadorPartesEdicao.partesAtivo.length > 0;
    const temPartesPassivo = gerenciadorPartesEdicao.partesPassivo.length > 0;
    
    if (!temPartesAtivo || !temPartesPassivo) {
        console.warn('⚠️ Nenhuma parte foi carregada! Adicionando partes vazias para edição.');
        alert('⚠️ Aviso: Não foi possível carregar as partes deste processo.\nVocê pode adicionar partes manualmente.');
    } else {
        console.log(`✅ Partes carregadas com sucesso! Ativo: ${gerenciadorPartesEdicao.partesAtivo.length}, Passivo: ${gerenciadorPartesEdicao.partesPassivo.length}`);
    }

    // ✅ Mostrar modal
    document.getElementById('modalEditarProcesso').style.display = 'flex';
    console.log('✅ Modal de edição exibido');
    
    // ✅ Atualizar ícones Lucide
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // ✅ Log final de confirmação
    console.log('📊 Estado final da edição:', {
        processo_id: processo.id,
        esfera: esferaSelect.value,
        tribunal: tribunalSelect.value,
        instancia: instanciaSelect.value,
        uf: ufSelect.value,
        partes_ativo: gerenciadorPartesEdicao.partesAtivo.length,
        partes_passivo: gerenciadorPartesEdicao.partesPassivo.length
    });
}

/**
 * FUNÇÃO CORRIGIDA: Salvar Edição do Processo
 * Envia os dados atualizados para o backend
 */
async function salvarEdicaoProcesso() {
    const id = document.getElementById('processoEditId').value;
    const esfera = document.getElementById('processoEditEsfera').value;
    const tribunal = document.getElementById('processoEditTribunal').value;
    const instancia = document.getElementById('processoEditInstancia').value;
    const uf = document.getElementById('processoEditUF').value;

    console.log('📝 Valores dos campos:', { id, esfera, tribunal, instancia, uf });

    // Validações básicas
    if (!esfera || !tribunal || !instancia || !uf) {
        alert('⚠️ Preencha todos os campos obrigatórios (Esfera, Tribunal, Instância e UF)');
        return;
    }

    // ✨ Validar partes
    if (!gerenciadorPartesEdicao) {
        alert('❌ Erro: Gerenciador de partes não inicializado');
        return;
    }

    const validacao = gerenciadorPartesEdicao.validar();
    if (!validacao.valido) {
        alert('⚠️ ' + validacao.mensagem);
        return;
    }

    const dadosPartes = gerenciadorPartesEdicao.obterDados();
    
    // Montar payload
    const payload = {
        esfera: esfera,
        tribunal: tribunal,
        instancia: instancia,
        uf: uf,
        partes: {
            ativo: dadosPartes.ativo,
            passivo: dadosPartes.passivo
        }
    };
    
    console.log('📤 Payload completo a ser enviado:', JSON.stringify(payload, null, 2));

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/processos/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        console.log('📊 Status da resposta:', res.status, res.statusText);

        if (!res.ok) {
            const errorText = await res.text();
            console.error('❌ Resposta de erro (texto bruto):', errorText);
            
            try {
                const err = JSON.parse(errorText);
                console.error('❌ Erro parseado:', err);
                alert('❌ Erro ao atualizar: ' + (err.erro || err.error || err.message || 'Erro desconhecido'));
            } catch (parseError) {
                alert('❌ Erro ao atualizar processo. Detalhes no console.');
            }
            return;
        }

        const resultado = await res.json();
        console.log('✅ Processo atualizado:', resultado);
        
        alert('✅ Processo atualizado com sucesso!');
        fecharModalEdicaoProcesso();
        await carregarProcessos();
        
    } catch (err) {
        console.error('❌ Erro de rede/conexão:', err);
        alert('❌ Erro de conexão: ' + err.message);
    }
}

/**
 * Fechar modal de edição e limpar dados
 */
function fecharModalEdicaoProcesso() {
    document.getElementById('modalEditarProcesso').style.display = 'none';
    
    // Limpar gerenciador
    if (gerenciadorPartesEdicao) {
        gerenciadorPartesEdicao.limpar();
        gerenciadorPartesEdicao = null;
    }
}

/**
 * Função auxiliar para atualizar tribunais no modal de edição
 */
async function atualizarTribunaisEdicao() {
    const esfera = document.getElementById('processoEditEsfera').value;
    const selectTribunal = document.getElementById('processoEditTribunal');
    
    console.log('🔄 Atualizando tribunais para esfera:', esfera);
    
    // Limpar opções
    selectTribunal.innerHTML = '<option value="">Selecione...</option>';
    
    if (!esfera) {
        selectTribunal.innerHTML = '<option value="">Selecione a esfera primeiro</option>';
        selectTribunal.disabled = true;
        return;
    }
    
    selectTribunal.disabled = false;
    
    // Obter tribunais da esfera
    const tribunais = obterTribunaisPorEsfera(esfera);
    
    tribunais.forEach(tribunal => {
        const option = document.createElement('option');
        option.value = tribunal;
        option.textContent = tribunal;
        selectTribunal.appendChild(option);
    });
    
    console.log(`✅ ${tribunais.length} tribunais carregados`);
}

/**
 * Obter lista de tribunais por esfera
 */
function obterTribunaisPorEsfera(esfera) {
    const tribunaisPorEsfera = {
        'Estadual': [
            'TJAC', 'TJAL', 'TJAM', 'TJAP', 'TJBA', 'TJCE', 'TJDF', 'TJES',
            'TJGO', 'TJMA', 'TJMT', 'TJMS', 'TJMG', 'TJPA', 'TJPB', 'TJPR',
            'TJPE', 'TJPI', 'TJRJ', 'TJRN', 'TJRS', 'TJRO', 'TJRR', 'TJSC',
            'TJSP', 'TJSE', 'TJTO'
        ],
        'Federal': [
            'TRF1', 'TRF2', 'TRF3', 'TRF4', 'TRF5', 'TRF6',
            'STJ', 'STF'
        ],
        'Trabalhista': [
            'TRT1', 'TRT2', 'TRT3', 'TRT4', 'TRT5', 'TRT6', 'TRT7', 'TRT8',
            'TRT9', 'TRT10', 'TRT11', 'TRT12', 'TRT13', 'TRT14', 'TRT15',
            'TRT16', 'TRT17', 'TRT18', 'TRT19', 'TRT20', 'TRT21', 'TRT22',
            'TRT23', 'TRT24', 'TST'
        ],
        'Eleitoral': [
            'TRE-AC', 'TRE-AL', 'TRE-AP', 'TRE-AM', 'TRE-BA', 'TRE-CE', 'TRE-DF',
            'TRE-ES', 'TRE-GO', 'TRE-MA', 'TRE-MT', 'TRE-MS', 'TRE-MG', 'TRE-PA',
            'TRE-PB', 'TRE-PR', 'TRE-PE', 'TRE-PI', 'TRE-RJ', 'TRE-RN', 'TRE-RS',
            'TRE-RO', 'TRE-RR', 'TRE-SC', 'TRE-SP', 'TRE-SE', 'TRE-TO', 'TSE'
        ],
        'Militar': [
            'TJMSP', 'TJMMG', 'TJMRS', 'STM'
        ]
    };
    
    return tribunaisPorEsfera[esfera] || [];
}

    // ============================================
    // AÇÕES DE PROCESSO
    // ============================================
    function irParaDocumentos(id) {
        window.location.href = '/documentos-page?processo_id=' + id;
    }
    window.irParaDocumentos = irParaDocumentos;

    async function arquivarProcesso(id) {
        if (!confirm("Deseja mover este processo para os Arquivados?")) return;
        try {
            const res = await fetch(`/api/processos/${id}/arquivar`, { 
                method: 'PATCH', 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            if (res.ok) {
                alert("Processo arquivado!");
                await carregarProcessos(); 
            } else {
                alert("Erro ao arquivar.");
            }
        } catch (err) { 
            alert("Erro ao arquivar."); 
        }
    }

    async function desarquivarProcesso(id) {
        if (!confirm("Deseja retornar este processo para a lista de Ativos?")) return;
        try {
            const res = await fetch(`/api/processos/${id}/desarquivar`, { 
                method: 'PATCH', 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            if (res.ok) {
                alert("✅ Processo reativado com sucesso!");
                await carregarProcessos(); 
            } else {
                alert("Erro ao reativar processo.");
            }
        } catch (err) {
            console.error(err);
            alert("Erro na comunicação com o servidor.");
        }
    }

    async function alternarStatusProcesso(id, statusAtual) {
        const novoStatus = statusAtual === 'ATIVO' ? 'INATIVO' : 'ATIVO';
        const mensagem = novoStatus === 'INATIVO' 
            ? 'Deseja marcar este processo como INATIVO? Ele ainda estará na aba Ativos mas será contado separadamente.' 
            : 'Deseja reativar este processo?';
        
        if (!confirm(mensagem)) return;
        
        // Atualizar o processo localmente (front-end apenas)
        const processoIndex = todosProcessos.findIndex(p => p.id === id);
        if (processoIndex !== -1) {
            // Adicionar propriedade temporária para controlar status de atividade
            todosProcessos[processoIndex].status_atividade = novoStatus;
            console.log(`✅ Processo ${id} atualizado para ${novoStatus}`, todosProcessos[processoIndex]);
        }
        
        // Re-renderizar a tabela e atualizar métricas
        renderizarTabela(todosProcessos);
        atualizarMetricas();
        
        // TODO: Adicionar endpoint no backend para salvar status_atividade
        console.log(`Processo ${id} marcado como ${novoStatus} (apenas front-end por enquanto)`);
    }

    async function excluirProcesso(id) {
        if (!confirm("Deseja enviar para a Lixeira de Auditoria?")) return;
        try {
            const res = await fetch(`/api/processos/${id}/excluir`, { 
                method: 'PATCH', 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            if (res.ok) {
                alert("Processo excluído!");
                await carregarProcessos();
            }
        } catch (err) { 
            alert("Erro ao excluir."); 
        }
    }

    // ============================================
    // FILTROS
    // ============================================
    function filtrarRegiao(regiao, elemento) {
        document.querySelectorAll('#region-filter .btn-filter').forEach(btn => btn.classList.remove('active'));
        elemento.classList.add('active');
        const stateFilterDiv = document.getElementById('state-filter');
        const stateButtonsDiv = document.getElementById('state-buttons');

        if (regiao === 'TODOS') {
            stateFilterDiv.style.display = 'none';
            carregarProcessos(1, termoBuscaProcessos, '');
            return;
        }

        // Monta botões de estado da região
        stateFilterDiv.style.display = 'flex';
        stateButtonsDiv.innerHTML = '';
        regioesMap[regiao].forEach(uf => {
            const btn = document.createElement('button');
            btn.className = 'btn-filter';
            btn.innerText = uf;
            btn.onclick = () => filtrarPorEstado(uf, btn);
            stateButtonsDiv.appendChild(btn);
        });

        const ufsRegiao = regioesMap[regiao].join(',');
        carregarProcessos(1, termoBuscaProcessos, ufsRegiao);
    }

    function filtrarPorEstado(uf, elemento) {
        document.querySelectorAll('#state-buttons .btn-filter').forEach(btn => btn.classList.remove('active'));
        elemento.classList.add('active');
        // Filtra pelo estado específico no backend
        carregarProcessos(1, termoBuscaProcessos, uf);
    }

    // ============================================
    // UTILIDADES
    // ============================================
    function mascaraCNJ(i) {
        let v = i.value.replace(/\D/g, "");
        if (v.length > 7) v = v.replace(/^(\d{7})(\d)/, "$1-$2");
        if (v.length > 9) v = v.replace(/^(\d{7})-(\d{2})(\d)/, "$1-$2.$3");
        if (v.length > 13) v = v.replace(/^(\d{7})-(\d{2})\.(\d{4})(\d)/, "$1-$2.$3.$4");
        if (v.length > 14) v = v.replace(/^(\d{7})-(\d{2})\.(\d{4})\.(\d{1})(\d)/, "$1-$2.$3.$4.$5");
        if (v.length > 16) v = v.replace(/^(\d{7})-(\d{2})\.(\d{4})\.(\d{1})\.(\d{2})(\d)/, "$1-$2.$3.$4.$5.$6");
        i.value = v;
    }

    function formatarEsfera(valor) {
        if (!valor || valor === 'null' || valor === 'desconhecida') return 'Desconhecida';
        const mapa = {
            estadual: 'Justiça Estadual',
            federal: 'Justiça Federal',
            trabalho: 'Justiça do Trabalho',
            eleitoral: 'Justiça Eleitoral',
            superior: 'Tribunais Superiores'
        };
        return mapa[valor.toLowerCase()] || valor.charAt(0).toUpperCase() + valor.slice(1);
    }

    function formatarTribunal(valor) {
        if (!valor || valor === 'null' || valor === 'desconhecido') return 'Desconhecido';
        if (valor.startsWith('TRF')) return `TRF-${valor.slice(3)}`;
        if (valor.startsWith('TJ')) return `TJ-${valor.slice(2)}`;
        return valor;
    }

    function formatarInstancia(valor) {
        if (!valor) return '1º Grau';
        const mapa = {
            'JUIZADO': 'Juizado Especial',
            '1º GRAU': '1º Grau',
            '2º GRAU': '2º Grau',
            'SUPERIOR': 'Superior',
            'SUPREMO': 'Supremo'
        };
        return mapa[valor] || valor;
    }

    function toggleUserMenu() {
        const m = document.getElementById('userDropdown');
        m.style.display = m.style.display === 'none' ? 'block' : 'none';
    }

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
    // EVENTOS GLOBAIS
    // ============================================
    window.onclick = (e) => {
        if (!e.target.closest('#userCircle') && !e.target.closest('#userDropdown')) {
            const m = document.getElementById('userDropdown');
            if(m) m.style.display = 'none';
        }
        
        const modalEdit = document.getElementById('modalEditarProcesso');
        if (e.target === modalEdit) {
            fecharModalEdicaoProcesso();
        }
    };

    // ============================================
    // INICIALIZAÇÃO AUTOMÁTICA
    // ============================================
    document.addEventListener('DOMContentLoaded', () => {
        console.log('📄 DOM carregado');

        // Verificar se IMask foi carregado
        if (typeof IMask !== 'undefined') {
            console.log('✅ IMask carregado com sucesso');
        } else {
            console.error('❌ IMask não foi carregado!');
        }

        // Listeners para inputs/selects que não usam data-action
        const searchInput = document.getElementById('searchProcessos');
        if (searchInput) searchInput.addEventListener('input', filtrarProcessosTabela);

        const esferaSelect = document.getElementById('esfera');
        if (esferaSelect) esferaSelect.addEventListener('change', atualizarTribunais);

        const esferaEditSelect = document.getElementById('processoEditEsfera');
        if (esferaEditSelect) esferaEditSelect.addEventListener('change', atualizarTribunaisEdicao);

        const clienteSelectEl = document.getElementById('clienteSelect');
        if (clienteSelectEl) clienteSelectEl.addEventListener('change', function() { preencherDadosCliente(this.value); });

        const andTipoSelect = document.getElementById('andTipo');
        if (andTipoSelect) andTipoSelect.addEventListener('change', function() { toggleAndTipoCustom(this.value); });

        const formAdicionarParte = document.getElementById('formAdicionarParte');
        if (formAdicionarParte) formAdicionarParte.addEventListener('submit', function(e) {
            e.preventDefault();
            adicionarParteFormulario();
        });

        const formAndamento = document.getElementById('formAndamento');
        if (formAndamento) formAndamento.addEventListener('submit', function(e) {
            registrarAndamento(e);
        });

        setTimeout(() => {
            inicializar();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }, 100);

        // Registrar handlers de delegation para GerenciadorPartes (instâncias dinâmicas)
        // O sistema de delegation chama window[fn], então precisamos registrar proxies
        // para cada instância. Como os instanceName são fixos ('gerenciadorPartes' e
        // 'gerenciadorPartesEdicao'), registramos funções com prefixo do instanceName.
        const _gerenciadorProxies = ['gerenciadorPartes', 'gerenciadorPartesEdicao'];
        _gerenciadorProxies.forEach(function(name) {
            window[name + '_removerParteAtivo'] = function(id) {
                const g = window[name];
                if (g) g.removerParteAtivo(id);
            };
            window[name + '_removerPartePassivo'] = function(id) {
                const g = window[name];
                if (g) g.removerPartePassivo(id);
            };
            window[name + '_definirPrincipalAtivo'] = function(id) {
                const g = window[name];
                if (g) g.definirPrincipalAtivo(id);
            };
            window[name + '_definirPrincipalPassivo'] = function(id) {
                const g = window[name];
                if (g) g.definirPrincipalPassivo(id);
            };
        });
    });

    window.onload = () => {
        console.log('🌐 Window carregado');
        inicializar();
    };

    function toggleIaMenu(event) {
    event.preventDefault(); // impede navegação imediata
    const submenu = document.getElementById('submenu-ia');
    submenu.classList.toggle('open');
}

    function toggleIaMenuLink(el) {
        // el é o elemento passado pelo sistema de delegation
        const submenu = document.getElementById('submenu-ia');
        if (submenu) submenu.classList.toggle('open');
    }
    window.toggleIaMenuLink = toggleIaMenuLink;

        function aplicarPermissoesRoleUI(role) {
            if (role === 'admin') return;
            const s = document.createElement('style');
            if (role === 'operador') {
                s.textContent = 'button[data-action="excluirProcesso"] { display: none !important; }';
            } else {
                s.textContent = 'button[data-action="abrirModalProcesso"], button[data-action="excluirProcesso"], .btn-arquivar, .btn-desarquivar { display: none !important; }';
            }
            document.head.appendChild(s);
        }


(function(){var t=localStorage.getItem('token');if(!t)return;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){return r.json()}).then(function(d){if(d.ok){var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}}).catch(function(){})}checkChat();setInterval(checkChat,30000)})();


    // ── Andamentos Processuais ───────────────────────────────────────────────────
    (function() {
        const TIPO_META = {
            distribuicao: { label: 'Distribuição',      cor: '#0ea5e9' },
            despacho:     { label: 'Despacho',          cor: '#64748b' },
            decisao:      { label: 'Decisão',           cor: '#3b82f6' },
            sentenca:     { label: 'Sentença',          cor: '#7c3aed' },
            acordao:      { label: 'Acórdão',           cor: '#6366f1' },
            peticao:      { label: 'Petição',           cor: '#16a34a' },
            audiencia:    { label: 'Audiência',         cor: '#f97316' },
            recurso:      { label: 'Recurso',           cor: '#ca8a04' },
            citacao:      { label: 'Citação/Intimação', cor: '#0d9488' },
            certidao:     { label: 'Certidão',          cor: '#a855f7' },
            contestacao:  { label: 'Contestação',       cor: '#f43f5e' },
            alvara:       { label: 'Alvará',            cor: '#10b981' },
            arquivamento: { label: 'Arquivamento',      cor: '#78716c' },
            outros:       { label: 'Outros',            cor: '#94a3b8' }
        };
        function tipoMeta(tipo) {
            if (!tipo) return TIPO_META.outros;
            return TIPO_META[tipo] || { label: tipo, cor: '#94a3b8' };
        }
        window.toggleAndTipoCustom = function(val) {
            const inp = document.getElementById('andTipoCustom');
            if (val === '__custom__') {
                inp.style.display = 'block';
                inp.focus();
            } else {
                inp.style.display = 'none';
                inp.value = '';
            }
        };

        let _andProcessoId = null;
        let _andEditandoId = null;
        let _andamentosList = [];
        let _userRole = null;

        function getUserRole() {
            if (_userRole) return _userRole;
            try {
                const token = localStorage.getItem('token');
                if (!token) return 'visualizador';
                const payload = JSON.parse(atob(token.split('.')[1]));
                _userRole = payload.role || 'visualizador';
            } catch (e) { _userRole = 'visualizador'; }
            return _userRole;
        }

        window.abrirAndamentos = function(processoId, numero) {
            _andProcessoId = processoId;
            document.getElementById('andamentosNumeroProcesso').textContent = numero || '';
            document.getElementById('andamentosLista').innerHTML = '<div style="color:#94a3b8;font-size:13px;">Carregando...</div>';
            // Pré-preenche data com hoje
            const hoje = new Date().toISOString().slice(0, 10);
            document.getElementById('andDataAndamento').value = hoje;
            document.getElementById('andTitulo').value = '';
            document.getElementById('andDescricao').value = '';
            document.getElementById('andTipo').value = 'distribuicao';
            document.getElementById('andTipoCustom').value = '';
            document.getElementById('andTipoCustom').style.display = 'none';
            document.getElementById('andVisivelCliente').checked = false;

            const modal = document.getElementById('modalAndamentos');
            modal.style.display = 'flex';
            setTimeout(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); }, 50);
            carregarAndamentos(processoId);
        };

        window.fecharAndamentos = function() {
            document.getElementById('modalAndamentos').style.display = 'none';
            _andProcessoId = null;
            if (_andEditandoId) cancelarEdicaoAndamento();
        };

        window.carregarAndamentos = function(processoId) {
            const token = localStorage.getItem('token');
            fetch('/api/processos/' + processoId + '/andamentos', {
                headers: { Authorization: 'Bearer ' + token }
            })
            .then(r => r.json())
            .then(data => {
                renderAndamentos(data.andamentos || []);
            })
            .catch(() => {
                document.getElementById('andamentosLista').innerHTML =
                    '<div style="color:#ef4444;font-size:13px;">Erro ao carregar andamentos.</div>';
            });
        };

        function renderAndamentos(lista) {
            _andamentosList = lista;
            const container = document.getElementById('andamentosLista');
            const role = getUserRole();
            if (!lista.length) {
                container.innerHTML = '<div style="color:#94a3b8;font-size:13px;text-align:center;padding:24px 0;">Nenhum andamento registrado.</div>';
                return;
            }
            container.innerHTML = lista.map(a => {
                const meta = tipoMeta(a.tipo);
                const _dataStr = a.data_andamento ? String(a.data_andamento).slice(0, 10) : null;
                const dataFmt = _dataStr
                    ? new Date(_dataStr + 'T12:00:00').toLocaleDateString('pt-BR')
                    : '—';
                const podeEditar = (role === 'admin' || role === 'operador');
                const podeExcluir = (role === 'admin');
                return `
                <div style="display:flex;gap:12px;margin-bottom:18px;align-items:flex-start;">
                    <div style="flex-shrink:0;margin-top:3px;">
                        <div style="width:10px;height:10px;border-radius:50%;background:${meta.cor};margin-top:4px;"></div>
                    </div>
                    <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                            <span style="font-size:11px;color:#64748b;font-weight:600;">${dataFmt}</span>
                            <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:${meta.cor}22;color:${meta.cor};font-weight:700;">${meta.label}</span>
                            ${a.visivel_cliente ? '<span style="font-size:10px;padding:1px 7px;border-radius:12px;background:#dcfce7;color:#16a34a;font-weight:600;">Visível cliente</span>' : ''}
                        </div>
                        <div class="and-text-livre" style="font-size:13px;font-weight:600;color:#1e293b;margin-bottom:${a.descricao ? '4px' : '0'};">${escapeHtml(a.titulo)}</div>
                        ${a.descricao ? '<div class="and-text-livre" style="font-size:12px;color:#64748b;line-height:1.5;white-space:pre-wrap;">' + escapeHtml(a.descricao) + '</div>' : ''}
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">
                            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:#64748b;">
                                <input type="checkbox" ${a.visivel_cliente ? 'checked' : ''} data-action="toggleVisivelClienteCheck" data-args='[${a.id}]'
                                    style="width:12px;height:12px;accent-color:#6366f1;">
                                Visível no Portal
                            </label>
                            <div style="display:flex;gap:4px;">
                                ${podeEditar ? `<button data-action="editarAndamento" data-args='[${a.id}]' title="Editar" style="background:none;border:none;cursor:pointer;color:#3b82f6;padding:2px;"><i data-lucide="pencil" style="width:14px;height:14px;"></i></button>` : ''}
                                ${podeExcluir ? `<button data-action="excluirAndamento" data-args='[${a.id}]' title="Excluir" style="background:none;border:none;cursor:pointer;color:#ef4444;padding:2px;"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>` : ''}
                            </div>
                        </div>
                    </div>
                </div>`;
            }).join('');
            setTimeout(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); }, 50);
        }

        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        window.registrarAndamento = function(event) {
            event.preventDefault();
            if (!_andProcessoId && !_andEditandoId) return;
            const token = localStorage.getItem('token');
            const btn = document.getElementById('btnRegistrarAndamento');
            btn.disabled = true;
            btn.textContent = 'Salvando...';

            const tipoSel = document.getElementById('andTipo').value;
            const tipoCustom = document.getElementById('andTipoCustom').value.trim();
            if (tipoSel === '__custom__' && !tipoCustom) {
                alert('Digite o tipo de movimentação.');
                btn.disabled = false;
                btn.innerHTML = _andEditandoId
                    ? '<i data-lucide="save" style="width:15px;height:15px;"></i> Salvar'
                    : '<i data-lucide="plus" style="width:15px;height:15px;"></i> Registrar';
                setTimeout(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); }, 50);
                return;
            }
            const body = {
                data_andamento: document.getElementById('andDataAndamento').value,
                tipo: tipoSel === '__custom__' ? tipoCustom : tipoSel,
                titulo: document.getElementById('andTitulo').value,
                descricao: document.getElementById('andDescricao').value,
                visivel_cliente: document.getElementById('andVisivelCliente').checked
            };

            const isEdicao = !!_andEditandoId;
            const url = isEdicao
                ? '/api/andamentos/' + _andEditandoId
                : '/api/processos/' + _andProcessoId + '/andamentos';
            const method = isEdicao ? 'PUT' : 'POST';

            fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify(body)
            })
            .then(r => r.json())
            .then(data => {
                btn.disabled = false;
                if (data.ok) {
                    cancelarEdicaoAndamento();
                    carregarAndamentos(_andProcessoId);
                } else {
                    btn.innerHTML = isEdicao
                        ? '<i data-lucide="save" style="width:15px;height:15px;"></i> Salvar'
                        : '<i data-lucide="plus" style="width:15px;height:15px;"></i> Registrar';
                    setTimeout(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); }, 50);
                    alert('Erro: ' + (data.erro || 'Falha ao salvar andamento.'));
                }
            })
            .catch(() => {
                btn.disabled = false;
                btn.innerHTML = isEdicao
                    ? '<i data-lucide="save" style="width:15px;height:15px;"></i> Salvar'
                    : '<i data-lucide="plus" style="width:15px;height:15px;"></i> Registrar';
                setTimeout(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); }, 50);
                alert('Erro de conexão. Tente novamente.');
            });
        };

        window.editarAndamento = function(id) {
            const a = _andamentosList.find(x => x.id === id);
            if (!a) return;
            _andEditandoId = id;

            // Preenche o formulário com os dados do andamento
            const dataStr = a.data_andamento ? String(a.data_andamento).slice(0, 10) : '';
            document.getElementById('andDataAndamento').value = dataStr;
            document.getElementById('andTitulo').value = a.titulo || '';
            document.getElementById('andDescricao').value = a.descricao || '';
            document.getElementById('andVisivelCliente').checked = !!a.visivel_cliente;

            // Tipo: predefinido ou personalizado
            const select = document.getElementById('andTipo');
            const tipoCustomInput = document.getElementById('andTipoCustom');
            if (TIPO_META[a.tipo]) {
                select.value = a.tipo;
                tipoCustomInput.style.display = 'none';
                tipoCustomInput.value = '';
            } else {
                select.value = '__custom__';
                tipoCustomInput.style.display = 'block';
                tipoCustomInput.value = a.tipo || '';
            }

            // Muda visual do formulário para modo edição
            document.getElementById('andFormTitulo').textContent = 'Editar Andamento';
            document.getElementById('andFormTitulo').style.color = '#3b82f6';
            const btnSalvar = document.getElementById('btnRegistrarAndamento');
            btnSalvar.innerHTML = '<i data-lucide="save" style="width:15px;height:15px;"></i> Salvar';
            btnSalvar.style.background = '#3b82f6';
            document.getElementById('btnCancelarEdicao').style.display = 'inline-flex';

            // Rola até o formulário
            document.getElementById('formAndamento').scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); }, 50);
        };

        window.cancelarEdicaoAndamento = function() {
            _andEditandoId = null;
            document.getElementById('andFormTitulo').textContent = 'Registrar Andamento';
            document.getElementById('andFormTitulo').style.color = '#64748b';
            const btnSalvar = document.getElementById('btnRegistrarAndamento');
            btnSalvar.innerHTML = '<i data-lucide="plus" style="width:15px;height:15px;"></i> Registrar';
            btnSalvar.style.background = '#6366f1';
            document.getElementById('btnCancelarEdicao').style.display = 'none';
            document.getElementById('formAndamento').reset();
            document.getElementById('andDataAndamento').value = new Date().toISOString().slice(0, 10);
            document.getElementById('andTipo').value = 'distribuicao';
            document.getElementById('andTipoCustom').style.display = 'none';
            setTimeout(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); }, 50);
        };

        window.excluirAndamento = function(id) {
            if (!confirm('Excluir este andamento? Esta ação não pode ser desfeita.')) return;
            const token = localStorage.getItem('token');
            fetch('/api/andamentos/' + id, {
                method: 'DELETE',
                headers: { Authorization: 'Bearer ' + token }
            })
            .then(r => r.json())
            .then(data => {
                if (data.ok) {
                    carregarAndamentos(_andProcessoId);
                } else {
                    alert('Erro: ' + (data.erro || 'Falha ao excluir.'));
                }
            })
            .catch(() => alert('Erro de conexão.'));
        };

        window.toggleVisivelClienteCheck = function(id, el) {
            window.toggleVisivelCliente(id, el);
        };

        window.toggleVisivelCliente = function(id, checkbox) {
            const token = localStorage.getItem('token');
            fetch('/api/andamentos/' + id + '/visivel', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ visivel_cliente: checkbox.checked })
            })
            .then(r => r.json())
            .then(data => {
                if (!data.ok) {
                    checkbox.checked = !checkbox.checked; // reverte
                    alert('Erro ao atualizar visibilidade.');
                }
            })
            .catch(() => {
                checkbox.checked = !checkbox.checked;
                alert('Erro de conexão.');
            });
        };

        // Fechar modal ao clicar fora
        document.getElementById('modalAndamentos').addEventListener('click', function(e) {
            if (e.target === this) fecharAndamentos();
        });
    })();