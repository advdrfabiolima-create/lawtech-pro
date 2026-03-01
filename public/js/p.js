
        // Inicializar ícones Lucide
        lucide.createIcons();

        // 1. CAPTURA O ID DO ESCRITÓRIO PELA URL (ex: p.html?id=1)
        const urlParams = new URLSearchParams(window.location.search);
        const escritorioId = urlParams.get('id');
        document.getElementById('escritorio_id').value = escritorioId;

        // Validar se tem ID
        if (!escritorioId) {
            document.getElementById('errorMsg').textContent = 'Link inválido. Entre em contato com o escritório.';
            document.getElementById('errorMsg').classList.add('active');
            document.getElementById('btnSubmit').disabled = true;
        }

        // Máscara para telefone
        document.getElementById('telefone').addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length <= 11) {
                value = value.replace(/^(\d{2})(\d)/g, '($1) $2');
                value = value.replace(/(\d)(\d{4})$/, '$1-$2');
            }
            e.target.value = value;
        });

        // 2. ENVIO DO FORMULÁRIO
        document.getElementById('leadForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const btn = document.getElementById('btnSubmit');
            const errorMsg = document.getElementById('errorMsg');
            
            // Desabilitar botão e mostrar loading
            btn.innerHTML = '<span class="spinner"></span>ENVIANDO...';
            btn.disabled = true;
            errorMsg.classList.remove('active');

            const dados = {
                escritorio_id: parseInt(escritorioId),
                nome: document.getElementById('nome').value.trim(),
                telefone: document.getElementById('telefone').value.trim(),
                email: document.getElementById('email').value.trim() || null,
                assunto: document.getElementById('assunto').value,
                mensagem: document.getElementById('mensagem').value.trim()
            };

            // Validações básicas
            if (!dados.nome || dados.nome.length < 3) {
                mostrarErro('Por favor, informe seu nome completo.');
                resetarBotao(btn);
                return;
            }

            if (!dados.telefone || dados.telefone.length < 14) {
                mostrarErro('Por favor, informe um telefone válido.');
                resetarBotao(btn);
                return;
            }

            if (!dados.assunto) {
                mostrarErro('Por favor, selecione um assunto.');
                resetarBotao(btn);
                return;
            }

            if (!dados.mensagem || dados.mensagem.length < 10) {
                mostrarErro('Por favor, descreva brevemente seu caso (mínimo 10 caracteres).');
                resetarBotao(btn);
                return;
            }

            console.log('📤 Enviando dados:', dados);

            try {
                // Tentar enviar para a API
                const res = await fetch('/api/crm/public/captura-lead', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(dados)
                });

                console.log('📥 Resposta recebida:', res.status, res.statusText);

                if (res.ok) {
                    const resposta = await res.json();
                    console.log('✅ Sucesso:', resposta);
                    
                    // Mostrar mensagem de sucesso
                    document.getElementById('leadForm').style.display = 'none';
                    document.getElementById('msgSucesso').style.display = 'block';
                    lucide.createIcons();
                } else {
                    // Tentar obter mensagem de erro da API
                    let mensagemErro = 'Erro ao enviar. Tente novamente.';
                    try {
                        const errorData = await res.json();
                        mensagemErro = errorData.erro || errorData.message || mensagemErro;
                    } catch {}
                    
                    console.error('❌ Erro na resposta:', mensagemErro);
                    mostrarErro(mensagemErro);
                    resetarBotao(btn);
                }
            } catch (err) {
                console.error('❌ Erro na requisição:', err);
                mostrarErro('Erro de conexão. Verifique sua internet e tente novamente.');
                resetarBotao(btn);
            }
        });

        function mostrarErro(mensagem) {
            const errorMsg = document.getElementById('errorMsg');
            errorMsg.textContent = '⚠️ ' + mensagem;
            errorMsg.classList.add('active');
            
            // Rolar para o erro
            errorMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        function resetarBotao(btn) {
            btn.innerHTML = 'ENVIAR SOLICITAÇÃO';
            btn.disabled = false;
        }
    