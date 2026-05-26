
// ─── Helpers globais ──────────────────────────────────────────────────────────
function navegarPara(url) { window.location.href = url; }
function removerElemento(id) { const el = document.getElementById(id); if (el) el.remove(); }
function clicarElemento(id) { const el = document.getElementById(id); if (el) el.click(); }
function toggleUserDropdown() {
    const dd = document.getElementById('userDropdown');
    if (dd) dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
}

// ─── Estado ───────────────────────────────────────────────────────────────────
const token = localStorage.getItem('token');
let userRole = '';
let processoId = new URLSearchParams(window.location.search).get('processo_id');
let todosDocumentos = [];
let selectedFile = null;
let addonClicksign = { ativo: false, limite: 20, usado: 0, disponivel: false };
let selectedFileNV = null;

// ─── Auth + Info do usuário via API ─────────────────────────────────────────
async function verificarAuth() {
    if (!token) { window.location.href = '/login'; return; }
    try {
        // Valida o token rapidamente antes de chamar API
        JSON.parse(atob(token.split('.')[1]));
    } catch { window.location.href = '/login'; return; }

    try {
        const [resUser, resPlan] = await Promise.all([
            fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
            fetch('/api/plano-consumo', { headers: { Authorization: `Bearer ${token}` } })
        ]);

        if (resUser.status === 401) { window.location.href = '/login'; return; }

        const dataUser = await resUser.json();
        const dataPlan = await resPlan.json();

        if (dataUser.ok) {
            const u = dataUser.usuario;
            userRole = u.role || '';

            const nomeCompleto = u.nome || 'Usuário';
            const partes = nomeCompleto.trim().split(' ').filter(n => n);
            let iniciais = partes[0][0];
            if (partes.length > 1) iniciais += partes[partes.length - 1][0];

            document.getElementById('userCircle').textContent = iniciais.toUpperCase();
            document.getElementById('userNameHeader').textContent = partes[0];
            document.getElementById('footerEmail').textContent = u.email || nomeCompleto;
        }

        document.getElementById('footerPlano').textContent = dataPlan.plano || 'Free';
    } catch (err) {
        console.error('Erro ao carregar dados do usuário:', err);
    }
}

function logout() {
    localStorage.removeItem('token');
    window.location.href = '/login';
}

function toggleIaMenu(e) {
    e.preventDefault();
    const s = document.getElementById('submenu-ia');
    s.style.display = s.style.display === 'flex' ? 'none' : 'flex';
    s.style.flexDirection = 'column';
}

// ─── Init ─────────────────────────────────────────────────────────────────────
window.onload = async () => {
    await verificarAuth();
    if (processoId) carregarInfoProcesso(processoId);
    await carregarAddonStatus();
    carregarDocumentos();
    carregarProcessos();
    lucide.createIcons();

    // Toast de confirmação após retorno do Stripe Checkout
    if (new URLSearchParams(window.location.search).get('addon_ativo') === '1') {
        mostrarToastAddon('✅ Add-on de Assinatura Digital ativado com sucesso! Agora você pode assinar documentos.');
        // Limpar parâmetro da URL sem recarregar
        const url = new URL(window.location.href);
        url.searchParams.delete('addon_ativo');
        history.replaceState(null, '', url.toString());
    }
};

// ─── DOMContentLoaded listeners ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    const btnNovoDocumento = document.querySelector('[data-action="abrirModalUpload"]');
    if (btnNovoDocumento) {
        btnNovoDocumento.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            abrirModalUpload();
        });
    }

    // toggleIaMenu especial
    const lia = document.getElementById('linkIaMenu');
    if (lia) lia.addEventListener('click', toggleIaMenu);

    // Filtros
    const buscaEl = document.getElementById('busca');
    if (buscaEl) buscaEl.addEventListener('input', filtrar);

    const filtroCatEl = document.getElementById('filtroCategoria');
    if (filtroCatEl) filtroCatEl.addEventListener('change', filtrar);

    const filtroModeloEl = document.getElementById('filtroModelo');
    if (filtroModeloEl) filtroModeloEl.addEventListener('change', filtrar);

    // File inputs
    const fileInputEl = document.getElementById('fileInput');
    if (fileInputEl) fileInputEl.addEventListener('change', function () { onFileSelect(this); });

    const fileInputNVEl = document.getElementById('fileInputNV');
    if (fileInputNVEl) fileInputNVEl.addEventListener('change', function () { onFileSelectNV(this); });
});

