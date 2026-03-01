
(async function () {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const content = document.getElementById('content');

    if (!token) {
        content.innerHTML = `
            <div class="icon">⚠️</div>
            <h1 class="title">Link Inválido</h1>
            <p class="msg">Este link de verificação é inválido. Certifique-se de clicar no link correto enviado ao seu e-mail.</p>
            <a href="/login.html" class="btn">Ir para o Login</a>`;
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
