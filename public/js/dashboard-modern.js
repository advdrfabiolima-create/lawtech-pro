// 🛡️ VERIFICAÇÃO DE SEGURANÇA OBRIGATÓRIA

// ============================================================
// VERIFICAR SE PRECISA MOSTRAR MODAL
// ============================================================
// ============================================================
// VERIFICAR SE É PRIMEIRA VEZ DO USUÁRIO
// ============================================================
async function verificarPrimeiroAcesso() {
    try {
        // Verificar no backend se é primeiro acesso
        const res = await API.get('/api/auth/me');

        const data = await res.json();

        console.log('🔍 [DEBUG PRIMEIRO ACESSO]', {
            primeiroAcesso: data.usuario?.primeiro_acesso,
            usuario: data.usuario?.nome,
            email: data.usuario?.email
        });
        
        if (data.ok && data.usuario) {
            // Se primeiro_acesso for true no banco, mostrar modal
            if (data.usuario.primeiro_acesso === true || data.usuario.primeiro_acesso === null) {
                console.log('✅ [PRIMEIRO ACESSO] Mostrando modal de boas-vindas');
                window._modalBoasVindasAberto = true;
                window._foiPrimeiroAcesso = true; // tour sempre inicia após fechar
                setTimeout(() => {
                    document.getElementById('modalWelcome').classList.add('show');
                    // Inicializar ícones Lucide no modal
                    if (typeof lucide !== 'undefined') {
                        lucide.createIcons();
                    }
                }, 500);
            } else {
                console.log('ℹ️ [PRIMEIRO ACESSO] Usuário já viu as boas-vindas');
            }
        }
    } catch (err) {
        console.error('❌ [ERRO] Erro ao verificar primeiro acesso:', err);
    }
}

// ============================================================
// FECHAR MODAL DE BOAS-VINDAS
// ============================================================
async function fecharModalBoasVindas() {
    document.getElementById('modalWelcome').classList.remove('show');
    window._modalBoasVindasAberto = false;

    try {
        console.log('📤 [BOAS-VINDAS] Enviando requisição para marcar como visto...');

        // Marcar no backend que o usuário já viu a tela de boas-vindas
        const res = await API.put('/api/auth/marcar-boas-vindas', {});

        if (res.ok) {
            console.log('✅ [BOAS-VINDAS] Modal fechado e registrado no banco');
        } else {
            console.warn('⚠️ [BOAS-VINDAS] Endpoint retornou erro:', res.status);
            console.warn('💡 Verifique se a rota /api/auth/marcar-boas-vindas existe no backend');
        }
    } catch (err) {
        console.error('❌ [ERRO] Erro ao registrar fechamento de boas-vindas:', err);
        console.warn('💡 A rota /api/auth/marcar-boas-vindas pode não estar implementada ainda');
    }

    // No primeiro acesso, tour SEMPRE inicia (ignora localStorage de outro usuário/sessão).
    // Nas sessões seguintes, respeita a preferência salva.
    if (window._foiPrimeiroAcesso || localStorage.getItem('tour_concluido') !== 'true') {
        window._foiPrimeiroAcesso = false; // reseta flag
        console.log('🎯 [TOUR] Iniciando tour após fechamento do modal de boas-vindas');
        setTimeout(() => iniciarTour(), 600);
    }
}

// ============================================================
// 🧪 FUNÇÃO DE TESTE - Resetar primeiro acesso (DEV ONLY)
// ============================================================
async function resetarPrimeiroAcesso() {
    try {
        console.log('🔄 [TESTE] Tentando resetar primeiro acesso...');
        
        const res = await API.put('/api/auth/resetar-boas-vindas', {});
        
        if (res.ok) {
            alert('✅ Primeiro acesso resetado! Recarregue a página para ver o modal novamente.');
            console.log('✅ [TESTE] Primeiro acesso resetado com sucesso');
        } else {
            alert('⚠️ Endpoint de reset não implementado. Execute no banco:\nUPDATE usuarios SET primeiro_acesso = true WHERE email = \'seu@email.com\';');
            console.warn('⚠️ [TESTE] Endpoint /api/auth/resetar-boas-vindas não existe');
        }
    } catch (err) {
        console.error('❌ [TESTE] Erro ao resetar:', err);
        alert('❌ Erro ao resetar. Execute manualmente no banco de dados.');
    }
}