// ─── Info do processo ─────────────────────────────────────────────────────────
async function carregarInfoProcesso(id) {
    try {
        const res = await fetch(`/api/processos/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const p = await res.json();
        const badge = document.getElementById('processBadge');
        badge.textContent = `Processo: ${p.numero || id}`;
        badge.style.display = 'inline-block';
        // Ocultar select de processo no modal de upload quando veio por URL
        document.getElementById('uploadProcessoGrupo').style.display = 'none';
    } catch { /* ignora */ }
}

// ─── Carregar documentos ──────────────────────────────────────────────────────
async function carregarDocumentos() {
    try {
        let url = '/api/documentos?';
        if (processoId) url += `processo_id=${processoId}&`;

        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

        if (res.status === 402) {
            const data = await res.json();
            const msg = data.message || data.erro || 'O módulo de Documentos (GED) não está disponível no seu plano atual.';
            exibirAvisoUpgrade(msg);
            return;
        }

        if (!res.ok) throw new Error(await res.text());

        todosDocumentos = await res.json();
        atualizarStats();
        renderizarTabela(todosDocumentos);
    } catch (err) {
        console.error('Erro ao carregar documentos:', err);
        document.getElementById('listaDocumentos').innerHTML =
            `<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444;">Erro ao carregar documentos.</td></tr>`;
    }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function atualizarStats() {
    document.getElementById('statTotal').textContent = todosDocumentos.length;
    document.getElementById('statModelos').textContent = todosDocumentos.filter(d => d.eh_modelo).length;
    if (todosDocumentos.length > 0) {
        const d = todosDocumentos[0];
        document.getElementById('statUltimo').textContent = formatarData(d.criado_em);
    } else {
        document.getElementById('statUltimo').textContent = '—';
    }
}

// ─── Filtros ──────────────────────────────────────────────────────────────────
function filtrar() {
    const q = document.getElementById('busca').value.toLowerCase();
    const cat = document.getElementById('filtroCategoria').value;
    const apenasModelo = document.getElementById('filtroModelo').checked;

    const filtrado = todosDocumentos.filter(d => {
        const textoMatch = !q || (d.nome || '').toLowerCase().includes(q) ||
            (d.descricao || '').toLowerCase().includes(q) ||
            (d.tags || '').toLowerCase().includes(q);
        const catMatch = !cat || d.categoria === cat;
        const modeloMatch = !apenasModelo || d.eh_modelo;
        return textoMatch && catMatch && modeloMatch;
    });

    renderizarTabela(filtrado);
}

// ─── Renderizar tabela ────────────────────────────────────────────────────────
function renderizarTabela(lista) {
    const tbody = document.getElementById('listaDocumentos');

    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8">
            <div class="empty-state">
                <i class="lucide lucide-folder-open" style="width:48px;height:48px;color:#94a3b8;display:block;margin:0 auto 12px;"></i>
                <div>Nenhum documento encontrado.</div>
            </div>
        </td></tr>`;
        lucide.createIcons();
        return;
    }

    tbody.innerHTML = lista.map(d => {
        const icone = iconeArquivo(d.mimetype);
        const ext = (d.arquivo_original || '').split('.').pop().toLowerCase();
        const tamanho = formatarTamanho(d.tamanho);
        const data = formatarData(d.criado_em);
        const totalV = parseInt(d.total_versoes) || 1;
        const versaoExibida = `v${d.versao}`;
        const btnMaisVersoes = totalV > 1
            ? `<button class="btn-icon" data-action="abrirVersoes" data-args='[${d.id}]' title="Ver ${totalV} versão(ões)" style="font-size:11px;font-weight:700;color:var(--primary);">(+${totalV - 1})</button>`
            : '';

        const processoCol = d.eh_modelo
            ? `<span class="badge badge-modelo-tag">MODELO</span>`
            : (d.processo_numero
                ? `<a href="/processos-page?busca=${encodeURIComponent(d.processo_numero)}" style="color:var(--primary);font-weight:600;text-decoration:none;">${d.processo_numero}</a>${d.cliente_nome ? `<br><span style="color:#64748b;font-size:11px;">${d.cliente_nome}</span>` : ''}`
                : '<span style="color:#94a3b8;">—</span>');

        const excluirBtn = userRole === 'admin'
            ? `<button class="btn-icon danger" data-action="excluirDocumento" data-args='[${d.id}]' title="Excluir"><i data-lucide="trash-2" style="width:15px;height:15px;"></i></button>`
            : '';

        let btnAssinar = '';
        if (d.mimetype === 'application/pdf') {
            if (!addonClicksign.api_key_configurada) {
                // Sem chave: direciona para Configurações
                btnAssinar = `<button class="btn-icon" data-action="abrirModalAddon" title="Configure sua chave ClickSign em Configurações" style="color:#7c3aed;"><i data-lucide="settings" style="width:15px;height:15px;"></i></button>`;
            } else {
                // Chave configurada: botão disponível para qualquer PDF
                const tip = d.processo_id ? 'Assinatura Digital' : 'Assinatura Digital (signatário manual)';
                btnAssinar = `<button class="btn-icon" data-action="abrirModalAssinar" data-args='[${d.id}, ${d.processo_id || 'null'}]' title="${tip}" style="color:#7c3aed;"><i data-lucide="pen-line" style="width:15px;height:15px;"></i></button>`;
            }
        }

        const btnVerificarStatus = (d.assinatura_id && (d.assinatura_status === 'enviado' || d.assinatura_status === 'em_assinatura'))
            ? `<button class="btn-icon" data-action="verificarStatusAssinatura" data-args='[${d.assinatura_id}, ${d.id}]' title="Verificar status da assinatura" style="color:#d97706;"><i data-lucide="refresh-cw" style="width:14px;height:14px;"></i></button>`
            : '';

        const btnBaixarAssinado = (d.assinatura_id && d.assinatura_status === 'concluido')
            ? `<button class="btn-icon" data-action="baixarDocumentoAssinado" data-args='[${d.assinatura_id}]' title="Baixar documento assinado" style="color:#16a34a;"><i data-lucide="file-check" style="width:15px;height:15px;"></i></button>`
            : '';

        const assinaturaBadge = d.assinatura_status === 'concluido'
            ? `<span class="badge-assinatura-concluido" title="Documento assinado">✅ Assinado</span>`
            : (d.assinatura_status === 'enviado' || d.assinatura_status === 'em_assinatura')
            ? `<span class="badge-assinatura-aguardando" title="Aguardando assinatura">🔏 Aguardando</span>`
            : '';

        return `<tr>
            <td style="max-width:220px;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:18px;">${icone}</span>
                    <span title="${d.nome}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;font-weight:500;">${d.nome.length > 40 ? d.nome.slice(0, 40) + '…' : d.nome}</span>
                </div>
            </td>
            <td><span class="badge badge-${d.categoria || 'outros'}">${labelCategoria(d.categoria)}</span></td>
            <td>${processoCol}</td>
            <td style="font-family:monospace;font-size:12px;color:#64748b;">.${ext}</td>
            <td style="white-space:nowrap;">${tamanho}</td>
            <td style="white-space:nowrap;">
                <span style="font-weight:600;color:var(--primary);">${versaoExibida}</span>
                ${btnMaisVersoes}
                ${assinaturaBadge ? `<br><span style="margin-top:2px;display:inline-block;">${assinaturaBadge}</span>` : ''}
            </td>
            <td style="white-space:nowrap;color:#64748b;">${data}</td>
            <td>
                <div style="display:flex;gap:4px;justify-content:flex-end;align-items:center;">
                    <button class="btn-icon" data-action="baixarDoc" data-args='[${d.id}, ${JSON.stringify(d.arquivo_original || '')}]' title="Download / Visualizar"><i data-lucide="download" style="width:15px;height:15px;"></i></button>
                    <button class="btn-icon" data-action="abrirEditar" data-args='[${d.id}]' title="Editar metadados"><i data-lucide="edit" style="width:15px;height:15px;"></i></button>
                    <button class="btn-icon" data-action="abrirNovaVersao" data-args='[${d.id}]' title="Upload nova versão"><i data-lucide="upload" style="width:15px;height:15px;"></i></button>
                    ${btnAssinar}
                    ${btnVerificarStatus}
                    ${btnBaixarAssinado}
                    ${excluirBtn}
                </div>
            </td>
        </tr>`;
    }).join('');

    lucide.createIcons();
}

// ─── Helpers visuais ──────────────────────────────────────────────────────────
function iconeArquivo(mime) {
    if (mime === 'application/pdf') return '🔴';
    if (mime && mime.includes('word')) return '🔵';
    if (mime && mime.startsWith('image/')) return '🟢';
    return '📄';
}

function labelCategoria(cat) {
    const m = { peticao:'Petição', contrato:'Contrato', procuracao:'Procuração', decisao:'Decisão',
                citacao:'Citação', recurso:'Recurso', laudo:'Laudo', acordo:'Acordo',
                comprovante:'Comprovante', modelo:'Modelo', outros:'Outros' };
    return m[cat] || 'Outros';
}

function formatarTamanho(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatarData(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function escAtr(str) {
    return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ─── Download ─────────────────────────────────────────────────────────────────
async function baixarDoc(id, nomeOriginal) {
    try {
        const res = await fetch(`/api/documentos/${id}/arquivo`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) { alert('Arquivo não encontrado no servidor.'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nomeOriginal;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Erro ao baixar arquivo.');
    }
}

// ─── Carregar processos para o select ────────────────────────────────────────
async function carregarProcessos() {
    try {
        const res = await fetch('/api/processos?limit=200', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const respDoc = await res.json();
        const lista = respDoc.data || respDoc;
        const sel = document.getElementById('uploadProcesso');
        lista.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.numero || p.id} — ${p.cliente || ''}`;
            if (processoId && p.id == processoId) opt.selected = true;
            sel.appendChild(opt);
        });
    } catch { /* ignora */ }
}

