
// ────────────────────────────────────────────────────────────────────────────
// HERO FORM — REGISTRO DIRETO
// ────────────────────────────────────────────────────────────────────────────

(function () {
    var senhaInput  = document.getElementById('heroSenha');
    var pwdReqs     = document.getElementById('pwdReqs');
    var senhaToggle = document.getElementById('senhaToggle');
    var iconOlho    = document.getElementById('iconOlho');

    // Ícone olho aberto/fechado
    var OLHO_ABERTO  = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
    var OLHO_FECHADO = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';

    if (senhaToggle && senhaInput) {
        senhaToggle.addEventListener('click', function () {
            var hidden = senhaInput.type === 'password';
            senhaInput.type = hidden ? 'text' : 'password';
            if (iconOlho) iconOlho.innerHTML = hidden ? OLHO_FECHADO : OLHO_ABERTO;
        });
    }

    function setReq(id, state) {
        // state: 'ok' | 'fail' | 'neutral'
        var el   = document.getElementById(id);
        var dot  = el ? el.querySelector('.pwd-req-dot') : null;
        if (!el) return;
        el.className = 'pwd-req' + (state === 'ok' ? ' ok' : state === 'fail' ? ' fail' : '');
        if (dot) dot.textContent = state === 'ok' ? '✓' : state === 'fail' ? '✕' : '—';
    }

    if (senhaInput) {
        senhaInput.addEventListener('input', function () {
            var v = senhaInput.value;
            if (pwdReqs) pwdReqs.classList.toggle('visible', v.length > 0);
            if (v.length === 0) {
                setReq('req-len',   'neutral');
                setReq('req-upper', 'neutral');
                setReq('req-lower', 'neutral');
                setReq('req-num',   'neutral');
                return;
            }
            setReq('req-len',   v.length >= 8            ? 'ok' : 'fail');
            setReq('req-upper', /[A-Z]/.test(v)          ? 'ok' : 'fail');
            setReq('req-lower', /[a-z]/.test(v)          ? 'ok' : 'fail');
            setReq('req-num',   /[0-9]/.test(v)          ? 'ok' : 'fail');
        });
    }

    function showHeroError(msg) {
        var el = document.getElementById('heroFormError');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('visible');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function hideHeroError() {
        var el = document.getElementById('heroFormError');
        if (el) el.classList.remove('visible');
    }

    var heroForm = document.getElementById('heroRegForm');
    if (heroForm) {
        heroForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            hideHeroError();

            var nome  = (document.getElementById('heroNome').value || '').trim();
            var email = (document.getElementById('heroEmail').value || '').trim();
            var senha = (document.getElementById('heroSenha').value || '');

            if (!nome || !email || !senha) {
                showHeroError('Preencha todos os campos para continuar.');
                return;
            }

            if (senha.length < 8)           { showHeroError('A senha precisa ter no mínimo 8 caracteres.'); return; }
            if (!/[A-Z]/.test(senha))        { showHeroError('A senha precisa ter ao menos uma letra maiúscula.'); return; }
            if (!/[a-z]/.test(senha))        { showHeroError('A senha precisa ter ao menos uma letra minúscula.'); return; }
            if (!/[0-9]/.test(senha))        { showHeroError('A senha precisa ter ao menos um número.'); return; }

            // Meta Pixel — Lead
            if (typeof fbq !== 'undefined') fbq('track', 'Lead');

            var btn = document.getElementById('btnHeroSubmit');
            var originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Criando sua conta...';

            try {
                var response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nome:  nome,
                        email: email,
                        senha: senha,
                        planoId: 2,
                        preferenciaPagamento: 'pix'
                    })
                });

                var data = await response.json();

                if (response.ok) {
                    // Meta Pixel — CompleteRegistration
                    if (typeof fbq !== 'undefined') fbq('track', 'CompleteRegistration');
                    window.location.href = '/login?registro=sucesso&trial=7';
                } else {
                    showHeroError(data.erro || 'Erro ao criar conta. Tente novamente.');
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            } catch (_) {
                showHeroError('Erro de conexão. Verifique sua internet e tente novamente.');
                btn.disabled = false;
                btn.textContent = originalText;
            }
        });
    }
})();

