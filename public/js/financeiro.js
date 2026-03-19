if (!API.getToken()) window.location.href = '/login.html';
        const token = API.getToken();
        
        let originalData = [];
        let financeChart;
        let lancamentoParaCobrar = null;
        let clientesCadastrados = []; // Lista de clientes para o select

        // --- INICIALIZAÇÃO ÚNICA ---
        document.addEventListener('DOMContentLoaded', async () => {
            console.log('📄 DOM carregado');

            // Mover modalLogo para o body raiz — evita stacking context do sidebar
            (function() {
                var el = document.getElementById('modalLogo');
                if (el && el.parentNode !== document.body) {
                    document.body.appendChild(el);
                }
            })();

            setTimeout(async () => {
                await inicializar();
                await carregarClientesParaBoleto();
                await carregarClientesParaRecibo(); // Nova função
                await carregarSaldoReal();
                await carregarLogoAtual();
                await carregarAssinaturaAtual();
                await carregarClientesParaLancamento();
            }, 100);

            // Listener especial para toggleIaMenu (precisa do Event original)
            const lia = document.getElementById('linkIaMenu');
            if (lia) lia.addEventListener('click', toggleIaMenu);

            // Listeners para selects estáticos (onchange removidos do HTML)
            const addTipoEl = document.getElementById('addTipo');
            if (addTipoEl) addTipoEl.addEventListener('change', function() { toggleParteAdicionar(); });

            const editTipoEl = document.getElementById('editTipo');
            if (editTipoEl) editTipoEl.addEventListener('change', function() { toggleParteEditar(); });

            const reciboClienteSelectEl = document.getElementById('reciboClienteSelect');
            if (reciboClienteSelectEl) reciboClienteSelectEl.addEventListener('change', function() { preencherDadosCliente(); });

            const relatorioTipoEl = document.getElementById('relatorioTipo');
            if (relatorioTipoEl) relatorioTipoEl.addEventListener('change', function() { atualizarCamposPeriodo(); });

            // Listeners para inputs de arquivo (onchange removidos do HTML)
            const logoInputEl = document.getElementById('logoInput');
            if (logoInputEl) logoInputEl.addEventListener('change', function() { uploadLogo(); });

            const assinaturaInputEl = document.getElementById('assinaturaInput');
            if (assinaturaInputEl) assinaturaInputEl.addEventListener('change', function() { uploadAssinatura(); });
        });

        ['modalRelatorioFaturamento', 'modalVisualizacaoRelatorio'].forEach(id => {
    const el = document.getElementById(id);
    if (el) document.body.appendChild(el);
});

// window.onload removido

async function inicializar() {
    try {
        console.log('🔄 Inicializando página financeira...');
        
        const resU = await API.get('/api/auth/me');
        const du = await resU.json(); 
        
        if(du.ok) {
            const emailElement = document.getElementById('userEmail');
            if (emailElement) {
                emailElement.innerText = du.usuario.email || 'Não disponível';
                console.log('✅ Email atualizado:', du.usuario.email);
            }

            const nomeCompleto = du.usuario.nome || 'Advogado';
            const primeiroNome = nomeCompleto.trim().split(' ')[0];
            const nameHeader = document.getElementById('userNameHeader');
            if (nameHeader) nameHeader.innerText = primeiroNome;

            const partes = nomeCompleto.trim().split(' ').filter(n => n);
            let iniciais = partes[0][0];
            if (partes.length > 1) {
                iniciais += partes[partes.length - 1][0];
            }
            
            const circulo = document.getElementById('userCircle');
            if (circulo) circulo.innerText = iniciais.toUpperCase();
            window._userRole = du.usuario.role || 'visualizador';
            aplicarPermissoesRoleUI(window._userRole);
        }

        const resP = await API.get('/api/plano-consumo');
        const dp = await resP.json();
        
        const planoElement = document.getElementById('planNameFooter');
        if (planoElement) {
            planoElement.innerText = dp.plano || 'Free';
            console.log('✅ Plano atualizado:', dp.plano);
        }

        await carregarDados();
    } catch (e) { 
        console.error("❌ Erro na inicialização financeira:", e); 
    }
}

        async function carregarDados() {
            if (!window._finMes) {
                window._finMes = new Date().getMonth() + 1;
                window._finAno = new Date().getFullYear();
            }
            const _m = window._finMes;
            const _a = window._finAno;
            const _MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                            'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
            const label = document.getElementById('mesNavLabel');
            if (label) {
                const hoje = new Date();
                const eHoje = _m === (hoje.getMonth()+1) && _a === hoje.getFullYear();
                label.textContent = _MESES[_m-1] + ' de ' + _a + (eHoje ? ' ✦' : '');
            }
            const res = await API.get('/api/financeiro?limit=200&mes=' + _m + '&ano=' + _a);
            const resp = await res.json();
            originalData = resp.data || resp;
            if (!originalData || originalData.length === 0) {
                document.getElementById('corpoTabela').innerHTML =
                    '<tr><td colspan="8" style="text-align:center;padding:48px 20px;color:#94a3b8;">' +
                    '<div style="font-size:36px;margin-bottom:12px;opacity:.4;">📭</div>' +
                    'Nenhum lançamento em <strong>' + _MESES[_m-1] + ' de ' + _a + '</strong>' +
                    '</td></tr>';
                ['totalReceitas','totalDespesas','totalAReceber','totalAPagar'].forEach(function(id) {
                    var el = document.getElementById(id); if (el) el.innerText = 'R$ 0';
                });
                var saldo = document.getElementById('saldoTotal');
                if (saldo) saldo.innerText = 'R$ 0,00';
                document.getElementById('listaCobrancaRapida').innerHTML = '';
                return;
            }
            renderizar(originalData);
        }

        function renderizar(lista) {
    const corpo = document.getElementById('corpoTabela');
    const listaCobranca = document.getElementById('listaCobrancaRapida');
    
    corpo.innerHTML = '';
    listaCobranca.innerHTML = '';
    let liqR = 0, liqD = 0, pendR = 0, pendD = 0;
    let countReceitasPagas = 0;

    lista.forEach(item => {
        const v = parseFloat(item.valor);
        const isR = item.tipo === 'Receita';
        const isP = item.status === 'Pago';

        if (isP) { 
            if (isR) { liqR += v; countReceitasPagas++; } else liqD += v; 
        } else { 
            if (isR) pendR += v; else pendD += v; 
        }

        if (!isP && isR) {
            listaCobranca.innerHTML += `
                <div class="billing-item">
                    <div>
                        <div style="font-size:11px; font-weight:700; color:var(--text-main);">${item.descricao}</div>
                        <div style="font-size:12px; font-weight:800; color:var(--success); margin: 2px 0;">
                            R$ ${v.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                        </div>
                        <div style="font-size:10px; color:var(--danger); font-weight:600;">
                            Vence: ${new Date(item.data_vencimento).toLocaleDateString('pt-BR')}
                        </div>
                    </div>
                    <button class="btn-mini-boleto" data-action="prepararBoleto" data-args='[${item.id}, ${JSON.stringify(item.descricao)}, ${v}]'>
                        <i data-lucide="barcode"></i> BOLETO
                    </button>
                </div>`;
        }

        const btnPagar = !isP ? `<button data-action="marcarComoPago" data-args='[${item.id}]' style="background: var(--accent-green); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s; margin-right: 6px;" title="Marcar como Pago"><i data-lucide="check" style="width:14px; height:14px;"></i></button>` : '';
        const btnRecibo = (isP && item.tipo === 'Receita') ? `<button data-action="prepararRecibo" data-args='[${item.id}]' style="background: var(--accent-purple); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s; margin-right: 6px;" title="Emitir Recibo"><i data-lucide="file-text" style="width:14px; height:14px;"></i></button>` : '';
        const btnEditar = `<button data-action="editarLancamento" data-args='[${item.id}]' style="background: var(--accent-blue); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s; margin-right: 6px;" title="Editar"><i data-lucide="pencil" style="width:14px; height:14px;"></i></button>`;
        const btnExcluir = `<button data-action="deletar" data-args='[${item.id}]' style="background: var(--accent-red); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s;" title="Excluir"><i data-lucide="trash-2" style="width:14px; height:14px;"></i></button>`;

        const clienteLabel = (item.tipo === 'Receita' && item.cliente_nome)
            ? `<span style="font-size:11px;color:var(--text-main);font-weight:600;">${item.cliente_nome}</span>`
            : `<span style="font-size:11px;color:var(--muted);font-style:italic;">—</span>`;

        // Label da coluna Beneficiário (só Despesas)
        const beneficiarioLabel = (item.tipo === 'Despesa' && item.beneficiario)
            ? `<span style="font-size:11px;color:var(--text-main);font-weight:600;">${item.beneficiario}</span>`
            : `<span style="font-size:11px;color:var(--muted);font-style:italic;">—</span>`;

        const formaPagamentoLabel = item.forma_pagamento
            ? `<span style="font-size:11px;font-weight:700;color:var(--text-main);white-space:nowrap;">${item.forma_pagamento}</span>`
            : `<span style="font-size:11px;color:var(--muted);font-style:italic;">—</span>`;

        corpo.innerHTML += `
            <tr>
                <td><strong>${item.descricao}</strong></td>
                <td>${clienteLabel}</td>
                <td>${beneficiarioLabel}</td>
                <td><strong style="color:${isR ? 'var(--success)' : 'var(--danger)'}">R$ ${v.toLocaleString('pt-BR', {minimumFractionDigits:2})}</strong></td>
                <td>${new Date(item.data_vencimento).toLocaleDateString('pt-BR')}</td>
                <td><span style="font-weight:700;font-size:11px;color:${isP ? 'var(--success)' : 'var(--warning)'}">${item.status.toUpperCase()}</span></td>
                <td>${formaPagamentoLabel}</td>
                <td style="text-align:center;white-space:nowrap;">
                    ${btnPagar} ${btnRecibo} ${btnEditar} ${btnExcluir}
                </td>
            </tr>`;
    });

    if (window.lucide) {
        lucide.createIcons();
    }

    document.getElementById('totalReceitas').innerText = `R$ ${liqR.toLocaleString('pt-BR')}`;
    document.getElementById('totalDespesas').innerText = `R$ ${liqD.toLocaleString('pt-BR')}`;
    document.getElementById('totalAReceber').innerText = `R$ ${pendR.toLocaleString('pt-BR')}`;
    document.getElementById('totalAPagar').innerText = `R$ ${pendD.toLocaleString('pt-BR')}`;
    document.getElementById('saldoTotal').innerText = `R$ ${(liqR - liqD).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    
    atualizarGrafico(liqR, liqD, pendR, pendD);

const totalReceitasContagem = lista.filter(i => i.tipo === 'Receita' && i.status === 'Pago').length;
const ticketMedio = totalReceitasContagem > 0 ? (liqR / totalReceitasContagem) : 0;

const totalEsperado = liqR + pendR;
const inadimplencia = totalEsperado > 0 ? (pendR / totalEsperado) * 100 : 0;

const margem = liqR > 0 ? ((liqR - liqD) / liqR) * 100 : 0;

document.getElementById('kpi-ticket').innerText = `R$ ${ticketMedio.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
document.getElementById('kpi-inadimplencia').innerText = `${inadimplencia.toFixed(1)}%`;
document.getElementById('kpi-margem').innerText = `${margem.toFixed(1)}%`;

carregarSaldoReal();
}

        // --- FUNÇÕES DE NEGÓCIO ---
        function abrirModalLancamento() { document.getElementById('modalNovoLancamento').style.display = 'flex'; }
        function fecharModalLancamento() { document.getElementById('modalNovoLancamento').style.display = 'none'; }

async function salvarLancamento() {
    const descricao      = document.getElementById('addDescricao').value;
    const valorComMascara = document.getElementById('addValor').value;
    const tipo           = document.getElementById('addTipo').value;
    const data_vencimento = document.getElementById('addData').value;
    const cliente_id     = document.getElementById('addCliente')?.value || null;
    const beneficiario   = document.getElementById('addBeneficiario')?.value.trim() || null; // NOVO

    if (!descricao || !valorComMascara || !data_vencimento) return alert('Preencha todos os campos!');

    const valorNumerico = parseFloat(
        valorComMascara.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()
    );
    const dados = { descricao, valor: valorNumerico, tipo, data_vencimento, cliente_id, beneficiario };

    try {
        const res = await fetch('/api/financeiro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(dados)
        });
        if (res.ok) { alert('Lançamento salvo!'); fecharModalLancamento(); location.reload(); }
        else { const erro = await res.json(); alert('Erro: ' + erro.erro); }
    } catch (err) { alert('Erro de conexão com o servidor.'); }
}

