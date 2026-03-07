if (!API.getToken()) window.location.href = '/login';

let currentUserId = null;
let currentUserNome = '';
let conversaAtiva = null;        // { tipo: 'geral' } ou { tipo: 'dm', usuario_id, nome }
let ultimoMsgId = 0;
let usuarios = [];
let pollingInterval = null;
let pollingNaoLidasInterval = null;
let mensagensExibidas = new Set();
let pollingEmAndamento = false;

// ── Mapa em memória: msgId → dados da mensagem (event delegation das ações) ──
const msgDataMap = {};

// ── NOVOS estados ──────────────────────────────────────────────────────────────
let replyTarget = null;          // { id, autor, texto } mensagem sendo respondida
let threadTarget = null;         // { id } mensagem-pai do tópico aberto
let threadMessages = [];         // mensagens carregadas no painel de tópico
let typingTimer = null;
let outroEstaDigitando = false;  // simulado via polling (campo digitando_ate no BD — futuro)
let allMensagensCache = [];      // cache local para pesquisa
let searchDebounce = null;
let mentionIndex = -1;           // item selecionado no dropdown de @menção

// ── EMOJIS ────────────────────────────────────────────────────────────────────
const EMOJI_CATS = {
    '😀': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🫣','🤭','🫢','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕'],
    '👍': ['👍','👎','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👋','🤚','🖐️','✋','🖖','🫱','🫲','💪','🦾','🖐','👏','🙌','🫶','👐','🤲','🙏','✍️','💅','🤳','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👀','👁','👅','👄','🫦','💋'],
    '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','✡️','🔯','🕎','☯️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓'],
    '🎉': ['🎉','🎊','🎈','🎁','🎀','🎗','🎟','🎫','🎖','🏆','🥇','🥈','🥉','🏅','🎵','🎶','🎼','🎤','🎧','🎷','🎺','🎸','🪕','🎻','🥁','🪘','🎹','🪗','🎯','🎲','🎮','🕹','🎳','🏈','⚽','🏀','🎾','🏐','🏉','🎱','🏓','🏸','🏒','🥍','🏑','🥊'],
    '🍕': ['🍕','🍔','🌮','🌯','🥪','🥙','🧆','🥚','🍳','🥘','🍲','🫕','🥣','🥗','🍿','🧂','🥫','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡','🥟','🥠','🥡','🦪','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯'],
    '🐶': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪲','🦟','🦗','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑'],
    '🌍': ['🌍','🌎','🌏','🌐','🗺','🧭','🏔','⛰','🌋','🗻','🏕','🏖','🏜','🏝','🏞','🏟','🏛','🏗','🧱','🪨','🪵','🛖','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩','🕋','⛲','⛺'],
};
const EMOJI_CAT_KEYS = Object.keys(EMOJI_CATS);
let emojiCatAtual = EMOJI_CAT_KEYS[0];
let emojiPickerAberto = false;

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await carregarInfoRodape();
    await carregarUsuarios();
    renderConversas();
    iniciarPollingNaoLidas();
    renderEmojiPicker();
    lucide.createIcons();

    // Fechar emoji picker ao clicar fora
    document.addEventListener('click', (e) => {
        const picker = document.getElementById('emojiPicker');
        const btn = document.getElementById('btnEmoji');
        if (picker && !picker.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
            fecharEmojiPicker();
        }
        // Fechar user menu
        const menu = document.getElementById('userDropdown');
        const circle = document.getElementById('userCircle');
        if (menu && !menu.contains(e.target) && e.target !== circle) menu.style.display = 'none';
    });
});

// ── AUTH / FOOTER ─────────────────────────────────────────────────────────────
async function carregarInfoRodape() {
    try {
        const resUser = await API.get('/api/auth/me');
        const dataUser = await resUser.json();
        if (dataUser.ok) {
            currentUserId = dataUser.usuario.id;
            currentUserNome = dataUser.usuario.nome || 'Advogado';
            const emailEl = document.getElementById('userEmail');
            if (emailEl) emailEl.innerText = dataUser.usuario.email || '';
            const primeiroNome = currentUserNome.trim().split(' ')[0];
            const nameHeader = document.getElementById('userNameHeader');
            if (nameHeader) nameHeader.innerText = primeiroNome;

            const partes = currentUserNome.trim().split(' ').filter(n => n);
            let iniciais = partes[0][0];
            if (partes.length > 1) iniciais += partes[partes.length - 1][0];

            // Dropdown: nome e placeholder de iniciais
            const dropdownName = document.getElementById('dropdownUserName');
            if (dropdownName) dropdownName.textContent = currentUserNome.trim().split(' ').slice(0,2).join(' ');
            const dropPlaceholder = document.getElementById('dropdownAvatarPlaceholder');
            if (dropPlaceholder) dropPlaceholder.textContent = iniciais.toUpperCase();

            // Círculo no header: avatar salvo ou iniciais
            const circulo = document.getElementById('userCircle');
            const avatarId = typeof getAvatarAtual === 'function' ? getAvatarAtual() : null;
            if (circulo) {
                if (avatarId && typeof getAvatarDataUrl === 'function') {
                    const url = getAvatarDataUrl(avatarId, 40);
                    circulo.innerHTML = `<img src="${url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;pointer-events:none;" alt="avatar"/>`;
                    circulo.style.padding = '0'; circulo.style.overflow = 'hidden';
                    // Dropdown mini avatar
                    const wrap = document.getElementById('dropdownAvatarWrap');
                    if (wrap) wrap.innerHTML = `<img src="${getAvatarDataUrl(avatarId, 44)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;pointer-events:none;"/>`;
                } else {
                    circulo.innerText = iniciais.toUpperCase();
                }
            }

            // Se o servidor retornar avatar_id salvo
            if (dataUser.usuario.avatar_id && typeof salvarAvatar === 'function') {
                salvarAvatar(dataUser.usuario.avatar_id);
                if (typeof atualizarAvatarUI === 'function') atualizarAvatarUI(dataUser.usuario.avatar_id);
            }
        }
        const resPlan = await API.get('/api/plano-consumo');
        const dataPlan = await resPlan.json();
        const planoEl = document.getElementById('planNameFooter');
        if (planoEl) planoEl.innerText = dataPlan.plano || 'Free';
    } catch (e) { console.error('Erro rodapé:', e); }
}

