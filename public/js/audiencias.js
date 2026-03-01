
        // ========== VERSÃO ATUALIZADA - 13/02/2026 11:30 ==========
        console.log('🎯 AUDIENCIAS.HTML CARREGADO - VERSÃO 13/02/2026 11:30');
        console.log('✅ Função abrirModalRegistrarAta: ', typeof abrirModalRegistrarAta !== 'undefined' ? 'EXISTE' : 'NÃO EXISTE');
        
        const token = localStorage.getItem('token');
        if (!token) window.location.href = '/login';

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
        });
        
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

        // Carregar informações do usuário
        async function carregarInfoUsuario() {
            try {
                const res = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
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
                const res = await fetch('/api/plano-consumo', { headers: { 'Authorization': `Bearer ${token}` } });
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

        // Carregar audiências
        async function carregarAudiencias() {
            try {
                const res = await fetch('/api/audiencias', { headers: { 'Authorization': `Bearer ${token}` } });
                const dados = await res.json();
                
                const corpoFuturas = document.getElementById('listaAudiencias');
                const corpoRealizadas = document.getElementById('listaAudienciasRealizadas');
                
                if (!dados || dados.length === 0) {
                    corpoFuturas.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:60px 20px; color:var(--muted);"><i class="lucide lucide-calendar-x" style="font-size:48px; margin-bottom:16px;"></i><p style="font-weight:600; font-size:16px;">NENHUMA AUDIÊNCIA AGENDADA</p></td></tr>';
                    corpoRealizadas.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:60px 20px; color:var(--muted);"><i class="lucide lucide-calendar-check" style="font-size:48px; margin-bottom:16px;"></i><p style="font-weight:600; font-size:16px;">NENHUMA AUDIÊNCIA REALIZADA</p></td></tr>';
                    lucide.createIcons();
                    return;
                }

                // Separar audiências
                const hoje = new Date();
                hoje.setHours(0, 0, 0, 0);
                const futuras = [];
                const realizadas = [];

                dados.forEach(a => {
                    if (a.data_audiencia) {
                        let dataAud;
                        if (a.data_audiencia.includes('T')) {
                            dataAud = new Date(a.data_audiencia);
                        } else {
                            dataAud = new Date(a.data_audiencia + 'T00:00:00');
                        }
                        dataAud.setHours(0, 0, 0, 0);
                        
                        if (a.realizada === true) {
                            realizadas.push(a);
                        } else if (dataAud < hoje) {
                            realizadas.push(a);
                        } else {
                            futuras.push(a);
                        }
                    }
                });

                // Atualizar contadores
                document.getElementById('totalAudiencias').innerText = dados.length;
                document.getElementById('audienciasAgendadas').innerText = futuras.length;
                document.getElementById('audienciasRealizadas').innerText = realizadas.length;
                document.getElementById('contadorFuturas').innerText = futuras.length;
                document.getElementById('contadorRealizadas').innerText = realizadas.length;

                // Renderizar agendadas
                if (futuras.length === 0) {
                    corpoFuturas.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:60px 20px; color:var(--muted);"><i class="lucide lucide-calendar-x" style="font-size:48px; margin-bottom:16px;"></i><p style="font-weight:600; font-size:16px;">NENHUMA AUDIÊNCIA AGENDADA</p></td></tr>';
                } else {
                    corpoFuturas.innerHTML = futuras.map(a => {
                        const dataFormatada = a.data_audiencia ? new Date(a.data_audiencia).toLocaleDateString('pt-BR') : '---';
                        const horaFormatada = a.hora_audiencia ? a.hora_audiencia.slice(0,5) : '--:--';

                        // Calcular badge de alerta
                        let alertaBadge = '';
                        let alertaStyle = '';
                        
                        if (a.data_audiencia) {
                            let dataAud = a.data_audiencia.includes('T') ? new Date(a.data_audiencia) : new Date(a.data_audiencia + 'T00:00:00');
                            dataAud.setHours(0, 0, 0, 0);
                            
                            const diffTime = dataAud - hoje;
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                            
                            if (diffDays === 0) {
                                alertaBadge = '<span class="badge badge-hoje">HOJE</span>';
                                alertaStyle = 'background: rgba(239, 68, 68, 0.05); border-left: 3px solid #ef4444;';
                            } else if (diffDays === 1) {
                                alertaBadge = '<span class="badge badge-amanha">AMANHÃ</span>';
                                alertaStyle = 'background: rgba(245, 158, 11, 0.05); border-left: 3px solid #f59e0b;';
                            } else if (diffDays <= 7) {
                                alertaBadge = `<span class="badge badge-proximo">FALTAM ${diffDays} DIAS</span>`;
                            } else {
                                alertaBadge = `<span class="badge badge-proximo">FALTAM ${diffDays} DIAS</span>`;
                            }
                        }

                        return `
                        <tr style="${alertaStyle}">
                            <td>
                                <strong style="color:var(--primary); display:block; margin-bottom:4px;">${dataFormatada}</strong>
                                <span style="font-size:12px; font-weight:600; color:var(--muted);">${horaFormatada}</span>
                                ${alertaBadge}
                            </td>
                            <td>
                                <div style="font-weight:700; color:var(--text-main); margin-bottom:4px;">${a.processo_numero || 'SEM NÚMERO'}</div>
                                <div style="font-size:12px; color:var(--muted);">${a.cliente || 'CLIENTE NÃO INFORMADO'}</div>
                            </td>
                            <td><span style="background:#f1f5f9; padding:6px 12px; border-radius:6px; font-size:11px; font-weight:700;">${(a.tipo_audiencia || a.tipo || 'AUDIÊNCIA').toUpperCase()}</span></td>
                            <td style="font-size:12px; color:var(--muted); max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${a.local_virtual || a.local || '---'}</td>
                            <td>
                                <div class="action-buttons">
                                    <button class="btn-action btn-whatsapp" onclick="avisarZap('${a.cliente}', '${a.processo_numero}', '${a.tipo_audiencia}', '${a.data_audiencia}', '${a.hora_audiencia}', '${a.local_virtual}', '${a.telefone}')">
                                        <i class="lucide lucide-message-circle"></i>
                                        <span>WHATSAPP</span>
                                    </button>
                                    <button class="btn-action btn-link-edit" data-local-id="${a.id}" data-local-valor="${(a.local_virtual || '').replace(/"/g, '&quot;')}" onclick="abrirModalEditarLocalSeguro(this)">
                                        <i class="lucide lucide-link"></i>
                                        <span>EDITAR LINK</span>
                                    </button>
                                    <button class="btn-action btn-realizada" onclick="abrirModalRegistrarAta(${a.id})">
                                        <i class="lucide lucide-check"></i>
                                        <span>REALIZADA</span>
                                    </button>
                                    <button class="btn-action btn-delete" onclick="excluirAudiencia(${a.id})">
                                        <i class="lucide lucide-trash-2"></i>
                                        <span>EXCLUIR</span>
                                    </button>
                                </div>
                            </td>
                        </tr>
                        `;
                    }).join('');
                }

                // Renderizar realizadas
                if (realizadas.length === 0) {
                    corpoRealizadas.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:60px 20px; color:var(--muted);"><i class="lucide lucide-calendar-check" style="font-size:48px; margin-bottom:16px;"></i><p style="font-weight:600; font-size:16px;">NENHUMA AUDIÊNCIA REALIZADA</p></td></tr>';
                } else {
                    corpoRealizadas.innerHTML = realizadas.map(a => {
                        const dataFormatada = a.data_audiencia ? new Date(a.data_audiencia).toLocaleDateString('pt-BR') : '---';
                        const horaFormatada = a.hora_audiencia ? a.hora_audiencia.slice(0,5) : '--:--';

                        return `
                        <tr>
                            <td>
                                <strong style="color:var(--muted); display:block; margin-bottom:4px;">${dataFormatada}</strong>
                                <span style="font-size:12px; font-weight:600; color:var(--muted);">${horaFormatada}</span>
                            </td>
                            <td>
                                <div style="font-weight:700; color:var(--text-main); margin-bottom:4px;">${a.processo_numero || 'SEM NÚMERO'}</div>
                                <div style="font-size:12px; color:var(--muted);">${a.cliente || 'CLIENTE NÃO INFORMADO'}</div>
                            </td>
                            <td><span style="background:#f1f5f9; padding:6px 12px; border-radius:6px; font-size:11px; font-weight:700;">${(a.tipo_audiencia || a.tipo || 'AUDIÊNCIA').toUpperCase()}</span></td>
                            <td style="font-size:12px; color:var(--muted); max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${a.local_virtual || a.local || '---'}</td>
                            <td>
                                <div class="action-buttons">
                                    <button class="btn-action btn-edit" data-ata-id="${a.id}" data-ata-texto="${(a.ata_audiencia || '').replace(/"/g, '&quot;').replace(/\n/g, '&#10;')}" onclick="abrirModalVerAtaSeguro(this)">
                                        <i class="lucide lucide-file-text"></i>
                                        <span>VER ATA</span>
                                    </button>
                                    <button class="btn-action btn-delete" onclick="excluirAudiencia(${a.id})">
                                        <i class="lucide lucide-trash-2"></i>
                                        <span>EXCLUIR</span>
                                    </button>
                                </div>
                            </td>
                        </tr>
                        `;
                    }).join('');
                }

                lucide.createIcons();
            } catch (err) {
                console.error("Erro ao carregar audiências:", err);
                document.getElementById('listaAudiencias').innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--danger); font-weight:600;">❌ ERRO AO CARREGAR AUDIÊNCIAS</td></tr>';
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
                const res = await fetch('/api/processos', { headers: { 'Authorization': `Bearer ${token}` } });
                const processos = await res.json();
                
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
                const res = await fetch('/api/clientes', { headers: { 'Authorization': `Bearer ${token}` } });
                const clientes = await res.json();
                
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
                const res = await fetch('/api/audiencias', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}` 
                    },
                    body: JSON.stringify(dados)
                });

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
                const resAta = await fetch(`/api/audiencias/${audienciaAtaId}/ata`, {
                    method: 'PUT',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}` 
                    },
                    body: JSON.stringify({ ata_audiencia: ataTexto })
                });

                if (!resAta.ok) {
                    const erro = await resAta.json();
                    alert("❌ ERRO AO SALVAR ATA: " + (erro.erro || erro.error || 'Erro desconhecido'));
                    return;
                }

                // 2. Se estiver no modo REGISTRAR, marcar como realizada
                if (modoRegistrarAta) {
                    const resRealizada = await fetch(`/api/audiencias/${audienciaAtaId}/realizada`, {
                        method: 'PUT',
                        headers: { 
                            'Authorization': `Bearer ${token}` 
                        }
                    });

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
                const res = await fetch(`/api/audiencias/${id}`, { 
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
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
                const res = await fetch(`/api/audiencias/${audienciaLocalId}/local`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ local_virtual: local })
                });
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
                s.textContent = `.btn-action.btn-delete { display: none !important; }`;
            } else {
                // visualizador: esconde delete, criar e editar link
                s.textContent = `.btn-action.btn-delete, .btn-action.btn-link-edit, button[onclick*='abrirModal()'] { display: none !important; }`;
            }
            document.head.appendChild(s);
        }
    

(function(){var t=localStorage.getItem('token');if(!t)return;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){return r.json()}).then(function(d){if(d.ok){var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}}).catch(function(){})}checkChat();setInterval(checkChat,30000)})();