// ─── Modal Upload ─────────────────────────────────────────────────────────────
function abrirModalUpload() {
    selectedFile = null;
    document.getElementById('dzFileName').textContent = '';
    document.getElementById('fileInput').value = '';
    document.getElementById('uploadNome').value = '';
    document.getElementById('uploadCategoria').value = 'outros';
    document.getElementById('uploadDescricao').value = '';
    document.getElementById('uploadTags').value = '';
    document.getElementById('uploadModelo').checked = false;
    document.getElementById('progressWrap').style.display = 'none';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('btnEnviar').disabled = false;
    document.getElementById('btnEnviar').textContent = 'Enviar';
    document.getElementById('modalUploadTitulo').textContent = 'Novo Documento';
    abrirModal('modalUpload');
}

function onFileSelect(input) {
    if (input.files && input.files[0]) {
        selectedFile = input.files[0];
        document.getElementById('dzFileName').textContent = selectedFile.name;
        if (!document.getElementById('uploadNome').value) {
            document.getElementById('uploadNome').value = selectedFile.name.replace(/\.[^/.]+$/, '');
        }
    }
}

function onDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('over'); }
function onDragLeave(e) { e.currentTarget.classList.remove('over'); }
function onDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file) {
        selectedFile = file;
        document.getElementById('dzFileName').textContent = file.name;
        if (!document.getElementById('uploadNome').value) {
            document.getElementById('uploadNome').value = file.name.replace(/\.[^/.]+$/, '');
        }
    }
}