function toggleUserMenu() {
    const d = document.getElementById('userDropdown');
    d.style.display = d.style.display === 'block' ? 'none' : 'block';
}
function logout() { localStorage.removeItem('token'); window.location.href = '/login'; }
function toggleIaMenu(e) { e.preventDefault(); document.getElementById('submenu-ia').classList.toggle('open'); }
function limparBolinha() { const dot = document.getElementById('dotNotificacao'); if (dot) dot.style.display = 'none'; }

// Badge de novo lead CRM
(function() {
    const _tk = localStorage.getItem('token');
    if (!_tk) return;
    function _checkLeadBadge() {
        fetch('/api/crm/metricas', { headers: { Authorization: 'Bearer ' + _tk } })
            .then(r => r.ok ? r.json() : null).then(d => {
                if (!d) return;
                const atual = d.leads || 0;
                const vs = localStorage.getItem('crm_leads_visto');
                if (vs === null) { localStorage.setItem('crm_leads_visto', atual); return; }
                const dot = document.getElementById('dotNotificacao');
                if (dot) dot.style.display = atual > parseInt(vs) ? 'inline-block' : 'none';
            }).catch(() => {});
    }
    _checkLeadBadge(); setInterval(_checkLeadBadge, 60000);
})();

// ── USUARIOS ──────────────────────────────────────────────────────────────────
async function carregarUsuarios() {
    try {
        const res = await API.get('/api/chat/usuarios');
        const data = await res.json();
        if (data.ok) usuarios = data.usuarios;
    } catch (e) { console.error('Erro ao carregar usuários:', e); }
}

// ── CONVERSAS ─────────────────────────────────────────────────────────────────
let naoLidasMap = {};
let filterTexto = '';

function filtrarConversas(val) { filterTexto = val.toLowerCase(); renderConversas(); }

function renderConversas() {
    const list = document.getElementById('conversationsList');
    let html = '';

    const geralMatch = !filterTexto || 'chat geral'.includes(filterTexto);
    if (geralMatch) {
        const geralActive = conversaAtiva?.tipo === 'geral' ? 'active' : '';
        const geralBadge = naoLidasMap.geral ? `<span class="badge-nao-lida">${naoLidasMap.geral}</span>` : '';
        html += `<div class="conversation-item ${geralActive}" onclick="abrirConversa('geral')">
            <div class="conv-icon geral">🏢</div>
            <div class="conv-info">
                <div class="conv-name">Chat Geral</div>
                <div class="conv-preview">Todos do escritório</div>
            </div>${geralBadge}</div>`;
    }

    usuarios.filter(u => !filterTexto || u.nome.toLowerCase().includes(filterTexto)).forEach(u => {
        const dmActive = conversaAtiva?.tipo === 'dm' && conversaAtiva.usuario_id === u.id ? 'active' : '';
        const badge = naoLidasMap[u.id] ? `<span class="badge-nao-lida">${naoLidasMap[u.id]}</span>` : '';
        const iniciais = getIniciais(u.nome);
        const onlineDot = u.online ? '<span class="online-dot"></span>' : '';
        html += `<div class="conversation-item ${dmActive}" onclick="abrirConversa('dm', ${u.id}, '${escaparHtml(u.nome)}')">
            <div class="conv-icon dm" style="position:relative;">${iniciais}${onlineDot}</div>
            <div class="conv-info">
                <div class="conv-name">${escaparHtml(u.nome)}</div>
                <div class="conv-preview">${u.online ? '🟢 Online' : escaparHtml(u.email)}</div>
            </div>${badge}</div>`;
    });

    list.innerHTML = html;
}

// ── ABRIR CONVERSA ────────────────────────────────────────────────────────────
function abrirConversa(tipo, usuarioId, nome) {
    if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
    ultimoMsgId = 0;
    mensagensExibidas = new Set();
    allMensagensCache = [];
    pollingEmAndamento = false;
    replyTarget = null;
    fecharThreadPanel();

    conversaAtiva = tipo === 'geral' ? { tipo: 'geral' } : { tipo: 'dm', usuario_id: usuarioId, nome };

    renderConversas();
    renderAreaMensagens();
    carregarMensagens(true);
    marcarComoLidas();

    pollingInterval = setInterval(() => carregarMensagens(false), 4000);
}

