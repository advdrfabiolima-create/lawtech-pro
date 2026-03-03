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

            if (!data.ok) {
                alert('Erro: ' + (data.erro || 'Não foi possível criar a reunião.'));
                return;
            }

            fecharModalNovaReuniao();
            await carregarReunioes();
        } catch (e) {
            alert('Erro de conexão. Tente novamente.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Criar Reunião';
        }
    }

    // ---- PeerJS Videochamada (advogado = host) ----
    let _peer = null;
    let _activeCall = null;
    let _localStream = null;
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
                // Atualiza cache local
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
                _localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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
                    const rv = document.getElementById('remoteVideo');
                    rv.srcObject = remoteStream;
                    rv.style.display = 'block';
                    document.getElementById('videoWaitOverlay').style.display = 'none';
                    setVideoStatus('Conectado', true);
                });
                call.on('close', () => {
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

        // --- PARAR compartilhamento ---
        if (_screenSharing) {
            _screenSharing = false;
            if (_screenStream) {
                _screenStream.getTracks().forEach(t => t.stop());
                _screenStream = null;
            }
            // Volta para câmera no vídeo local
            const camTrack = _localStream ? _localStream.getVideoTracks()[0] : null;
            document.getElementById('localVideo').srcObject = _localStream;

            // Substitui a track enviada ao cliente
            if (_activeCall && _activeCall.peerConnection && camTrack) {
                const sender = _activeCall.peerConnection.getSenders()
                    .find(s => s.track && s.track.kind === 'video');
                if (sender) await sender.replaceTrack(camTrack);
            }

            btn.textContent = '🖥️ Tela';
            btn.classList.remove('off');
            mostrarToast('Compartilhamento de tela encerrado.');
            return;
        }

        // --- INICIAR compartilhamento ---
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            alert('Seu navegador não suporta compartilhamento de tela.');
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
    // Layouts: 'pip' (PiP), 'sidebyside' (lado a lado), 'focus_remote' (cliente grande), 'focus_local' (advogado grande)
    let _recordLayout = 'pip';
    let _canvasAnimFrame = null;

    function setRecordLayout(layout) {
        _recordLayout = layout;
        // Atualiza botões ativos
        document.querySelectorAll('.btn-layout').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById('layout_' + layout);
        if (btn) btn.classList.add('active');
        mostrarToast('Layout: ' + { pip: 'PiP (padrão)', sidebyside: 'Lado a lado', focus_remote: 'Cliente em destaque', focus_local: 'Você em destaque' }[layout]);
    }

    function desenharCanvas(ctx, canvas, localVideo, remoteVideo) {
        const W = canvas.width;
        const H = canvas.height;
        const hasRemote = remoteVideo.srcObject && remoteVideo.readyState >= 2;
        const hasLocal  = localVideo.srcObject  && localVideo.readyState  >= 2;

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, W, H);

        if (_recordLayout === 'sidebyside') {
            // Lado a lado: cliente à esquerda, advogado à direita
            if (hasRemote) ctx.drawImage(remoteVideo, 0,     0, W/2, H);
            if (hasLocal)  ctx.drawImage(localVideo,  W/2,   0, W/2, H);

            // Labels
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(8, H-32, 80, 24);
            ctx.fillRect(W/2+8, H-32, 100, 24);
            ctx.fillStyle = '#fff';
            ctx.font = '13px sans-serif';
            ctx.fillText('Cliente', 16, H-14);
            ctx.fillText('Você', W/2+16, H-14);

        } else if (_recordLayout === 'focus_remote') {
            // Cliente ocupa tela toda, advogado em PiP menor no canto
            if (hasRemote) ctx.drawImage(remoteVideo, 0, 0, W, H);
            if (hasLocal) {
                const pw = W * 0.22, ph = H * 0.22;
                const px = W - pw - 16, py = H - ph - 16;
                ctx.save();
                ctx.beginPath();
                ctx.roundRect(px, py, pw, ph, 10);
                ctx.clip();
                ctx.drawImage(localVideo, px, py, pw, ph);
                ctx.restore();
                ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 10); ctx.stroke();
                // Label
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.fillRect(px+4, py+ph-22, 44, 18);
                ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif';
                ctx.fillText('Você', px+8, py+ph-8);
            }

        } else if (_recordLayout === 'focus_local') {
            // Advogado ocupa tela toda, cliente em PiP menor no canto
            if (hasLocal)  ctx.drawImage(localVideo,  0, 0, W, H);
            if (hasRemote) {
                const pw = W * 0.22, ph = H * 0.22;
                const px = W - pw - 16, py = H - ph - 16;
                ctx.save();
                ctx.beginPath();
                ctx.roundRect(px, py, pw, ph, 10);
                ctx.clip();
                ctx.drawImage(remoteVideo, px, py, pw, ph);
                ctx.restore();
                ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 10); ctx.stroke();
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.fillRect(px+4, py+ph-22, 58, 18);
                ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif';
                ctx.fillText('Cliente', px+8, py+ph-8);
            }

        } else {
            // PiP (padrão): cliente em tela cheia, advogado em PiP no canto inferior direito
            if (hasRemote) ctx.drawImage(remoteVideo, 0, 0, W, H);
            else if (hasLocal) ctx.drawImage(localVideo, 0, 0, W, H);
            if (hasRemote && hasLocal) {
                const pw = W * 0.25, ph = H * 0.25;
                const px = W - pw - 16, py = H - ph - 16;
                ctx.save();
                ctx.beginPath();
                ctx.roundRect(px, py, pw, ph, 10);
                ctx.clip();
                ctx.drawImage(localVideo, px, py, pw, ph);
                ctx.restore();
                ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 10); ctx.stroke();
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.fillRect(px+4, py+ph-22, 44, 18);
                ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif';
                ctx.fillText('Você', px+8, py+ph-8);
            }
        }
    }

    async function toggleRecording() {
        const btn = document.getElementById('btnRecord');

        // --- PARAR gravação ---
        if (_recording) {
            _recording = false;
            clearInterval(_recordingInterval);
            if (_canvasAnimFrame) { cancelAnimationFrame(_canvasAnimFrame); _canvasAnimFrame = null; }

            if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
                _mediaRecorder.stop();
            }

            const aviso = document.getElementById('recordingBadge');
            if (aviso) aviso.style.display = 'none';
            const layoutBar = document.getElementById('layoutBar');
            if (layoutBar) layoutBar.style.display = 'none';

            btn.textContent = '⏺️ Gravar';
            btn.classList.remove('off');
            mostrarToast('Gravação encerrada. O arquivo será baixado automaticamente.');
            return;
        }

        // --- INICIAR gravação ---
        if (!_localStream) {
            alert('Câmera não está ativa. Inicie a reunião antes de gravar.');
            return;
        }

        const remoteVideo = document.getElementById('remoteVideo');
        const localVideo  = document.getElementById('localVideo');

        // ── Canvas para compor os dois vídeos ──────────────────────────────────
        const canvas = document.createElement('canvas');
        canvas.width  = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d');

        // Loop de renderização no canvas
        function renderLoop() {
            desenharCanvas(ctx, canvas, localVideo, remoteVideo);
            _canvasAnimFrame = requestAnimationFrame(renderLoop);
        }
        renderLoop();

        // Stream de vídeo do canvas
        const canvasStream = canvas.captureStream(25); // 25fps

        // Adiciona áudio: local + remoto
        _localStream.getAudioTracks().forEach(t => canvasStream.addTrack(t));
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getAudioTracks().forEach(t => canvasStream.addTrack(t));
        }

        // Escolhe melhor codec disponível
        const mimeType = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm'
        ].find(m => MediaRecorder.isTypeSupported(m)) || '';

        _recordedChunks = [];
        try {
            _mediaRecorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : {});
        } catch(e) {
            alert('Seu navegador não suporta gravação de vídeo.');
            cancelAnimationFrame(_canvasAnimFrame);
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
            const nome  = `reuniao_${agora.getFullYear()}${String(agora.getMonth()+1).padStart(2,'0')}${String(agora.getDate()).padStart(2,'0')}_${String(agora.getHours()).padStart(2,'0')}${String(agora.getMinutes()).padStart(2,'0')}.webm`;
            a.href     = url;
            a.download = nome;
            a.click();
            URL.revokeObjectURL(url);
            _recordedChunks = [];
        };

        _mediaRecorder.start(1000);
        _recording = true;

        // Mostra badge de gravação
        const aviso = document.getElementById('recordingBadge');
        if (aviso) aviso.style.display = 'flex';

        // Mostra barra de layouts
        const layoutBar = document.getElementById('layoutBar');
        if (layoutBar) layoutBar.style.display = 'flex';

        // Cronômetro
        let segundos = 0;
        _recordingInterval = setInterval(() => {
            segundos++;
            const m = String(Math.floor(segundos / 60)).padStart(2, '0');
            const s = String(segundos % 60).padStart(2, '0');
            const timer = document.getElementById('recordingTimer');
            if (timer) timer.textContent = `${m}:${s}`;
        }, 1000);

        btn.textContent = '⏹️ Parar';
        btn.classList.add('off');
        mostrarToast('Gravação iniciada. Escolha o layout no painel acima.');
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
            if (_canvasAnimFrame) { cancelAnimationFrame(_canvasAnimFrame); _canvasAnimFrame = null; }
            if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();
            const aviso = document.getElementById('recordingBadge');
            if (aviso) aviso.style.display = 'none';
            const btnRec = document.getElementById('btnRecord');
            if (btnRec) { btnRec.textContent = '⏺️ Gravar'; btnRec.classList.remove('off'); }
        }
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