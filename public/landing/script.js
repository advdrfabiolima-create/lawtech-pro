/* ========================================
   LawTech Pro — Landing Page Script v2
   ======================================== */

// ---- SCROLL SUAVE ----
document.querySelectorAll('[data-scroll]').forEach(el => {
  el.addEventListener('click', () => {
    const target = document.getElementById(el.dataset.scroll);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      const first = target.querySelector('input');
      if (first) first.focus();
    }, 650);
  });
});

// ---- FADE-UP COM INTERSECTION OBSERVER ----
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('on'); io.unobserve(e.target); }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.fu').forEach(el => io.observe(el));

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

  const nome  = document.getElementById('nome').value.trim();
  const email = document.getElementById('email').value.trim().toLowerCase();
  const senha = document.getElementById('senha').value;

  if (!nome || nome.length < 3)           return (showMsg('err', 'Informe seu nome completo.'),  document.getElementById('nome').focus());
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (showMsg('err', 'Informe um e-mail válido.'), document.getElementById('email').focus());
  if (senha.length < 6)                   return (showMsg('err', 'A senha deve ter pelo menos 6 caracteres.'), document.getElementById('senha').focus());

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
      if (typeof fbq !== 'undefined') fbq('track', 'CompleteRegistration');
      showMsg('ok', '✅ Conta criada! Redirecionando...');
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

// Remove espaços do email ao digitar
document.getElementById('email').addEventListener('input', function () {
  this.value = this.value.replace(/\s/g, '');
});