function renderAreaMensagens() {
    const area = document.getElementById('messagesArea');
    if (!conversaAtiva) {
        area.innerHTML = `<div class="empty-chat" id="emptyChat"><i class="lucide lucide-message-circle"></i><p>Selecione uma conversa para começar</p></div>`;
        lucide.createIcons(); return;
    }

    let headerLabel = '', headerIconClass = '', headerIconContent = '', subtituloHtml = '';

    if (conversaAtiva.tipo === 'geral') {
        headerLabel = 'Chat Geral';
        headerIconClass = 'geral';
        headerIconContent = '🏢';
        subtituloHtml = `${usuarios.length} participantes`;
    } else {
        headerLabel = conversaAtiva.nome;
        headerIconClass = 'dm';
        headerIconContent = getIniciais(conversaAtiva.nome);
        const usr = usuarios.find(u => u.id === conversaAtiva.usuario_id);
        subtituloHtml = usr?.online ? '<span style="color:#22c55e;">● Online agora</span>' : 'Offline';
    }

    area.innerHTML = `
        <div class="messages-header">
            <div class="conv-icon ${headerIconClass}" style="width:36px;height:36px;font-size:14px;flex-shrink:0;">${headerIconContent}</div>
            <div class="messages-header-info">
                <div class="messages-header-title">${escaparHtml(headerLabel)}</div>
                <div class="messages-header-subtitle">${subtituloHtml}</div>
            </div>
            <div class="messages-header-actions">
                <button class="header-action-btn" onclick="abrirSearchPanel()" title="Pesquisar mensagens">
                    <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                </button>
                <button class="header-action-btn" onclick="abrirModalAgendamento()" title="Agendar reunião">
                    <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </button>
                <button class="header-action-btn" onclick="abrirModalCompartilhar()" title="Compartilhar tarefa/documento">
                    <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                </button>
            </div>
        </div>

        <div class="messages-list" id="messagesList"></div>

        <div class="typing-indicator" id="typingIndicator">
            <div class="typing-dots">
                <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
            </div>
            <span id="typingName">Alguém está digitando...</span>
        </div>

        <div class="input-area">
            <div class="reply-preview-bar" id="replyPreviewBar">
                <div class="reply-preview-content">
                    <div class="reply-preview-author" id="replyPreviewAuthor"></div>
                    <div class="reply-preview-text" id="replyPreviewText"></div>
                </div>
                <span class="reply-preview-close" onclick="cancelarReply()">✕</span>
            </div>

            <div style="position:relative;">
                <div class="mention-suggestions" id="mentionSuggestions"></div>
                <div class="input-toolbar">
                    <div class="input-main">
                        <button class="input-icon-btn" id="btnEmoji" onclick="toggleEmojiPicker(event)" title="Emojis">😊</button>
                        <textarea id="inputMensagem" placeholder="Digite sua mensagem... Use @ para mencionar" rows="1"
                            onkeydown="onKeyDown(event)" oninput="onInputChange(this)"></textarea>
                        <button class="input-icon-btn" onclick="document.getElementById('inputArquivo').click()" title="Anexar arquivo">
                            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                        </button>
                        <input type="file" id="inputArquivo" style="display:none"
                            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
                            onchange="enviarArquivo(this)">
                    </div>
                    <button class="btn-enviar" onclick="enviarMensagem()">
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        Enviar
                    </button>
                </div>
            </div>

            <!-- Emoji Picker -->
            <div class="emoji-picker" id="emojiPicker"></div>
        </div>
    `;

    renderEmojiPicker();
    lucide.createIcons();
    document.getElementById('inputMensagem').focus();

    // ── Event delegation: Copiar / Responder / Tópico ─────────────────────────
    const msgList = document.getElementById('messagesList');
    if (msgList) {
        msgList.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            e.stopPropagation();
            const action = btn.dataset.action;
            const id     = parseInt(btn.dataset.id);
            const dados  = msgDataMap[id];
            if (!dados) return;

            if (action === 'copy') {
                const texto = dados.conteudo || dados.arquivo_nome;
                navigator.clipboard.writeText(texto)
                    .then(() => showToast('✅ Mensagem copiada!'))
                    .catch(() => {
                        // Fallback para contextos sem Clipboard API
                        const ta = document.createElement('textarea');
                        ta.value = texto;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        showToast('✅ Mensagem copiada!');
                    });

            } else if (action === 'reply') {
                const autor  = dados.isMine ? 'Você' : dados.remetente_nome;
                const trecho = (dados.conteudo || dados.arquivo_nome).slice(0, 80);
                iniciarReply(id, autor, trecho);

            } else if (action === 'thread') {
                abrirThread(id);
            }
        });
    }
}

// ── EMOJI PICKER ──────────────────────────────────────────────────────────────
function renderEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    if (!picker) return;

    // Categorias — usa data-cat para evitar problemas com emojis em atributos onclick
    const cats = EMOJI_CAT_KEYS.map(k =>
        `<button class="emoji-cat-btn${k === emojiCatAtual ? ' active' : ''}" data-cat="${encodeURIComponent(k)}">${k}</button>`
    ).join('');

    // Emojis — usa data-emoji em vez de onclick inline (evita quebra por aspas/caracteres especiais)
    const emojiList = EMOJI_CATS[emojiCatAtual] || [];
    const emojis = emojiList.map(e =>
        `<button class="emoji-btn" data-emoji="${encodeURIComponent(e)}">${e}</button>`
    ).join('');

    picker.innerHTML = `
        <input class="emoji-search" type="text" placeholder="Pesquisar emoji..." id="emojiSearchInput">
        <div class="emoji-categories" id="emojiCats">${cats}</div>
        <div class="emoji-grid" id="emojiGrid">${emojis}</div>
    `;

    // Event delegation no grid (um único listener, sem onclick por botão)
    picker.addEventListener('click', emojiPickerClickHandler);

    // Listener de busca
    const searchInput = picker.querySelector('#emojiSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => pesquisarEmoji(e.target.value));
        // Impedir que o clique no input feche o picker
        searchInput.addEventListener('click', (e) => e.stopPropagation());
    }
}

function emojiPickerClickHandler(e) {
    e.stopPropagation();

    // Clique em emoji
    const emojiBtn = e.target.closest('[data-emoji]');
    if (emojiBtn) {
        const emoji = decodeURIComponent(emojiBtn.dataset.emoji);
        _inserirEmojiNoInput(emoji);
        return;
    }

    // Clique em categoria
    const catBtn = e.target.closest('[data-cat]');
    if (catBtn) {
        emojiCatAtual = decodeURIComponent(catBtn.dataset.cat);
        renderEmojiPicker();
        return;
    }
}

function pesquisarEmoji(q) {
    const grid = document.getElementById('emojiGrid');
    if (!grid) return;
    if (!q.trim()) {
        // Restaura categoria atual sem recriar o picker inteiro (preserva o campo de busca)
        const emojiList = EMOJI_CATS[emojiCatAtual] || [];
        grid.innerHTML = emojiList.map(e =>
            `<button class="emoji-btn" data-emoji="${encodeURIComponent(e)}">${e}</button>`
        ).join('');
        return;
    }
    const todos = Object.values(EMOJI_CATS).flat();
    // Mostra todos (filtro por texto não é possível sem mapa de nomes; exibe subset)
    const matched = todos.slice(0, 48);
    grid.innerHTML = matched.map(e =>
        `<button class="emoji-btn" data-emoji="${encodeURIComponent(e)}">${e}</button>`
    ).join('');
}

function toggleEmojiPicker(e) {
    e.stopPropagation();
    const picker = document.getElementById('emojiPicker');
    if (!picker) return;
    emojiPickerAberto = !emojiPickerAberto;
    if (emojiPickerAberto) {
        // Re-renderiza para garantir listeners frescos ao abrir
        renderEmojiPicker();
        picker.classList.add('visible');
    } else {
        picker.classList.remove('visible');
    }
}

function fecharEmojiPicker() {
    emojiPickerAberto = false;
    const picker = document.getElementById('emojiPicker');
    if (picker) picker.classList.remove('visible');
}

