
        // Helper: formatar data/hora em fuso de Brasília
        function formatarDataBR(dateStr) {
            if (!dateStr) return '—';
            return new Date(dateStr).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        }
        function formatarDataCurtaBR(dateStr) {
            if (!dateStr) return '—';
            return new Date(dateStr).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        }

        // Variáveis globais
        let escritoriosData = [];
        let logsData = [];

        // Verificar autenticação
        if (!API.getToken()) {
            alert('Você precisa estar logado para acessar esta página');
            window.location.href = '/login';
        }

        // Funções de UI
        function mostrarLoading() {
            document.getElementById('loadingOverlay').classList.add('active');
        }

        function esconderLoading() {
            document.getElementById('loadingOverlay').classList.remove('active');
        }

        function mostrarErro(mensagem, secao) {
            const errorDiv = document.getElementById(`errorAlert${secao}`);
            const errorMsg = document.getElementById(`errorMessage${secao}`);
            errorMsg.textContent = mensagem;
            errorDiv.classList.add('active');
            setTimeout(() => errorDiv.classList.remove('active'), 5000);
        }

        // Alternar abas
        function mostrarAba(aba) {
            const tabs = document.querySelectorAll('.tab-btn');
            const contents = document.querySelectorAll('.tab-content');
            
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            
            if (aba === 'escritorios') {
                tabs[0].classList.add('active');
                document.getElementById('secao-escritorios').classList.add('active');
                carregarDadosEscritorios();
            } else {
                tabs[1].classList.add('active');
                document.getElementById('secao-logs').classList.add('active');
                carregarLogs();
            }
        }

        // Atualizar dados
        function atualizarDados() {
            const abaAtiva = document.getElementById('secao-escritorios').classList.contains('active');
            if (abaAtiva) {
                carregarDadosEscritorios();
            } else {
                carregarLogs();
            }
        }

        // Carregar dados de escritórios
async function carregarDadosEscritorios() {
    try {
        mostrarLoading();

        // 1. Buscar estatísticas
        const statsRes = await API.get('/systems/stats');

        if (!statsRes) return; // API handles 401 redirect
        if (!statsRes.ok) throw new Error('Erro ao buscar estatísticas');
        const statsData = await statsRes.json();
        if (statsData.ok) {
            renderizarStatsEscritorios(statsData.stats);
        }

        // 2. Buscar lista de escritórios
        const escritRes = await API.get('/systems/escritorios');
        if (!escritRes.ok) throw new Error('Erro ao buscar escritórios');

        const escritData = await escritRes.json();
        if (escritData.ok) {
            escritoriosData = escritData.escritorios;
            renderizarTabelaEscritorios(escritoriosData);
            document.getElementById('count-escritorios').textContent = `${escritData.total} REGISTROS`;
        }

        // ✅ 3. Carregar o gráfico de crescimento semanal (Chamada inserida aqui)
        carregarGraficoCrescimento();

    } catch (err) {
        console.error('Erro:', err);
        mostrarErro(err.message, 'Escritorios');
    } finally {
        esconderLoading();
    }
}

function formatarOab(oab, uf) {
    const n = (oab || '').replace(/\D/g, '');
    if (!n) return '-';
    const padded = n.padStart(6, '0');
    const num = padded.length >= 6 ? `${padded.slice(0, 3)}.${padded.slice(3, 6)}` : padded;
    return uf ? `${num}/${uf}` : num;
}

