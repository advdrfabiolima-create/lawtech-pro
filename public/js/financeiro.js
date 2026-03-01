
        const token = localStorage.getItem('token');
        if (!token) window.location.href = '/login.html';
        
        let originalData = [];
        let financeChart;
        let lancamentoParaCobrar = null;
        let clientesCadastrados = []; // Lista de clientes para o select

        // --- INICIALIZAÇÃO ÚNICA ---
        document.addEventListener('DOMContentLoaded', async () => {
            console.log('📄 DOM carregado');
            setTimeout(async () => {
                await inicializar();
                await carregarClientesParaBoleto();
                await carregarClientesParaRecibo(); // Nova função
                await carregarSaldoReal();
                await carregarLogoAtual();
                await carregarAssinaturaAtual();
            }, 100);
        });

        window.onload = async () => {
            console.log('🌐 Window carregado');
            await inicializar();
            await carregarClientesParaBoleto();
            await carregarClientesParaRecibo(); // Nova função
            await carregarSaldoReal();
            await carregarLogoAtual();
            await carregarAssinaturaAtual();
        };

async function inicializar() {
    try {
        console.log('🔄 Inicializando página financeira...');
        
        const resU = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
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

        const resP = await fetch('/api/plano-consumo', { headers: { Authorization: `Bearer ${token}` } });
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
            const res = await fetch('/api/financeiro', { headers: { Authorization: `Bearer ${token}` } });
            originalData = await res.json();
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
                    <button class="btn-mini-boleto" onclick="prepararBoleto(${item.id}, '${item.descricao}', ${v})">
                        <i data-lucide="barcode"></i> BOLETO
                    </button>
                </div>`;
        }

        const btnPagar = !isP ? `<button onclick="marcarComoPago(${item.id})" style="background: var(--accent-green); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s; margin-right: 6px;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='var(--accent-green)'" title="Marcar como Pago"><i data-lucide="check" style="width:14px; height:14px;"></i></button>` : '';
        const btnRecibo = isP ? `<button onclick="prepararRecibo(${item.id})" style="background: var(--accent-purple); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s; margin-right: 6px;" onmouseover="this.style.background='#7c3aed'" onmouseout="this.style.background='var(--accent-purple)'" title="Emitir Recibo"><i data-lucide="file-text" style="width:14px; height:14px;"></i></button>` : '';
        const btnEditar = `<button onclick="editarLancamento(${item.id})" style="background: var(--accent-blue); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s; margin-right: 6px;" onmouseover="this.style.background='var(--accent-blue-light)'" onmouseout="this.style.background='var(--accent-blue)'" title="Editar"><i data-lucide="pencil" style="width:14px; height:14px;"></i></button>`;
        const btnExcluir = `<button onclick="deletar(${item.id})" style="background: var(--accent-red); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s;" onmouseover="this.style.background='#dc2626'" onmouseout="this.style.background='var(--accent-red)'" title="Excluir"><i data-lucide="trash-2" style="width:14px; height:14px;"></i></button>`;

        corpo.innerHTML += `
            <tr>
                <td><strong>${item.descricao}</strong></td>
                <td><strong style="color: ${isR ? 'var(--success)' : 'var(--danger)'}">R$ ${v.toLocaleString('pt-BR', {minimumFractionDigits:2})}</strong></td>
                <td>${new Date(item.data_vencimento).toLocaleDateString('pt-BR')}</td>
                <td><span style="font-weight:700; font-size:11px; color: ${isP ? 'var(--success)' : 'var(--warning)'}}">${item.status.toUpperCase()}</span></td>
                <td style="text-align: center; white-space: nowrap;">
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
    const descricao = document.getElementById('addDescricao').value;
    const valorComMascara = document.getElementById('addValor').value; 
    const tipo = document.getElementById('addTipo').value;
    const data_vencimento = document.getElementById('addData').value;

    if(!descricao || !valorComMascara || !data_vencimento) return alert("Preencha todos os campos!");

    const valorNumerico = parseFloat(valorComMascara.replace("R$", "").replace(/\./g, "").replace(",", ".").trim());

    const dados = { descricao, valor: valorNumerico, tipo, data_vencimento };

    try {
        const res = await fetch('/api/financeiro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(dados)
        });

        if (res.ok) {
            alert("Lançamento salvo!");
            fecharModalLancamento();
            location.reload();
        } else {
            const erro = await res.json();
            alert("Erro: " + erro.erro);
        }
    } catch (err) {
        alert("Erro de conexão com o servidor.");
    }
}

        async function marcarComoPago(id) {
            if(!confirm("Deseja marcar como Pago?")) return;
            const res = await fetch(`/api/financeiro/${id}/pagar`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
            if(res.ok) carregarDados();
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

    document.getElementById('editId').value = item.id;
    document.getElementById('editDescricao').value = item.descricao;
    document.getElementById('editValor').value = item.valor;
    document.getElementById('editTipo').value = item.tipo;
    
    const dataFormatada = new Date(item.data_vencimento).toISOString().split('T')[0];
    document.getElementById('editData').value = dataFormatada;

    document.getElementById('modalEditarLancamento').style.display = 'flex';
}

async function atualizarLancamento() {
    const id = document.getElementById('editId').value;
    const dados = {
        descricao: document.getElementById('editDescricao').value,
        valor: document.getElementById('editValor').value,
        tipo: document.getElementById('editTipo').value,
        data_vencimento: document.getElementById('editData').value
    };

    try {
        const res = await fetch(`/api/financeiro/${id}`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(dados)
        });

        if (res.ok) {
            document.getElementById('modalEditarLancamento').style.display = 'none';
            carregarDados();
        } else {
            alert("Erro ao atualizar lançamento.");
        }
    } catch (err) {
        console.error(err);
        alert("Erro de conexão.");
    }
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

        // --- FUNÇÕES DE RECIBO ---
        
        // Carregar clientes cadastrados para o select do recibo
        async function carregarClientesParaRecibo() {
            try {
                const res = await fetch('/api/clientes', {
                    headers: { Authorization: `Bearer ${token}` }
                });

                if (!res.ok) {
                    throw new Error('Erro ao carregar clientes');
                }

                clientesCadastrados = await res.json();
                
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
        const res = await fetch('/api/clientes', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error('Erro ao carregar clientes');
        
        const clientes = await res.json();
        
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
            
            // Limpa seleção de cliente
            document.getElementById('reciboClienteSelect').value = '';
            document.getElementById('reciboClienteNome').value = '';
            document.getElementById('reciboClienteDoc').value = '';
            
            document.getElementById('modalRecibo').style.display = 'flex';
            
            // Recarrega ícones do Lucide
            if (window.lucide) {
                lucide.createIcons();
            }
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

        async function gerarRecibo() {
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

            const btn = event.target;
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
            document.getElementById('modalLogo').style.display = 'flex';
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
        const res = await fetch('/api/clientes', { 
            headers: { Authorization: `Bearer ${token}` } 
        });
        
        if (!res.ok) throw new Error("Erro na requisição");

        const clientes = await res.json();
        
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
        const res = await fetch('/api/financeiro/saldo-real', { 
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
                <button onclick="window.location.href='/planos-page'" style="background:linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); color:#000; border:none; padding:14px 28px; border-radius:10px; font-weight:800; cursor:pointer; width:100%; margin-bottom:10px;">
                    Ver Planos e Preços
                </button>
                <button onclick="document.getElementById('overlay-upgrade').remove()" style="background:none; border:none; color:#64748b; cursor:pointer; font-weight:600; padding:8px;">
                    Depois
                </button>
            </div>`;
            document.body.appendChild(overlay);
        }

        // ==========================================
// 📊 RELATÓRIO DE FATURAMENTO
// ==========================================

function abrirRelatorioFaturamento() {
    document.getElementById('modalRelatorioFaturamento').style.display = 'flex';
    
    // Define mês atual como padrão
    const hoje = new Date();
    const mesAtual = hoje.toISOString().substring(0, 7); // YYYY-MM
    document.getElementById('relatorioMes').value = mesAtual;
}

function fecharRelatorioFaturamento() {
    document.getElementById('modalRelatorioFaturamento').style.display = 'none';
}

function fecharVisualizacaoRelatorio() {
    document.getElementById('modalVisualizacaoRelatorio').style.display = 'none';
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
    
    // Fechar modal de configuração e abrir visualização
    fecharRelatorioFaturamento();
    document.getElementById('modalVisualizacaoRelatorio').style.display = 'flex';
    
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

function gerarHTMLRelatorio(dados) {
    const { periodo, lancamentos } = dados;
    
    // Calcular totais
    let totalReceitas = 0;
    let totalDespesas = 0;
    
    lancamentos.forEach(lanc => {
        const valor = parseFloat(lanc.valor);
        if (lanc.tipo === 'Receita') {
            totalReceitas += valor;
        } else {
            totalDespesas += valor;
        }
    });
    
    const lucroLiquido = totalReceitas - totalDespesas;
    
    // Agrupar por mês (se for relatório anual)
    const porMes = {};
    lancamentos.forEach(lanc => {
        const mes = lanc.data_vencimento.substring(0, 7); // YYYY-MM
        if (!porMes[mes]) {
            porMes[mes] = { receitas: 0, despesas: 0 };
        }
        
        const valor = parseFloat(lanc.valor);
        if (lanc.tipo === 'Receita') {
            porMes[mes].receitas += valor;
        } else {
            porMes[mes].despesas += valor;
        }
    });
    
    let html = `
        <div style="text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid var(--border-medium);">
            <h2 style="font-size: 24px; font-weight: 900; margin-bottom: 8px;">Relatório de Faturamento</h2>
            <p style="font-size: 16px; color: var(--text-secondary); font-weight: 600;">${periodo}</p>
            <p style="font-size: 12px; color: var(--muted); margin-top: 8px;">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
        </div>
        
        <!-- Resumo Geral -->
        <div class="relatorio-resumo">
            <h3 style="font-weight: 800; margin-bottom: 15px; text-align: center;">💰 Resumo Financeiro</h3>
            <div class="relatorio-resumo-grid">
                <div class="relatorio-resumo-item">
                    <div class="relatorio-resumo-label">Total Receitas</div>
                    <div class="relatorio-resumo-valor valor-positivo">R$ ${totalReceitas.toFixed(2).replace('.', ',')}</div>
                </div>
                <div class="relatorio-resumo-item">
                    <div class="relatorio-resumo-label">Total Despesas</div>
                    <div class="relatorio-resumo-valor valor-negativo">R$ ${totalDespesas.toFixed(2).replace('.', ',')}</div>
                </div>
                <div class="relatorio-resumo-item">
                    <div class="relatorio-resumo-label">Lucro Líquido</div>
                    <div class="relatorio-resumo-valor ${lucroLiquido >= 0 ? 'valor-positivo' : 'valor-negativo'}">
                        R$ ${lucroLiquido.toFixed(2).replace('.', ',')}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Se for anual, mostrar breakdown por mês
    if (Object.keys(porMes).length > 1) {
        html += `
            <h3 style="font-weight: 800; margin: 30px 0 15px 0;">📅 Breakdown Mensal</h3>
            <table class="relatorio-table">
                <thead>
                    <tr>
                        <th>Mês</th>
                        <th style="text-align: right;">Receitas</th>
                        <th style="text-align: right;">Despesas</th>
                        <th style="text-align: right;">Saldo</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        Object.keys(porMes).sort().forEach(mesKey => {
            const mes = porMes[mesKey];
            const saldo = mes.receitas - mes.despesas;
            const [ano, mesNum] = mesKey.split('-');
            const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
            const mesNome = `${meses[parseInt(mesNum) - 1]}/${ano}`;
            
            html += `
                <tr>
                    <td><strong>${mesNome}</strong></td>
                    <td style="text-align: right; color: var(--accent-green);">R$ ${mes.receitas.toFixed(2).replace('.', ',')}</td>
                    <td style="text-align: right; color: var(--accent-red);">R$ ${mes.despesas.toFixed(2).replace('.', ',')}</td>
                    <td style="text-align: right; font-weight: 700; color: ${saldo >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'};">
                        R$ ${saldo.toFixed(2).replace('.', ',')}
                    </td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
    }
    
    // Tabela detalhada de lançamentos
    if (lancamentos.length > 0) {
        html += `
            <h3 style="font-weight: 800; margin: 30px 0 15px 0;">📋 Lançamentos Detalhados</h3>
            <table class="relatorio-table">
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Descrição</th>
                        <th>Tipo</th>
                        <th style="text-align: right;">Valor</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        lancamentos.forEach(lanc => {
            const valor = parseFloat(lanc.valor);
            const corValor = lanc.tipo === 'Receita' ? 'var(--accent-green)' : 'var(--accent-red)';
            const corStatus = lanc.status === 'Pago' ? 'var(--accent-green)' : 'var(--accent-orange)';
            
            html += `
                <tr>
                    <td>${new Date(lanc.data_vencimento).toLocaleDateString('pt-BR')}</td>
                    <td>${lanc.descricao}</td>
                    <td>
                        <span style="padding: 4px 12px; background: ${lanc.tipo === 'Receita' ? '#d1fae5' : '#fee2e2'}; 
                                     color: ${corValor}; border-radius: 20px; font-size: 11px; font-weight: 700;">
                            ${lanc.tipo}
                        </span>
                    </td>
                    <td style="text-align: right; font-weight: 700; color: ${corValor};">
                        R$ ${valor.toFixed(2).replace('.', ',')}
                    </td>
                    <td>
                        <span style="padding: 4px 12px; background: ${lanc.status === 'Pago' ? '#d1fae5' : '#fef3c7'}; 
                                     color: ${corStatus}; border-radius: 20px; font-size: 11px; font-weight: 700;">
                            ${lanc.status}
                        </span>
                    </td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
    } else {
        html += `
            <div style="text-align: center; padding: 60px 20px; color: var(--muted);">
                <i data-lucide="inbox" style="width: 64px; height: 64px; margin-bottom: 20px; opacity: 0.3;"></i>
                <p style="font-size: 16px; font-weight: 600;">Nenhum lançamento encontrado neste período</p>
            </div>
        `;
    }
    
    return html;
}

async function gerarPDFRelatorio() {
    // Usando impressão do navegador como alternativa
    // O backend pode implementar a rota /api/financeiro/relatorio-pdf futuramente
    alert("📄 Use a opção Imprimir e salve como PDF no seu navegador.");
    window.print();
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
                s.textContent = `button[onclick*='deletar('] { display: none !important; }`;
            } else {
                s.textContent = `button[onclick*='deletar('], button[onclick*='editarLancamento'], button[onclick*='abrirModalLancamento'] { display: none !important; }`;
            }
            document.head.appendChild(s);
        }
    

(function(){var t=localStorage.getItem('token');if(!t)return;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){return r.json()}).then(function(d){if(d.ok){var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}}).catch(function(){})}checkChat();setInterval(checkChat,30000)})();
