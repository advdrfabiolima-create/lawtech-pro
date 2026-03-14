const token = localStorage.getItem('token');
    let dadosSalvos = false;
    if (!token) window.location.href = '/login.html';

    // 0. UTILITÁRIOS DE DELEGAÇÃO
    function clicarElemento(id) {
        const el = document.getElementById(id);
        if (el) el.click();
    }
    function navegarPara(url) { window.location.href = url; }
    function removerElemento(id) { const el = document.getElementById(id); if (el) el.remove(); }

    // 1. MÁSCARAS E UTILITÁRIOS
    function mascaraCEP(i) {
        let v = i.value.replace(/\D/g, ''); 
        if (v.length > 5) i.value = v.slice(0, 2) + '.' + v.slice(2, 5) + '-' + v.slice(5, 8);
        else if (v.length > 2) i.value = v.slice(0, 2) + '.' + v.slice(2);
    }

    async function buscarCep() {
        const inputCep = document.getElementById('confCep');
        if (!inputCep) return;
        const cepRaw = inputCep.value.replace(/\D/g, '');
        if (cepRaw.length !== 8) return;
        try {
            const res = await fetch(`https://viacep.com.br/ws/${cepRaw}/json/`);
            const data = await res.json();
            if (!data.erro) {
                if(document.getElementById('confEndereco')) document.getElementById('confEndereco').value = `${data.logradouro}, ${data.bairro}`;
                if(document.getElementById('confCidade')) document.getElementById('confCidade').value = data.localidade;
                if(document.getElementById('confEstado')) document.getElementById('confEstado').value = data.uf;
            }
        } catch (err) { console.error("Erro Viacep:", err); }
    }

    function mascaraMoeda(i) {
        let v = i.value.replace(/\D/g,'');
        v = (v/100).toFixed(2) + '';
        v = v.replace(".", ",");
        v = v.replace(/(\d)(\d{3})(\d{3}),/g, "$1.$2.$3,");
        v = v.replace(/(\d)(\d{3}),/g, "$1.$2,");
        i.value = 'R$ ' + v;
    }

    function ajustarMascaraDoc() {
        const inputDoc = document.getElementById('confDocumento');
        const groupData = document.getElementById('groupDataNascimento');
        const radioCpf = document.querySelector('input[name="tipoDoc"]:checked');
        if (!inputDoc) return;
        
        inputDoc.value = '';
        const tipo = radioCpf ? radioCpf.value : 'CPF';
        if (tipo === 'CPF') {
            inputDoc.placeholder = '000.000.000-00';
            if (groupData) groupData.style.display = 'block';
        } else {
            inputDoc.placeholder = '00.000.000/0000-00';
            if (groupData) groupData.style.display = 'none';
        }
    }

    function aplicarMascaraDoc(i) {
        if (!i) return;
        const radioCpf = document.querySelector('input[name="tipoDoc"]:checked');
        const tipo = radioCpf ? radioCpf.value : 'CPF';
        let v = i.value.replace(/\D/g, '');
        if (tipo === 'CPF') {
            i.value = v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4").slice(0, 14);
        } else {
            i.value = v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5").slice(0, 18);
        }
    }

    function aplicarMascaraOAB(i) {
        let v = i.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (v.length > 6) i.value = v.slice(0, 3) + '.' + v.slice(3, 6) + '/' + v.slice(6, 8);
        else if (v.length > 3) i.value = v.slice(0, 3) + '.' + v.slice(3);
        else i.value = v;
    }

    // 2. CARREGAMENTO DE DADOS
    async function carregarBancos() {
        try {
            const res = await fetch('https://brasilapi.com.br/api/banks/v1');
            const bancos = await res.json();
            const select = document.getElementById('confBanco');
            if (!select) return;
            select.innerHTML = '<option value="">Selecione o Banco</option>';
            bancos.sort((a,b) => (a.fullName || "") > (b.fullName || "") ? 1 : -1).forEach(b => {
                if(b.code) select.innerHTML += `<option value="${b.code}">${b.code} - ${b.fullName || b.name}</option>`;
            });
        } catch (e) { console.error("Erro bancos:", e); }
    }

