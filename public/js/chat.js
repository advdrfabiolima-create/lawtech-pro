
let token = localStorage.getItem('token');
if (!token) window.location.href = '/login';

let currentUserId = null;
let currentUserNome = '';
let conversaAtiva = null; // { tipo: 'geral' } ou { tipo: 'dm', usuario_id, nome }
let ultimoMsgId = 0; // ID da última mensagem carregada (polling por ID sequencial)
let usuarios = [];
let pollingInterval = null;
let pollingNaoLidasInterval = null;
let mensagensExibidas = new Set(); // IDs já exibidas (evita duplicatas)
let pollingEmAndamento = false; // Guard contra chamadas concorrentes

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', async () => {
    await carregarInfoRodape();
    await carregarUsuarios();
    renderConversas();
    iniciarPollingNaoLidas();
    lucide.createIcons();
});

// ========== AUTH / FOOTER ==========
async function carregarInfoRodape() {
    try {
        const resUser = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        const dataUser = await resUser.json();

        if (dataUser.ok) {
            currentUserId = dataUser.usuario.id;
            currentUserNome = dataUser.usuario.nome || 'Advogado';

            const emailElement = document.getElementById('userEmail');
            if (emailElement) emailElement.innerText = dataUser.usuario.email || '';

            const primeiroNome = currentUserNome.trim().split(' ')[0];
            const nameHeader = document.getElementById('userNameHeader');
            if (nameHeader) nameHeader.innerText = primeiroNome;

            const partes = currentUserNome.trim().split(' ').filter(n => n);
            let iniciais = partes[0][0];
            if (partes.length > 1) iniciais += partes[partes.length - 1][0];
            const circulo = document.getElementById('userCircle');
            if (circulo) circulo.innerText = iniciais.toUpperCase();
        }

        const resPlan = await fetch('/api/plano-consumo', { headers: { Authorization: `Bearer ${token}` } });
        const dataPlan = await resPlan.json();
        const planoElement = document.getElementById('planNameFooter');
        if (planoElement) planoElement.innerText = dataPlan.plano || 'Free';
    } catch (e) { console.error('Erro rodapé:', e); }
}

function toggleUserMenu() {
    const d = document.getElementById('userDropdown');
    d.style.display = d.style.display === 'block' ? 'none' : 'block';
}
function logout() { localStorage.removeItem('token'); window.location.href = '/login'; }
function toggleIaMenu(e) { e.preventDefault(); document.getElementById('submenu-ia').classList.toggle('open'); }
function limparBolinha() { const dot = document.getElementById('dotNotificacao'); if (dot) dot.style.display = 'none'; }

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

document.addEventListener('click', (e) => {
    const menu = document.getElementById('userDropdown');
    const circle = document.getElementById('userCircle');
    if (menu && !menu.contains(e.target) && e.target !== circle) menu.style.display = 'none';
});

