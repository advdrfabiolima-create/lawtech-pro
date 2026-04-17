/* ============================================================
   pagamento-pendente.js
   Fluxo de pagamento para usuários em trial ou inadimplentes.
   Funciona para qualquer usuário já logado (usa JWT).
   ============================================================ */

let emailUsuario = '';
let planInfo = { nome: 'Básico', valor: 97 };
let pixPolling = null;
let pixCobrancaId = null;

// ── Utilitários de navegação ──────────────────────────────────
function mostrarStep(id) {
    ['step1','stepPix','stepCartao'].forEach(s => {
        const el = document.getElementById(s);
        if (el) el.style.display = s === id ? (id === 'step1' ? 'block' : 'flex') : 'none';
    });
    // stepPix e stepCartao precisam de flex para centralizar
    const alvo = document.getElementById(id);
    if (alvo && id !== 'step1') alvo.style.display = 'block';
}

function pararPolling() {
    if (pixPolling) { clearInterval(pixPolling); pixPolling = null; }
}

// ── Inicialização ─────────────────────────────────────────────
async function init() {
    // Busca email e dados do plano do usuário logado
    try {
        const res = await API.get('/api/auth/me');
        if (!res.ok) { window.location.href = '/login'; return; }
        const data = await res.json();
        const u = data.usuario || data;
        emailUsuario = u.email || '';

        // Dias restantes do trial
        if (u.trial_expira_em && u.plano_financeiro_status === 'trial') {
            const dias = Math.ceil((new Date(u.trial_expira_em) - new Date()) / 86400000);
            if (dias > 0) {
                document.getElementById('step1Titulo').textContent = 'Assinar agora';
                document.getElementById('step1Sub').innerHTML =
                    `Você ainda tem <strong>${dias} dia${dias !== 1 ? 's' : ''} de trial</strong> restantes. ` +
                    `Ao assinar agora, o período restante será descartado e sua assinatura começa imediatamente.`;
            }
        }
    } catch (_) {
        window.location.href = '/login';
        return;
    }

    // Busca valor do plano
    try {
        const res2 = await API.get('/api/planos/meu-plano');
        if (res2.ok) {
            const d = await res2.json();
            planInfo.nome  = d.nome  || 'Básico';
        }
    } catch (_) {}

    // Busca preço do plano atual
    try {
        const res3 = await fetch('/api/auth/pagar-trial-pix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailUsuario, apenas_valor: true })
        });
        // ignora erro — só queremos o valor se retornar
    } catch (_) {}

    // Atualiza textos de valor (usaremos no PIX/cartão)
    document.getElementById('cartaoPlanInfo').textContent = `Plano ${planInfo.nome}`;
}

// ── Fluxo PIX ─────────────────────────────────────────────────
async function iniciarPix() {
    mostrarStep('stepPix');
    document.getElementById('pixLoading').style.display  = 'block';
    document.getElementById('pixContent').style.display  = 'none';
    document.getElementById('pixErro').style.display     = 'none';
    document.getElementById('pixSucesso').style.display  = 'none';

    try {
        const res = await fetch('/api/auth/pagar-trial-pix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailUsuario })
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
            throw new Error(data.erro || 'Erro ao gerar PIX');
        }

        pixCobrancaId = data.cobrancaId;
        planInfo.valor = data.valor || planInfo.valor;

        document.getElementById('pixLoading').style.display = 'none';
        document.getElementById('pixContent').style.display = 'block';
        document.getElementById('pixQrImg').src = `data:image/png;base64,${data.pixQrCodeBase64}`;
        document.getElementById('pixPayload').value = data.pixPayload;
        document.getElementById('pixPlanInfo').textContent =
            `Plano ${data.planNome} — R$ ${parseFloat(data.valor).toFixed(2).replace('.',',')}`;

        // Polling a cada 4s
        pixPolling = setInterval(verificarPix, 4000);

    } catch (err) {
        document.getElementById('pixLoading').style.display = 'none';
        document.getElementById('pixErro').style.display = 'block';
        document.getElementById('pixErroMsg').textContent = err.message;
    }
}

async function verificarPix() {
    if (!pixCobrancaId) return;
    try {
        const res = await fetch(`/api/auth/verificar-pix/${pixCobrancaId}`);
        const data = await res.json();
        if (data.pago) {
            pararPolling();
            document.getElementById('pixSucesso').style.display = 'block';
            document.querySelector('#stepPix .status-box').style.display = 'none';
        }
    } catch (_) {}
}

// ── Fluxo Cartão ──────────────────────────────────────────────
async function processarCartao(e) {
    e.preventDefault();
    const btn = document.getElementById('btnPagarCartao');
    const erroEl = document.getElementById('cartaoErro');
    erroEl.style.display = 'none';

    const validade = document.getElementById('cartaoValidade').value.trim();
    const [expMes, expAno] = validade.split('/');

    btn.disabled = true;
    btn.textContent = 'Processando...';

    try {
        const res = await fetch('/api/auth/pagar-trial-cartao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email:       emailUsuario,
                holderName:  document.getElementById('cartaoNome').value.trim(),
                number:      document.getElementById('cartaoNumero').value.replace(/\s/g,''),
                expiryMonth: expMes,
                expiryYear:  expAno,
                ccv:         document.getElementById('cartaoCvv').value.trim()
            })
        });
        const data = await res.json();

        if (res.ok && data.ok) {
            document.getElementById('cartaoFormWrapper').style.display = 'none';
            document.getElementById('cartaoSucesso').style.display = 'block';
        } else {
            throw new Error(data.erro || 'Cartão recusado. Verifique os dados.');
        }
    } catch (err) {
        erroEl.textContent = err.message;
        erroEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Pagar';
    }
}

// ── Formatação do cartão ──────────────────────────────────────
document.getElementById('cartaoNumero').addEventListener('input', function () {
    let v = this.value.replace(/\D/g,'').slice(0,16);
    this.value = v.replace(/(.{4})/g,'$1 ').trim();
});
document.getElementById('cartaoValidade').addEventListener('input', function () {
    let v = this.value.replace(/\D/g,'').slice(0,4);
    if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
    this.value = v;
});

// ── Copiar PIX ────────────────────────────────────────────────
document.getElementById('btnCopiarPix').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('pixPayload').value)
        .then(() => { document.getElementById('btnCopiarPix').textContent = 'Copiado!'; setTimeout(() => { document.getElementById('btnCopiarPix').textContent = 'Copiar'; }, 2000); })
        .catch(() => {});
});

// ── Eventos ───────────────────────────────────────────────────
document.getElementById('btnIniciarPix').addEventListener('click', iniciarPix);
document.getElementById('btnMostrarCartao').addEventListener('click', () => mostrarStep('stepCartao'));
document.getElementById('btnVoltarPix').addEventListener('click', () => { pararPolling(); mostrarStep('step1'); });
document.getElementById('btnVoltarCartao').addEventListener('click', () => mostrarStep('step1'));
document.getElementById('btnPixRetry').addEventListener('click', iniciarPix);
document.getElementById('formCartao').addEventListener('submit', processarCartao);
document.getElementById('btnLogout').addEventListener('click', () => { localStorage.clear(); sessionStorage.clear(); window.location.href = '/login'; });

// ── Start ─────────────────────────────────────────────────────
mostrarStep('step1');
init();
