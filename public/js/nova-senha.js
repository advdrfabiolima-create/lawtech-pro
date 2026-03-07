
        // Extrair token da URL
        const token = new URLSearchParams(window.location.search).get('token');

        if (!token) {
            document.getElementById('formArea').style.display = 'none';
            document.getElementById('msg').innerHTML =
                '❌ Link inválido ou expirado.<br><br>' +
                '<a href="/recuperar-senha.html" style="color:#2563eb;font-weight:600;">Solicitar novo link</a>';
        }

        async function salvarSenha() {
            const novaSenha = document.getElementById('novaSenha').value;
            const confirmar = document.getElementById('confirmarSenha').value;
            const erroDiv = document.getElementById('erroMsg');

            erroDiv.style.display = 'none';

            if (!novaSenha || !confirmar) {
                erroDiv.textContent = 'Preencha os dois campos.';
                erroDiv.style.display = 'block';
                return;
            }
            if (novaSenha !== confirmar) {
                erroDiv.textContent = 'As senhas não coincidem.';
                erroDiv.style.display = 'block';
                return;
            }

            const btn = document.getElementById('btnSalvar');
            btn.disabled = true;
            btn.textContent = 'Salvando...';

            try {
                const res = await fetch('/api/auth/nova-senha', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, novaSenha })
                });
                const data = await res.json();

                if (res.ok && data.ok) {
                    document.getElementById('formArea').style.display = 'none';
                    document.getElementById('msg').innerHTML =
                        '✅ Senha alterada com sucesso!<br><br>' +
                        '<a href="/login.html" style="color:#2563eb;font-weight:700;">Clique aqui para fazer login →</a>';
                } else {
                    erroDiv.textContent = data.erro || 'Erro ao alterar senha.';
                    erroDiv.style.display = 'block';
                    btn.disabled = false;
                    btn.textContent = 'Salvar Nova Senha';
                }
            } catch (e) {
                erroDiv.textContent = 'Erro de conexão. Tente novamente.';
                erroDiv.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Salvar Nova Senha';
            }
        }

        document.getElementById('btnSalvar').addEventListener('click', salvarSenha);