// ========== USUARIOS ==========
async function carregarUsuarios() {
    try {
        const res = await fetch('/api/chat/usuarios', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (data.ok) usuarios = data.usuarios;
    } catch (e) { console.error('Erro ao carregar usuários:', e); }
}

// ========== CONVERSAS ==========
let naoLidasMap = {};

function renderConversas() {
    const list = document.getElementById('conversationsList');
    let html = '';

    // Chat Geral
    const geralActive = conversaAtiva && conversaAtiva.tipo === 'geral' ? 'active' : '';
    const geralBadge = naoLidasMap.geral ? `<span class="badge-nao-lida">${naoLidasMap.geral}</span>` : '';
    html += `
        <div class="conversation-item ${geralActive}" onclick="abrirConversa('geral')">
            <div class="conv-icon geral">🏢</div>
            <div class="conv-info">
                <div class="conv-name">Chat Geral</div>
                <div class="conv-preview">Todos do escritório</div>
            </div>
            ${geralBadge}
        </div>
    `;

    // DMs
    usuarios.forEach(u => {
        const dmActive = conversaAtiva && conversaAtiva.tipo === 'dm' && conversaAtiva.usuario_id === u.id ? 'active' : '';
        const badge = naoLidasMap[u.id] ? `<span class="badge-nao-lida">${naoLidasMap[u.id]}</span>` : '';
        const iniciais = getIniciais(u.nome);
        const onlineDot = u.online ? '<span class="online-dot"></span>' : '';
        html += `
            <div class="conversation-item ${dmActive}" onclick="abrirConversa('dm', ${u.id}, '${escaparHtml(u.nome)}')">
                <div class="conv-icon dm">${iniciais}${onlineDot}</div>
                <div class="conv-info">
                    <div class="conv-name">${escaparHtml(u.nome)}</div>
                    <div class="conv-preview">${u.online ? '🟢 Online' : escaparHtml(u.email)}</div>
                </div>
                ${badge}
            </div>
        `;
    });

    list.innerHTML = html;
}

function getIniciais(nome) {
    const partes = nome.trim().split(' ').filter(n => n);
    let iniciais = partes[0] ? partes[0][0] : '?';
    if (partes.length > 1) iniciais += partes[partes.length - 1][0];
    return iniciais.toUpperCase();
}

function escaparHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ========== ABRIR CONVERSA ==========
function abrirConversa(tipo, usuarioId, nome) {
    // Parar polling anterior
    if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }

    ultimoMsgId = 0;
    mensagensExibidas = new Set();
    pollingEmAndamento = false;

    if (tipo === 'geral') {
        conversaAtiva = { tipo: 'geral' };
    } else {
        conversaAtiva = { tipo: 'dm', usuario_id: usuarioId, nome: nome };
    }

    renderConversas();
    renderAreaMensagens();
    carregarMensagens(true);

    // Marcar como lidas
    marcarComoLidas();

    // Iniciar polling a cada 4 segundos
    pollingInterval = setInterval(() => carregarMensagens(false), 4000);
}

function renderAreaMensagens() {
    const area = document.getElementById('messagesArea');
    const emptyChat = document.getElementById('emptyChat');

    if (!conversaAtiva) {
        area.innerHTML = `<div class="empty-chat" id="emptyChat"><i class="lucide lucide-message-circle"></i><p>Selecione uma conversa para começar</p></div>`;
        lucide.createIcons();
        return;
    }

    let headerLabel = '';
    let headerIconClass = '';
    let headerIconContent = '';

    let onlineStatus = '';
    if (conversaAtiva.tipo === 'geral') {
        headerLabel = 'Chat Geral';
        headerIconClass = 'geral';
        headerIconContent = '🏢';
    } else {
        headerLabel = conversaAtiva.nome;
        headerIconClass = 'dm';
        headerIconContent = getIniciais(conversaAtiva.nome);
        const usr = usuarios.find(u => u.id === conversaAtiva.usuario_id);
        if (usr && usr.online) {
            onlineStatus = '<span style="font-size:11px; color:#22c55e; font-weight:500; margin-left:4px;">● Online</span>';
        }
    }

    area.innerHTML = `
        <div class="messages-header">
            <div class="header-icon conv-icon ${headerIconClass}">${headerIconContent}</div>
            <span>${escaparHtml(headerLabel)}${onlineStatus}</span>
        </div>
        <div class="messages-list" id="messagesList"></div>
        <div class="input-area">
            <button class="btn-anexo" onclick="document.getElementById('inputArquivo').click()" title="Enviar arquivo">
                📎
            </button>
            <input type="file" id="inputArquivo" style="display:none"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
                onchange="enviarArquivo(this)">
            <textarea id="inputMensagem" placeholder="Digite sua mensagem..." rows="1"
                onkeydown="onKeyDown(event)" oninput="autoResize(this)"></textarea>
            <button class="btn-enviar" onclick="enviarMensagem()">
                <i class="lucide lucide-send" style="width:16px; height:16px;"></i> Enviar
            </button>
        </div>
    `;
    lucide.createIcons();
    document.getElementById('inputMensagem').focus();
}

