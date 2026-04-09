/* ========================================
   LawTech Pro — Landing Page Script
   ======================================== */

// ---- SCROLL SUAVE PARA FORMULÁRIO ----
document.querySelectorAll('[data-scroll]').forEach(el => {
  el.addEventListener('click', () => {
    const target = document.getElementById(el.dataset.scroll);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // foca o primeiro input após scroll
      setTimeout(() => {
        const first = target.querySelector('input');
        if (first) first.focus();
      }, 600);
    }
  });
});

// ---- ANIMAÇÕES DE ENTRADA (Intersection Observer) ----
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));

// ---- VALIDAÇÃO E ENVIO DO FORMULÁRIO ----
const form    = document.getElementById('registerForm');
const message = document.getElementById('formMessage');
const btnSubmit = document.getElementById('btnSubmit');

function showMsg(type, text) {
  message.className = `form-message ${type} show`;
  message.textContent = text;
}

function clearMsg() {
  message.className = 'form-message';
  message.textContent = '';
}

function setLoading(loading) {
  btnSubmit.disabled = loading;
  btnSubmit.textContent = loading ? 'Criando sua conta...' : 'COMEÇAR TESTE GRATUITO';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMsg();

  const nome  = document.getElementById('nome').value.trim();
  const email = document.getElementById('email').value.trim().toLowerCase();
  const senha = document.getElementById('senha').value;

  // Validações básicas
  if (!nome || nome.length < 3) {
    showMsg('error', 'Informe seu nome completo.');
    return document.getElementById('nome').focus();
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showMsg('error', 'Informe um e-mail válido.');
    return document.getElementById('email').focus();
  }
  if (senha.length < 6) {
    showMsg('error', 'A senha deve ter pelo menos 6 caracteres.');
    return document.getElementById('senha').focus();
  }

  setLoading(true);

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, senha })
    });

    const data = await res.json();

    if (res.ok && data.ok) {
      // Salva token e redireciona
      localStorage.setItem('token', data.token);

      // Meta Pixel — CompleteRegistration
      if (typeof fbq !== 'undefined') {
        fbq('track', 'CompleteRegistration');
      }

      showMsg('success', '✅ Conta criada! Redirecionando...');
      setTimeout(() => {
        window.location.href = '/dashboard-modern';
      }, 1500);
    } else {
      showMsg('error', data.erro || 'Erro ao criar conta. Tente novamente.');
      setLoading(false);
    }
  } catch (err) {
    console.error(err);
    showMsg('error', 'Erro de conexão. Verifique sua internet e tente novamente.');
    setLoading(false);
  }
});

// ---- MÁSCARA: remove espaços em branco do email ao digitar ----
document.getElementById('email').addEventListener('input', function () {
  this.value = this.value.replace(/\s/g, '');
});
