const token = localStorage.getItem('token');
    if (!token) window.location.href = '/login.html';

    // ✅ VARIÁVEL PARA ARMAZENAR ARQUIVO
    let arquivoAnexado = null;
    let planoAtual = null;

    // ✅ HISTÓRICO DE CONVERSA (memória entre mensagens)
    let historicoConversa = [];

    // ✅ LIMPAR HISTÓRICO
    function limparHistorico() {
        historicoConversa = [];
        document.getElementById('chat-container').innerHTML = '';
        console.log('🗑️ Histórico limpo');
    }

    // ✅ FUNÇÃO PARA SELECIONAR ARQUIVO (PDF OU DOCX)
    function handleFileSelect(event) {
        const file = event.target.files[0];
        
        if (!file) return;

        console.log('📁 Arquivo selecionado:', {
            nome: file.name,
            tipo: file.type,
            tamanho: (file.size / 1024 / 1024).toFixed(2) + ' MB'
        });

        // Validar tipo
        const tiposPermitidos = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword'
        ];
        const isDocx = file.type.includes('word') || file.name.endsWith('.docx') || file.name.endsWith('.doc');
        if (!tiposPermitidos.includes(file.type) && !isDocx) {
            alert('❌ Apenas arquivos PDF e DOCX são aceitos!');
            event.target.value = '';
            return;
        }

        // Validar tamanho (máximo 10MB)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            alert('❌ O arquivo é muito grande! Máximo: 10MB');
            event.target.value = '';
            return;
        }

        // Converter para Base64
        const reader = new FileReader();
        reader.onload = function(e) {
            const base64 = e.target.result.split(',')[1];
            
            const isDocxFile = file.name.endsWith('.docx') || file.name.endsWith('.doc') || file.type.includes('word');
            arquivoAnexado = {
                nome: file.name,
                tamanho: (file.size / 1024 / 1024).toFixed(2),
                base64: base64,
                tipo: isDocxFile ? 'docx' : 'pdf'
            };

            // Mostrar preview
            document.getElementById('file-name').textContent = file.name;
            document.getElementById('file-size').textContent = arquivoAnexado.tamanho + ' MB';
            document.getElementById('file-icon-type').textContent = file.name.endsWith('.docx') || file.name.endsWith('.doc') ? 'DOCX' : 'PDF';
            document.getElementById('file-preview').classList.add('active');

            console.log('✅ Arquivo carregado:', {
                nome: file.name,
                tamanho: arquivoAnexado.tamanho + ' MB',
                base64Length: base64.length
            });
        };

        reader.readAsDataURL(file);
    }

    // ✅ FUNÇÃO PARA REMOVER ARQUIVO
    function removerArquivo() {
        arquivoAnexado = null;
        document.getElementById('file-input').value = '';
        document.getElementById('file-preview').classList.remove('active');
        console.log('🗑️ Arquivo removido');
    }

    async function carregarInfoRodape() {
        try {
            // 1. Dados do usuário
            const resUser = await fetch('/api/auth/me', { 
                headers: { Authorization: `Bearer ${token}` } 
            });
            const dataUser = await resUser.json();
            
            if (dataUser.ok) {
                document.getElementById('userEmail').innerText = dataUser.usuario.email;

                const nomeCompleto = dataUser.usuario.nome || 'Advogado';
                const primeiroNome = nomeCompleto.trim().split(' ')[0];
                document.getElementById('userNameHeader').innerText = primeiroNome;

                const partes = nomeCompleto.trim().split(' ').filter(n => n);
                let iniciais = partes[0][0];
                if (partes.length > 1) iniciais += partes[partes.length - 1][0];
                
                const circulo = document.getElementById('userCircle');
                if (circulo) circulo.innerText = iniciais.toUpperCase();
            }

            // 2. Dados do plano
            const resPlan = await fetch('/api/plano-consumo', { 
                headers: { Authorization: `Bearer ${token}` } 
            });
            const dataPlan = await resPlan.json();
            
            planoAtual = (dataPlan.plano || '').toLowerCase();
            document.getElementById('planNameFooter').innerText = dataPlan.plano || '---';

            // Verificar se é Premium
            if (planoAtual !== 'premium') {
                exibirMensagemUpgrade();
            }

        } catch (err) {
            console.error("Erro ao carregar dados:", err);
        }
    }


    // ✅ COPIAR TEXTO DA MENSAGEM
    function copiarMensagem(btn) {
        const msg = btn.closest('.ai-message');
        // Pegar texto sem o próprio botão
        const clone = msg.cloneNode(true);
        clone.querySelectorAll('.btn-copiar-msg').forEach(el => el.remove());
        const texto = clone.innerText || clone.textContent || '';
        navigator.clipboard.writeText(texto.trim()).then(() => {
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Copiado!';
            btn.style.opacity = '1';
            btn.style.color = '#10b981';
            setTimeout(() => {
                btn.innerHTML = _iconeCopiar();
                btn.style.color = '';
                btn.style.opacity = '';
            }, 2000);
        }).catch(() => {
            alert('Não foi possível copiar. Selecione o texto manualmente.');
        });
    }

    function _iconeCopiar() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    }

    function _btnCopiar() {
        return `<button class="btn-copiar-msg" onclick="copiarMensagem(this)" title="Copiar resposta">${_iconeCopiar()}</button>`;
    }

    // 💬 Enviar pergunta para a Claude
    async function enviarPergunta() {
        const input = document.getElementById('pergunta');
        const chat = document.getElementById('chat-container');
        const statusIa = document.getElementById('status-ia');
        const btnEnviar = document.getElementById('btn-enviar');
        const pergunta = input.value.trim();
        
        if (!pergunta) return;

        // Adiciona mensagem do usuário
        let userMessageHTML = '';
        if (arquivoAnexado) {
            userMessageHTML = `
                <div class="message user-message">
                    <div style="margin-bottom: 8px; padding: 8px; background: rgba(255,255,255,0.2); border-radius: 6px;">
                        📄 <strong>${arquivoAnexado.nome}</strong> (${arquivoAnexado.tamanho} MB)
                    </div>
                    ${escapeHtml(pergunta)}
                </div>
            `;
        } else {
            userMessageHTML = `<div class="message user-message">${escapeHtml(pergunta)}</div>`;
        }
        chat.innerHTML += userMessageHTML;
        input.value = '';
        statusIa.style.display = 'flex';
        btnEnviar.disabled = true;
        chat.scrollTop = chat.scrollHeight;

        try {
            // ✅ CRIAR PAYLOAD COM HISTÓRICO + ARQUIVO
            const payload = { pergunta, historico: historicoConversa };
            
            if (arquivoAnexado) {
                payload.arquivo = {
                    nome: arquivoAnexado.nome,
                    base64: arquivoAnexado.base64,
                    tipo: arquivoAnexado.tipo || 'pdf'
                };
                // Manter compatibilidade retroativa
                payload.pdf = payload.arquivo;
                console.log('📤 Enviando com arquivo:', {
                    nome: arquivoAnexado.nome,
                    tipo: arquivoAnexado.tipo,
                    tamanho: arquivoAnexado.tamanho + ' MB'
                });
            }

            console.log('📤 Enviando requisição para a IA...');

            const res = await fetch('/api/ia/perguntar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            console.log('📥 Resposta HTTP:', res.status);

            const data = await res.json();
            console.log('📥 Dados retornados:', data);

            let respostaHTML = '';

            if (res.ok) {
                // Converte Markdown para HTML
                respostaHTML = marked.parse(data.resposta);
                // Salvar no histórico
                historicoConversa.push({ role: 'user', content: pergunta });
                historicoConversa.push({ role: 'assistant', content: data.resposta });
                // Limitar histórico a 20 mensagens (10 trocas) para não estourar tokens
                if (historicoConversa.length > 20) historicoConversa = historicoConversa.slice(-20);
                console.log('✅ Resposta da IA recebida. Histórico:', historicoConversa.length, 'msgs');
            } 
            else if (res.status === 403) {
                respostaHTML = `
                    <div style="text-align:center; padding:20px;">
                        <i class="lucide lucide-lock" style="width: 48px; height: 48px; color: var(--muted); margin-bottom: 12px;"></i>
                        <h3 style="margin-bottom: 8px;">🔒 Recurso Premium</h3>
                        <p style="color: var(--muted); margin-bottom: 16px;">
                            O assistente jurídico LawTech Pro IA está disponível apenas para assinantes Premium.
                        </p>
                        <a href="/planos-page" style="display: inline-block; background: var(--primary); color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                            Fazer upgrade agora
                        </a>
                    </div>
                `;
            }
            else if (res.status === 429) {
                respostaHTML = `
                    <strong>⏱️ Muitas requisições</strong><br>
                    Aguarde alguns segundos e tente novamente. Limite de taxa da API atingido.
                `;
            }
            else if (res.status === 400) {
                // Tratamento especial para erro de páginas
                if (data.detalhe && data.detalhe.includes('100 PDF pages')) {
                    respostaHTML = `
                        <div style="text-align:center; padding:20px;">
                            <i class="lucide lucide-file-x" style="width: 48px; height: 48px; color: #dc2626; margin-bottom: 12px;"></i>
                            <h3 style="margin-bottom: 8px;">📄 PDF com muitas páginas</h3>
                            <p style="color: var(--muted); margin-bottom: 16px;">
                                O PDF enviado excede o limite de <strong>100 páginas</strong> da API.<br>
                                Por favor, envie um documento menor ou divida o PDF em partes.
                            </p>
                            <p style="font-size: 12px; color: var(--muted);">
                                💡 <strong>Dica:</strong> Você pode extrair apenas as páginas relevantes do processo.
                            </p>
                        </div>
                    `;
                } else {
                    respostaHTML = `
                        <strong>❌ Erro 400 - Requisição Inválida</strong><br>
                        ${escapeHtml(data.erro || 'Erro ao processar sua solicitação')}<br>
                        ${data.detalhe ? `<small style="color: var(--muted);">${escapeHtml(data.detalhe)}</small>` : ''}
                    `;
                }
                console.error('❌ Erro 400:', data);
            }
            else {
                respostaHTML = `<strong>❌ Erro:</strong> ${escapeHtml(data.erro || 'Falha na resposta da IA')}`;
                if (data.detalhe) {
                    respostaHTML += `<br><small style="color: var(--muted);">${escapeHtml(data.detalhe)}</small>`;
                }
                console.error('❌ Erro:', data);
            }

            chat.innerHTML += `<div class="message ai-message">${respostaHTML}${_btnCopiar()}</div>`;
            
            // ✅ Remover arquivo após envio (sucesso ou erro)
            if (arquivoAnexado) {
                removerArquivo();
            }
        } catch (err) {
            console.error('❌ Erro na requisição:', err);
            chat.innerHTML += `
                <div class="message ai-message">
                    <strong>❌ Erro de conexão</strong><br>
                    Não foi possível comunicar com o servidor. Verifique sua internet e tente novamente.
                    <br><br>
                    <small style="color: var(--muted);">Detalhes técnicos: ${escapeHtml(err.message)}</small>
                </div>
            `;
        } finally {
            statusIa.style.display = 'none';
            btnEnviar.disabled = false;
            chat.scrollTop = chat.scrollHeight;
            input.focus();
        }
    }

    // Exibir mensagem de upgrade se não for Premium
    function exibirMensagemUpgrade() {
        const chat = document.getElementById('chat-container');
        chat.innerHTML += `
            <div class="message ai-message" style="background: #fef3c7; border-color: #fbbf24;">
                <strong>⚠️ Atenção</strong><br>
                Você está no plano <strong>${planoAtual}</strong>. 
                Para usar o assistente jurídico LawTech Pro, faça upgrade para o plano <strong>Premium</strong>.
                <br><br>
                <a href="/planos-page" style="color: var(--primary); font-weight: 600;">
                    Ver planos disponíveis →
                </a>
            </div>
        `;
    }

    // Utilitário: Escapar HTML para evitar XSS
    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    // Menu dropdown do usuário
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

    // Logout
    function logout() {
        localStorage.removeItem('token');
        window.location.href = '/login.html';
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

    // Carregar ao iniciar
    window.onload = carregarInfoRodape;

    function toggleIaMenu(event) {
        event.preventDefault();
        const submenu = document.getElementById('submenu-ia');
        submenu.classList.toggle('open');
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('linkIaMenu').addEventListener('click', toggleIaMenu);
        document.getElementById('linkIaAtivo').addEventListener('click', (e) => e.preventDefault());
        document.getElementById('linkCrmNav').addEventListener('click', limparBolinha);
        document.getElementById('userCircle').addEventListener('click', toggleUserMenu);
        document.getElementById('linkLogout').addEventListener('click', (e) => { e.preventDefault(); logout(); });
        document.getElementById('btnRemoverArquivo').addEventListener('click', removerArquivo);
        document.getElementById('file-input').addEventListener('change', handleFileSelect);
        document.getElementById('btnAnexar').addEventListener('click', () => document.getElementById('file-input').click());
        document.getElementById('pergunta').addEventListener('keypress', (e) => { if (e.key === 'Enter') enviarPergunta(); });
        document.getElementById('btnLimpar').addEventListener('click', limparHistorico);
        document.getElementById('btn-enviar').addEventListener('click', enviarPergunta);
    });


(function(){var t=localStorage.getItem('token');if(!t)return;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){return r.json()}).then(function(d){if(d.ok){var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}}).catch(function(){})}checkChat();setInterval(checkChat,30000)})();