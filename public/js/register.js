
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


    // Máscaras
    const documentoMask = IMask(document.getElementById('documento'), { mask: '000.000.000-00' });
    IMask(document.getElementById('cep'), { mask: '00000-000' });

    // ============================================================
    // VALIDAÇÃO DE SENHA EM TEMPO REAL
    // ============================================================

    const senhaInput        = document.getElementById('senha');
    const confirmarInput    = document.getElementById('confirmarSenha');
    const senhaRequisitos   = document.getElementById('senhaRequisitos');
    const senhaMatchMsg     = document.getElementById('senhaMatchMsg');

    function setReq(id, status) {
        // status: 'ok' | 'erro' | 'neutro'
        const el = document.getElementById(id);
        const icon = el.querySelector('.req-icon');
        el.className = 'req-item ' + status;
        icon.textContent = status === 'ok' ? '✓' : status === 'erro' ? '✕' : '—';
    }

    senhaInput.addEventListener('input', () => {
        const v = senhaInput.value;

        // Mostra o checklist assim que o usuário começa a digitar
        senhaRequisitos.style.display = v.length > 0 ? 'flex' : 'none';

        const okMin   = v.length >= 8;
        const okUpper = /[A-Z]/.test(v);
        const okLower = /[a-z]/.test(v);
        const okNum   = /[0-9]/.test(v);

        setReq('req-min',   v.length === 0 ? 'neutro' : okMin   ? 'ok' : 'erro');
        setReq('req-upper', v.length === 0 ? 'neutro' : okUpper ? 'ok' : 'erro');
        setReq('req-lower', v.length === 0 ? 'neutro' : okLower ? 'ok' : 'erro');
        setReq('req-num',   v.length === 0 ? 'neutro' : okNum   ? 'ok' : 'erro');

        // Borda do campo
        if (v.length === 0) {
            senhaInput.classList.remove('input-ok', 'input-erro');
        } else if (okMin && okUpper && okLower && okNum) {
            senhaInput.classList.add('input-ok');
            senhaInput.classList.remove('input-erro');
        } else {
            senhaInput.classList.add('input-erro');
            senhaInput.classList.remove('input-ok');
        }

        // Reavalia confirmação se já tiver algo digitado
        if (confirmarInput.value.length > 0) validarConfirmacao();
    });

    confirmarInput.addEventListener('input', validarConfirmacao);

    function validarConfirmacao() {
        const s = senhaInput.value;
        const c = confirmarInput.value;

        if (c.length === 0) {
            senhaMatchMsg.style.display = 'none';
            confirmarInput.classList.remove('input-ok', 'input-erro');
            return;
        }

        senhaMatchMsg.style.display = 'flex';

        if (s === c) {
            senhaMatchMsg.className = 'senha-match-msg ok';
            senhaMatchMsg.innerHTML = '<i class="lucide lucide-check-circle" style="font-size:13px;"></i> Senhas coincidem';
            confirmarInput.classList.add('input-ok');
            confirmarInput.classList.remove('input-erro');
        } else {
            senhaMatchMsg.className = 'senha-match-msg erro';
            senhaMatchMsg.innerHTML = '<i class="lucide lucide-x-circle" style="font-size:13px;"></i> Senhas não coincidem';
            confirmarInput.classList.add('input-erro');
            confirmarInput.classList.remove('input-ok');
        }
    }

    // ============================================================
    // ✅ INICIALIZAR STRIPE ELEMENTS
    // ============================================================

    const stripe = Stripe('pk_live_51T0o4SJJJfva8SuZlfpk7Eu5lBaij1nYWuNLVeAvDFBpyce3neDIHnHDkJGsTLVcxLaXBN9xv3eXc2inNgVqwSNP00gm53MwcG');

    const elements = stripe.elements();

    // Estilo comum para os elementos Stripe no cartão 3D
    const stripeStyle = {
        base: {
            fontSize: '16px',
            color: '#ffffff',
            fontFamily: 'Inter, system-ui, sans-serif',
            '::placeholder': { color: 'rgba(255,255,255,0.5)' }
        },
        invalid: { color: '#fca5a5', iconColor: '#fca5a5' }
    };

    const stripeStyleDark = {
        base: {
            fontSize: '14px',
            color: '#1e293b',
            fontFamily: 'Inter, system-ui, sans-serif',
            '::placeholder': { color: '#94a3b8' }
        },
        invalid: { color: '#f59e0b', iconColor: '#f59e0b' }
    };

    // Elementos separados: Número, Validade, CVC
    const cardNumberElement = elements.create('cardNumber', {
        style: stripeStyle,
        placeholder: '0000 0000 0000 0000'
    });

    const cardExpiryElement = elements.create('cardExpiry', {
        style: stripeStyle,
        placeholder: 'MM/AA'
    });

    const cardCvcElement = elements.create('cardCvc', {
        style: stripeStyleDark,
        placeholder: '***'
    });

    cardNumberElement.mount('#cardNumber-element');
    cardExpiryElement.mount('#cardExpiry-element');
    cardCvcElement.mount('#cardCvc-element');

    const cardErrors = document.getElementById('card-errors');
    const creditCardInner = document.getElementById('creditCardInner');
    const cardFront = document.getElementById('cardFront');
    const cardBack = document.getElementById('cardBack');
    let isFlipped = false;

    // Detectar bandeira do cartão e atualizar visual
    cardNumberElement.on('change', (event) => {
        if (event.error) {
            cardErrors.textContent = event.error.message;
        } else {
            cardErrors.textContent = '';
        }

        // Atualizar bandeira
        const brand = event.brand || 'unknown';
        const brandNames = {
            visa: 'VISA',
            mastercard: 'MASTERCARD',
            amex: 'AMEX',
            elo: 'ELO',
            discover: 'DISCOVER',
            unknown: 'CREDIT'
        };

        document.getElementById('cardBrandLogo').textContent = brandNames[brand] || 'CREDIT';

        // Atualizar cores do cartão
        const brandClass = brand !== 'unknown' ? `brand-${brand}` : '';
        cardFront.className = 'credit-card-front ' + brandClass;
        cardBack.className = 'credit-card-back ' + brandClass;
    });

    cardExpiryElement.on('change', (event) => {
        if (event.error) cardErrors.textContent = event.error.message;
        else cardErrors.textContent = '';
    });

    cardCvcElement.on('change', (event) => {
        if (event.error) cardErrors.textContent = event.error.message;
        else cardErrors.textContent = '';
    });

    // Auto-flip: virar para verso ao focar no CVC
    cardCvcElement.on('focus', () => {
        if (!isFlipped) toggleCardFlip();
    });

    // Auto-flip: voltar para frente ao focar no número ou validade
    cardNumberElement.on('focus', () => {
        if (isFlipped) toggleCardFlip();
    });
    cardExpiryElement.on('focus', () => {
        if (isFlipped) toggleCardFlip();
    });

    // Atualizar nome do titular em tempo real (campo dedicado do cartão)
    document.getElementById('nomeTitularCartao').addEventListener('input', (e) => {
        const display = document.getElementById('cardHolderDisplay');
        display.textContent = e.target.value.toUpperCase() || 'SEU NOME AQUI';
    });

    // Função para virar o cartão
    function toggleCardFlip() {
        isFlipped = !isFlipped;
        creditCardInner.classList.toggle('flipped', isFlipped);
        document.getElementById('flipBtnText').textContent = isFlipped
            ? 'Ver frente do cartão'
            : 'Ver verso do cartão';
    }

    console.log('✅ Stripe Elements (separados) inicializado!');

    // ============================================================
    // CONFIGURAÇÕES INICIAIS
    // ============================================================

    const form = document.getElementById('formRegister');
    const errorBox = document.getElementById('errorBox');
    const btnSubmit = document.getElementById('btnSubmit');

    window.onload = () => {
        const params = new URLSearchParams(window.location.search);
        const plano = params.get('plano');
        const cobranca = params.get('cobranca');

        const planosMap = {
            basico: { id: 1, nome: 'Básico', mensal: "49.90", anual: "499.00" },
            intermediario: { id: 2, nome: 'Intermediário', mensal: "149.90", anual: "1499.00" },
            avancado: { id: 3, nome: 'Avançado', mensal: "199.90", anual: "1999.00" },
            premium: { id: 4, nome: 'Premium', mensal: "299.90", anual: "2999.00" }
        };

        if (plano && planosMap[plano]) {
            const info = planosMap[plano];
            const valorFinal = (cobranca === 'anual') ? info.anual : info.mensal;

            document.getElementById('planoNome').textContent = info.nome;
            document.getElementById('planoPeriodo').textContent = `Cobrança ${cobranca || 'mensal'}`;

            localStorage.setItem('plano_escolhido_id', info.id);
            localStorage.setItem('plano_escolhido_nome', info.nome);
            localStorage.setItem('plano_escolhido_valor', valorFinal);
            localStorage.setItem('plano_escolhido_cobranca', cobranca || 'mensal');
        }
    };

    async function buscarEndereco(cep) {
        const v = cep.replace(/\D/g, '');
        if(v.length === 8) {
            try {
                const res = await fetch(`https://viacep.com.br/ws/${v}/json/`);
                const data = await res.json();
                if(!data.erro) {
                    document.getElementById('endereco').value = `${data.logradouro}, ${data.bairro}`;
                    document.getElementById('cidade').value = data.localidade;
                    document.getElementById('estado').value = data.uf;
                }
            } catch (err) { 
                console.error("Erro ao buscar CEP"); 
            }
        }
    }

    // ============================================================
    // MÉTODO DE PAGAMENTO (CARTÃO / PIX)
    // ============================================================

    let metodoPagamento = 'cartao'; // 'cartao' | 'pix'
    let pixPollingInterval = null;
    let pixTimerInterval = null;
    let emailRegistrado = null; // salvo após registro para gerar PIX

    function selecionarMetodoPagamento(metodo) {
        metodoPagamento = metodo;

        const tabCartao = document.getElementById('tabCartao');
        const tabPix    = document.getElementById('tabPix');
        const cardSection = document.getElementById('cardSection');
        const pixSection  = document.getElementById('pixInfoSection');
        const btnText = document.getElementById('btnSubmit');

        if (metodo === 'pix') {
            tabCartao.className = 'payment-tab';
            tabPix.className    = 'payment-tab active-tab-pix';
            cardSection.style.display = 'none';
            pixSection.style.display  = 'block';
            btnSubmit.textContent = 'Criar Conta com PIX';
        } else {
            tabCartao.className = 'payment-tab active-tab-card';
            tabPix.className    = 'payment-tab';
            cardSection.style.display = 'block';
            pixSection.style.display  = 'none';
            btnSubmit.textContent = 'Criar Conta e Iniciar Teste Gratuito';
        }
    }

    // ============================================================
    // PIX — geração de QR e polling
    // ============================================================

    async function gerarPixRegistro(email) {
        try {
            const res = await fetch('/api/auth/gerar-pix-registro', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.erro || 'Erro ao gerar PIX');
            return data;
        } catch (err) {
            console.error('❌ [PIX] Erro ao gerar QR:', err);
            throw err;
        }
    }

    function abrirModalPix(pixData) {
        const overlay = document.getElementById('pixModalOverlay');
        document.getElementById('pixQrImg').src = `data:image/png;base64,${pixData.pixQrCodeBase64}`;
        document.getElementById('pixPayloadInput').value = pixData.pixPayload;
        const valorFmt = parseFloat(pixData.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        document.getElementById('pixValorModal').textContent = valorFmt;
        document.getElementById('pixPlanModal').textContent = `Plano ${pixData.planNome} · ativação imediata`;

        overlay.classList.add('visible');
        iniciarTimerPix(15 * 60); // 15 minutos
        iniciarPollingPix(pixData.cobrancaId);
    }

    function iniciarTimerPix(segundos) {
        clearInterval(pixTimerInterval);
        let restante = segundos;
        const el = document.getElementById('pixTimer');
        pixTimerInterval = setInterval(() => {
            if (restante <= 0) {
                clearInterval(pixTimerInterval);
                el.textContent = '00:00';
                return;
            }
            restante--;
            const m = String(Math.floor(restante / 60)).padStart(2, '0');
            const s = String(restante % 60).padStart(2, '0');
            el.textContent = `${m}:${s}`;
        }, 1000);
    }

    function iniciarPollingPix(cobrancaId) {
        clearInterval(pixPollingInterval);
        pixPollingInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api/auth/verificar-pix/${cobrancaId}`);
                const data = await res.json();
                if (data.pago) {
                    clearInterval(pixPollingInterval);
                    clearInterval(pixTimerInterval);
                    // Atualiza badge de status
                    const badge = document.getElementById('pixStatusBadge');
                    badge.classList.add('paid');
                    document.getElementById('pixSpinner').style.display = 'none';
                    document.getElementById('pixStatusText').textContent = '✅ Pagamento confirmado!';
                    // Limpa localStorage e redireciona
                    localStorage.removeItem('plano_escolhido_id');
                    localStorage.removeItem('plano_escolhido_valor');
                    localStorage.removeItem('plano_escolhido_nome');
                    setTimeout(() => {
                        window.location.href = '/login?registro=sucesso&pix=confirmado';
                    }, 2000);
                }
            } catch (e) {
                console.warn('[PIX polling]', e.message);
            }
        }, 5000); // verifica a cada 5 segundos
    }

    function copiarCodigoPix() {
        const input = document.getElementById('pixPayloadInput');
        navigator.clipboard.writeText(input.value).then(() => {
            const btn = document.querySelector('.pix-copy-btn');
            btn.textContent = 'Copiado!';
            setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
        });
    }

    function ignorarPix() {
        clearInterval(pixPollingInterval);
        clearInterval(pixTimerInterval);
        document.getElementById('pixModalOverlay').classList.remove('visible');
        localStorage.removeItem('plano_escolhido_id');
        localStorage.removeItem('plano_escolhido_valor');
        localStorage.removeItem('plano_escolhido_nome');
        window.location.href = '/login?registro=sucesso&trial=7';
    }

    // ============================================================
    // EVENTO DE SUBMIT DO FORMULÁRIO
    // ============================================================

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.style.display = 'none';

        const nome = document.getElementById('nome').value;
        const email = document.getElementById('email').value;
        const senha = document.getElementById('senha').value;

        if (!nome || !email || !senha) {
            return showError("Preencha todos os campos obrigatórios.");
        }

        if (senha !== document.getElementById('confirmarSenha').value) {
            return showError("Senhas não coincidem.");
        }

        if (senha.length < 8) {
            return showError("A senha deve ter no mínimo 8 caracteres.");
        }

        if (!/[A-Z]/.test(senha)) {
            return showError("A senha deve conter ao menos uma letra maiúscula.");
        }

        if (!/[a-z]/.test(senha)) {
            return showError("A senha deve conter ao menos uma letra minúscula.");
        }

        if (!/[0-9]/.test(senha)) {
            return showError("A senha deve conter ao menos um número.");
        }

        // ============================================================
        // ✅ CRIAR PAYMENT METHOD COM STRIPE ELEMENTS (só se cartão)
        // ============================================================

        let paymentMethodId = null;
        let cartaoInfo = null;

        if (metodoPagamento === 'cartao') {
            console.log('💳 Verificando se cartão foi preenchido...');

            btnSubmit.innerText = "🔐 Validando cartão...";
            btnSubmit.disabled = true;

            try {
                const { paymentMethod, error } = await stripe.createPaymentMethod({
                    type: 'card',
                    card: cardNumberElement,
                    billing_details: {
                        name: document.getElementById('nomeTitularCartao').value || nome,
                        email: email
                    }
                });

                if (error) {
                    // Se erro é "campo vazio", permite cadastro sem cartão
                    if (error.code === 'incomplete_card' || error.code === 'incomplete_number') {
                        console.log('⚠️ Cartão não preenchido - continuando sem cartão');
                    } else {
                        btnSubmit.innerText = "Criar Conta e Iniciar Teste Gratuito";
                        btnSubmit.disabled = false;
                        return showError(`❌ Erro no cartão: ${error.message}`);
                    }
                } else {
                    paymentMethodId = paymentMethod.id;
                    cartaoInfo = {
                        last4: paymentMethod.card.last4,
                        brand: paymentMethod.card.brand,
                        exp_month: paymentMethod.card.exp_month,
                        exp_year: paymentMethod.card.exp_year
                    };
                    console.log('✅ Payment Method criado:', paymentMethodId);
                }
            } catch (stripeErr) {
                console.error('❌ Erro ao processar cartão:', stripeErr);
                btnSubmit.innerText = "Criar Conta e Iniciar Teste Gratuito";
                btnSubmit.disabled = false;
                return showError('❌ Erro ao processar cartão. Tente novamente.');
            }
        } else {
            btnSubmit.innerText = "Criando conta...";
            btnSubmit.disabled = true;
        }

        // ============================================================
        // CRIAR CONTA NO BACKEND
        // ============================================================

        btnSubmit.innerText = "Processando cadastro...";

        try {
            const payload = {
                nome: nome,
                email: email,
                senha: senha,
                documento: document.getElementById('documento').value,
                tipoPessoa: document.getElementById('tipoPessoa').value,
                dataNascimento: document.getElementById('dataNascimento').value,
                cep: document.getElementById('cep').value,
                endereco: document.getElementById('endereco').value,
                cidade: document.getElementById('cidade').value,
                estado: document.getElementById('estado').value,
                planoId: localStorage.getItem('plano_escolhido_id') || 1,
                preferenciaPagamento: metodoPagamento
            };

            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (response.ok) {
                console.log('✅ [REGISTRO] Conta criada com sucesso:', data);
                emailRegistrado = email;

                // 🔥 EVENTO META PIXEL
                if (typeof fbq !== 'undefined') {
                    fbq('track', 'CompleteRegistration', {
                        content_name: localStorage.getItem('plano_escolhido_nome') || 'Plano',
                        content_category: 'Trial SaaS Jurídico',
                        status: 'sucesso'
                    });
                }

                // ============================================================
                // FLUXO PIX: trial normal — sem QR agora, e-mail ao vencer
                // ============================================================
                if (metodoPagamento === 'pix') {
                    localStorage.removeItem('plano_escolhido_id');
                    localStorage.removeItem('plano_escolhido_valor');
                    localStorage.removeItem('plano_escolhido_nome');
                    alert(
                        '✅ Conta criada com sucesso!\n\n' +
                        '🎉 Você tem 7 dias de teste gratuito.\n\n' +
                        'Ao final do período, enviaremos um QR Code PIX no seu e-mail para continuar com o acesso.'
                    );
                    window.location.href = '/login?registro=sucesso&trial=7';
                    return;
                }

                // ============================================================
                // FLUXO CARTÃO: salva payment method (se preenchido)
                // ============================================================
                if (paymentMethodId && cartaoInfo) {
                    try {
                        console.log('💳 [REGISTRO] Salvando Payment Method...');
                        const loginRes = await fetch('/api/auth/login', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email, senha })
                        });
                        if (loginRes.ok) {
                            const loginData = await loginRes.json();
                            const cartaoRes = await fetch('/api/pagamentos/salvar-cartao', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${loginData.token}`
                                },
                                body: JSON.stringify({
                                    token: paymentMethodId,
                                    last4: cartaoInfo.last4,
                                    brand: cartaoInfo.brand,
                                    exp_month: cartaoInfo.exp_month,
                                    exp_year: cartaoInfo.exp_year,
                                    gateway: 'stripe'
                                })
                            });
                            if (cartaoRes.ok) console.log('✅ [REGISTRO] Payment Method salvo!');
                        }
                    } catch (cartaoErr) {
                        console.error('❌ [REGISTRO] Erro ao salvar Payment Method:', cartaoErr);
                    }
                }

                localStorage.removeItem('plano_escolhido_id');
                localStorage.removeItem('plano_escolhido_valor');
                localStorage.removeItem('plano_escolhido_nome');

                alert(
                    '✅ Conta criada com sucesso!' +
                    '\n\n🎉 Você ganhou 7 dias de teste gratuito!' +
                    '\n\nClique em OK para fazer login e começar!'
                );

                setTimeout(() => {
                    window.location.href = '/login?registro=sucesso&trial=7';
                }, 500);

            } else {
                showError(data.erro || "Falha ao criar conta.");
            }
        } catch (err) {
            console.error('❌ Erro:', err);
            showError("Erro de conexão.");
        } finally {
            btnSubmit.innerText = metodoPagamento === 'pix'
                ? 'Criar Conta com PIX'
                : 'Criar Conta e Iniciar Teste Gratuito';
            btnSubmit.disabled = false;
        }
    });

    function showError(msg) {
        errorBox.innerText = msg;
        errorBox.style.display = 'block';
        errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function ajustarCamposDocumento(tipo) {
        const label = document.getElementById('labelDocumento');
        const input = document.getElementById('documento');
        const groupNascimento = document.getElementById('groupNascimento');

        if (tipo === 'fisica') {
            label.innerText = 'CPF (Para Faturamento)';
            input.placeholder = '000.000.000-00';
            groupNascimento.style.display = 'block';
            documentoMask.updateOptions({ mask: '000.000.000-00' });
        } else {
            label.innerText = 'CNPJ (Para Faturamento)';
            input.placeholder = '00.000.000/0000-00';
            groupNascimento.style.display = 'none';
            document.getElementById('dataNascimento').value = '';
            documentoMask.updateOptions({ mask: '00.000.000/0000-00' });
        }
    }