function renderizarStatsEscritorios(stats) {
    // Popular cards da seção Overview
    const containerOverview = document.getElementById('stats-overview-cards');
    if (containerOverview) {
        containerOverview.innerHTML = `
        <div class="stat-card">
            <div class="stat-header">
                <div class="stat-title">Total Escritórios</div>
                <div class="stat-icon">
                    <svg viewBox="0 0 24 24"><path d="M3 21h18M9 8h1m-1 4h1m-1 4h1M15 8h1m-1 4h1m-1 4h1M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/></svg>
                </div>
            </div>
            <div class="stat-value">${stats.total_escritorios || 0}</div>
            <div class="stat-label">Cadastrados</div>
        </div>
        <div class="stat-card">
            <div class="stat-header">
                <div class="stat-title">Básico</div>
                <div class="stat-icon">
                    <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                </div>
            </div>
            <div class="stat-value">${stats.plano_basico || 0}</div>
            <div class="stat-label">Assinantes</div>
        </div>
        <div class="stat-card">
            <div class="stat-header">
                <div class="stat-title">Intermediário</div>
                <div class="stat-icon">
                    <svg viewBox="0 0 24 24"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
                </div>
            </div>
            <div class="stat-value">${stats.plano_intermediario || 0}</div>
            <div class="stat-label">Assinantes</div>
        </div>
        <div class="stat-card">
            <div class="stat-header">
                <div class="stat-title">Avançado</div>
                <div class="stat-icon">
                    <svg viewBox="0 0 24 24"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/></svg>
                </div>
            </div>
            <div class="stat-value">${stats.plano_avancado || 0}</div>
            <div class="stat-label">Assinantes</div>
        </div>
        <div class="stat-card">
            <div class="stat-header">
                <div class="stat-title">Premium</div>
                <div class="stat-icon">
                    <svg viewBox="0 0 24 24"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M3 16h18v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2z"/></svg>
                </div>
            </div>
            <div class="stat-value">${stats.plano_premium || 0}</div>
            <div class="stat-label">Assinantes</div>
        </div>
        <div class="stat-card">
            <div class="stat-header">
                <div class="stat-title">Total Processos</div>
                <div class="stat-icon">
                    <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8m8 4H8m2-8H8"/></svg>
                </div>
            </div>
            <div class="stat-value">${stats.total_processos || 0}</div>
            <div class="stat-label">No sistema</div>
        </div>
    `;
    }
    
    // Popular valores dos outros cards
    const mrrElOverview = document.getElementById('mrrValueOverview');
    if (mrrElOverview) mrrElOverview.innerText = (stats.mrr || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const churnElOverview = document.getElementById('churnRateOverview');
    if (churnElOverview) {
        const taxa = stats.total_escritorios > 0 ? ((stats.churn / stats.total_escritorios) * 100).toFixed(1) : 0;
        churnElOverview.innerText = `${taxa}%`;
    }
    
    const inadimplentesOverview = document.getElementById('totalInadimplentesOverview');
    if (inadimplentesOverview) {
        inadimplentesOverview.textContent = (stats.pendente || 0) + (stats.inadimplente || 0);
    }
    
    // ✅ UPGRADE - Popular o card
    const totalUpgradeOverview = document.getElementById('totalUpgradeOverview');
    if (totalUpgradeOverview) {
        totalUpgradeOverview.textContent = stats.no_limite || 0;
    }
}
        
function renderizarTabelaEscritorios(lista) {
    const tbody = document.getElementById('body-escritorios');
    tbody.innerHTML = '';
    
    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center p-5">Nenhum escritório encontrado.</td></tr>`;
        return;
    }
    
    lista.forEach(esc => {
        // Normalizar nome do plano (remover acentos e converter para lowercase)
        const planoRaw = (esc.plano_ativo || 'INDIVIDUAL');
        const plano = planoRaw
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, ''); // Remove acentos
        
        // 🚦 Lógica de Saúde (Health Score)
        const totalProcessos = parseInt(esc.total_processos || 0);
        const totalUsuarios = parseInt(esc.total_usuarios || 0);
        
        let statusCor = '#00d1b2'; // Verde (Saudável)
        let statusTexto = 'ATIVO';
        let alertaIcone = '';

        if (totalProcessos === 0) {
            statusCor = '#ff4757'; // Vermelho (Crítico)
            statusTexto = 'INATIVO';
            alertaIcone = '<span title="Crítico: 0 Processos" style="cursor:help;">⚠️</span>';
        } else if (totalUsuarios <= 1) {
            statusCor = '#ffa502'; // Amarelo (Alerta)
            statusTexto = 'SOLO';
        }

        tbody.innerHTML += `
            <tr style="border-left: 4px solid ${statusCor};">
                <td><small class="text-muted">${esc.id}</small></td>
                <td>
                    <div class="escritorio-info">
                        <div class="escritorio-name" style="text-transform: uppercase; font-weight: 400; letter-spacing: 0.5px; color: #fff;">
                            ${esc.nome} ${alertaIcone}
                        </div>
                        <div class="text-muted" style="font-size: 0.7rem; text-transform: uppercase;">
                            RESPONSÁVEL: ${esc.advogado_responsavel || 'NÃO INFORMADO'}
                        </div>
                    </div>
                </td>
                <td><code class="text-info" style="font-size: 0.85rem;">${formatarOab(esc.oab, esc.uf)}</code></td>
                <td><span class="badge badge-${plano}">${esc.plano_ativo || 'INDIVIDUAL'}</span></td>
                <td class="text-center">${totalUsuarios}</td>
                <td class="text-center">${totalProcessos}</td>
                <td class="text-center">${esc.total_prazos || 0}</td>
                <td><small>${esc.data_criacao ? formatarDataCurtaBR(esc.data_criacao) : '—'}</small></td>
            </tr>
        `;
    });
}

        // Carregar logs
        async function carregarLogs() {
            try {
                mostrarLoading();

                const res = await API.get('/systems/monitoramento');

                if (!res) return; // API handles 401 redirect
                if (!res.ok) throw new Error('Erro ao buscar logs');

                const data = await res.json();

                if (data.ok) {
                    logsData = data.logs;
                    renderizarTabelaLogs(logsData);
                    atualizarStatsLogs(logsData);
                    document.getElementById('count-logs').textContent = `${data.total} REGISTROS`;
                }

            } catch (err) {
                console.error('Erro:', err);
                mostrarErro(err.message, 'Logs');
            } finally {
                esconderLoading();
            }
        }

        function renderizarTabelaLogs(lista) {
            const tbody = document.getElementById('body-logs');
            tbody.innerHTML = '';
            
            if (lista.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5">
                            <div class="empty-state">
                                <div class="empty-icon">🛡️</div>
                                <div class="empty-title">Nenhum log encontrado</div>
                                <div class="empty-text">Tente ajustar os filtros</div>
                            </div>
                        </td>
                    </tr>
                `;
                return;
            }
            
            lista.forEach(log => {
                tbody.innerHTML += `
                    <tr>
                        <td style="font-size:13px">${formatarDataBR(log.criado_em)}</td>
                        <td>
                            <div class="escritorio-info">
                                <div class="escritorio-name">${log.advogado_responsavel}</div>
                                <div class="escritorio-oab">OAB: ${log.oab}</div>
                            </div>
                        </td>
                        <td><span class="badge badge-service">${log.servico}</span></td>
                        <td><span class="badge badge-error">${log.tipo_erro}</span></td>
                        <td style="font-size:13px">${log.mensagem_erro}</td>
                    </tr>
                `;
            });
        }

        function atualizarStatsLogs(logs) {
            document.getElementById('totalLogs').textContent = logs.length;
            
            const agora = new Date();
            const ontem = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
            const logs24h = logs.filter(log => new Date(log.criado_em) > ontem);
            document.getElementById('logs24h').textContent = logs24h.length;
            
            const escritorios = [...new Set(logs.map(log => log.advogado_responsavel))];
            document.getElementById('escritoriosLogs').textContent = escritorios.length;
        }

        function filtrarLogs() {
    const servico = document.getElementById('filtroServico').value;
    const erro = document.getElementById('filtroErro').value;
    const dataFiltro = document.getElementById('filtroData').value;

    let filtrados = [...logsData];

    if (servico) {
        filtrados = filtrados.filter(log => log.servico === servico);
    }

    if (erro) {
        filtrados = filtrados.filter(log => log.tipo_erro === erro);
    }

    if (dataFiltro) {
        filtrados = filtrados.filter(log => {
            const dataLog = new Date(log.criado_em).toISOString().split('T')[0];
            return dataLog === dataFiltro;
        });
    }

    renderizarTabelaLogs(filtrados);
    document.getElementById('count-logs').textContent =
        `${filtrados.length} REGISTROS`;
}

        // Filtrar escritórios
        function filtrarEscritorios() {
            const busca = document.getElementById('filtroBuscaEscritorio').value.toLowerCase();
            const plano = document.getElementById('filtroPlanoEscritorio').value;
            
            const filtrados = escritoriosData.filter(esc => {
                const nome = (esc.nome || esc.advogado_responsavel || '').toLowerCase();
                const oab = (esc.oab || '').toLowerCase();
                
                // Normalizar plano do escritório (remover acentos e maiúsculas)
                const planoEsc = (esc.plano_ativo || '')
                    .toUpperCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, ''); // Remove acentos
                
                const matchBusca = nome.includes(busca) || oab.includes(busca);
                const matchPlano = plano === '' || planoEsc === plano;
                
                return matchBusca && matchPlano;
            });
            
            renderizarTabelaEscritorios(filtrados);
            document.getElementById('count-escritorios').textContent = 
                `${filtrados.length} REGISTROS`;
        }

        // Exportar CSV
        function exportarCSV() {
            const abaEscritorios = document.getElementById('secao-escritorios').classList.contains('active');
            
            if (abaEscritorios) {
                let csv = 'ID,Nome,Advogado,OAB,Plano,Usuários,Processos,Prazos,Data Criação\n';
                
                escritoriosData.forEach(esc => {
                    csv += `${esc.id},`;
                    csv += `"${esc.nome || ''}",`;
                    csv += `"${esc.advogado_responsavel || ''}",`;
                    csv += `"${esc.oab || ''}",`;
                    csv += `"${esc.plano_ativo || ''}",`;
                    csv += `${esc.total_usuarios || 0},`;
                    csv += `${esc.total_processos || 0},`;
                    csv += `${esc.total_prazos || 0},`;
                    csv += `"${formatarDataCurtaBR(esc.data_criacao)}"\n`;
                });
                
                baixarCSV(csv, 'escritorios-lawtech.csv');
            } else {
                let csv = 'Data/Hora,Escritório,OAB,UF,Serviço,Tipo Erro,Mensagem\n';
                
                logsData.forEach(log => {
                    csv += `"${formatarDataBR(log.criado_em)}",`;
                    csv += `"${log.advogado_responsavel}",`;
                    csv += `"${log.oab}",`;
                    csv += `"${log.uf}",`;
                    csv += `"${log.servico}",`;
                    csv += `"${log.tipo_erro}",`;
                    csv += `"${log.mensagem_erro}"\n`;
                });
                
                baixarCSV(csv, 'logs-lawtech.csv');
            }
        }

        function baixarCSV(conteudo, nomeArquivo) {
            const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', nomeArquivo);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        let myChart; // Variável global para o gráfico

async function carregarGraficoCrescimento() {
    try {
        const res = await API.get('/systems/crescimento');
        const data = await res.json();

        if (data.ok) {
            const ctx = document.getElementById('growthChart').getContext('2d');
            if (myChart) myChart.destroy(); // Limpa o gráfico anterior se existir

            myChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: data.labels,
                    datasets: [{
                        label: 'Novos Escritórios',
                        data: data.valores,
                        backgroundColor: '#00d1b2', // Cor verde LawTech
                        borderRadius: 5,
                        barThickness: 20
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, ticks: { stepSize: 1, color: '#888' }, grid: { color: '#333' } },
                        x: { ticks: { color: '#888' }, grid: { display: false } }
                    }
                }
            });
        }
    } catch (err) {
        console.error('Erro ao carregar gráfico:', err);
    }
}

function filtrarSaude(tipo, botaoClicado) {
    // Remover classe active de todos os botões
    document.querySelectorAll('.btn-saude').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Adicionar classe active ao botão clicado
    if (botaoClicado) {
        botaoClicado.classList.add('active');
    }
    
    let filtrados = [...escritoriosData]; // Usa os dados originais

    if (tipo === 'critico') {
        filtrados = escritoriosData.filter(e => parseInt(e.total_processos) === 0);
    } else if (tipo === 'alerta') {
        filtrados = escritoriosData.filter(e => parseInt(e.total_processos) > 0 && parseInt(e.total_usuarios) <= 1);
    } else if (tipo === 'saudavel') {
        filtrados = escritoriosData.filter(e => parseInt(e.total_processos) > 0 && parseInt(e.total_usuarios) > 1);
    }

    renderizarTabelaEscritorios(filtrados);
    document.getElementById('count-escritorios').textContent = `${filtrados.length} EXIBIDOS`;
}

// ==========================================
// NOVAS FUNÇÕES: INADIMPLÊNCIA
// ==========================================

let inadimplentesData = [];

async function carregarInadimplentes() {
    try {
        mostrarLoading();
        console.log('🔄 Carregando inadimplentes...');
        const res = await API.get('/systems/inadimplencia');

        if (!res.ok) {
            console.error('❌ Erro HTTP:', res.status);
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        const data = await res.json();
        console.log('📊 Dados recebidos:', data);

        if (data.ok) {
            inadimplentesData = data.inadimplentes || [];
            console.log(`✅ ${inadimplentesData.length} inadimplentes encontrados`);
            renderizarTabelaInadimplentes(inadimplentesData);
            document.getElementById('count-inadimplentes').textContent = 
                `${inadimplentesData.length} REGISTROS`;
        }
    } catch (err) {
        console.error('❌ Erro ao carregar inadimplentes:', err);
        renderizarTabelaInadimplentes([]);
    } finally {
        esconderLoading();
    }
}

function renderizarTabelaInadimplentes(lista) {
    const tbody = document.getElementById('body-inadimplentes');
    tbody.innerHTML = '';
    
    if (lista.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9">
                    <div class="empty-state">
                        <div class="empty-icon">
                            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>
                        </div>
                        <div class="empty-title">Nenhuma inadimplência encontrada</div>
                        <div class="empty-text">Todos os escritórios estão em dia!</div>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    lista.forEach(item => {
        // Lógica de status melhorada
        let statusClass, statusIcon, statusTexto;

        if (item.status_pagamento === 'inadimplente') {
            statusClass = 'danger';
            statusIcon = '🔴';
            statusTexto = 'INADIMPLENTE';
        } else if (item.status_pagamento === 'trial') {
            statusClass = 'info';
            statusIcon = '🔵';
            statusTexto = 'TRIAL';
        } else if (item.status_pagamento === 'pago' || item.status_pagamento === 'ativo') {
            statusClass = 'success';
            statusIcon = '🟢';
            statusTexto = 'EM DIA';
        } else {
            statusClass = 'warning';
            statusIcon = '🟡';
            statusTexto = 'PENDENTE';
        }

        const planoInad = (item.plano_ativo || 'individual')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        tbody.innerHTML += `
            <tr>
                <td>
                    <span class="badge badge-${statusClass}">
                        ${statusIcon} ${statusTexto}
                    </span>
                </td>
                <td><strong style="text-transform: uppercase; letter-spacing: 0.5px;">${item.nome}</strong></td>
                <td><span class="badge badge-status">${formatarOab(item.oab, item.uf)}</span></td>
                <td><span class="badge badge-${planoInad}">${item.plano_ativo}</span></td>
                <td>${formatarDataCurtaBR(item.data_vencimento)}</td>
                <td><strong style="color: ${item.dias_atraso > 10 ? '#ef4444' : item.dias_atraso > 0 ? '#f59e0b' : '#10b981'}">${item.dias_atraso} dias</strong></td>
                <td>R$ ${parseFloat(item.valor_mensalidade || 0).toFixed(2)}</td>
                <td>${item.total_processos}</td>
                <td>
                    <button class="btn-action" data-action="contatarEscritorio" data-args='[${item.id}]' title="Entrar em contato">
                        📧
                    </button>
                </td>
            </tr>
        `;
    });
}

// contatarEscritorio() definida mais abaixo (versão completa com WhatsApp)

// ==========================================
// NOVAS FUNÇÕES: UPGRADE
// ==========================================

let upgradeData = [];

async function carregarUpgrade() {
    try {
        mostrarLoading();
        console.log('🔄 Carregando oportunidades de upgrade...');
        const res = await API.get('/systems/no-limite');

        if (!res.ok) {
            console.error('❌ Erro HTTP:', res.status);
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        const data = await res.json();
        console.log('📊 Dados recebidos:', data);

        if (data.ok) {
            upgradeData = data.escritorios || [];
            console.log(`✅ ${upgradeData.length} escritórios no limite encontrados`);
            renderizarTabelaUpgrade(upgradeData);
            document.getElementById('count-upgrade').textContent = 
                `${upgradeData.length} REGISTROS`;
        }
    } catch (err) {
        console.error('❌ Erro ao carregar oportunidades de upgrade:', err);
        renderizarTabelaUpgrade([]);
    } finally {
        esconderLoading();
    }
}

function renderizarTabelaUpgrade(lista) {
    const tbody = document.getElementById('body-upgrade');
    tbody.innerHTML = '';
    
    if (lista.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9">
                    <div class="empty-state">
                        <div class="empty-icon">
                            <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/></svg>
                        </div>
                        <div class="empty-title">Nenhum escritório no limite</div>
                        <div class="empty-text">Todos estão com uso confortável</div>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    lista.forEach(item => {
        const percUsuarios = parseFloat(item.percentual_usuarios || 0);
        const percPrazos = parseFloat(item.percentual_prazos || 0);
        
        const corUsuarios = percUsuarios >= 95 ? '#ef4444' : percUsuarios >= 90 ? '#f59e0b' : '#10b981';
        const corPrazos = percPrazos >= 95 ? '#ef4444' : percPrazos >= 90 ? '#f59e0b' : '#10b981';
        
        // Formatar limites - mostrar ILIMITADO se -1
        const limiteUsuariosText = item.limite_usuarios === -1 ? '∞' : item.limite_usuarios;
        const limitePrazosText = item.limite_prazos === -1 ? '∞' : item.limite_prazos;
        
        // Formatar percentuais - 0% se ilimitado
        const percUsuariosText = item.limite_usuarios === -1 ? '0.0%' : `${percUsuarios.toFixed(1)}%`;
        const percPrazosText = item.limite_prazos === -1 ? '0.0%' : `${percPrazos.toFixed(1)}%`;
        
        const planoUpg = (item.plano_ativo || 'individual')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        tbody.innerHTML += `
            <tr>
                <td><strong style="text-transform: uppercase; letter-spacing: 0.5px;">${item.nome}</strong></td>
                <td><span class="badge badge-status">${formatarOab(item.oab, item.uf)}</span></td>
                <td><span class="badge badge-${planoUpg}">${item.plano_ativo}</span></td>
                <td>${item.total_usuarios} / ${limiteUsuariosText}</td>
                <td><strong style="color: ${corUsuarios}">${percUsuariosText}</strong></td>
                <td>${item.total_prazos} / ${limitePrazosText}</td>
                <td><strong style="color: ${corPrazos}">${percPrazosText}</strong></td>
                <td>
                    <span class="badge badge-${item.recurso_limite === 'usuarios' ? 'danger' : item.recurso_limite === 'prazos' ? 'warning' : 'success'}">
                        ${item.recurso_limite.toUpperCase()}
                    </span>
                </td>
                <td>
                    <button class="btn-action" data-action="oferecerUpgrade" data-args='[${item.id}]' title="Oferecer upgrade">
                        🚀
                    </button>
                </td>
            </tr>
        `;
    });
}

// oferecerUpgrade() definida mais abaixo (versão completa com WhatsApp)

// ==========================================
// NOVAS FUNÇÕES: AUDIT LOG
// ==========================================

let auditData = [];

// ==========================================
// ATUALIZAR FUNÇÃO trocarAba
// ==========================================


// Função para trocar entre as abas
function trocarAba(aba, botaoClicado) {
    // Remover active de todos os botões e seções
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.secao-tab').forEach(sec => sec.classList.remove('active'));

    // Se botaoClicado for passado, usar ele; senão, usar mapeamento padrão
    if (botaoClicado !== undefined) {
        document.querySelectorAll('.tab-btn')[botaoClicado].classList.add('active');
    } else {
        // Mapeamento padrão para compatibilidade
        const index = {
            'overview': 0,
            'escritorios': 1,
            'inadimplencia': 2,
            'upgrade': 3,
            'logs': 4,
            'audit': 5,
            'churn': 6
        }[aba];
        
        if (index !== undefined) {
            document.querySelectorAll('.tab-btn')[index].classList.add('active');
        }
    }
    
    const secao = document.getElementById(`secao-${aba}`);
    if (secao) {
        secao.classList.add('active');
    }

    // Carregar dados da aba
    if (aba === 'overview') {
        carregarDadosEscritorios(); // Carrega estatísticas para overview
    }
    if (aba === 'escritorios') {
        carregarGraficoCrescimento();
        carregarDadosEscritorios(); // Carrega lista de escritórios
    }
    if (aba === 'inadimplencia') carregarInadimplentes();
    if (aba === 'upgrade') carregarUpgrade();
    if (aba === 'logs') carregarLogs();
    if (aba === 'audit') carregarAuditoriaFinanceira();
    if (aba === 'churn') carregarChurn();
}

// ==========================================
// ATUALIZAR atualizarDados PARA INCLUIR NOVAS ESTATÍSTICAS
// ==========================================

// Adicione ao final da função carregarDadosEscritorios (ou crie uma nova):
async function atualizarEstatisticasCompletas() {
    try {
        const res = await API.get('/systems/stats');
        
        if (!res.ok) throw new Error('Erro ao carregar estatísticas');
        const data = await res.json();
        
        if (data.ok && data.stats) {
            // 1. Atualizar Faturamento (MRR) - ID real: mrrValueOverview
            if (document.getElementById('mrrValueOverview')) {
                document.getElementById('mrrValueOverview').textContent = 
                    data.stats.mrr.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            }

            // 2. Atualizar Inadimplentes - ID real: totalInadimplentesOverview
            if (document.getElementById('totalInadimplentesOverview')) {
                document.getElementById('totalInadimplentesOverview').textContent = 
                    (data.stats.pendente || 0) + (data.stats.inadimplente || 0);
            }
            
            // 3. Atualizar Oportunidades Upgrade - ID real: totalUpgradeOverview
            if (document.getElementById('totalUpgradeOverview')) {
                document.getElementById('totalUpgradeOverview').textContent = data.stats.no_limite || 0;
            }

            // 4. Atualizar Churn - ID real: churnRateOverview
            if (document.getElementById('churnRateOverview')) {
                const taxa = data.stats.total_escritorios > 0 
                    ? ((data.stats.churn / data.stats.total_escritorios) * 100).toFixed(1) 
                    : 0;
                document.getElementById('churnRateOverview').textContent = `${taxa}%`;
            }
        }
    } catch (err) {
        console.error('❌ Erro ao atualizar estatísticas:', err);
    }
}

// ==========================================
// FUNÇÕES DE EXPORTAÇÃO
// ==========================================

function exportarInadimplencia() {
    let csv = 'Status,Escritório,OAB,Plano,Vencimento,Dias Atraso,Valor,Processos\n';
    
    inadimplentesData.forEach(item => {
        csv += `"${item.status_pagamento}",`;
        csv += `"${item.nome}",`;
        csv += `"${item.oab}",`;
        csv += `"${item.plano_ativo}",`;
        csv += `"${formatarDataCurtaBR(item.data_vencimento)}",`;
        csv += `${item.dias_atraso},`;
        csv += `${item.valor_mensalidade || 0},`;
        csv += `${item.total_processos}\n`;
    });
    
    baixarCSV(csv, 'inadimplencia-lawtech.csv');
}

function exportarUpgrade() {
    let csv = 'Escritório,OAB,Plano,Usuários,% Uso Usuários,Prazos,% Uso Prazos,Recurso Crítico\n';
    
    upgradeData.forEach(item => {
        csv += `"${item.nome}",`;
        csv += `"${item.oab}",`;
        csv += `"${item.plano_ativo}",`;
        csv += `"${item.total_usuarios}/${item.limite_usuarios}",`;
        csv += `${item.percentual_usuarios}%,`;
        csv += `"${item.total_prazos}/${item.limite_prazos}",`;
        csv += `${item.percentual_prazos}%,`;
        csv += `"${item.recurso_limite}"\n`;
    });
    
    baixarCSV(csv, 'oportunidades-upgrade-lawtech.csv');
}

function exportarAudit() {
    let csv = 'Data/Hora,Tipo,Descrição,Escritório,Usuário\n';
    
    auditData.forEach(event => {
        csv += `"${formatarDataBR(event.criado_em)}",`;
        csv += `"${event.tipo_evento}",`;
        csv += `"${event.descricao}",`;
        csv += `"${event.escritorio}",`;
        csv += `"${event.usuario}"\n`;
    });
    
    baixarCSV(csv, 'audit-log-lawtech.csv');
}

// ==========================================
// ABA: CANCELAMENTOS (CHURN)
// ==========================================

let churnData = [];

async function carregarChurn() {
    try {
        const res = await API.get('/api/admin/cancelamentos');
        if (!res.ok) throw new Error('Erro ao carregar cancelamentos');
        const data = await res.json();
        churnData = data.cancelamentos || [];
        renderizarTabelaChurn(churnData);
    } catch (err) {
        document.getElementById('body-churn').innerHTML = `
            <tr><td colspan="8" style="text-align:center;color:#ef4444;padding:24px;">
                Erro ao carregar cancelamentos: ${err.message}
            </td></tr>`;
    }
}

function renderizarTabelaChurn(lista) {
    const tbody = document.getElementById('body-churn');
    const count = document.getElementById('count-churn');
    if (count) count.textContent = `${lista.length} REGISTRO${lista.length !== 1 ? 'S' : ''}`;

    if (!lista.length) {
        tbody.innerHTML = `
            <tr><td colspan="8">
                <div class="empty-state">
                    <div class="empty-icon"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
                    <div class="empty-title">Nenhum cancelamento encontrado</div>
                    <div class="empty-text">Nenhum usuário cancelou a renovação automática</div>
                </div>
            </td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(e => {
        const oabFmt = formatarOab(e.oab, e.uf);
        const statusBadge = e.plano_financeiro_status === 'pago' || e.plano_financeiro_status === 'ativo'
            ? `<span class="badge badge-active">PAGO</span>`
            : `<span class="badge badge-trial">TRIAL</span>`;
        const cancelamentoEm = e.data_cancelamento_agendado
            ? formatarDataBR(e.data_cancelamento_agendado)
            : '<span style="color:#94a3b8">—</span>';
        const whatsappMsg = encodeURIComponent(
            `Olá, Dr(a). ${e.advogado_responsavel || 'Colega'}, tudo bem?\n\nAqui é da LawTech Pro. Notamos que você cancelou a renovação automática da sua assinatura.\n\nGostaria de entender o que aconteceu e ver se podemos ajudar. Podemos conversar?`
        );
        return `<tr>
            <td><strong>${e.nome || '—'}</strong></td>
            <td>${e.advogado_responsavel || '—'}</td>
            <td><a href="mailto:${e.email}" style="color:#6366f1">${e.email || '—'}</a></td>
            <td>${oabFmt}</td>
            <td>${e.plano_ativo || '—'}</td>
            <td>${statusBadge}</td>
            <td>${cancelamentoEm}</td>
            <td>
                <a href="https://api.whatsapp.com/send?text=${whatsappMsg}" target="_blank"
                   class="action-btn" style="background:#25d366;color:white;border:none;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap;">
                    WhatsApp
                </a>
            </td>
        </tr>`;
    }).join('');
}

function exportarChurn() {
    let csv = 'Escritório,Advogado,E-mail,OAB,Plano,Status,Cancelamento Agendado\n';
    churnData.forEach(e => {
        csv += `"${e.nome || ''}","${e.advogado_responsavel || ''}","${e.email || ''}","${formatarOab(e.oab, e.uf)}","${e.plano_ativo || ''}","${e.plano_financeiro_status || ''}","${e.data_cancelamento_agendado ? formatarDataBR(e.data_cancelamento_agendado) : ''}"\n`;
    });
    baixarCSV(csv, 'cancelamentos-lawtech.csv');
}

// Função para Oferecer Upgrade (Baseada em Uso de Limites)
function oferecerUpgrade(id) {
    const escritorio = upgradeData.find(e => e.id === id);
    if (!escritorio) return;

    const saudacao = "Olá, Dr(a). " + (escritorio.advogado_responsavel || "Colega");
    const recurso = escritorio.recurso_limite === 'usuarios' ? 'usuários' : 'prazos';
    const percentual = recurso === 'usuários' ? escritorio.percentual_usuarios : escritorio.percentual_prazos;

    const mensagem = `${saudacao}, tudo bem? 

Aqui é da LawTech Systems. Notamos que seu escritório está crescendo rápido! 🚀

Identificamos que você já atingiu ${percentual}% do seu limite de ${recurso} no plano ${escritorio.plano_ativo.toUpperCase()}. 

Para garantir que sua operação não pare e você continue aproveitando todas as nossas automações, gostaria de conhecer as condições especiais para o próximo plano?`;

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(mensagem)}`;
    window.open(url, '_blank');
}

// Função de Contato Financeiro (Com Detalhes da Fatura)
function contatarEscritorio(id) {
    const escritorio = inadimplentesData.find(e => e.id === id);
    if (!escritorio) return;

    const dataVenc = formatarDataCurtaBR(escritorio.data_vencimento);
    const valorMsg = parseFloat(escritorio.valor_mensalidade || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const mensagem = `Olá, Dr(a). ${escritorio.advogado_responsavel || "Colega"}, tudo bem?

Identificamos uma pendência financeira no sistema LawTech referente ao escritório ${escritorio.nome.toUpperCase()}.

📌 Detalhes:
- Vencimento: ${dataVenc}
- Valor: ${valorMsg}
- Atraso: ${escritorio.dias_atraso} dias

Podemos ajudar com a segunda via do boleto ou chave PIX para manter seu acesso regularizado?`;

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(mensagem)}`;
    window.open(url, '_blank');
}

