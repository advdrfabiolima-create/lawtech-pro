/* ========================================
   LawTech Pro — Landing Page Script v3
   ======================================== */

// ---- ANO NO RODAPÉ ----
document.getElementById('year').textContent = new Date().getFullYear();

// ---- FAQ: fecha os outros ao abrir um ----
const faqs = document.querySelectorAll('details.faq');
faqs.forEach(faq => {
  faq.addEventListener('toggle', () => {
    if (faq.open) {
      faqs.forEach(item => { if (item !== faq) item.open = false; });
    }
  });
});

// ---- FORMULÁRIO ----
const form    = document.getElementById('registerForm');
const msg     = document.getElementById('formMsg');
const btnSend = document.getElementById('btnSubmit');

function showMsg(type, text) {
  msg.className = `form-msg ${type}`;
  msg.textContent = text;
}

function setLoading(on) {
  btnSend.disabled = on;
  btnSend.textContent = on ? 'Criando sua conta...' : 'COMEÇAR TESTE GRATUITO';
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  msg.className = 'form-msg';

  const nome  = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim().toLowerCase();
  const senha = document.getElementById('password').value;

  // Validações
  if (!nome || nome.length < 3) {
    showMsg('err', 'Informe seu nome completo.');
    return document.getElementById('name').focus();
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showMsg('err', 'Informe um e-mail válido.');
    return document.getElementById('email').focus();
  }
  if (senha.length < 6) {
    showMsg('err', 'A senha deve ter pelo menos 6 caracteres.');
    return document.getElementById('password').focus();
  }

  setLoading(true);

  try {
    const res  = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, senha })
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      localStorage.setItem('token', data.token);

      // Meta Pixel — CompleteRegistration
      if (typeof fbq !== 'undefined') fbq('track', 'CompleteRegistration');

      showMsg('ok', '✅ Conta criada com sucesso! Redirecionando...');
      setTimeout(() => { window.location.href = '/dashboard-modern'; }, 1500);
    } else {
      showMsg('err', data.erro || 'Erro ao criar conta. Tente novamente.');
      setLoading(false);
    }
  } catch {
    showMsg('err', 'Erro de conexão. Verifique sua internet e tente novamente.');
    setLoading(false);
  }
});

// Remove espaços do e-mail ao digitar
document.getElementById('email').addEventListener('input', function () {
  this.value = this.value.replace(/\s/g, '');
});
