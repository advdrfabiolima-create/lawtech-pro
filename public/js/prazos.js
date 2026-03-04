// Inicializar Lucide Icons
    lucide.createIcons();

    // Variáveis globais
    const token = localStorage.getItem('token');
    if (!token) window.location.href = '/login.html';
    
    let todosPrazos = [];
    let prazoAtualId = null;
    let arquivoPDFTemporario = null;

    // Carregar dados ao iniciar
    document.addEventListener('DOMContentLoaded', async () => {
        await carregarInfoRodape();
        await carregarPrazosModernos();
    });

    // Carregar informações do rodapé e usuário
    async function carregarInfoRodape() {
        try {
            const resUser = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
            const dataUser = await resUser.json();
            
            if (dataUser.ok) {
                const emailElement = document.getElementById('userEmail');
                if (emailElement) {
                    emailElement.innerText = dataUser.usuario.email || 'Não disponível';
                }

                const nomeCompleto = dataUser.usuario.nome || 'Advogado';
                const primeiroNome = nomeCompleto.trim().split(' ')[0];
                const nameHeader = document.getElementById('userNameHeader');
                if (nameHeader) nameHeader.innerText = primeiroNome;

                const partes = nomeCompleto.trim().split(' ').filter(n => n);
                let iniciais = partes[0][0];
                if (partes.length > 1) iniciais += partes[partes.length - 1][0];
                
                const circulo = document.getElementById('userCircle');
                if (circulo) circulo.innerText = iniciais.toUpperCase();

                window._userRole = dataUser.usuario.role || 'visualizador';
                aplicarPermissoesRoleUI(window._userRole);
            }

            const resPlan = await fetch('/api/plano-consumo', { headers: { Authorization: `Bearer ${token}` } });
            const dataPlan = await resPlan.json();
            
            const planoElement = document.getElementById('planNameFooter');
            if (planoElement) {
                planoElement.innerText = dataPlan.plano || 'Free';
            }
        } catch (err) { 
            console.error("Erro ao carregar rodapé:", err); 
        }
    }

    // Motor de Prazos
    async function carregarPrazosModernos() {
        const map = [
            { url: '/api/prazos?status=aberto', container: 'lista-futuros', classe: 'futuro' },
            { url: '/api/prazos-concluidos', container: 'lista-concluidos', classe: 'concluido' }
        ];
        
        console.log('🔄 [CARREGAR] Iniciando carregamento de prazos...');
        
        todosPrazos = [];
        mostrarLoader();

        for (const item of map) {
            try {
                console.log(`📡 [CARREGAR] Buscando: ${item.url}`);
                const urlPaginada = item.url + (item.url.includes('?') ? '&' : '?') + 'limit=200';
                const res = await fetch(urlPaginada, { headers: { Authorization: `Bearer ${token}` } });
                const respPrazos = await res.json();
                const prazos = respPrazos.data || respPrazos;

                console.log(`✅ [CARREGAR] Recebidos ${prazos.length} prazos de ${item.url}`);
                console.log(`📦 [CARREGAR] Container: ${item.container}, Classe: ${item.classe}`);
                
                const container = document.getElementById(item.container);
                
                if (!container) {
                    console.error('❌ [CARREGAR] Container não encontrado:', item.container);
                    continue;
                }
                
                console.log(`🧹 [CARREGAR] Limpando container ${item.container}...`);
                container.innerHTML = '';
                
                if (prazos.length === 0) {
                    const mensagem = item.classe === 'concluido' 
                        ? 'Nenhum prazo concluído ainda.' 
                        : 'Nenhum prazo ativo encontrado.';
                    container.innerHTML = `<p style="color:var(--muted); font-size:13px; padding:20px; text-align:center; background:#f8fafc; border-radius:8px;">${mensagem}</p>`;
                    console.log(`ℹ️ [CARREGAR] Container ${item.container} vazio`);
                    continue;
                }

                prazos.forEach(p => {
                    if (!p.tem_anexo && p.anexo_pdf) {
                        p.tem_anexo = true;
                    }

                    // ✅ IMPORTANTE: Marcar status correto
                    p.concluido = (item.classe === 'concluido' || p.status === 'concluido');
                    
                    todosPrazos.push({ ...p, status: item.classe });
                    
                    // Se for prazo concluído, renderiza diferente
                    if (item.classe === 'concluido') {
                        const dataConclusao = p.concluido_em ? new Date(p.concluido_em).toLocaleDateString('pt-BR') : 'N/A';
                        
                        container.innerHTML += `
                        <div class="prazo concluido" 
                             onclick="exibirObservacaoAtualizada(${p.id})" 
                             style="cursor:pointer; opacity:0.85;" data-prazo-id="${p.id}">
                            
                            <div style="flex: 1;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                                    <strong style="font-size: 15px; color: var(--sidebar);">${p.tipo || 'Prazo'}</strong>
                                    <span class="badge" style="background: #ecfdf5; color: #10b981; border: 1px solid #d1fae5; font-size: 10px; font-weight: 800;">
                                        ✅ CONCLUÍDO
                                    </span>
                                </div>
                                
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <i data-lucide="user" style="width: 14px; color: var(--muted);"></i>
                                        <span style="font-size: 13px; font-weight: 700; color: var(--text-main); text-transform: uppercase;">
                                            ${p.cliente_nome || 'Cliente não identificado'}
                                        </span>
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 8px; padding-left: 20px;">
                                        <span style="background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-family: monospace;">
                                            NPU: ${p.processo_numero || 'Não vinculado'}
                                        </span>
                                    </div>
                                </div>
                                <small style="display: block; margin-top: 8px; color:var(--muted);">
                                    ✅ Concluído em: ${dataConclusao}
                                </small>
                            </div>

                            <div class="actions-prazo" onclick="event.stopPropagation()">
                                ${(p.tem_anexo || p.anexo_pdf) ? `
                                <button onclick="visualizarAnexoPrazo(${p.id})" class="btn-action view" title="Visualizar Anexo" style="color: #8b5cf6;">
                                    <i data-lucide="paperclip"></i>
                                </button>
                                ` : ''}
                                <button onclick="excluirPrazo(${p.id})" class="btn-action danger" title="Excluir">
                                    <i data-lucide="trash-2"></i>
                                </button>
                            </div>
                        </div>`;
                    } else {
                        // Prazos não concluídos (renderização original)
                        const hoje = new Date();
                        hoje.setHours(0,0,0,0);
                        const vencimento = new Date(p.data_limite);
                        vencimento.setHours(0,0,0,0);
                        const diff = Math.ceil((vencimento - hoje) / (1000 * 60 * 60 * 24));

                        let estiloTag = 'background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0;';
                        let classeCard = 'futuro';

                        if (diff < 0) {
                            estiloTag = 'background: #fef2f2; color: #ef4444; border: 1px solid #fecaca;';
                            classeCard = 'vencido';
                        } else if (diff === 0 || diff === 1) {
                            estiloTag = 'background: #fffbeb; color: #d97706; border: 1px solid #fde68a;';
                            classeCard = 'semana';
                        }

                        const contagemDias = calcularDiferencaDiasFormatado(p.data_limite);
                        const urgencia = calcularUrgencia(p.data_limite);

                        container.innerHTML += `
                        <div class="prazo ${classeCard}" 
                             onclick="exibirObservacaoAtualizada(${p.id})" 
                             style="cursor:pointer;" data-prazo-id="${p.id}">
                            
                            <div style="flex: 1;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                                    <strong style="font-size: 15px; color: var(--sidebar);">${p.tipo || 'Prazo'}</strong>
                                    <span class="badge" style="${estiloTag} font-size: 10px; font-weight: 800;">
                                        ${contagemDias}
                                    </span>
                                    ${urgencia ? `<span class="badge ${urgencia.classe}">${urgencia.label}</span>` : ''}
                                </div>
                                
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <i data-lucide="user" style="width: 14px; color: var(--muted);"></i>
                                        <span style="font-size: 13px; font-weight: 700; color: var(--text-main); text-transform: uppercase;">
                                            ${p.cliente_nome || 'Cliente não identificado'}
                                        </span>
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 8px; padding-left: 20px;">
                                        <span style="background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-family: monospace;">
                                            NPU: ${p.processo_numero || 'Não vinculado'}
                                        </span>
                                    </div>
                                </div>
                                <small style="display: block; margin-top: 8px; color:var(--muted);">
                                    📅 Vencimento: ${new Date(p.data_limite).toLocaleDateString('pt-BR')}
                                </small>
                            </div>

                            <div class="actions-prazo" onclick="event.stopPropagation()">
                                <button onclick="concluirPrazo(${p.id})" class="btn-action success" title="Concluir">
                                    <i data-lucide="check-circle"></i>
                                </button>
                                <button onclick="editarPrazo(${p.id})" class="btn-action edit" title="Editar">
                                    <i data-lucide="edit-3"></i>
                                </button>
                                ${(p.tem_anexo || p.anexo_pdf) ? `
                                <button onclick="visualizarAnexoPrazo(${p.id})" class="btn-action view" title="Visualizar Anexo" style="color: #8b5cf6;">
                                    <i data-lucide="paperclip"></i>
                                </button>
                                ` : ''}
                                <button onclick="excluirPrazo(${p.id})" class="btn-action danger" title="Excluir">
                                    <i data-lucide="trash-2"></i>
                                </button>
                            </div>
                        </div>`;
                    }
                });

                setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 100);

            } catch (err) { 
                console.error("Erro ao carregar prazos:", err); 
                const container = document.getElementById(item.container);
                if (container) {
                    container.innerHTML = '<p style="color:var(--danger); padding:10px;">Erro ao carregar prazos.</p>';
                }
            }
        }
        
        esconderLoader();
        atualizarEstatisticas();
        
        // Garantir que apenas a lista correta está visível
        const listaFuturos = document.getElementById('lista-futuros');
        const listaConcluidos = document.getElementById('lista-concluidos');
        
        const abaConcluidosAtiva = document.querySelector('.filter-tab[data-filter="concluidos"].active');
        
        if (abaConcluidosAtiva) {
            console.log('🎯 [CARREGAR] Aba Concluídos está ativa - mantendo visível');
            listaFuturos.style.display = 'none';
            listaConcluidos.style.display = 'block';
        } else {
            console.log('🎯 [CARREGAR] Aba Ativos está ativa - escondendo Concluídos');
            listaFuturos.style.display = 'block';
            listaConcluidos.style.display = 'none';
        }
    }

    // ✅ CORRIGIDO: Atualizar estatísticas
    function atualizarEstatisticas() {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        const stats = {
            total: 0,
            vencidos: 0,
            iminentes: 0,
            concluidos: 0
        };

        // Contar a partir de todosPrazos que já tem todos os dados
        stats.total = todosPrazos.filter(p => !p.concluido).length;
        stats.concluidos = todosPrazos.filter(p => p.concluido).length;

        todosPrazos.forEach(prazo => {
            if (prazo.concluido) return; // Pular concluídos
            
            const dataLimite = new Date(prazo.data_limite);
            dataLimite.setHours(0, 0, 0, 0);
            const diasRestantes = Math.ceil((dataLimite - hoje) / (1000 * 60 * 60 * 24));

            if (diasRestantes < 0) {
                stats.vencidos++;
            } else if (diasRestantes <= 5) {
                stats.iminentes++;
            }
        });

        document.getElementById('totalPrazos').textContent = stats.total;
        document.getElementById('totalVencidos').textContent = stats.vencidos;
        document.getElementById('totalIminentes').textContent = stats.iminentes;
        document.getElementById('totalConcluidos').textContent = stats.concluidos;
        
        console.log('📊 [ESTATÍSTICAS] Total:', stats.total, '| Concluídos:', stats.concluidos);
    }

    // Funções auxiliares
    function calcularDiferencaDiasFormatado(dataVencimento) {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const vencimento = new Date(dataVencimento);
        vencimento.setHours(0, 0, 0, 0);
        
        const diffTime = vencimento - hoje;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return `VENCIDO HÁ ${Math.abs(diffDays)} DIAS`;
        if (diffDays === 0) return "VENCE HOJE";
        if (diffDays === 1) return "VENCE AMANHÃ";
        return `VENCE EM ${diffDays} DIAS`;
    }

    function calcularUrgencia(data) {
        const diff = Math.ceil((new Date(data) - new Date()) / (1000 * 60 * 60 * 24));
        if (diff === 0) return { label: 'HOJE', classe: 'urgente-hoje' };
        if (diff === 1) return { label: 'AMANHÃ', classe: 'urgente-amanha' };
        return null;
    }

    function verDetalhesPrazo(texto) {
        const modal = document.getElementById('modalIA');
        const content = document.getElementById('aiResponseContent');

        if (modal && content) {
            content.innerText = texto;
            modal.style.display = 'flex';
        } else {
            alert("Observações:\n" + texto);
        }
    }

    function exibirObservacaoAtualizada(id) {
        const prazo = todosPrazos.find(x => x.id === id);
        const texto = (prazo && prazo.descricao && prazo.descricao.trim() !== "") 
                      ? prazo.descricao 
                      : "Sem observações cadastradas para este prazo.";
                      
        verDetalhesPrazo(texto);
    }

    function mostrarLoader() { 
        const loader = document.getElementById('loader');
        if (loader) loader.style.display = 'flex'; 
    }
    
    function esconderLoader() { 
        const loader = document.getElementById('loader');
        if (loader) loader.style.display = 'none'; 
    }

    // Abrir modal
    function abrirModalPrazo() {
        document.getElementById('prazoId').value = '';
        document.getElementById('tipoPrazo').value = '';
        document.getElementById('dataPrazo').value = '';
        document.getElementById('descricaoPrazo').value = '';
        document.getElementById('clienteId').value = '';
        
        const selectProcesso = document.getElementById('processoId');
        selectProcesso.disabled = false;
        selectProcesso.style.backgroundColor = "";
        selectProcesso.style.cursor = "";
        
        carregarProcessosSelect();
        carregarClientesSelect();

        prazoAtualId = null;
        arquivoPDFTemporario = null;
        document.getElementById('pdfCard').style.display = 'none';
        document.getElementById('uploadArea').style.display = 'block';

        document.getElementById('modalPrazo').style.display = 'flex';

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    // Carregar processos no select
    async function carregarProcessosSelect() {
        const select = document.getElementById('processoId');
        try {
            const res = await fetch('/api/processos?limit=200', { headers: { Authorization: `Bearer ${token}` } });
            const resp = await res.json();
            const processos = resp.data || resp;
            select.innerHTML = '<option value="">Selecione o Processo</option>';
            processos.forEach(p => {
                select.innerHTML += `<option value="${p.id}">${p.numero}</option>`;
            });
        } catch (err) {
            console.error('Erro ao carregar processos:', err);
        }
    }

    // Carregar clientes no select
    async function carregarClientesSelect() {
        try {
            const res = await fetch('/api/clientes?limit=200', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const rPC = await res.json();
            const clientes = rPC.data || rPC;
            const select = document.getElementById('clienteId');
            
            select.innerHTML = '<option value="">Selecione um cliente (opcional)</option>';
            
            clientes.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.nome;
                select.appendChild(opt);
            });
        } catch (err) {
            console.error('Erro ao carregar clientes:', err);
        }
    }

    // Fechar modal
    function fecharModalPrazo() { 
        document.getElementById('modalPrazo').style.display = 'none'; 
        document.getElementById('prazoId').value = '';
        
        const selectProcesso = document.getElementById('processoId');
        if (selectProcesso) {
            selectProcesso.disabled = false;
            selectProcesso.style.backgroundColor = "#fff";
        }
        
        arquivoPDFTemporario = null;
        prazoAtualId = null;
    }

    // Salvar prazo
    async function salvarPrazo() {
        const prazoId = document.getElementById('prazoId').value;
        const processoId = document.getElementById('processoId').value;
        const clienteId = document.getElementById('clienteId').value || null;
        const tipo = document.getElementById('tipoPrazo').value.trim();
        const dataLimite = document.getElementById('dataPrazo').value;
        const descricao = document.getElementById('descricaoPrazo').value.trim();

        if (!processoId || !tipo || !dataLimite) {
            alert('Preencha todos os campos obrigatórios!');
            return;
        }

        try {
            const url = prazoId ? `/api/prazos/${prazoId}` : '/api/prazos';
            const method = prazoId ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    processoId,
                    clienteId,
                    tipo,
                    dataLimite,
                    descricao
                })
            });

            if (!res.ok) {
                const data = await res.json();
                alert(data.erro || 'Erro ao salvar');
                return;
            }

            const resultado = await res.json();
            
            // Se criou prazo novo e tem PDF temporário, fazer upload
            if (!prazoId && arquivoPDFTemporario) {
                if (resultado.id) {
                    await uploadPDFAposSalvar(resultado.id);
                } else {
                    await uploadPDFParaUltimoPrazo(processoId, tipo, dataLimite);
                }
            }
            
            alert('✅ Prazo salvo com sucesso!');
            fecharModalPrazo();
            await carregarPrazosModernos();
        } catch (err) {
            alert('Erro de conexão');
        }
    }

    // Upload de PDF
    async function uploadPDF() {
        const fileInput = document.getElementById('pdfInput');
        const file = fileInput.files[0];
        
        if (!file) return;
        
        if (file.type !== 'application/pdf') {
            alert('❌ Apenas arquivos PDF são permitidos!');
            fileInput.value = '';
            return;
        }
        
        if (file.size > 10 * 1024 * 1024) {
            alert('❌ Arquivo muito grande! Tamanho máximo: 10MB');
            fileInput.value = '';
            return;
        }
        
        // Se está criando prazo, armazenar temporariamente
        if (!prazoAtualId || prazoAtualId === '' || prazoAtualId === 'null') {
            arquivoPDFTemporario = file;
            
            document.getElementById('uploadArea').style.display = 'none';
            document.getElementById('pdfCard').style.display = 'flex';
            document.getElementById('pdfName').textContent = file.name;
            document.getElementById('pdfSize').textContent = formatarTamanho(file.size);
            
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
            
            console.log('📎 PDF armazenado temporariamente:', file.name);
            fileInput.value = '';
            return;
        }
        
        // Se já tem ID (editando), fazer upload imediatamente
        try {
            const formData = new FormData();
            formData.append('pdf', file);
            
            const response = await fetch(`/api/prazos/${prazoAtualId}/anexo`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });
            
            const result = await response.json();
            
            if (response.ok) {
                document.getElementById('pdfCard').style.display = 'flex';
                document.getElementById('uploadArea').style.display = 'none';
                document.getElementById('pdfName').textContent = file.name;
                document.getElementById('pdfSize').textContent = formatarTamanho(file.size);
                
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
                
                alert('✅ PDF anexado com sucesso!');
            } else {
                throw new Error(result.erro || 'Erro ao anexar PDF');
            }
            
        } catch (err) {
            console.error('❌ Erro no upload:', err);
            alert('❌ Erro ao anexar PDF: ' + err.message);
        }
        
        fileInput.value = '';
    }

    // Upload PDF após salvar
    async function uploadPDFAposSalvar(prazoId) {
        if (!arquivoPDFTemporario) return;
        
        try {
            const formData = new FormData();
            formData.append('pdf', arquivoPDFTemporario);
            
            const response = await fetch(`/api/prazos/${prazoId}/anexo`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });
            
            if (response.ok) {
                console.log('✅ PDF anexado ao prazo recém-criado!');
                arquivoPDFTemporario = null;
            } else {
                const result = await response.json();
                throw new Error(result.erro || 'Erro ao anexar PDF');
            }
            
        } catch (err) {
            console.error('❌ Erro ao anexar PDF:', err);
            alert('⚠️ Prazo salvo, mas ocorreu um erro ao anexar o PDF.');
            arquivoPDFTemporario = null;
        }
    }

    // Upload PDF para último prazo
    async function uploadPDFParaUltimoPrazo(processoId, tipo, dataLimite) {
        if (!arquivoPDFTemporario) return;
        
        try {
            const response = await fetch('/api/prazos', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Erro ao buscar prazos');
            }
            
            const prazos = await response.json();
            
            const prazoEncontrado = prazos.find(p => 
                p.processo_id == processoId && 
                p.tipo === tipo && 
                p.data_limite.startsWith(dataLimite)
            );
            
            if (!prazoEncontrado) {
                throw new Error('Prazo recém-criado não encontrado');
            }
            
            await uploadPDFAposSalvar(prazoEncontrado.id);
            
        } catch (err) {
            console.error('❌ Erro ao buscar prazo para anexar PDF:', err);
            alert('⚠️ Prazo salvo, mas ocorreu um erro ao anexar o PDF.');
            arquivoPDFTemporario = null;
        }
    }

    // Formatar tamanho
    function formatarTamanho(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // Visualizar PDF
    async function visualizarPDF() {
        if (!prazoAtualId) {
            alert('❌ ID do prazo não encontrado');
            return;
        }
        
        try {
            const response = await fetch(`/api/prazos/${prazoAtualId}/anexo`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Erro ao buscar PDF');
            }
            
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            window.open(blobUrl, '_blank');
            
        } catch (err) {
            console.error('❌ Erro ao visualizar PDF:', err);
            alert('❌ Erro ao visualizar PDF');
        }
    }

    // Visualizar anexo do prazo
    async function visualizarAnexoPrazo(prazoId) {
        if (!prazoId) {
            alert('❌ ID do prazo não encontrado');
            return;
        }
        
        try {
            const response = await fetch(`/api/prazos/${prazoId}/anexo`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Erro ao buscar PDF');
            }
            
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            window.open(blobUrl, '_blank');
            
        } catch (err) {
            console.error('❌ Erro ao visualizar PDF:', err);
            alert('❌ Erro ao visualizar anexo');
        }
    }

    // Deletar PDF
    async function deletarPDF() {
        if (!confirm('Tem certeza que deseja remover este PDF?')) return;
        
        if (!prazoAtualId) {
            alert('❌ ID do prazo não encontrado');
            return;
        }
        
        try {
            const response = await fetch(`/api/prazos/${prazoAtualId}/anexo`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                document.getElementById('pdfCard').style.display = 'none';
                document.getElementById('uploadArea').style.display = 'block';
                alert('✅ PDF removido com sucesso!');
            } else {
                const result = await response.json();
                throw new Error(result.erro || 'Erro ao deletar PDF');
            }
            
        } catch (err) {
            console.error('❌ Erro ao deletar:', err);
            alert('❌ Erro ao remover PDF: ' + err.message);
        }
    }

    // Editar prazo
    async function editarPrazo(id) {
        const prazo = todosPrazos.find(p => p.id === id);
        if (!prazo) {
            console.error('Prazo não encontrado');
            return;
        }

        prazoAtualId = id;
        
        document.getElementById('prazoId').value = id;
        document.getElementById('processoId').value = prazo.processo_id || '';
        document.getElementById('tipoPrazo').value = prazo.tipo || '';
        document.getElementById('dataPrazo').value = prazo.data_limite || '';
        document.getElementById('descricaoPrazo').value = prazo.descricao || '';
        document.getElementById('clienteId').value = prazo.cliente_id || '';

        // Carregar selects
        await carregarProcessosSelect();
        await carregarClientesSelect();
        
        // Definir valores após carregar
        setTimeout(() => {
            document.getElementById('processoId').value = prazo.processo_id || '';
            document.getElementById('clienteId').value = prazo.cliente_id || '';
        }, 100);

        // Verificar anexo
        if (prazo.anexo_pdf || prazo.tem_anexo) {
            document.getElementById('pdfName').textContent = 'Documento anexado';
            document.getElementById('pdfSize').textContent = 'PDF';
            document.getElementById('pdfCard').style.display = 'flex';
            document.getElementById('uploadArea').style.display = 'none';
        } else {
            document.getElementById('pdfCard').style.display = 'none';
            document.getElementById('uploadArea').style.display = 'block';
        }

        document.getElementById('modalPrazo').style.display = 'flex';
        
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    // Concluir prazo
    async function concluirPrazo(id) {
        if (!confirm('Deseja marcar este prazo como concluído?')) return;

        try {
            const response = await fetch(`/api/prazos/${id}/concluir`, {
                method: 'PUT',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                }
            });

            if (response.ok) {
                await carregarPrazosModernos();
                alert('✅ Prazo concluído com sucesso!');
                
                // Trocar automaticamente para aba Concluídos
                const abaConcluidos = document.querySelector('.filter-tab[data-filter="concluidos"]');
                if (abaConcluidos) {
                    filtrarPrazos('concluidos', abaConcluidos);
                }
            } else {
                throw new Error('Erro ao concluir prazo');
            }
        } catch (err) {
            console.error('Erro:', err);
            alert('❌ Erro ao concluir prazo');
        }
    }

    // Excluir prazo
    async function excluirPrazo(id) {
        if (!confirm('Tem certeza que deseja deletar este prazo?')) return;

        try {
            const response = await fetch(`/api/prazos/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                await carregarPrazosModernos();
                alert('✅ Prazo deletado com sucesso!');
                
                // Voltar para aba Todos
                const abaTodos = document.querySelector('.filter-tab[data-filter="todos"]');
                if (abaTodos) {
                    filtrarPrazos('todos', abaTodos);
                }
            } else {
                throw new Error('Erro ao deletar prazo');
            }
        } catch (err) {
            console.error('Erro:', err);
            alert('❌ Erro ao deletar prazo');
        }
    }

    // Toggle menu usuário
    function toggleUserMenu() {
        const m = document.getElementById('userDropdown');
        if(m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
    }

    // Filtrar prazos por aba
    function filtrarPrazos(filtro, elemento) {
        console.log('🔍 [FILTRAR] Filtro selecionado:', filtro);
        
        // Atualizar classes ativas
        document.querySelectorAll('.filter-tab').forEach(tab => tab.classList.remove('active'));
        elemento.classList.add('active');
        
        const listaFuturos = document.getElementById('lista-futuros');
        const listaConcluidos = document.getElementById('lista-concluidos');
        
        console.log('📋 [FILTRAR] Lista futuros:', listaFuturos ? 'OK' : 'NÃO ENCONTRADA');
        console.log('📋 [FILTRAR] Lista concluídos:', listaConcluidos ? 'OK' : 'NÃO ENCONTRADA');
        
        const secaoPrazos = document.getElementById('secao-prazos');
        const secaoCalendario = document.getElementById('secao-calendario');

        if (filtro === 'calendario') {
            secaoPrazos.style.display = 'none';
            secaoCalendario.classList.add('ativo');
            renderizarCalendario();
            return;
        }

        secaoPrazos.style.display = 'block';
        secaoCalendario.classList.remove('ativo');

        if (filtro === 'concluidos') {
            // Mostrar concluídos
            console.log('✅ [FILTRAR] Mudando para aba Concluídos');
            console.log('📊 [FILTRAR] Conteúdo do container:', listaConcluidos.innerHTML.length, 'caracteres');

            listaFuturos.style.display = 'none';
            listaConcluidos.style.display = 'block';

            if (listaConcluidos.innerHTML.trim() === '' || listaConcluidos.innerHTML.length < 100) {
                console.warn('⚠️ [FILTRAR] Container de concluídos está VAZIO ou muito pequeno!');
                console.warn('⚠️ [FILTRAR] Tentando recarregar...');
                carregarPrazosModernos();
            }
        } else {
            // Mostrar ativos e filtrar
            console.log('📂 [FILTRAR] Filtrando prazos ativos:', filtro);
            listaFuturos.style.display = 'block';
            listaConcluidos.style.display = 'none';
            
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            
            // Pegar todos os cards de prazo
            const cards = listaFuturos.querySelectorAll('[data-prazo-id]');
            console.log('📌 [FILTRAR] Total de cards encontrados:', cards.length);
            
            cards.forEach(card => {
                const prazoId = parseInt(card.dataset.prazoId);
                const prazo = todosPrazos.find(p => p.id === prazoId);
                
                if (!prazo) {
                    card.style.display = 'none';
                    return;
                }
                
                const vencimento = new Date(prazo.data_limite);
                vencimento.setHours(0, 0, 0, 0);
                const diff = Math.ceil((vencimento - hoje) / (1000 * 60 * 60 * 24));
                
                let mostrar = false;
                
                switch(filtro) {
                    case 'todos':
                        mostrar = true;
                        break;
                    case 'vencidos':
                        mostrar = diff < 0;
                        break;
                    case 'hoje':
                        mostrar = diff === 0;
                        break;
                    case 'esta-semana':
                        mostrar = diff >= 0 && diff <= 7;
                        break;
                }
                
                card.style.display = mostrar ? '' : 'none';
            });
        }
        
        // Atualizar ícones
        setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 50);
    }

    // Fechar menu ao clicar fora
    window.addEventListener('click', (e) => {
        if (!e.target.closest('#userCircle') && !e.target.closest('#userDropdown')) {
            const m = document.getElementById('userDropdown');
            if(m) m.style.display = 'none';
        }
    });

    // Logout
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

    // Atualizar ícones periodicamente
    setInterval(() => { if (window.lucide) lucide.createIcons(); }, 1000);

    function toggleIaMenu(event) {
        event.preventDefault();
        const submenu = document.getElementById('submenu-ia');
        submenu.classList.toggle('open');
    }

    // =============================================
    // CALENDÁRIO JURÍDICO
    // =============================================
    let calMes = new Date().getMonth() + 1;
    let calAno = new Date().getFullYear();
    let calDados = { prazos: [], feriados: [], compromissos: [] };

    function calMesAnterior() { calMes--; if (calMes < 1) { calMes = 12; calAno--; } renderizarCalendario(); }
    function calMesProximo() { calMes++; if (calMes > 12) { calMes = 1; calAno++; } renderizarCalendario(); }

    async function renderizarCalendario() {
        const token = localStorage.getItem('token');
        try {
            const res = await fetch(`/api/calendario/mensal?mes=${calMes}&ano=${calAno}`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await res.json();
            if (data.ok) {
                calDados = data;
                desenharGrid();
                desenharFeriadosLista();
                desenharCompromissosLista();
            }
        } catch (e) { console.error('Erro ao carregar calendário:', e); }
    }

    function desenharGrid() {
        const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        document.getElementById('cal-mes-titulo').textContent = `${meses[calMes-1]} ${calAno}`;

        const grid = document.getElementById('cal-grid');
        const diasSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        let html = diasSemana.map(d => `<div class="calendario-weekday">${d}</div>`).join('');

        const primeiroDia = new Date(calAno, calMes - 1, 1).getDay();
        const totalDias = new Date(calAno, calMes, 0).getDate();
        const hoje = new Date();

        // Index feriados e prazos por dia
        const feriadosPorDia = {};
        (calDados.feriados || []).forEach(f => {
            const d = new Date(f.data).getUTCDate();
            if (!feriadosPorDia[d]) feriadosPorDia[d] = [];
            feriadosPorDia[d].push(f);
        });
        const prazosPorDia = {};
        (calDados.prazos || []).forEach(p => {
            const d = new Date(p.data_limite).getUTCDate();
            if (!prazosPorDia[d]) prazosPorDia[d] = [];
            prazosPorDia[d].push(p);
        });
        const compromissosPorDia = {};
        (calDados.compromissos || []).forEach(c => {
            const d = new Date(c.data + 'T12:00:00').getDate();
            if (!compromissosPorDia[d]) compromissosPorDia[d] = [];
            compromissosPorDia[d].push(c);
        });

        // Dias vazios antes
        for (let i = 0; i < primeiroDia; i++) html += '<div class="calendario-dia vazio"></div>';

        for (let dia = 1; dia <= totalDias; dia++) {
            const ehHoje = dia === hoje.getDate() && calMes === (hoje.getMonth()+1) && calAno === hoje.getFullYear();
            const temFeriado = feriadosPorDia[dia];
            let classes = 'calendario-dia';
            if (ehHoje) classes += ' hoje';
            if (temFeriado) classes += ' feriado';

            let eventosHtml = '';
            if (temFeriado) {
                temFeriado.forEach(f => {
                    const cls = f.tipo === 'suspensao' ? 'dia-evento-suspensao' : 'dia-evento-feriado';
                    eventosHtml += `<div class="${cls}" title="${f.titulo}">${f.titulo}</div>`;
                });
            }
            if (prazosPorDia[dia]) {
                prazosPorDia[dia].forEach(p => {
                    eventosHtml += `<div class="dia-evento-prazo" title="${p.tipo} - ${p.cliente || ''}">${p.tipo || 'Prazo'}</div>`;
                });
            }

            if (compromissosPorDia[dia]) {
                const icones = { pagamento:'💰', reuniao:'📋', audiencia_externa:'⚖️', outro:'📌' };
                compromissosPorDia[dia].forEach(c => {
                    const ic  = icones[c.tipo] || '📅';
                    const cls = 'dia-evento-compromisso-' + c.tipo;
                    const gid = c.grupo_id || '';
                    const ttl = c.titulo.replace(/'/g, '');
                    const val = c.valor ? ' • R$' + parseFloat(c.valor).toLocaleString('pt-BR',{minimumFractionDigits:2}) : '';
                    eventosHtml += `<div class="${cls}" title="${c.titulo}${val}" onclick="abrirDetalheCompromisso(${c.id})">${ic} ${c.titulo}</div>`;
                });
            }
            html += `<div class="${classes}"><div class="dia-num">${dia}</div><div class="dia-eventos">${eventosHtml}</div></div>`;
        }

        grid.innerHTML = html;
    }

    function desenharFeriadosLista() {
        const container = document.getElementById('cal-feriados-lista');
        const feriados = calDados.feriados || [];
        if (feriados.length === 0) {
            container.innerHTML = '<p style="color:var(--muted); font-size:13px;">Nenhum feriado neste mês.</p>';
            return;
        }
        container.innerHTML = feriados.map(f => {
            const dataFmt = new Date(f.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
            const badge = f.tipo === 'suspensao' ? '⚠️' : '🔴';
            return `<div class="feriado-item">
                <span class="feriado-data">${dataFmt}</span>
                <span class="feriado-titulo">${badge} ${f.titulo}</span>
                <button class="feriado-del" onclick="deletarFeriado(${f.id})" title="Remover">✕</button>
            </div>`;
        }).join('');
    }

    function abrirModalFeriado() {
        document.getElementById('feriadoTitulo').value = '';
        document.getElementById('feriadoData').value = '';
        document.getElementById('feriadoTipo').value = 'feriado';
        document.getElementById('feriadoAbrangencia').value = 'local';
        document.getElementById('feriadoRecorrente').checked = false;
        document.getElementById('modalFeriado').style.display = 'flex';
    }

    async function salvarFeriado() {
        const token = localStorage.getItem('token');
        const body = {
            titulo: document.getElementById('feriadoTitulo').value.trim(),
            data: document.getElementById('feriadoData').value,
            tipo: document.getElementById('feriadoTipo').value,
            abrangencia: document.getElementById('feriadoAbrangencia').value,
            recorrente: document.getElementById('feriadoRecorrente').checked
        };
        if (!body.titulo || !body.data) return alert('Preencha título e data.');
        try {
            const res = await fetch('/api/calendario/feriados', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (data.ok) {
                document.getElementById('modalFeriado').style.display = 'none';
                renderizarCalendario();
            } else { alert(data.erro || 'Erro ao salvar'); }
        } catch (e) { alert('Erro de conexão'); }
    }

    async function deletarFeriado(id) {
        if (!confirm('Remover este feriado?')) return;
        const token = localStorage.getItem('token');
        try {
            await fetch('/api/calendario/feriados/' + id, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + token }
            });
            renderizarCalendario();
        } catch (e) { console.error(e); }
    }

    async function carregarFeriadosNacionais() {
        const token = localStorage.getItem('token');
        try {
            const res = await fetch('/api/calendario/feriados/inicializar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ ano: calAno })
            });
            const data = await res.json();
            if (data.ok) {
                alert(data.mensagem);
                renderizarCalendario();
            } else { alert(data.erro || 'Erro'); }
        } catch (e) { alert('Erro de conexão'); }
    }


    // ============================================================
    // COMPROMISSOS
    // ============================================================

    function desenharCompromissosLista() {
        const container = document.getElementById('cal-compromissos-lista');
        if (!container) return;
        const lista = calDados.compromissos || [];
        if (lista.length === 0) {
            container.innerHTML = '<p style="color:var(--muted);font-size:13px;">Nenhum compromisso neste mês.</p>';
            return;
        }
        const icones = { pagamento:'💰', reuniao:'📋', audiencia_externa:'⚖️', outro:'📌' };
        container.innerHTML = lista.map(c => {
            const dataFmt = new Date(c.data + 'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
            const ic      = icones[c.tipo] || '📅';
            const valor   = c.valor
                ? `<span style="color:var(--accent-green);font-weight:700;"> R$${parseFloat(c.valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>`
                : '';
            const detalhe = [c.cliente_nome, c.processo_numero].filter(Boolean).join(' · ');
            const parcela = c.total_parcelas > 1
                ? `<span style="font-size:10px;color:var(--muted);"> (${c.parcela_atual}/${c.total_parcelas})</span>`
                : '';
            const gid = c.grupo_id || '';
            const ttl = c.titulo.replace(/'/g,'');
            return `<div class="compromisso-item">
                <span class="comp-data">${dataFmt}</span>
                <div class="comp-info">
                    <div class="comp-titulo">${ic} ${c.titulo}${parcela}${valor}</div>
                    ${detalhe ? `<div class="comp-detalhe">${detalhe}</div>` : ''}
                    ${c.observacao ? `<div class="comp-detalhe">${c.observacao}</div>` : ''}
                </div>
                <button class="comp-del" onclick="deletarCompromisso(${c.id},'${gid}',${c.total_parcelas},'${ttl}')" title="Remover">✕</button>
            </div>`;
        }).join('');
    }

    async function abrirModalCompromisso() {
        const token = localStorage.getItem('token');
        // Reset form
        document.getElementById('compTitulo').value = '';
        document.getElementById('compData').value   = '';
        document.getElementById('compTipo').value   = 'pagamento';
        document.getElementById('compValor').value  = '';
        // reset mask
        document.getElementById('compObservacao').value = '';
        document.getElementById('compRecorrenteMeses').value = '1';
        toggleCompCampos();

        // Carrega lista de processos ativos para o select
        try {
            const res = await fetch('/api/processos?limit=200&status=ativo', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await res.json();
            const lista = data.data || data;
            const sel = document.getElementById('compProcesso');
            sel.innerHTML = '<option value="" data-cliente-id="" data-cliente-nome="">— Nenhum —</option>' +
                (Array.isArray(lista) ? lista : []).map(p =>
                    `<option value="${p.id}" data-cliente-id="${p.cliente_id || ''}" data-cliente-nome="${p.cliente || ''}">${p.numero}${p.cliente ? ' — ' + p.cliente : ''}</option>`
                ).join('');
        } catch (e) { /* silencioso */ }

        document.getElementById('modalCompromisso').style.display = 'flex';
    }

    function toggleCompCampos() {
        const tipo = document.getElementById('compTipo').value;
        const isPagamento = tipo === 'pagamento';
        document.getElementById('compValorGrupo').style.display      = isPagamento ? 'block' : 'none';
        document.getElementById('compRecorrenteGrupo').style.display  = isPagamento ? 'block' : 'none';
    }


    function mascaraValorComp(input) {
        let v = input.value.replace(/\D/g, '');
        if (!v) { input.value = ''; return; }
        v = (parseInt(v, 10) / 100).toFixed(2);
        input.value = parseFloat(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    async function salvarCompromisso() {
        const token = localStorage.getItem('token');
        const titulo = document.getElementById('compTitulo').value.trim();
        const data   = document.getElementById('compData').value;
        const tipo   = document.getElementById('compTipo').value;
        const valor  = document.getElementById('compValor').value;
        const obs    = document.getElementById('compObservacao').value.trim();
        const meses  = parseInt(document.getElementById('compRecorrenteMeses').value) || 1;
        const proc   = document.getElementById('compProcesso').value;

        if (!titulo) return alert('Informe um título para o compromisso.');
        if (!data)   return alert('Informe a data do compromisso.');

        // Capturar cliente_id do processo selecionado
        const procSel = document.getElementById('compProcesso');
        const clienteId = procSel.options[procSel.selectedIndex]?.dataset?.clienteId || '';

        const body = { titulo, data, tipo, observacao: obs, recorrente_meses: meses };
        if (valor)     body.valor = parseFloat(valor.replace(/\./g, '').replace(',', '.'));
        if (proc)      body.processo_id = parseInt(proc);
        if (clienteId) body.cliente_id  = parseInt(clienteId);

        try {
            const res = await fetch('/api/calendario/compromissos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify(body)
            });
            const result = await res.json();
            if (result.ok) {
                document.getElementById('modalCompromisso').style.display = 'none';
                if (result.total > 1)
                    alert(`✅ ${result.total} parcelas criadas com sucesso!`);
                renderizarCalendario();
            } else {
                alert(result.erro || 'Erro ao salvar compromisso.');
            }
        } catch (e) { alert('Erro de conexão ao salvar.'); }
    }

    let _compDetalheAtual = null;

    function abrirDetalheCompromisso(id) {
        const c = (calDados.compromissos || []).find(x => x.id === id);
        if (!c) return;
        _compDetalheAtual = c;

        const icones   = { pagamento:'💰', reuniao:'📋', audiencia_externa:'⚖️', outro:'📌' };
        const tipoLabel = { pagamento:'Pagamento', reuniao:'Reunião', audiencia_externa:'Audiência Externa', outro:'Outro' };

        document.getElementById('detalheIcone').textContent    = icones[c.tipo] || '📅';
        document.getElementById('detalheTitulo').textContent   = c.titulo;
        document.getElementById('detalheSubtitulo').textContent = tipoLabel[c.tipo] || c.tipo;

        // Data
        const dataFmt = new Date(c.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
        document.getElementById('detalheData').textContent = dataFmt;

        // Tipo
        document.getElementById('detalheTipo').textContent = tipoLabel[c.tipo] || c.tipo;

        // Valor
        const valBloco = document.getElementById('detalheValorBloco');
        if (c.valor) {
            valBloco.style.display = 'block';
            document.getElementById('detalheValor').textContent = 'R$ ' + parseFloat(c.valor).toLocaleString('pt-BR', { minimumFractionDigits:2 });
        } else {
            valBloco.style.display = 'none';
        }

        // Parcela
        const parcBloco = document.getElementById('detalheParcelaBloco');
        if (c.total_parcelas > 1) {
            parcBloco.style.display = 'block';
            document.getElementById('detalheParcela').textContent = c.parcela_atual + ' de ' + c.total_parcelas;
        } else {
            parcBloco.style.display = 'none';
        }

        // Processo + Cliente no mesmo bloco
        const procBloco = document.getElementById('detalheProcessoBloco');
        if (c.processo_numero || c.cliente_nome) {
            procBloco.style.display = 'block';
            const proc   = c.processo_numero || '';
            const cliente = c.cliente_nome   || '';
            document.getElementById('detalheProcesso').innerHTML =
                (proc   ? `<span style="display:block;">${proc}</span>` : '') +
                (cliente ? `<span style="display:block;font-size:12px;color:var(--muted);margin-top:3px;">👤 ${cliente}</span>` : '');
        } else {
            procBloco.style.display = 'none';
        }

        // Bloco de cliente separado — sempre oculto (já exibido junto ao processo)
        document.getElementById('detalheClienteBloco').style.display = 'none';

        // Observação
        const obsBloco = document.getElementById('detalheObsBloco');
        if (c.observacao) {
            obsBloco.style.display = 'block';
            document.getElementById('detalheObs').textContent = c.observacao;
        } else {
            obsBloco.style.display = 'none';
        }

        document.getElementById('modalDetalheComp').style.display = 'flex';
    }

    async function deletarDoDetalhe() {
        if (!_compDetalheAtual) return;
        const c = _compDetalheAtual;
        document.getElementById('modalDetalheComp').style.display = 'none';
        await deletarCompromisso(c.id, c.grupo_id || '', c.total_parcelas, c.titulo);
    }

    async function deletarCompromisso(id, grupoId, totalParcelas, titulo) {
        let todosGrupo = false;
        if (totalParcelas > 1 && grupoId) {
            todosGrupo = confirm(
                `"${titulo}"\n\nEste compromisso faz parte de um grupo de ${totalParcelas} parcelas.\n\n` +
                `OK → Remover TODAS as parcelas\nCancelar → Remover apenas esta`
            );
        } else {
            if (!confirm(`Remover o compromisso "${titulo}"?`)) return;
        }
        const token = localStorage.getItem('token');
        try {
            await fetch('/api/calendario/compromissos/' + id + (todosGrupo ? '?todos_do_grupo=true' : ''), {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + token }
            });
            renderizarCalendario();
        } catch (e) { console.error('Erro ao deletar compromisso:', e); }
    }

        function aplicarPermissoesRoleUI(role) {
            if (role === 'admin') return;
            const s = document.createElement('style');
            if (role === 'operador') {
                s.textContent = '.btn-action.danger { display: none !important; }';
            } else {
                s.textContent = '.btn-action.danger, .btn-action.edit, button[onclick*="abrirModalPrazo"], .btn-add-feriado { display: none !important; }';
            }
            document.head.appendChild(s);
        }


(function(){var t=localStorage.getItem('token');if(!t)return;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){return r.json()}).then(function(d){if(d.ok){var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}}).catch(function(){})}checkChat();setInterval(checkChat,30000)})();