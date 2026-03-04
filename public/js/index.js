!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '4408320902783347');
fbq('track', 'PageView');


        function formatarPreco(valor) {
            const partes = valor.split(',');
            const inteiro = partes[0];
            const centavos = partes[1] || '00';
            return `${inteiro}<span style="font-size: 0.55em; vertical-align: super;">,${centavos}</span>`;
        }

        function calcularMensalAnual(totalAnual) {
            // totalAnual é string ex: "999" ou "2999"
            const total = parseFloat(totalAnual);
            const mensal = total / 12;
            // Formata com 2 casas decimais usando vírgula
            return mensal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        function formatarTotalAnual(totalAnual) {
            const total = parseFloat(totalAnual);
            return total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        function toggleBilling() {
            const isAnnual = document.getElementById('billingToggle').checked;
            const amounts = document.querySelectorAll('.amount');
            const periods = document.querySelectorAll('.period');
            const totaisAnuais = document.querySelectorAll('.total-anual');
            const labelMensal = document.getElementById('label-mensal');
            const labelAnual = document.getElementById('label-anual');

            amounts.forEach(amount => {
                if (isAnnual) {
                    // Mostra o valor mensal equivalente (total/12)
                    const mensalEquivalente = calcularMensalAnual(amount.dataset.anual);
                    amount.innerHTML = formatarPreco(mensalEquivalente);
                } else {
                    amount.innerHTML = formatarPreco(amount.dataset.mensal);
                }
            });

            periods.forEach(period => {
                period.textContent = '/mês';
            });

            totaisAnuais.forEach(el => {
                el.style.display = isAnnual ? 'block' : 'none';
            });

            if (isAnnual) {
                labelMensal.classList.remove('active');
                labelAnual.classList.add('active');
            } else {
                labelMensal.classList.add('active');
                labelAnual.classList.remove('active');
            }
        }

        // Formata os preços na inicialização
        document.addEventListener('DOMContentLoaded', function() {
            const amounts = document.querySelectorAll('.amount');
            amounts.forEach(amount => {
                amount.innerHTML = formatarPreco(amount.dataset.mensal);
            });
        });

        function iniciarTeste(plano) {
    const isAnnual = document.getElementById('billingToggle').checked;
    const cobranca = isAnnual ? 'anual' : 'mensal';

    // 🔵 Evento Meta Pixel - Clique no botão de teste
    if (typeof fbq !== 'undefined') {
        fbq('track', 'InitiateCheckout', {
            content_name: plano,
            content_category: 'Plano SaaS Jurídico',
            trial: '7 dias'
        });
    }

    // Pequeno delay para garantir envio do evento antes do redirect
    setTimeout(function() {
        window.location.href = `/register.html?plano=${plano}&cobranca=${cobranca}&trial=7d`;
    }, 300);
}
        
        // ====== MENU MOBILE ======
        const navToggle = document.getElementById('navToggle');
        const mainNav   = document.getElementById('mainNav');

        navToggle.addEventListener('click', () => {
            const aberto = mainNav.classList.toggle('menu-open');
            navToggle.setAttribute('aria-expanded', aberto);
        });

        function fecharMenuMobile() {
            mainNav.classList.remove('menu-open');
            navToggle.setAttribute('aria-expanded', 'false');
        }

        document.addEventListener('click', (e) => {
            if (!mainNav.contains(e.target) && mainNav.classList.contains('menu-open')) {
                fecharMenuMobile();
            }
        });

        // Inicializa com mensal ativo
        document.getElementById('label-mensal').classList.add('active');

        // Smooth scroll para âncoras
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                const href = this.getAttribute('href');
                if (!href || href === '#') return;
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    

        function abrirModalContato() {
            document.getElementById('modalContato').classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function fecharModalContato() {
            document.getElementById('modalContato').classList.remove('active');
            document.body.style.overflow = 'auto';
            
            // Resetar formulário após fechar
            setTimeout(() => {
                document.getElementById('formularioContato').style.display = 'block';
                document.getElementById('mensagemSucesso').classList.remove('active');
                document.querySelector('#formularioContato form').reset();
            }, 300);
        }

        // Fechar modal clicando fora
        document.getElementById('modalContato').addEventListener('click', function(e) {
            if (e.target === this) {
                fecharModalContato();
            }
        });

        // Fechar modal com ESC
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                fecharModalContato();
            }
        });

        async function enviarContato(event) {
            event.preventDefault();
            
            const btn = event.target.querySelector('.btn-submit');
            const originalText = btn.textContent;
            
            // Desabilita botão
            btn.disabled = true;
            btn.textContent = 'Enviando...';

            // Coleta dados
            const dados = {
                nome: document.getElementById('contatoNome').value,
                email: document.getElementById('contatoEmail').value,
                telefone: document.getElementById('contatoTelefone').value,
                motivo: document.getElementById('contatoMotivo').value,
                mensagem: document.getElementById('contatoMensagem').value,
                data: new Date().toLocaleString('pt-BR')
            };

            try {
                const resp = await fetch('/api/auth/contato', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dados)
                });

                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.erro || 'Erro ao enviar mensagem');
                }

                // Mostra mensagem de sucesso
                document.getElementById('formularioContato').style.display = 'none';
                document.getElementById('mensagemSucesso').classList.add('active');

                // Fecha modal após 3 segundos
                setTimeout(() => {
                    fecharModalContato();
                }, 3000);

            } catch (error) {
                alert(error.message || 'Erro ao enviar mensagem. Tente novamente ou entre em contato por e-mail: contato@lawtechpro.com.br');
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }

        // Máscara de telefone
        document.getElementById('contatoTelefone').addEventListener('input', function(e) {
            let valor = e.target.value.replace(/\D/g, '');
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

        // Validação do formulário
        document.getElementById('contatoForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const nome = document.getElementById('contatoNome').value.trim();
            const email = document.getElementById('contatoEmail').value.trim();
            const telefone = document.getElementById('contatoTelefone').value.trim();
            const mensagem = document.getElementById('contatoMensagem').value.trim();
            
            if (!nome || !email || !telefone || !mensagem) {
                alert('Por favor, preencha todos os campos obrigatórios.');
                return;
            }
            
            if (!email.includes('@') || !email.includes('.')) {
                alert('Por favor, insira um e-mail válido.');
                return;
            }
            
            // Aqui você pode adicionar a lógica para enviar o formulário
            alert('Mensagem enviada com sucesso! Em breve entraremos em contato.');
            this.reset();
        });