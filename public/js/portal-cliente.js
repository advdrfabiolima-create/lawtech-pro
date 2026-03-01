
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

    const STATUS_LABELS = {
        ativo: 'Ativo',
        arquivado: 'Arquivado',
        suspenso: 'Suspenso',
        encerrado: 'Encerrado'
    };

    let portalToken = null;

    function formatarData(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
        return d.toLocaleDateString('pt-BR');
    }

    function getStatusClass(status) {
        if (status === 'ativo') return 'status-ativo';
        if (status === 'arquivado') return 'status-arquivado';
        return 'status-suspenso';
    }

    function getStatusLabel(status) {
        return STATUS_LABELS[status] || status || '—';
    }

    function mostrarErro(msg) {
        document.getElementById('telaLoading').style.display = 'none';
        const telaErro = document.getElementById('telaErro');
        if (msg) document.getElementById('erroMsg').textContent = msg;
        telaErro.classList.add('show');
    }

    async function autenticarPortal(token) {
        try {
            const res = await fetch('/api/portal/autenticar?token=' + encodeURIComponent(token));
            const data = await res.json();

            if (!data.ok) {
                mostrarErro(data.erro || 'Link inválido ou expirado. Solicite um novo ao seu advogado.');
                return;
            }

            portalToken = data.token;
            sessionStorage.setItem('portalToken', portalToken);

            // Preenche header
            document.getElementById('clienteNome').textContent = data.nome || '—';

            const nomeEsc = data.escritorio?.nome || 'Escritório';
            document.getElementById('escritorioNome').textContent = nomeEsc;
            if (data.escritorio?.advogado) {
                document.getElementById('escritorioAdvogado').textContent = 'Dr(a). ' + data.escritorio.advogado;
            }

            // Logo ou iniciais — prioriza base64 (persiste no banco entre deploys)
            const logoBase64  = data.escritorio?.logo_base64;
            const logoArquivo = data.escritorio?.logo_arquivo;
            const logoImg     = document.getElementById('logoImg');
            const logoIniciais = document.getElementById('logoIniciais');
            const logoSrc = logoBase64 || (logoArquivo ? '/' + logoArquivo : null);
            if (logoSrc) {
                logoImg.src = logoSrc;
                logoImg.style.display = 'block';
                logoIniciais.style.display = 'none';
                logoImg.onerror = () => {
                    logoImg.style.display = 'none';
                    logoIniciais.style.display = 'block';
                    const iniciais = nomeEsc.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
                    logoIniciais.textContent = iniciais || 'L';
                };
            } else {
                const iniciais = nomeEsc.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
                logoIniciais.textContent = iniciais || 'L';
            }

            document.getElementById('telaLoading').style.display = 'none';
            document.getElementById('telaPortal').classList.add('show');

            await carregarProcessos();
            await carregarReunioes();
        } catch (err) {
            console.error('[Portal] Erro ao autenticar:', err);
            mostrarErro('Não foi possível conectar ao servidor. Tente novamente mais tarde.');
        }
    }

    async function carregarProcessos() {
        const lista = document.getElementById('listaProcessos');
        lista.innerHTML = '<div style="color:#64748b;font-size:14px;padding:20px 0;">Carregando...</div>';

        try {
            const res = await fetch('/api/portal/meus-processos', {
                headers: { 'Authorization': 'Bearer ' + portalToken }
            });
            const data = await res.json();

            if (!data.ok) {
                lista.innerHTML = '<div class="empty-state"><div class="icon">📂</div><h3>Sem processos</h3><p>' + (data.erro || 'Nenhum processo encontrado.') + '</p></div>';
                return;
            }

            const processos = data.processos || [];

            if (processos.length === 0) {
                lista.innerHTML = `
                    <div class="empty-state">
                        <div class="icon">📂</div>
                        <h3>Nenhum processo encontrado</h3>
                        <p>Seus processos aparecerão aqui quando forem cadastrados pelo escritório.</p>
                    </div>`;
                return;
            }

            lista.innerHTML = processos.map(p => renderProcessoCard(p)).join('');
        } catch (err) {
            console.error('[Portal] Erro ao carregar processos:', err);
            lista.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h3>Erro ao carregar</h3><p>Tente recarregar a página.</p></div>';
        }
    }

    function renderProcessoCard(p) {
        const statusClass = getStatusClass(p.status);
        const statusLabel = getStatusLabel(p.status);
        const esfera = p.esfera ? `<span class="meta-tag">${p.esfera}</span>` : '';
        const instancia = p.instancia ? `<span class="meta-tag">${p.instancia}</span>` : '';
        const tribunal = p.tribunal ? `<span class="meta-tag">${p.tribunal}</span>` : '';
        const uf = p.uf ? `<span class="meta-tag">${p.uf}</span>` : '';

        return `
        <div class="processo-card" id="card-${p.id}">
            <div class="processo-header" onclick="toggleAndamentos(${p.id}, this)">
                <div class="processo-info">
                    <div class="processo-numero">${p.numero || '—'}</div>
                    ${(p.polo_ativo || p.polo_passivo) ? `
                    <div class="processo-polos">
                        ${p.polo_ativo  ? `<div class="polo-linha"><span class="polo-label polo-ativo">Polo Ativo</span><span class="polo-nomes">${escapeHtml(p.polo_ativo)}</span></div>`  : ''}
                        ${p.polo_passivo ? `<div class="polo-linha"><span class="polo-label polo-passivo">Polo Passivo</span><span class="polo-nomes">${escapeHtml(p.polo_passivo)}</span></div>` : ''}
                    </div>` : ''}
                    <div class="processo-meta">
                        ${tribunal}${esfera}${instancia}${uf}
                        <span class="status-badge ${statusClass}">${statusLabel}</span>
                        <span class="toggle-btn">
                            <span>Ver Andamentos</span>
                            <span class="toggle-icon" id="icon-${p.id}">▼</span>
                        </span>
                    </div>
                </div>
            </div>
            <div class="andamentos-container" id="andamentos-${p.id}">
                <div style="color:#64748b;font-size:13px;">Carregando andamentos...</div>
            </div>
        </div>`;
    }

    async function toggleAndamentos(processoId, headerEl) {
        const container = document.getElementById('andamentos-' + processoId);
        const icon = document.getElementById('icon-' + processoId);
        const isOpen = container.classList.contains('open');

        if (isOpen) {
            container.classList.remove('open');
            icon.classList.remove('open');
            return;
        }

        container.classList.add('open');
        icon.classList.add('open');

        // Only load once
        if (container.dataset.loaded === 'true') return;

        try {
            const res = await fetch('/api/portal/processos/' + processoId + '/andamentos', {
                headers: { 'Authorization': 'Bearer ' + portalToken }
            });
            const data = await res.json();

            if (!data.ok) {
                container.innerHTML = '<div class="sem-andamentos">Não foi possível carregar os andamentos.</div>';
                return;
            }

            const andamentos = data.andamentos || [];
            container.dataset.loaded = 'true';

            if (andamentos.length === 0) {
                container.innerHTML = '<div class="sem-andamentos">Nenhum andamento disponível no momento.</div>';
                return;
            }

            const html = `
                <div class="timeline">
                    ${andamentos.map(a => {
                        const meta = tipoMeta(a.tipo);
                        const cor = meta.cor;
                        const bg = cor + '22'; // ~13% opacity hex suffix
                        return `
                        <div class="timeline-item">
                            <div class="timeline-dot" style="background:${cor};"></div>
                            <div class="timeline-date">${formatarData(a.data_andamento)}</div>
                            <span class="timeline-tipo" style="background:${bg};color:${cor};">${meta.label}</span>
                            <div class="timeline-titulo">${escapeHtml(a.titulo)}</div>
                            ${a.descricao ? `<div class="timeline-descricao">${escapeHtml(a.descricao)}</div>` : ''}
                        </div>`;
                    }).join('')}
                </div>`;

            container.innerHTML = html;
        } catch (err) {
            console.error('[Portal] Erro ao carregar andamentos:', err);
            container.innerHTML = '<div class="sem-andamentos">Erro ao carregar andamentos.</div>';
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ---- Reuniões ----
    async function carregarReunioes() {
        const lista = document.getElementById('listaReunioes');
        lista.innerHTML = '<div style="color:#64748b;font-size:14px;padding:20px 0;">Carregando...</div>';
        try {
            const res = await fetch('/api/portal/reunioes', {
                headers: { 'Authorization': 'Bearer ' + portalToken }
            });
            const data = await res.json();
            const reunioes = data.reunioes || [];
            if (reunioes.length === 0) {
                lista.innerHTML = '<div style="color:#64748b;font-size:14px;padding:20px 0;">Nenhuma reunião agendada pelo escritório.</div>';
                return;
            }
            lista.innerHTML = reunioes.map(r => {
                const dt = new Date(r.data_hora);
                const dataFmt = dt.toLocaleDateString('pt-BR') + ' às ' + dt.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
                const badge = r.status === 'agendada'
                    ? '<span class="badge-reuniao badge-agendada">Agendada</span>'
                    : '<span class="badge-reuniao badge-concluida">Concluída</span>';
                const btnEntrar = r.status === 'agendada'
                    ? `<button class="btn-entrar-reuniao" onclick="entrarReuniaoPortal(${r.id}, '${r.titulo.replace(/'/g, "\\'")}')">▶ Entrar na Reunião</button>`
                    : '';
                return `
                    <div class="reuniao-card">
                        <div class="reuniao-info">
                            <div class="reuniao-titulo">${escapeHtml(r.titulo)}</div>
                            <div class="reuniao-meta">
                                <span>${dataFmt}</span>
                                <span>·</span>
                                <span>${r.duracao_minutos || 60} min</span>
                                ${badge}
                            </div>
                            ${r.descricao ? `<div style="font-size:13px;color:#94a3b8;margin-top:6px;">${escapeHtml(r.descricao)}</div>` : ''}
                        </div>
                        ${btnEntrar}
                    </div>`;
            }).join('');
        } catch (e) {
            lista.innerHTML = '<div style="color:#f87171;font-size:14px;padding:20px 0;">Erro ao carregar reuniões.</div>';
        }
    }

    // ---- PeerJS Videochamada (cliente = participante) ----
    let _portalPeer = null;
    let _portalCall = null;
    let _portalLocalStream = null;
    let _portalMuteOn = false;
    let _portalCamOff = false;

    function setPortalVideoStatus(msg, connected = false) {
        const el = document.getElementById('portalVideoStatus');
        el.textContent = msg;
        el.classList.toggle('connected', connected);
        document.getElementById('portalWaitMsg').textContent = msg;
    }

    async function entrarReuniaoPortal(id, titulo) {
        try {
            const res = await fetch(`/api/portal/reunioes/${id}/token`, {
                headers: { 'Authorization': 'Bearer ' + portalToken }
            });
            const data = await res.json();
            if (!data.ok) {
                alert(data.erro || 'Não foi possível acessar a sala. Tente novamente.');
                return;
            }

            if (!data.peer_host_id) {
                alert('O advogado ainda não abriu a sala. Peça para ele clicar em "Entrar" primeiro e tente novamente.');
                return;
            }

            document.getElementById('portalVideoTitulo').textContent = titulo || 'Reunião';
            document.getElementById('portalVideoModal').classList.add('show');
            document.getElementById('portalWaitOverlay').style.display = 'flex';
            document.getElementById('portalRemoteVideo').style.display = 'none';
            setPortalVideoStatus('Iniciando câmera...');

            // Acessa câmera e microfone
            try {
                _portalLocalStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                document.getElementById('portalLocalVideo').srcObject = _portalLocalStream;
            } catch (e) {
                fecharPortalVideo();
                alert('Permita o acesso à câmera e microfone no navegador e tente novamente.');
                return;
            }

            setPortalVideoStatus('Conectando ao advogado...');

            // Cria peer com ID aleatório (cliente)
            _portalPeer = new Peer({ debug: 0 });

            _portalPeer.on('open', () => {
                // Chama o advogado pelo peer_host_id recebido do servidor
                const call = _portalPeer.call(data.peer_host_id, _portalLocalStream);
                _portalCall = call;

                call.on('stream', remoteStream => {
                    const rv = document.getElementById('portalRemoteVideo');
                    rv.srcObject = remoteStream;
                    rv.style.display = 'block';
                    document.getElementById('portalWaitOverlay').style.display = 'none';
                    setPortalVideoStatus('Conectado', true);
                });

                call.on('close', () => {
                    document.getElementById('portalRemoteVideo').style.display = 'none';
                    document.getElementById('portalRemoteVideo').srcObject = null;
                    document.getElementById('portalWaitOverlay').style.display = 'flex';
                    setPortalVideoStatus('Advogado desconectou');
                    _portalCall = null;
                });

                call.on('error', err => console.error('[Portal PeerJS] call error:', err));
            });

            _portalPeer.on('error', err => {
                console.error('[Portal PeerJS] erro:', err.type, err);
                if (err.type === 'peer-unavailable') {
                    fecharPortalVideo();
                    alert('O advogado não está disponível na sala ainda. Aguarde ele abrir a sala e tente novamente.');
                } else {
                    setPortalVideoStatus('Erro de conexão: ' + err.type);
                }
            });

        } catch (e) {
            console.error('[entrarReuniaoPortal]', e);
            alert('Erro de conexão. Tente novamente.');
        }
    }

    function togglePortalMute() {
        if (!_portalLocalStream) return;
        const track = _portalLocalStream.getAudioTracks()[0];
        if (!track) return;
        _portalMuteOn = !_portalMuteOn;
        track.enabled = !_portalMuteOn;
        const btn = document.getElementById('portalBtnMute');
        btn.textContent = _portalMuteOn ? '🔇 Áudio' : '🎤 Mudo';
        btn.classList.toggle('off', _portalMuteOn);
    }

    function togglePortalCamera() {
        if (!_portalLocalStream) return;
        const track = _portalLocalStream.getVideoTracks()[0];
        if (!track) return;
        _portalCamOff = !_portalCamOff;
        track.enabled = !_portalCamOff;
        const btn = document.getElementById('portalBtnCam');
        btn.textContent = _portalCamOff ? '🚫 Câmera' : '📷 Câmera';
        btn.classList.toggle('off', _portalCamOff);
    }

    function fecharPortalVideo() {
        document.getElementById('portalVideoModal').classList.remove('show');
        if (_portalCall) { try { _portalCall.close(); } catch(_) {} _portalCall = null; }
        if (_portalPeer) { try { _portalPeer.destroy(); } catch(_) {} _portalPeer = null; }
        if (_portalLocalStream) { _portalLocalStream.getTracks().forEach(t => t.stop()); _portalLocalStream = null; }
        document.getElementById('portalLocalVideo').srcObject = null;
        document.getElementById('portalRemoteVideo').srcObject = null;
        document.getElementById('portalRemoteVideo').style.display = 'none';
        document.getElementById('portalWaitOverlay').style.display = 'flex';
        document.getElementById('portalBtnMute').textContent = '🎤 Mudo';
        document.getElementById('portalBtnMute').classList.remove('off');
        document.getElementById('portalBtnCam').textContent = '📷 Câmera';
        document.getElementById('portalBtnCam').classList.remove('off');
        _portalMuteOn = false; _portalCamOff = false;
    }

    // ---- Bootstrap ----
    window.addEventListener('DOMContentLoaded', () => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');

        if (!token) {
            mostrarErro('Nenhum token fornecido. Acesse este portal pelo link enviado pelo seu advogado.');
            return;
        }

        // Check if we already have a valid session token in sessionStorage
        const savedToken = sessionStorage.getItem('portalToken');
        if (savedToken) {
            // Try to use saved token — if fails, re-auth with URL token
            portalToken = savedToken;
            fetch('/api/portal/meus-processos', { headers: { 'Authorization': 'Bearer ' + savedToken } })
                .then(r => {
                    if (r.status === 401) {
                        sessionStorage.removeItem('portalToken');
                        return autenticarPortal(token);
                    }
                    return autenticarPortal(token); // re-auth anyway to refresh name/escritorio
                })
                .catch(() => autenticarPortal(token));
        } else {
            autenticarPortal(token);
        }
    });