async function carregarInfoRodape() {
    try {
        // 1. Busca dados do Usuário (Identidade e Trial)
        const resUser = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        const dataUser = await resUser.json();
        
        if (dataUser.ok) {
            const user = dataUser.usuario;
            const nomeReal = user.nome || 'Advogado';
            
            // --- LÓGICA PADRONIZADA DO CABEÇALHO ---
            const primeiroNome = nomeReal.trim().split(' ')[0];
            document.getElementById('userNameHeader').innerText = primeiroNome;

            // Iniciais (Círculo)
            const partes = nomeReal.trim().split(' ').filter(n => n);
            let iniciais = partes[0][0];
            if (partes.length > 1) iniciais += partes[partes.length - 1][0];
            
            const circulo = document.getElementById('userCircle');
            if (circulo) circulo.innerText = iniciais.toUpperCase();

            // Preenchimento de E-mail e Nome no formulário
            // Nota: usei 'userEmailFooter' conforme o padrão de IDs corrigido anteriormente
            const footerEmail = document.getElementById('userEmailFooter');
            if (footerEmail) footerEmail.innerText = user.email;
            
            if(document.getElementById('perfilEmail')) document.getElementById('perfilEmail').value = user.email;
            if(document.getElementById('perfilNome')) document.getElementById('perfilNome').value = nomeReal;

            // 🔒 RBAC: Aplicar restrições baseadas na role do usuário
            aplicarRestricoesPorRole(user.role || 'visualizador');

            // ✅ LÓGICA CORRIGIDA: Verificar STATUS antes de mostrar card de trial
            // Aceita tanto 'status' quanto 'plano_financeiro_status' (compatibilidade)
            const status = user.plano_financeiro_status || user.status;
            const diasRestantes = user.dias_restantes !== undefined ? parseInt(user.dias_restantes) : null;
            
            console.log('📊 [CONFIG] Status:', status, '| Dias restantes:', diasRestantes, '| User:', user);
            
            // Se status é PAGO ou ATIVO - Mostrar card de assinatura ativa
            if (status === 'pago' || status === 'ativo') {
                exibirAssinaturaAtiva(user);
                
            // Se status é TRIAL e ainda tem dias - Mostrar card de trial
            } else if (status === 'trial' && diasRestantes !== null && diasRestantes > 0) {
                // Calcula a data de expiração baseada nos dias restantes
                const hoje = new Date();
                const dataExpiracao = new Date(hoje);
                dataExpiracao.setDate(dataExpiracao.getDate() + diasRestantes);
                
                const dataFormatada = dataExpiracao.toLocaleDateString('pt-BR');
                const elementoData = document.getElementById('dataExpiracaoTrial');
                if (elementoData) elementoData.innerText = dataFormatada;
                
                // Atualiza o texto para mostrar quantos dias faltam
                const textoTrial = document.getElementById('textoTrial');
                if (textoTrial) {
                    const textoPlural = diasRestantes === 1 ? 'dia' : 'dias';
                    textoTrial.innerHTML = `Seu teste vence em <strong style="font-weight: 800; color: #92400e;">${diasRestantes} ${textoPlural}</strong> (<strong style="font-weight: 800; color: #92400e;">${dataFormatada}</strong>)<br>
                    <span id="subtextoTrial" style="font-size: 12px;">Após esta data, a mensalidade será processada automaticamente no cartão cadastrado.</span>`;
                }
                
            // Se trial expirou mas ainda não pagou - Mostrar aviso
            } else if (status === 'trial' && diasRestantes !== null && diasRestantes <= 0) {
                exibirTrialExpirado();
                
            // Se inadimplente - Mostrar aviso
            } else if (status === 'inadimplente') {
                exibirInadimplente();
            }
        }

        // 2. Carregamento do Plano e Consumo
        const resPlan = await fetch('/api/plano-consumo', { headers: { Authorization: `Bearer ${token}` } });
        const dataPlan = await resPlan.json();
        const planFooter = document.getElementById('planNameFooter');
        if(planFooter) {
            planFooter.innerText = dataPlan.plano || 'Individual';
        }

        // 3. Carregamento dos dados do Escritório e Dados Bancários
        const resEsc = await fetch('/api/config/meu-escritorio', { headers: { Authorization: `Bearer ${token}` } });
        const dataEsc = await resEsc.json();
        
        if(dataEsc.ok && dataEsc.dados) {
            const d = dataEsc.dados;
            const campos = {
                'confAdvogadoResponsavel': d.advogado_responsavel,
                'confEscritorio': d.nome,
                'confOab': d.oab,
                'confDocumento': d.documento,
                'confDataNascimento': d.data_nascimento ? d.data_nascimento.split('T')[0] : '',
                'confCep': d.cep,
                'confCidade': d.cidade,
                'confEstado': d.estado,
                'confEndereco': d.endereco,
                'confAgencia': d.agencia,
                'confConta': d.conta,
                'confContaDigito': d.conta_digito,
                'confPixChave': d.pix_chave,
                'confBanco': d.banco_codigo
            };
            if (d.logo_base64) {
                mostrarLogoAtual(d.logo_base64);
            } else if (d.logo_arquivo) {
                mostrarLogoAtual('/' + d.logo_arquivo);
            }

            Object.keys(campos).forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = campos[id] || '';
            });

            // Restaurar tipo CPF/CNPJ pelo número de dígitos (sem limpar o campo)
            const docDigits = (d.documento || '').replace(/\D/g, '').length;
            const tipoDoc = docDigits === 14 ? 'CNPJ' : 'CPF';
            const radioTipo = document.querySelector(`input[name="tipoDoc"][value="${tipoDoc}"]`);
            if (radioTipo) radioTipo.checked = true;
            const groupData = document.getElementById('groupDataNascimento');
            if (groupData) groupData.style.display = tipoDoc === 'CPF' ? 'block' : 'none';

            // Dados carregados do servidor = já estão salvos, desabilitar botão
            const btnSalvar = document.getElementById('btnSalvarEscritorio');
            const btnEditar = document.getElementById('btnEditarEscritorio');
            if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.innerHTML = '✅ Dados Salvos'; }
            if (btnEditar) btnEditar.style.display = 'inline-block';

            if(d.renda_mensal && document.getElementById('confRendaMensal')) {
                document.getElementById('confRendaMensal').value = 'R$ ' + parseFloat(d.renda_mensal).toLocaleString('pt-BR', {minimumFractionDigits: 2});
            }

            // ✅ VERIFICAR SE FATURAMENTO JÁ ESTÁ ATIVADO
            if (d.plano_financeiro_status === 'ativo' || d.asaas_id) {
                const btnFaturamento = document.getElementById('btnAtivarFaturamento');
                if (btnFaturamento) {
                    btnFaturamento.disabled = true;
                    btnFaturamento.style.background = '#10b981';
                    btnFaturamento.style.opacity = '0.7';
                    btnFaturamento.style.cursor = 'not-allowed';
                    btnFaturamento.innerHTML = '✅ Faturamento Ativado';
                    btnFaturamento.onclick = null; // Remove o evento de click
                }
            }

            // ✅ LÓGICA DE CANCELAMENTO ATIVO (Mudar bloco para Vermelho)
            if (d.renovacao_automatica === false) {
                const container = document.getElementById('containerTrial');
                const iconeBox = document.getElementById('iconeTrialBox');
                const label = document.getElementById('labelTrial');
                const texto = document.getElementById('textoTrial');
                const btnAcao = document.getElementById('btnAcaoAssinatura');
                const elementoDataVenc = document.getElementById('dataExpiracaoTrial');
                const dataVenc = elementoDataVenc ? elementoDataVenc.innerText : "...";

                if (container) {
                    // 1. Muda Estilo do Card para Vermelho/Rosa suave
                    container.style.background = "#fef2f2";
                    container.style.borderColor = "#fecaca";
                }
                
                if (iconeBox) {
                    iconeBox.style.background = "#ef4444";
                    iconeBox.innerHTML = '<i data-lucide="x-circle" style="color: #fff; width: 18px; height: 18px;"></i>';
                }
                
                if (label) {
                    label.innerText = "RENOVAÇÃO CANCELADA";
                    label.style.color = "#991b1b";
                }

                if (texto) {
                    texto.style.color = "#991b1b";
                    texto.innerHTML = `Você cancelou sua assinatura antes de vencer o período de teste, portanto, <strong>não haverá cobranças em seu cartão.</strong><br>` +
                                    `<span style="font-size: 12px;">Seu acesso continuará liberado até o dia ${dataVenc}.</span>`;
                }

                // 2. Transforma o botão de "Cancelar" em "Reativar"
                if (btnAcao) {
                    btnAcao.style.background = "#f0fdf4";
                    btnAcao.style.borderColor = "#bbf7d0";
                    btnAcao.style.color = "#16a34a";
                    btnAcao.innerHTML = '<i class="lucide lucide-check-circle" style="width: 18px; height: 18px;"></i> Reativar Assinatura';
                    btnAcao.setAttribute("data-action", "reativarAssinatura");
                    btnAcao.removeAttribute("onclick");
                }

                // Reinicializa os ícones Lucide para renderizar o novo ícone de erro/check
                if(window.lucide) lucide.createIcons();
            }
        }
    } catch (err) { 
        console.warn("Aviso: Falha ao carregar alguns dados do perfil ou trial."); 
        console.error(err);
    }
}

    // 3. AÇÕES DE SALVAMENTO
    async function salvarPerfil() {
        const nome = document.getElementById('perfilNome').value;
        const res = await fetch('/api/config/perfil', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ nome })
        });
        if (res.ok) { alert("✅ Nome atualizado!"); carregarInfoRodape(); }
        else alert("❌ Erro ao atualizar.");
    }

    function mostrarLogoAtual(url) {
        const img = document.getElementById('logoPreviewImg');
        const placeholder = document.getElementById('logoPreviewPlaceholder');
        const btnRemover = document.getElementById('btnRemoverLogo');
        if (!img) return;
        img.src = url;
        img.style.display = 'block';
        placeholder.style.display = 'none';
        if (btnRemover) btnRemover.style.display = 'block';
        img.onerror = () => {
            img.style.display = 'none';
            placeholder.style.display = 'block';
            placeholder.textContent = 'sem logo';
            if (btnRemover) btnRemover.style.display = 'none';
        };
    }

    async function uploadLogo(input) {
        const file = input.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('logo', file);
        try {
            const res = await fetch('/api/config/logo', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                body: formData
            });
            const data = await res.json();
            if (data.ok) {
                mostrarLogoAtual(data.logo_base64 || ('/' + data.logo_arquivo + '?t=' + Date.now()));
                alert('✅ Logo enviada com sucesso!');
            } else {
                alert('❌ Erro: ' + (data.erro || 'Falha ao enviar logo.'));
            }
        } catch (err) {
            console.error(err);
            alert('❌ Erro de conexão ao enviar logo.');
        }
        input.value = '';
    }

    async function removerLogo() {
        if (!confirm('Deseja remover a logo do escritório?')) return;
        try {
            const res = await fetch('/api/config/logo', {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await res.json();
            if (data.ok) {
                const img = document.getElementById('logoPreviewImg');
                const placeholder = document.getElementById('logoPreviewPlaceholder');
                const btnRemover = document.getElementById('btnRemoverLogo');
                img.style.display = 'none';
                img.src = '';
                placeholder.style.display = 'block';
                placeholder.textContent = 'sem logo';
                if (btnRemover) btnRemover.style.display = 'none';
                alert('✅ Logo removida.');
            } else {
                alert('❌ Erro: ' + (data.erro || 'Falha ao remover logo.'));
            }
        } catch (err) {
            console.error(err);
            alert('❌ Erro de conexão.');
        }
    }

    async function salvarDadosJuridicos() {
        try {
            const rendaE = document.getElementById('confRendaMensal');
            const rendaTratada = rendaE ? rendaE.value.replace(/[R$\s.]/g, '').replace(',', '.') : 0;

            const dados = {
                advogado_responsavel: document.getElementById('confAdvogadoResponsavel')?.value || '',
                nome: document.getElementById('confEscritorio')?.value || '',
                oab: document.getElementById('confOab')?.value || '',
                documento: document.getElementById('confDocumento')?.value || '',
                dataNascimento: document.getElementById('confDataNascimento')?.value || null,
                email: document.getElementById('perfilEmail')?.value || '',
                endereco: document.getElementById('confEndereco')?.value || '',
                cidade: document.getElementById('confCidade')?.value || '',
                estado: document.getElementById('confEstado')?.value?.toUpperCase() || '',
                cep: document.getElementById('confCep')?.value?.replace(/\D/g, '') || '',
                banco_codigo: document.getElementById('confBanco')?.value || '',
                agencia: document.getElementById('confAgencia')?.value || '',
                conta: document.getElementById('confConta')?.value || '',
                conta_digito: document.getElementById('confContaDigito')?.value || '',
                pix_chave: document.getElementById('confPixChave')?.value || '',
                renda_mensal: parseFloat(rendaTratada) || 0
            };

            const res = await fetch('/api/config/escritorio', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(dados)
            });

            if (res.ok) {
                alert("✅ Dados salvos com sucesso!");
                const btnSalvar = document.getElementById('btnSalvarEscritorio');
                const btnEditar = document.getElementById('btnEditarEscritorio');
                if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.innerHTML = '✅ Dados Salvos'; }
                if (btnEditar) btnEditar.style.display = 'inline-block';
            } else {
                alert("❌ Erro ao salvar dados.");
            }
        } catch (e) { console.error(e); alert("Erro ao processar salvamento."); }
    }

    function habilitarEdicaoEscritorio() {
        const btnSalvar = document.getElementById('btnSalvarEscritorio');
        const btnEditar = document.getElementById('btnEditarEscritorio');
        if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.innerHTML = '💾 Salvar Dados do Escritório'; }
        if (btnEditar) btnEditar.style.display = 'none';
    }

    async function salvarDadosBancarios() {
    const dados = {
        banco_codigo: document.getElementById('confBanco').value,
        agencia: document.getElementById('confAgencia').value,
        conta: document.getElementById('confConta').value,
        conta_digito: document.getElementById('confContaDigito').value,
        pix_chave: document.getElementById('confPixChave').value
    };

    const res = await fetch('/api/config/escritorio', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(dados)
    });

    if (res.ok) {
        dadosSalvos = true;
        document.querySelector('.btn-primary').disabled = false;
    } else {
        const d = await res.json();
        alert('❌ ' + (d.erro || 'Erro ao salvar'));
    }
}

    async function ativarFinanceiro() {
    try {
        const btn = document.getElementById('btnAtivarFaturamento');
        
        if (btn) {
            btn.disabled = true;
            btn.innerText = "⏳ Ativando...";
        }

        // ✅ ROTA CORRETA
        const res = await fetch('/api/financeiro/ativar-subconta', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token') || token}`
            }
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.erro || `Erro ${res.status}`);
        }

        if (data.ok) {
            alert('✅ ' + (data.mensagem || 'Faturamento ativado com sucesso!'));
            
            // Atualiza o botão permanentemente
            const btnFaturamento = document.getElementById('btnAtivarFaturamento');
            if (btnFaturamento) {
                btnFaturamento.disabled = true;
                btnFaturamento.style.background = '#10b981';
                btnFaturamento.style.opacity = '0.7';
                btnFaturamento.style.cursor = 'not-allowed';
                btnFaturamento.innerHTML = '✅ Faturamento Ativado';
                btnFaturamento.onclick = null;
            }
            
            // Recarrega a página após 1 segundo para atualizar todos os dados
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            throw new Error(data.erro || 'Falha ao ativar faturamento');
        }

    } catch (err) {
        console.error('Erro ao ativar faturamento:', err);
        
        let mensagemErro = 'Erro ao ativar faturamento: ';
        
        // Mensagens específicas
        if (err.message.includes('incompleto')) {
            mensagemErro += 'Preencha todos os dados bancários antes de continuar.';
        } else if (err.message.includes('CPF')) {
            mensagemErro += 'CPF/CNPJ inválido. Verifique o documento informado.';
        } else if (err.message.includes('already exists')) {
            mensagemErro += 'Este CPF/CNPJ já possui conta no Asaas.';
        } else if (err.message.includes('Invalid access_token')) {
            mensagemErro += 'Chave API do Asaas inválida. Verifique a configuração no servidor.';
        } else if (err.message.includes('ambiente')) {
            mensagemErro += 'Problema de ambiente (sandbox/produção). Contate o suporte.';
        } else {
            mensagemErro += err.message;
        }
        
        alert('❌ ' + mensagemErro);
        
    } finally {
        const btn = document.getElementById('btnAtivarFaturamento');
        if (btn && !btn.innerHTML.includes('Ativado')) {
            btn.disabled = false;
            btn.innerText = "🚀 Ativar Faturamento";
        }
    }
}

    // 4. EQUIPE