function _inserirEmojiNoInput(emoji) {
    const input = document.getElementById('inputMensagem');
    if (!input) return;
    const pos = input.selectionStart ?? input.value.length;
    const val = input.value;
    input.value = val.slice(0, pos) + emoji + val.slice(pos);
    // Reposiciona cursor após o emoji
    const newPos = pos + [...emoji].length; // spread correto para emojis multi-codepoint
    input.selectionStart = input.selectionEnd = newPos;
    input.focus();
    autoResizeEl(input);
    fecharEmojiPicker();
}

// Mantém alias público para compatibilidade
function inserirEmoji(emoji) { _inserirEmojiNoInput(emoji); }

// ── @MENCOES ──────────────────────────────────────────────────────────────────
let mentionQuery = '';
let mentionTriggerPos = -1;
let mentionSuggestionList = [];

function onInputChange(el) {
    autoResizeEl(el);
    detectarMencao(el);
    notificarDigitando();
}

function detectarMencao(el) {
    const val = el.value;
    const pos = el.selectionStart;
    const textoBefore = val.slice(0, pos);
    const match = textoBefore.match(/@(\w*)$/);
    const suggestionsEl = document.getElementById('mentionSuggestions');
    if (!suggestionsEl) return;

    if (match) {
        mentionQuery = match[1].toLowerCase();
        mentionTriggerPos = pos - match[0].length;
        const filtrados = usuarios.filter(u => u.nome.toLowerCase().includes(mentionQuery)).slice(0, 5);
        mentionSuggestionList = filtrados;
        mentionIndex = -1;
        if (filtrados.length > 0) {
            suggestionsEl.innerHTML = filtrados.map((u, i) =>
                `<div class="mention-suggestion-item" data-idx="${i}" onmousedown="selecionarMencao(${i})">
                    <div class="mention-avatar">${getIniciais(u.nome)}</div>
                    <span>${escaparHtml(u.nome)}</span>
                    ${u.online ? '<span style="font-size:10px;color:#22c55e;margin-left:auto;">● online</span>' : ''}
                </div>`
            ).join('');
            suggestionsEl.classList.add('visible');
            return;
        }
    }
    mentionTriggerPos = -1;
    suggestionsEl.classList.remove('visible');
    suggestionsEl.innerHTML = '';
}

function selecionarMencao(idx) {
    const input = document.getElementById('inputMensagem');
    if (!input || !mentionSuggestionList[idx]) return;
    const u = mentionSuggestionList[idx];
    const val = input.value;
    const antes = val.slice(0, mentionTriggerPos);
    const depois = val.slice(input.selectionStart);
    input.value = antes + '@' + u.nome + ' ' + depois;
    input.selectionStart = input.selectionEnd = antes.length + u.nome.length + 2;
    input.focus();
    const suggestionsEl = document.getElementById('mentionSuggestions');
    if (suggestionsEl) { suggestionsEl.classList.remove('visible'); suggestionsEl.innerHTML = ''; }
    mentionTriggerPos = -1;
}

// ── DIGITANDO ─────────────────────────────────────────────────────────────────
function notificarDigitando() {
    // Emite heartbeat de digitação — endpoint futuro /api/chat/digitando
    // Por ora apenas gerenciamos o estado local para simular
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {}, 2000);
}

function mostrarTypingIndicator(nome) {
    const el = document.getElementById('typingIndicator');
    const nameEl = document.getElementById('typingName');
    if (!el) return;
    if (nome) {
        if (nameEl) nameEl.textContent = `${nome} está digitando...`;
        el.classList.add('visible');
    } else {
        el.classList.remove('visible');
    }
}