async function marcarComoPago(id) {
    const overlay = document.createElement('div');
    overlay.id = 'overlayMarcarPago';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);';
    overlay.innerHTML = `
        <div style="background:var(--bg-card,#fff);border-radius:16px;padding:32px 28px;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.25);">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
                <div style="background:#d1fae5;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i data-lucide="check-circle" style="width:22px;height:22px;color:#16a34a;"></i>
                </div>
                <div>
                    <div style="font-weight:800;font-size:15px;color:var(--text-main,#0f172a);">Confirmar Pagamento</div>
                    <div style="font-size:12px;color:var(--muted,#64748b);margin-top:2px;">Registre como o pagamento foi realizado</div>
                </div>
            </div>
            <div style="margin-bottom:20px;">
                <label style="font-size:11px;font-weight:700;color:var(--muted,#64748b);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:8px;">FORMA DE PAGAMENTO</label>
                <select id="formaPagamentoConfirm" style="width:100%;padding:10px 14px;border:1px solid var(--border-medium,#e2e8f0);border-radius:8px;font-size:13px;font-weight:600;background:var(--bg-card,#fff);color:var(--text-main,#0f172a);cursor:pointer;">
                    <option value="">— Não informar —</option>
                    <option value="Dinheiro">Dinheiro</option>
                    <option value="PIX">PIX</option>
                    <option value="Transferência">Transferência</option>
                    <option value="Cartão de Crédito">Cartão de Crédito</option>
                    <option value="Cartão de Débito">Cartão de Débito</option>
                    <option value="Boleto">Boleto</option>
                    <option value="Cheque">Cheque</option>
                </select>
            </div>
            <div style="display:flex;gap:10px;">
                <button id="btnCancelarPago" style="flex:1;padding:12px;border-radius:8px;background:var(--bg,#f1f5f9);border:none;font-weight:700;font-size:13px;cursor:pointer;color:var(--text-main,#0f172a);">Cancelar</button>
                <button id="btnConfirmarPago" style="flex:2;padding:12px;border-radius:8px;background:#10b981;border:none;font-weight:800;font-size:13px;cursor:pointer;color:#fff;display:flex;align-items:center;justify-content:center;gap:6px;">
                    <i data-lucide="check" style="width:16px;height:16px;"></i> Marcar como Pago
                </button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    if (window.lucide) lucide.createIcons();

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('btnCancelarPago').addEventListener('click', () => overlay.remove());
    document.getElementById('btnConfirmarPago').addEventListener('click', async () => {
        const forma_pagamento = document.getElementById('formaPagamentoConfirm').value || null;
        const btn = document.getElementById('btnConfirmarPago');
        btn.innerHTML = 'Salvando...';
        btn.disabled = true;
        const res = await fetch(`/api/financeiro/${id}/pagar`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ forma_pagamento })
        });
        overlay.remove();
        if (res.ok) carregarDados();
        else alert('Erro ao marcar como pago.');
    });
}

        async function deletar(id) {
            if(confirm('Deseja excluir?')) {
                const res = await fetch(`/api/financeiro/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
                if(res.ok) carregarDados();
            }
        }

function editarLancamento(id) {
    const item = originalData.find(i => i.id === id);
    if (!item) return;

    document.getElementById('editId').value        = item.id;
    document.getElementById('editDescricao').value  = item.descricao;
    document.getElementById('editValor').value      = item.valor;
    document.getElementById('editTipo').value       = item.tipo;

    const dataFormatada = new Date(item.data_vencimento).toISOString().split('T')[0];
    document.getElementById('editData').value = dataFormatada;

    const editFormaPagamento = document.getElementById('editFormaPagamento');
    if (editFormaPagamento) editFormaPagamento.value = item.forma_pagamento || '';

    // Dispara a lógica de exibição dos campos de parte (cliente vs beneficiário)
    toggleParteEditar(item.tipo);

    if (item.tipo === 'Receita') {
        const editCliente = document.getElementById('editCliente');
        if (editCliente) editCliente.value = item.cliente_id || '';
    } else {
        const editBeneficiario = document.getElementById('editBeneficiario');
        if (editBeneficiario) editBeneficiario.value = item.beneficiario || '';
    }

    document.getElementById('modalEditarLancamento').style.display = 'flex';
}