async function gerarRelatorioMensal() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const dataAtual = new Date().toLocaleDateString('pt-BR');

    // Cabeçalho de Elite
    doc.setFontSize(22);
    doc.setTextColor(0, 209, 178); // Verde LawTech
    doc.text("LAWTECH SYSTEMS - RELATÓRIO EXECUTIVO", 20, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Gerado em: ${dataAtual}`, 20, 28);
    doc.line(20, 32, 190, 32);

    // Seção 1: Resumo Geral
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text("1. RESUMO DE OPERAÇÕES", 20, 45);
    
    const stats = [
    ["Total de Escritórios", escritoriosData.length],
    ["Inadimplentes", document.getElementById('totalInadimplentesOverview')?.textContent || 0],
    ["Oportunidades de Upgrade", document.getElementById('totalUpgradeOverview')?.textContent || 0]
    ];

    doc.autoTable({
        startY: 50,
        head: [['Métrica', 'Valor']],
        body: stats,
        theme: 'striped',
        headStyles: { fillStyle: [0, 209, 178] }
    });

    // Seção 2: Saúde Financeira
    doc.text("2. STATUS FINANCEIRO", 20, doc.lastAutoTable.finalY + 15);
    
    const financeiro = inadimplentesData.map(e => [
        e.nome.toUpperCase(),
        formatarDataCurtaBR(e.data_vencimento),
        `R$ ${parseFloat(e.valor_mensalidade).toFixed(2)}`,
        `${e.dias_atraso} dias`
    ]);

    doc.autoTable({
        startY: doc.lastAutoTable.finalY + 20,
        head: [['Escritório', 'Vencimento', 'Valor', 'Atraso']],
        body: financeiro.length ? financeiro : [['Tudo em dia', '-', '-', '-']],
    });

    // Rodapé
    doc.setFontSize(8);
    doc.text("Confidencial - LawTech Systems Admin", 20, 285);

    doc.save(`Relatorio_LawTech_${dataAtual.replace(/\//g, '-')}.pdf`);
}
        // Auto-refresh (2 minutos)
        setInterval(atualizarDados, 120000);

        // Inicializar
        carregarDadosEscritorios();

        let auditDataFull = [];

        async function carregarAuditoriaFinanceira() {
    try {
        const res = await API.get('/systems/audit-log');
        if (!res) return;

        const data = await res.json();
        const eventos = data.eventos || [];
        auditDataFull = eventos;
        auditData = eventos;

        renderizarTabelaAudit(eventos);

        const countEl = document.getElementById('count-audit');
        if (countEl) countEl.textContent = `${eventos.length} REGISTROS`;

    } catch (error) {
        console.error('Erro ao carregar auditoria:', error);
    }
}

function renderizarTabelaAudit(lista) {
    const tbody = document.getElementById('body-audit');
    tbody.innerHTML = '';

    if (!lista || lista.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;padding:40px;">
                    Nenhum evento registrado.
                </td>
            </tr>
        `;
        return;
    }

    lista.forEach(log => {
        tbody.innerHTML += `
            <tr>
                <td>${formatarDataBR(log.criado_em)}</td>
                <td><span class="badge badge-info">${log.tipo_evento || '—'}</span></td>
                <td>${log.descricao || '—'}</td>
                <td>${log.escritorio || '—'}</td>
                <td>${log.usuario || 'Sistema'}</td>
            </tr>
        `;
    });
}

function filtrarAudit() {
    const filtro = document.getElementById('filtroTipoEvento').value.toLowerCase();
    if (!filtro) {
        renderizarTabelaAudit(auditDataFull);
    } else {
        const filtrados = auditDataFull.filter(e => (e.tipo_evento || '').toLowerCase().includes(filtro));
        renderizarTabelaAudit(filtrados);
    }
}

// ==========================================
// HELPERS DE DELEGAÇÃO
// ==========================================

function navegarPara(url) { window.location.href = url; }
function removerElemento(id) { const el = document.getElementById(id); if (el) el.remove(); }
function clicarElemento(id) { const el = document.getElementById(id); if (el) el.click(); }

// ==========================================
// LISTENERS DE INPUT/CHANGE (DOMContentLoaded)
// ==========================================

document.addEventListener('DOMContentLoaded', function () {
    const filtroBusca = document.getElementById('filtroBuscaEscritorio');
    if (filtroBusca) filtroBusca.addEventListener('input', filtrarEscritorios);

    const filtroPlano = document.getElementById('filtroPlanoEscritorio');
    if (filtroPlano) filtroPlano.addEventListener('change', filtrarEscritorios);

    const filtroServico = document.getElementById('filtroServico');
    if (filtroServico) filtroServico.addEventListener('change', filtrarLogs);

    const filtroErro = document.getElementById('filtroErro');
    if (filtroErro) filtroErro.addEventListener('change', filtrarLogs);

    const filtroData = document.getElementById('filtroData');
    if (filtroData) filtroData.addEventListener('change', filtrarLogs);

    const filtroTipoEvento = document.getElementById('filtroTipoEvento');
    if (filtroTipoEvento) filtroTipoEvento.addEventListener('change', filtrarAudit);
});