// ── MENSAGENS ─────────────────────────────────────────────────────────────────
async function carregarMensagens(isInitial) {
    if (!conversaAtiva) return;
    if (pollingEmAndamento && !isInitial) return;
    pollingEmAndamento = true;

    try {
        let url = `/api/chat/mensagens?tipo=${conversaAtiva.tipo}&ultimo_id=${ultimoMsgId}`;
        if (conversaAtiva.tipo === 'dm') url += `&usuario_id=${conversaAtiva.usuario_id}`;

        const res = await API.get(url);
        const data = await res.json();

        if (data.ok && data.mensagens.length > 0) {
            const list = document.getElementById('messagesList');
            if (!list) { pollingEmAndamento = false; return; }

            let adicionou = false;
            let ultimaData = '';

            data.mensagens.forEach(msg => {
                if (mensagensExibidas.has(msg.id)) return;
                mensagensExibidas.add(msg.id);
                adicionou = true;
                if (msg.id > ultimoMsgId) ultimoMsgId = msg.id;
                allMensagensCache.push(msg);

                // Separador de data
                const dataMsg = new Date(msg.criado_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                if (dataMsg !== ultimaData) {
                    ultimaData = dataMsg;
                    const sep = document.createElement('div');
                    sep.className = 'date-separator';
                    sep.innerHTML = `<span>${formatarDataSeparador(msg.criado_em)}</span>`;
                    list.appendChild(sep);
                }

                list.appendChild(criarBubble(msg));
            });

            if (adicionou) {
                list.scrollTop = list.scrollHeight;
                // Atualizar checkmarks das minhas mensagens anteriores (entregues → lidas)
                atualizarCheckmarks(list);
            }
        }
    } catch (e) { console.error('Erro ao carregar mensagens:', e); }
    pollingEmAndamento = false;
}

function formatarDataSeparador(isoDate) {
    const d = new Date(isoDate);
    const hoje = new Date();
    const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
    const dStr = d.toDateString();
    if (dStr === hoje.toDateString()) return 'Hoje';
    if (dStr === ontem.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

function criarBubble(msg) {
    const isMine = msg.remetente_id === currentUserId;

    // ── Wrapper row (avatar + balão) ──
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `display:flex;align-items:flex-end;gap:8px;margin-bottom:2px;${isMine ? 'flex-direction:row-reverse;' : ''}`;

    // ── Avatar lateral (mensagens de outros) ──
    if (!isMine) {
        const avatarDiv = document.createElement('div');
        avatarDiv.style.cssText = 'width:32px;height:32px;border-radius:50%;flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;align-self:flex-end;';
        const otherAvatarId = (typeof _avatarCache !== 'undefined') ? _avatarCache[msg.remetente_id] : null;
        if (otherAvatarId && typeof getAvatarDataUrl === 'function') {
            avatarDiv.innerHTML = `<img src="${getAvatarDataUrl(otherAvatarId, 32)}" style="width:100%;height:100%;object-fit:cover;" alt=""/>`;
        } else {
            const ini = getIniciais(msg.remetente_nome || '?');
            const paleta = ['#4A90E2','#52B788','#7E8CE0','#F2A65A','#E76F51','#2563eb','#0891b2','#7c3aed'];
            const cor = paleta[(msg.remetente_id || 0) % paleta.length];
            avatarDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="16" fill="${cor}"/><text x="16" y="21" text-anchor="middle" font-family="Outfit,sans-serif" font-size="12" font-weight="700" fill="white">${ini}</text></svg>`;
        }
        wrapper.appendChild(avatarDiv);
    }

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isMine ? 'mine' : 'theirs'}`;
    bubble.dataset.msgId = msg.id;

    const hora = new Date(msg.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

    // Reply quote
    let replyHtml = '';
    if (msg.reply_to_id && msg.reply_to_conteudo) {
        replyHtml = `<div class="reply-quote" onclick="scrollToMsg(${msg.reply_to_id})">
            <div class="reply-quote-author">${escaparHtml(msg.reply_to_autor || 'Mensagem')}</div>
            <div class="reply-quote-text">${escaparHtml(msg.reply_to_conteudo)}</div>
        </div>`;
    }

    // Conteúdo
    let conteudoHtml = '';
    if (msg.arquivo_nome) {
        const icone = getFileIcon(msg.arquivo_nome);
        conteudoHtml = `<a href="#" onclick="baixarArquivoChat(${msg.id}, '${msg.arquivo_nome.replace(/'/g, "\'")}'); return false;" class="file-attachment">${icone} ${escaparHtml(msg.arquivo_nome)}</a>`;
    } else {
        const textoProcessado = processarTextoMensagem(msg.conteudo);
        const emojiClass = somenteEmojis(msg.conteudo) ? ' emoji-only' : '';
        conteudoHtml = `<div class="message-text${emojiClass}">${textoProcessado}</div>`;
    }

    // Read receipt
    let receiptHtml = '';
    if (isMine) {
        const status = msg.lida ? 'read' : 'delivered';
        const color = msg.lida ? '#a5f3c0' : 'rgba(255,255,255,0.55)';
        receiptHtml = `<span class="read-receipt ${status}" title="${msg.lida ? 'Lida' : 'Entregue'}">
            <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
                <path d="M1 5L4.5 8.5L11 1" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                ${msg.lida ? `<path d="M5 5L8.5 8.5L15 1" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
            </svg>
        </span>`;
    }

    // Thread indicator
    const threadCount = msg.thread_count || 0;
    const threadHtml = threadCount > 0 ? `
        <div class="thread-indicator" onclick="abrirThread(${msg.id})">
            💬 ${threadCount} resposta${threadCount > 1 ? 's' : ''} no tópico
        </div>` : '';

    // Actions on hover — usa data-* para evitar quebra por caracteres especiais
    const actionsHtml = `
        <div class="message-actions-row">
            <button class="msg-action-btn" data-action="reply" data-id="${msg.id}">↩ Responder</button>
            <button class="msg-action-btn" data-action="thread" data-id="${msg.id}">💬 Tópico</button>
            ${isMine ? `<button class="msg-action-btn" data-action="copy" data-id="${msg.id}">📋 Copiar</button>` : ''}
        </div>`;

    bubble.innerHTML = `
        <div class="message-sender">${escaparHtml(msg.remetente_nome)}</div>
        ${actionsHtml}
        <div class="message-content-wrap" id="msg-${msg.id}">
            ${replyHtml}
            ${conteudoHtml}
        </div>
        <div class="message-footer">
            <span class="message-time">${hora}</span>
            ${receiptHtml}
        </div>
        ${threadHtml}
    `;

    // Guarda dados para event delegation
    msgDataMap[msg.id] = {
        id:             msg.id,
        conteudo:       msg.conteudo || '',
        arquivo_nome:   msg.arquivo_nome || '',
        remetente_nome: msg.remetente_nome || '',
        isMine
    };

    wrapper.appendChild(bubble);
    return wrapper;
}

function processarTextoMensagem(texto) {
    if (!texto) return '';
    // Highlight @menções
    const escapado = escaparHtml(texto);
    return escapado.replace(/@(\w+(?:\s\w+)?)/g, (match, nome) => {
        const u = usuarios.find(u => u.nome.toLowerCase().includes(nome.toLowerCase()));
        if (u || true) return `<span class="mention">@${escaparHtml(nome)}</span>`;
        return match;
    });
}

// Detecta se o texto é composto APENAS por emojis (e espaços entre eles)
// Suporta emojis simples, compostos (ZWJ sequences), flags, etc.
function somenteEmojis(texto) {
    if (!texto || !texto.trim()) return false;
    // Remove todos os emojis e espaços — se sobrar texto, não é só emoji
    const semEmoji = texto.trim().replace(
        /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FEFF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{200D}\u{20E3}\u{FE0F}️⃣\s]/gu,
        ''
    );
    // Conta quantos emojis há (para limitar o tamanho máximo — 5 emojis ainda ficam grandes)
    const matches = [...texto.trim().matchAll(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu)];
    return semEmoji.length === 0 && matches.length >= 1 && matches.length <= 5;
}

function atualizarCheckmarks(list) {
    // Atualiza os checkmarks — ao buscar mensagens, as antigas ficam como "lidas" se o outro abriu
    // Lógica simplificada: após polling bem-sucedido, marcar minhas mensagens antigas como delivered
}

// copiarMensagem removida — lógica migrou para event delegation no messagesList

function scrollToMsg(id) {
    const el = document.getElementById(`msg-${id}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.background = 'rgba(74,144,226,0.15)'; setTimeout(() => el.style.background = '', 1500); }
}

// ── REPLY ─────────────────────────────────────────────────────────────────────
function iniciarReply(msgId, autor, texto) {
    replyTarget = { id: msgId, autor, texto };
    const bar = document.getElementById('replyPreviewBar');
    const authorEl = document.getElementById('replyPreviewAuthor');
    const textEl = document.getElementById('replyPreviewText');
    if (bar) bar.classList.add('visible');
    if (authorEl) authorEl.textContent = autor;
    if (textEl) textEl.textContent = texto;
    document.getElementById('inputMensagem')?.focus();
}

function cancelarReply() {
    replyTarget = null;
    const bar = document.getElementById('replyPreviewBar');
    if (bar) bar.classList.remove('visible');
}

// ── THREAD PANEL ──────────────────────────────────────────────────────────────
function abrirThread(msgId) {
    threadTarget = msgId;
    const panel = document.getElementById('threadPanel');
    if (panel) panel.classList.add('open');
    carregarThread(msgId);
}

function fecharThreadPanel() {
    threadTarget = null;
    const panel = document.getElementById('threadPanel');
    if (panel) panel.classList.remove('open');
}

async function carregarThread(msgId) {
    const container = document.getElementById('threadMessages');
    if (!container) return;
    container.innerHTML = '<div style="color:var(--text-tertiary);font-size:12px;padding:12px;">Carregando tópico...</div>';

    try {
        // Buscar mensagem-pai do cache
        const pai = allMensagensCache.find(m => m.id === msgId);
        if (!pai) { container.innerHTML = '<div style="color:var(--text-tertiary);font-size:12px;padding:12px;">Mensagem não encontrada no cache.</div>'; return; }

        container.innerHTML = '';
        // Mensagem pai destacada
        const paiDiv = document.createElement('div');
        paiDiv.style.cssText = 'background:rgba(74,144,226,0.08);border-radius:10px;padding:12px;margin-bottom:16px;border:1px solid rgba(74,144,226,0.15);';
        paiDiv.innerHTML = `
            <div style="font-size:11px;font-weight:700;color:var(--accent-blue);margin-bottom:4px;">${escaparHtml(pai.remetente_nome)}</div>
            <div style="font-size:13px;color:var(--text-main);">${escaparHtml(pai.conteudo || pai.arquivo_nome || '')}</div>
            <div style="font-size:10px;color:var(--text-tertiary);margin-top:6px;">${new Date(pai.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</div>
        `;
        container.appendChild(paiDiv);

        // Respostas do thread (buscar do servidor — endpoint futuro)
        // Por ora buscar via endpoint geral filtrando reply_to_id se disponível
        const respostas = allMensagensCache.filter(m => m.reply_to_id === msgId);
        if (respostas.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'text-align:center;color:var(--text-tertiary);font-size:12px;padding:20px;';
            empty.textContent = 'Nenhuma resposta ainda. Seja o primeiro!';
            container.appendChild(empty);
        } else {
            respostas.forEach(m => container.appendChild(criarBubble(m)));
        }
    } catch (e) { container.innerHTML = '<div style="color:var(--danger);font-size:12px;padding:12px;">Erro ao carregar tópico.</div>'; }
}

async function enviarRespostaThread() {
    const input = document.getElementById('threadInput');
    if (!input || !threadTarget || !input.value.trim()) return;

    const conteudo = input.value.trim();
    const body = { conteudo, reply_to_id: threadTarget };
    if (conversaAtiva?.tipo === 'dm') body.destinatario_id = conversaAtiva.usuario_id;

    try {
        const res = await API.post('/api/chat/mensagens', body);
        const data = await res.json();
        if (data.ok) {
            input.value = '';
            autoResizeEl(input);
            const msg = { ...data.mensagem, remetente_nome: currentUserNome, reply_to_id: threadTarget };
            allMensagensCache.push(msg);
            carregarThread(threadTarget);
            showToast('✅ Resposta enviada no tópico');
        }
    } catch (e) { console.error('Erro ao enviar resposta no tópico:', e); }
}

function onThreadKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarRespostaThread(); }
}

// ── SEARCH PANEL ──────────────────────────────────────────────────────────────
function abrirSearchPanel() {
    const panel = document.getElementById('searchPanel');
    const btn = document.querySelector('.header-action-btn');
    if (panel) { panel.classList.add('open'); document.getElementById('searchInput')?.focus(); }
}

function fecharSearchPanel() {
    const panel = document.getElementById('searchPanel');
    if (panel) panel.classList.remove('open');
}

function pesquisarMensagens(query) {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => executarPesquisa(query), 300);
}

function executarPesquisa(query) {
    const resultsEl = document.getElementById('searchResults');
    if (!resultsEl) return;
    const q = query.trim().toLowerCase();

    if (!q) {
        resultsEl.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary);text-align:center;padding:20px;">Digite para pesquisar no histórico</div>';
        return;
    }

    const encontrados = allMensagensCache.filter(m =>
        m.conteudo && m.conteudo.toLowerCase().includes(q)
    ).slice(-30).reverse();

    if (encontrados.length === 0) {
        resultsEl.innerHTML = `<div style="font-size:12px;color:var(--text-tertiary);text-align:center;padding:20px;">Nenhuma mensagem encontrada para "<strong>${escaparHtml(q)}</strong>"</div>`;
        return;
    }

    resultsEl.innerHTML = encontrados.map(m => {
        const hora = new Date(m.criado_em).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
        const highlightedText = escaparHtml(m.conteudo).replace(new RegExp(`(${escaparHtml(q)})`, 'gi'), '<mark>$1</mark>');
        return `
            <div class="search-result-item" onclick="scrollToMsg(${m.id}); fecharSearchPanel();">
                <div class="search-result-sender">${escaparHtml(m.remetente_id === currentUserId ? 'Você' : m.remetente_nome)}</div>
                <div class="search-result-text">${highlightedText}</div>
                <div class="search-result-time">${hora}</div>
            </div>`;
    }).join('');
}

// ── ENVIAR MENSAGEM ───────────────────────────────────────────────────────────
async function enviarMensagem() {
    const input = document.getElementById('inputMensagem');
    if (!input) return;
    const conteudo = input.value.trim();
    if (!conteudo) return;

    const body = { conteudo };
    if (conversaAtiva?.tipo === 'dm') body.destinatario_id = conversaAtiva.usuario_id;
    if (replyTarget) body.reply_to_id = replyTarget.id;

    try {
        const res = await API.post('/api/chat/mensagens', body);
        const data = await res.json();

        if (data.ok) {
            input.value = ''; autoResizeEl(input);
            fecharEmojiPicker();

            // Enriquece a mensagem com dados do reply ANTES de cancelar replyTarget
            const msg = { ...data.mensagem, remetente_nome: currentUserNome };
            if (replyTarget) {
                msg.reply_to_id       = replyTarget.id;
                msg.reply_to_conteudo = replyTarget.texto;
                msg.reply_to_autor    = replyTarget.autor;
            }
            cancelarReply();

            mensagensExibidas.add(data.mensagem.id);
            if (data.mensagem.id > ultimoMsgId) ultimoMsgId = data.mensagem.id;
            allMensagensCache.push(msg);

            const list = document.getElementById('messagesList');
            if (list) {
                list.appendChild(criarBubble(msg));
                list.scrollTop = list.scrollHeight;
            }
        }
    } catch (e) { console.error('Erro ao enviar mensagem:', e); }
}

function onKeyDown(e) {
    // Navegação no dropdown de menções
    const suggestions = document.getElementById('mentionSuggestions');
    if (suggestions?.classList.contains('visible')) {
        if (e.key === 'ArrowDown') { e.preventDefault(); mentionIndex = Math.min(mentionIndex + 1, mentionSuggestionList.length - 1); destacarMencao(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); mentionIndex = Math.max(mentionIndex - 1, 0); destacarMencao(); return; }
        if (e.key === 'Enter' && mentionIndex >= 0) { e.preventDefault(); selecionarMencao(mentionIndex); return; }
        if (e.key === 'Escape') { suggestions.classList.remove('visible'); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensagem(); }
}

function destacarMencao() {
    document.querySelectorAll('.mention-suggestion-item').forEach((el, i) => {
        el.classList.toggle('selected', i === mentionIndex);
    });
}

function autoResizeEl(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── NAO LIDAS ─────────────────────────────────────────────────────────────────
async function carregarNaoLidas() {
    try {
        const res = await API.get('/api/chat/nao-lidas');
        const data = await res.json();
        if (data.ok) { naoLidasMap = data.naoLidas; renderConversas(); }
    } catch (e) {}
}

async function marcarComoLidas() {
    if (!conversaAtiva) return;
    try {
        let url = `/api/chat/mensagens/ler?tipo=${conversaAtiva.tipo}`;
        if (conversaAtiva.tipo === 'dm') url += `&usuario_id=${conversaAtiva.usuario_id}`;
        await API.put(url, null);
        if (conversaAtiva.tipo === 'geral') delete naoLidasMap.geral;
        else delete naoLidasMap[conversaAtiva.usuario_id];
        renderConversas();
    } catch (e) {}
}

function iniciarPollingNaoLidas() {
    carregarNaoLidas();
    pollingNaoLidasInterval = setInterval(carregarNaoLidas, 15000);
}

// ── HEARTBEAT / ONLINE ────────────────────────────────────────────────────────
function enviarHeartbeat() { API.put('/api/chat/heartbeat', null).catch(() => {}); }
async function atualizarStatusOnline() {
    try {
        const res = await API.get('/api/chat/usuarios');
        const data = await res.json();
        if (data.ok) { usuarios = data.usuarios; renderConversas(); }
    } catch (e) {}
}
enviarHeartbeat();
setInterval(enviarHeartbeat, 60000);
setInterval(atualizarStatusOnline, 30000);

// ── ARQUIVOS ──────────────────────────────────────────────────────────────────
function getFileIcon(nome) {
    const ext = nome.split('.').pop().toLowerCase();
    if (ext === 'pdf') return '📄';
    if (['doc','docx'].includes(ext)) return '📝';
    if (['jpg','jpeg','png'].includes(ext)) return '🖼️';
    if (['xls','xlsx'].includes(ext)) return '📊';
    return '📎';
}

async function enviarArquivo(input) {
    if (!input.files || !input.files[0] || !conversaAtiva) return;
    const file = input.files[0];
    if (file.size > 10 * 1024 * 1024) { showToast('❌ Arquivo muito grande! Máximo 10MB.', 'error'); input.value = ''; return; }

    const formData = new FormData();
    formData.append('arquivo', file);
    if (conversaAtiva.tipo === 'dm') formData.append('destinatario_id', conversaAtiva.usuario_id);

    try {
        const res = await API.upload('/api/chat/mensagens/arquivo', formData);
        const data = await res.json();
        if (data.ok) {
            mensagensExibidas.add(data.mensagem.id);
            const msg = { ...data.mensagem, remetente_nome: currentUserNome };
            allMensagensCache.push(msg);
            const list = document.getElementById('messagesList');
            if (list) { list.appendChild(criarBubble(msg)); list.scrollTop = list.scrollHeight; }
        } else { showToast('❌ Erro ao enviar arquivo: ' + (data.erro || 'Erro desconhecido'), 'error'); }
    } catch (e) { showToast('❌ Erro ao enviar arquivo.', 'error'); }
    input.value = '';
}

async function baixarArquivoChat(msgId, nomeArquivo) {
    try {
        const res = await API.get(`/api/chat/arquivo/${msgId}`);
        if (!res.ok) { showToast('❌ Erro ao baixar arquivo.', 'error'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = nomeArquivo;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) { showToast('❌ Erro ao baixar arquivo.', 'error'); }
}

// ── AGENDAMENTO ───────────────────────────────────────────────────────────────
function abrirModalAgendamento() {
    const modal = document.getElementById('scheduleModal');
    if (!modal) return;
    // Preencher participantes com base na conversa ativa
    const partInput = document.getElementById('meetingParticipants');
    if (partInput) {
        if (conversaAtiva?.tipo === 'dm') partInput.value = conversaAtiva.nome;
        else partInput.value = 'Todos do escritório';
    }
    // Data padrão = hoje
    const dateInput = document.getElementById('meetingDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    modal.classList.add('visible');
}

async function confirmarAgendamento() {
    const titulo = document.getElementById('meetingTitle')?.value.trim();
    const data = document.getElementById('meetingDate')?.value;
    const hora = document.getElementById('meetingTime')?.value;
    const desc = document.getElementById('meetingDesc')?.value.trim();

    if (!titulo || !data || !hora) { showToast('❌ Preencha título, data e horário.', 'error'); return; }

    const dataFormatada = new Date(`${data}T${hora}`).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    // Enviar mensagem de agendamento no chat
    const mensagemAgendamento = `📅 REUNIÃO AGENDADA\n${titulo}\n🗓 ${dataFormatada}${desc ? `\n📋 ${desc}` : ''}`;
    const body = { conteudo: mensagemAgendamento };
    if (conversaAtiva?.tipo === 'dm') body.destinatario_id = conversaAtiva.usuario_id;

    try {
        const res = await API.post('/api/chat/mensagens', body);
        const d = await res.json();
        if (d.ok) {
            const msg = { ...d.mensagem, remetente_nome: currentUserNome };
            mensagensExibidas.add(d.mensagem.id);
            allMensagensCache.push(msg);
            const list = document.getElementById('messagesList');
            if (list) { list.appendChild(criarBubble(msg)); list.scrollTop = list.scrollHeight; }
            fecharModal('scheduleModal');
            showToast('✅ Reunião agendada e notificação enviada!', 'success');
            limparFormModal();
        }
    } catch (e) { showToast('❌ Erro ao agendar reunião.', 'error'); }
}

function limparFormModal() {
    ['meetingTitle','meetingDate','meetingTime','meetingDesc'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
}

// ── COMPARTILHAR TAREFA / DOCUMENTO ──────────────────────────────────────────
function abrirModalCompartilhar() {
    const modal = document.getElementById('shareModal');
    if (modal) modal.classList.add('visible');
}

function updateShareModal() {
    const type = document.getElementById('shareType')?.value;
    const title = document.getElementById('shareModalTitle');
    const icons = { tarefa: '📋 Compartilhar Tarefa', documento: '📄 Compartilhar Documento', processo: '⚖️ Compartilhar Processo' };
    if (title && icons[type]) title.textContent = icons[type];
    const prioField = document.getElementById('sharePriorityField');
    if (prioField) prioField.style.display = type === 'tarefa' ? 'block' : 'none';
}

async function confirmarCompartilhamento() {
    const type = document.getElementById('shareType')?.value;
    const titulo = document.getElementById('shareTitle')?.value.trim();
    const desc = document.getElementById('shareDesc')?.value.trim();
    const prio = document.getElementById('sharePriority')?.value;

    if (!titulo) { showToast('❌ Preencha o título.', 'error'); return; }

    const icons = { tarefa: '📋', documento: '📄', processo: '⚖️' };
    const prioText = type === 'tarefa' ? `\n⚡ Prioridade: ${prio?.toUpperCase()}` : '';
    const mensagem = `${icons[type]} ${type.toUpperCase()} COMPARTILHADO\n${titulo}${desc ? `\n${desc}` : ''}${prioText}`;

    const body = { conteudo: mensagem };
    if (conversaAtiva?.tipo === 'dm') body.destinatario_id = conversaAtiva.usuario_id;

    try {
        const res = await API.post('/api/chat/mensagens', body);
        const d = await res.json();
        if (d.ok) {
            const msg = { ...d.mensagem, remetente_nome: currentUserNome };
            mensagensExibidas.add(d.mensagem.id);
            allMensagensCache.push(msg);
            const list = document.getElementById('messagesList');
            if (list) { list.appendChild(criarBubble(msg)); list.scrollTop = list.scrollHeight; }
            fecharModal('shareModal');
            showToast(`✅ ${type.charAt(0).toUpperCase() + type.slice(1)} compartilhado!`, 'success');
            ['shareTitle','shareDesc'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        }
    } catch (e) { showToast('❌ Erro ao compartilhar.', 'error'); }
}

// ── MODAIS GENÉRICOS ──────────────────────────────────────────────────────────
function fecharModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('visible');
}
// Fechar modais clicando no overlay
document.addEventListener('click', (e) => {
    document.querySelectorAll('.modal-overlay.visible').forEach(m => {
        if (e.target === m) m.classList.remove('visible');
    });
});

// ── TOAST ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast${type ? ' ' + type : ''}`;
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function getIniciais(nome) {
    const partes = nome.trim().split(' ').filter(n => n);
    let iniciais = partes[0] ? partes[0][0] : '?';
    if (partes.length > 1) iniciais += partes[partes.length - 1][0];
    return iniciais.toUpperCase();
}

function escaparHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('linkIaMenu').addEventListener('click', toggleIaMenu);
    document.getElementById('linkCrmNav').addEventListener('click', limparBolinha);
    document.getElementById('userCircle').addEventListener('click', toggleUserMenu);
    document.getElementById('linkEscolherAvatar').addEventListener('click', (e) => {
        e.preventDefault();
        abrirModalAvatar();
        toggleUserMenu();
    });
    document.getElementById('linkLogoutChat').addEventListener('click', (e) => { e.preventDefault(); logout(); });
    document.getElementById('filterConversas').addEventListener('input', (e) => filtrarConversas(e.target.value));
    document.getElementById('btnFecharSearchPanel').addEventListener('click', fecharSearchPanel);
    document.getElementById('searchInput').addEventListener('input', (e) => pesquisarMensagens(e.target.value));
    document.getElementById('btnFecharThreadPanel').addEventListener('click', fecharThreadPanel);
    document.getElementById('threadInput').addEventListener('keydown', onThreadKeyDown);
    document.getElementById('threadInput').addEventListener('input', (e) => autoResizeEl(e.target));
    document.getElementById('btnEnviarThread').addEventListener('click', enviarRespostaThread);
    document.getElementById('btnCancelarSchedule').addEventListener('click', () => fecharModal('scheduleModal'));
    document.getElementById('btnConfirmarAgendamento').addEventListener('click', confirmarAgendamento);
    document.getElementById('shareType').addEventListener('change', updateShareModal);
    document.getElementById('btnCancelarShare').addEventListener('click', () => fecharModal('shareModal'));
    document.getElementById('btnConfirmarCompartilhamento').addEventListener('click', confirmarCompartilhamento);
});