// Tornar função disponível globalmente para testes no console
window.resetarPrimeiroAcesso = resetarPrimeiroAcesso;

// ============================================================
// INICIALIZAÇÃO
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
    verificarPrimeiroAcesso();

    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    (async function validarAcesso() {
        try {
            const res = await API.get('/api/auth/me');

            if (!res || res.status === 401) {
                localStorage.clear();
                window.location.href = '/login';
                return;
            }

            if (res.status === 402) {
                localStorage.clear();
                window.location.href = '/pagamento-pendente';
                return;
            }

            inicializarDashboard();
            carregarPrazos();
            checarNovosLeads();
        } catch (err) {
            console.error("Erro na validação de acesso:", err);
        }
    })();

    // Notificações
    const notifContainer = document.getElementById('notif-container');
    const notifDropdown  = document.getElementById('notif-dropdown');

    if (notifContainer && notifDropdown) {
        notifContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            notifDropdown.style.display = notifDropdown.style.display === 'none' ? 'block' : 'none';
        });
    }

    document.addEventListener('click', () => {
        if (notifDropdown) notifDropdown.style.display = 'none';
    });
});

        // Formatação de diferença de dias
        function formatarDiferencaDias(dataVencimento) {
            if (!dataVencimento) return "Data inválida";
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            const vencimento = new Date(dataVencimento);
            vencimento.setHours(0, 0, 0, 0);
            const diffMs = vencimento - hoje;
            const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            if (diffDias < 0) {
                const diasAtraso = Math.abs(diffDias);
                return `VENCIDO HÁ ${diasAtraso} ${diasAtraso === 1 ? 'DIA' : 'DIAS'}`;
            }
            if (diffDias === 0) return "VENCE HOJE";
            if (diffDias === 1) return "VENCE AMANHÃ";
            return `VENCE EM ${diffDias} DIAS`;
        }

        // Inicializa dashboard (mantido seu código original, apenas organizado)
