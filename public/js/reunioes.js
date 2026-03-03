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
        // Pré-preenche data/hora com +1h (em hora local, não UTC)
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
        // Converte datetime-local (sem fuso) para ISO UTC respeitando a hora local do navegador
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
    let _muteOn = false;
    let _camOff = false;
    let _screenSharing = false;
    let _screenStream = null;
    let _recording = false;
    let _mediaRecorder = null;
    let _recordedChunks = [];
    let _recordingInterval = null;

    async function entrarReuniao(id, titulo) {
        _notasReuniaoId = id;
        const r = reunioes.find(x => x.id === id);
        if (r && r.anotacoes) document.getElementById('notasTextarea').value = r.anotacoes;

        document.getElementById('videoTitulo').textContent = titulo || 'Reunião';
        document.getElementById('modalVideo').classList.add('show');
        document.getElementById('videoStatus').textContent = 'Inicializando...';

        try {
            _localStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720 },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
        } catch (e) {
            alert('Não foi possível acessar câmera/microfone. Verifique as permissões.');
            fecharModalVideo();
            return;
        }

        document.getElementById('localVideo').srcObject = _localStream;

        const uniqueId = 'lawtech-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

        console.log('[PeerJS] Criando Peer com ID:', uniqueId);
        
        _peer = new Peer(uniqueId, {
            host: 'lawtech-peerserver.onrender.com',
            port: 443,
            path: '/myapp',
            secure: true,
            debug: 2  // Aumentado para debug mais detalhado
        });

        _peer.on('open', peerId => {
            console.log('[PeerJS] Peer aberto, ID:', peerId);
            const shareLink = `${window.location.origin}/cliente-reuniao?roomId=${peerId}`;
            navigator.clipboard.writeText(shareLink).then(() => {
                document.getElementById('videoStatus').textContent = 'Sala aberta! Link copiado. Aguardando cliente...';
            }).catch(() => {
                document.getElementById('videoStatus').textContent = `Sala aberta! Compartilhe: ${shareLink}`;
            });
        });

        _peer.on('call', call => {
            console.log('[PeerJS] Recebendo chamada do cliente...');
            call.answer(_localStream);
            _activeCall = call;

            call.on('stream', remoteStream => {
                console.log('[PeerJS] Stream remoto recebido');
                _remoteStream = remoteStream;
                const remoteVideo = document.getElementById('remoteVideo');
                remoteVideo.srcObject = remoteStream;
                remoteVideo.style.display = 'block';
                document.getElementById('videoWaitOverlay').style.display = 'none';
                document.getElementById('videoStatus').textContent = 'Cliente conectado';
                mostrarToast('Cliente entrou na reunião!');
            });

            call.on('close', () => {
                console.log('[PeerJS] Chamada encerrada');
                document.getElementById('remoteVideo').srcObject = null;
                document.getElementById('remoteVideo').style.display = 'none';
                document.getElementById('videoWaitOverlay').style.display = 'flex';
                document.getElementById('videoStatus').textContent = 'Cliente desconectado.';
                _remoteStream = null;
                mostrarToast('Cliente saiu da reunião.');
            });

            call.on('error', err => {
                console.error('[PeerJS] Erro na chamada:', err);
                mostrarToast('Erro na conexão com o cliente.');
            });
        });

        _peer.on('connection', conn => {
            console.log('[PeerJS] Nova conexão de dados recebida');
            conn.on('open', () => {
                console.log('[PeerJS] Conexão de dados aberta');
            });
        });

        _peer.on('disconnected', () => {
            console.log('[PeerJS] Peer desconectado do servidor');
            document.getElementById('videoStatus').textContent = 'Desconectado do servidor. Reconectando...';
            // Tenta reconectar
            setTimeout(() => {
                if (_peer && !_peer.destroyed) {
                    _peer.reconnect();
                }
            }, 1000);
        });

        _peer.on('error', err => {
            console.error('[PeerJS] erro:', err);
            if (err.type === 'unavailable-id') {
                document.getElementById('videoStatus').textContent = 'ID de sala já em uso. Tente novamente.';
            } else if (err.type === 'peer-unavailable') {
                document.getElementById('videoStatus').textContent = 'Cliente não encontrado. Verifique se ele entrou na sala.';
            } else if (err.type === 'network') {
                document.getElementById('videoStatus').textContent = 'Erro de rede. Verifique sua conexão.';
            } else if (err.type === 'server-error') {
                document.getElementById('videoStatus').textContent = 'Erro no servidor PeerJS. Tente novamente.';
            } else {
                document.getElementById('videoStatus').textContent = 'Erro: ' + err.type;
            }
        });
    }

    function toggleMute() {
        const btn = document.getElementById('btnMute');
        if (!_localStream) return;

        _muteOn = !_muteOn;
        _localStream.getAudioTracks().forEach(t => { t.enabled = !_muteOn; });

        if (_muteOn) {
            btn.textContent = '🔇 Mudo';
            btn.classList.add('off');
        } else {
            btn.textContent = '🎤 Mudo';
            btn.classList.remove('off');
        }
    }

    function toggleCamera() {
        const btn = document.getElementById('btnCam');
        if (!_localStream) return;

        _camOff = !_camOff;
        _localStream.getVideoTracks().forEach(t => { t.enabled = !_camOff; });

        if (_camOff) {
            btn.textContent = '📷 Ligada';
            btn.classList.add('off');
        } else {
            btn.textContent = '📷 Câmera';
            btn.classList.remove('off');
        }
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
            // Usuário cancelou ou negou permissão
            return;
        }

        _screenSharing = true;
        const screenTrack = _screenStream.getVideoTracks()[0];

        // Mostra a tela no vídeo local
        document.getElementById('localVideo').srcObject = _screenStream;

        // Substitui a track enviada ao cliente via PeerJS
        if (_activeCall && _activeCall.peerConnection) {
            const sender = _activeCall.peerConnection.getSenders()
                .find(s => s.track && s.track.kind === 'video');
            if (sender) await sender.replaceTrack(screenTrack);
        }

        // Quando o usuário para pelo botão do navegador, sincroniza o estado
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
            // Vídeo mais largo - crop nas laterais
            sw = video.videoHeight * targetAspect;
            sx = (video.videoWidth - sw) / 2;
        } else {
            // Vídeo mais alto - crop em cima/baixo
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
            // pip (default)
            if (hasR) drawVideoWithAspectRatio(ctx, remoteVideo, 0, 0, W, H);
            else if (hasL) drawVideoWithAspectRatio(ctx, localVideo, 0, 0, W, H);
            if (hasR && hasL) pip(localVideo, W*0.75-16, H*0.72-16, W*0.23, H*0.26, 'Você');
            if (hasR) label('Cliente', 0, H - 50, 64);
        }
    }

    async function toggleRecording() {
        const btn = document.getElementById('btnRecord');

        // --- PARAR gravação ---
        if (_recording) {
            _recording = false;
            clearInterval(_recordingInterval);
            if (_canvasAnimId) { cancelAnimationFrame(_canvasAnimId); _canvasAnimId = null; }
            if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();

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

        // Canvas que substitui os vídeos na tela ao vivo
        _canvasEl = document.createElement('canvas');
        _canvasEl.width  = 1280;
        _canvasEl.height = 720;
        _canvasEl.style.cssText = 'width:100%;height:100%;object-fit:contain;position:absolute;inset:0;z-index:5;background:#0f172a;';
        videoArea.appendChild(_canvasEl);

        remoteVideo.style.display = 'none';
        localVideo.style.display  = 'none';

        const ctx = _canvasEl.getContext('2d');
        const W = _canvasEl.width, H = _canvasEl.height;

        function loop() {
            if (!_recording) return; // Para a animação se a gravação for parada
            _renderCanvas(ctx, W, H, localVideo, remoteVideo);
            _canvasAnimId = requestAnimationFrame(loop);
        }
        loop();

        // CORREÇÃO: Captura de áudio aprimorada
        const canvasStream = _canvasEl.captureStream(30); // Aumentado de 25 para 30 fps
        
        // Cria AudioContext para mixar os áudios
        const audioContext = new AudioContext();
        const audioDestination = audioContext.createMediaStreamDestination();
        
        // Adiciona áudio local
        if (_localStream.getAudioTracks().length > 0) {
            const localAudioSource = audioContext.createMediaStreamSource(
                new MediaStream(_localStream.getAudioTracks())
            );
            localAudioSource.connect(audioDestination);
        }
        
        // Adiciona áudio remoto
        if (_remoteStream && _remoteStream.getAudioTracks().length > 0) {
            const remoteAudioSource = audioContext.createMediaStreamSource(
                new MediaStream(_remoteStream.getAudioTracks())
            );
            remoteAudioSource.connect(audioDestination);
        }
        
        // Adiciona as tracks de áudio mixadas ao stream do canvas
        audioDestination.stream.getAudioTracks().forEach(track => {
            canvasStream.addTrack(track);
        });

        const mimeType = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm'
        ].find(m => MediaRecorder.isTypeSupported(m)) || '';

        _recordedChunks = [];
        try {
            _mediaRecorder = new MediaRecorder(canvasStream, {
                mimeType: mimeType || undefined,
                videoBitsPerSecond: 2500000, // 2.5 Mbps para melhor qualidade
                audioBitsPerSecond: 128000   // 128 kbps para áudio
            });
        } catch(e) {
            alert('Seu navegador não suporta gravação.');
            if (_canvasAnimId) cancelAnimationFrame(_canvasAnimId);
            return;
        }

        _mediaRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) _recordedChunks.push(e.data);
        };

        _mediaRecorder.onstop = () => {
            const blob = new Blob(_recordedChunks, { type: mimeType || 'video/webm' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            const agora = new Date();
            a.href     = url;
            a.download = `reuniao_${agora.getFullYear()}${String(agora.getMonth()+1).padStart(2,'0')}${String(agora.getDate()).padStart(2,'0')}_${String(agora.getHours()).padStart(2,'0')}${String(agora.getMinutes()).padStart(2,'0')}.webm`;
            a.click();
            URL.revokeObjectURL(url);
            _recordedChunks = [];
            
            // Limpa o AudioContext
            if (audioContext.state !== 'closed') {
                audioContext.close();
            }
        };

        _mediaRecorder.start(1000);
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
        // Salva notas pendentes antes de fechar
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

        // Para gravação se estiver ativa
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
        // Fecha painel de notas
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

    // Atualizar status
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

    // Cancelar reunião (marca como cancelada)
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

    // ── Painel de anotações durante a reunião ──
    let _notasReuniaoId = null;
    let _notasDebounce = null;

    function toggleNotasPanel() {
        const panel = document.getElementById('notesPanel');
        const btn = document.getElementById('btnNotasToggle');
        panel.classList.toggle('open');
        btn.classList.toggle('active');
        if (panel.classList.contains('open')) {
            setTimeout(() => document.getElementById('notasTextarea').focus(), 100);
        }
    }

    function onNotasInput() {
        clearTimeout(_notasDebounce);
        const status = document.getElementById('notasSaveStatus');
        status.textContent = 'Salvando...';
        status.style.opacity = '1';
        _notasDebounce = setTimeout(() => {
            salvarNotas();
        }, 1500);
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
                setTimeout(() => { status.style.opacity = '0'; }, 2000);
                const r = reunioes.find(x => x.id === _notasReuniaoId);
                if (r) r.anotacoes = texto;
            } else {
                status.textContent = '✗ Erro ao salvar';
                setTimeout(() => { status.style.opacity = '0'; }, 3000);
            }
        } catch (e) {
            status.textContent = '✗ Erro de conexão';
            setTimeout(() => { status.style.opacity = '0'; }, 3000);
        }
    }

    // ---- Modal de anotações (pós-reunião) ----
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

    // Excluir permanentemente (apenas concluída/cancelada)
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

    // Fechar modais ao clicar fora
    document.getElementById('modalNovaReuniao').addEventListener('click', function(e) {
        if (e.target === this) fecharModalNovaReuniao();
    });
    document.getElementById('modalVideo').addEventListener('click', function(e) {
        if (e.target === this) fecharModalVideo();
    });
    document.getElementById('modalNotas').addEventListener('click', function(e) {
        if (e.target === this) fecharModalNotas();
    });

    // User menu
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

    // Badge CRM
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