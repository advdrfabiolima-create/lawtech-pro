
// ========== AUTH & GLOBALS ==========
const API = '';
let token = localStorage.getItem('token');
let abaAtual = 'financeiro';
const chartInstances = {};

if (!token) window.location.href = '/login';

// ========== USER INFO ==========
async function carregarInfoRodape() {
    try {
        const resUser = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        const dataUser = await resUser.json();

        if (dataUser.ok) {
            const emailElement = document.getElementById('userEmail');
            if (emailElement) emailElement.innerText = dataUser.usuario.email || 'Não disponível';

            const nomeCompleto = dataUser.usuario.nome || 'Advogado';
            const primeiroNome = nomeCompleto.trim().split(' ')[0];
            const nameHeader = document.getElementById('userNameHeader');
            if (nameHeader) nameHeader.innerText = primeiroNome;

            const partes = nomeCompleto.trim().split(' ').filter(n => n);
            let iniciais = partes[0][0];
            if (partes.length > 1) iniciais += partes[partes.length - 1][0];

            const circulo = document.getElementById('userCircle');
            if (circulo) circulo.innerText = iniciais.toUpperCase();
        }

        const resPlan = await fetch('/api/plano-consumo', { headers: { Authorization: `Bearer ${token}` } });
        const dataPlan = await resPlan.json();

        const planoElement = document.getElementById('planNameFooter');
        if (planoElement) planoElement.innerText = dataPlan.plano || 'Free';
    } catch (err) {
        console.error('Erro ao carregar rodapé:', err);
    }
}

function toggleUserMenu() {
    const d = document.getElementById('userDropdown');
    d.style.display = d.style.display === 'block' ? 'none' : 'block';
}
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
}

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

// Close menu on outside click
document.addEventListener('click', (e) => {
    const menu = document.getElementById('userDropdown');
    const circle = document.getElementById('userCircle');
    if (menu && !menu.contains(e.target) && e.target !== circle) menu.style.display = 'none';
});

// ========== PERIODO ==========
function onPeriodoChange() {
    const v = document.getElementById('selectPeriodo').value;
    document.getElementById('dateCustom').classList.toggle('visible', v === 'custom');
}

function getPeriodoParams() {
    const periodo = document.getElementById('selectPeriodo').value;
    let params = `periodo=${periodo}`;
    if (periodo === 'custom') {
        const ini = document.getElementById('dataInicio').value;
        const fim = document.getElementById('dataFim').value;
        if (ini) params += `&inicio=${ini}`;
        if (fim) params += `&fim=${fim}`;
    }
    return params;
}

// ========== TABS ==========
function trocarAba(aba, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${aba}`).classList.add('active');
    abaAtual = aba;
    carregarRelatorio();
}

// ========== FETCH HELPER ==========
async function fetchRelatorio(endpoint) {
    const params = getPeriodoParams();
    const res = await fetch(`${API}/api/relatorios/${endpoint}?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
}

// ========== CHART HELPERS ==========
const CORES = ['#4A90E2', '#52B788', '#E76F51', '#F2A65A', '#7E8CE0', '#F4D06F', '#e879f9', '#38bdf8', '#fb923c', '#a78bfa'];

function destroyChart(id) {
    if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

function criarChart(containerId, id, type, data, options = {}) {
    const container = document.getElementById(containerId);
    const card = document.createElement('div');
    card.className = 'chart-card';
    card.innerHTML = `<h3>${options.titulo || ''}</h3><canvas id="${id}"></canvas>`;
    container.appendChild(card);

    destroyChart(id);
    const ctx = card.querySelector('canvas').getContext('2d');
    chartInstances[id] = new Chart(ctx, {
        type,
        data,
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: options.legendPos || 'top', labels: { font: { family: 'Outfit', size: 12 } } }
            },
            scales: type === 'pie' || type === 'doughnut' ? {} : {
                y: { beginAtZero: true, ticks: { font: { family: 'Outfit', size: 11 } } },
                x: { ticks: { font: { family: 'Outfit', size: 11 } } }
            },
            indexAxis: options.horizontal ? 'y' : 'x',
            ...options.extra
        }
    });
}

