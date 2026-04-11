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

// ---- META PIXEL: Lead — clique em qualquer CTA que leva ao formulário ----
let _leadFired = false;
document.querySelectorAll('a[href="#cadastro"]').forEach(function (el) {
  el.addEventListener('click', function () {
    if (!_leadFired && typeof fbq !== 'undefined') {
      fbq('track', 'Lead');
      _leadFired = true;
    }
  });
});

// ---- META PIXEL: ViewContent — formulário de cadastro entra na tela ----
// (não há seleção de plano separada na landing; ViewContent dispara ao chegar no form)
var _viewContentFired = false;
var _cadastroSection = document.getElementById('cadastro');
if (_cadastroSection && 'IntersectionObserver' in window) {
  var _obs = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting && !_viewContentFired) {
      if (typeof fbq !== 'undefined') fbq('track', 'ViewContent');
      _viewContentFired = true;
      _obs.disconnect();
    }
  }, { threshold: 0.4 });
  _obs.observe(_cadastroSection);
}

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

      showMsg('ok', '✅ Conta criada com sucesso! Redirecionando...');
      // CompleteRegistration é disparado na página /obrigado
      setTimeout(() => { window.location.href = '/obrigado'; }, 1200);
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