// ────────────────────────────────────────────────────────────────────────────
// PRICING TOGGLE
// ────────────────────────────────────────────────────────────────────────────

function formatarPreco(valor) {
    var partes = String(valor).split(',');
    var inteiro = partes[0];
    var centavos = partes[1] || '00';
    return inteiro + '<span style="font-size:0.55em;vertical-align:super;">,'+centavos+'</span>';
}

function calcularMensalAnual(totalAnual) {
    var total = parseFloat(totalAnual);
    var mensal = total / 12;
    return mensal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toggleBilling() {
    var isAnnual = document.getElementById('billingToggle').checked;
    var amounts      = document.querySelectorAll('.amount');
    var totaisAnuais = document.querySelectorAll('.total-anual');
    var labelMensal  = document.getElementById('label-mensal');
    var labelAnual   = document.getElementById('label-anual');

    amounts.forEach(function (amount) {
        if (isAnnual) {
            amount.innerHTML = formatarPreco(calcularMensalAnual(amount.dataset.anual));
        } else {
            amount.innerHTML = formatarPreco(amount.dataset.mensal);
        }
    });

    totaisAnuais.forEach(function (el) {
        el.style.display = isAnnual ? 'block' : 'none';
    });

    if (isAnnual) {
        if (labelMensal) labelMensal.classList.remove('active');
        if (labelAnual)  labelAnual.classList.add('active');
    } else {
        if (labelMensal) labelMensal.classList.add('active');
        if (labelAnual)  labelAnual.classList.remove('active');
    }
}

// ────────────────────────────────────────────────────────────────────────────
// HELPERS (delegação de eventos)
// ────────────────────────────────────────────────────────────────────────────

function navegarPara(url) { window.location.href = url; }
function removerElemento(id) { var el = document.getElementById(id); if (el) el.remove(); }
function clicarElemento(id)  { var el = document.getElementById(id); if (el) el.click(); }

// ────────────────────────────────────────────────────────────────────────────
// INICIAR TESTE — planos (redireciona para register.html)
// ────────────────────────────────────────────────────────────────────────────

function iniciarTeste(plano) {
    var isAnnual = document.getElementById('billingToggle') && document.getElementById('billingToggle').checked;
    var cobranca = isAnnual ? 'anual' : 'mensal';

    // Meta Pixel — ViewContent + InitiateCheckout
    if (typeof fbq !== 'undefined') {
        fbq('track', 'ViewContent', { content_name: 'Plano Selecionado' });
        fbq('track', 'InitiateCheckout', {
            content_name: plano,
            content_category: 'Plano SaaS Jurídico',
            trial: '7 dias'
        });
    }

    setTimeout(function () {
        window.location.href = '/register.html?plano=' + plano + '&cobranca=' + cobranca + '&trial=7d';
    }, 300);
}

// ────────────────────────────────────────────────────────────────────────────
// MODAL CONTATO
// ────────────────────────────────────────────────────────────────────────────

function abrirModalContato() {
    document.getElementById('modalContato').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function fecharModalContato() {
    document.getElementById('modalContato').classList.remove('active');
    document.body.style.overflow = 'auto';
    setTimeout(function () {
        var f = document.getElementById('formularioContato');
        var s = document.getElementById('mensagemSucesso');
        if (f) f.style.display = 'block';
        if (s) s.classList.remove('active');
        var form = document.querySelector('#formularioContato form');
        if (form) form.reset();
    }, 300);
}

// ────────────────────────────────────────────────────────────────────────────
// MENU MOBILE
// ────────────────────────────────────────────────────────────────────────────

(function () {
    var navToggle  = document.getElementById('navToggle');
    var mobileMenu = document.getElementById('mobileMenu');

    if (!navToggle || !mobileMenu) return;

    navToggle.addEventListener('click', function () {
        var open = mobileMenu.classList.toggle('open');
        navToggle.setAttribute('aria-expanded', open);
    });

    // fechar ao clicar num link do menu
    mobileMenu.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () {
            mobileMenu.classList.remove('open');
            navToggle.setAttribute('aria-expanded', 'false');
        });
    });

    // fechar ao clicar fora
    document.addEventListener('click', function (e) {
        if (!document.getElementById('mainNav').contains(e.target)) {
            mobileMenu.classList.remove('open');
            navToggle.setAttribute('aria-expanded', 'false');
        }
    });
})();

