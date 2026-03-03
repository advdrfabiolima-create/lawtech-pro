const TOKEN = localStorage.getItem('token');
    if (!TOKEN) { window.location.href = '/login'; }

    let reunioes = [];

    // Inicialização
    window.addEventListener('DOMContentLoaded', async () => {
        lucide.createIcons();
        await Promise.all([carregarPerfil(), carregarClientes(), carregarReunioes()]);
        verificarBolinhaCRM();
    });

    async function carregarPerfil() {
        try {
            // 1. Dados do usuário
            const resUser = await fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
            const dataUser = await resUser.json();
            if (dataUser.ok) {
                const nomeCompleto = dataUser.usuario.nome || 'Advogado';
                const primeiroNome = nomeCompleto.trim().split(' ')[0];

                const nameHeader = document.getElementById('userNameHeader');
                if (nameHeader) nameHeader.innerText = primeiroNome;

                // Iniciais: primeira letra do primeiro + última palavra
                const partes = nomeCompleto.trim().split(' ').filter(n => n);
                let iniciais = partes[0][0];
                if (partes.length > 1) iniciais += partes[partes.length - 1][0];
                const circulo = document.getElementById('userCircle');
                if (circulo) circulo.innerText = iniciais.toUpperCase();

                document.getElementById('footerEmail').innerText = dataUser.usuario.email || '—';
            }

            // 2. Plano via endpoint correto
            const resPlan = await fetch('/api/plano-consumo', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
            const dataPlan = await resPlan.json();
            const planoEl = document.getElementById('footerPlano');
            if (planoEl) planoEl.innerText = dataPlan.plano || 'Free';
        } catch (e) {
            console.error('[Reuniões] carregarPerfil erro:', e);
        }
    }

    async function carregarClientes() {
        try {
            const res = await fetch('/api/clientes?limit=200', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
            const data = await res.json();
            const sel = document.getElementById('reuniaoClienteId');
            const lista = Array.isArray(data) ? data : (data.data || data.clientes || []);
            lista.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.nome;
                sel.appendChild(opt);
            });
        } catch (e) {}
    }

    async function carregarReunioes() {
        try {
            const res = await fetch('/api/reunioes?limit=200', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
            const data = await res.json();
            reunioes = data.data || data.reunioes || [];
            renderReunioes();
        } catch (e) {
            document.getElementById('listaReunioes').innerHTML =
                '<tr><td colspan="6"><div class="empty-state"><p>Erro ao carregar reuniões.</p></div></td></tr>';
        }
    }

    function renderReunioes() {
        const tbody = document.getElementById('listaReunioes');
        if (reunioes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6">
                <div class="empty-state">
                    <i data-lucide="video-off" style="width:48px;height:48px;"></i>
                    <h3>Nenhuma reunião agendada</h3>
                    <p>Clique em "+ Nova Reunião" para começar.</p>
                </div>
            </td></tr>`;
            lucide.createIcons();
            return;
        }

        tbody.innerHTML = reunioes.map(r => `
            <tr>
                <td><strong>${escapeHtml(r.cliente_nome || '—')}</strong></td>
                <td>${escapeHtml(r.titulo)}</td>
                <td>${formatarDataHora(r.data_hora)}</td>
                <td>${r.duracao_minutos || 60} min</td>
                <td>${badgeStatus(r.status)}</td>
                <td style="text-align:right; white-space:nowrap;">
                    ${r.anotacoes ? `
                        <button class="btn-icon" title="Ver anotações" onclick="verNotasReuniao(${r.id})" style="color:#f59e0b;">
                            <i data-lucide="file-text" style="width:18px;height:18px;"></i>
                        </button>
                    ` : ''}
                    ${r.status === 'agendada' ? `
                        <button class="btn-icon" title="Entrar na Reunião" onclick="entrarReuniao(${r.id}, '${escapeHtml(r.titulo)}')" style="color:#6366f1;">
                            <i data-lucide="video" style="width:18px;height:18px;"></i>
                        </button>
                        <button class="btn-icon" title="Concluir" onclick="atualizarStatus(${r.id}, 'concluida')" style="color:#16a34a;">
                            <i data-lucide="check-circle" style="width:18px;height:18px;"></i>
                        </button>
                        <button class="btn-icon" title="Cancelar Reunião" onclick="cancelarReuniao(${r.id})" style="color:#dc2626;">
                            <i data-lucide="trash-2" style="width:18px;height:18px;"></i>
                        </button>
                    ` : `
                        <button class="btn-icon" title="Excluir permanentemente" onclick="excluirReuniao(${r.id})" style="color:#dc2626;">
                            <i data-lucide="trash-2" style="width:18px;height:18px;"></i>
                        </button>
                    `}
                </td>
            </tr>
        `).join('');
        lucide.createIcons();
    }

    function badgeStatus(status) {
        const map = {
            agendada: '<span class="badge badge-agendada">Agendada</span>',
            concluida: '<span class="badge badge-concluida">Concluída</span>',
            cancelada: '<span class="badge badge-cancelada">Cancelada</span>'
        };
        return map[status] || `<span class="badge">${status}</span>`;
    }

    function formatarDataHora(str) {
        if (!str) return '—';
        const d = new Date(str);
        return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // Modal Nova Reunião
    function abrirModalNovaReuniao() {
        document.getElementById('reuniaoClienteId').value = '';
        document.getElementById('reuniaoTitulo').value = '';
        document.getElementById('reuniaoDescricao').value = '';
        document.getElementById('reuniaoDuracao').value = '60';
        const agora = new Date(Date.now() + 60 * 60 * 1000);
        agora.setSeconds(0, 0);
        const _pad = n => String(n).padStart(2, '0');
        document.getElementById('reuniaoDataHora').value =
            `${agora.getFullYear()}-${_pad(agora.getMonth()+1)}-${_pad(agora.getDate())}T${_pad(agora.getHours())}:${_pad(agora.getMinutes())}`;
        document.getElementById('modalNovaReuniao').classList.add('show');
    }

    function fecharModalNovaReuniao() {
        document.getElementById('modalNovaReuniao').classList.remove('show');
    }

    async function criarReuniao() {
        const titulo = document.getElementById('reuniaoTitulo').value.trim();
        const data_hora = new Date(document.getElementById('reuniaoDataHora').value).toISOString();
        const cliente_id = document.getElementById('reuniaoClienteId').value || null;
        const descricao = document.getElementById('reuniaoDescricao').value.trim();
        const duracao_minutos = parseInt(document.getElementById('reuniaoDuracao').value);

        if (!titulo) { alert('Informe o título da reunião.'); return; }
        if (!data_hora) { alert('Informe a data e hora da reunião.'); return; }

        const btn = document.getElementById('btnCriarReuniao');
        btn.disabled = true;
        btn.textContent = 'Criando...';

        try {
            const res = await fetch('/api/reunioes', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify({ cliente_id, titulo, descricao, data_hora, duracao_minutos })
            });
            const data = await res.json();
            if (data.ok || data.id) {
                await carregarReunioes();
                fecharModalNovaReuniao();
                mostrarToast('Reunião criada com sucesso!');
            } else {
                alert('Erro ao criar reunião: ' + (data.erro || 'Tente novamente.'));
            }
        } catch (e) {
            alert('Erro de conexão.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Criar Reunião';
        }
    }

    // ── PeerJS Videochamada + Gravação ────────────────────────────────────────
    let _peer = null;
    let _activeCall = null;
    let _localStream = null;
    let _remoteStream = null;
    let _screenStream = null;
    let _muteOn = false;
    let _camOff = false;
    let _screenSharing = false;

    // ---- Gravação ----
    let _mediaRecorder = null;
    let _recordedChunks = [];
    let _recording = false;
    let _recordingInterval = null;

    // ---- Anotações ----
    let _notasReuniaoId = null;
    let _notasDebounce = null;

    function toggleNotasPanel() {
        const panel = document.getElementById('notesPanel');
        const btn = document.getElementById('btnNotasToggle');
        const isOpen = panel.classList.toggle('open');
        btn.classList.toggle('active', isOpen);
        if (isOpen) document.getElementById('notasTextarea').focus();
    }

    function onNotasInput() {
        clearTimeout(_notasDebounce);
        const status = document.getElementById('notasSaveStatus');
        status.textContent = 'Digitando...';
        status.className = 'notes-save-status';
        _notasDebounce = setTimeout(salvarNotas, 1500);
    }

    async function salvarNotas() {
        if (!_notasReuniaoId) return;
        const texto = document.getElementById('notasTextarea').value;
        const status = document.getElementById('notasSaveStatus');
        try {
            const res = await fetch(`/api/reunioes/${_notasReuniaoId}/anotacoes`, {
                method: 'PATCH',
                headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify({ anotacoes: texto })
            });
            const data = await res.json();
            if (data.ok) {
                status.textContent = '✓ Salvo';
                status.className = 'notes-save-status saved';
                const r = reunioes.find(x => x.id === _notasReuniaoId);
                if (r) r.anotacoes = texto;
            } else {
                status.textContent = '✗ Erro ao salvar';
                status.className = 'notes-save-status error';
            }
        } catch (e) {
            status.textContent = '✗ Sem conexão';
            status.className = 'notes-save-status error';
        }
    }

    function setVideoStatus(msg, connected = false) {
        const el = document.getElementById('videoStatus');
        el.textContent = msg;
        el.classList.toggle('connected', connected);
        document.getElementById('videoWaitMsg').textContent = msg;
    }

    async function entrarReuniao(id, titulo) {
        try {
            const res = await fetch(`/api/reunioes/${id}/token`, {
                headers: { 'Authorization': 'Bearer ' + TOKEN }
            });
            const data = await res.json();
            if (!data.ok) { alert('Erro: ' + (data.erro || 'Não foi possível acessar a sala.')); return; }

            document.getElementById('videoTitulo').textContent = titulo || 'Reunião';
            document.getElementById('modalVideo').classList.add('show');
            lucide.createIcons();

            // Carrega notas existentes
            _notasReuniaoId = id;
            const reuniaoAtual = reunioes.find(r => r.id === id);
            document.getElementById('notasTextarea').value = reuniaoAtual?.anotacoes || '';
            document.getElementById('notasSaveStatus').textContent = '';
            document.getElementById('notasSaveStatus').className = 'notes-save-status';

            setVideoStatus('Iniciando câmera...');
            document.getElementById('videoWaitOverlay').style.display = 'flex';
            document.getElementById('remoteVideo').style.display = 'none';

            // Acessa câmera e microfone
            try {
                _localStream = await navigator.mediaDevices.getUserMedia({ 
                    video: { width: 1280, height: 720 },
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                document.getElementById('localVideo').srcObject = _localStream;
            } catch (e) {
                fecharModalVideo();
                alert('Permita o acesso à câmera e microfone no navegador e tente novamente.');
                return;
            }

            setVideoStatus('Aguardando o cliente entrar...');

            // Cria peer com ID gerado pelo servidor (único por sessão)
            _peer = new Peer(data.peer_host_id, { debug: 0 });

            _peer.on('open', () => {
                console.log('[PeerJS] Host pronto. ID:', data.peer_host_id);
            });

            _peer.on('call', call => {
                _activeCall = call;
                call.answer(_localStream);
                call.on('stream', remoteStream => {
                    _remoteStream = remoteStream;
                    const rv = document.getElementById('remoteVideo');
                    rv.srcObject = remoteStream;
                    rv.style.display = 'block';
                    document.getElementById('videoWaitOverlay').style.display = 'none';
                    setVideoStatus('Conectado', true);
                });
                call.on('close', () => {
                    _remoteStream = null;
                    document.getElementById('remoteVideo').style.display = 'none';
                    document.getElementById('remoteVideo').srcObject = null;
                    document.getElementById('videoWaitOverlay').style.display = 'flex';
                    setVideoStatus('Cliente desconectou');
                    _activeCall = null;
                });
                call.on('error', err => console.error('[PeerJS] call error:', err));
            });

            _peer.on('error', err => {
                console.error('[PeerJS] erro:', err.type, err);
                if (err.type === 'unavailable-id') {
                    setVideoStatus('ID em uso. Feche e reabra a sala em alguns segundos.');
                } else {
                    setVideoStatus('Erro: ' + err.type);
                }
            });

        } catch (e) {
            console.error('[entrarReuniao]', e);
            alert('Erro de conexão. Tente novamente.');
        }
    }

    function toggleMute() {
        if (!_localStream) return;
        const track = _localStream.getAudioTracks()[0];
        if (!track) return;
        _muteOn = !_muteOn;
        track.enabled = !_muteOn;
        const btn = document.getElementById('btnMute');
        btn.textContent = _muteOn ? '🔇 Áudio' : '🎤 Mudo';
        btn.classList.toggle('off', _muteOn);
    }

    function toggleCamera() {
        if (!_localStream) return;
        const track = _localStream.getVideoTracks()[0];
        if (!track) return;
        _camOff = !_camOff;
        track.enabled = !_camOff;
        const btn = document.getElementById('btnCam');
        btn.textContent = _camOff ? '🚫 Câmera' : '📷 Câmera';
        btn.classList.toggle('off', _camOff);
    }

    async function toggleShareScreen() {
        const btn = document.getElementById('btnScreen');

        if (_screenSharing) {
            if (_screenStream) { _screenStream.getTracks().forEach(t => t.stop()); _screenStream = null; }
            document.getElementById('localVideo').srcObject = _localStream;
            if (_activeCall && _activeCall.peerConnection) {
                const localVideoTrack = _localStream.getVideoTracks()[0];
                const sender = _activeCall.peerConnection.getSenders()
                    .find(s => s.track && s.track.kind === 'video');
                if (sender && localVideoTrack) await sender.replaceTrack(localVideoTrack);
            }
            _screenSharing = false;
            btn.textContent = '🖥️ Tela';
            btn.classList.remove('off');
            mostrarToast('Compartilhamento de tela parado.');
            return;
        }

        try {
            _screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' },
                audio: false
            });
        } catch (e) {
            return;
        }

        _screenSharing = true;
        const screenTrack = _screenStream.getVideoTracks()[0];
        document.getElementById('localVideo').srcObject = _screenStream;

        if (_activeCall && _activeCall.peerConnection) {
            const sender = _activeCall.peerConnection.getSenders()
                .find(s => s.track && s.track.kind === 'video');
            if (sender) await sender.replaceTrack(screenTrack);
        }

        screenTrack.addEventListener('ended', () => {
            if (_screenSharing) toggleShareScreen();
        });

        btn.textContent = '⏹️ Parar Tela';
        btn.classList.add('off');
        mostrarToast('Compartilhando tela com o cliente.');
    }

    // ── Layout da gravação ─────────────────────────────────────────────────────
    let _recordLayout = 'pip';
    let _canvasEl = null;
    let _canvasAnimId = null;

    function setRecordLayout(layout) {
        _recordLayout = layout;
        document.querySelectorAll('.btn-layout').forEach(b => b.classList.remove('active'));
        const b = document.getElementById('layout_' + layout);
        if (b) b.classList.add('active');
        const nomes = { pip: 'PiP', sidebyside: 'Lado a lado', focus_remote: 'Cliente em destaque', focus_local: 'Você em destaque' };
        mostrarToast('Layout: ' + nomes[layout]);
    }

    // CORREÇÃO: Função para desenhar vídeo mantendo aspect ratio
    function drawVideoWithAspectRatio(ctx, video, x, y, w, h) {
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
        
        const videoAspect = video.videoWidth / video.videoHeight;
        const targetAspect = w / h;
        
        let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
        
        if (videoAspect > targetAspect) {
            sw = video.videoHeight * targetAspect;
            sx = (video.videoWidth - sw) / 2;
        } else {
            sh = video.videoWidth / targetAspect;
            sy = (video.videoHeight - sh) / 2;
        }
        
        ctx.drawImage(video, sx, sy, sw, sh, x, y, w, h);
    }

    function _renderCanvas(ctx, W, H, localVideo, remoteVideo) {
        const hasL = localVideo  && localVideo.readyState  >= 2 && localVideo.srcObject;
        const hasR = remoteVideo && remoteVideo.readyState >= 2 && remoteVideo.srcObject;

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, W, H);

        function label(text, x, y, w) {
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(x + 6, y + 6, w, 22);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText(text, x + 12, y + 22);
        }

        function pip(video, px, py, pw, ph, lbl) {
            ctx.save();
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 10);
            else ctx.rect(px, py, pw, ph);
            ctx.clip();
            if (video) drawVideoWithAspectRatio(ctx, video, px, py, pw, ph);
            ctx.restore();
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 10);
            else ctx.rect(px, py, pw, ph);
            ctx.stroke();
            label(lbl, px, py + ph - 30, lbl.length * 8);
        }

        if (_recordLayout === 'sidebyside') {
            if (hasR) drawVideoWithAspectRatio(ctx, remoteVideo, 0, 0, W/2, H);
            if (hasL) drawVideoWithAspectRatio(ctx, localVideo, W/2, 0, W/2, H);
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H); ctx.stroke();
            label('Cliente', 0,   H - 50, 64);
            label('Você',    W/2, H - 50, 44);
        } else if (_recordLayout === 'focus_remote') {
            if (hasR) drawVideoWithAspectRatio(ctx, remoteVideo, 0, 0, W, H);
            if (hasL && hasR) pip(localVideo,  W*0.75-16, H*0.72-16, W*0.23, H*0.26, 'Você');
            else if (hasL) drawVideoWithAspectRatio(ctx, localVideo, 0, 0, W, H);
            if (hasR) label('Cliente', 0, H - 50, 64);
        } else if (_recordLayout === 'focus_local') {
            if (hasL) drawVideoWithAspectRatio(ctx, localVideo, 0, 0, W, H);
            if (hasR && hasL) pip(remoteVideo, W*0.75-16, H*0.72-16, W*0.23, H*0.26, 'Cliente');
            else if (hasR) drawVideoWithAspectRatio(ctx, remoteVideo, 0, 0, W, H);
            if (hasL) label('Você', 0, H - 50, 44);
        } else {
            if (hasR) drawVideoWithAspectRatio(ctx, remoteVideo, 0, 0, W, H);
            else if (hasL) drawVideoWithAspectRatio(ctx, localVideo, 0, 0, W, H);
            if (hasR && hasL) pip(localVideo, W*0.75-16, H*0.72-16, W*0.23, H*0.26, 'Você');
            if (hasR) label('Cliente', 0, H - 50, 64);
        }
    }

    // SUBSTITUIR APENAS A FUNÇÃO toggleRecording no seu reunioes.js

async function toggleRecording() {
    const btn = document.getElementById('btnRecord');

    // --- PARAR gravação ---
    if (_recording) {
        _recording = false;
        clearInterval(_recordingInterval);
        if (_canvasAnimId) { cancelAnimationFrame(_canvasAnimId); _canvasAnimId = null; }
        if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
            _mediaRecorder.stop();
        }

        const videoArea = document.getElementById('videoArea');
        if (_canvasEl && videoArea.contains(_canvasEl)) videoArea.removeChild(_canvasEl);
        _canvasEl = null;
        const remoteVideo = document.getElementById('remoteVideo');
        const localVideo  = document.getElementById('localVideo');
        remoteVideo.style.display = remoteVideo.srcObject ? 'block' : 'none';
        localVideo.style.display = 'block';

        document.getElementById('recordingBadge').style.display = 'none';
        document.getElementById('layoutBar').style.display = 'none';
        btn.textContent = '⏺️ Gravar';
        btn.classList.remove('off');
        mostrarToast('Gravação encerrada. Arquivo será baixado automaticamente.');
        return;
    }

    // --- INICIAR gravação ---
    if (!_localStream) {
        alert('Câmera não está ativa. Inicie a reunião antes de gravar.');
        return;
    }

    const remoteVideo = document.getElementById('remoteVideo');
    const localVideo  = document.getElementById('localVideo');
    const videoArea   = document.getElementById('videoArea');

    console.log('[Recording] Iniciando gravação...');
    console.log('[Recording] Local video readyState:', localVideo.readyState);
    console.log('[Recording] Remote video readyState:', remoteVideo.readyState);

    // Canvas que substitui os vídeos na tela ao vivo
    _canvasEl = document.createElement('canvas');
    _canvasEl.width  = 1280;
    _canvasEl.height = 720;
    _canvasEl.style.cssText = 'width:100%;height:100%;object-fit:contain;position:absolute;inset:0;z-index:5;background:#0f172a;';
    videoArea.appendChild(_canvasEl);

    remoteVideo.style.display = 'none';
    localVideo.style.display  = 'none';

    const ctx = _canvasEl.getContext('2d', { willReadFrequently: false });
    const W = _canvasEl.width, H = _canvasEl.height;

    function loop() {
        if (!_recording) return; // Para se gravação parar
        _renderCanvas(ctx, W, H, localVideo, remoteVideo);
        _canvasAnimId = requestAnimationFrame(loop);
    }
    loop();

    console.log('[Recording] Canvas criado e loop iniciado');

    // Aguarda um frame para garantir que o canvas tenha conteúdo
    await new Promise(resolve => setTimeout(resolve, 100));

    // Stream: canvas (video) + audio local + audio remoto
    let canvasStream;
    try {
        canvasStream = _canvasEl.captureStream(30); // 30 FPS
        console.log('[Recording] Canvas stream criado:', canvasStream);
        console.log('[Recording] Canvas video tracks:', canvasStream.getVideoTracks().length);
    } catch (e) {
        console.error('[Recording] Erro ao capturar canvas stream:', e);
        alert('Erro ao iniciar gravação. Navegador pode não suportar captureStream.');
        cancelAnimationFrame(_canvasAnimId);
        videoArea.removeChild(_canvasEl);
        remoteVideo.style.display = remoteVideo.srcObject ? 'block' : 'none';
        localVideo.style.display = 'block';
        return;
    }

    // Adiciona áudio local
    const localAudioTracks = _localStream.getAudioTracks();
    console.log('[Recording] Local audio tracks:', localAudioTracks.length);
    localAudioTracks.forEach(track => {
        console.log('[Recording] Adicionando track local:', track.label, 'enabled:', track.enabled);
        canvasStream.addTrack(track.clone());
    });

    // Adiciona áudio remoto
    if (_remoteStream) {
        const remoteAudioTracks = _remoteStream.getAudioTracks();
        console.log('[Recording] Remote audio tracks:', remoteAudioTracks.length);
        remoteAudioTracks.forEach(track => {
            console.log('[Recording] Adicionando track remoto:', track.label, 'enabled:', track.enabled);
            canvasStream.addTrack(track.clone());
        });
    }

    console.log('[Recording] Total tracks no stream:', canvasStream.getTracks().length);

    // Escolhe o melhor codec disponível
    const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
    ];

    let selectedMimeType = '';
    for (const type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
            selectedMimeType = type;
            console.log('[Recording] Codec selecionado:', type);
            break;
        }
    }

    if (!selectedMimeType) {
        alert('Seu navegador não suporta nenhum formato de gravação WebM.');
        cancelAnimationFrame(_canvasAnimId);
        videoArea.removeChild(_canvasEl);
        remoteVideo.style.display = remoteVideo.srcObject ? 'block' : 'none';
        localVideo.style.display = 'block';
        return;
    }

    _recordedChunks = [];
    
    try {
        _mediaRecorder = new MediaRecorder(canvasStream, {
            mimeType: selectedMimeType,
            videoBitsPerSecond: 2500000, // 2.5 Mbps
            audioBitsPerSecond: 128000   // 128 kbps
        });
        
        console.log('[Recording] MediaRecorder criado');
    } catch(e) {
        console.error('[Recording] Erro ao criar MediaRecorder:', e);
        alert('Erro ao criar gravador. Tente usar outro navegador (Chrome/Edge recomendado).');
        cancelAnimationFrame(_canvasAnimId);
        videoArea.removeChild(_canvasEl);
        remoteVideo.style.display = remoteVideo.srcObject ? 'block' : 'none';
        localVideo.style.display = 'block';
        return;
    }

    _mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
            console.log('[Recording] Chunk recebido:', e.data.size, 'bytes');
            _recordedChunks.push(e.data);
        } else {
            console.warn('[Recording] Chunk vazio recebido');
        }
    };

    _mediaRecorder.onstop = () => {
        console.log('[Recording] Gravação parada. Total chunks:', _recordedChunks.length);
        
        if (_recordedChunks.length === 0) {
            alert('Nenhum dado foi gravado. Tente novamente.');
            return;
        }

        const totalSize = _recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0);
        console.log('[Recording] Tamanho total:', totalSize, 'bytes');

        if (totalSize === 0) {
            alert('Gravação resultou em arquivo vazio. Verifique as permissões de câmera/microfone.');
            return;
        }

        const blob = new Blob(_recordedChunks, { type: selectedMimeType });
        console.log('[Recording] Blob criado:', blob.size, 'bytes');
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const agora = new Date();
        a.href = url;
        a.download = `reuniao_${agora.getFullYear()}${String(agora.getMonth()+1).padStart(2,'0')}${String(agora.getDate()).padStart(2,'0')}_${String(agora.getHours()).padStart(2,'0')}${String(agora.getMinutes()).padStart(2,'0')}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        setTimeout(() => URL.revokeObjectURL(url), 100);
        _recordedChunks = [];
        
        mostrarToast('Download iniciado! Arquivo: ' + (totalSize / 1024 / 1024).toFixed(2) + ' MB');
    };

    _mediaRecorder.onerror = e => {
        console.error('[Recording] Erro no MediaRecorder:', e);
        alert('Erro durante a gravação: ' + (e.error?.message || 'Desconhecido'));
    };

    _mediaRecorder.onstart = () => {
        console.log('[Recording] MediaRecorder iniciado, state:', _mediaRecorder.state);
    };

    try {
        _mediaRecorder.start(1000); // Chunks a cada 1 segundo
        console.log('[Recording] MediaRecorder.start() chamado');
    } catch (e) {
        console.error('[Recording] Erro ao iniciar MediaRecorder:', e);
        alert('Erro ao iniciar gravação: ' + e.message);
        cancelAnimationFrame(_canvasAnimId);
        videoArea.removeChild(_canvasEl);
        remoteVideo.style.display = remoteVideo.srcObject ? 'block' : 'none';
        localVideo.style.display = 'block';
        return;
    }

    _recording = true;

    document.getElementById('recordingBadge').style.display = 'flex';
    document.getElementById('layoutBar').style.display = 'flex';

    let segundos = 0;
    _recordingInterval = setInterval(() => {
        segundos++;
        const m = String(Math.floor(segundos / 60)).padStart(2, '0');
        const s = String(segundos % 60).padStart(2, '0');
        const t = document.getElementById('recordingTimer');
        if (t) t.textContent = `${m}:${s}`;
    }, 1000);

    btn.textContent = '⏹️ Parar';
    btn.classList.add('off');
    mostrarToast('Gravação iniciada. Escolha o layout acima.');
}

    function fecharModalVideo() {
        clearTimeout(_notasDebounce);
        if (_notasReuniaoId && document.getElementById('notasTextarea').value.trim()) {
            salvarNotas();
        }

        document.getElementById('modalVideo').classList.remove('show');
        if (_activeCall) { try { _activeCall.close(); } catch(_) {} _activeCall = null; }
        if (_peer) { try { _peer.destroy(); } catch(_) {} _peer = null; }
        if (_localStream) { _localStream.getTracks().forEach(t => t.stop()); _localStream = null; }
        document.getElementById('localVideo').srcObject = null;
        document.getElementById('remoteVideo').srcObject = null;
        document.getElementById('remoteVideo').style.display = 'none';
        document.getElementById('videoWaitOverlay').style.display = 'flex';
        document.getElementById('btnMute').textContent = '🎤 Mudo';
        document.getElementById('btnMute').classList.remove('off');
        document.getElementById('btnCam').textContent = '📷 Câmera';
        document.getElementById('btnCam').classList.remove('off');
        const btnScreen = document.getElementById('btnScreen');
        if (btnScreen) { btnScreen.textContent = '🖥️ Tela'; btnScreen.classList.remove('off'); }
        if (_screenStream) { _screenStream.getTracks().forEach(t => t.stop()); _screenStream = null; }
        _screenSharing = false;

        if (_recording) {
            _recording = false;
            clearInterval(_recordingInterval);
            if (_canvasAnimId) { cancelAnimationFrame(_canvasAnimId); _canvasAnimId = null; }
            if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();
            const videoArea = document.getElementById('videoArea');
            if (_canvasEl && videoArea.contains(_canvasEl)) videoArea.removeChild(_canvasEl);
            _canvasEl = null;
            const aviso = document.getElementById('recordingBadge');
            if (aviso) aviso.style.display = 'none';
            const lb = document.getElementById('layoutBar');
            if (lb) lb.style.display = 'none';
            const btnRec = document.getElementById('btnRecord');
            if (btnRec) { btnRec.textContent = '⏺️ Gravar'; btnRec.classList.remove('off'); }
        }
        _remoteStream = null;
        document.getElementById('notesPanel').classList.remove('open');
        document.getElementById('btnNotasToggle').classList.remove('active');
        _muteOn = false; _camOff = false; _notasReuniaoId = null;
    }

    function mostrarToast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2500);
    }

    async function atualizarStatus(id, status) {
        const labels = { concluida: 'concluída', cancelada: 'cancelada' };
        if (!confirm(`Marcar reunião como ${labels[status] || status}?`)) return;

        try {
            const res = await fetch(`/api/reunioes/${id}/status`, {
                method: 'PATCH',
                headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            const data = await res.json();
            if (!data.ok) { alert('Erro: ' + (data.erro || 'Falha ao atualizar status.')); return; }
            await carregarReunioes();
        } catch (e) {
            alert('Erro de conexão.');
        }
    }

    async function cancelarReuniao(id) {
        if (!confirm('Cancelar esta reunião?')) return;

        try {
            const res = await fetch(`/api/reunioes/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + TOKEN }
            });
            const data = await res.json();
            if (!data.ok) { alert('Erro: ' + (data.erro || 'Falha ao cancelar.')); return; }
            await carregarReunioes();
        } catch (e) {
            alert('Erro de conexão.');
        }
    }

    let _notasModalId = null;

    function verNotasReuniao(id) {
        const r = reunioes.find(x => x.id === id);
        if (!r) return;
        _notasModalId = id;
        document.getElementById('notasModalCliente').textContent = r.cliente_nome || '(sem cliente)';
        document.getElementById('notasModalData').textContent = formatarDataHora(r.data_hora) + ' · ' + (r.titulo || '');
        document.getElementById('notasModalTexto').value = r.anotacoes || '';
        document.getElementById('modalNotas').classList.add('show');
        lucide.createIcons();
        setTimeout(() => document.getElementById('notasModalTexto').focus(), 80);
    }

    function fecharModalNotas() {
        document.getElementById('modalNotas').classList.remove('show');
        _notasModalId = null;
    }

    async function salvarNotasModal() {
        if (!_notasModalId) return;
        const texto = document.getElementById('notasModalTexto').value;
        const btn = document.getElementById('btnSalvarNotasModal');
        btn.disabled = true;
        btn.textContent = 'Salvando...';
        try {
            const res = await fetch(`/api/reunioes/${_notasModalId}/anotacoes`, {
                method: 'PATCH',
                headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify({ anotacoes: texto })
            });
            const data = await res.json();
            if (data.ok) {
                const r = reunioes.find(x => x.id === _notasModalId);
                if (r) r.anotacoes = texto;
                renderReunioes();
                mostrarToast('Anotações salvas com sucesso!');
                fecharModalNotas();
            } else {
                alert('Erro ao salvar: ' + (data.erro || 'Tente novamente.'));
            }
        } catch (e) {
            alert('Erro de conexão.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Salvar alterações';
        }
    }

    async function excluirReuniao(id) {
        if (!confirm('Excluir permanentemente esta reunião? Esta ação não pode ser desfeita.')) return;

        try {
            const res = await fetch(`/api/reunioes/${id}/excluir`, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + TOKEN }
            });
            const data = await res.json();
            if (!data.ok) { alert('Erro: ' + (data.erro || 'Falha ao excluir.')); return; }
            await carregarReunioes();
        } catch (e) {
            alert('Erro de conexão.');
        }
    }

    document.getElementById('modalNovaReuniao').addEventListener('click', function(e) {
        if (e.target === this) fecharModalNovaReuniao();
    });
    document.getElementById('modalVideo').addEventListener('click', function(e) {
        if (e.target === this) fecharModalVideo();
    });
    document.getElementById('modalNotas').addEventListener('click', function(e) {
        if (e.target === this) fecharModalNotas();
    });

    function toggleUserMenu() {
        document.getElementById('userMenuDropdown').classList.toggle('show');
    }
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#userCircle')) {
            document.getElementById('userMenuDropdown').classList.remove('show');
        }
    });

    function logout() {
        localStorage.removeItem('token');
        window.location.href = '/login';
    }

    function toggleIaMenu(e) {
        e.preventDefault();
        document.getElementById('submenu-ia').classList.toggle('open');
    }

    function limparBolinha() {
        const dot = document.getElementById('dotNotificacao');
        if (dot) dot.style.display = 'none';
        localStorage.removeItem('crmNovoLead');
    }

    function verificarBolinhaCRM() {
        const dot = document.getElementById('dotNotificacao');
        if (!dot) return;
        if (localStorage.getItem('crmNovoLead') === '1') dot.style.display = 'inline-block';
    }