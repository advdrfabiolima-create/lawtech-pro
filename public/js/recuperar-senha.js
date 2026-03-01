
        async function solicitarLink() {
            const email = document.getElementById('emailRecuperar').value.trim();
            if (!email) {
                alert('Informe seu e-mail.');
                return;
            }

            const btn = document.getElementById('btnEnviar');
            btn.disabled = true;
            btn.textContent = 'Enviando...';

            try {
                const res = await fetch('/api/auth/recuperar-senha', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                const data = await res.json();

                if (res.ok && data.ok) {
                    document.getElementById('formArea').style.display = 'none';
                    document.getElementById('msg').innerHTML =
                        '✅ Instruções enviadas! Verifique sua caixa de entrada (e o spam).<br><br>' +
                        '<small style="color:#94a3b8;">O link expira em 1 hora.</small>';
                } else {
                    alert(data.erro || 'Erro ao processar solicitação.');
                    btn.disabled = false;
                    btn.textContent = 'Enviar Instruções';
                }
            } catch (e) {
                alert('Erro de conexão. Tente novamente.');
                btn.disabled = false;
                btn.textContent = 'Enviar Instruções';
            }
        }

        document.getElementById('emailRecuperar').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') solicitarLink();
        });
    