// ========== MENSAGENS ==========
async function carregarMensagens(isInitial) {
    if (!conversaAtiva) return;
    if (pollingEmAndamento && !isInitial) return;
    pollingEmAndamento = true;

    try {
        let url = `/api/chat/mensagens?tipo=${conversaAtiva.tipo}&ultimo_id=${ultimoMsgId}`;
        if (conversaAtiva.tipo === 'dm') url += `&usuario_id=${conversaAtiva.usuario_id}`;

        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();

        if (data.ok && data.mensagens.length > 0) {
            const list = document.getElementById('messagesList');
            if (!list) { pollingEmAndamento = false; return; }

            let adicionou = false;
            data.mensagens.forEach(msg => {
                if (mensagensExibidas.has(msg.id)) return;
                mensagensExibidas.add(msg.id);
                adicionou = true;

                // Atualizar último ID visto
                if (msg.id > ultimoMsgId) ultimoMsgId = msg.id;

                const isMine = msg.remetente_id === currentUserId;
                const bubble = document.createElement('div');
                bubble.className = `message-bubble ${isMine ? 'mine' : 'theirs'}`;

                const hora = new Date(msg.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

                let conteudoHtml = '';
                if (msg.arquivo_nome) {
                    const icone = getFileIcon(msg.arquivo_nome);
                    conteudoHtml = `<a href="#" onclick="baixarArquivoChat(${msg.id}, '${msg.arquivo_nome.replace(/'/g, "\\'")}'); return false;" class="file-attachment">${icone} ${escaparHtml(msg.arquivo_nome)}</a>`;
                } else {
                    conteudoHtml = `<div class="message-text">${escaparHtml(msg.conteudo)}</div>`;
                }

                bubble.innerHTML = `
                    <div class="message-sender">${escaparHtml(isMine ? 'Você' : msg.remetente_nome)}</div>
                    ${conteudoHtml}
                    <div class="message-time">${hora}</div>
                `;
                list.appendChild(bubble);
            });

            // Auto-scroll se adicionou novas mensagens
            if (adicionou) list.scrollTop = list.scrollHeight;
        }
    } catch (e) { console.error('Erro ao carregar mensagens:', e); }
    pollingEmAndamento = false;
}

async function enviarMensagem() {
    const input = document.getElementById('inputMensagem');
    if (!input) return;

    const conteudo = input.value.trim();
    if (!conteudo) return;

    const body = { conteudo };
    if (conversaAtiva.tipo === 'dm') body.destinatario_id = conversaAtiva.usuario_id;

    try {
        const res = await fetch('/api/chat/mensagens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        const data = await res.json();

        if (data.ok) {
            input.value = '';
            autoResize(input);

            // Marcar como exibida para evitar duplicata no polling
            mensagensExibidas.add(data.mensagem.id);
            if (data.mensagem.id > ultimoMsgId) ultimoMsgId = data.mensagem.id;

            // Adicionar mensagem na lista localmente
            const list = document.getElementById('messagesList');
            if (list) {
                const hora = new Date(data.mensagem.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
                const bubble = document.createElement('div');
                bubble.className = 'message-bubble mine';
                bubble.innerHTML = `
                    <div class="message-sender">${escaparHtml('Você')}</div>
                    <div class="message-text">${escaparHtml(conteudo)}</div>
                    <div class="message-time">${hora}</div>
                `;
                list.appendChild(bubble);
                list.scrollTop = list.scrollHeight;
            }
        }
    } catch (e) { console.error('Erro ao enviar mensagem:', e); }
}

function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        enviarMensagem();
    }
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ========== NAO LIDAS ==========
async function carregarNaoLidas() {
    try {
        const res = await fetch('/api/chat/nao-lidas', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (data.ok) {
            naoLidasMap = data.naoLidas;
            renderConversas();
        }
    } catch (e) { /* silencioso */ }
}

async function marcarComoLidas() {
    if (!conversaAtiva) return;
    try {
        let url = `/api/chat/mensagens/ler?tipo=${conversaAtiva.tipo}`;
        if (conversaAtiva.tipo === 'dm') url += `&usuario_id=${conversaAtiva.usuario_id}`;

        await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });

        // Limpar badge local
        if (conversaAtiva.tipo === 'geral') {
            delete naoLidasMap.geral;
        } else {
            delete naoLidasMap[conversaAtiva.usuario_id];
        }
        renderConversas();
    } catch (e) { /* silencioso */ }
}

function iniciarPollingNaoLidas() {
    carregarNaoLidas();
    pollingNaoLidasInterval = setInterval(carregarNaoLidas, 15000);
}

// ========== HEARTBEAT (status online) ==========
function enviarHeartbeat() {
    fetch('/api/chat/heartbeat', { method: 'PUT', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}

async function atualizarStatusOnline() {
    try {
        const res = await fetch('/api/chat/usuarios', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (data.ok) {
            usuarios = data.usuarios;
            renderConversas();
        }
    } catch (e) { /* silencioso */ }
}

// Heartbeat a cada 60s + atualizar status online a cada 30s
enviarHeartbeat();
setInterval(enviarHeartbeat, 60000);
setInterval(atualizarStatusOnline, 30000);

// ========== ARQUIVOS ==========
function getFileIcon(nome) {
    const ext = nome.split('.').pop().toLowerCase();
    if (ext === 'pdf') return '📄';
    if (['doc', 'docx'].includes(ext)) return '📝';
    if (['jpg', 'jpeg', 'png'].includes(ext)) return '🖼️';
    if (['xls', 'xlsx'].includes(ext)) return '📊';
    return '📎';
}

async function enviarArquivo(input) {
    if (!input.files || !input.files[0] || !conversaAtiva) return;

    const file = input.files[0];
    if (file.size > 10 * 1024 * 1024) {
        alert('Arquivo muito grande! Máximo 10MB.');
        input.value = '';
        return;
    }

    const formData = new FormData();
    formData.append('arquivo', file);
    if (conversaAtiva.tipo === 'dm') {
        formData.append('destinatario_id', conversaAtiva.usuario_id);
    }

    try {
        const res = await fetch('/api/chat/mensagens/arquivo', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData
        });
        const data = await res.json();

        if (data.ok) {
            mensagensExibidas.add(data.mensagem.id);
            const list = document.getElementById('messagesList');
            if (list) {
                const hora = new Date(data.mensagem.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
                const icone = getFileIcon(data.mensagem.arquivo_nome);
                const nomeArq = data.mensagem.arquivo_nome.replace(/'/g, "\\'");
                const bubble = document.createElement('div');
                bubble.className = 'message-bubble mine';
                bubble.innerHTML = `
                    <div class="message-sender">${escaparHtml('Você')}</div>
                    <a href="#" onclick="baixarArquivoChat(${data.mensagem.id}, '${nomeArq}'); return false;" class="file-attachment">${icone} ${escaparHtml(data.mensagem.arquivo_nome)}</a>
                    <div class="message-time">${hora}</div>
                `;
                list.appendChild(bubble);
                list.scrollTop = list.scrollHeight;
            }
        } else {
            alert('Erro ao enviar arquivo: ' + (data.erro || 'Erro desconhecido'));
        }
    } catch (e) {
        console.error('Erro ao enviar arquivo:', e);
        alert('Erro ao enviar arquivo.');
    }

    input.value = '';
}

// ========== DOWNLOAD DE ARQUIVO COM TOKEN ==========
async function baixarArquivoChat(msgId, nomeArquivo) {
    try {
        const res = await fetch(`/api/chat/arquivo/${msgId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
            alert('Erro ao baixar arquivo.');
            return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nomeArquivo;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('Erro ao baixar arquivo:', e);
        alert('Erro ao baixar arquivo.');
    }
}
