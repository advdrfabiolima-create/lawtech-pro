/**
 * acesso-portal.js — Página pública de solicitação de acesso ao portal do cliente
 * Extrai o slug da URL /acesso/:slug, carrega os dados do escritório e
 * envia o magic link por e-mail quando o cliente informa o CPF.
 */

// Extrai o slug da URL: /acesso/:slug
const slug = window.location.pathname.split('/acesso/')[1]?.split('/')[0] || '';

async function init() {
    const loading = document.getElementById('loading');
    const notFound = document.getElementById('escritorio-not-found');
    const headerContent = document.getElementById('header-content');
    const formArea = document.getElementById('form-area');

    if (!slug) {
        loading.style.display = 'none';
        notFound.style.display = 'block';
        return;
    }

    try {
        const res = await fetch('/api/portal/escritorio/' + encodeURIComponent(slug));
        const data = await res.json();

        loading.style.display = 'none';

        if (!data.ok) {
            notFound.style.display = 'block';
            return;
        }

        document.getElementById('escritorio-nome').textContent = data.escritorio.nome || '';
        document.title = 'Acesso ao Portal — ' + (data.escritorio.nome || '');

        if (data.escritorio.logo_base64) {
            const img = document.getElementById('logo-img');
            img.src = data.escritorio.logo_base64;
            img.style.display = 'block';
        } else if (data.escritorio.logo_arquivo) {
            const img = document.getElementById('logo-img');
            img.src = '/logos/' + data.escritorio.logo_arquivo;
            img.style.display = 'block';
        }

        headerContent.style.display = 'block';
        formArea.style.display = 'block';

    } catch (e) {
        loading.style.display = 'none';
        notFound.style.display = 'block';
    }
}

// Máscara CPF
document.getElementById('cpf').addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').substring(0, 11);
    if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    this.value = v;
});

document.getElementById('cpf').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') solicitarAcesso();
});

document.getElementById('btnSolicitar').addEventListener('click', solicitarAcesso);

async function solicitarAcesso() {
    const cpf = document.getElementById('cpf').value.trim();
    const btn = document.getElementById('btnSolicitar');
    const cpfLimpo = cpf.replace(/\D/g, '');

    if (cpfLimpo.length !== 11) {
        mostrarMsg('error', 'Informe um CPF válido com 11 dígitos.');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Enviando...';
    document.getElementById('msg').style.display = 'none';

    try {
        const res = await fetch('/api/portal/solicitar-acesso', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cpf: cpfLimpo, escritorio_slug: slug })
        });
        const data = await res.json();

        if (res.status === 429) {
            mostrarMsg('error', 'Muitas tentativas. Aguarde 1 hora e tente novamente.');
        } else {
            mostrarMsg('success', data.mensagem || 'Se o CPF estiver cadastrado, você receberá um e-mail com o link de acesso em breve.');
            document.getElementById('cpf').value = '';
        }
    } catch (e) {
        mostrarMsg('error', 'Erro de conexão. Verifique sua internet e tente novamente.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Enviar link por e-mail';
    }
}

function mostrarMsg(tipo, texto) {
    const msg = document.getElementById('msg');
    msg.className = 'msg ' + tipo;
    msg.textContent = texto;
    msg.style.display = 'block';
}

init();