// ────────────────────────────────────────────────────────────────────────────
// DOMCONTENTLOADED — inicialização
// ────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
    // Formata preços na inicialização
    document.querySelectorAll('.amount').forEach(function (amount) {
        amount.innerHTML = formatarPreco(amount.dataset.mensal);
    });

    // Billing toggle listener
    var billingToggle = document.getElementById('billingToggle');
    if (billingToggle) billingToggle.addEventListener('change', toggleBilling);
    var labelMensal = document.getElementById('label-mensal');
    if (labelMensal) labelMensal.classList.add('active');

    // Contato form submit
    var contatoForm = document.getElementById('contatoForm');
    if (contatoForm) contatoForm.addEventListener('submit', enviarContato);

    // Modal contato fechar ao clicar fora
    var modalContato = document.getElementById('modalContato');
    if (modalContato) {
        modalContato.addEventListener('click', function (e) {
            if (e.target === this) fecharModalContato();
        });
    }

    // ESC fecha modal
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') fecharModalContato();
    });

    // Meta Pixel — Lead em botões de CTA primários
    document.querySelectorAll('a.btn-cta-primary, .nav-btn-cta').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (typeof fbq !== 'undefined') fbq('track', 'Lead');
        });
    });

    // Smooth scroll para âncoras internas
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
        anchor.addEventListener('click', function (e) {
            var href = this.getAttribute('href');
            if (!href || href === '#') return;
            var target = document.querySelector(href);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    // Máscara de telefone no modal de contato
    var telInput = document.getElementById('contatoTelefone');
    if (telInput) {
        telInput.addEventListener('input', function (e) {
            var valor = e.target.value.replace(/\D/g, '');
            if (valor.length > 11) valor = valor.slice(0, 11);
            if (valor.length > 10) {
                valor = valor.replace(/^(\d{2})(\d{5})(\d{4}).*/, '($1) $2-$3');
            } else if (valor.length > 6) {
                valor = valor.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, '($1) $2-$3');
            } else if (valor.length > 2) {
                valor = valor.replace(/^(\d{2})(\d{0,5})/, '($1) $2');
            } else {
                valor = valor.replace(/^(\d*)/, '($1)');
            }
            e.target.value = valor;
        });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// ENVIO DE CONTATO
// ────────────────────────────────────────────────────────────────────────────

async function enviarContato(event) {
    event.preventDefault();
    var btn = event.target.querySelector('.btn-submit');
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    var dados = {
        nome:      document.getElementById('contatoNome').value,
        email:     document.getElementById('contatoEmail').value,
        telefone:  document.getElementById('contatoTelefone').value,
        motivo:    document.getElementById('contatoMotivo').value,
        mensagem:  document.getElementById('contatoMensagem').value,
        data:      new Date().toLocaleString('pt-BR')
    };

    try {
        var resp = await fetch('/api/auth/contato', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });

        if (!resp.ok) {
            var err = await resp.json().catch(function () { return {}; });
            throw new Error(err.erro || 'Erro ao enviar mensagem');
        }

        document.getElementById('formularioContato').style.display = 'none';
        document.getElementById('mensagemSucesso').classList.add('active');

        setTimeout(function () { fecharModalContato(); }, 3000);

    } catch (error) {
        alert(error.message || 'Erro ao enviar. Tente novamente ou escreva para contato@lawtechpro.com.br');
        btn.disabled = false;
        btn.textContent = originalText;
    }
}