async function enviarUpload() {
    if (!selectedFile) { alert('Selecione um arquivo.'); return; }
    const nome = document.getElementById('uploadNome').value.trim();
    if (!nome) { alert('Informe o nome do documento.'); return; }

    const formData = new FormData();
    formData.append('arquivo', selectedFile);
    formData.append('nome', nome);
    formData.append('categoria', document.getElementById('uploadCategoria').value);
    formData.append('descricao', document.getElementById('uploadDescricao').value);
    formData.append('tags', document.getElementById('uploadTags').value);
    formData.append('eh_modelo', document.getElementById('uploadModelo').checked ? 'true' : 'false');
    if (processoId) {
        formData.append('processo_id', processoId);
    } else {
        const sel = document.getElementById('uploadProcesso').value;
        if (sel) formData.append('processo_id', sel);
    }

    document.getElementById('progressWrap').style.display = 'block';
    document.getElementById('btnEnviar').disabled = true;
    document.getElementById('btnEnviar').textContent = 'Enviando…';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/documentos');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const pct = Math.round(e.loaded / e.total * 100);
            document.getElementById('progressFill').style.width = pct + '%';
        }
    };

    xhr.onload = () => {
        document.getElementById('btnEnviar').disabled = false;
        document.getElementById('btnEnviar').textContent = 'Enviar';
        if (xhr.status === 201) {
            fecharModal('modalUpload');
            carregarDocumentos();
        } else {
            let msg = 'Erro ao enviar documento.';
            try { msg = JSON.parse(xhr.responseText).erro || msg; } catch { }
            alert(msg);
            document.getElementById('progressFill').style.width = '0%';
            document.getElementById('progressWrap').style.display = 'none';
        }
    };

    xhr.onerror = () => {
        document.getElementById('btnEnviar').disabled = false;
        document.getElementById('btnEnviar').textContent = 'Enviar';
        alert('Erro de rede ao enviar arquivo.');
    };

    xhr.send(formData);
}

