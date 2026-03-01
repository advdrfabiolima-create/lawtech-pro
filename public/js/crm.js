
    const token = localStorage.getItem('token');
    if (!token) window.location.href = '/login.html';

    let leadSelecionadoId = null;
    let leadSelecionadoStatus = 'Novo';
    let nomeAdvogado = '';
    let nomeEscritorio = '';

    async function carregarInfoRodape() {
        try {
            const resUser = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
            const dataUser = await resUser.json();
            console.log('Dados do usuário recebidos:', dataUser);
            
            if (dataUser.ok && dataUser.usuario) {
                // Email do usuário
                if (document.getElementById('userEmail')) {
                    document.getElementById('userEmail').innerText = dataUser.usuario.email || '---';
                }

                // Nome e iniciais
                const nomeCompleto = dataUser.usuario.nome || 'Advogado';
                const primeiroNome = nomeCompleto.trim().split(' ')[0];
                const userNameEl = document.getElementById('userNameHeader');
                if (userNameEl) userNameEl.innerText = primeiroNome;

                // Calcula iniciais
                const partes = nomeCompleto.trim().split(' ').filter(n => n);
                let iniciais = partes[0][0];
                if (partes.length > 1) iniciais += partes[partes.length - 1][0];
                const circulo = document.getElementById('userCircle');
                if (circulo) circulo.innerText = iniciais.toUpperCase();
            }

            // Buscar plano
            const resP = await fetch('/api/plano-consumo', { headers: { Authorization: `Bearer ${token}` } });
            if (resP.ok) {
                const dataP = await resP.json();
                const planoNome = (dataP.plano || '').toLowerCase();
                const planNameEl = document.getElementById('planNameFooter');
                if (planNameEl) {
                    planNameEl.innerText = dataP.plano || '---';
                }

                // CRM requer plano Avançado ou Premium
                if (!['avançado', 'avancado', 'premium'].includes(planoNome)) {
                    const content = document.querySelector('.content');
                    if (content) {
                        content.innerHTML = `
                            <div style="display:flex; align-items:center; justify-content:center; min-height: 60vh;">
                                <div style="text-align:center; background:var(--white); border-radius:16px; padding:48px 40px; border:1px solid var(--border); max-width:520px; box-shadow:0 8px 30px rgba(0,0,0,0.08);">
                                    <div style="width:72px; height:72px; background:#fef3c7; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; font-size:32px;">📊</div>
                                    <h2 style="font-size:20px; font-weight:700; color:var(--text-primary); margin-bottom:12px;">CRM Prospecção</h2>
                                    <p style="color:var(--text-secondary); font-size:14px; line-height:1.6; margin-bottom:24px;">
                                        Você está no plano <strong style="text-transform:capitalize;">${dataP.plano || 'Free'}</strong>.<br>
                                        O módulo CRM de prospecção está disponível a partir do plano <strong>Avançado</strong>.
                                    </p>
                                    <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
                                        <a href="/planos-page" style="display:inline-block; background:var(--accent-blue); color:white; padding:12px 28px; border-radius:10px; text-decoration:none; font-weight:700; font-size:14px;">
                                            Fazer Upgrade
                                        </a>
                                        <a href="/dashboard" style="display:inline-block; background:var(--bg); color:var(--text-secondary); padding:12px 28px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px; border:1px solid var(--border);">
                                            Voltar ao Dashboard
                                        </a>
                                    </div>
                                </div>
                            </div>
                        `;
                    }
                    return;
                }
            }
        } catch (e) {
            console.error("Erro ao carregar rodapé:", e);
        }
    }

    async function carregarDadosEscritorio() {
        try {
            const res = await fetch('/api/config/meu-escritorio', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            
            if (data.ok && data.dados) {
                nomeEscritorio = data.dados.nome || 'nosso escritório';
                nomeAdvogado = data.dados.advogado_responsavel || 'Dr./Dra.';
                console.log('✅ Dados do escritório carregados:', nomeEscritorio, nomeAdvogado);
            }
        } catch (err) {
            console.error('Erro ao carregar dados do escritório:', err);
        }
    }

    const mapeamentoStatus = (status) => {
        const s = (status || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (s.includes('novo') || s === 'novo') return 'lead';
        if (s.includes('reuniao') || s.includes('reuni') || s.includes('triagem') || s.includes('reunião')) return 'triagem';
        if (s.includes('proposta') || s.includes('propost')) return 'proposta';
        if (s.includes('ganho') || s.includes('ganhar') || s.includes('ganhho') || s.includes('ganhos') || s.includes('contrato')) return 'ganho';
        return 'lead';
    };

 async function carregarLeads() {
    try {
        const resLeads = await fetch('/api/crm/leads', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!resLeads.ok) throw new Error('Erro ao carregar leads');
        const leads = await resLeads.json();

        const resMetricas = await fetch('/api/crm/metricas', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!resMetricas.ok) throw new Error('Erro ao carregar métricas');
        const metricas = await resMetricas.json();

        document.getElementById('count-lead').innerText = metricas.leads || 0;
        document.getElementById('count-triagem').innerText = metricas.reuniao || 0;
        document.getElementById('count-proposta').innerText = metricas.proposta || 0;
        document.getElementById('count-ganho').innerText = metricas.ganho || 0;

        atualizarBadgeCRM(metricas.leads || 0);
        // Marca leads como vistos para apagar o badge nas outras páginas
        localStorage.setItem('crm_leads_visto', metricas.leads || 0);

        document.querySelectorAll('[id^="container-"]').forEach(c => c.innerHTML = '');

        leads.forEach(lead => {
            const statusKey = mapeamentoStatus(lead.status);
            const container = document.getElementById(`container-${statusKey}`);
            if (!container) return;

            const card = document.createElement('div');
            card.className = 'lead-card';
            card.id = `lead-${lead.id}`;

            if (statusKey !== 'ganho') {
                card.draggable = true;
                card.addEventListener('dragstart', drag);
            }

            card.dataset.id = lead.id;
            card.dataset.nome = lead.nome || '';
            card.dataset.telefone = lead.telefone || '';
            card.dataset.interesse = lead.assunto || 'Não informado';
            card.dataset.notas = lead.mensagem || '';
            card.dataset.status = lead.status || 'Novo';
            card.dataset.score = lead.score || 0;

            const s = parseInt(lead.score) || 0;
            const badgeCls = s >= 66 ? 'score-quente' : s >= 31 ? 'score-morno' : 'score-frio';
            const badgeLbl = s >= 66 ? '🟢 Quente' : s >= 31 ? '🟡 Morno' : '🔴 Frio';

            card.innerHTML = `
                <div class="lead-card-header-${statusKey}"
                     style="padding:12px; margin:-20px -20px 12px -20px; border-radius:8px 8px 0 0; display:flex; justify-content:space-between; align-items:center;">
                    <strong style="color:white; font-size:14px;">${lead.nome}</strong>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span class="score-badge ${badgeCls}" title="Score: ${s}">${badgeLbl}</span>
                        <i class="lucide lucide-message-circle"
                           style="width:16px; height:16px; color:white; cursor:pointer;"
                           title="Chamar no WhatsApp"></i>
                    </div>
                </div>

                <span>
                    <i class="lucide lucide-phone"></i>
                    ${lead.telefone || '---'}
                </span>

                <span>
                    <i class="lucide lucide-briefcase"></i>
                    ${lead.assunto || 'Não informado'}
                </span>
            `;

            // clique no card
            card.addEventListener('click', () => {
                abrirDetalhes(
                    card.dataset.id,
                    card.dataset.nome,
                    card.dataset.telefone,
                    card.dataset.interesse,
                    card.dataset.notas,
                    card.dataset.status
                );
            });

            // clique no whatsapp
            card.querySelector('.lucide-message-circle')
                .addEventListener('click', (e) => {
                    e.stopPropagation();
                    abrirWhatsApp(e, lead.telefone, lead.nome);
                });

            container.appendChild(card);
        });

    } catch (e) {
        console.error("Erro ao carregar CRM:", e);
    }
}


    async function salvarNovoLead(e) {
    e.preventDefault();

    // 1️⃣ PEGAR ELEMENTOS
    const elementoNome = document.getElementById('novoNome');
    const elementoEmail = document.getElementById('novoEmail');
    const elementoTelefone = document.getElementById('novoTelefone');
    const elementoInteresse = document.getElementById('novoInteresse');

    console.log('🔍 ELEMENTOS DO FORMULÁRIO:');
    console.log('  - novoNome:', elementoNome);
    console.log('  - novoEmail:', elementoEmail);
    console.log('  - novoTelefone:', elementoTelefone);
    console.log('  - novoInteresse:', elementoInteresse);

    // 2️⃣ PEGAR VALORES
    const nome = elementoNome ? elementoNome.value.trim() : '';
    const email = elementoEmail ? elementoEmail.value.trim() : '';
    const telefone = elementoTelefone ? elementoTelefone.value.trim() : '';
    const interesse = elementoInteresse ? elementoInteresse.value : '';

    console.log('📝 VALORES DOS CAMPOS:');
    console.log('  - nome:', nome, '| tipo:', typeof nome);
    console.log('  - email:', email, '| tipo:', typeof email);
    console.log('  - telefone:', telefone, '| tipo:', typeof telefone);
    console.log('  - interesse:', interesse, '| tipo:', typeof interesse);
    console.log('  - interesse vazio?:', interesse === '');
    console.log('  - interesse length:', interesse.length);

    // 3️⃣ VERIFICAR SELECT
    if (elementoInteresse) {
        console.log('🎯 DETALHES DO SELECT:');
        console.log('  - selectedIndex:', elementoInteresse.selectedIndex);
        console.log('  - options.length:', elementoInteresse.options.length);
        console.log('  - selected option:', elementoInteresse.options[elementoInteresse.selectedIndex]);
        console.log('  - selected value:', elementoInteresse.options[elementoInteresse.selectedIndex]?.value);
        console.log('  - selected text:', elementoInteresse.options[elementoInteresse.selectedIndex]?.text);
    }

    // 4️⃣ VALIDAÇÕES
    if (!nome) {
        alert("O nome do lead é obrigatório.");
        return;
    }

    if (!email) {
        alert("O e-mail do lead é obrigatório.");
        return;
    }

    if (!telefone) {
        alert("O telefone do lead é obrigatório.");
        return;
    }

    // 5️⃣ PREPARAR OBJETO PARA ENVIO
    const dadosParaEnviar = {
        nome,
        email,
        telefone,
        interesse: interesse && interesse.trim() !== '' ? interesse : 'Não informado'  // ← GARANTIR QUE NUNCA SEJA VAZIO
    };

    console.log('📦 OBJETO QUE SERÁ ENVIADO:');
    console.log(JSON.stringify(dadosParaEnviar, null, 2));

    try {
        console.log('🚀 ENVIANDO REQUISIÇÃO...');
        
        const res = await fetch('/api/crm/leads', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(dadosParaEnviar)
        });

        console.log('📥 RESPOSTA RECEBIDA:');
        console.log('  - Status:', res.status);
        console.log('  - OK?:', res.ok);

        if (!res.ok) {
            const err = await res.json();
            console.error('❌ ERRO NA RESPOSTA:', err);
            throw new Error(err.error || err.mensagem || 'Erro ao criar lead');
        }

        const result = await res.json();
        console.log('✅ SUCESSO! Lead criado:', result);
        console.log('✅ Lead retornado:', JSON.stringify(result.lead, null, 2));

        alert("Lead criado com sucesso!");
        document.getElementById('formNovoLead').reset();
        fecharModalCadastro();
        carregarLeads();

    } catch (error) {
        console.error("❌ ERRO AO CRIAR LEAD:", error);
        console.error("❌ Stack:", error.stack);
        alert(error.message || "Erro ao criar lead.");
    }
}

    function mostrarModalUpgrade(mensagem) {
        const overlay = document.createElement('div');
        overlay.id = "overlay-upgrade-crm";
        overlay.style = "position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:10000; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(8px); animation:fadeIn 0.3s;";
        
        overlay.innerHTML = `
        <style>
            @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
            @keyframes slideUp { from { transform:translateY(30px); opacity:0; } to { transform:translateY(0); opacity:1; } }
        </style>
        <div style="background:linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); padding:50px 40px; border-radius:24px; text-align:center; max-width:480px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); animation:slideUp 0.4s; border:2px solid #fbbf24;">
            
            <div style="width:80px; height:80px; background:linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 25px; box-shadow:0 10px 25px -5px rgba(251,191,36,0.4);">
                <span style="font-size:40px;">👑</span>
            </div>
            
            <h3 style="margin:0 0 15px 0; color:#0f172a; font-size:24px; font-weight:800;">Recurso Premium</h3>
            
            <p style="color:#64748b; margin:0 0 30px 0; font-size:16px; line-height:1.6;">${mensagem}</p>
            
            <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:12px; padding:20px; margin-bottom:30px; text-align:left;">
                <p style="margin:0; font-size:14px; color:#92400e; line-height:1.6;">
                    <strong style="display:block; margin-bottom:8px; font-size:15px;">🚀 O Plano Premium inclui:</strong>
                    • CRM completo com pipeline Kanban<br>
                    • IA Jurídica powered by Claude<br>
                    • Usuários e prazos ilimitados<br>
                    • Suporte prioritário 24/7
                </p>
            </div>
            
            <div style="display:flex; gap:12px; justify-content:center;">
                <button onclick="window.location.href='/planos-page'" 
                        style="background:linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); color:#000; border:none; padding:16px 32px; border-radius:12px; font-weight:800; font-size:15px; cursor:pointer; box-shadow:0 4px 14px rgba(251,191,36,0.4); transition:0.3s; flex:1;"
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(251,191,36,0.5)';"
                        onmouseout="this.style.transform=''; this.style.boxShadow='0 4px 14px rgba(251,191,36,0.4)';">
                    🎯 Ver Planos
                </button>
                
                <button onclick="document.getElementById('overlay-upgrade-crm').remove()" 
                        style="background:#f1f5f9; color:#475569; border:none; padding:16px 24px; border-radius:12px; font-weight:700; cursor:pointer; transition:0.3s;"
                        onmouseover="this.style.background='#e2e8f0';"
                        onmouseout="this.style.background='#f1f5f9';">
                    Fechar
                </button>
            </div>
        </div>`;
        
        document.body.appendChild(overlay);
    }

    function abrirModalCadastro() { 
        document.getElementById('modalNovoLead').style.display = 'flex'; 
    }
    
    function fecharModalCadastro() { 
        document.getElementById('modalNovoLead').style.display = 'none'; 
        document.getElementById('formNovoLead')?.reset(); 
    }

    function abrirDetalhes(id, nome, tel, int, notas, status) {
        console.log('Abrindo detalhes:', { id, nome, tel, interesse: int, notas, status });
        leadSelecionadoId = id;
        leadSelecionadoStatus = status || 'Novo';
        document.getElementById('detalheNome').innerText = nome;
        document.getElementById('detalheTelefone').innerText = tel;
        document.getElementById('detalheInteresse').innerText = int;
        document.getElementById('detalheNotas').value = (notas === 'null' || !notas) ? '' : notas;
        document.getElementById('btnFichaWpp').style.display =
            (status === 'Ganho') ? 'block' : 'none';
        document.getElementById('modalDetalhes').style.display = 'flex';
        carregarAtividades(id);
    }

    function fecharModalDetalhes() { 
        document.getElementById('modalDetalhes').style.display = 'none'; 
    }
    
    async function salvarNotas() {
        const notas = document.getElementById('detalheNotas').value.trim();

        if (!notas) {
            alert("Digite algo antes de salvar.");
            return;
        }

        try {
            const res = await fetch(`/api/crm/leads/${leadSelecionadoId}/notas`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ notas })
            });

            if (res.ok) {
                alert("✅ Notas salvas com sucesso!");
                fecharModalDetalhes();
                carregarLeads();
            } else {
                const erro = await res.json();
                alert("Erro ao salvar: " + (erro.error || erro.erro || "Tente novamente"));
            }
        } catch (err) {
            console.error("Erro ao salvar notas:", err);
            alert("Erro de conexão. Verifique o console.");
        }
    }

    async function excluirLead() {
        if (!confirm("Tem certeza que deseja EXCLUIR este lead permanentemente?")) return;

        try {
            const res = await fetch(`/api/crm/leads/${leadSelecionadoId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                alert("Lead excluído com sucesso.");
                fecharModalDetalhes();
                carregarLeads();
            } else {
                alert("Erro ao excluir lead.");
            }
        } catch (err) {
            console.error("Erro ao excluir lead:", err);
            alert("Erro de conexão ao excluir lead.");
        }
    }

    function allowDrop(ev) { 
        ev.preventDefault(); 
        ev.currentTarget.style.background = '#e0f2fe'; 
    }

    function dragLeave(ev) {
        ev.currentTarget.style.background = '';
    }

    function drag(ev) { 
        ev.dataTransfer.setData("text", ev.target.id); 
    }

    async function drop(ev) {
        ev.preventDefault();
        ev.currentTarget.style.background = '';
        const id = ev.dataTransfer.getData("text").replace('lead-', '');
        const targetStatus = ev.currentTarget.getAttribute('data-status');
        
        const statusParaBanco = { 'lead': 'Novo', 'triagem': 'Reunião', 'proposta': 'Proposta', 'ganho': 'Ganho' };
        const statusFinal = statusParaBanco[targetStatus];

        try {
            const res = await fetch(`/api/crm/lead/${id}/status`, { 
                method: 'PATCH', 
                headers: { 
                    'Content-Type': 'application/json', 
                    Authorization: `Bearer ${token}` 
                }, 
                body: JSON.stringify({ status: statusFinal }) 
            });
            if (res.ok) {
                carregarLeads();
            } else {
                console.error('Erro ao mover lead:', res.status);
            }
        } catch (e) {
            console.error('Erro no drop:', e);
        }
    }

    function gerarMsgWhatsApp(etapa, nome, area) {
        const msgs = {
            lead:     `Olá ${nome}, recebemos seu contato sobre ${area}. Podemos conversar para entender melhor sua situação?`,
            triagem:  `Olá ${nome}, estamos analisando seu caso de ${area}. Quando você está disponível para uma conversa?`,
            proposta: `Olá ${nome}, preparamos uma proposta para seu caso de ${area}. Posso apresentar os detalhes agora?`,
            ganho:    `Olá ${nome}, seja bem-vindo ao escritório! Estamos muito felizes em tê-lo como cliente. Em breve entraremos em contato para dar início ao seu atendimento.`
        };
        return msgs[etapa] || msgs.lead;
    }

    function abrirWhatsApp(event, telefone, nome) {
        event.stopPropagation();
        if (!telefone || telefone === '---') {
            alert("Este lead não possui telefone cadastrado.");
            return;
        }
        const foneLimpo = telefone.replace(/\D/g, '');
        const area = document.getElementById('detalheInteresse')?.innerText || 'questão jurídica';
        const mensagem = window.encodeURIComponent(gerarMsgWhatsApp('lead', nome, area));
        window.open(`https://wa.me/55${foneLimpo}?text=${mensagem}`, '_blank');
    }

    function abrirWhatsAppEtapa(etapa) {
        const telefone = document.getElementById('detalheTelefone').innerText;
        const nome = document.getElementById('detalheNome').innerText;
        const area = document.getElementById('detalheInteresse').innerText || 'questão jurídica';
        if (!telefone || telefone === '---' || telefone.trim() === '') {
            alert("Este lead não possui telefone cadastrado.");
            return;
        }
        const foneLimpo = telefone.replace(/\D/g, '');
        const mensagem = window.encodeURIComponent(gerarMsgWhatsApp(etapa, nome, area));
        window.open(`https://wa.me/55${foneLimpo}?text=${mensagem}`, '_blank');
    }

    function enviarFichaWhatsApp() {
        const telefone = document.getElementById('detalheTelefone').innerText;
        const nome = document.getElementById('detalheNome').innerText;
        if (!telefone || telefone === '---' || telefone.trim() === '') {
            alert("Este lead não possui telefone cadastrado.");
            return;
        }
        const foneLimpo = telefone.replace(/\D/g, '');
        const linkFicha = `https://lawtechpro.com.br/ficha-cliente.html?leadId=${leadSelecionadoId}`;
        const mensagem = window.encodeURIComponent(
            `Olá ${nome}, seja bem-vindo ao escritório! Para darmos início ao seu atendimento, por favor preencha sua ficha de cadastro: ${linkFicha}`
        );
        window.open(`https://wa.me/55${foneLimpo}?text=${mensagem}`, '_blank');
    }

    const tipoIcone = {
        criado:            '👤',
        status_alterado:   '↗',
        email_enviado:     '✉',
        nota_salva:        '📝',
        reativacao_enviada:'🔄',
        lembrete:          '⏰'
    };

    async function carregarAtividades(leadId) {
        const lista = document.getElementById('timelineLista');
        if (!lista) return;
        lista.innerHTML = '<span class="timeline-empty">Carregando...</span>';
        try {
            const res = await fetch(`/api/crm/leads/${leadId}/atividades`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Falha');
            const atividades = await res.json();
            if (!atividades.length) {
                lista.innerHTML = '<span class="timeline-empty">Nenhuma atividade registrada.</span>';
                return;
            }
            lista.innerHTML = atividades.map(a => {
                const icone = tipoIcone[a.tipo] || '●';
                const dt = new Date(a.criado_em);
                const hora = dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                return `<div class="timeline-item">
                    <span class="timeline-icon">${icone}</span>
                    <div class="timeline-body">
                        <div class="timeline-desc">${a.descricao || a.tipo}</div>
                        <div class="timeline-time">${hora}</div>
                    </div>
                </div>`;
            }).join('');
        } catch (e) {
            lista.innerHTML = '<span class="timeline-empty">Erro ao carregar histórico.</span>';
        }
    }

    function enviarLinkFicha() {
        const nome = document.getElementById('detalheNome').innerText;
        const telefone = document.getElementById('detalheTelefone').innerText;
        const foneLimpo = telefone.replace(/\D/g, '');
        
        const linkFicha = `https://lawtechpro.com.br/ficha-cliente.html?leadId=${leadSelecionadoId}`;
        
        const mensagem = window.encodeURIComponent(`Parabéns pelo fechamento, ${nome}! 🚀 Para iniciarmos seu processo, por favor, preencha seus dados oficiais neste link seguro: ${linkFicha}`);
        
        window.open(`https://wa.me/55${foneLimpo}?text=${mensagem}`, '_blank');
    }

    function aplicarMascaraTelefone(input) {
        input.addEventListener('input', (e) => {
            let valor = e.target.value.replace(/\D/g, '');
            if (valor.length > 11) valor = valor.substring(0, 11);

            let formatado = '';
            if (valor.length > 0) formatado = '(' + valor.substring(0, 2);
            if (valor.length > 2) formatado += ') ' + valor.substring(2, 7);
            if (valor.length > 7) formatado += '-' + valor.substring(7);

            e.target.value = formatado;
        });
    }

    function toggleUserMenu() {
        const m = document.getElementById('userDropdown');
        if (m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
    }

    window.addEventListener('click', (e) => {
        if (!e.target.closest('#userCircle') && !e.target.closest('#userDropdown')) {
            const m = document.getElementById('userDropdown');
            if (m) m.style.display = 'none';
        }
    });

    window.onload = () => {
        carregarInfoRodape();
        carregarDadosEscritorio();
        carregarLeads();

        const form = document.getElementById('formNovoLead');
        if (form) form.addEventListener('submit', salvarNovoLead);

        const telefoneInput = document.getElementById('novoTelefone');
        if (telefoneInput) aplicarMascaraTelefone(telefoneInput);

        setInterval(carregarLeads, 30000);
    };

    function atualizarBadgeCRM(quantidade) {
        const btnCRM = document.getElementById('nav-crm-button');
        if (!btnCRM) return;

        const badgeAntiga = document.getElementById('badge-crm-alerta');
        if (badgeAntiga) badgeAntiga.remove();

        if (quantidade > 0) {
            const badge = document.createElement('span');
            badge.id = 'badge-crm-alerta';
            badge.innerText = quantidade;
            badge.style = `
                position: absolute;
                top: 6px;
                right: 12px;
                background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4),
                            0 0 0 2px #111827,
                            0 0 0 3px rgba(239, 68, 68, 0.3);
                color: white;
                font-size: 11px;
                font-weight: 700;
                padding: 3px 7px;
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10;
                animation: pulse-badge 2s ease-in-out infinite;
            `;
            btnCRM.appendChild(badge);
        }
    }

    function logout() {
        localStorage.removeItem('token');
        window.location.href = '/login.html';
    }

    function toggleIaMenu(event) {
    event.preventDefault(); // impede navegação imediata
    const submenu = document.getElementById('submenu-ia');
    submenu.classList.toggle('open');
}

document.addEventListener('DOMContentLoaded', () => {
    localStorage.removeItem('novoLead');

    const crmDot = document.getElementById('crmDot');
    if (crmDot) {
        crmDot.style.display = 'none';
    }
});


(function(){var t=localStorage.getItem('token');if(!t)return;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){return r.json()}).then(function(d){if(d.ok){var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}}).catch(function(){})}checkChat();setInterval(checkChat,30000)})();
