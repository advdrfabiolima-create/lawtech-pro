
const token = localStorage.getItem('token');
if (!token) window.location.href = '/login.html';

let publicacoes = [];
let modalPubId = null;

// USER MENU
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

// MAPEAMENTO DE TRIBUNAIS (código CNJ → sigla)
const TRIBUNAIS_MAP = {
    '01': 'TJAC', '02': 'TJAL', '03': 'TJAP', '04': 'TJAM', '05': 'TJBA',
    '06': 'TJCE', '07': 'TJDF', '08': 'TJES', '09': 'TJGO', '10': 'TJMA',
    '11': 'TJMT', '12': 'TJMS', '13': 'TJMG', '14': 'TJPA', '15': 'TJPB',
    '16': 'TJPR', '17': 'TJPE', '18': 'TJPI', '19': 'TJRJ', '20': 'TJRN',
    '21': 'TJRS', '22': 'TJRO', '23': 'TJRR', '24': 'TJSC', '25': 'TJSE',
    '26': 'TJSP', '27': 'TJTO'
};

function mapearTribunal(valor) {
    if (!valor) return 'DJEN';
    // Se já é um nome conhecido (DJEN, TJRS, TRF-1...), manter
    if (/^(DJEN|TJ[A-Z]{2}|TRF|TST|STJ|STF|TRT|TRE)/.test(valor)) return valor;
    // Se é formato TJ + número (ex: TJ21), mapear
    const match = valor.match(/^TJ(\d{2})$/i);
    if (match) {
        return TRIBUNAIS_MAP[match[1]] || valor;
    }
    return valor;
}

// HIGHLIGHT DE TERMOS JURÍDICOS
function highlightTermos(texto) {
    if (!texto) return '';
    // Escape HTML first
    let t = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 1) Highlight partes processuais: rótulo + nome que segue
    // Rótulos em CAIXA ALTA
    const rotulosUpper = [
        'AUTOR[A]?', 'R[ÉE]U', 'R[ÉE]',
        'REQUERENTE', 'REQUERID[OA]',
        'RECLAMANTE', 'RECLAMAD[OA]',
        'APELANTE', 'APELAD[OA]',
        'AGRAVANTE', 'AGRAVAD[OA]',
        'IMPETRANTE', 'IMPETRAD[OA]',
        'EXEQUENTE', 'EXECUTAD[OA]',
        'EMBARGANTE', 'EMBARGAD[OA]',
        'RECORRENTE', 'RECORRID[OA]',
        'DENUNCIANTE', 'DENUNCIAD[OA]',
        'LITISCONSORTE', 'INTERESSAD[OA]',
        'TERCEIR[OA]', 'INVENTARIANTE', 'ESP[OÓ]LIO',
        'POLO\\s+ATIVO', 'POLO\\s+PASSIVO',
        'RECTE', 'RECDO', 'REQTE', 'REQDO',
        'EXEQTE', 'EXECTD[OA]',
        'IMPTE', 'IMPTD[OA]'
    ].join('|');
    // Rótulos em Title Case (formato DJEN comum)
    const rotulosTitleCase = [
        'Polo\\s+Ativo', 'Polo\\s+Passivo',
        'Advogado\\(?s?\\)?', 'ADVOGADO\\(?S?\\)?'
    ].join('|');
    const todosRotulos = rotulosUpper + '|' + rotulosTitleCase;

    const parteRegex = new RegExp(
        '(?:^|[\\s,;])(' + todosRotulos + ')[\\s:\\-–\\.]*\\s+([A-ZÀ-Ü][A-ZÀ-Ü0-9\\.\\-\\/\\s]{3,})',
        'g'
    );
    t = t.replace(parteRegex, (match, label, nomeRaw) => {
        // Limpar: remover trailing whitespace e pontuação
        let nome = nomeRaw.replace(/[\s,;:\.\-]+$/, '');
        // Parar antes de palavras-chave jurídicas ou comuns em minúscula que indicam fim do nome
        const corte = nome.search(/\b(INTIMA|CITA[ÇC]|PRAZO|SENTEN|DECIS|DESPACHO|AUDI[EÊ]|URGENTE|RECURSO|MANDADO|TUTELA|LIMINAR)\b/);
        if (corte > 0) nome = nome.substring(0, corte).replace(/[\s,;:\.\-]+$/, '');
        // Parar antes de "- OAB" (dados do advogado)
        const corteOab = nome.search(/\s*-\s*OAB\b/);
        if (corteOab > 0) nome = nome.substring(0, corteOab).replace(/[\s,;:\.\-]+$/, '');
        if (nome.length < 4) return match;
        // Preservar espaço/pontuação inicial do match
        const prefix = match.charAt(0) !== label.charAt(0) ? match.charAt(0) : '';
        return prefix + '<span class="hl-parte-label">' + label + '</span> <span class="hl-parte-nome">' + nome + '</span>';
    });

    // 2) Highlight termos jurídicos
    const regras = [
        { regex: /\b(URGENTE|URG[EÊ]NCIA)\b/gi, cls: 'hl-urgente' },
        { regex: /\b(INTIMA[ÇC][ÃA]O|INTIMADO|INTIMAR)\b/gi, cls: 'hl-intimacao' },
        { regex: /\b(CITA[ÇC][ÃA]O|CITADO|CITAR)\b/gi, cls: 'hl-citacao' },
        { regex: /\b(PRAZO|DIAS)\b/gi, cls: 'hl-prazo' },
        { regex: /\b(SENTEN[ÇC]A|DECIS[ÃA]O|DESPACHO)\b/gi, cls: 'hl-sentenca' },
        { regex: /\b(AUDI[EÊ]NCIA)\b/gi, cls: 'hl-audiencia' },
    ];
    regras.forEach(r => {
        t = t.replace(r.regex, (match, g1) => {
            // Não aplicar se já está dentro de um <span>
            return `<span class="${r.cls}">${g1}</span>`;
        });
    });
    return t;
}