// ─── Modal Editar ─────────────────────────────────────────────────────────────
function abrirEditar(id) {
    const doc = todosDocumentos.find(d => d.id === id);
    if (!doc) return;
    document.getElementById('editId').value = id;
    document.getElementById('editNome').value = doc.nome;
    document.getElementById('editCategoria').value = doc.categoria || 'outros';
    document.getElementById('editDescricao').value = doc.descricao || '';
    document.getElementById('editTags').value = doc.tags || '';
    abrirModal('modalEditar');
}

async function salvarEdicao() {
    const id = document.getElementById('editId').value;
    const nome = document.getElementById('editNome').value.trim();
    if (!nome) { alert('Nome obrigatório.'); return; }

    try {
        const res = await fetch(`/api/documentos/${id}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome,
                categoria: document.getElementById('editCategoria').value,
                descricao: document.getElementById('editDescricao').value,
                tags: document.getElementById('editTags').value
            })
        });
        if (!res.ok) {
            const e = await res.json();
            alert(e.erro || 'Erro ao salvar.');
            return;
        }
        fecharModal('modalEditar');
        carregarDocumentos();
    } catch (err) {
        alert('Erro ao salvar edição.');
    }
}

// ─── Modal Versões ────────────────────────────────────────────────────────────
async function abrirVersoes(id) {
    abrirModal('modalVersoes');
    document.getElementById('versoesBody').innerHTML = '<div style="text-align:center;padding:30px;color:#94a3b8;">Carregando…</div>';

    try {
        const res = await fetch(`/api/documentos/${id}/versoes`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const lista = await res.json();

        if (!lista.length) {
            document.getElementById('versoesBody').innerHTML = '<div style="color:#94a3b8;text-align:center;padding:20px;">Nenhuma versão encontrada.</div>';
            return;
        }

        document.getElementById('versoesBody').innerHTML = lista.map(v => `
            <div class="version-item">
                <span class="version-badge">v${v.versao}</span>
                <div style="flex:1;">
                    <div style="font-weight:600;font-size:14px;">${v.arquivo_original}</div>
                    <div style="font-size:12px;color:#64748b;margin-top:2px;">
                        ${formatarData(v.criado_em)} &nbsp;·&nbsp;
                        ${formatarTamanho(v.tamanho)} &nbsp;·&nbsp;
                        ${v.usuario_nome || '—'}
                    </div>
                </div>
                <button class="btn-icon" data-action="baixarDoc" data-args='[${v.id}, ${JSON.stringify(v.arquivo_original || '')}]' title="Download">
                    <i data-lucide="download" style="width:15px;height:15px;"></i>
                </button>
            </div>
        `).join('');
        lucide.createIcons();
    } catch {
        document.getElementById('versoesBody').innerHTML = '<div style="color:#ef4444;text-align:center;padding:20px;">Erro ao carregar versões.</div>';
    }
}

// ─── Modal Nova Versão ────────────────────────────────────────────────────────
function abrirNovaVersao(id) {
    selectedFileNV = null;
    document.getElementById('dzFileNameNV').textContent = '';
    document.getElementById('fileInputNV').value = '';
    document.getElementById('nvDocId').value = id;
    document.getElementById('progressWrapNV').style.display = 'none';
    document.getElementById('progressFillNV').style.width = '0%';
    abrirModal('modalNovaVersao');
}

function onFileSelectNV(input) {
    if (input.files && input.files[0]) {
        selectedFileNV = input.files[0];
        document.getElementById('dzFileNameNV').textContent = selectedFileNV.name;
    }
}

function onDropNV(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file) {
        selectedFileNV = file;
        document.getElementById('dzFileNameNV').textContent = file.name;
    }
}

async function enviarNovaVersao() {
    if (!selectedFileNV) { alert('Selecione um arquivo.'); return; }
    const id = document.getElementById('nvDocId').value;

    const formData = new FormData();
    formData.append('arquivo', selectedFileNV);

    document.getElementById('progressWrapNV').style.display = 'block';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/documentos/${id}/versao`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            document.getElementById('progressFillNV').style.width =
                Math.round(e.loaded / e.total * 100) + '%';
        }
    };

    xhr.onload = () => {
        if (xhr.status === 201) {
            fecharModal('modalNovaVersao');
            carregarDocumentos();
        } else {
            let msg = 'Erro ao enviar versão.';
            try { msg = JSON.parse(xhr.responseText).erro || msg; } catch { }
            alert(msg);
            document.getElementById('progressFillNV').style.width = '0%';
            document.getElementById('progressWrapNV').style.display = 'none';
        }
    };

    xhr.onerror = () => alert('Erro de rede.');
    xhr.send(formData);
}