async function inicializarDashboard() {
    try {
        const resUser = await API.get('/api/auth/me');
        const dataUser = await resUser.json();
        
        let idEscritorio = null;

        if (dataUser.ok) {
            const user = dataUser.usuario;
            
            // --- 🛡️ TRAVA DEFINITIVA DO TOUR ---
            const sw = document.getElementById('switchTourNav');
            
            if (user.tour_desativado) {
                // Se o banco diz que está desativado, forçamos o bloqueio no navegador
                localStorage.setItem('tour_concluido', 'true');
                if (sw) sw.checked = false;
            } else {
                // Se o banco permite, verificamos se ele já terminou nesta sessão específica
                const jaTerminouNestaSessao = localStorage.getItem('tour_concluido') === 'true';
                if (sw) sw.checked = true;

                if (!jaTerminouNestaSessao) {
                    setTimeout(() => {
                        // Só inicia se o modal de boas-vindas não estiver aberto
                        if (localStorage.getItem('tour_concluido') !== 'true' && !window._modalBoasVindasAberto) {
                            iniciarTour();
                        }
                    }, 2000);
                }
            }
            // --- FIM DA LÓGICA DO TOUR ---
            
            // --- CABEÇALHO (Nome e Iniciais) ---
            const nomeCompleto = user.nome || 'Advogado';
            const primeiroNome = nomeCompleto.trim().split(' ')[0];
            const userNameEl = document.getElementById('userNameHeader');
            if (userNameEl) userNameEl.innerText = primeiroNome;

            const partes = nomeCompleto.trim().split(' ').filter(n => n);
            let iniciais = partes[0][0]; 
            if (partes.length > 1) {
                iniciais += partes[partes.length - 1][0]; 
            }
            
            const circulo = document.getElementById('userAvatar') || document.getElementById('userCircle');
            if (circulo) {
                circulo.innerText = iniciais.toUpperCase();
            }

            // Alerta de Trial/Teste
            if (user.dias_restantes <= 2 && user.dias_restantes > 0) {
                const alertaDiv = document.getElementById('alerta-pagamento');
                if (alertaDiv) {
                    alertaDiv.style.display = 'flex';
                    alertaDiv.style.background = '#fffbeb'; 
                    alertaDiv.style.borderColor = '#f59e0b';
                    alertaDiv.style.color = '#92400e';
                    document.getElementById('alerta-titulo').innerText = "⚠️ SEU PERÍODO DE TESTE ESTÁ ACABANDO";
                    document.getElementById('alerta-msg').innerText = `Faltam apenas ${user.dias_restantes} ${user.dias_restantes === 1 ? 'dia' : 'dias'}.`;
                    document.getElementById('alerta-icone').className = 'lucide lucide-alert-triangle';
                    alertaDiv.dataset.prioridade = "trial"; 
                }
            }

            idEscritorio = user.escritorio_id;
            const uEmail = document.getElementById('userEmail');
            if (uEmail) uEmail.innerText = user.email;

            // Só mostra cronômetro de trial para contas em período de teste
            if (user.plano_financeiro_status === 'trial' && user.data_criacao) {
                iniciarCronometroTrial(user.data_criacao);
            } else {
                // Conta paga: esconde o timer de trial
                const trialEl = document.getElementById('trial-timer');
                if (trialEl) trialEl.style.display = 'none';
            }

            // ✅ REMOVIDO: Verificação duplicada que forçava modal aparecer
            // O modal já é controlado por verificarPrimeiroAcesso() via localStorage
        }

        // --- PLANO E CONSUMO ---
        const resPlan = await API.get('/api/plano-consumo');
        const dataPlan = await resPlan.json();

        const alertaDiv = document.getElementById('alerta-pagamento');
        const alertaTitulo = document.getElementById('alerta-titulo');
        const alertaMsg = document.getElementById('alerta-msg');
        const alertaIcone = document.getElementById('alerta-icone');

        if (dataPlan.dias_restantes !== null && alertaDiv && alertaDiv.dataset.prioridade !== "trial") {
            if (dataPlan.em_tolerancia) {
                alertaDiv.style.display = 'flex';
                alertaDiv.style.background = '#fef2f2';
                alertaDiv.style.borderColor = '#ef4444';
                alertaDiv.style.color = '#991b1b';
                alertaTitulo.innerText = "🚨 ASSINATURA VENCIDA";
                alertaMsg.innerText = `Bloqueio em ${dataPlan.dias_para_bloqueio} dias.`;
                alertaIcone.className = 'lucide lucide-alert-octagon';
            } else if (dataPlan.dias_restantes <= 7) {
                alertaDiv.style.display = 'flex';
                alertaDiv.style.background = '#fffbeb';
                alertaTitulo.innerText = "⚠️ RENOVAÇÃO PRÓXIMA";
                alertaIcone.className = 'lucide lucide-alert-triangle';
            } else {
                alertaDiv.style.display = 'none';
            }
        }

        if (dataPlan.dias_para_bloqueio !== null && dataPlan.dias_para_bloqueio < 0) {
            window.location.href = '/planos-page';
            return;
        }

        // --- RENDERIZAÇÃO DE LIMITES ---
        const planName = dataPlan.plano || dataPlan.nome || 'Básico';
        const footPlan = document.getElementById('planNameFooter');
        if (footPlan) footPlan.innerText = planName;
        
        // Atualizar o card Status da Assinatura
        const planoAtualCard = document.getElementById('planoAtual');
        if (planoAtualCard) planoAtualCard.innerText = planName;
        
        const badgeContainer = document.getElementById('premiumWelcome');
        if (badgeContainer) {
            badgeContainer.style.display = planName.toLowerCase() === 'premium' ? 'flex' : 'none';
        }

        if (planName.toLowerCase() === 'premium' && idEscritorio) {
            const linkInput = document.getElementById('linkCaptura');
            if (linkInput) linkInput.value = `${window.location.origin}/p.html?id=${idEscritorio}`;
        }

        const usados = dataPlan.prazos_usados || 0;
        const limite = dataPlan.limite || dataPlan.limite_prazos; 
        let percent = (limite === null || planName.toLowerCase().includes('premium')) ? 100 : (limite > 0 ? Math.min((usados / limite) * 100, 100) : 0);

        const textoConsumo = document.getElementById('textoConsumoNumerico');
        if (textoConsumo) textoConsumo.innerText = limite === null ? `${usados} (Ilimitado)` : `${usados} de ${limite} usados`;
        
        const pBar = document.getElementById('progressBar');
        if (pBar) pBar.style.width = percent + '%';
        
        const cTotal = document.getElementById('count-total-prazos');
        if (cTotal) cTotal.innerText = usados;

        if (typeof lucide !== 'undefined') lucide.createIcons();

    } catch (err) { 
        console.error("Erro no Dashboard:", err); 
    }
}

        // CRM Metrics - CORRIGIDO E ATUALIZADO
