
(async function () {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const content = document.getElementById('content');

    if (!token) {
        const pendente = params.get('pendente');

        if (pendente === '1') {
            content.innerHTML = `
                <div class="icon">📧</div>
                <h1 class="title">Confirme seu E-mail</h1>
                <p class="msg">Enviamos um link de confirmação para o seu e-mail cadastrado.<br>
                Clique no link recebido para ativar sua conta e liberar o acesso ao sistema.</p>
                <button id="btnReenviar" class="btn" style="margin-bottom:12px;cursor:pointer;">Reenviar E-mail de Confirmação</button>
                <br><a href="/login.html" class="btn" style="background:#64748b;">Ir para o Login</a>`;

            document.getElementById('btnReenviar').addEventListener('click', async function () {
                const btn = this;
                btn.disabled = true;
                btn.textContent = 'Enviando...';
                const jwt = localStorage.getItem('token') || sessionStorage.getItem('token');
                if (!jwt) {
                    btn.textContent = 'Sessão expirada. Faça login novamente.';
                    return;
                }
                try {
                    const r = await fetch('/api/auth/reenviar-verificacao', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + jwt }
                    });
                    const d = await r.json();
                    if (d.ok) {
                        btn.textContent = '✅ E-mail reenviado! Verifique sua caixa de entrada.';
                    } else {
                        btn.disabled = false;
                        btn.textContent = d.erro || 'Erro ao reenviar. Tente novamente.';
                    }
                } catch (e) {
                    btn.disabled = false;
                    btn.textContent = 'Erro de conexão. Tente novamente.';
                }
            });
        } else {
            content.innerHTML = `
                <div class="icon">⚠️</div>
                <h1 class="title">Link Inválido</h1>
                <p class="msg">Este link de verificação é inválido. Certifique-se de clicar no link correto enviado ao seu e-mail.</p>
                <a href="/login.html" class="btn">Ir para o Login</a>`;
        }
        return;
    }

    try {
        const res = await fetch(`/api/auth/verificar-email?token=${encodeURIComponent(token)}`);
        const data = await res.json();

        if (data.ok) {
            content.innerHTML = `
                <div class="icon">✅</div>
                <h1 class="title">E-mail Verificado!</h1>
                <p class="msg">Seu e-mail foi confirmado com sucesso. Agora você tem acesso completo ao LawTech Pro.</p>
                <a href="/login.html" class="btn">Acessar o Sistema →</a>`;
        } else {
            content.innerHTML = `
                <div class="icon">❌</div>
                <h1 class="title">Link Expirado</h1>
                <p class="msg">${data.erro || 'Este link de verificação é inválido ou expirou.'}<br><br>
                Faça login e solicite um novo link de verificação nas configurações da sua conta.</p>
                <a href="/login.html" class="btn">Ir para o Login</a>`;
        }
    } catch (err) {
        content.innerHTML = `
            <div class="icon">❌</div>
            <h1 class="title">Erro de Conexão</h1>
            <p class="msg">Não foi possível verificar seu e-mail. Verifique sua conexão e tente novamente.</p>
            <a href="/login.html" class="btn">Ir para o Login</a>`;
    }
})();
