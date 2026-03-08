
if (!API.getToken()) window.location.href = '/login.html';

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
        const res = await API.get('/api/auth/me');
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

        const resPlano = await API.get('/api/plano-consumo');
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

    // Termos jurídicos que NÃO são nomes de partes
    const naoEhNome = /^(INEXISTÊNCIA|INDENIZAÇÃO|REPARAÇÃO|RESPONSABILIDADE|DANO\s*MORAL|DANO\s*MATERIAL|TUTELA|LIMINAR|URGENTE|MEDIDA|APELAÇÃO|AGRAVO|MANDADO|REVISÃO|EMBARGOS\s+DE|EXECUÇÃO\s+DE|PROCESSO\s+N|AÇÃO\s+DE|REQUERIMENTO|PEDIDO\s+DE|NULIDADE|RESCISÓRIA|CAUTELAR|PRECATÓRIO|HONORÁRIOS|TRIBUNAL|VARA|CÂMARA|TURMA|SEÇÃO|AUSÊNCIA|FALTA\s+DE|CONTRATO|EMPRÉSTIMO|FINANCIAMENTO|COBRANÇA|INDÉBITO|REVISIONAL|CUMPRIMENTO|FASE\s+DE)/i;

    // Padrão de próximo rótulo (para cortar o nome antes do próximo)
    const proximoRotulo = /\b(?:APELANTE|APELAD[OA]|AGRAVANTE|AGRAVAD[OA]|IMPETRANTE|IMPETRAD[OA]|RECORRENTE|RECORRID[OA]|EXEQUENTE|EXECUTAD[OA]|EMBARGANTE|EMBARGAD[OA]|INTIMAD[OA]|CITAD[OA]|AUTOR[A]?|R[ÉE](?:U|Ú)?|REQUERENTE|REQUERID[OA]|RECLAMANTE|RECLAMAD[OA]|POLO\s+(?:ATIVO|PASSIVO)|ADVOGAD[OA]|ADVOGADOS?|PARTES?)\b/i;

    // Separador ESTRITO: exige dois-pontos, travessão ou hífen (não aceita só espaço)
    const SEP = '[:\\-–]\\s*';

    const padroes = [
        // Papéis recursais (maior prioridade)
        { regex: new RegExp(`\\bAPELANTE${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'APELANTE' },
        { regex: new RegExp(`\\bAPELAD[OA]${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'APELADO' },
        { regex: new RegExp(`\\bAGRAVANTE${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'AGRAVANTE' },
        { regex: new RegExp(`\\bAGRAVAD[OA]${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'AGRAVADO' },
        { regex: new RegExp(`\\bIMPETRANTE${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'IMPETRANTE' },
        { regex: new RegExp(`\\bIMPETRAD[OA]${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'IMPETRADO' },
        { regex: new RegExp(`\\bRECORRENTE${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'RECORRENTE' },
        { regex: new RegExp(`\\bRECORRID[OA]${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'RECORRIDO' },
        { regex: new RegExp(`\\bEXEQUENTE${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'EXEQUENTE' },
        { regex: new RegExp(`\\bEXECUTAD[OA]${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'EXECUTADO' },
        { regex: new RegExp(`\\bEMBARGANTE${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'EMBARGANTE' },
        { regex: new RegExp(`\\bEMBARGAD[OA]${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'EMBARGADO' },
        // Intimados/citados (muito comuns no DJEN)
        { regex: new RegExp(`\\bINTIMAD[OA]${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'INTIMADO' },
        { regex: new RegExp(`\\bCITAD[OA]${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'CITADO' },
        // Papéis de 1º grau
        { regex: new RegExp(`\\bAUTOR(?:A)?${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'AUTOR' },
        { regex: new RegExp(`\\bR[ÉE](?:U|Ú)?${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'RÉU' },
        { regex: new RegExp(`\\bREQUERENTE${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'REQUERENTE' },
        { regex: new RegExp(`\\bREQUERID[OA]${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'REQUERIDO' },
        { regex: new RegExp(`\\bRECLAMANTE${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'RECLAMANTE' },
        { regex: new RegExp(`\\bRECLAMAD[OA]${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'RECLAMADO' },
        { regex: new RegExp(`\\bPOLO\\s+ATIVO${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'POLO ATIVO' },
        { regex: new RegExp(`\\bPOLO\\s+PASSIVO${SEP}([^\\n]{3,70})`, 'gi'), tipo: 'POLO PASSIVO' },
        // Polo Ativo/Passivo com separador apenas de espaço (formato DJEN sem dois-pontos)
        { regex: /\bPolo\s+Ativo\s+([A-ZÀ-Ü][^\n]{3,70})/gi, tipo: 'POLO ATIVO' },
        { regex: /\bPolo\s+Passivo\s+([A-ZÀ-Ü][^\n]{3,70})/gi, tipo: 'POLO PASSIVO' },
        // Prefixo "Partes:" seguido de lista — captura bloco inteiro para o fallback X tratar
        { regex: new RegExp(`\\bPARTES?${SEP}([^\\n]{3,120})`, 'gi'), tipo: '_partes_bloco' },
        // Formato "NAME (AGRAVANTE)" — papel entre parênteses após o nome (padrão STJ/tribunais superiores)
        { regex: /\b([A-ZÀ-Ü][A-ZÀ-Ü\s\.&]{2,55}?)\s*\((AGRAVANTE|AGRAVADA?|APELANTE|APELADA?|AUTOR[A]?|R[ÉE](?:U|Ú)?|REQUERENTE|REQUERID[OA]|RECLAMANTE|RECLAMAD[OA]|EXEQUENTE|EXECUTAD[OA]|EMBARGANTE|EMBARGAD[OA]|IMPETRANTE|IMPETRAD[OA]|RECORRENTE|RECORRID[OA]|INTIMAD[OA]|CITAD[OA])\)/gi, tipo: '_role_paren' },
    ];

    // Padrão de labels concatenados sem espaço: "SAADVOGADO:" → encontra "ADVOGADO:" e corta antes
    const labelConcatenado = /(?:ADVOGAD[OA]S?|AGRAVANTE|AGRAVAD[OA]|APELANTE|APELAD[OA]|AUTOR[A]?|R[EÉ](?:U|Ú)?|REQUERENTE|REQUERID[OA]|RECLAMANTE|RECLAMAD[OA]|EXEQUENTE|EXECUTAD[OA]|EMBARGANTE|EMBARGAD[OA]|IMPETRANTE|IMPETRAD[OA]|RECORRENTE|RECORRID[OA]|INTIMAD[OA]|CITAD[OA]):/i;

    function limparNome(raw) {
        let nome = raw;
        // 1) Parar no próximo rótulo com word boundary (espaço antes)
        const idxRotulo = nome.search(proximoRotulo);
        if (idxRotulo > 0) nome = nome.substring(0, idxRotulo);
        // 2) Parar em label concatenado sem espaço (ex: "SAADVOGADO:" → corta em "ADVOGADO")
        const idxConcat = nome.search(labelConcatenado);
        if (idxConcat > 0) nome = nome.substring(0, idxConcat);
        // 3a) Parar antes de "Advogado" mesmo sem espaço/colon (ex: "PEREIRAAdvogado(s)")
        const idxAdv = nome.search(/Advogado/i);
        if (idxAdv > 0) nome = nome.substring(0, idxAdv);
        // 3b) Parar antes de dados do advogado
        const idxOab = nome.search(/\s*[-–]?\s*OAB\b|\s*[-–]?\s*ADV[.\s:]/i);
        if (idxOab > 0) nome = nome.substring(0, idxOab);
        // 4) Parar em ponto seguido de espaço+maiúscula (nova sentença) — preserva "S.A.", "LTDA."
        const idxPonto = nome.search(/\.\s+[A-ZÀ-Ü]/);
        if (idxPonto > 0) nome = nome.substring(0, idxPonto);
        // 5) Parar em ponto-e-vírgula
        const idxPV = nome.search(/[;]/);
        if (idxPV > 3) nome = nome.substring(0, idxPV);
        // 6) Limpar pontuação final
        nome = nome.replace(/[,;:\.\-\s]+$/, '').trim();
        return nome;
    }

    // Função auxiliar para extrair par de partes de "NOME1 X NOME2"
    function extrairParXvs(trecho) {
        // Permite letras maiúsculas, espaços, pontos (S.A.), hífen — mas não colchetes ou números sozinhos
        const vsReg = /([A-ZÀ-Ü][A-ZÀ-Ü\s\.]{2,50}?)\s+(?:X|VS\.?|VERSUS|CONTRA)\s+([A-ZÀ-Ü][A-ZÀ-Ü\s\.]{2,50})/g;
        let m;
        while ((m = vsReg.exec(trecho)) !== null && partes.length < 4) {
            [m[1], m[2]].forEach((raw, i) => {
                const nm = raw.replace(/[,;:\.\-\s]+$/, '').trim();
                if (nm.length >= 3 && nm.length <= 60 && !naoEhNome.test(nm) && !seen.has(nm.toUpperCase())) {
                    seen.add(nm.toUpperCase());
                    partes.push({ tipo: i === 0 ? 'POLO ATIVO' : 'POLO PASSIVO', nome: nm });
                }
            });
        }
    }

    for (const { regex, tipo } of padroes) {
        let match;
        regex.lastIndex = 0;
        while ((match = regex.exec(texto)) !== null) {
            // Padrão especial: bloco "Partes: NOME X NOME" — extrair via X/VS
            if (tipo === '_partes_bloco') {
                extrairParXvs(match[1]);
                continue;
            }
            // Padrão especial: "NOME (AGRAVANTE)" — grupo 1 = nome, grupo 2 = tipo
            if (tipo === '_role_paren') {
                const nomeP = match[1].replace(/[,;:\.\-\s]+$/, '').trim();
                const tipoP = match[2];
                if (nomeP.length >= 3 && nomeP.length <= 60 && !naoEhNome.test(nomeP) && !seen.has(nomeP.toUpperCase())) {
                    seen.add(nomeP.toUpperCase());
                    partes.push({ tipo: tipoP, nome: nomeP });
                }
                continue;
            }
            const nome = limparNome(match[1]);
            if (nome.length < 3 || nome.length > 60) continue;
            if (naoEhNome.test(nome)) continue;
            if (seen.has(nome.toUpperCase())) continue;
            seen.add(nome.toUpperCase());
            partes.push({ tipo, nome });
            if (partes.length >= 4) break;
        }
        if (partes.length >= 4) break;
    }

    // Fallback geral: varrer o texto inteiro em busca de "NOME X NOME"
    if (partes.length === 0) {
        extrairParXvs(texto);
    }

    return partes;
}

// RENDERIZAR PARTES NO CARD
function renderPartes(partes) {
    if (!partes || partes.length === 0) {
        return `<div class="partes-vazio">
            <i data-lucide="user-x" style="width:13px;height:13px;opacity:0.4;"></i>
            <span>Partes não identificadas no texto</span>
        </div>`;
    }
    // Cores por tipo de polo
    const coresAtivo = { bg: '#dbeafe', color: '#1e40af' };  // azul — polo ativo
    const coresPassivo = { bg: '#fee2e2', color: '#991b1b' }; // vermelho — polo passivo
    const coresNeutro = { bg: '#e0e7ff', color: '#3730a3' };  // índigo — outros

    const tiposAtivo = ['APELANTE','AGRAVANTE','IMPETRANTE','RECORRENTE','EMBARGANTE','EXEQUENTE','AUTOR','AUTORA','REQUERENTE','RECLAMANTE','POLO ATIVO'];
    const tiposPassivo = ['APELADO','APELADA','AGRAVADO','AGRAVADA','IMPETRADO','IMPETRADA','RECORRIDO','RECORRIDA','EMBARGADO','EMBARGADA','EXECUTADO','EXECUTADA','RÉU','RÉ','REQUERIDO','REQUERIDA','RECLAMADO','RECLAMADA','POLO PASSIVO'];

    return partes.map(p => {
        const tipoUp = p.tipo.toUpperCase();
        const cores = tiposAtivo.includes(tipoUp) ? coresAtivo
                    : tiposPassivo.includes(tipoUp) ? coresPassivo
                    : coresNeutro;
        return `<div class="parte-row">
            <span class="parte-tipo" style="background:${cores.bg};color:${cores.color};">${esc(p.tipo)}</span>
            <span class="parte-nome">${esc(p.nome)}</span>
        </div>`;
    }).join('');
}

// CARREGAR PUBLICAÇÕES
async function carregarPublicacoes() {
    try {
        const res = await API.get('/api/publicacoes-pendentes?limit=200');

        const resp = await res.json();
        publicacoes = resp.data || resp;
        renderizarTabela();
        atualizarMetricas();
    } catch (err) {
        console.error('Erro:', err);
    }
}

// ESCAPAR HTML (evita quebrar innerHTML com caracteres especiais no conteúdo)
function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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
        const dataFormatada = new Date(p.data_publicacao).toLocaleDateString('pt-BR');
        const partes = extrairPartes(p.conteudo);
        // Snippet: primeiros ~120 chars escapados (evita quebrar innerHTML)
        const snippetRaw = (p.conteudo || '').replace(/\s+/g, ' ').trim();
        const snippet = esc(snippetRaw.length > 120 ? snippetRaw.substring(0, 120) + '…' : snippetRaw);

        const statusLabel = { pendente: 'Pendente', convertida: 'Convertida', descartada: 'Descartada' }[status] || status;
        const statusDot = { pendente: '#f59e0b', convertida: '#10b981', descartada: '#ef4444' }[status] || '#f59e0b';

        return `
        <div class="pub-card status-${status}" data-action="verDetalhes" data-id="${p.id}" title="Clique para ver o conteúdo completo">
            <div class="card-top">
                <span class="status-pill" style="--dot:${statusDot}">
                    <span class="status-dot"></span>${statusLabel}
                </span>
                <span class="card-date">
                    <i data-lucide="calendar" style="width:11px;height:11px;"></i> ${dataFormatada}
                </span>
            </div>
            <div class="card-processo-row">
                <span class="processo-numero">${esc(p.numero_processo)}</span>
                <span class="tribunal-pill">${esc(mapearTribunal(p.tribunal))}</span>
            </div>
            <div class="card-partes-section">
                ${renderPartes(partes)}
            </div>
            <div class="card-snippet">${snippet}</div>
            <div class="card-actions">
                <button class="btn-card" data-action="verDetalhes" data-id="${p.id}" title="Ver conteúdo completo">
                    <i data-lucide="eye" style="width:13px;height:13px;"></i> Ver
                </button>
                <button class="btn-card primary" data-action="converterPrazo" data-id="${p.id}" title="Converter em prazo">
                    <i data-lucide="calendar-plus" style="width:13px;height:13px;"></i> Criar Prazo
                </button>
                <button class="btn-card danger" data-action="excluir" data-id="${p.id}" title="Descartar publicação">
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
        const res = await API.post('/api/sincronizar', { dataInicio: dataBusca, dataFim: dataBusca });

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
                <button class="btn-copiar" id="btnCopiarConteudo" data-action="copiarConteudo">
                    <i data-lucide="copy" style="width:12px;height:12px;"></i> Copiar Conteúdo
                </button>
            </div>
            <div style="background: var(--bg-primary); padding: 16px; border-radius: 8px; line-height: 1.7; border: 1px solid var(--border-subtle);">
                ${highlightTermos(pub.conteudo)}
            </div>
        </div>
        <div style="display:flex; gap:8px; padding-top:16px; border-top:1px solid var(--border-subtle);">
            <button class="btn-card primary" data-action="converterPrazoModal" data-id="${pub.id}">
                <i data-lucide="calendar-plus" style="width:14px;height:14px;"></i> Converter Prazo
            </button>
            <button class="btn-card danger" data-action="excluirModal" data-id="${pub.id}">
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
        const res = await API.post('/api/converter-publicacao', {
            id_publicacao: id,
            tipo,
            dias: parseInt(dias),
            dataCalculada
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
        const res = await API.patch(`/api/publicacoes/${id}/status`, { status: 'descartada' });

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
        s.textContent = `.btn-card.danger, #btnSincronizar { display: none !important; }`;
    }
    document.head.appendChild(s);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('linkIaMenu').addEventListener('click', toggleIaMenu);
    document.getElementById('userCircle').addEventListener('click', toggleUserMenu);
    document.getElementById('linkLogout').addEventListener('click', (e) => { e.preventDefault(); logout(); });
    document.getElementById('btnSincronizar').addEventListener('click', sincronizar);
    document.getElementById('btnFecharModal').addEventListener('click', fecharModal);

    // EVENT DELEGATION — cards e modal (substitui todos os onclick inline, proibidos pela CSP)
    document.getElementById('cardsContainer').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id, 10);
        if (action === 'verDetalhes') verDetalhes(id);
        else if (action === 'converterPrazo') converterPrazo(id);
        else if (action === 'excluir') excluir(id);
    });

    document.getElementById('modalDetalhes').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id, 10);
        if (action === 'copiarConteudo') copiarConteudoModal(btn);
        else if (action === 'converterPrazoModal') { fecharModal(); converterPrazo(id); }
        else if (action === 'excluirModal') { fecharModal(); excluir(id); }
    });
});


(function(){var t=localStorage.getItem('token');if(!t)return;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){return r.json()}).then(function(d){if(d.ok){var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}}).catch(function(){})}checkChat();setInterval(checkChat,30000)})();