async function checarNovosLeads() {
    try {
        const res = await API.get('/api/crm/metricas');

        if (!res.ok) {
            console.warn('Erro na API /api/metricas:', res.status);
            return;
        }

        const stats = await res.json();

        // IDs exatos do seu HTML
        document.getElementById('crm-leads-count').innerText   = stats.leads    || '0';
        document.getElementById('crm-triagem-count').innerText = stats.triagem  || stats.reuniao || '0';
        document.getElementById('crm-proposta-count').innerText = stats.proposta || '0';
        document.getElementById('crm-ganho-count').innerText   = stats.ganho    || '0';

        // Notificação de novo lead — persiste via localStorage entre navegações de página
        const atual = stats.leads || 0;
        const vistoStr = localStorage.getItem('crm_leads_visto');
        if (vistoStr === null) {
            localStorage.setItem('crm_leads_visto', atual); // primeira carga — só registra
        } else if (atual > parseInt(vistoStr)) {
            const som = document.getElementById('notificacaoSom');
            if (som) som.play().catch(() => {});
            document.getElementById('dotNotificacao').style.display = 'inline-block';
        }

    } catch (e) {
        console.error('Erro ao carregar métricas CRM:', e);
    }
}

        // Funções auxiliares (mantidas)
        function copiarLink() {
            const el = document.getElementById("linkCaptura");
            el.select();
            navigator.clipboard.writeText(el.value);
            alert("✅ Link de atendimento copiado!");
        }