async function atualizarLancamento() {
    const id             = document.getElementById('editId').value;
    const tipo           = document.getElementById('editTipo').value;
    const cliente_id     = document.getElementById('editCliente')?.value || null;
    const beneficiario   = document.getElementById('editBeneficiario')?.value.trim() || null;
    const forma_pagamento = document.getElementById('editFormaPagamento')?.value || null;

    const dados = {
        descricao:       document.getElementById('editDescricao').value,
        valor:           document.getElementById('editValor').value,
        tipo,
        data_vencimento: document.getElementById('editData').value,
        cliente_id,
        beneficiario,
        forma_pagamento
    };
    try {
        const res = await fetch(`/api/financeiro/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(dados)
        });
        if (res.ok) { document.getElementById('modalEditarLancamento').style.display = 'none'; carregarDados(); }
        else { alert('Erro ao atualizar lançamento.'); }
    } catch (err) { console.error(err); alert('Erro de conexão.'); }
}

        function prepararBoleto(id, desc, valor) {
            lancamentoParaCobrar = { id, desc, valor };
            document.getElementById('cobrancaResumo').innerHTML = `
                <div style="background:var(--bg); padding:15px; border-radius:8px; border-left:4px solid var(--primary);">
                    <p><strong>Honorários:</strong> ${desc}</p>
                    <p><strong>Valor a Receber:</strong> R$ ${valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                </div>
                <p style="margin-top:10px; font-size:12px; color:var(--muted);">
                    * O valor será creditado na conta bancária configurada no seu perfil.
                </p>
            `;
            document.getElementById('modalCobranca').style.display = 'flex';
        }

        async function validarClienteParaBoleto(clienteId) {
    try {
        const res = await fetch(`/api/clientes/${clienteId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const cliente = await res.json();
        
        if (!cliente.documento || cliente.documento.replace(/\D/g, '').length < 11) {
            alert("⚠️ Este cliente não possui CPF/CNPJ cadastrado.\n\nEdite o cliente e adicione o documento antes de gerar boleto.");
            return false;
        }
        
        return true;
    } catch (err) {
        console.error("Erro ao validar cliente:", err);
        return true; // Permite continuar em caso de erro na validação
    }
}
async function carregarClientesParaLancamento() {
    try {
        const res = await fetch('/api/clientes?limit=200', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('Erro');
        const r = await res.json();
        const clientes = r.data || r;
        const opcoes = '<option value="">Nenhum (sem cliente)</option>' +
            clientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
        const s1 = document.getElementById('addCliente');
        const s2 = document.getElementById('editCliente');
        if (s1) s1.innerHTML = opcoes;
        if (s2) s2.innerHTML = opcoes;
    } catch (err) { console.error('Erro ao carregar clientes para lancamento:', err); }
}

function toggleParteAdicionar() {
    const tipo = document.getElementById('addTipo').value;
    const secaoCliente      = document.getElementById('addSecaoCliente');
    const secaoBeneficiario = document.getElementById('addSecaoBeneficiario');
    if (tipo === 'Receita') {
        if (secaoCliente)      secaoCliente.style.display      = 'block';
        if (secaoBeneficiario) secaoBeneficiario.style.display = 'none';
    } else {
        if (secaoCliente)      secaoCliente.style.display      = 'none';
        if (secaoBeneficiario) secaoBeneficiario.style.display = 'block';
    }
}

function toggleParteEditar(tipoForcado) {
    const tipo = tipoForcado || document.getElementById('editTipo').value;
    const secaoCliente      = document.getElementById('editSecaoCliente');
    const secaoBeneficiario = document.getElementById('editSecaoBeneficiario');
    if (tipo === 'Receita') {
        if (secaoCliente)      secaoCliente.style.display      = 'block';
        if (secaoBeneficiario) secaoBeneficiario.style.display = 'none';
    } else {
        if (secaoCliente)      secaoCliente.style.display      = 'none';
        if (secaoBeneficiario) secaoBeneficiario.style.display = 'block';
    }
}
        // --- FUNÇÕES DE RECIBO ---
        
        // Carregar clientes cadastrados para o select do recibo
        async function carregarClientesParaRecibo() {
            try {
                const res = await fetch('/api/clientes?limit=200', {
                    headers: { Authorization: `Bearer ${token}` }
                });

                if (!res.ok) {
                    throw new Error('Erro ao carregar clientes');
                }

                const rCR = await res.json();
                clientesCadastrados = rCR.data || rCR;
                
                const select = document.getElementById('reciboClienteSelect');
                if (select) {
                    select.innerHTML = '<option value="">Selecione um cliente ou preencha manualmente abaixo</option>';
                    
                    clientesCadastrados.forEach(cliente => {
                        select.innerHTML += `<option value="${cliente.id}" data-nome="${cliente.nome}" data-documento="${cliente.documento || ''}">${cliente.nome} ${cliente.documento ? '- ' + cliente.documento : ''}</option>`;
                    });
                    
                    console.log('✅ Clientes carregados para recibo:', clientesCadastrados.length);
                }
            } catch (err) {
                console.error('Erro ao carregar clientes para recibo:', err);
            }
        }

        // Preencher dados do cliente automaticamente ao selecionar no select
        function preencherDadosCliente() {
            const select = document.getElementById('reciboClienteSelect');
            const selectedOption = select.options[select.selectedIndex];
            
            if (selectedOption.value) {
                const nome = selectedOption.getAttribute('data-nome');
                const documento = selectedOption.getAttribute('data-documento');
                
                document.getElementById('reciboClienteNome').value = nome || '';
                document.getElementById('reciboClienteDoc').value = documento || '';
                
                console.log('✅ Dados do cliente preenchidos:', nome);
            } else {
                // Limpa os campos se selecionar a opção vazia
                document.getElementById('reciboClienteNome').value = '';
                document.getElementById('reciboClienteDoc').value = '';
            }
        }

        async function validarClienteParaBoleto(clienteId) {
    try {
        const res = await fetch(`/api/clientes/${clienteId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const cliente = await res.json();
        
        if (!cliente.documento || cliente.documento.replace(/\D/g, '').length < 11) {
            alert("⚠️ Este cliente não possui CPF/CNPJ cadastrado.\n\nEdite o cliente e adicione o documento antes de gerar boleto.");
            return false;
        }
        
        return true;
    } catch (err) {
        console.error("Erro ao validar cliente:", err);
        return true; // Permite continuar em caso de erro na validação
    }
}

async function carregarClientesSelect() {
    const select = document.getElementById('selectClienteBoleto');
    try {
        const res = await fetch('/api/clientes?limit=200', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Erro ao carregar clientes');

        const rCS = await res.json();
        const clientes = rCS.data || rCS;
        
        select.innerHTML = '<option value="">Selecione o cliente pagador</option>';
        
        clientes.forEach(c => {
            const temDocumento = c.documento && c.documento.replace(/\D/g, '').length >= 11;
            const icone = temDocumento ? '✅' : '⚠️';
            const aviso = temDocumento ? '' : ' (sem CPF/CNPJ)';
            
            const option = document.createElement('option');
            option.value = c.id;
            option.textContent = `${icone} ${c.nome}${aviso}`;
            
            // ✅ Desabilita opção se não tiver documento
            if (!temDocumento) {
                option.disabled = true;
                option.style.color = '#999';
            }
            
            select.appendChild(option);
        });
        
    } catch (err) {
        console.error('Erro ao carregar clientes:', err);
        select.innerHTML = '<option value="">Erro ao carregar clientes</option>';
    }
}

function redirecionarParaConfiguracoes() {
    if (confirm("Para gerar boletos, você precisa ativar o Faturamento Próprio.\n\nDeseja ir para Configurações agora?")) {
        window.location.href = '/config-page#faturamento';
    }
}
        
function prepararRecibo(lancamentoId) {
    const item = originalData.find(i => i.id === lancamentoId);
    if (!item) return;

    document.getElementById('reciboLancamentoId').value = lancamentoId;
    document.getElementById('reciboNumero').value = `REC-${lancamentoId}-${new Date().getFullYear()}`;
    document.getElementById('reciboValor').value = item.valor;
    document.getElementById('reciboDescricao').value = item.descricao;

    // Preenche forma de pagamento automaticamente do lançamento
    const reciboFormaPagamento = document.getElementById('reciboFormaPagamento');
    if (reciboFormaPagamento) reciboFormaPagamento.value = item.forma_pagamento || '';

    const sectionSelecaoCliente = document.getElementById('reciboSecaoSelecaoCliente');
    const infoClienteVinculado = document.getElementById('reciboInfoClienteVinculado');

    if (item.cliente_id && item.cliente_nome) {
        // Lançamento já tem cliente vinculado — preenche direto, oculta seleção
        document.getElementById('reciboClienteNome').value = item.cliente_nome;
        document.getElementById('reciboClienteDoc').value = '';

        // Tenta buscar o documento do cliente (se já estiver na lista carregada)
        const clienteEncontrado = clientesCadastrados.find(c => c.id === item.cliente_id);
        if (clienteEncontrado) {
            document.getElementById('reciboClienteDoc').value = clienteEncontrado.documento || '';
        }

        // Oculta a seção de seleção manual
        if (sectionSelecaoCliente) sectionSelecaoCliente.style.display = 'none';

        // Exibe o badge informativo do cliente vinculado
        if (infoClienteVinculado) {
            infoClienteVinculado.style.display = 'flex';
            document.getElementById('reciboClienteVinculadoNome').innerText = item.cliente_nome;
        }
    } else {
        // Sem cliente vinculado — exibe seleção manual normalmente
        document.getElementById('reciboClienteSelect').value = '';
        document.getElementById('reciboClienteNome').value = '';
        document.getElementById('reciboClienteDoc').value = '';

        if (sectionSelecaoCliente) sectionSelecaoCliente.style.display = 'block';
        if (infoClienteVinculado) infoClienteVinculado.style.display = 'none';
    }

    document.getElementById('modalRecibo').style.display = 'flex';

    if (window.lucide) lucide.createIcons();
}

        const DEBUG_MODE = false;

function debugLog(mensagem, dados) {
    if (DEBUG_MODE) {
        console.log(`[DEBUG] ${mensagem}`, dados || '');
    }
}

        function fecharModalRecibo() {
            document.getElementById('modalRecibo').style.display = 'none';
        }

        async function gerarRecibo(el) {
            const dados = {
                lancamentoId: document.getElementById('reciboLancamentoId').value,
                numeroRecibo: document.getElementById('reciboNumero').value,
                clienteNome: document.getElementById('reciboClienteNome').value,
                clienteDocumento: document.getElementById('reciboClienteDoc').value,
                valor: document.getElementById('reciboValor').value,
                descricao: document.getElementById('reciboDescricao').value,
                formaPagamento: document.getElementById('reciboFormaPagamento').value
            };

            if (!dados.clienteNome || !dados.valor || !dados.descricao) {
                return alert('⚠️ Preencha todos os campos obrigatórios: Nome do Cliente, Valor e Descrição');
            }

            const btn = el || document.querySelector('[data-action="gerarRecibo"]');
            const textoOriginal = btn.innerHTML;

            try {
                btn.innerHTML = '<i class="lucide lucide-loader-2" style="animation: spin 1s linear infinite;"></i> Gerando PDF...';
                btn.disabled = true;

                const res = await fetch('/api/recibos/gerar', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(dados)
                });

                if (res.ok) {
                    // Recebe o PDF como blob
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `recibo-${dados.numeroRecibo}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                    
                    alert('✅ Recibo gerado com sucesso!');
                    fecharModalRecibo();
                } else {
                    const erro = await res.json();
                    alert('❌ Erro: ' + (erro.erro || 'Falha ao gerar recibo'));
                }
            } catch (err) {
                console.error('Erro ao gerar recibo:', err);
                alert('❌ Erro ao gerar recibo. Verifique sua conexão.');
            } finally {
                btn.innerHTML = textoOriginal;
                btn.disabled = false;
                if (window.lucide) {
                    lucide.createIcons();
                }
            }
        }

        // --- FUNÇÕES DE LOGO ---
        function abrirModalLogo() {
            console.log('🖼️ abrirModalLogo chamada');
            var el = document.getElementById('modalLogo');
            if (!el) { console.error('❌ modalLogo não encontrado no DOM'); return; }
            el.style.display = 'flex';
        }

        function fecharModalLogo() {
            document.getElementById('modalLogo').style.display = 'none';
        }

        async function carregarLogoAtual() {
            try {
                const res = await fetch('/api/recibos/logo', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                
                if (!res.ok) {
                    console.warn('Erro ao carregar logo:', res.status);
                    return;
                }

                const data = await res.json();

                if (data.ok && (data.logoBase64 || data.logoPath)) {
                    const preview = document.getElementById('logoPreview');
                    if (preview) {
                        // Prioriza base64 (persiste após deploy); fallback para arquivo com cache-bust
                        const src = data.logoBase64 || `${data.logoPath}?t=${Date.now()}`;
                        preview.innerHTML = `<img src="${src}" alt="Logo" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
                    }
                }
            } catch (err) {
                console.error('Erro ao carregar logo:', err);
            }
        }

        async function carregarAssinaturaAtual() {
            try {
                const res = await fetch('/api/recibos/assinatura', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (!res.ok) return;
                const data = await res.json();
                if (data.ok && (data.assinaturaBase64 || data.assinaturaPath)) {
                    const preview = document.getElementById('assinaturaPreview');
                    if (preview) {
                        const src = data.assinaturaBase64 || `${data.assinaturaPath}?t=${Date.now()}`;
                        preview.innerHTML = `<img src="${src}" style="max-width:100%; max-height:100%; object-fit:contain;">`;
                    }
                }
            } catch (err) {
                console.error('Erro ao carregar assinatura:', err);
            }
        }

        async function uploadLogo() {
            const fileInput = document.getElementById('logoInput');
            const file = fileInput.files[0];
            
            if (!file) {
                return alert('⚠️ Selecione uma imagem primeiro');
            }

            // Validação de tamanho (5MB)
            if (file.size > 5 * 1024 * 1024) {
                return alert('⚠️ A imagem deve ter no máximo 5MB');
            }

            // Validação de tipo
            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
            if (!allowedTypes.includes(file.type)) {
                return alert('⚠️ Apenas imagens JPG, PNG ou GIF são permitidas');
            }

            const formData = new FormData();
            formData.append('logo', file);

            // Mostra preview temporário
            const preview = document.getElementById('logoPreview');
            const reader = new FileReader();
            reader.onload = function(e) {
                preview.innerHTML = `<img src="${e.target.result}" alt="Preview" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
            };
            reader.readAsDataURL(file);

            try {
                const res = await fetch('/api/recibos/upload-logo', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    body: formData
                });

                const data = await res.json();

                if (res.ok && data.ok) {
                    alert('✅ Logo atualizada com sucesso!');
                    // Usa base64 retornado para garantir persistência após deploy
                    const src = data.logoBase64 || `${data.logoPath}?t=${Date.now()}`;
                    preview.innerHTML = `<img src="${src}" alt="Logo" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
                } else {
                    alert('❌ Erro: ' + (data.erro || 'Falha ao fazer upload'));
                    await carregarLogoAtual();
                }
            } catch (err) {
                console.error('Erro no upload:', err);
                alert('❌ Erro ao fazer upload da logo');
                await carregarLogoAtual();
            }
        }

        async function uploadAssinatura() {
    const fileInput = document.getElementById('assinaturaInput');
    const file = fileInput.files[0];

    if (!file) {
        return alert('⚠️ Selecione uma imagem primeiro');
    }

    if (file.size > 5 * 1024 * 1024) {
        return alert('⚠️ A imagem deve ter no máximo 5MB');
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
        return alert('⚠️ Apenas imagens JPG ou PNG são permitidas');
    }

    const formData = new FormData();
    formData.append('assinatura', file);

    // Preview imediato
    const preview = document.getElementById('assinaturaPreview');
    const reader = new FileReader();
    reader.onload = function(e) {
        preview.innerHTML = `<img src="${e.target.result}" style="max-width:100%; max-height:100%; object-fit:contain;">`;
    };
    reader.readAsDataURL(file);

    try {
        const res = await fetch('/api/recibos/upload-assinatura', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        const data = await res.json();

        if (res.ok && data.ok) {
            alert('✅ Assinatura salva com sucesso!');
            // Atualiza preview com base64 retornado (garante persistência após deploy)
            if (data.assinaturaBase64) {
                preview.innerHTML = `<img src="${data.assinaturaBase64}" style="max-width:100%; max-height:100%; object-fit:contain;">`;
            }
        } else {
            alert('❌ Erro: ' + (data.erro || 'Falha no upload'));
        }
    } catch (err) {
        console.error(err);
        alert('❌ Erro ao enviar assinatura');
    }
}

        async function carregarClientesParaBoleto() {
    const select = document.getElementById('selectClienteBoleto');
    try {
        const res = await fetch('/api/clientes?limit=200', {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Erro na requisição");

        const rCB = await res.json();
        const clientes = rCB.data || rCB;
        
        select.innerHTML = '<option value="">Selecione o cliente...</option>';
        clientes.forEach(c => {
            select.innerHTML += `<option value="${c.id}">${c.nome}</option>`;
        });
    } catch (err) {
        console.error("Erro ao carregar clientes:", err);
        select.innerHTML = '<option value="">Erro ao carregar clientes</option>';
    }
}

async function confirmarBoleto() {
    if (!lancamentoParaCobrar) {
        alert("⚠️ Nenhum lançamento selecionado");
        return;
    }
    
    const btn = document.querySelector('#modalCobranca .btn-mini-boleto');
    const selectCliente = document.getElementById('selectClienteBoleto');
    const originalText = btn.innerText;

    try {
        // ✅ Validação de cliente
        const clienteId = selectCliente.value;
        
        if (!clienteId) {
            alert("⚠️ Por favor, selecione um cliente!");
            selectCliente.focus();
            return;
        }

        // ✅ Desabilita botão e mostra loading
        btn.innerText = "⏳ Gerando boleto...";
        btn.disabled = true;
        selectCliente.disabled = true;

        console.log("📄 Gerando boleto:", {
            clienteId,
            valor: lancamentoParaCobrar.valor,
            descricao: lancamentoParaCobrar.desc
        });

        // ✅ Chamada à API
        const res = await fetch('/api/financeiro/gerar-boleto-honorarios', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({
                clienteId: clienteId,
                valor: parseFloat(lancamentoParaCobrar.valor),
                descricao: lancamentoParaCobrar.desc || 'Honorários Advocatícios',
                vencimento: lancamentoParaCobrar.vencimento || null // ✅ Envia data de vencimento
            })
        });

        const data = await res.json();
        
        // ✅ Tratamento de erro de plano
        if (res.status === 402) {
            const msg = data.message || "A emissão de boletos está disponível apenas nos planos Intermediário, Avançado e Premium.";
            exibirAvisoUpgrade(msg);
            document.getElementById('modalCobranca').style.display = 'none';
            return;
        }
        
        // ✅ Tratamento de erro genérico
        if (!res.ok) {
            throw new Error(data.erro || `Erro ${res.status}: ${data.message || 'Falha ao gerar boleto'}`);
        }
        
        // ✅ Sucesso - Abre o boleto
        if (data.ok && (data.boletoUrl || data.url)) {
            const urlBoleto = data.boletoUrl || data.url;
            
            console.log("✅ Boleto gerado:", {
                invoiceId: data.invoiceId,
                url: urlBoleto,
                vencimento: data.vencimento,
                valor: data.valor
            });

            // Abre em nova aba
            const janela = window.open(urlBoleto, '_blank');
            
            if (!janela) {
                alert("⚠️ Pop-up bloqueado! Permita pop-ups para abrir o boleto.\n\nURL copiada para a área de transferência.");
                // Tenta copiar para clipboard
                navigator.clipboard.writeText(urlBoleto).catch(() => {
                    prompt("Copie a URL do boleto:", urlBoleto);
                });
            } else {
                alert("✅ Boleto gerado com sucesso!\n\n" +
                      `Valor: R$ ${data.valor || lancamentoParaCobrar.valor}\n` +
                      `Vencimento: ${data.vencimento || 'Conforme configurado'}`);
            }
            
            // Fecha modal e recarrega
            document.getElementById('modalCobranca').style.display = 'none';
            
            // ✅ Recarrega a lista de lançamentos
            if (typeof carregarLancamentos === 'function') {
                await carregarLancamentos();
            }
            
        } else {
            throw new Error("Resposta da API sem URL do boleto");
        }
        
    } catch (err) {
        console.error("❌ Erro ao gerar boleto:", err);
        
        let mensagemErro = "Erro ao gerar boleto";
        
        // ✅ Mensagens específicas de erro
        if (err.message.includes("ative o faturamento")) {
            mensagemErro = "⚠️ Você precisa ativar o Faturamento Próprio em Configurações antes de gerar boletos.";
        } else if (err.message.includes("CPF/CNPJ")) {
            mensagemErro = "⚠️ O cliente selecionado não possui CPF/CNPJ válido.\n\nEdite o cadastro do cliente e adicione o documento.";
        } else if (err.message.includes("Insufficient balance")) {
            mensagemErro = "⚠️ Saldo insuficiente na conta Asaas.\n\nConfigure o split de pagamento ou entre em contato com o suporte.";
        } else if (err.message.includes("conexão") || err.message.includes("network")) {
            mensagemErro = "⚠️ Erro de conexão. Verifique sua internet e tente novamente.";
        } else {
            mensagemErro = `❌ ${err.message}`;
        }
        
        alert(mensagemErro);
        
    } finally {
        // ✅ Restaura estado do botão
        btn.innerText = originalText;
        btn.disabled = false;
        selectCliente.disabled = false;
    }
}

async function carregarSaldoReal() {
    try {
        // Usa o mês/ano da navegação atual para filtrar os cards
        const mes = window._finMes || (new Date().getMonth() + 1);
        const ano = window._finAno || new Date().getFullYear();

        const res = await fetch(`/api/financeiro/saldo-real?mes=${mes}&ano=${ano}`, { 
            headers: { Authorization: `Bearer ${token}` } 
        });
        
        if (!res.ok) throw new Error('Erro na API');
        const data = await res.json();

        const elRec = document.getElementById('totalReceitas');
        const elDes = document.getElementById('totalDespesas');
        const elSal = document.getElementById('saldoTotal');

        if (elRec) elRec.innerText = `R$ ${Number(data.receitasReais).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        if (elDes) elDes.innerText = `R$ ${Number(data.despesasPagas).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        if (elSal) elSal.innerText = `R$ ${Number(data.saldoLiquido).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        
    } catch (e) {
        console.error('Erro ao carregar saldo real:', e);
    }
}

        function atualizarGrafico(r1, d1, r2, d2) {
    const ctx = document.getElementById('financeChart').getContext('2d');
    if (financeChart) financeChart.destroy();

    financeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Realizado', 'Previsto'],
            datasets: [
                { 
                    label: 'Receitas', 
                    data: [r1, r2], 
                    borderColor: '#10b981', 
                    backgroundColor: 'rgba(16, 185, 129, 0.1)', 
                    fill: true, 
                    tension: 0.4 
                },
                { 
                    label: 'Despesas', 
                    data: [d1, d2], 
                    borderColor: '#ef4444', 
                    backgroundColor: 'rgba(239, 68, 68, 0.1)', 
                    fill: true, 
                    tension: 0.4 
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { display: false },
                x: { grid: { display: false } }
            }
        }
    });
}

        function rolarParaTabela() { window.scrollTo({ top: 600, behavior: 'smooth' }); }
        function logout() { localStorage.removeItem('token'); window.location.href = '/login.html'; }

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

        const campoValor = document.getElementById('addValor');
        if (campoValor) {
        campoValor.addEventListener('input', function (e) {
        let value = e.target.value.replace(/\D/g, "");
        if (!value) { e.target.value = ""; return; }
        value = (value / 100).toFixed(2) + "";
        value = value.replace(".", ",");
        value = value.replace(/(\d)(\d{3})(\d{3}),/g, "$1.$2.$3,");
        value = value.replace(/(\d)(\d{3}),/g, "$1.$2,");
        e.target.value = "R$ " + value;
    });
}

function toggleUserMenu() {
    const m = document.getElementById('userDropdown');
    if(m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

window.addEventListener('click', (e) => {
    if (!e.target.closest('#userCircle') && !e.target.closest('#userDropdown')) {
        const m = document.getElementById('userDropdown');
        if(m) m.style.display = 'none';
    }
});

        function exibirAvisoUpgrade(mensagem) {
            const overlay = document.createElement('div');
            overlay.id = "overlay-upgrade";
            overlay.style = "position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:20000; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(5px);";
            overlay.innerHTML = `
            <div style="background:#fff; padding:40px; border-radius:20px; text-align:center; max-width:400px;">
                <div style="font-size:50px;">🚀</div>
                <h3 style="margin-top:15px; color:#0f172a;">Recurso Intermediário</h3>
                <p style="color:#64748b; margin:15px 0 25px 0; line-height:1.6;">${mensagem}</p>
                <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:12px; padding:15px; margin-bottom:25px; text-align:left;">
                    <p style="margin:0; font-size:13px; color:#92400e; line-height:1.6;">
                        <strong>🎯 Plano Intermediário inclui:</strong><br>
                        • Boletos e cobranças ilimitadas<br>
                        • Integração Asaas completa<br>
                        • Relatórios financeiros avançados<br>
                        • Suporte prioritário
                    </p>
                </div>
                <button data-action="navegarPara" data-args='["/planos-page"]' style="background:linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); color:#000; border:none; padding:14px 28px; border-radius:10px; font-weight:800; cursor:pointer; width:100%; margin-bottom:10px;">
                    Ver Planos e Preços
                </button>
                <button data-action="removerElemento" data-args='["overlay-upgrade"]' style="background:none; border:none; color:#64748b; cursor:pointer; font-weight:600; padding:8px;">
                    Depois
                </button>
            </div>`;
            document.body.appendChild(overlay);
        }

        // ==========================================
// 📊 RELATÓRIO DE FATURAMENTO
// ==========================================

function abrirRelatorioFaturamento() {
    const modal = document.getElementById('modalRelatorioFaturamento');
    if (!modal) { alert('Modal não encontrado'); return; }
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    modal.removeAttribute('style');
    modal.setAttribute('style', 'display:flex !important; position:fixed !important; top:0 !important; left:0 !important; width:100vw !important; height:100vh !important; background:rgba(15,23,42,0.85) !important; z-index:2147483647 !important; align-items:center !important; justify-content:center !important;');
    // Pré-seleciona mês atual
    const mesInput = document.getElementById('relatorioMes');
    if (mesInput) mesInput.value = new Date().toISOString().substring(0, 7);
    // Pré-seleciona ano atual no select anual
    const anoSelect = document.getElementById('relatorioAno');
    if (anoSelect) {
        const anoAtual = String(new Date().getFullYear());
        const optExists = Array.from(anoSelect.options).some(o => o.value === anoAtual);
        if (!optExists) {
            const opt = document.createElement('option');
            opt.value = anoAtual; opt.textContent = anoAtual;
            anoSelect.insertBefore(opt, anoSelect.firstChild);
        }
        anoSelect.value = anoAtual;
    }
}

function fecharRelatorioFaturamento() {
    const modal = document.getElementById('modalRelatorioFaturamento');
    if (modal) modal.style.display = 'none';
}

function fecharVisualizacaoRelatorio() {
    const modal = document.getElementById('modalVisualizacaoRelatorio');
    if (modal) modal.style.display = 'none';
}

function atualizarCamposPeriodo() {
    const tipo = document.getElementById('relatorioTipo').value;
    
    document.getElementById('camposMensal').style.display = tipo === 'mensal' ? 'block' : 'none';
    document.getElementById('camposAnual').style.display = tipo === 'anual' ? 'block' : 'none';
    document.getElementById('camposPersonalizado').style.display = tipo === 'personalizado' ? 'block' : 'none';
}

async function visualizarRelatorio() {
    const dados = await buscarDadosRelatorio();
    if (!dados) return;
    
    const html = gerarHTMLRelatorio(dados);
    document.getElementById('conteudoRelatorio').innerHTML = html;
    
    fecharRelatorioFaturamento();
    const mv = document.getElementById('modalVisualizacaoRelatorio');
    if (mv) mv.style.display = 'flex';
    
    // Reinicializar ícones Lucide
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

async function buscarDadosRelatorio() {
    const tipo = document.getElementById('relatorioTipo').value;
    let dataInicio, dataFim, periodoTexto;
    
    // Determinar período
    if (tipo === 'mensal') {
        const mesAno = document.getElementById('relatorioMes').value;
        if (!mesAno) {
            alert('Por favor, selecione o mês.');
            return null;
        }
        
        const [ano, mes] = mesAno.split('-');
        dataInicio = `${ano}-${mes}-01`;
        
        // Último dia do mês
        const ultimoDia = new Date(ano, mes, 0).getDate();
        dataFim = `${ano}-${mes}-${ultimoDia}`;
        
        const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
                       'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        periodoTexto = `${meses[parseInt(mes) - 1]} de ${ano}`;
        
    } else if (tipo === 'anual') {
        const ano = document.getElementById('relatorioAno').value;
        dataInicio = `${ano}-01-01`;
        dataFim = `${ano}-12-31`;
        periodoTexto = `Ano ${ano}`;
        
    } else { // personalizado
        dataInicio = document.getElementById('relatorioDataInicio').value;
        dataFim = document.getElementById('relatorioDataFim').value;
        
        if (!dataInicio || !dataFim) {
            alert('Por favor, preencha as datas de início e fim.');
            return null;
        }
        
        periodoTexto = `${new Date(dataInicio).toLocaleDateString('pt-BR')} até ${new Date(dataFim).toLocaleDateString('pt-BR')}`;
    }
    
    // Buscar dados do backend
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/financeiro/relatorio?dataInicio=${dataInicio}&dataFim=${dataFim}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            throw new Error('Erro ao buscar dados do relatório');
        }
        
        const lancamentos = await response.json();
        
        // Filtrar conforme opções
        const incluirReceitas = document.getElementById('incluirReceitas').checked;
        const incluirDespesas = document.getElementById('incluirDespesas').checked;
        const apenasRealizados = document.getElementById('apenasRealizados').checked;
        
        const lancamentosFiltrados = lancamentos.filter(lanc => {
            if (!incluirReceitas && lanc.tipo === 'Receita') return false;
            if (!incluirDespesas && lanc.tipo === 'Despesa') return false;
            if (apenasRealizados && lanc.status !== 'Pago') return false;
            return true;
        });
        
        return {
            periodo: periodoTexto,
            dataInicio,
            dataFim,
            lancamentos: lancamentosFiltrados
        };
        
    } catch (error) {
        console.error('Erro ao buscar dados:', error);
        alert('Erro ao buscar dados do relatório. Verifique o console.');
        return null;
    }
}


function formatarData(str) {
    if (!str) return '—';
    // Garante parse correto independente de timezone (adiciona T12:00:00 se vier só YYYY-MM-DD)
    const s = String(str).substring(0, 10); // pega só YYYY-MM-DD
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return str;
    return `${d.padStart(2,'0')}/${m.padStart(2,'0')}/${y}`;
}
function gerarHTMLRelatorio(dados) {
    const { periodo, lancamentos } = dados;

    let totalReceitas = 0, totalDespesas = 0;
    let totalReceitasPagas = 0, totalReceitasPendentes = 0;
    let totalDespesasPagas = 0, totalDespesasPendentes = 0;

    lancamentos.forEach(l => {
        const v = parseFloat(l.valor);
        if (l.tipo === 'Receita') {
            totalReceitas += v;
            if (l.status === 'Pago') totalReceitasPagas += v;
            else totalReceitasPendentes += v;
        } else {
            totalDespesas += v;
            if (l.status === 'Pago') totalDespesasPagas += v;
            else totalDespesasPendentes += v;
        }
    });

    const saldoLiquido = totalReceitasPagas - totalDespesasPagas;
    const margem = totalReceitasPagas > 0 ? ((saldoLiquido / totalReceitasPagas) * 100).toFixed(1) : '0.0';

    const fmt = v => 'R$ ' + parseFloat(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Agrupar por mês
    const porMes = {};
    lancamentos.forEach(l => {
        const mes = l.data_vencimento.substring(0, 7);
        if (!porMes[mes]) porMes[mes] = { receitas: 0, despesas: 0 };
        const v = parseFloat(l.valor);
        if (l.tipo === 'Receita') porMes[mes].receitas += v;
        else porMes[mes].despesas += v;
    });

    // Agrupar por beneficiário/descrição para top lançamentos
    const porDesc = {};
    lancamentos.forEach(l => {
        const key = l.tipo === 'Receita' ? (l.beneficiario || l.descricao) : l.descricao;
        if (!porDesc[key]) porDesc[key] = { tipo: l.tipo, total: 0, count: 0 };
        porDesc[key].total += parseFloat(l.valor);
        porDesc[key].count++;
    });
    const topReceitas = Object.entries(porDesc)
        .filter(([,v]) => v.tipo === 'Receita')
        .sort((a,b) => b[1].total - a[1].total)
        .slice(0, 5);
    const topDespesas = Object.entries(porDesc)
        .filter(([,v]) => v.tipo === 'Despesa')
        .sort((a,b) => b[1].total - a[1].total)
        .slice(0, 5);

    const mesesNome = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const isMultiMes = Object.keys(porMes).length > 1;

    const saldoCor = saldoLiquido >= 0 ? '#16a34a' : '#dc2626';
    const saldoBg  = saldoLiquido >= 0 ? '#f0fdf4' : '#fef2f2';
    const saldoBorder = saldoLiquido >= 0 ? '#bbf7d0' : '#fecaca';

    // Linha do tempo mensal (SVG sparkline simples)
    let sparklineSVG = '';
    const mesesKeys = Object.keys(porMes).sort();
    if (mesesKeys.length > 1) {
        const maxVal = Math.max(...mesesKeys.map(k => Math.max(porMes[k].receitas, porMes[k].despesas)));
        const W = 420, H = 60, pad = 10;
        const pts = (tipo) => mesesKeys.map((k,i) => {
            const x = pad + (i / (mesesKeys.length - 1)) * (W - pad*2);
            const y = H - pad - ((porMes[k][tipo] / maxVal) * (H - pad*2));
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        sparklineSVG = `
        <svg width="${W}" height="${H}" style="overflow:visible;">
            <polyline points="${pts('receitas')}" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linejoin="round"/>
            <polyline points="${pts('despesas')}" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linejoin="round"/>
            ${mesesKeys.map((k,i) => {
                const x = pad + (i / (mesesKeys.length-1)) * (W - pad*2);
                const yr = H - pad - ((porMes[k].receitas / maxVal) * (H - pad*2));
                const yd = H - pad - ((porMes[k].despesas / maxVal) * (H - pad*2));
                const [,mn] = k.split('-');
                return `<circle cx="${x.toFixed(1)}" cy="${yr.toFixed(1)}" r="3.5" fill="#16a34a"/>
                        <circle cx="${x.toFixed(1)}" cy="${yd.toFixed(1)}" r="3.5" fill="#dc2626"/>
                        <text x="${x.toFixed(1)}" y="${H}" text-anchor="middle" font-size="9" fill="#6b7280">${mesesNome[parseInt(mn)-1]}</text>`;
            }).join('')}
        </svg>`;
    }

    return `
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        .rel-wrap { font-family: 'Inter', Arial, sans-serif; color: #1a1a2e; max-width: 860px; margin: 0 auto; background: #fff; }

        /* Cabeçalho */
        .rel-header { background: linear-gradient(135deg, #1E3A5F 0%, #2563eb 100%); color: #fff; padding: 32px 40px 24px; border-radius: 12px 12px 0 0; position: relative; overflow: hidden; }
        .rel-header::after { content: ''; position: absolute; right: -40px; top: -40px; width: 200px; height: 200px; background: rgba(255,255,255,0.06); border-radius: 50%; }
        .rel-header-top { display: flex; justify-content: space-between; align-items: flex-start; }
        .rel-logo { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
        .rel-logo span { opacity: 0.7; font-weight: 400; font-size: 13px; display: block; margin-top: 2px; }
        .rel-periodo-badge { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; }
        .rel-title { font-size: 28px; font-weight: 800; margin: 20px 0 4px; letter-spacing: -0.5px; }
        .rel-subtitle { opacity: 0.75; font-size: 13px; }

        /* KPI cards */
        .rel-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 24px 40px; background: #f8fafc; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; }
        .rel-kpi { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px 18px; position: relative; }
        .rel-kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #6b7280; margin-bottom: 8px; }
        .rel-kpi-value { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
        .rel-kpi-sub { font-size: 11px; color: #9ca3af; margin-top: 4px; }
        .rel-kpi-dot { width: 8px; height: 8px; border-radius: 50%; position: absolute; top: 16px; right: 16px; }
        .kpi-receita .rel-kpi-value { color: #16a34a; }
        .kpi-receita .rel-kpi-dot { background: #16a34a; }
        .kpi-despesa .rel-kpi-value { color: #dc2626; }
        .kpi-despesa .rel-kpi-dot { background: #dc2626; }
        .kpi-saldo { border: 2px solid ${saldoBorder}; background: ${saldoBg}; }
        .kpi-saldo .rel-kpi-value { color: ${saldoCor}; }
        .kpi-saldo .rel-kpi-dot { background: ${saldoCor}; }
        .kpi-margem .rel-kpi-value { color: #7c3aed; }
        .kpi-margem .rel-kpi-dot { background: #7c3aed; }

        /* Body */
        .rel-body { padding: 28px 40px; border: 1px solid #e5e7eb; border-top: none; }
        .rel-section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; margin: 0 0 14px; display: flex; align-items: center; gap: 8px; }
        .rel-section-title::after { content: ''; flex: 1; height: 1px; background: #e5e7eb; }

        /* Evolução mensal */
        .rel-spark-wrap { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px; }
        .rel-spark-legend { display: flex; gap: 20px; margin-bottom: 12px; font-size: 12px; }
        .rel-spark-legend span { display: flex; align-items: center; gap: 6px; font-weight: 600; }
        .leg-dot { width: 10px; height: 10px; border-radius: 50%; }

        /* Top lançamentos */
        .rel-tops { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
        .rel-top-card { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px 20px; }
        .rel-top-card h4 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; margin: 0 0 12px; }
        .rel-top-card h4.rec { color: #16a34a; }
        .rel-top-card h4.desp { color: #dc2626; }
        .rel-top-item { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid #e5e7eb; font-size: 12px; }
        .rel-top-item:last-child { border-bottom: none; }
        .rel-top-name { color: #374151; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
        .rel-top-val { font-weight: 700; white-space: nowrap; margin-left: 8px; }
        .rel-top-val.rec { color: #16a34a; }
        .rel-top-val.desp { color: #dc2626; }

        /* Tabela mensal */
        .rel-month-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
        .rel-month-table th { background: #1E3A5F; color: #fff; padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .rel-month-table th:not(:first-child) { text-align: right; }
        .rel-month-table td { padding: 10px 14px; border-bottom: 1px solid #e5e7eb; }
        .rel-month-table td:not(:first-child) { text-align: right; font-weight: 600; }
        .rel-month-table tr:last-child td { border-bottom: none; font-weight: 700; background: #f8fafc; }
        .rel-month-table tr:hover td { background: #f0f9ff; }

        /* Tabela detalhada */
        .rel-detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .rel-detail-table thead th { background: #f1f5f9; color: #475569; padding: 9px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e2e8f0; }
        .rel-detail-table thead th:last-child, .rel-detail-table thead th:nth-child(4) { text-align: right; }
        .rel-detail-table tbody td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .rel-detail-table tbody td:last-child, .rel-detail-table tbody td:nth-child(4) { text-align: right; }
        .rel-detail-table tbody tr:hover td { background: #f8fafc; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; white-space: nowrap; }
        .badge-rec { background: #dcfce7; color: #16a34a; }
        .badge-desp { background: #fee2e2; color: #dc2626; }
        .badge-pago { background: #dcfce7; color: #15803d; }
        .badge-pend { background: #fef3c7; color: #d97706; }

        /* Rodapé */
        .rel-footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #9ca3af; }

        @media print {
            @page { margin: 14mm 12mm; size: A4; }
            .rel-wrap { max-width: 100%; }
            .rel-header { border-radius: 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .rel-kpi { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .kpi-saldo { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .rel-month-table th { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .badge { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .badge-rec, .badge-desp, .badge-pago, .badge-pend { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            tr { page-break-inside: avoid; }
        }
    </style>

    <div class="rel-wrap">

        <!-- Cabeçalho -->
        <div class="rel-header">
            <div class="rel-header-top">
                <div class="rel-logo">LawTech Pro <span>Sistema Jurídico Inteligente</span></div>
                <div class="rel-periodo-badge">📅 ${periodo}</div>
            </div>
            <div class="rel-title">Relatório Financeiro</div>
            <div class="rel-subtitle">Gerado em ${new Date().toLocaleString('pt-BR')} &nbsp;·&nbsp; ${lancamentos.length} lançamento${lancamentos.length !== 1 ? 's' : ''}</div>
        </div>

        <!-- KPIs -->
        <div class="rel-kpis">
            <div class="rel-kpi kpi-receita">
                <div class="rel-kpi-dot"></div>
                <div class="rel-kpi-label">Receitas Recebidas</div>
                <div class="rel-kpi-value">${fmt(totalReceitasPagas)}</div>
                ${totalReceitasPendentes > 0 ? `<div class="rel-kpi-sub">+ ${fmt(totalReceitasPendentes)} a receber</div>` : '<div class="rel-kpi-sub">Sem pendências</div>'}
            </div>
            <div class="rel-kpi kpi-despesa">
                <div class="rel-kpi-dot"></div>
                <div class="rel-kpi-label">Despesas Pagas</div>
                <div class="rel-kpi-value">${fmt(totalDespesasPagas)}</div>
                ${totalDespesasPendentes > 0 ? `<div class="rel-kpi-sub">+ ${fmt(totalDespesasPendentes)} a pagar</div>` : '<div class="rel-kpi-sub">Sem pendências</div>'}
            </div>
            <div class="rel-kpi kpi-saldo">
                <div class="rel-kpi-dot"></div>
                <div class="rel-kpi-label">Saldo Líquido</div>
                <div class="rel-kpi-value">${fmt(saldoLiquido)}</div>
                <div class="rel-kpi-sub">${saldoLiquido >= 0 ? '▲ Resultado positivo' : '▼ Resultado negativo'}</div>
            </div>
            <div class="rel-kpi kpi-margem">
                <div class="rel-kpi-dot"></div>
                <div class="rel-kpi-label">Margem Líquida</div>
                <div class="rel-kpi-value">${margem}%</div>
                <div class="rel-kpi-sub">Sobre receitas recebidas</div>
            </div>
        </div>

        <!-- Corpo -->
        <div class="rel-body">

            ${isMultiMes && sparklineSVG ? `
            <div class="rel-section-title">Evolução Mensal</div>
            <div class="rel-spark-wrap">
                <div class="rel-spark-legend">
                    <span><span class="leg-dot" style="background:#16a34a"></span>Receitas</span>
                    <span><span class="leg-dot" style="background:#dc2626"></span>Despesas</span>
                </div>
                ${sparklineSVG}
            </div>` : ''}

            ${topReceitas.length > 0 || topDespesas.length > 0 ? `
            <div class="rel-section-title">Principais Lançamentos</div>
            <div class="rel-tops">
                <div class="rel-top-card">
                    <h4 class="rec">↑ Top Receitas</h4>
                    ${topReceitas.map(([nome, v]) => `
                    <div class="rel-top-item">
                        <span class="rel-top-name">${nome}</span>
                        <span class="rel-top-val rec">${fmt(v.total)}</span>
                    </div>`).join('')}
                    ${topReceitas.length === 0 ? '<div style="color:#9ca3af;font-size:12px;padding:8px 0;">Nenhuma receita</div>' : ''}
                </div>
                <div class="rel-top-card">
                    <h4 class="desp">↓ Top Despesas</h4>
                    ${topDespesas.map(([nome, v]) => `
                    <div class="rel-top-item">
                        <span class="rel-top-name">${nome}</span>
                        <span class="rel-top-val desp">${fmt(v.total)}</span>
                    </div>`).join('')}
                    ${topDespesas.length === 0 ? '<div style="color:#9ca3af;font-size:12px;padding:8px 0;">Nenhuma despesa</div>' : ''}
                </div>
            </div>` : ''}

            ${isMultiMes ? `
            <div class="rel-section-title">Resumo por Mês</div>
            <table class="rel-month-table">
                <thead>
                    <tr>
                        <th>Mês</th>
                        <th>Receitas</th>
                        <th>Despesas</th>
                        <th>Saldo</th>
                        <th>Margem</th>
                    </tr>
                </thead>
                <tbody>
                    ${mesesKeys.map(k => {
                        const m = porMes[k];
                        const s = m.receitas - m.despesas;
                        const mg = m.receitas > 0 ? ((s/m.receitas)*100).toFixed(1) : '—';
                        const [,mn] = k.split('-');
                        return `<tr>
                            <td><strong>${mesesNome[parseInt(mn)-1]}/${k.split('-')[0]}</strong></td>
                            <td style="color:#16a34a">${fmt(m.receitas)}</td>
                            <td style="color:#dc2626">${fmt(m.despesas)}</td>
                            <td style="color:${s>=0?'#16a34a':'#dc2626'}">${fmt(s)}</td>
                            <td style="color:#7c3aed">${mg !== '—' ? mg+'%' : '—'}</td>
                        </tr>`;
                    }).join('')}
                    <tr>
                        <td><strong>TOTAL</strong></td>
                        <td style="color:#16a34a"><strong>${fmt(totalReceitas)}</strong></td>
                        <td style="color:#dc2626"><strong>${fmt(totalDespesas)}</strong></td>
                        <td style="color:${saldoLiquido>=0?'#16a34a':'#dc2626'}"><strong>${fmt(saldoLiquido)}</strong></td>
                        <td style="color:#7c3aed"><strong>${margem}%</strong></td>
                    </tr>
                </tbody>
            </table>` : ''}

            ${lancamentos.length > 0 ? `
            <div class="rel-section-title">Lançamentos Detalhados</div>
            <table class="rel-detail-table">
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Descrição</th>
                        <th>Tipo</th>
                        <th>Valor</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${lancamentos.map(l => {
                        const v = parseFloat(l.valor);
                        const dt = formatarData(l.data_vencimento);
                        const parte = l.tipo === 'Receita'
                            ? (l.cliente_nome || '')
                            : (l.beneficiario || '');
                        const parteHtml = parte
                            ? `<div style="font-size:10px;color:#6b7280;font-weight:500;margin-top:2px;">${parte}</div>`
                            : '';
                        return `<tr>
                            <td style="color:#6b7280;white-space:nowrap;">${dt}</td>
                            <td style="max-width:260px;">
                                <div style="font-weight:500;">${l.descricao}</div>
                                ${parteHtml}
                            </td>
                            <td><span class="badge ${l.tipo==='Receita'?'badge-rec':'badge-desp'}">${l.tipo}</span></td>
                            <td style="font-weight:700;color:${l.tipo==='Receita'?'#16a34a':'#dc2626'};white-space:nowrap;">${fmt(v)}</td>
                            <td><span class="badge ${l.status==='Pago'?'badge-pago':'badge-pend'}">${l.status}</span></td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>` : `
            <div style="text-align:center;padding:48px 20px;color:#9ca3af;">
                <div style="font-size:40px;margin-bottom:12px;">📭</div>
                <p style="font-weight:600;">Nenhum lançamento encontrado neste período</p>
            </div>`}

            <div class="rel-footer">
                <span>LawTech Pro — Sistema Jurídico Inteligente</span>
                <span>Relatório Financeiro · ${periodo}</span>
            </div>

        </div>
    </div>
    `;
}


async function gerarPDFRelatorio() {
    const conteudo = document.getElementById('conteudoRelatorio');
    if (!conteudo || !conteudo.innerHTML.trim()) {
        alert('⚠️ Clique em VISUALIZAR primeiro para carregar o relatório.');
        return;
    }

    const btns = document.querySelectorAll('[data-action="gerarPDFRelatorio"]');
    btns.forEach(b => { b._orig = b.innerHTML; b.innerHTML = '⏳ Gerando PDF...'; b.disabled = true; });

    // Monta o CSS completo do relatório
    const estilosRelatorio = `
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, Helvetica, sans-serif; color: #1a1a2e; }
        .rel-wrap { background: #fff; }
        .rel-header { background: #1E3A5F; color: #fff; padding: 32px 40px 24px; position: relative; overflow: hidden; }
        .rel-header::after { content: ''; position: absolute; right: -40px; top: -40px; width: 200px; height: 200px; background: rgba(255,255,255,0.06); border-radius: 50%; }
        .rel-header-top { display: flex; justify-content: space-between; align-items: flex-start; }
        .rel-logo { font-size: 22px; font-weight: 800; color: #fff; }
        .rel-logo span { opacity: 0.7; font-weight: 400; font-size: 13px; display: block; margin-top: 2px; }
        .rel-periodo-badge { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; color: #fff; }
        .rel-title { font-size: 28px; font-weight: 800; color: #fff; margin: 20px 0 4px; }
        .rel-subtitle { color: rgba(255,255,255,0.75); font-size: 13px; }
        .rel-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 24px 40px; background: #f8fafc; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; }
        .rel-kpi { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px 18px; position: relative; }
        .rel-kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #6b7280; margin-bottom: 8px; }
        .rel-kpi-value { font-size: 20px; font-weight: 800; }
        .rel-kpi-sub { font-size: 11px; color: #9ca3af; margin-top: 4px; }
        .rel-kpi-dot { width: 8px; height: 8px; border-radius: 50%; position: absolute; top: 16px; right: 16px; }
        .kpi-receita .rel-kpi-value { color: #16a34a; } .kpi-receita .rel-kpi-dot { background: #16a34a; }
        .kpi-despesa .rel-kpi-value { color: #dc2626; } .kpi-despesa .rel-kpi-dot { background: #dc2626; }
        .kpi-saldo .rel-kpi-value { color: #16a34a; } .kpi-saldo .rel-kpi-dot { background: #16a34a; }
        .kpi-margem .rel-kpi-value { color: #7c3aed; } .kpi-margem .rel-kpi-dot { background: #7c3aed; }
        .rel-body { padding: 28px 40px; border: 1px solid #e5e7eb; border-top: none; }
        .rel-section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; display: flex; align-items: center; gap: 8px; margin: 0 0 14px; }
        .rel-section-title::after { content: ''; flex: 1; height: 1px; background: #e5e7eb; }
        .rel-spark-wrap { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px; }
        .rel-spark-legend { display: flex; gap: 20px; margin-bottom: 12px; font-size: 12px; }
        .rel-spark-legend span { display: flex; align-items: center; gap: 6px; font-weight: 600; }
        .leg-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
        .rel-tops { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
        .rel-top-card { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px 20px; }
        .rel-top-card h4 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; margin: 0 0 12px; }
        .rel-top-card h4.rec { color: #16a34a; } .rel-top-card h4.desp { color: #dc2626; }
        .rel-top-item { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid #e5e7eb; font-size: 12px; }
        .rel-top-item:last-child { border-bottom: none; }
        .rel-top-name { color: #374151; font-weight: 500; }
        .rel-top-val { font-weight: 700; margin-left: 8px; }
        .rel-top-val.rec { color: #16a34a; } .rel-top-val.desp { color: #dc2626; }
        .rel-month-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
        .rel-month-table th { background: #1E3A5F; color: #fff; padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; }
        .rel-month-table th:not(:first-child) { text-align: right; }
        .rel-month-table td { padding: 10px 14px; border-bottom: 1px solid #e5e7eb; }
        .rel-month-table td:not(:first-child) { text-align: right; font-weight: 600; }
        .rel-month-table tr:last-child td { border-bottom: none; font-weight: 700; background: #f8fafc; }
        .rel-detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .rel-detail-table thead th { background: #f1f5f9; color: #475569; padding: 9px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
        .rel-detail-table thead th:last-child, .rel-detail-table thead th:nth-child(4) { text-align: right; }
        .rel-detail-table tbody td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .rel-detail-table tbody td:last-child, .rel-detail-table tbody td:nth-child(4) { text-align: right; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; }
        .badge-rec { background: #dcfce7; color: #16a34a; }
        .badge-desp { background: #fee2e2; color: #dc2626; }
        .badge-pago { background: #dcfce7; color: #15803d; }
        .badge-pend { background: #fef3c7; color: #d97706; }
        .rel-footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; }
    `;

    // Abre janela popup visível (necessário para html2canvas funcionar)
    const win = window.open('', '_blank', 'width=900,height=700,left=50,top=50');
    if (!win) {
        alert('Permita pop-ups para gerar o PDF.');
        btns.forEach(b => { b.innerHTML = b._orig; b.disabled = false; });
        return;
    }

    win.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>${estilosRelatorio}</style>
</head><body>
<div id="capture-root" style="width:860px;background:#fff;">${conteudo.innerHTML}</div>
</body></html>`);
    win.document.close();

    // Aguarda o conteúdo renderizar completamente
    await new Promise(resolve => {
        win.onload = resolve;
        setTimeout(resolve, 800); // fallback
    });

    try {
        // Captura via html2canvas DA JANELA POPUP (visível = renderiza corretamente)
        const captureEl = win.document.getElementById('capture-root');
        const canvas = await html2canvas(captureEl, {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            width: 860,
            windowWidth: 900
        });

        win.close();

        // Gera PDF com jsPDF
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 8;
        const usableW = pageW - margin * 2;
        const totalImgH = usableW * (canvas.height / canvas.width);
        const pageImgH = pageH - margin * 2;

        let yOffset = 0;
        let page = 0;
        while (yOffset < totalImgH) {
            if (page > 0) doc.addPage();
            const srcY    = (yOffset / totalImgH) * canvas.height;
            const srcH    = Math.min((pageImgH / totalImgH) * canvas.height, canvas.height - srcY);
            const slice   = document.createElement('canvas');
            slice.width   = canvas.width;
            slice.height  = srcH;
            slice.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
            const sliceH  = (srcH / canvas.height) * totalImgH;
            doc.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, usableW, sliceH);
            yOffset += pageImgH;
            page++;
        }

        // Nome do arquivo
        const periodoEl = conteudo.querySelector('.rel-periodo-badge');
        const periodo   = periodoEl
            ? periodoEl.textContent.trim().replace(/[^\w\s\u00C0-\u024F]/g, '').trim().replace(/\s+/g, '-')
            : new Date().toISOString().split('T')[0];
        doc.save(`relatorio-financeiro-${periodo}.pdf`);

    } catch (err) {
        win.close();
        console.error('Erro ao gerar PDF:', err);
        alert('Erro ao gerar PDF: ' + err.message);
    } finally {
        btns.forEach(b => { b.innerHTML = b._orig; b.disabled = false; });
    }
}
async function imprimirInteligente() {
    // Sempre usa o mês visível na tela (navegação atual) para imprimir
    const mesInput = document.getElementById('relatorioMes');
    if (mesInput) {
        const m = window._finMes || (new Date().getMonth() + 1);
        const a = window._finAno || new Date().getFullYear();
        mesInput.value = `${a}-${String(m).padStart(2, '0')}`;
    }

    const btnImprimir = document.querySelector('[data-action="imprimirInteligente"]');
    if (btnImprimir) { btnImprimir._orig = btnImprimir.innerHTML; btnImprimir.innerHTML = '⏳ Preparando...'; btnImprimir.disabled = true; }

    try {
        const dados = await buscarDadosRelatorio();
        if (!dados) return; // buscarDadosRelatorio já mostra alerta se faltar algo

        const htmlRelatorio = gerarHTMLRelatorio(dados);

        const estilos = `
            *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
            html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            body { font-family: Arial, sans-serif; background: #fff; color: #1a1a2e; }
            .rel-header { background: #1E3A5F; color: #fff; padding: 32px 40px 24px; position: relative; overflow: hidden; }
            .rel-header::after { content: ''; position: absolute; right: -40px; top: -40px; width: 200px; height: 200px; background: rgba(255,255,255,0.06); border-radius: 50%; }
            .rel-header-top { display: flex; justify-content: space-between; align-items: flex-start; }
            .rel-logo { font-size: 22px; font-weight: 800; color: #fff; }
            .rel-logo span { opacity: 0.7; font-weight: 400; font-size: 13px; display: block; margin-top: 2px; }
            .rel-periodo-badge { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; color: #fff; }
            .rel-title { font-size: 28px; font-weight: 800; color: #fff; margin: 20px 0 4px; }
            .rel-subtitle { color: rgba(255,255,255,0.75); font-size: 13px; }
            .rel-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 24px 40px; background: #f8fafc; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; }
            .rel-kpi { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px 18px; position: relative; }
            .rel-kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #6b7280; margin-bottom: 8px; }
            .rel-kpi-value { font-size: 20px; font-weight: 800; }
            .rel-kpi-sub { font-size: 11px; color: #9ca3af; margin-top: 4px; }
            .rel-kpi-dot { width: 8px; height: 8px; border-radius: 50%; position: absolute; top: 16px; right: 16px; }
            .kpi-receita .rel-kpi-value { color: #16a34a; } .kpi-receita .rel-kpi-dot { background: #16a34a; }
            .kpi-despesa .rel-kpi-value { color: #dc2626; } .kpi-despesa .rel-kpi-dot { background: #dc2626; }
            .kpi-saldo .rel-kpi-value { color: #16a34a; } .kpi-saldo .rel-kpi-dot { background: #16a34a; }
            .kpi-margem .rel-kpi-value { color: #7c3aed; } .kpi-margem .rel-kpi-dot { background: #7c3aed; }
            .rel-body { padding: 28px 40px; border: 1px solid #e5e7eb; border-top: none; }
            .rel-section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; display: flex; align-items: center; gap: 8px; margin: 0 0 14px; }
            .rel-section-title::after { content: ''; flex: 1; height: 1px; background: #e5e7eb; }
            .rel-spark-wrap { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px; }
            .rel-spark-legend { display: flex; gap: 20px; margin-bottom: 12px; font-size: 12px; }
            .rel-spark-legend span { display: flex; align-items: center; gap: 6px; font-weight: 600; }
            .leg-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
            .rel-tops { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
            .rel-top-card { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px 20px; }
            .rel-top-card h4 { font-size: 12px; font-weight: 700; text-transform: uppercase; margin: 0 0 12px; }
            .rel-top-card h4.rec { color: #16a34a; } .rel-top-card h4.desp { color: #dc2626; }
            .rel-top-item { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #e5e7eb; font-size: 12px; }
            .rel-top-item:last-child { border-bottom: none; }
            .rel-top-val { font-weight: 700; } .rel-top-val.rec { color: #16a34a; } .rel-top-val.desp { color: #dc2626; }
            .rel-month-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
            .rel-month-table th { background: #1E3A5F; color: #fff; padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; }
            .rel-month-table th:not(:first-child) { text-align: right; }
            .rel-month-table td { padding: 10px 14px; border-bottom: 1px solid #e5e7eb; }
            .rel-month-table td:not(:first-child) { text-align: right; font-weight: 600; }
            .rel-month-table tr:last-child td { border-bottom: none; font-weight: 700; background: #f8fafc; }
            .rel-detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
            .rel-detail-table thead th { background: #f1f5f9; color: #475569; padding: 9px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
            .rel-detail-table thead th:last-child, .rel-detail-table thead th:nth-child(4) { text-align: right; }
            .rel-detail-table tbody td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
            .rel-detail-table tbody td:last-child, .rel-detail-table tbody td:nth-child(4) { text-align: right; }
            .badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; }
            .badge-rec { background: #dcfce7; color: #16a34a; }
            .badge-desp { background: #fee2e2; color: #dc2626; }
            .badge-pago { background: #dcfce7; color: #15803d; }
            .badge-pend { background: #fef3c7; color: #d97706; }
            .rel-footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; }
            @media print {
                @page { margin: 12mm 10mm; size: A4; }
                * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            }
        `;

        const win = window.open('', '_blank', 'width=920,height=750');
        if (!win) { alert('Permita pop-ups para imprimir.'); return; }

        win.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/>
<title>Relatório de Faturamento — LawTech Pro</title>
<style>${estilos}</style>
</head><body>${htmlRelatorio}</body></html>`);
        win.document.close();

        win.onload = function() {
            setTimeout(function() { win.focus(); win.print(); }, 350);
        };
        if (win.document.readyState === 'complete') {
            setTimeout(function() { win.focus(); win.print(); }, 400);
        }

    } catch(e) {
        console.error('Erro ao imprimir:', e);
        alert('Erro ao preparar impressão: ' + e.message);
    } finally {
        if (btnImprimir) { btnImprimir.innerHTML = btnImprimir._orig; btnImprimir.disabled = false; }
    }
}
function toggleIaMenu(event) {
    event.preventDefault(); // impede navegação imediata
    const submenu = document.getElementById('submenu-ia');
    submenu.classList.toggle('open');
}

        function aplicarPermissoesRoleUI(role) {
            if (role === 'admin') return;
            const s = document.createElement('style');
            if (role === 'operador') {
                s.textContent = `button[data-action='deletar'] { display: none !important; }`;
            } else {
                s.textContent = `button[data-action='deletar'], button[data-action='editarLancamento'], button[data-action='abrirModalLancamento'] { display: none !important; }`;
            }
            document.head.appendChild(s);
        }
    

(function(){var t=localStorage.getItem('token');if(!t)return;var _ci;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){if(r.status===402){clearInterval(_ci);return null;}return r.json()}).then(function(d){if(!d||!d.ok)return;var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}).catch(function(){})}checkChat();_ci=setInterval(checkChat,30000);})();

// --- HELPERS DE EVENT DELEGATION ---
function navegarPara(url) { window.location.href = url; }
function removerElemento(id) { const el = document.getElementById(id); if (el) el.remove(); }
function clicarElemento(id) { const el = document.getElementById(id); if (el) el.click(); }

function fecharModalCobranca() { document.getElementById('modalCobranca').style.display = 'none'; }
function fecharModalEditarLancamento() { document.getElementById('modalEditarLancamento').style.display = 'none'; }

// Cola isso no final do financeiro.js
window.abrirRelatorioFaturamento   = abrirRelatorioFaturamento;
window.fecharRelatorioFaturamento  = fecharRelatorioFaturamento;
window.fecharVisualizacaoRelatorio = fecharVisualizacaoRelatorio;
window.atualizarCamposPeriodo      = atualizarCamposPeriodo;
window.visualizarRelatorio         = visualizarRelatorio;
window.gerarPDFRelatorio           = gerarPDFRelatorio;
window.imprimirInteligente         = imprimirInteligente;
window.abrirModalLancamento        = abrirModalLancamento;
window.fecharModalLancamento       = fecharModalLancamento;
window.salvarLancamento            = salvarLancamento;
window.marcarComoPago              = marcarComoPago;
window.deletar                     = deletar;
window.editarLancamento            = editarLancamento;
window.atualizarLancamento         = atualizarLancamento;
window.prepararBoleto              = prepararBoleto;
window.confirmarBoleto             = confirmarBoleto;
window.prepararRecibo              = prepararRecibo;
window.fecharModalRecibo           = fecharModalRecibo;
window.gerarRecibo                 = gerarRecibo;
window.navegarMes = async function(delta) {
    if (!window._finMes) { window._finMes = new Date().getMonth()+1; window._finAno = new Date().getFullYear(); }
    window._finMes += delta;
    if (window._finMes > 12) { window._finMes = 1; window._finAno++; }
    if (window._finMes < 1)  { window._finMes = 12; window._finAno--; }
    carregarDados();
    carregarSaldoReal();
};
window.irParaHoje = function() {
    window._finMes = new Date().getMonth()+1;
    window._finAno = new Date().getFullYear();
    carregarDados();
    carregarSaldoReal();
};
window.abrirModalLogo              = abrirModalLogo;
window.fecharModalLogo             = fecharModalLogo;
window.uploadLogo                  = uploadLogo;
window.uploadAssinatura            = uploadAssinatura;
window.preencherDadosCliente       = preencherDadosCliente;
window.toggleParteAdicionar        = toggleParteAdicionar;
window.toggleParteEditar           = toggleParteEditar;
window.toggleUserMenu              = toggleUserMenu;
window.toggleIaMenu                = toggleIaMenu;
window.logout                      = logout;
window.rolarParaTabela             = rolarParaTabela;
window.limparBolinha               = limparBolinha;
window.navegarPara                 = navegarPara;
window.removerElemento             = removerElemento;
window.clicarElemento              = clicarElemento;
window.fecharModalCobranca         = fecharModalCobranca;
window.fecharModalEditarLancamento = fecharModalEditarLancamento;