// COPIAR TEXTO
async function copiarTexto(texto, btnEl) {
    try {
        await navigator.clipboard.writeText(texto);
        const original = btnEl.innerHTML;
        btnEl.innerHTML = '&#10003; Copiado';
        setTimeout(() => { btnEl.innerHTML = original; }, 2000);
    } catch (e) {
        alert('Erro ao copiar');
    }
}

// CARREGAR DADOS USUÁRIO
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
        document.getElementById('planNameFooter').innerText = plano.plano || 'free';
    } catch (e) {
        console.error('Erro:', e);
    }
}

// DEFINIR DATAS PADRÃO
function definirDatasDefault() {
    const hoje = new Date();
    const year = hoje.getFullYear();
    const month = String(hoje.getMonth() + 1).padStart(2, '0');
    const day = String(hoje.getDate()).padStart(2, '0');
    document.getElementById('dataBusca').value = `${year}-${month}-${day}`;
}

// EXTRAIR PARTES PROCESSUAIS DO TEXTO
function extrairPartes(texto) {
    if (!texto) return [];
    const partes = [];
    const seen = new Set();
    const padroes = [
        { regex: /\bAUTOR(?:A)?[:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'AUTOR' },
        { regex: /\bR[ÉE](?:U)?[:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'RÉU' },
        { regex: /\bREQUERENTE[:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'REQUERENTE' },
        { regex: /\bREQUERID[OA][:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'REQUERIDO' },
        { regex: /\bRECLAMANTE[:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'RECLAMANTE' },
        { regex: /\bRECLAMAD[OA][:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'RECLAMADO' },
        { regex: /\bEXEQUENTE[:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'EXEQUENTE' },
        { regex: /\bEXECUTAD[OA][:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'EXECUTADO' },
        { regex: /\bAPELANTE[:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'APELANTE' },
        { regex: /\bAPELAD[OA][:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'APELADO' },
        { regex: /\bAGRAVANTE[:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'AGRAVANTE' },
        { regex: /\bAGRAVAD[OA][:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'AGRAVADO' },
        { regex: /\bIMPETRANTE[:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'IMPETRANTE' },
        { regex: /\bIMPETRAD[OA][:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'IMPETRADO' },
        { regex: /\bPOLO\s+ATIVO[:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'POLO ATIVO' },
        { regex: /\bPOLO\s+PASSIVO[:\s\-–\.]+([A-ZÀ-Ü][A-ZÀ-Ü0-9\s\.]{2,50})/g, tipo: 'POLO PASSIVO' },
    ];
    const stopPattern = /\s+(E\b|X\b|VS\.?|CONTRA|CPF|CNPJ|OAB|ADVOGAD|PROC\.|INTIM|CITA[ÇC]|PRAZO|SENTEN|DECIS|DESPACHO|AUDI[EÊ]|RECURSO).*/i;
    for (const { regex, tipo } of padroes) {
        let match;
        regex.lastIndex = 0;
        while ((match = regex.exec(texto)) !== null) {
            let nome = match[1].trim();
            const stop = nome.search(stopPattern);
            if (stop > 0) nome = nome.substring(0, stop);
            nome = nome.replace(/[,;:\.\-\s]+$/, '').trim();
            if (nome.length >= 3 && nome.length <= 55 && !seen.has(nome)) {
                seen.add(nome);
                partes.push({ tipo, nome });
            }
            if (partes.length >= 4) break;
        }
        if (partes.length >= 4) break;
    }
    return partes;
}

// RENDERIZAR PARTES NO CARD
function renderPartes(partes) {
    if (!partes || partes.length === 0) {
        return '<span style="font-size:11px;color:var(--text-tertiary);font-style:italic;">Partes não identificadas</span>';
    }
    return partes.map(p => `
        <div style="display:flex;gap:5px;align-items:center;overflow:hidden;">
            <span style="font-size:9px;font-weight:700;color:#3730A3;background:#E0E7FF;padding:2px 5px;border-radius:3px;white-space:nowrap;flex-shrink:0;text-transform:uppercase;">${p.tipo}</span>
            <span style="font-size:11px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.nome}</span>
        </div>`).join('');
}

// CARREGAR PUBLICAÇÕES
async function carregarPublicacoes() {
    try {
        const res = await fetch('/api/publicacoes-pendentes', {
            headers: { Authorization: `Bearer ${token}` }
        });

        publicacoes = await res.json();
        renderizarTabela();
        atualizarMetricas();
    } catch (err) {
        console.error('Erro:', err);
    }
}

// RENDERIZAR CARDS
function renderizarTabela() {
    const container = document.getElementById('cardsContainer');
    const search = document.getElementById('searchInput').value.toLowerCase();

    let filtradas = publicacoes.filter(p =>
        !search ||
        p.numero_processo.toLowerCase().includes(search) ||
        p.conteudo.toLowerCase().includes(search)
    );

    if (!search.includes('descartada') && !search.includes('desc')) {
        filtradas = filtradas.filter(p => p.status !== 'descartada');
    }

    if (filtradas.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i data-lucide="inbox" style="width:64px; height:64px;"></i>
                <p>Nenhuma publicação encontrada</p>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    container.innerHTML = filtradas.map(p => {
        const status = p.status || 'pendente';
        const statusIcon = status === 'pendente' ? '&#128313;' : status === 'convertida' ? '&#128994;' : '&#128308;';
        const dataFormatada = new Date(p.data_publicacao).toLocaleDateString('pt-BR');
        const partes = extrairPartes(p.conteudo);

        return `
        <div class="pub-card status-${status}" onclick="verDetalhes(${p.id})" title="Clique para ver o conteúdo completo">
            <div class="card-mini-header">
                <span class="badge badge-${status}" style="font-size:9px;padding:3px 8px;">${statusIcon} ${status.toUpperCase()}</span>
                <span class="card-date" style="font-size:11px;"><i data-lucide="calendar" style="width:11px;height:11px;"></i> ${dataFormatada}</span>
            </div>
            <div class="card-mini-processo">
                <div class="processo-numero" style="font-size:13px;">${p.numero_processo}</div>
                <span class="processo-tribunal">${mapearTribunal(p.tribunal)}</span>
            </div>
            <div class="card-mini-partes">
                ${renderPartes(partes)}
            </div>
            <div class="card-mini-footer">
                <button class="btn-card" onclick="event.stopPropagation();verDetalhes(${p.id})" title="Ver conteúdo completo">
                    <i data-lucide="eye" style="width:13px;height:13px;"></i> Ver
                </button>
                <button class="btn-card primary" onclick="event.stopPropagation();converterPrazo(${p.id})" title="Converter em prazo">
                    <i data-lucide="calendar-plus" style="width:13px;height:13px;"></i> Prazo
                </button>
                <button class="btn-card danger" onclick="event.stopPropagation();excluir(${p.id})" title="Descartar publicação">
                    <i data-lucide="trash-2" style="width:13px;height:13px;"></i>
                </button>
            </div>
        </div>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ATUALIZAR MÉTRICAS
function atualizarMetricas() {
    const hoje = new Date().toISOString().split('T')[0];

    const recebidas = publicacoes.filter(p =>
        p.data_publicacao && p.data_publicacao.startsWith(hoje)
    ).length;

    const tratadas = publicacoes.filter(p => p.status === 'convertida').length;
    const descartadas = publicacoes.filter(p => p.status === 'descartada').length;
    const pendentes = publicacoes.filter(p => p.status === 'pendente' || !p.status).length;

    document.getElementById('metricRecebidas').innerText = recebidas;
    document.getElementById('metricTratadas').innerText = tratadas;
    document.getElementById('metricDescartadas').innerText = descartadas;
    document.getElementById('metricPendentes').innerText = pendentes;
}

// SINCRONIZAR
async function sincronizar() {
    const dataBusca = document.getElementById('dataBusca').value;

    if (!dataBusca) {
        alert('Selecione a data!');
        return;
    }

    document.getElementById('cardsContainer').style.display = 'none';
    document.getElementById('loading').classList.add('show');

    try {
        const res = await fetch('/api/sincronizar', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ dataInicio: dataBusca, dataFim: dataBusca })
        });

        const data = await res.json();

        document.getElementById('loading').classList.remove('show');
        document.getElementById('cardsContainer').style.display = '';

        if (data.ok) {
            const novas = data.resultado_worker?.resultado?.novas || 0;
            if (novas > 0) {
                alert(`${novas} novas publicações encontradas!`);
                await carregarPublicacoes();
            } else {
                alert('Nenhuma publicação nova encontrada');
            }
        } else {
            alert(data.erro || 'Erro ao sincronizar');
        }
    } catch (err) {
        console.error('Erro:', err);
        document.getElementById('loading').classList.remove('show');
        document.getElementById('cardsContainer').style.display = '';
        alert('Erro de conexão');
    }
}

// VER DETALHES (MODAL MELHORADO)
function verDetalhes(id) {
    const pub = publicacoes.find(p => p.id === id);
    if (!pub) return;
    modalPubId = id;

    const status = pub.status || 'pendente';
    const statusIcon = status === 'pendente' ? '&#128313;' : status === 'convertida' ? '&#128994;' : '&#128308;';
    const dataFormatada = new Date(pub.data_publicacao).toLocaleDateString('pt-BR');

    document.getElementById('modalBody').innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <div style="display:flex; align-items:center; gap:12px;">
                <span class="badge badge-${status}">${statusIcon} ${status.toUpperCase()}</span>
                <span style="font-size:14px; color:var(--text-secondary);"><i data-lucide="calendar" style="width:14px;height:14px;display:inline;vertical-align:middle;"></i> ${dataFormatada}</span>
            </div>
        </div>
        <div style="margin-bottom: 20px; display:flex; align-items:center; gap:12px;">
            <div>
                <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-tertiary);">Processo</span><br>
                <span class="processo-numero" style="font-size:16px;">${pub.numero_processo}</span>
                <span style="margin-left:12px; font-size:12px; color:var(--text-tertiary); font-weight:600;">${mapearTribunal(pub.tribunal)}</span>
            </div>
        </div>
        <div style="margin-bottom: 20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-tertiary);">Conteúdo</span>
                <button class="btn-copiar" id="btnCopiarConteudo" onclick="copiarConteudoModal(this)">
                    <i data-lucide="copy" style="width:12px;height:12px;"></i> Copiar Conteúdo
                </button>
            </div>
            <div style="background: var(--bg-primary); padding: 16px; border-radius: 8px; line-height: 1.7; border: 1px solid var(--border-subtle);">
                ${highlightTermos(pub.conteudo)}
            </div>
        </div>
        <div style="display:flex; gap:8px; padding-top:16px; border-top:1px solid var(--border-subtle);">
            <button class="btn-card primary" onclick="fecharModal(); converterPrazo(${pub.id})">
                <i data-lucide="calendar-plus" style="width:14px;height:14px;"></i> Converter Prazo
            </button>
            <button class="btn-card danger" onclick="fecharModal(); excluir(${pub.id})">
                <i data-lucide="trash-2" style="width:14px;height:14px;"></i> Excluir
            </button>
        </div>
    `;

    document.getElementById('modalDetalhes').classList.add('show');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// COPIAR CONTEÚDO DO MODAL
function copiarConteudoModal(btnEl) {
    const pub = publicacoes.find(p => p.id === modalPubId);
    if (pub) copiarTexto(pub.conteudo, btnEl);
}

// FECHAR MODAL
function fecharModal() {
    document.getElementById('modalDetalhes').classList.remove('show');
}

// CONVERTER PRAZO
async function converterPrazo(id) {
    const pub = publicacoes.find(p => p.id === id);
    if (!pub) return;

    const tipo = prompt('Tipo de prazo (ex: Recurso, Contestação, Réplica):', 'Recurso');
    if (!tipo) return;

    const dias = prompt('Quantidade de dias úteis:', '15');
    if (!dias || isNaN(dias)) {
        alert('Quantidade de dias inválida!');
        return;
    }

    const hoje = new Date();
    let diasAdicionados = 0;
    let dataLimite = new Date(hoje);

    while (diasAdicionados < parseInt(dias)) {
        dataLimite.setDate(dataLimite.getDate() + 1);
        const diaSemana = dataLimite.getDay();
        if (diaSemana !== 0 && diaSemana !== 6) {
            diasAdicionados++;
        }
    }

    const dataCalculada = dataLimite.toISOString().split('T')[0];

    if (!confirm(`Criar prazo de ${tipo} com ${dias} dias úteis?\nData limite: ${new Date(dataCalculada).toLocaleDateString('pt-BR')}`)) {
        return;
    }

    try {
        const res = await fetch('/api/converter-publicacao', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id_publicacao: id,
                tipo,
                dias: parseInt(dias),
                dataCalculada
            })
        });

        const data = await res.json();

        if (data.ok) {
            alert('Prazo criado com sucesso!');
            await carregarPublicacoes();
        } else {
            alert('Erro: ' + (data.erro || 'Erro ao criar prazo'));
        }
    } catch (err) {
        console.error('Erro:', err);
        alert('Erro de conexão');
    }
}

// EXCLUIR
async function excluir(id) {
    const pub = publicacoes.find(p => p.id === id);
    if (!pub) return;

    if (!confirm('Descartar esta publicação?')) return;

    try {
        const res = await fetch(`/api/publicacoes/${id}/status`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'descartada' })
        });

        const data = await res.json();

        if (data.ok || res.ok) {
            alert('Publicação descartada!');
            await carregarPublicacoes();
        } else {
            alert('Erro: ' + (data.erro || 'Erro ao descartar'));
        }
    } catch (err) {
        console.error('Erro:', err);
        alert('Erro de conexão: ' + err.message);
    }
}

// FILTRO DE BUSCA
document.getElementById('searchInput').addEventListener('input', renderizarTabela);

// LOGOUT
function logout() {
    localStorage.removeItem('token');
    window.location.href = '/login.html';
}

// INIT
window.onload = () => {
    carregarDadosUsuario();
    definirDatasDefault();
    carregarPublicacoes();
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

function toggleIaMenu(e) {
    e.preventDefault();
    document.getElementById('submenu-ia').classList.toggle('open');
}


function aplicarPermissoesRoleUI(role) {
    if (role === 'admin') return;
    const s = document.createElement('style');
    if (role === 'operador') {
        s.textContent = `.btn-card.danger { display: none !important; }`;
    } else {
        s.textContent = `.btn-card.danger, button[onclick*='sincronizar'] { display: none !important; }`;
    }
    document.head.appendChild(s);
}


(function(){var t=localStorage.getItem('token');if(!t)return;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){return r.json()}).then(function(d){if(d.ok){var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}}).catch(function(){})}checkChat();setInterval(checkChat,30000)})();