function executarBusca() {
    const termo = document.getElementById('termoPesquisa').value.trim();
    const tipo = document.getElementById('tipoPesquisa').value;

    if (!termo) {
        alert("Doutor, por favor, digite o termo da busca.");
        return;
    }

    let url = "";
    const termoEncoded = encodeURIComponent(termo);

    switch (tipo) {
        case "tjba":
            // Abre a página de jurisprudência do TJBA
            url = `https://jurisprudencia.tjba.jus.br/`;
            break;
        case "jusbrasil":
            url = `https://www.jusbrasil.com.br/busca?q=${termoEncoded}`;
            break;
        case "stj":
            url = `https://scon.stj.jus.br/SCON/pesquisar.jsp?livre=${termoEncoded}`;
            break;
        case "tst":
            url = `https://jurisprudencia.tst.jus.br/?termo=${termoEncoded}`;
            break;
        case "google":
            url = `https://www.google.com/search?q=${termoEncoded}+site:jus.br+OR+site:gov.br`;
            break;
        default:
            url = `https://www.google.com/search?q=${termoEncoded}`;
    }

    window.open(url, '_blank');
    
    // Garante que a lupa continue visível após a interação
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

        function limparBolinha() {
            document.getElementById('dotNotificacao').style.display = 'none';
        }

        function toggleUserMenu() {
            const menu = document.getElementById('userDropdown');
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        }

        // 🚀 CORREÇÃO DO ERRO DE "NULL" E DO MENU
        window.addEventListener('click', function(e) {
        const menu = document.getElementById('userDropdown');
        const container = document.querySelector('.user-profile');
    
        // Se o menu existe e o clique foi fora da área do perfil, fecha o menu
        if (menu && container && !container.contains(e.target)) {
        menu.style.display = 'none';
        }
    });   

async function carregarPrazos() {
    const containerGeral = document.getElementById('lista-prazos');
    if (!containerGeral) return;

    try {
        const res = await API.get('/api/dashboard/prazos-geral');
        const prazos = await res.json();
        
        // ✅ ADICIONAR CONTAGEM DE PRAZOS VENCIDOS E DA SEMANA
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        
        const umaSemana = new Date(hoje);
        umaSemana.setDate(hoje.getDate() + 7);
        
        let contadorVencidos = 0;
        let contadorSemana = 0;
        
        prazos.forEach(p => {
            const dataLimite = new Date(p.data_limite);
            dataLimite.setHours(0, 0, 0, 0);
            
            // Contar vencidos (data limite < hoje)
            if (dataLimite < hoje) {
                contadorVencidos++;
            }
            
            // Contar prazos da semana (entre hoje e 7 dias)
            if (dataLimite >= hoje && dataLimite <= umaSemana) {
                contadorSemana++;
            }
        });
        
        // Atualizar os cards
        const elemVencidos = document.getElementById('count-vencidos');
        const elemSemana = document.getElementById('count-semana');
        
        if (elemVencidos) elemVencidos.innerText = contadorVencidos;
        if (elemSemana) elemSemana.innerText = contadorSemana;
        
        console.log(`📊 Contadores atualizados: ${contadorVencidos} vencidos, ${contadorSemana} na semana`);
        // FIM DA CONTAGEM
        
        containerGeral.innerHTML = '';
        const prazosExibicao = prazos.slice(0, 5);

        if (prazosExibicao.length === 0) {
            containerGeral.innerHTML = '<p style="text-align:center; padding:20px; color:#64748b;">Tudo em dia! Nenhum prazo pendente.</p>';
            return;
        }

prazosExibicao.forEach(p => {
    const textoDias = formatarDiferencaDias(p.data_limite);
    
    let urgenciaClass = '';
    if (textoDias.includes('VENCIDO') || textoDias.includes('HOJE')) {
        urgenciaClass = 'urgencia-hoje';
    } else if (textoDias.includes('AMANHÃ')) {
        urgenciaClass = 'urgencia-amanha';
    } else {
        urgenciaClass = 'urgencia-futuro';
    }

containerGeral.innerHTML += `
    <div class="prazo-item-modern ${urgenciaClass}">
        <div class="prazo-content">
            <div class="prazo-main-info" style="display:flex; justify-content: flex-start; align-items: center; gap: 12px;">
                <span class="prazo-title" style="font-weight: 800; font-size: 15px;">${p.tipo}</span>
                <span class="tag-urgencia">${textoDias}</span>
            </div>
            
            <div class="prazo-meta-list">
                <div style="color: var(--accent-blue); font-weight: 800; font-size: 13px;">
                    <i class="lucide lucide-user" style="width:14px; vertical-align: middle;"></i> 
                    ${p.cliente_nome || 'CLIENTE NÃO IDENTIFICADO'}
                </div>

                <div style="color: var(--text-secondary); font-size: 12px;">
                    <i class="lucide lucide-users" style="width:14px; vertical-align: middle;"></i> 
                    <span style="font-weight: 600;">VS:</span> ${p.parte_contraria || 'NÃO INFORMADA'}
                </div>

                <div style="color: var(--text-tertiary); font-size: 12px;">
                    <i class="lucide lucide-gavel" style="width:14px; vertical-align: middle;"></i> 
                    ${p.tribunal || 'TRIBUNAL NÃO DEFINIDO'}
                </div>

                <div style="color: var(--text-tertiary); font-family: 'JetBrains Mono', monospace; font-size: 12px;">
                    <i class="lucide lucide-hash" style="width:14px; vertical-align: middle;"></i> 
                    ${p.numero_processo || 'NÃO INFORMADO'}
                </div>
            </div>
        </div>
        <button class="btn-concluir-dash" data-action="concluirPrazoDash" data-args='[${p.id}]'>
            <i class="lucide lucide-check-circle-2" style="width:20px;"></i>
        </button>
    </div>`;
});

        if (typeof lucide !== 'undefined') lucide.createIcons();
        iniciarContagemRegressiva(); // Ativa os relógios
    } catch (err) { console.error(err); }
}

function iniciarContagemRegressiva() {
    setInterval(() => {
        const timers = document.querySelectorAll('.timer-display');
        const agora = new Date();
        const fimDoDia = new Date();
        fimDoDia.setHours(23, 59, 59, 999);

        const diffMs = fimDoDia - agora;
        if (diffMs <= 0) return;

        const h = Math.floor(diffMs / 3600000);
        const m = Math.floor((diffMs % 3600000) / 60000);
        const s = Math.floor((diffMs % 60000) / 1000);

        const tempoFormatado = `${h}h ${m}m ${s}s`;
        timers.forEach(t => t.innerText = tempoFormatado);
    }, 1000);
}

        async function concluirPrazoDash(id) {
            if (!confirm("Deseja marcar como concluído?")) return;
            const res = await API.put(`/api/prazos/${id}/concluir`, {});
            if (res.ok) { 
                carregarPrazos(); 
                inicializarDashboard(); 
            }
        }

        // 🕐 CRONÔMETRO DE TRIAL
        let trialInterval = null;

        function iniciarCronometroTrial(dataCriacao) {
            console.log('🕐 Iniciando cronômetro de trial com data:', dataCriacao);
            
            const trialTimer = document.getElementById('trial-timer');
            const trialCountdown = document.getElementById('trial-countdown');
            
            if (!trialTimer || !trialCountdown) {
                console.error('❌ Elementos do cronômetro não encontrados!');
                return;
            }
            
            if (!dataCriacao) {
                console.warn('⚠️ data_criacao não fornecida, cronômetro não será exibido');
                return;
            }

            // Calcular data de expiração (data_criacao + 7 dias)
            const dataInicio = new Date(dataCriacao);
            const dataExpiracao = new Date(dataInicio);
            dataExpiracao.setDate(dataExpiracao.getDate() + 7);
            
            console.log('📅 Data de expiração calculada:', dataExpiracao);
            
            function atualizarCronometro() {
                const agora = new Date();
                const diferenca = dataExpiracao - agora;
                
                console.log('⏱️ Diferença em ms:', diferenca);
                
                // Se o trial expirou, ocultar o cronômetro
                if (diferenca <= 0) {
                    console.log('❌ Trial expirado, ocultando cronômetro');
                    trialTimer.style.display = 'none';
                    if (trialInterval) {
                        clearInterval(trialInterval);
                    }
                    return;
                }
                
                // Calcular dias, horas e minutos restantes
                const dias = Math.floor(diferenca / (1000 * 60 * 60 * 24));
                const horas = Math.floor((diferenca % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutos = Math.floor((diferenca % (1000 * 60 * 60)) / (1000 * 60));
                
                // Formatar exibição
                const diasFormatado = dias > 0 ? `${dias}d ` : '';
                const horasFormatado = horas.toString().padStart(2, '0') + 'h ';
                const minutosFormatado = minutos.toString().padStart(2, '0') + 'm';
                
                const textoFinal = diasFormatado + horasFormatado + minutosFormatado;
                console.log('🕐 Exibindo:', textoFinal);
                
                trialCountdown.textContent = textoFinal;
                
                // Exibir o cronômetro
                trialTimer.style.display = 'flex';
                
                // Mudar cor para vermelho quando faltam menos de 24 horas
                if (dias === 0 && horas < 24) {
                    console.log('🔴 Menos de 24h! Mudando para vermelho');
                    trialTimer.style.background = 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)';
                    trialTimer.style.borderColor = '#ef4444';
                    trialTimer.style.color = '#991b1b';
                    trialTimer.querySelector('i').style.color = '#ef4444';
                }
            }
            
            // Atualizar imediatamente
            atualizarCronometro();
            
            // Atualizar a cada minuto
            trialInterval = setInterval(atualizarCronometro, 60000);
        }

        function logout() { 
            localStorage.clear(); 
            window.location.href = '/login.html'; 
        }

        // 🎓 Resetar Tour Guiado
        function resetarTour() {
            localStorage.removeItem('tour_concluido');
            iniciarTour();
        }

        // Inicialização e atualizações periódicas
        window.addEventListener('DOMContentLoaded', () => {
    checarNovosLeads(); 
    setInterval(checarNovosLeads, 30000); 
    
    API.get('/api/audiencias')
        .then(res => res.json())
        .then(dados => {
            if (document.getElementById('totalAudiencias'))
                document.getElementById('totalAudiencias').innerText = Array.isArray(dados) ? dados.length : 0;
        });

    // 🚀 COMANDO DE OURO: Renderiza a lupa especificamente
    if (window.lucide) {
        lucide.createIcons();
    }
});

function toggleIaMenu(event) {
    event.preventDefault(); // impede navegação imediata
    const submenu = document.getElementById('submenu-ia');
    submenu.classList.toggle('open');
}

// Auto-abrir submenu IA se a página atual for uma das sub-rotas
(function() {
    const path = window.location.pathname;
    if (path === '/ia-page' || path === '/peticoes.html') {
        const submenu = document.getElementById('submenu-ia');
        if (submenu) submenu.classList.add('open');

        // Destacar o link ativo dentro do submenu
        const links = submenu ? submenu.querySelectorAll('a') : [];
        links.forEach(link => {
            if (link.getAttribute('href') === path) {
                link.style.background = 'rgba(251, 191, 36, 0.15)';
                link.style.borderRadius = '8px';
                link.style.fontWeight = '700';
            }
        });
    }
})();
    

function iniciarTour() {
    const driver = window.driver.js.driver;

    const driverObj = driver({
        showProgress: true,
        nextBtnText: 'Próximo',
        prevBtnText: 'Anterior',
        doneBtnText: 'Entendi',
        steps: [
            { 
                element: '#guia-config', // Agora o ID aponta para o seu link com a bolinha
                popover: { 
                    title: '⚙️ Configurações Iniciais', 
                    description: 'Antes de começar, preencha os dados do seu escritório aqui. É fundamental para ativar as funções de API e para que você tome conhecimento das regras de uso e cancelamento do plano.', 
                    side: "right", 
                    align: 'start' 
                } 
            },            
            { 
                element: '#tipoPesquisa', 
                popover: { title: 'Pesquisa Jurídica', description: 'Escolha o tribunal e pesquise jurisprudência sem sair do Dashboard.', side: "bottom", align: 'start' } 
            },
            { 
                element: '#guia-crm', 
                popover: { title: 'Gestão de Prospecção', description: 'Acompanhe seus leads e novos contratos de forma organizada.', side: "top", align: 'center' } 
            },
            {
                element: '#guia-prazos',
                popover: { title: '🚨 Alerta de Prazos', description: 'Este é o coração da sua segurança. O sistema monitora e avisa sobre prazos fatais aqui.', side: "top", align: 'center' }
            },
            {
                element: '#guia-tour-switch',
                popover: {
                    title: '🎓 Tour Guiado',
                    description: 'Este tour aparece sempre que você faz login ou acessa o Dashboard. Para desativá-lo, clique no seu avatar no canto superior direito e desligue o switch ao lado de "Ver Tour". Você pode reativá-lo a qualquer momento no mesmo local.',
                    side: "bottom",
                    align: 'end'
                },
                onHighlightStarted: () => {
                    const dropdown = document.getElementById('userDropdown');
                    if (dropdown) dropdown.style.display = 'block';
                },
                onDeselected: () => {
                    const dropdown = document.getElementById('userDropdown');
                    if (dropdown) dropdown.style.display = 'none';
                }
            }
        ]
    });

    driverObj.drive();
}

async function alternarAutoStart(ligado) {
    const desativar = !ligado;
    
    // 1. Salva no banco (Permanente)
    await API.post('/api/auth/atualizar-tour', { desativar });

    // 2. Atualiza o LocalStorage IMEDIATAMENTE
    if (desativar) {
        localStorage.setItem('tour_concluido', 'true');
    } else {
        localStorage.removeItem('tour_concluido');
    }

    // 3. Feedback visual (Opcional)
    console.log(desativar ? "Tour desativado permanentemente" : "Tour reativado");
}

// Garante que o switch comece na posição correta ao abrir o menu
function atualizarEstadoSwitch() {
    const tourDesativado = localStorage.getItem('tour_concluido') === 'true';
    const sw = document.getElementById('switchTourNav');
    if (sw) sw.checked = !tourDesativado;
}

// Em vez de iniciar o tour direto, esperamos o Dashboard carregar
window.addEventListener('load', () => {
    atualizarEstadoSwitch();
    
    // Pequeno delay para dar tempo da função inicializarDashboard buscar os dados do banco
    setTimeout(() => {
        const travaBanco = localStorage.getItem('tour_concluido') === 'true';
        if (!travaBanco && !window._modalBoasVindasAberto) {
            iniciarTour();
        }
    }, 3000); // 3 segundos é o tempo de segurança
});

// =============================================
// SISTEMA DE NOTIFICAÇÕES IN-APP
// =============================================
let notifDropdownAberto = false;

function toggleNotifDropdown() {
    const dropdown = document.getElementById('notif-dropdown');
    notifDropdownAberto = !notifDropdownAberto;
    dropdown.style.display = notifDropdownAberto ? 'block' : 'none';
    if (notifDropdownAberto) carregarNotificacoes();
}

async function carregarNotificacoes() {
    try {
        const res = await API.get('/api/notificacoes');
        const data = await res.json();
        const lista = document.getElementById('notif-list');
        if (!data.ok || !data.notificacoes || data.notificacoes.length === 0) {
            lista.innerHTML = '<p style="text-align:center; color:var(--muted); padding:24px; font-size:13px;">Nenhuma notificação.</p>';
            return;
        }
        lista.innerHTML = data.notificacoes.map(n => {
            const tempo = tempoRelativo(n.enviada_em);
            const bgLida = n.lida ? '' : 'background:#f0f7ff;';
            return `<div data-action="clicarNotificacao" data-args='[${n.id}]' style="padding:12px 16px; border-bottom:1px solid var(--border-subtle); cursor:pointer; transition:background 0.2s; ${bgLida}">
                <div style="font-size:13px; font-weight:${n.lida ? '400' : '600'}; color:var(--text-primary); margin-bottom:2px;">${n.titulo || 'Notificação'}</div>
                <div style="font-size:12px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${n.mensagem || ''}</div>
                <div style="font-size:11px; color:var(--muted); margin-top:4px;">${tempo}</div>
            </div>`;
        }).join('');
    } catch (e) { console.error('Erro ao carregar notificações:', e); }
}

function tempoRelativo(dataStr) {
    const agora = new Date();
    const data = new Date(dataStr);
    const diffMin = Math.floor((agora - data) / 60000);
    if (diffMin < 1) return 'agora mesmo';
    if (diffMin < 60) return `há ${diffMin}min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `há ${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    return `há ${diffD}d`;
}

async function clicarNotificacao(id) {
    try {
        await API.put(`/api/notificacoes/${id}/lida`, {});
    } catch (e) {}
    window.location.href = '/prazos-page';
}

async function marcarTodasLidas(event) {
    event.stopPropagation();
    try {
        await API.put('/api/notificacoes/ler-todas', {});
        atualizarBadgeNotif();
        carregarNotificacoes();
    } catch (e) {}
}

async function atualizarBadgeNotif() {
    if (!API.getToken()) return;
    try {
        const res = await API.get('/api/notificacoes/count');
        const data = await res.json();
        const badge = document.getElementById('notif-count');
        if (data.ok && data.count > 0) {
            badge.textContent = data.count > 99 ? '99+' : data.count;
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) {}
}

// Fechar dropdown ao clicar fora
window.addEventListener('click', (e) => {
    if (!e.target.closest('#notif-container')) {
        const dropdown = document.getElementById('notif-dropdown');
        if (dropdown) dropdown.style.display = 'none';
        notifDropdownAberto = false;
    }
});

// Atualizar badge a cada 60s
atualizarBadgeNotif();
setInterval(atualizarBadgeNotif, 60000);



(function(){var t=localStorage.getItem('token');if(!t)return;var _ci;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){if(r.status===402){clearInterval(_ci);return null;}return r.json()}).then(function(d){if(!d||!d.ok)return;var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}).catch(function(){})}checkChat();_ci=setInterval(checkChat,30000);})();

// ============================================================
// HELPERS PARA EVENT DELEGATION
// ============================================================
function navegarPara(url) { window.location.href = url; }
function removerElemento(id) { const el = document.getElementById(id); if (el) el.remove(); }
function clicarElemento(id) { const el = document.getElementById(id); if (el) el.click(); }

// ============================================================
// LISTENERS MIGRADOS DE INLINE HANDLERS
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    // toggleIaMenu — link especial com id
    const lia = document.getElementById('linkIaMenu');
    if (lia) lia.addEventListener('click', toggleIaMenu);

    // toggleUserMenu — botão do avatar
    const btnUserMenu = document.getElementById('btnUserMenu');
    if (btnUserMenu) btnUserMenu.addEventListener('click', toggleUserMenu);

    // switchTourNav — onchange para alternarAutoStart
    const switchTour = document.getElementById('switchTourNav');
    if (switchTour) switchTour.addEventListener('change', function () { alternarAutoStart(this.checked); });

    // termoPesquisa — onkeypress Enter para executarBusca
    const termoPesquisa = document.getElementById('termoPesquisa');
    if (termoPesquisa) termoPesquisa.addEventListener('keypress', function (e) { if (e.key === 'Enter') executarBusca(); });

    // btnMarcarTodasLidas — stopPropagation necessário
    const btnMarcar = document.getElementById('btnMarcarTodasLidas');
    if (btnMarcar) btnMarcar.addEventListener('click', function (e) { e.stopPropagation(); marcarTodasLidas(e); });

    // btnCopiarLink — hover via CSS é suficiente; o data-action já trata o click
    // Hover visual para o botão de copiar link
    const btnCopiar = document.getElementById('btnCopiarLink');
    if (btnCopiar) {
        btnCopiar.addEventListener('mouseover', function () { this.style.background = '#5BA4DB'; });
        btnCopiar.addEventListener('mouseout', function () { this.style.background = '#4A90E2'; });
    }
});