async function carregarEquipe() {
    try {
        console.log('🔄 Carregando equipe...');
        const res = await fetch('/api/auth/equipe', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        console.log('📡 Status da resposta:', res.status);
        
        if (!res.ok) {
            const errorText = await res.text();
            console.error('❌ Erro na resposta:', errorText);
            throw new Error(`Falha ao carregar equipe: ${res.status} - ${errorText}`);
        }

        const membros = await res.json();
        console.log('👥 Membros recebidos:', membros);
        
        const lista = document.getElementById('listaEquipe');
        if (!lista) {
            console.error('❌ Elemento listaEquipe não encontrado');
            return;
        }

        lista.innerHTML = '';  // limpa antes

        if (!membros || membros.length === 0) {
            lista.innerHTML = '<p style="color: var(--muted); text-align: center; padding: 20px;">Nenhum membro na equipe ainda.</p>';
            console.log('ℹ️ Nenhum membro encontrado');
            return;
        }

        membros.forEach(m => {
            lista.innerHTML += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #f1f5f9;">
                    <div>
                        <div style="font-weight: 600; font-size: 14px;">${m.nome || 'Sem nome'}</div>
                        <div style="font-size: 12px; color: var(--muted);">${m.email || '—'}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <span style="background: #e0e7ff; color: #4338ca; padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: 700;">
                            ${ (m.role || 'operador').toUpperCase() }
                        </span>
                        <button data-action="excluirMembro" data-args='[${m.id}]'
                                style="background: none; border: none; color: #ef4444; cursor: pointer; display: flex; align-items: center;">
                            <i data-lucide="trash-2" style="width: 18px; height: 18px;"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        // Chama o Lucide **depois** de inserir todo o HTML novo
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
            console.log("✅ Ícones Lucide atualizados com sucesso na lista de equipe");
        } else {
            console.warn("⚠️ Biblioteca Lucide não encontrada ou createIcons indisponível");
        }
        
        console.log('✅ Equipe carregada com sucesso!');

    } catch (e) {
        console.error("❌ Erro ao carregar equipe:", e);
        const lista = document.getElementById('listaEquipe');
        if (lista) {
            lista.innerHTML = `
                <p style="color: #ef4444; text-align: center; padding: 20px;">
                    Erro ao carregar a equipe. Tente recarregar a página.<br>
                    <small style="color: #64748b; font-size: 11px; margin-top: 8px; display: block;">
                        Detalhes: ${e.message}
                    </small>
                </p>`;
        }
    }
}

    async function excluirMembro(id) {
        if (!confirm("Remover integrante imediatamente?")) return;
        const res = await fetch(`/api/auth/equipe/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) { alert("Acesso revogado."); carregarEquipe(); }
    }

    async function salvarMembro() {
        const nome = document.getElementById('eqNome').value;
        const email = document.getElementById('eqEmail').value;
        const senha = document.getElementById('eqSenha').value;
        const role = document.getElementById('eqRole').value;

        if (!nome || !email || !senha) return alert("Preencha todos os campos da equipe.");

        const res = await fetch('/api/auth/convidar-funcionario', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ nome, email, senha, role })
        });

        const data = await res.json();
        // ✅ Interceptar erro 402 (Limite de usuários)
        if (res.status === 402) {
            const msg = data.message || `Você atingiu o limite de ${data.max || 3} usuários do plano ${data.current_plan || 'Básico'}.`;
            exibirAvisoUpgrade(msg);
            return;
        }
        if (res.ok) {
            alert('✅ Funcionário adicionado!');
            document.getElementById('eqNome').value = '';
            document.getElementById('eqEmail').value = '';
            document.getElementById('eqSenha').value = '';
            carregarEquipe();
        } else {
            alert('❌ Erro: ' + (data.erro || 'Acesso negado.'));
        }
    }

async function alterarSenha() {
    const s1 = document.getElementById('novaSenha').value.trim();
    const s2 = document.getElementById('confirmaSenha').value.trim();

    if (!s1) return alert("Digite a nova senha!");
    if (s1 !== s2) return alert("As senhas não conferem!");
    if (s1.length < 6) return alert("A senha deve ter pelo menos 6 caracteres!");

    try {
        const res = await fetch('/api/senha', {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ senha: s1 })
        });

        const data = await res.json();

        if (res.ok) {
            alert("✅ Senha alterada com sucesso!");
            document.getElementById('novaSenha').value = '';
            document.getElementById('confirmaSenha').value = '';
        } else {
            alert("❌ " + (data.erro || `Erro ${res.status}: ${res.statusText}`));
            console.log("Detalhes do erro:", data);
        }
    } catch (err) {
        console.error("Erro na requisição de senha:", err);
        alert("Falha na conexão. Verifique se o servidor está rodando.");
    }
}

    function toggleUserMenu() {
        const m = document.getElementById('userDropdown');
        if(m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
    }

    function logout() { localStorage.removeItem('token'); window.location.href = '/login.html'; }

    // 🕒 FUNÇÃO PARA CALCULAR E EXIBIR DIAS RESTANTES DO TRIAL
async function carregarDataTrial() {
    // Esta função foi simplificada - a data já é configurada pela carregarInfoRodape()
    // que calcula corretamente a partir de data_criacao do usuário
    console.log('✅ Verificação de trial - data já configurada por carregarInfoRodape()');
}

/* ===================================================
   2FA — Gerenciamento
=================================================== */
let _twofaBackupCodes = [];

async function carregarStatus2FA() {
    try {
        const res = await fetch('/api/auth/2fa/status', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        document.getElementById('twofa-loading').style.display = 'none';
        if (data.ativo) {
            document.getElementById('twofa-ativado').style.display = 'block';
            if (data.ativado_em) {
                const d = new Date(data.ativado_em);
                document.getElementById('twofa-ativado-em').textContent =
                    'Ativado em ' + d.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });
            }
        } else {
            document.getElementById('twofa-desativado').style.display = 'block';
        }
    } catch (e) {
        document.getElementById('twofa-loading').textContent = 'Erro ao carregar status 2FA.';
    }
}

async function iniciarAtivacao2FA() {
    document.getElementById('modal2faAtivar').style.display = 'flex';
    document.getElementById('modal2faStep1').style.display = 'block';
    document.getElementById('modal2faStep2').style.display = 'none';
    document.getElementById('modal2faStep3').style.display = 'none';
    document.getElementById('twofaQrLoading').style.display = 'block';
    document.getElementById('twofaQrContent').style.display = 'none';

    try {
        const res = await fetch('/api/auth/2fa/configurar', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Erro ao gerar QR code'); fecharModal2faAtivar(); return; }
        document.getElementById('twofaQrImg').src = data.qrcode;
        document.getElementById('twofaSecret').textContent = data.secret;
        document.getElementById('twofaQrLoading').style.display = 'none';
        document.getElementById('twofaQrContent').style.display = 'block';
    } catch (e) {
        alert('Erro de conexão ao gerar QR code.');
        fecharModal2faAtivar();
    }
}

function fecharModal2faAtivar() {
    document.getElementById('modal2faAtivar').style.display = 'none';
    document.getElementById('twofaCodigoAtivacao').value = '';
    document.getElementById('twofaErroAtivacao').style.display = 'none';
}

function avancarParaEtapa2() {
    document.getElementById('modal2faStep1').style.display = 'none';
    document.getElementById('modal2faStep2').style.display = 'block';
    document.getElementById('twofaCodigoAtivacao').focus();
}

function voltarEtapa1() {
    document.getElementById('modal2faStep2').style.display = 'none';
    document.getElementById('modal2faStep1').style.display = 'block';
}

async function confirmarAtivacao2FA() {
    const codigo = document.getElementById('twofaCodigoAtivacao').value.trim();
    const btn    = document.getElementById('btnConfirmarAtivacao');
    const erro   = document.getElementById('twofaErroAtivacao');
    erro.style.display = 'none';

    if (codigo.length !== 6) { erro.textContent = 'Digite os 6 dígitos do código.'; erro.style.display = 'block'; return; }

    btn.textContent = 'Verificando...';
    btn.disabled    = true;

    try {
        const res = await fetch('/api/auth/2fa/ativar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ codigo })
        });
        const data = await res.json();

        if (!res.ok) {
            erro.textContent = data.error || 'Código inválido. Tente novamente.';
            erro.style.display = 'block';
            document.getElementById('twofaCodigoAtivacao').value = '';
            btn.textContent = 'Confirmar e Ativar';
            btn.disabled    = false;
            return;
        }

        _twofaBackupCodes = data.backup_codes;
        const grid = document.getElementById('backupCodesGrid');
        grid.innerHTML = _twofaBackupCodes.map(c =>
            `<div style="background:#f1f5f9;padding:8px 12px;border-radius:6px;font-size:13px;font-family:monospace;text-align:center;letter-spacing:2px;">${c}</div>`
        ).join('');

        document.getElementById('modal2faStep2').style.display = 'none';
        document.getElementById('modal2faStep3').style.display = 'block';

    } catch (e) {
        erro.textContent = 'Erro de conexão. Tente novamente.';
        erro.style.display = 'block';
        btn.textContent = 'Confirmar e Ativar';
        btn.disabled    = false;
    }
}

function copiarBackupCodes() {
    const texto = _twofaBackupCodes.join('\n');
    const btn   = document.getElementById('btnCopiarBackup');
    navigator.clipboard.writeText(texto).then(() => {
        btn.textContent = '✓ Copiado!';
        setTimeout(() => { btn.textContent = 'Copiar todos'; }, 2000);
    }).catch(() => {
        btn.textContent = '✓ Copiado!';
        setTimeout(() => { btn.textContent = 'Copiar todos'; }, 2000);
    });
}

function concluirAtivacao2FA() {
    fecharModal2faAtivar();
    _twofaBackupCodes = [];
    // Atualizar UI
    document.getElementById('twofa-desativado').style.display = 'none';
    document.getElementById('twofa-ativado').style.display = 'block';
    const agora = new Date();
    document.getElementById('twofa-ativado-em').textContent =
        'Ativado em ' + agora.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });
}

function abrirModalDesativar2FA() {
    document.getElementById('senhaDesativar2fa').value = '';
    document.getElementById('erroDesativar2fa').style.display = 'none';
    document.getElementById('modal2faDesativar').style.display = 'flex';
    setTimeout(() => document.getElementById('senhaDesativar2fa').focus(), 100);
}

function fecharModal2faDesativar() {
    document.getElementById('modal2faDesativar').style.display = 'none';
}

async function confirmarDesativacao2FA() {
    const senha = document.getElementById('senhaDesativar2fa').value;
    const btn   = document.getElementById('btnDesativar2fa');
    const erro  = document.getElementById('erroDesativar2fa');
    erro.style.display = 'none';

    if (!senha) { erro.textContent = 'Digite sua senha atual.'; erro.style.display = 'block'; return; }

    btn.textContent = 'Desativando...';
    btn.disabled    = true;

    try {
        const res = await fetch('/api/auth/2fa/desativar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ senha })
        });
        const data = await res.json();

        if (!res.ok) {
            erro.textContent = data.error || 'Erro ao desativar 2FA.';
            erro.style.display = 'block';
            btn.textContent = 'Desativar 2FA';
            btn.disabled    = false;
            return;
        }

        fecharModal2faDesativar();
        document.getElementById('twofa-ativado').style.display   = 'none';
        document.getElementById('twofa-desativado').style.display = 'block';
        document.getElementById('twofa-ativado-em').textContent  = '';

    } catch (e) {
        erro.textContent = 'Erro de conexão. Tente novamente.';
        erro.style.display = 'block';
        btn.textContent = 'Desativar 2FA';
        btn.disabled    = false;
    }
}

// ─── iCal Feed ───────────────────────────────────────────────────────────────
async function carregarStatusIcal() {
    try {
        const res = await fetch('/api/calendario/ical/status', {
            headers: { Authorization: `Bearer ${token}` }
        });
        document.getElementById('ical-loading').style.display = 'none';
        if (!res.ok) return;
        const d = await res.json();
        if (d.url) {
            document.getElementById('icalUrlInput').value = d.url;
            document.getElementById('ical-url-section').style.display = 'block';
        }
        // Botão regenerar visível apenas para admin
        fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.json())
            .then(data => {
                if (data.ok && data.usuario.role !== 'admin') {
                    const btn = document.getElementById('btnRegenerarIcal');
                    if (btn) btn.style.display = 'none';
                }
            }).catch(() => {});
    } catch { document.getElementById('ical-loading').style.display = 'none'; }
}

async function copiarUrlIcal() {
    const url = document.getElementById('icalUrlInput').value;
    if (!url) return;
    try {
        await navigator.clipboard.writeText(url);
        const btn = document.getElementById('btnCopiarIcal');
        const orig = btn.textContent;
        btn.textContent = '✅ Copiado!';
        btn.style.background = '#059669';
        setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2000);
    } catch {
        // fallback para browsers sem clipboard API
        const input = document.getElementById('icalUrlInput');
        input.select();
        document.execCommand('copy');
        alert('URL copiada!');
    }
}

async function regenerarTokenIcal() {
    if (!confirm('Regenerar o token invalidará o link atual em todos os calendários assinados. Continuar?')) return;
    try {
        const res = await fetch('/api/calendario/ical/regenerar', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
        });
        const d = await res.json();
        if (!res.ok) { alert(d.erro || 'Erro ao regenerar token.'); return; }
        if (d.url) {
            document.getElementById('icalUrlInput').value = d.url;
            const msg = document.getElementById('ical-msg');
            msg.textContent = '✅ Token regenerado! Atualize a URL nos seus calendários.';
            msg.style.color = '#065f46';
            msg.style.display = 'block';
            setTimeout(() => { msg.style.display = 'none'; }, 5000);
        }
    } catch { alert('Erro de conexão.'); }
}

// ─── ClickSign BYOK ──────────────────────────────────────────────────────────
async function carregarStatusClicksign() {
    try {
        const res = await fetch('/api/addon/clicksign/status', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const d = await res.json();

        document.getElementById('clicksign-loading').style.display = 'none';
        document.getElementById('clicksign-conteudo').style.display = 'block';

        // Badge plano — incluso em todos os planos
        const badgePlano = document.getElementById('clicksign-badge-plano');
        badgePlano.textContent = '✅ Incluso no seu plano';
        badgePlano.style.cssText = 'display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.5px;background:#d1fae5;color:#065f46;';

        // Badge chave
        const badgeChave = document.getElementById('clicksign-badge-chave');
        badgeChave.textContent = d.api_key_configurada ? '🔑 Chave configurada' : '🔓 Chave não configurada';
        badgeChave.style.cssText = `display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.5px;background:${d.api_key_configurada ? '#dbeafe;color:#1e40af' : '#f1f5f9;color:#475569'};`;

        // Botão remover só aparece se já tem chave
        document.getElementById('btnRemoverClicksign').style.display = d.api_key_configurada ? 'inline-block' : 'none';

        // Placeholder indica se já está configurada
        document.getElementById('clicksignApiKeyInput').placeholder = d.api_key_configurada
            ? '••••••••••••••• (configurada — cole para substituir)'
            : 'Cole sua API Key do ClickSign aqui';
    } catch { /* silencioso */ }
}

function toggleVerChaveClicksign() {
    const input = document.getElementById('clicksignApiKeyInput');
    input.type = input.type === 'password' ? 'text' : 'password';
}

async function salvarChaveClicksign() {
    const chave = document.getElementById('clicksignApiKeyInput').value.trim();
    if (!chave) { alert('Cole sua API Key do ClickSign antes de salvar.'); return; }

    const btn = document.getElementById('btnSalvarClicksign');
    btn.disabled = true;
    btn.textContent = 'Salvando…';

    try {
        const res = await fetch('/api/addon/clicksign/chave', {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: chave })
        });
        const d = await res.json();
        if (!res.ok) { alert(d.erro || 'Erro ao salvar.'); return; }

        document.getElementById('clicksignApiKeyInput').value = '';
        const msg = d.webhook_registrado
            ? '✅ Chave salva! Webhook configurado automaticamente.'
            : '✅ Chave salva com sucesso!';
        mostrarMsgClicksign(msg, '#065f46');
        carregarStatusClicksign();
    } catch { alert('Erro de conexão.'); }
    finally { btn.disabled = false; btn.textContent = 'Salvar Chave'; }
}

async function removerChaveClicksign() {
    if (!confirm('Remover a chave ClickSign? A Assinatura Digital ficará indisponível até configurar uma nova chave.')) return;

    try {
        const res = await fetch('/api/addon/clicksign/chave', {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: null })
        });
        if (res.ok) {
            mostrarMsgClicksign('Chave removida.', '#64748b');
            carregarStatusClicksign();
        }
    } catch { alert('Erro de conexão.'); }
}

function mostrarMsgClicksign(texto, cor) {
    const el = document.getElementById('clicksign-chave-msg');
    el.textContent = texto;
    el.style.color = cor;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}


window.onload = () => {
    carregarBancos();
    carregarInfoRodape();
    ajustarMascaraDoc();

    // Reabilitar botão salvar ao detectar qualquer alteração no card de dados do escritório
    const cardEscritorio = document.getElementById('card-dados-escritorio');
    if (cardEscritorio) {
        cardEscritorio.addEventListener('input', () => {
            const btnSalvar = document.getElementById('btnSalvarEscritorio');
            const btnEditar = document.getElementById('btnEditarEscritorio');
            if (btnSalvar && btnSalvar.disabled) {
                btnSalvar.disabled = false;
                btnSalvar.innerHTML = '💾 Salvar Dados do Escritório';
                if (btnEditar) btnEditar.style.display = 'none';
            }
        });
        cardEscritorio.addEventListener('change', () => {
            const btnSalvar = document.getElementById('btnSalvarEscritorio');
            const btnEditar = document.getElementById('btnEditarEscritorio');
            if (btnSalvar && btnSalvar.disabled) {
                btnSalvar.disabled = false;
                btnSalvar.innerHTML = '💾 Salvar Dados do Escritório';
                if (btnEditar) btnEditar.style.display = 'none';
            }
        });
    }
    carregarEquipe();
    carregarChaveEscavador();
    carregarDataTrial(); // 🆕 NOVA LINHA
    carregarStatus2FA();
    carregarStatusClicksign();
    carregarStatusIcal();
    const elemento = document.getElementById('ID_DO_ELEMENTO');
    if (elemento) {
        elemento.disabled = true;
    }

    // Inputs — oninput (máscaras)
    const inputOab = document.getElementById('confOab');
    if (inputOab) inputOab.addEventListener('input', function() { aplicarMascaraOAB(this); });

    const inputRendaMensal = document.getElementById('confRendaMensal');
    if (inputRendaMensal) inputRendaMensal.addEventListener('input', function() { mascaraMoeda(this); });

    const inputDocumento = document.getElementById('confDocumento');
    if (inputDocumento) inputDocumento.addEventListener('input', function() { aplicarMascaraDoc(this); });

    const inputCep = document.getElementById('confCep');
    if (inputCep) {
        inputCep.addEventListener('input', function() { mascaraCEP(this); });
        inputCep.addEventListener('blur', buscarCep);
    }

    // Input file — onchange
    const logoFileInput = document.getElementById('logoFileInput');
    if (logoFileInput) logoFileInput.addEventListener('change', function() { uploadLogo(this); });

    // Radio buttons — onclick
    document.querySelectorAll('input[name="tipoDoc"]').forEach(function(r) {
        r.addEventListener('click', ajustarMascaraDoc);
    });

    // Input 2FA código — oninput (filtrar apenas dígitos)
    const twofaCodigo = document.getElementById('twofaCodigoAtivacao');
    if (twofaCodigo) twofaCodigo.addEventListener('input', function() { this.value = this.value.replace(/\D/g, ''); });

    // Link IA — interceptar navegação para abrir submenu
    const linkIa = document.querySelector('a[data-action="toggleIaMenu"]');
    if (linkIa) {
        linkIa.removeAttribute('data-action');
        linkIa.addEventListener('click', function(e) { toggleIaMenu(e); });
    }
};

    window.onclick = (e) => {
        if (!e.target.closest('#userCircle') && !e.target.closest('#userDropdown')) {
            const m = document.getElementById('userDropdown');
            if(m) m.style.display = 'none';
        }
    };

async function solicitarCancelamento() { // 🚀 Nome deve ser igual ao do 'onclick'
    if (!confirm("Doutor, deseja realmente cancelar a renovação automática? Seu acesso será mantido apenas até o fim dos 7 dias gratuitos.")) return;

    try {
        const res = await fetch('/api/planos/cancelar-agendamento', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await res.json();
        if (data.ok) {
            alert(data.msg);
            window.location.reload();
        } else {
            alert("Erro: " + (data.error || "Tente novamente mais tarde."));
        }
    } catch (err) {
        alert("Erro de conexão com o servidor.");
    }
}

// ✅ NOVA FUNÇÃO: Cancelar assinatura paga
async function cancelarAssinatura() {
    const confirmacao = confirm(
        "⚠️ Tem certeza que deseja cancelar sua assinatura?\n\n" +
        "• Você continuará com acesso até o fim do período já pago\n" +
        "• Não haverá novas cobranças automáticas\n" +
        "• Você pode reativar a qualquer momento"
    );
    
    if (!confirmacao) return;

    try {
        const res = await fetch('/api/pagamentos/cancelar-assinatura', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await res.json();
        
        if (data.ok) {
            alert(
                "✅ Assinatura cancelada com sucesso!\n\n" +
                data.detalhes
            );
            window.location.reload();
        } else {
            alert("❌ Erro ao cancelar: " + (data.erro || "Tente novamente mais tarde."));
        }
    } catch (err) {
        console.error('Erro ao cancelar:', err);
        alert("❌ Erro de conexão com o servidor.");
    }
}

async function reativarAssinatura() {
    if (!confirm("Deseja reativar a renovação automática e garantir a continuidade do seu acesso?")) return;

    try {
        const res = await fetch('/api/planos/reativar', {
            method: 'PUT',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await res.json();
        if (data.ok) {
            alert("✅ Assinatura reativada com sucesso, Doutor!");
            window.location.reload();
        } else {
            alert("Erro ao reativar: " + (data.error || "Tente novamente mais tarde."));
        }
    } catch (err) {
        alert("Erro de conexão com o servidor.");
    }
}

// ===== FUNÇÕES DE INTEGRAÇÃO COM ESCAVADOR =====

async function carregarChaveEscavador() {
    try {
        const res = await fetch('/api/config/meu-escritorio', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (data.ok && data.dados && data.dados.escavador_api_key) {
            const input = document.getElementById('escavadorApiKey');
            if (input) {
                input.value = data.dados.escavador_api_key;
                // Atualiza badge
                const badge = document.getElementById('badgeEscavador');
                if (badge) {
                    badge.innerText = 'ATIVADO';
                    badge.style.background = '#d1fae5';
                    badge.style.color = '#065f46';
                }
            }
        }
    } catch (err) {
        console.error("Erro ao carregar chave Escavador:", err);
    }
}

async function sincronizarDatajud() {
    const btn = document.getElementById('btnSincronizarDatajud');
    const status = document.getElementById('datajud-status');

    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="refresh-cw" style="width:15px;height:15px;"></i> Iniciando...';
    status.textContent = '';
    if (window.lucide) lucide.createIcons();

    try {
        const res = await API.post('/api/config/datajud/sincronizar', {});
        const data = await res.json();

        if (data.ok) {
            // Mostra animação de progresso em segundo plano
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="refresh-cw" style="width:15px;height:15px;"></i> Sincronizar Agora';
            if (window.lucide) lucide.createIcons();

            status.innerHTML = '<span id="datajud-progresso"></span>';
            const el = document.getElementById('datajud-progresso');
            const dots = ['⏳ Buscando andamentos no DataJud', '⏳ Buscando andamentos no DataJud.', '⏳ Buscando andamentos no DataJud..', '⏳ Buscando andamentos no DataJud...'];
            let i = 0;
            el.textContent = dots[0];
            el.style.color = '#7c3aed';

            const intervalo = setInterval(() => { el.textContent = dots[++i % dots.length]; }, 600);

            // Estimativa: ~400ms por processo + overhead. Para 182 processos ≈ 90s
            // Exibe progresso por 2 minutos e então mostra mensagem de conclusão
            setTimeout(() => {
                clearInterval(intervalo);
                el.textContent = '✅ Sincronização concluída! Verifique os andamentos nos processos.';
                el.style.color = '#065f46';
            }, 120000);

            return;
        } else {
            status.textContent = '❌ ' + (data.erro || 'Erro ao sincronizar.');
            status.style.color = '#991b1b';
        }
    } catch (err) {
        status.textContent = '❌ Erro de conexão.';
        status.style.color = '#991b1b';
    }

    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="refresh-cw" style="width:15px;height:15px;"></i> Sincronizar Agora';
    if (window.lucide) lucide.createIcons();
}

async function ressincronizarDatajud() {
    if (!confirm('Isso irá apagar TODOS os andamentos importados pelo DataJud e reimportá-los com a classificação correta.\n\nAndamentos inseridos manualmente NÃO serão afetados.\n\nDeseja continuar?')) return;

    const btn = document.getElementById('btnRessincronizarDatajud');
    const status = document.getElementById('datajud-status');

    btn.disabled = true;
    document.getElementById('btnSincronizarDatajud').disabled = true;
    btn.innerHTML = '<i data-lucide="rotate-ccw" style="width:15px;height:15px;"></i> Removendo...';
    if (window.lucide) lucide.createIcons();

    try {
        const res = await API.post('/api/config/datajud/ressincronizar', {});
        const data = await res.json();

        if (data.ok) {
            btn.innerHTML = '<i data-lucide="rotate-ccw" style="width:15px;height:15px;"></i> Re-sincronizar';
            btn.disabled = false;
            document.getElementById('btnSincronizarDatajud').disabled = false;
            if (window.lucide) lucide.createIcons();

            status.innerHTML = `<span style="color:#7c3aed">⏳ ${data.removidos} andamentos removidos. Re-importando em background...</span>`;

            const el = status.querySelector('span');
            const dots = [
                `⏳ ${data.removidos} removidos. Re-importando`,
                `⏳ ${data.removidos} removidos. Re-importando.`,
                `⏳ ${data.removidos} removidos. Re-importando..`,
                `⏳ ${data.removidos} removidos. Re-importando...`
            ];
            let i = 0;
            const intervalo = setInterval(() => { el.textContent = dots[++i % dots.length]; }, 600);
            setTimeout(() => {
                clearInterval(intervalo);
                el.textContent = '✅ Re-sincronização concluída! Verifique os andamentos nos processos.';
                el.style.color = '#065f46';
            }, 120000);
        } else {
            status.textContent = '❌ ' + (data.erro || 'Erro ao re-sincronizar.');
            status.style.color = '#991b1b';
            btn.disabled = false;
            document.getElementById('btnSincronizarDatajud').disabled = false;
            btn.innerHTML = '<i data-lucide="rotate-ccw" style="width:15px;height:15px;"></i> Re-sincronizar';
            if (window.lucide) lucide.createIcons();
        }
    } catch (err) {
        status.textContent = '❌ Erro de conexão.';
        status.style.color = '#991b1b';
        btn.disabled = false;
        document.getElementById('btnSincronizarDatajud').disabled = false;
        btn.innerHTML = '<i data-lucide="rotate-ccw" style="width:15px;height:15px;"></i> Re-sincronizar';
        if (window.lucide) lucide.createIcons();
    }
}

async function testarDatajud() {
    const numero = document.getElementById('datajud-numero-teste').value.trim();
    const pre = document.getElementById('datajud-diagnostico');
    if (!numero) { alert('Informe um número CNJ.'); return; }

    pre.style.display = 'block';
    pre.textContent = 'Consultando DataJud...';

    try {
        const res = await API.get('/api/config/datajud/testar?numero=' + encodeURIComponent(numero));
        const data = await res.json();
        pre.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        pre.textContent = 'Erro: ' + err.message;
    }
}

async function salvarChaveEscavador() {
    const chave = document.getElementById('escavadorApiKey').value.trim();
    
    try {
        const res = await fetch('/api/config/escavador-key', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ escavador_api_key: chave })
        });

        const data = await res.json();

        if (res.ok) {
            alert('✅ Chave API salva com sucesso!');
            
            // Atualiza badge
            const badge = document.getElementById('badgeEscavador');
            if (badge) {
                if (chave) {
                    badge.innerText = 'ATIVADO';
                    badge.style.background = '#d1fae5';
                    badge.style.color = '#065f46';
                } else {
                    badge.innerText = 'DESATIVADO';
                    badge.style.background = '#fee2e2';
                    badge.style.color = '#991b1b';
                }
            }
        } else {
            alert('❌ Erro ao salvar: ' + (data.erro || 'Tente novamente'));
        }
    } catch (err) {
        console.error('Erro:', err);
        alert('❌ Erro de conexão');
    }
}

async function testarChaveEscavador() {
    const chave = document.getElementById('escavadorApiKey').value.trim();
    const btn = document.getElementById('btnTestarEscavador');
    const resultado = document.getElementById('resultadoTesteEscavador');
    
    if (!chave) {
        alert('⚠️ Digite uma chave API primeiro');
        return;
    }

    btn.disabled = true;
    btn.innerText = '🔄 Testando...';
    resultado.style.display = 'none';

    try {
        const res = await fetch('https://api.escavador.com/api/v1/usuario', {
            headers: {
                'Authorization': `Bearer ${chave}`
            }
        });

        const data = await res.json();

        if (res.ok && data.id) {
            resultado.innerHTML = `
                <div style="background: #d1fae5; border: 1px solid #86efac; border-radius: 8px; padding: 16px;">
                    <strong style="color: #065f46; display: block; margin-bottom: 8px;">✅ Conexão estabelecida com sucesso!</strong>
                    <div style="font-size: 13px; color: #047857;">
                        <strong>Conta:</strong> ${data.nome || 'Sem nome'}<br>
                        <strong>E-mail:</strong> ${data.email || '—'}<br>
                        <strong>Plano:</strong> ${data.dados_assinatura?.plano?.nome || 'Gratuito'}
                    </div>
                </div>
            `;
        } else {
            resultado.innerHTML = `
                <div style="background: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px;">
                    <strong style="color: #991b1b; display: block; margin-bottom: 8px;">❌ Chave inválida ou sem permissão</strong>
                    <p style="font-size: 12px; color: #b91c1c; margin: 0;">
                        Verifique se a chave foi copiada corretamente e se possui as permissões necessárias.
                    </p>
                </div>
            `;
        }

        resultado.style.display = 'block';

    } catch (err) {
        console.error('Erro ao testar:', err);
        resultado.innerHTML = `
            <div style="background: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px;">
                <strong style="color: #991b1b;">❌ Erro de conexão</strong>
            </div>
        `;
        resultado.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerText = '🔍 Testar Conexão';
    }
}

// 🚀 INICIALIZAR ÍCONES LUCIDE
if (window.lucide) {
    lucide.createIcons();
}

// Garantir que os ícones sejam renderizados após o carregamento
window.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) {
        lucide.createIcons();
    }
});

    // ✅ Função de modal de upgrade (para limites de usuários)
    function exibirAvisoUpgrade(mensagem) {
        const overlay = document.createElement('div');
        overlay.id = "overlay-upgrade";
        overlay.style = "position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:20000; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(5px);";
        overlay.innerHTML = `
        <div style="background:#fff; padding:40px; border-radius:20px; text-align:center; max-width:400px;">
            <div style="font-size:50px;">🚀</div>
            <h3 style="margin-top:15px; color:#0f172a;">Limite de Usuários</h3>
            <p style="color:#64748b; margin:15px 0 25px 0; line-height:1.6;">${mensagem}</p>
            <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:12px; padding:15px; margin-bottom:25px; text-align:left;">
                <p style="margin:0; font-size:13px; color:#92400e; line-height:1.6;">
                    <strong>🎯 Plano Intermediário inclui:</strong><br>
                    • Até 15 usuários simultâneos<br>
                    • Todos os recursos do Básico<br>
                    • Financeiro Jurídico completo<br>
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

    function toggleIaMenu(event) {
    event.preventDefault(); // impede navegação imediata
    const submenu = document.getElementById('submenu-ia');
    submenu.classList.toggle('open');
}

// ============================================================
// FUNÇÕES DE EXIBIÇÃO DO CARD DE ASSINATURA
// ============================================================

function exibirAssinaturaAtiva(user) {
    const container = document.getElementById('containerTrial');
    const footer = document.getElementById('footerAvisoAssinatura');
    const btnContainer = document.getElementById('containerAcaoAssinatura');
    
    if (!container) return;
    
    // Formatar datas
    const ultimoPgto = user.ultimo_pagamento 
        ? new Date(user.ultimo_pagamento).toLocaleDateString('pt-BR')
        : 'N/A';
    
    const proximaCobranca = user.proxima_cobranca
        ? new Date(user.proxima_cobranca).toLocaleDateString('pt-BR')
        : 'N/A';
    
    // Atualizar card para verde (ativo/pago)
    container.style.background = 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)';
    container.style.borderColor = '#6ee7b7';
    container.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 12px;">
            <div style="background: #10b981; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i data-lucide="check-circle" style="color: #fff; width: 18px; height: 18px;"></i>
            </div>
            <div style="flex: 1;">
                <div style="font-size: 11px; font-weight: 700; color: #065f46; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
                    ASSINATURA ATIVA
                </div>
                <p style="font-size: 14px; color: #047857; line-height: 1.6; margin: 0 0 12px 0;">
                    Seu plano está <strong style="font-weight: 800;">pago e ativo</strong>
                </p>
                <div style="background: rgba(255,255,255,0.5); padding: 12px; border-radius: 8px; font-size: 13px; color: #065f46;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div>
                            <div style="font-size: 11px; opacity: 0.8; margin-bottom: 2px;">Último Pagamento</div>
                            <div style="font-weight: 700;">${ultimoPgto}</div>
                        </div>
                        <div>
                            <div style="font-size: 11px; opacity: 0.8; margin-bottom: 2px;">Próxima Cobrança</div>
                            <div style="font-weight: 700;">${proximaCobranca}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // ✅ ADICIONAR botão de cancelamento
    if (btnContainer) {
        btnContainer.style.display = 'block';
        btnContainer.innerHTML = `
            <button data-action="cancelarAssinatura"
                    style="width: 100%; background: #fef2f2; border: 2px solid #fecaca; color: #991b1b;
                           padding: 14px 20px; border-radius: 10px; cursor: pointer; font-size: 14px;
                           font-weight: 700; transition: all 0.3s; display: flex; align-items: center;
                           justify-content: center; gap: 8px;">
                <i class="lucide lucide-x-circle" style="width: 18px; height: 18px;"></i>
                Cancelar Renovação Automática
            </button>
        `;
    }
    
    // Atualizar footer
    if (footer) {
        footer.innerHTML = '<i class="lucide lucide-shield-check" style="width: 14px; height: 14px; vertical-align: middle;"></i> Seus dados estão protegidos. Você pode cancelar a qualquer momento.';
        footer.style.color = '#047857';
        footer.style.display = 'block';
    }
    
    // Reinicializar ícones
    if (window.lucide) lucide.createIcons();
}

function exibirTrialExpirado() {
    const container = document.getElementById('containerTrial');
    const footer = document.getElementById('footerAvisoAssinatura');
    const btnContainer = document.getElementById('containerAcaoAssinatura');
    
    if (!container) return;
    
    // Atualizar card para vermelho (expirado)
    container.style.background = 'linear-gradient(135deg, #fecaca 0%, #fca5a5 100%)';
    container.style.borderColor = '#f87171';
    container.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 12px;">
            <div style="background: #dc2626; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i data-lucide="alert-circle" style="color: #fff; width: 18px; height: 18px;"></i>
            </div>
            <div style="flex: 1;">
                <div style="font-size: 11px; font-weight: 700; color: #7f1d1d; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
                    PERÍODO DE TESTE EXPIRADO
                </div>
                <p style="font-size: 14px; color: #991b1b; line-height: 1.6; margin: 0;">
                    Seu período de teste gratuito chegou ao fim. <br>
                    <span style="font-size: 12px;">Para continuar usando o sistema, é necessário ativar seu plano.</span>
                </p>
            </div>
        </div>
    `;
    
    // Substituir botão por "Ativar Plano"
    if (btnContainer) {
        btnContainer.innerHTML = `
            <button data-action="navegarPara" data-args='["/planos-page"]'
                    style="width: 100%; background: #dc2626; border: 2px solid #b91c1c; color: white;
                           padding: 14px 20px; border-radius: 10px; cursor: pointer; font-size: 14px;
                           font-weight: 700; transition: all 0.3s; display: flex; align-items: center;
                           justify-content: center; gap: 8px;">
                <i class="lucide lucide-credit-card" style="width: 18px; height: 18px;"></i>
                Ativar Meu Plano Agora
            </button>
        `;
    }
    
    // Esconder footer
    if (footer) footer.style.display = 'none';
    
    // Reinicializar ícones
    if (window.lucide) lucide.createIcons();
}

function exibirInadimplente() {
    const container = document.getElementById('containerTrial');
    const footer = document.getElementById('footerAvisoAssinatura');
    const btnContainer = document.getElementById('containerAcaoAssinatura');
    
    if (!container) return;
    
    // Atualizar card para laranja (inadimplente)
    container.style.background = 'linear-gradient(135deg, #fed7aa 0%, #fdba74 100%)';
    container.style.borderColor = '#fb923c';
    container.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 12px;">
            <div style="background: #f97316; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i data-lucide="alert-triangle" style="color: #fff; width: 18px; height: 18px;"></i>
            </div>
            <div style="flex: 1;">
                <div style="font-size: 11px; font-weight: 700; color: #7c2d12; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
                    PAGAMENTO PENDENTE
                </div>
                <p style="font-size: 14px; color: #9a3412; line-height: 1.6; margin: 0;">
                    Houve um problema com seu pagamento. <br>
                    <span style="font-size: 12px;">Por favor, atualize seus dados de pagamento para continuar.</span>
                </p>
            </div>
        </div>
    `;
    
    // Substituir botão por "Regularizar"
    if (btnContainer) {
        btnContainer.innerHTML = `
            <button data-action="navegarPara" data-args='["/planos-page?action=pay"]'
                    style="width: 100%; background: #f97316; border: 2px solid #ea580c; color: white;
                           padding: 14px 20px; border-radius: 10px; cursor: pointer; font-size: 14px;
                           font-weight: 700; transition: all 0.3s; display: flex; align-items: center;
                           justify-content: center; gap: 8px;">
                <i class="lucide lucide-credit-card" style="width: 18px; height: 18px;"></i>
                Regularizar Pagamento
            </button>
        `;
    }
    
    // Esconder footer
    if (footer) footer.style.display = 'none';
    
    // Reinicializar ícones
    if (window.lucide) lucide.createIcons();
}

    // =============================================
    // CONFIGURAÇÃO DE ALERTAS DE PRAZOS
    // =============================================
    async function carregarConfigAlertas() {
        try {
            const res = await fetch('/api/config/alertas', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await res.json();
            if (data.ok && data.config) {
                document.getElementById('diasAlerta1').value = data.config.dias_alerta_1 ?? 7;
                document.getElementById('diasAlerta2').value = data.config.dias_alerta_2 ?? 3;
                document.getElementById('diasAlerta3').value = data.config.dias_alerta_3 ?? 1;
                document.getElementById('emailAtivo').checked = data.config.email_ativo !== false;
                document.getElementById('inappAtivo').checked = data.config.inapp_ativo !== false;
                document.getElementById('horaEnvio').value = data.config.hora_envio || '08:00';
            }
        } catch (e) { console.error('Erro ao carregar config alertas:', e); }
    }

    async function salvarConfigAlertas() {
        try {
            const body = {
                dias_alerta_1: parseInt(document.getElementById('diasAlerta1').value) || 7,
                dias_alerta_2: parseInt(document.getElementById('diasAlerta2').value) || 3,
                dias_alerta_3: parseInt(document.getElementById('diasAlerta3').value) || 1,
                email_ativo: document.getElementById('emailAtivo').checked,
                inapp_ativo: document.getElementById('inappAtivo').checked,
                hora_envio: document.getElementById('horaEnvio').value || '08:00'
            };
            const res = await fetch('/api/config/alertas', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (data.ok) {
                const msg = document.getElementById('alertasSalvoMsg');
                msg.style.display = 'block';
                setTimeout(() => msg.style.display = 'none', 3000);
            } else { alert(data.erro || 'Erro ao salvar'); }
        } catch (e) { alert('Erro de conexão'); }
    }

    // Carregar config ao abrir a página
    carregarConfigAlertas();

    // 🔒 RBAC: Ocultar seções admin-only para não-admins
    function aplicarRestricoesPorRole(role) {
        const idsAdminOnly = [
            'card-dados-escritorio',
            'card-repasse-asaas',
            'card-gestao-equipe',
            'card-assinatura-pagamento',
            'link-gestao-planos'
        ];
        if (role !== 'admin') {
            idsAdminOnly.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        }
    }
    

(function(){var t=localStorage.getItem('token');if(!t)return;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){return r.json()}).then(function(d){if(d.ok){var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}}).catch(function(){})}checkChat();setInterval(checkChat,30000)})();