function formatMoney(v) {
    return parseFloat(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatNum(v) {
    return parseInt(v || 0).toLocaleString('pt-BR');
}

function showLoading(summaryId, chartsId) {
    document.getElementById(summaryId).innerHTML = '';
    document.getElementById(chartsId).innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Carregando dados...</div>';
}

function showEmpty(chartsId, msg) {
    document.getElementById(chartsId).innerHTML = `<div class="empty-state"><i class="lucide lucide-inbox"></i><p>${msg || 'Nenhum dado encontrado para o período selecionado.'}</p></div>`;
}

function renderSummaryCards(containerId, cards) {
    const el = document.getElementById(containerId);
    el.innerHTML = cards.map(c => `
        <div class="summary-card">
            <div class="label">${c.label}</div>
            <div class="value ${c.color || ''}">${c.value}</div>
        </div>
    `).join('');
}

// ========== RENDER: FINANCEIRO ==========
async function renderFinanceiro() {
    showLoading('summary-financeiro', 'charts-financeiro');
    try {
        const data = await fetchRelatorio('financeiro');
        if (!data.ok) throw new Error(data.erro);
        const t = data.totais;
        const saldo = parseFloat(t.recebido) - parseFloat(t.pago);

        renderSummaryCards('summary-financeiro', [
            { label: 'Recebido', value: formatMoney(t.recebido), color: 'green' },
            { label: 'A Receber', value: formatMoney(t.a_receber), color: 'blue' },
            { label: 'Pago', value: formatMoney(t.pago), color: 'red' },
            { label: 'Saldo', value: formatMoney(saldo), color: saldo >= 0 ? 'green' : 'red' }
        ]);

        document.getElementById('charts-financeiro').innerHTML = '';

        // Bar: receitas vs despesas mensal
        if (data.mensal.length) {
            criarChart('charts-financeiro', 'chart-fin-mensal', 'bar', {
                labels: data.mensal.map(m => m.mes),
                datasets: [
                    { label: 'Receitas', data: data.mensal.map(m => parseFloat(m.receitas)), backgroundColor: '#52B788' },
                    { label: 'Despesas', data: data.mensal.map(m => parseFloat(m.despesas)), backgroundColor: '#E76F51' }
                ]
            }, { titulo: 'Receitas vs Despesas (Mensal)' });
        }

        // Doughnut: recebido vs pendente
        criarChart('charts-financeiro', 'chart-fin-status', 'doughnut', {
            labels: ['Recebido', 'A Receber', 'Pago', 'A Pagar'],
            datasets: [{ data: [t.recebido, t.a_receber, t.pago, t.a_pagar].map(Number), backgroundColor: ['#52B788', '#4A90E2', '#E76F51', '#F2A65A'] }]
        }, { titulo: 'Distribuição por Status' });

        // Horizontal bar: top categorias
        if (data.categorias.length) {
            criarChart('charts-financeiro', 'chart-fin-cat', 'bar', {
                labels: data.categorias.map(c => c.categoria ? (c.categoria.length > 25 ? c.categoria.substring(0, 25) + '...' : c.categoria) : 'Sem desc.'),
                datasets: [{ label: 'Valor Total', data: data.categorias.map(c => parseFloat(c.total)), backgroundColor: data.categorias.map((_, i) => CORES[i % CORES.length]) }]
            }, { titulo: 'Top Categorias', horizontal: true });
        }
    } catch (e) {
        console.error('Erro financeiro:', e);
        showEmpty('charts-financeiro', 'Erro ao carregar dados financeiros.');
    }
}

// ========== RENDER: PRAZOS ==========
async function renderPrazos() {
    showLoading('summary-prazos', 'charts-prazos');
    try {
        const data = await fetchRelatorio('prazos');
        if (!data.ok) throw new Error(data.erro);
        const c = data.cumprimento;
        const taxa = c.total > 0 ? ((parseInt(c.concluidos) / parseInt(c.total)) * 100).toFixed(1) : '0.0';

        renderSummaryCards('summary-prazos', [
            { label: 'Total de Prazos', value: formatNum(c.total), color: 'blue' },
            { label: 'Concluídos', value: formatNum(c.concluidos), color: 'green' },
            { label: 'Atrasados', value: formatNum(c.atrasados), color: 'red' },
            { label: 'Taxa Cumprimento', value: `${taxa}%`, color: parseFloat(taxa) >= 70 ? 'green' : 'orange' }
        ]);

        document.getElementById('charts-prazos').innerHTML = '';

        // Doughnut: status
        criarChart('charts-prazos', 'chart-prazos-status', 'doughnut', {
            labels: ['Concluídos', 'Atrasados', 'Abertos'],
            datasets: [{ data: [c.concluidos, c.atrasados, c.abertos].map(Number), backgroundColor: ['#52B788', '#E76F51', '#4A90E2'] }]
        }, { titulo: 'Distribuição por Status' });

        // Bar: por tipo
        if (data.porTipo.length) {
            criarChart('charts-prazos', 'chart-prazos-tipo', 'bar', {
                labels: data.porTipo.map(t => t.tipo),
                datasets: [{ label: 'Quantidade', data: data.porTipo.map(t => parseInt(t.total)), backgroundColor: data.porTipo.map((_, i) => CORES[i % CORES.length]) }]
            }, { titulo: 'Por Tipo de Prazo' });
        }

        // Line: evolução mensal
        if (data.evolucao.length) {
            criarChart('charts-prazos', 'chart-prazos-evolucao', 'line', {
                labels: data.evolucao.map(e => e.mes),
                datasets: [
                    { label: 'Concluídos', data: data.evolucao.map(e => parseInt(e.concluidos)), borderColor: '#52B788', backgroundColor: 'rgba(82,183,136,0.1)', fill: true, tension: 0.3 },
                    { label: 'Atrasados', data: data.evolucao.map(e => parseInt(e.atrasados)), borderColor: '#E76F51', backgroundColor: 'rgba(231,111,81,0.1)', fill: true, tension: 0.3 },
                    { label: 'Abertos', data: data.evolucao.map(e => parseInt(e.abertos)), borderColor: '#4A90E2', backgroundColor: 'rgba(74,144,226,0.1)', fill: true, tension: 0.3 }
                ]
            }, { titulo: 'Evolução Mensal' });
        }
    } catch (e) {
        console.error('Erro prazos:', e);
        showEmpty('charts-prazos', 'Erro ao carregar dados de prazos.');
    }
}

// ========== RENDER: PROCESSOS ==========
async function renderProcessos() {
    showLoading('summary-processos', 'charts-processos');
    try {
        const data = await fetchRelatorio('processos');
        if (!data.ok) throw new Error(data.erro);

        const totalTribunais = data.porTribunal.length;
        const totalEsferas = data.porEsfera.length;
        const totalUfs = data.porUf.length;

        renderSummaryCards('summary-processos', [
            { label: 'Total de Processos', value: formatNum(data.total), color: 'blue' },
            { label: 'Tribunais', value: formatNum(totalTribunais), color: 'purple' },
            { label: 'Esferas', value: formatNum(totalEsferas), color: 'orange' },
            { label: 'Estados', value: formatNum(totalUfs), color: 'green' }
        ]);

        document.getElementById('charts-processos').innerHTML = '';

        // Horizontal bar: por tribunal
        if (data.porTribunal.length) {
            criarChart('charts-processos', 'chart-proc-tribunal', 'bar', {
                labels: data.porTribunal.map(t => t.tribunal.length > 30 ? t.tribunal.substring(0, 30) + '...' : t.tribunal),
                datasets: [{ label: 'Processos', data: data.porTribunal.map(t => parseInt(t.total)), backgroundColor: CORES.slice(0, data.porTribunal.length) }]
            }, { titulo: 'Por Tribunal', horizontal: true });
        }

        // Pie: por esfera
        if (data.porEsfera.length) {
            criarChart('charts-processos', 'chart-proc-esfera', 'pie', {
                labels: data.porEsfera.map(e => e.esfera),
                datasets: [{ data: data.porEsfera.map(e => parseInt(e.total)), backgroundColor: CORES.slice(0, data.porEsfera.length) }]
            }, { titulo: 'Por Esfera' });
        }

        // Bar: por UF
        if (data.porUf.length) {
            criarChart('charts-processos', 'chart-proc-uf', 'bar', {
                labels: data.porUf.map(u => u.uf),
                datasets: [{ label: 'Processos', data: data.porUf.map(u => parseInt(u.total)), backgroundColor: '#4A90E2' }]
            }, { titulo: 'Por Estado (UF)' });
        }
    } catch (e) {
        console.error('Erro processos:', e);
        showEmpty('charts-processos', 'Erro ao carregar dados de processos.');
    }
}

// ========== RENDER: PRODUTIVIDADE ==========
async function renderProdutividade() {
    showLoading('summary-produtividade', 'charts-produtividade');
    try {
        const data = await fetchRelatorio('produtividade');
        if (!data.ok) throw new Error(data.erro);

        const totalPrazos = data.prazosPorUsuario.reduce((s, u) => s + parseInt(u.total), 0);
        const totalConcluidos = data.prazosPorUsuario.reduce((s, u) => s + parseInt(u.concluidos), 0);
        const totalAudiencias = data.audienciasPorUsuario.reduce((s, u) => s + parseInt(u.total), 0);
        const topUsuario = data.prazosPorUsuario.length ? data.prazosPorUsuario[0].usuario : 'N/A';

        renderSummaryCards('summary-produtividade', [
            { label: 'Total Prazos', value: formatNum(totalPrazos), color: 'blue' },
            { label: 'Prazos Concluídos', value: formatNum(totalConcluidos), color: 'green' },
            { label: 'Audiências', value: formatNum(totalAudiencias), color: 'purple' },
            { label: 'Top Colaborador', value: topUsuario, color: '' }
        ]);

        document.getElementById('charts-produtividade').innerHTML = '';

        // Horizontal bar: prazos por usuário
        if (data.prazosPorUsuario.length) {
            criarChart('charts-produtividade', 'chart-prod-prazos', 'bar', {
                labels: data.prazosPorUsuario.map(u => u.usuario),
                datasets: [
                    { label: 'Concluídos', data: data.prazosPorUsuario.map(u => parseInt(u.concluidos)), backgroundColor: '#52B788' },
                    { label: 'Atrasados', data: data.prazosPorUsuario.map(u => parseInt(u.atrasados)), backgroundColor: '#E76F51' },
                    { label: 'Total', data: data.prazosPorUsuario.map(u => parseInt(u.total)), backgroundColor: '#4A90E2' }
                ]
            }, { titulo: 'Prazos por Colaborador', horizontal: true });
        }

        // Bar: audiências por usuário
        if (data.audienciasPorUsuario.length) {
            criarChart('charts-produtividade', 'chart-prod-audiencias', 'bar', {
                labels: data.audienciasPorUsuario.map(u => u.usuario),
                datasets: [{ label: 'Audiências', data: data.audienciasPorUsuario.map(u => parseInt(u.total)), backgroundColor: '#7E8CE0' }]
            }, { titulo: 'Audiências por Colaborador' });
        }
    } catch (e) {
        console.error('Erro produtividade:', e);
        showEmpty('charts-produtividade', 'Erro ao carregar dados de produtividade.');
    }
}

// ========== RENDER: CRM ==========
async function renderCRM() {
    showLoading('summary-crm', 'charts-crm');
    try {
        const data = await fetchRelatorio('crm');
        if (!data.ok) throw new Error(data.erro);

        const totalLeads = parseInt(data.conversao.total) || 0;
        const ganhos = parseInt(data.conversao.ganhos) || 0;
        const taxa = totalLeads > 0 ? ((ganhos / totalLeads) * 100).toFixed(1) : '0.0';
        const totalOrigens = data.porOrigem.length;

        renderSummaryCards('summary-crm', [
            { label: 'Total de Leads', value: formatNum(totalLeads), color: 'blue' },
            { label: 'Convertidos', value: formatNum(ganhos), color: 'green' },
            { label: 'Taxa Conversão', value: `${taxa}%`, color: parseFloat(taxa) >= 20 ? 'green' : 'orange' },
            { label: 'Origens', value: formatNum(totalOrigens), color: 'purple' }
        ]);

        document.getElementById('charts-crm').innerHTML = '';

        // Bar: funil
        if (data.funil.length) {
            criarChart('charts-crm', 'chart-crm-funil', 'bar', {
                labels: data.funil.map(f => f.status),
                datasets: [{ label: 'Leads', data: data.funil.map(f => parseInt(f.total)), backgroundColor: data.funil.map((_, i) => CORES[i % CORES.length]) }]
            }, { titulo: 'Funil de Vendas' });
        }

        // Pie: por origem
        if (data.porOrigem.length) {
            criarChart('charts-crm', 'chart-crm-origem', 'pie', {
                labels: data.porOrigem.map(o => o.origem),
                datasets: [{ data: data.porOrigem.map(o => parseInt(o.total)), backgroundColor: CORES.slice(0, data.porOrigem.length) }]
            }, { titulo: 'Leads por Origem' });
        }

        // Line: evolução mensal
        if (data.evolucao.length) {
            criarChart('charts-crm', 'chart-crm-evolucao', 'line', {
                labels: data.evolucao.map(e => e.mes),
                datasets: [
                    { label: 'Total Leads', data: data.evolucao.map(e => parseInt(e.total)), borderColor: '#4A90E2', backgroundColor: 'rgba(74,144,226,0.1)', fill: true, tension: 0.3 },
                    { label: 'Convertidos', data: data.evolucao.map(e => parseInt(e.ganhos)), borderColor: '#52B788', backgroundColor: 'rgba(82,183,136,0.1)', fill: true, tension: 0.3 }
                ]
            }, { titulo: 'Evolução Mensal de Leads' });
        }
    } catch (e) {
        console.error('Erro CRM:', e);
        showEmpty('charts-crm', 'Erro ao carregar dados do CRM.');
    }
}

// ========== CARREGAR ==========
function carregarRelatorio() {
    switch (abaAtual) {
        case 'financeiro': renderFinanceiro(); break;
        case 'prazos': renderPrazos(); break;
        case 'processos': renderProcessos(); break;
        case 'produtividade': renderProdutividade(); break;
        case 'crm': renderCRM(); break;
    }
}

// ========== EXPORTAR PDF ==========
async function exportarPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('LawTech Pro - Relatório', pageW / 2, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    const abaLabel = abaAtual.charAt(0).toUpperCase() + abaAtual.slice(1);
    doc.text(`Aba: ${abaLabel}  |  Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, pageW / 2, 30, { align: 'center' });

    let yPos = 45;

    // Render summary cards text
    const summaryEl = document.getElementById(`summary-${abaAtual}`);
    const cards = summaryEl.querySelectorAll('.summary-card');
    cards.forEach(card => {
        const label = card.querySelector('.label').textContent;
        const value = card.querySelector('.value').textContent;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(`${label}: `, 15, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(value, 60, yPos);
        yPos += 7;
    });

    yPos += 5;

    // Render charts as images
    const canvases = document.querySelectorAll(`#charts-${abaAtual} canvas`);
    for (const canvas of canvases) {
        if (yPos > 240) { doc.addPage(); yPos = 20; }
        const imgData = canvas.toDataURL('image/png');
        const ratio = canvas.width / canvas.height;
        const imgW = pageW - 30;
        const imgH = imgW / ratio;
        doc.addImage(imgData, 'PNG', 15, yPos, imgW, Math.min(imgH, 120));
        yPos += Math.min(imgH, 120) + 10;
    }

    doc.save(`relatorio-${abaAtual}-${new Date().toISOString().split('T')[0]}.pdf`);
}

// ========== EXPORTAR CSV ==========
function exportarCSV() {
    let csvContent = '\uFEFF'; // BOM UTF-8 for Excel

    const summaryEl = document.getElementById(`summary-${abaAtual}`);
    const cards = summaryEl.querySelectorAll('.summary-card');

    const abaLabel = abaAtual.charAt(0).toUpperCase() + abaAtual.slice(1);
    csvContent += `Relatório ${abaLabel} - LawTech Pro\n`;
    csvContent += `Gerado em: ${new Date().toLocaleDateString('pt-BR')}\n\n`;
    csvContent += 'Indicador,Valor\n';

    cards.forEach(card => {
        const label = card.querySelector('.label').textContent.replace(/,/g, '');
        const value = card.querySelector('.value').textContent.replace(/,/g, '.');
        csvContent += `"${label}","${value}"\n`;
    });

    // Add chart data tables
    csvContent += '\n';
    for (const [key, chart] of Object.entries(chartInstances)) {
        if (!key.startsWith(`chart-${abaAtual.substring(0, 3)}`)) continue;
        const labels = chart.data.labels || [];
        const datasets = chart.data.datasets || [];

        csvContent += `\n${chart.options?.plugins?.title?.text || key}\n`;
        csvContent += `Rótulo,${datasets.map(d => d.label || 'Valor').join(',')}\n`;
        labels.forEach((label, i) => {
            const values = datasets.map(d => d.data[i] || 0);
            csvContent += `"${label}",${values.join(',')}\n`;
        });
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-${abaAtual}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
    carregarInfoRodape();
    carregarRelatorio();
    lucide.createIcons();
});


(function(){var t=localStorage.getItem('token');if(!t)return;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){return r.json()}).then(function(d){if(d.ok){var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}}).catch(function(){})}checkChat();setInterval(checkChat,30000)})();
