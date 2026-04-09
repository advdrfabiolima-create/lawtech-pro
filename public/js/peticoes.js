const token = localStorage.getItem('token');
    if (!token) window.location.href = '/login.html';

    let peticaoAtual = null;
    let tipoCpfCnpj = 'cpf'; // 'cpf' | 'cnpj'

    // ==================== USER MENU ====================
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

    // ==================== DADOS USUARIO ====================
    async function carregarDadosUsuario() {
        try {
            const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
            const data = await res.json();

            if (data.ok && data.usuario) {
                document.getElementById('userEmail').innerText = data.usuario.email || '---';
                const nome = data.usuario.nome || 'Advogado';
                document.getElementById('userNameHeader').innerText = nome.trim().split(' ')[0];
                const partes = nome.trim().split(' ').filter(n => n);
                let iniciais = partes[0][0];
                if (partes.length > 1) iniciais += partes[partes.length - 1][0];
                document.getElementById('userCircle').innerText = iniciais.toUpperCase();
                window._userRole = data.usuario.role || 'visualizador';
                aplicarPermissoesRoleUI(window._userRole);
            }

            const resPlano = await fetch('/api/plano-consumo', { headers: { Authorization: `Bearer ${token}` } });
            const plano = await resPlano.json();
            const planoNome = (plano.plano || 'free').toLowerCase();
            document.getElementById('planNameFooter').innerText = plano.plano || 'free';

            // Trial ativo: libera acesso a todas as funcionalidades
            const emTrial = data.ok && data.usuario && data.usuario.plano_financeiro_status === 'trial';

            // Verificar se é Premium - bloquear se não for (trial tem acesso completo)
            if (planoNome !== 'premium' && !emTrial) {
                const content = document.querySelector('.content');
                if (content) {
                    content.innerHTML = `
                        <div style="display:flex; align-items:center; justify-content:center; min-height: 60vh;">
                            <div style="text-align:center; background:var(--white); border-radius:16px; padding:48px 40px; border:1px solid var(--border); max-width:500px; box-shadow:0 8px 30px rgba(0,0,0,0.08);">
                                <div style="width:72px; height:72px; background:#fef3c7; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; font-size:32px;">🔒</div>
                                <h2 style="font-size:20px; font-weight:700; color:var(--text-primary); margin-bottom:12px;">Recurso Premium</h2>
                                <p style="color:var(--text-secondary); font-size:14px; line-height:1.6; margin-bottom:24px;">
                                    Você está no plano <strong style="text-transform:capitalize;">${plano.plano || 'Free'}</strong>.<br>
                                    A geração de petições com IA está disponível apenas para assinantes do plano <strong>Premium</strong>.
                                </p>
                                <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
                                    <a href="/planos-page" style="display:inline-block; background:var(--accent-blue); color:white; padding:12px 28px; border-radius:10px; text-decoration:none; font-weight:700; font-size:14px; transition:all 0.2s;">
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
        } catch (e) {
            console.error('Erro:', e);
        }
    }

    // ==================== CLIENTES ====================
    async function carregarClientes() {
        try {
            const res = await fetch('/api/clientes?limit=200', { headers: { Authorization: `Bearer ${token}` } });
            const rPet = await res.json();
            const clientes = rPet.data || rPet;
            const select = document.getElementById('clienteSelect');
            clientes.forEach(cliente => {
                const option = document.createElement('option');
                option.value = cliente.id;
                option.textContent = cliente.nome;
                option.dataset.cpf = cliente.documento || '';
                option.dataset.cidade = cliente.cidade || '';
                option.dataset.estado = cliente.estado || '';
                option.dataset.endereco = cliente.endereco || cliente.logradouro || '';
                select.appendChild(option);
            });
        } catch (e) {
            console.error('Erro:', e);
        }
    }

    function preencherDadosCliente() {
        const select = document.getElementById('clienteSelect');
        const option = select.options[select.selectedIndex];

        if (option.value) {
            document.getElementById('autor').value = option.textContent.trim();
            // Detectar CPF (11 dígitos) ou CNPJ (14 dígitos) e aplicar máscara
            const docRaw = (option.dataset.cpf || '').replace(/\D/g, '');
            setTipoCpfCnpj(docRaw.length > 11 ? 'cnpj' : 'cpf');
            const cpfInput = document.getElementById('cpf');
            cpfInput.value = docRaw;
            aplicarMascaraCpfCnpj(cpfInput);
            const cidade = option.dataset.cidade || '';
            const estado = option.dataset.estado || '';
            document.getElementById('cidade').value = estado ? `${cidade}/${estado}` : cidade;
            document.getElementById('enderecoAutor').value = option.dataset.endereco || '';
        } else {
            document.getElementById('autor').value = '';
            document.getElementById('cpf').value = '';
            document.getElementById('cidade').value = '';
            document.getElementById('enderecoAutor').value = '';
        }
    }

    document.getElementById('clienteSelect').addEventListener('change', preencherDadosCliente);

    // ==================== CPF / CNPJ TOGGLE + MÁSCARA ====================
    function setTipoCpfCnpj(tipo) {
        tipoCpfCnpj = tipo;
        const input = document.getElementById('cpf');
        const btnCpf  = document.getElementById('btnTipoCpf');
        const btnCnpj = document.getElementById('btnTipoCnpj');
        const ativo   = 'background:var(--accent-blue);color:#fff;';
        const inativo = 'background:transparent;color:#94a3b8;';
        if (tipo === 'cpf') {
            input.placeholder = '000.000.000-00';
            input.maxLength   = 14; // 11 dígitos + 3 pontuações
            btnCpf.style.cssText  += ativo;
            btnCnpj.style.cssText += inativo;
        } else {
            input.placeholder = '00.000.000/0000-00';
            input.maxLength   = 18; // 14 dígitos + 4 pontuações
            btnCpf.style.cssText  += inativo;
            btnCnpj.style.cssText += ativo;
        }
        input.value = '';
    }

    function aplicarMascaraCpfCnpj(input) {
        let v = input.value.replace(/\D/g, '');
        if (tipoCpfCnpj === 'cpf') {
            v = v.slice(0, 11);
            v = v.replace(/(\d{3})(\d)/, '$1.$2');
            v = v.replace(/(\d{3})(\d)/, '$1.$2');
            v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        } else {
            v = v.slice(0, 14);
            v = v.replace(/(\d{2})(\d)/, '$1.$2');
            v = v.replace(/(\d{3})(\d)/, '$1.$2');
            v = v.replace(/(\d{3})(\d)/, '$1/$2');
            v = v.replace(/(\d{4})(\d{1,2})$/, '$1-$2');
        }
        input.value = v;
    }

    // ==================== UPLOAD (MÚLTIPLOS ARQUIVOS) ====================
    const MAX_TOTAL_SIZE = 10 * 1024 * 1024; // 10MB
    let arquivosPDF = [];

    function getTotalSize() {
        return arquivosPDF.reduce((sum, f) => sum + f.size, 0);
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function handleFileUpload(input) {
        const newFiles = Array.from(input.files);
        let totalAtual = getTotalSize();

        for (const file of newFiles) {
            if (file.type !== 'application/pdf') {
                alert('Apenas arquivos PDF são aceitos: ' + file.name);
                continue;
            }
            if (totalAtual + file.size > MAX_TOTAL_SIZE) {
                alert('Limite de 10MB excedido. Não foi possível adicionar: ' + file.name);
                break;
            }
            arquivosPDF.push(file);
            totalAtual += file.size;
        }

        input.value = '';
        renderUploadedFiles();
    }

    function removeFileAt(index) {
        arquivosPDF.splice(index, 1);
        renderUploadedFiles();
    }

    function renderUploadedFiles() {
        const container = document.getElementById('uploadedFilesList');
        const sizeInfo = document.getElementById('uploadSizeInfo');

        if (arquivosPDF.length === 0) {
            container.innerHTML = '';
            sizeInfo.style.display = 'none';
            document.getElementById('uploadZone').style.display = 'block';
            return;
        }

        container.innerHTML = arquivosPDF.map((file, i) => `
            <div class="uploaded-file show" style="margin-top:8px;">
                <i class="lucide lucide-check-circle" style="color:#10b981; font-size:20px;"></i>
                <span>${file.name} <small style="color:var(--text-secondary);">(${formatSize(file.size)})</small></span>
                <button type="button" onclick="removeFileAt(${i})" class="btn-remove-file" title="Remover">
                    <i class="lucide lucide-x" style="color:#dc2626; font-size:18px;"></i>
                </button>
            </div>
        `).join('');

        const total = getTotalSize();
        sizeInfo.style.display = 'block';
        sizeInfo.innerHTML = `${arquivosPDF.length} arquivo(s) &middot; ${formatSize(total)} / 10 MB`;
        sizeInfo.style.color = total > MAX_TOTAL_SIZE * 0.8 ? '#dc2626' : 'var(--text-secondary)';

        document.getElementById('uploadZone').style.display = 'block';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function removeAllFiles() {
        arquivosPDF = [];
        document.getElementById('pdfInput').value = '';
        renderUploadedFiles();
    }

    // ==================== GERAR PETIÇÃO ====================

    function renderMarkdown(texto) {
        if (!texto) return '';
        var html = texto;
        html = html.split('&').join('&amp;');
        html = html.split('<').join('&lt;');
        html = html.split('>').join('&gt;');
        // negrito **texto**
        while (html.indexOf('**') !== -1) {
            var a = html.indexOf('**');
            var b = html.indexOf('**', a + 2);
            if (b === -1) break;
            html = html.slice(0, a) + '<strong>' + html.slice(a + 2, b) + '</strong>' + html.slice(b + 2);
        }
        // itálico *texto*
        while (html.indexOf('*') !== -1) {
            var a = html.indexOf('*');
            var b = html.indexOf('*', a + 1);
            if (b === -1) break;
            html = html.slice(0, a) + '<em>' + html.slice(a + 1, b) + '</em>' + html.slice(b + 1);
        }
        html = html.split('\n\n').join('</p><p>');
        html = html.split('\n').join('<br>');
        return '<p>' + html + '</p>';
    }

    document.getElementById('formPeticao').addEventListener('submit', async (e) => {
        e.preventDefault();

        // Montar FormData para enviar campos + PDFs anexados juntos
        const formData = new FormData();
        formData.append('tipo',           document.getElementById('tipo').value);
        formData.append('autor',          document.getElementById('autor').value);
        formData.append('cpf_autor',      document.getElementById('cpf').value || '');
        formData.append('endereco_autor', document.getElementById('enderecoAutor').value || '');
        formData.append('reu',            document.getElementById('reu').value || '');
        formData.append('reu_cpf_cnpj',   document.getElementById('reuCpfCnpj').value || '');
        formData.append('reu_endereco',   document.getElementById('reuEndereco').value || '');
        formData.append('resumo_fatos',   document.getElementById('resumoFatos').value);
        formData.append('pedidos',        document.getElementById('pedidos').value);
        formData.append('cidade',         document.getElementById('cidade').value || '');

        // Anexar PDFs (a IA vai ler o conteúdo deles)
        arquivosPDF.forEach(function(file) {
            formData.append('documentos', file);
        });

        document.getElementById('formCard').style.display = 'none';
        document.getElementById('loading').classList.add('show');

        try {
            const res = await fetch('/api/peticoes/gerar', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                    // Content-Type NÃO definido: o browser define multipart/form-data automaticamente
                },
                body: formData
            });

            if (!res.ok) {
                const erro = await res.json();
                throw new Error(erro.erro || 'Erro');
            }

            const result = await res.json();
            peticaoAtual = result.peticao;

            document.getElementById('loading').classList.remove('show');
            document.getElementById('previewCard').classList.add('show');
            document.getElementById('previewTitulo').innerText = result.peticao.titulo;
            document.getElementById('previewConteudo').innerHTML = renderMarkdown(result.peticao.conteudo);
        } catch (error) {
            alert('Erro: ' + error.message);
            document.getElementById('loading').classList.remove('show');
            document.getElementById('formCard').style.display = 'block';
        }
    });

    // ==================== PDF / EDITAR / NOVA ====================
    async function gerarPDF() {
        if (!peticaoAtual) return;
        try {
            const res = await fetch(`/api/peticoes/${peticaoAtual.id}/pdf`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await res.json();
            if (result.ok) {
                window.open(result.pdf.url, '_blank');
            } else {
                alert('Erro: ' + result.erro);
            }
        } catch (error) {
            alert('Erro ao gerar PDF');
        }
    }

    function editarPeticao() {
        if (!peticaoAtual) return;
        const textarea = document.getElementById('editarConteudoTextarea');
        textarea.value = document.getElementById('previewConteudo').innerText;
        document.getElementById('modalEdicao').classList.add('show');
        setTimeout(() => textarea.focus(), 100);
    }

    function fecharModalEdicao() {
        document.getElementById('modalEdicao').classList.remove('show');
    }

    async function salvarEdicao() {
        if (!peticaoAtual) return;
        const novo = document.getElementById('editarConteudoTextarea').value;
        const atual = document.getElementById('previewConteudo').innerText;

        if (novo.trim() === atual.trim()) {
            fecharModalEdicao();
            return;
        }

        try {
            const res = await fetch(`/api/peticoes/${peticaoAtual.id}/conteudo`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ conteudo: novo })
            });
            const data = await res.json();
            if (data.ok) {
                document.getElementById('previewConteudo').innerText = novo;
                peticaoAtual.conteudo = novo;
                fecharModalEdicao();
                // Feedback visual
                const badge = document.getElementById('savedBadge');
                badge.innerHTML = '<i class="lucide lucide-check-circle" style="font-size:14px;"></i> Alterações salvas!';
                setTimeout(() => {
                    badge.innerHTML = '<i class="lucide lucide-check-circle" style="font-size:14px;"></i> Salvo no histórico';
                    if (typeof lucide !== 'undefined') lucide.createIcons();
                }, 2000);
                if (typeof lucide !== 'undefined') lucide.createIcons();
            } else {
                alert('Erro ao salvar: ' + (data.erro || 'Tente novamente'));
            }
        } catch (error) {
            alert('Erro ao salvar edição');
        }
    }

    async function deletarPeticao() {
        if (!peticaoAtual) return;
        if (!confirm('Tem certeza que deseja excluir esta petição? Esta ação não pode ser desfeita.')) return;

        try {
            const res = await fetch(`/api/peticoes/${peticaoAtual.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.ok) {
                novaPeticao();
            } else {
                alert('Erro ao excluir: ' + (data.erro || 'Tente novamente'));
            }
        } catch (error) {
            alert('Erro ao excluir petição');
        }
    }

    function novaPeticao() {
        document.getElementById('previewCard').classList.remove('show');
        document.getElementById('historicoList').style.display = 'none';
        document.getElementById('formCard').style.display = 'block';
        document.getElementById('formPeticao').reset();
        removeAllFiles();
        peticaoAtual = null;
        document.getElementById('btnHistorico').innerHTML = '<i class="lucide lucide-history"></i> Histórico';
    }

    function fecharPreview() {
        // Apenas volta para o formulário, sem resetar a petição atual
        document.getElementById('previewCard').classList.remove('show');
        document.getElementById('formCard').style.display = 'block';
    }

    // ==================== HISTÓRICO ====================
    let voltarParaPreview = false; // Se o user estava no preview antes de ir pro histórico

    async function toggleHistorico() {
        const lista = document.getElementById('historicoList');
        const form = document.getElementById('formCard');
        const preview = document.getElementById('previewCard');
        const btn = document.getElementById('btnHistorico');

        if (lista.style.display === 'none') {
            // Salvar se estava no preview
            voltarParaPreview = preview.classList.contains('show');
            form.style.display = 'none';
            preview.classList.remove('show');
            lista.style.display = 'block';
            btn.innerHTML = '<i class="lucide lucide-arrow-left"></i> Voltar';

            try {
                const res = await fetch('/api/peticoes?limit=20', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                const container = document.getElementById('peticoesListContainer');

                if (data.ok && data.peticoes.length > 0) {
                    container.innerHTML = data.peticoes.map(p => {
                        const conteudo = p.conteudo_editado || p.conteudo_gerado || '';
                        return `
                        <div class="peticao-item" onclick='abrirPeticaoHistorico(${JSON.stringify({
                            id: p.id,
                            titulo: p.titulo,
                            conteudo: '',
                            status: p.status,
                            autor: p.autor,
                            reu: p.reu
                        }).replace(/'/g, "&#39;")})' data-id="${p.id}">
                            <div class="peticao-icon"><i class="lucide lucide-file-text"></i></div>
                            <div class="peticao-info">
                                <h4>${escapeHtml(p.titulo)}</h4>
                                <p><strong>Autor:</strong> ${escapeHtml(p.autor)} ${p.reu ? '&middot; <strong>Réu:</strong> ' + escapeHtml(p.reu) : ''} &middot; ${new Date(p.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
                            </div>
                            <span class="badge badge-${p.status}">${p.status.toUpperCase()}</span>
                        </div>`;
                    }).join('');
                    if (typeof lucide !== 'undefined') lucide.createIcons();
                } else {
                    container.innerHTML = `
                        <div class="empty-state">
                            <i class="lucide lucide-inbox"></i>
                            <h4>Nenhuma petição encontrada</h4>
                            <p>Suas petições geradas aparecerão aqui</p>
                        </div>
                    `;
                    if (typeof lucide !== 'undefined') lucide.createIcons();
                }
            } catch (e) {
                alert('Erro ao carregar histórico');
            }
        } else {
            // Voltar do histórico
            lista.style.display = 'none';
            btn.innerHTML = '<i class="lucide lucide-history"></i> Histórico';
            if (voltarParaPreview && peticaoAtual) {
                preview.classList.add('show');
                form.style.display = 'none';
            } else {
                form.style.display = 'block';
            }
            voltarParaPreview = false;
        }
    }

    async function abrirPeticaoHistorico(peticaoBase) {
        // Buscar conteúdo completo do servidor
        try {
            const res = await fetch(`/api/peticoes?limit=50`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.ok) {
                const p = data.peticoes.find(pet => pet.id === peticaoBase.id);
                if (p) {
                    peticaoAtual = {
                        id: p.id,
                        titulo: p.titulo,
                        conteudo: p.conteudo_editado || p.conteudo_gerado,
                        status: p.status,
                        autor: p.autor,
                        reu: p.reu
                    };
                    document.getElementById('previewTitulo').innerText = p.titulo;
                    document.getElementById('previewConteudo').innerText = p.conteudo_editado || p.conteudo_gerado;

                    document.getElementById('historicoList').style.display = 'none';
                    document.getElementById('formCard').style.display = 'none';
                    document.getElementById('previewCard').classList.add('show');
                    document.getElementById('btnHistorico').innerHTML = '<i class="lucide lucide-history"></i> Histórico';
                    voltarParaPreview = false;
                    if (typeof lucide !== 'undefined') lucide.createIcons();
                }
            }
        } catch (e) {
            alert('Erro ao abrir petição');
        }
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==================== UTILS ====================
    function logout() {
        localStorage.removeItem('token');
        window.location.href = '/login.html';
    }

    function toggleIaMenu(event) {
        event.preventDefault();
        const submenu = document.getElementById('submenu-ia');
        submenu.classList.toggle('open');
    }

    // ==================== MODAL EVENTS ====================
    document.getElementById('modalEdicao').addEventListener('click', function(e) {
        if (e.target === this) fecharModalEdicao();
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && document.getElementById('modalEdicao').classList.contains('show')) {
            fecharModalEdicao();
        }
    });

    // ==================== INIT ====================
    window.onload = () => {
        carregarDadosUsuario();
        carregarClientes();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    function aplicarPermissoesRoleUI(role) {
        if (role === 'admin') return;
        const s = document.createElement('style');
        if (role === 'operador') {
            s.textContent = `.btn-danger { display: none !important; }`;
        } else {
            s.textContent = `.btn-danger, #btnNovaPeticao { display: none !important; }`;
        }
        document.head.appendChild(s);
    }

    document.getElementById('btnCancelarEdicao').addEventListener('click', fecharModalEdicao);
    document.getElementById('btnSalvarEdicao').addEventListener('click', salvarEdicao);

    document.getElementById('btnTipoCpf').addEventListener('click', () => setTipoCpfCnpj('cpf'));
    document.getElementById('btnTipoCnpj').addEventListener('click', () => setTipoCpfCnpj('cnpj'));
    document.getElementById('cpf').addEventListener('input', function() { aplicarMascaraCpfCnpj(this); });


(function(){var t=localStorage.getItem('token');if(!t)return;var _ci;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){if(r.status===402){clearInterval(_ci);return null;}return r.json()}).then(function(d){if(!d||!d.ok)return;var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}).catch(function(){})}checkChat();_ci=setInterval(checkChat,30000);})();