// ─── Excluir ──────────────────────────────────────────────────────────────────
async function excluirDocumento(id) {
    const doc = todosDocumentos.find(d => d.id === id);
    const nome = doc ? doc.nome : `#${id}`;
    if (!confirm(`Excluir "${nome}" e TODAS as suas versões? Esta ação não pode ser desfeita.`)) return;

    try {
        const res = await fetch(`/api/documentos/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
            const e = await res.json();
            alert(e.erro || 'Erro ao excluir.');
            return;
        }
        carregarDocumentos();
    } catch {
        alert('Erro ao excluir documento.');
    }
}

// ─── Assinatura Digital ────────────────────────────────────────────────────────
let assinarDocIdAtual = null;

async function verificarStatusAssinatura(assId, docId) {
    try {
        const res = await fetch(`/api/assinaturas/${assId}/verificar`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) { alert(data.erro || 'Erro ao verificar status.'); return; }

        if (data.atualizado) {
            const msg = data.status === 'concluido'
                ? '✅ Documento assinado! Badge atualizado.'
                : `Status atualizado para: ${data.status}`;
            alert(msg);
            carregarDocumentos();
        } else {
            alert(`Status atual: ${data.status === 'enviado' ? '🔏 Aguardando assinatura' : data.status} (sem alteração)`);
        }
    } catch (err) {
        alert('Erro ao verificar status da assinatura.');
    }
}

async function baixarDocumentoAssinado(assId) {
    try {
        const res = await fetch(`/api/assinaturas/${assId}/download`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert('Erro ao baixar documento assinado: ' + (err.erro || res.statusText));
            return;
        }
        const disposition = res.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^";\n]+)"?/i);
        const filename = match ? match[1] : 'documento_assinado.pdf';
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Erro ao baixar documento assinado.');
    }
}

async function abrirModalAssinar(docId, processoId) {
    assinarDocIdAtual = docId;
    const doc = todosDocumentos.find(d => d.id === docId);

    document.getElementById('assinarDocNome').textContent = doc ? doc.nome : `Documento #${docId}`;
    document.getElementById('assinarMensagem').value = '';

    // Deadline padrão: +30 dias
    const d30 = new Date();
    d30.setDate(d30.getDate() + 30);
    document.getElementById('assinarDeadline').value = d30.toISOString().split('T')[0];

    // Limpar lista de signatários
    document.getElementById('assinarSignatariosList').innerHTML = '';
    document.getElementById('assinarSignAviso').style.display = 'none';
    document.getElementById('assinarAutoInfo').style.display = 'none';

    abrirModal('modalAssinar');

    if (processoId && processoId !== 'null') {
        // Busca polo ativo para pré-preencher
        try {
            const res = await fetch(`/api/processos/${processoId}/partes`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Erro ao buscar partes');
            const data = await res.json();
            const partes = (data.partes || [])
                .filter(p => p.polo === 'ativo')
                .sort((a, b) => (b.eh_principal ? 1 : 0) - (a.eh_principal ? 1 : 0));

            if (partes.length === 0) {
                adicionarLinhaSignatario();
                const aviso = document.getElementById('assinarSignAviso');
                aviso.textContent = 'Nenhuma parte no polo ativo encontrada. Preencha manualmente.';
                aviso.style.display = 'block';
            } else {
                const parte = partes[0];
                adicionarLinhaSignatario(parte.pessoa_nome || '', parte.pessoa_email || '');
                document.getElementById('assinarAutoInfo').style.display = 'block';
                if (!parte.pessoa_email) {
                    const aviso = document.getElementById('assinarSignAviso');
                    aviso.textContent = 'O signatário não possui e-mail cadastrado. Cadastre o e-mail antes de enviar.';
                    aviso.style.display = 'block';
                }
            }
        } catch {
            adicionarLinhaSignatario();
        }
    } else {
        adicionarLinhaSignatario();
    }
}

function adicionarLinhaSignatario(nome = '', email = '') {
    // Quando chamada via data-action (sem data-args), o event delegation passa o
    // elemento DOM como primeiro argumento. Garante que nome/email sejam strings.
    if (typeof nome !== 'string') nome = '';
    if (typeof email !== 'string') email = '';
    const list = document.getElementById('assinarSignatariosList');
    const row = document.createElement('div');
    row.className = 'sign-row';
    row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px;';
    const nomeEsc  = nome.replace(/"/g, '&quot;');
    const emailEsc = email.replace(/"/g, '&quot;');
    row.innerHTML = `
        <div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:2px;">Nome *</div>
            <input type="text" class="sign-nome" placeholder="Nome completo" value="${nomeEsc}"
                style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#f8fafc;box-sizing:border-box;">
        </div>
        <div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:2px;">E-mail *</div>
            <input type="email" class="sign-email" placeholder="email@exemplo.com" value="${emailEsc}"
                style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#f8fafc;box-sizing:border-box;">
        </div>
        <button type="button" data-action="removerLinhaSignatario"
            style="padding:6px 8px;border:none;background:none;cursor:pointer;color:#ef4444;font-size:20px;line-height:1;margin-top:14px;" title="Remover">&times;</button>
    `;
    list.appendChild(row);
}

function removerLinhaSignatario(btn) {
    const list = document.getElementById('assinarSignatariosList');
    if (list.querySelectorAll('.sign-row').length <= 1) {
        alert('Deve haver pelo menos um signatario.');
        return;
    }
    btn.closest('.sign-row').remove();
}

async function enviarAssinatura() {
    if (!assinarDocIdAtual) return;

    const mensagem = document.getElementById('assinarMensagem').value.trim() || null;
    const deadline = document.getElementById('assinarDeadline').value || null;

    // Coletar todos os signatários da lista dinâmica
    const rows = document.querySelectorAll('#assinarSignatariosList .sign-row');
    const signatarios = [];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const row of rows) {
        const nome  = row.querySelector('.sign-nome').value.trim();
        const email = row.querySelector('.sign-email').value.trim();
        if (!nome || !email) {
            alert('Preencha o nome e o e-mail de todos os signatarios.');
            return;
        }
        if (!emailRegex.test(email)) {
            alert(`E-mail invalido: ${email}`);
            return;
        }
        signatarios.push({ nome, email });
    }

    if (signatarios.length === 0) {
        alert('Adicione pelo menos um signatario.');
        return;
    }

    const btn = document.getElementById('btnEnviarAssinatura');
    btn.disabled = true;
    btn.textContent = 'Enviando…';

    try {
        const res = await fetch(`/api/documentos/${assinarDocIdAtual}/assinar`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ mensagem, deadline, signatarios })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.erro || 'Erro ao enviar para assinatura.');
            return;
        }
        fecharModal('modalAssinar');
        const plural = signatarios.length > 1
            ? `${signatarios.length} signatarios receberao e-mails`
            : 'O signatario recebera um e-mail';
        alert(`Documento enviado para assinatura! ${plural} com o link para assinar.`);
        carregarDocumentos();
    } catch (err) {
        alert('Erro ao enviar para assinatura.');
    } finally {
        btn.disabled = false;
        btn.textContent = '🔏 Enviar para Assinatura';
    }
}

// ─── ClickSign Add-on ─────────────────────────────────────────────────────────
async function carregarAddonStatus() {
    try {
        const res = await fetch('/api/addon/clicksign/status', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
            addonClicksign = await res.json();
            // Mostra legenda de ícones apenas quando a API Key estiver configurada
            const legenda = document.getElementById('legendaAssinatura');
            if (legenda) legenda.style.display = addonClicksign.api_key_configurada ? 'flex' : 'none';
            if (legenda && addonClicksign.api_key_configurada) legenda.style.flexWrap = 'wrap';
        }
    } catch { /* silencioso */ }
}

function abrirModalAddon() {
    // Chamado apenas quando a chave API não está configurada
    document.getElementById('addonModalTitulo').textContent = '🔑 Configure sua Chave ClickSign';
    document.getElementById('addonModalDescricao').style.display = 'none';
    document.getElementById('addonModalFeatures').style.display = 'none';
    document.getElementById('addonModalPreco').style.display = 'none';
    document.getElementById('btnAtivarAddon').style.display = 'none';
    document.getElementById('addonAvisoLimite').innerHTML = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:18px;text-align:center;margin-bottom:8px;">
            <div style="font-size:36px;margin-bottom:10px;">🔑</div>
            <p style="font-size:15px;font-weight:700;color:#1e40af;margin:0 0 8px;">Assinatura Digital disponível no seu plano</p>
            <p style="font-size:13px;color:#3b82f6;margin:0 0 16px;line-height:1.5;">
                Configure sua API Key do ClickSign em <strong>Configurações</strong> para começar a usar.
                Você precisará de uma conta ativa no ClickSign.
            </p>
            <a href="/config-page" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:700;font-size:14px;">
                Ir para Configurações →
            </a>
        </div>`;
    abrirModal('modalAddonClickSign');
}

async function ativarAddon() {
    const btn = document.getElementById('btnAtivarAddon');
    btn.disabled = true;
    btn.textContent = 'Aguarde…';
    try {
        const res = await fetch('/api/addon/clicksign/checkout', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (!res.ok) { alert(data.erro || 'Erro ao criar sessão de pagamento.'); return; }
        window.location.href = data.url;
    } catch (err) {
        alert('Erro ao conectar ao servidor. Tente novamente.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Ativar por R$ 49,90/mês →';
    }
}

function mostrarToastAddon(mensagem) {
    let toast = document.getElementById('toastAddon');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toastAddon';
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;background:#065F46;color:#fff;padding:14px 20px;border-radius:10px;font-size:14px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,0.2);max-width:360px;line-height:1.4;transition:opacity .4s;';
        document.body.appendChild(toast);
    }
    toast.textContent = mensagem;
    toast.style.opacity = '1';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.style.opacity = '0'; }, 5000);
}

// ─── Aviso de upgrade de plano ────────────────────────────────────────────────
function exibirAvisoUpgrade(mensagem) {
    const overlay = document.createElement('div');
    overlay.id = 'overlay-upgrade';
    overlay.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:20000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(5px);';
    overlay.innerHTML = `
    <div style="background:#fff;padding:40px;border-radius:20px;text-align:center;max-width:400px;">
        <div style="font-size:50px;">🚀</div>
        <h3 style="margin-top:15px;color:#0f172a;">Recurso não disponível</h3>
        <p style="color:#64748b;margin:15px 0 25px 0;line-height:1.6;">${mensagem}</p>
        <button data-action="navegarPara" data-args='["/planos-page"]' style="background:linear-gradient(135deg,#fbbf24 0%,#f59e0b 100%);color:#000;border:none;padding:14px 28px;border-radius:10px;font-weight:800;cursor:pointer;width:100%;margin-bottom:10px;">
            Ver Planos e Preços
        </button>
        <button data-action="removerElemento" data-args='["overlay-upgrade"]' style="background:none;border:none;color:#64748b;cursor:pointer;font-weight:600;padding:8px;">
            Depois
        </button>
    </div>`;
    document.body.appendChild(overlay);
}

// ─── Modal helpers ────────────────────────────────────────────────────────────
function abrirModal(id) {
    document.getElementById(id).classList.add('open');
}
function fecharModal(id) {
    document.getElementById(id).classList.remove('open');
}

// Fechar modal ao clicar no overlay
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
    });
});

Object.assign(window, {
    navegarPara,
    removerElemento,
    clicarElemento,
    toggleUserDropdown,
    logout,
    toggleIaMenu,
    filtrar,
    baixarDoc,
    abrirModalUpload,
    onFileSelect,
    onDragOver,
    onDragLeave,
    onDrop,
    enviarUpload,
    abrirEditar,
    salvarEdicao,
    abrirVersoes,
    abrirNovaVersao,
    onFileSelectNV,
    onDropNV,
    enviarNovaVersao,
    excluirDocumento,
    verificarStatusAssinatura,
    baixarDocumentoAssinado,
    abrirModalAssinar,
    adicionarLinhaSignatario,
    removerLinhaSignatario,
    enviarAssinatura,
    abrirModalAddon,
    ativarAddon,
    abrirModal,
    fecharModal
});
