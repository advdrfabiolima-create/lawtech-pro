
        /* ── Estado global do modal de trial ── */
        let emailDigitado = '';
        let trialPlanInfo = { nome: 'Básico', valor: 97 };
        let pixPollingInterval = null;
        let pixCobrancaId = null;
        let modoBackup2FA = false;

        /* ── Helpers de navegação ── */
        function mostrarModalTrialExpirado() {
            document.getElementById('modalTrialExpirado').style.display = 'flex';
            mostrarEtapa('step1');
        }

        function fecharModalTrial() {
            document.getElementById('modalTrialExpirado').style.display = 'none';
            pararPollingPix();
        }

        function mostrarEtapa(etapa) {
            document.getElementById('modalStep1').style.display      = etapa === 'step1'  ? 'block' : 'none';
            document.getElementById('modalStepPix').style.display    = etapa === 'pix'    ? 'block' : 'none';
            document.getElementById('modalStepCartao').style.display = etapa === 'cartao' ? 'block' : 'none';
        }

        function voltarParaEtapa1() {
            pararPollingPix();
            mostrarEtapa('step1');
        }

        function pararPollingPix() {
            if (pixPollingInterval) {
                clearInterval(pixPollingInterval);
                pixPollingInterval = null;
            }
        }

        /* ── Fluxo PIX ── */
        async function iniciarPagamentoPix() {
            mostrarEtapa('pix');
            document.getElementById('pixLoadingState').style.display = 'block';
            document.getElementById('pixContent').style.display      = 'none';
            document.getElementById('pixErro').style.display         = 'none';
            document.getElementById('pixSucesso').style.display      = 'none';
            document.getElementById('pixStatus').style.display       = 'flex';

            try {
                const res = await fetch('/api/auth/pagar-trial-pix', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: emailDigitado })
                });
                const data = await res.json();

                if (!res.ok) {
                    document.getElementById('pixLoadingState').style.display = 'none';
                    document.getElementById('pixErro').style.display = 'block';
                    document.getElementById('pixErroMsg').textContent = data.erro || 'Erro ao gerar PIX';
                    return;
                }

                pixCobrancaId = data.cobrancaId;
                document.getElementById('pixLoadingState').style.display = 'none';
                document.getElementById('pixContent').style.display = 'block';
                document.getElementById('pixPlanInfo').textContent =
                    `${data.planNome} — R$ ${data.valor.toFixed(2).replace('.', ',')}/mês`;
                document.getElementById('pixQrCodeImg').src =
                    `data:image/png;base64,${data.pixQrCodeBase64}`;
                document.getElementById('pixPayloadInput').value = data.pixPayload || '';

                pixPollingInterval = setInterval(verificarPagamentoPix, 5000);

            } catch (err) {
                document.getElementById('pixLoadingState').style.display = 'none';
                document.getElementById('pixErro').style.display = 'block';
                document.getElementById('pixErroMsg').textContent = 'Erro de conexão. Tente novamente.';
            }
        }

        async function verificarPagamentoPix() {
            if (!pixCobrancaId) return;
            try {
                const res = await fetch(`/api/auth/verificar-pix/${pixCobrancaId}`);
                const data = await res.json();
                if (data.pago) {
                    pararPollingPix();
                    document.getElementById('pixStatus').style.display  = 'none';
                    document.getElementById('pixSucesso').style.display = 'block';
                }
            } catch (_) { /* silencioso — tenta no próximo ciclo */ }
        }

        function copiarPix() {
            const payload = document.getElementById('pixPayloadInput').value;
            const btn = document.getElementById('btnCopiarPix');
            const restore = () => { btn.textContent = 'Copiar'; btn.style.background = '#1e3a8a'; };
            navigator.clipboard.writeText(payload).then(() => {
                btn.textContent = '✓ Copiado!';
                btn.style.background = '#059669';
                setTimeout(restore, 2000);
            }).catch(() => {
                document.getElementById('pixPayloadInput').select();
                document.execCommand('copy');
                btn.textContent = '✓ Copiado!';
                btn.style.background = '#059669';
                setTimeout(restore, 2000);
            });
        }

        /* ── Fluxo Cartão ── */
        function mostrarFormCartao() {
            mostrarEtapa('cartao');
            document.getElementById('cartaoSucesso').style.display    = 'none';
            document.getElementById('cartaoFormWrapper').style.display = 'block';
            document.getElementById('cartaoErroMsg').style.display    = 'none';
            const valorFmt = `R$ ${trialPlanInfo.valor.toFixed(2).replace('.', ',')}`;
            document.getElementById('cartaoValorBtn').textContent  = valorFmt;
            document.getElementById('cartaoPlanInfo').textContent  = `${trialPlanInfo.nome} — ${valorFmt}/mês`;
        }

        async function pagarComCartao(event) {
            event.preventDefault();
            const btn    = document.getElementById('btnPagarCartao');
            const erroDiv = document.getElementById('cartaoErroMsg');
            erroDiv.style.display = 'none';

            const validade = document.getElementById('cartaoValidade').value.split('/');
            if (validade.length !== 2) {
                erroDiv.textContent = 'Validade inválida. Use o formato MM/AA.';
                erroDiv.style.display = 'block';
                return;
            }

            const expiryMonth = validade[0].trim();
            let expiryYear = validade[1].trim();
            if (expiryYear.length === 2) expiryYear = '20' + expiryYear;

            const valorLabel = document.getElementById('cartaoValorBtn').textContent;
            btn.textContent = 'Processando...';
            btn.disabled = true;

            try {
                const res = await fetch('/api/auth/pagar-trial-cartao', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email:         emailDigitado,
                        holderName:    document.getElementById('cartaoNome').value.trim(),
                        number:        document.getElementById('cartaoNumero').value.replace(/\s/g, ''),
                        expiryMonth,
                        expiryYear,
                        ccv:           document.getElementById('cartaoCvv').value.trim(),
                        cpfCnpj:       document.getElementById('cartaoCpf').value.replace(/\D/g, ''),
                        postalCode:    document.getElementById('cartaoCep').value.replace(/\D/g, ''),
                        addressNumber: document.getElementById('cartaoNumeroEndereco').value.trim(),
                        phone:         document.getElementById('cartaoTelefone').value.replace(/\D/g, '')
                    })
                });
                const data = await res.json();

                if (res.ok && data.ok) {
                    document.getElementById('cartaoFormWrapper').style.display = 'none';
                    document.getElementById('cartaoSucesso').style.display     = 'block';
                    return;
                }

                erroDiv.textContent   = data.erro || 'Erro ao processar pagamento. Tente novamente.';
                erroDiv.style.display = 'block';
                btn.disabled    = false;
                btn.textContent = `💳 Pagar ${valorLabel}`;

            } catch (err) {
                erroDiv.textContent   = 'Erro de conexão. Tente novamente.';
                erroDiv.style.display = 'block';
                btn.disabled    = false;
                btn.textContent = `💳 Pagar ${valorLabel}`;
            }
        }

        /* ── Formatadores de input ── */
        function formatarCartao(input) {
            let v = input.value.replace(/\D/g, '').substring(0, 16);
            input.value = v.replace(/(.{4})/g, '$1 ').trim();
        }

        function formatarValidade(input) {
            let v = input.value.replace(/\D/g, '').substring(0, 4);
            if (v.length > 2) v = v.substring(0, 2) + '/' + v.substring(2);
            input.value = v;
        }

        function formatarCpf(input) {
            let v = input.value.replace(/\D/g, '').substring(0, 11);
            v = v.replace(/(\d{3})(\d)/, '$1.$2');
            v = v.replace(/(\d{3})(\d)/, '$1.$2');
            v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
            input.value = v;
        }

        function formatarCep(input) {
            let v = input.value.replace(/\D/g, '').substring(0, 8);
            if (v.length > 5) v = v.substring(0, 5) + '-' + v.substring(5);
            input.value = v;
        }

        function formatarTelefone(input) {
            let v = input.value.replace(/\D/g, '').substring(0, 11);
            if (v.length > 10)     v = v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
            else if (v.length > 6) v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
            else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
            else if (v.length > 0) v = '(' + v;
            input.value = v;
        }

        /* ── Login ── */
        function mostrarErroLogin(msg) {
            const el = document.getElementById('loginErro');
            el.textContent = msg;
            el.style.display = 'block';
        }

        function limparErroLogin() {
            const el = document.getElementById('loginErro');
            if (el) el.style.display = 'none';
        }

        function salvarSessao(token, usuario, lembrar) {
            const storage = lembrar ? localStorage : sessionStorage;
            storage.setItem('token',   token);
            storage.setItem('usuario', JSON.stringify(usuario));
        }

        async function handleLogin(event) {
            event.preventDefault();
            limparErroLogin();

            const email    = document.getElementById('email').value.trim();
            const password = document.getElementById('senha').value;
            const lembrar  = document.getElementById('remember').checked;
            const btn      = event.target.querySelector('.btn-primary');

            if (!email || !password) {
                mostrarErroLogin('Preencha e-mail e senha para continuar.');
                return;
            }

            try {
                btn.innerText = 'Autenticando...';
                btn.disabled  = true;

                const res  = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, senha: password })
                });
                const data = await res.json();

                if (res.ok) {
                    if (data.requer_2fa) {
                        window._tempToken = data.temp_token;
                        window._lembrar   = lembrar;
                        document.querySelector('.login-container').style.display = 'none';
                        document.getElementById('step2fa').style.display = 'flex';
                        document.getElementById('step2fa').style.flexDirection = 'column';
                        document.getElementById('totpCodigo').focus();
                        btn.innerText = 'Entrar no sistema';
                        btn.disabled  = false;
                        return;
                    }
                    salvarSessao(data.token, data.usuario, lembrar);
                    window.location.href = '/dashboard-modern.html';
                    return;
                }

                if (res.status === 402) {
                    emailDigitado = email;
                    if (data.plano) {
                        trialPlanInfo = {
                            nome:  data.plano.nome  || 'Básico',
                            valor: data.plano.valor || 97
                        };
                    }
                    btn.innerText = 'Entrar no sistema';
                    btn.disabled  = false;
                    mostrarModalTrialExpirado();
                    return;
                }

                mostrarErroLogin(data.erro || 'E-mail ou senha incorretos. Tente novamente.');
                btn.innerText = 'Entrar no sistema';
                btn.disabled  = false;

            } catch (err) {
                mostrarErroLogin('Erro de conexão com o servidor. Tente novamente.');
                btn.innerText = 'Entrar no sistema';
                btn.disabled  = false;
            }
        }
        /* ── Funções 2FA ── */
        function voltarLogin() {
            window._tempToken = null;
            modoBackup2FA = false;
            document.getElementById('step2fa').style.display = 'none';
            document.querySelector('.login-container').style.display = 'block';
            document.getElementById('totpCodigo').value = '';
            document.getElementById('backupCodigo').value = '';
            document.getElementById('totpError').style.display = 'none';
            document.getElementById('backupError').style.display = 'none';
            document.getElementById('totpSection').style.display = 'block';
            document.getElementById('backupCodeSection').style.display = 'none';
            document.getElementById('linkUsarBackup').textContent = 'Usar código de backup';
        }

        function alternarModo2FA() {
            modoBackup2FA = !modoBackup2FA;
            document.getElementById('totpSection').style.display    = modoBackup2FA ? 'none'  : 'block';
            document.getElementById('backupCodeSection').style.display = modoBackup2FA ? 'block' : 'none';
            document.getElementById('linkUsarBackup').textContent   = modoBackup2FA ? 'Usar código do app' : 'Usar código de backup';
            document.getElementById('totpError').style.display   = 'none';
            document.getElementById('backupError').style.display = 'none';
            if (modoBackup2FA) document.getElementById('backupCodigo').focus();
            else document.getElementById('totpCodigo').focus();
        }

        function mostrarErro2FA(campo, msg) {
            const el = document.getElementById(campo);
            el.textContent = msg;
            el.style.display = 'block';
            const input = campo === 'totpError'
                ? document.getElementById('totpCodigo')
                : document.getElementById('backupCodigo');
            input.classList.add('shake');
            setTimeout(() => input.classList.remove('shake'), 500);
        }

        function finalizarLogin2FA(data) {
            salvarSessao(data.token, data.usuario, window._lembrar || false);
            window.location.href = '/dashboard-modern.html';
        }

        async function verificar2FA() {
            const codigo = document.getElementById('totpCodigo').value.trim();
            const btn    = document.getElementById('btnVerificar2fa');
            document.getElementById('totpError').style.display = 'none';

            if (codigo.length !== 6) {
                mostrarErro2FA('totpError', 'Digite os 6 dígitos do código');
                return;
            }

            btn.textContent = 'Verificando...';
            btn.disabled    = true;

            try {
                const res  = await fetch('/api/auth/2fa/verificar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ temp_token: window._tempToken, codigo })
                });
                const data = await res.json();

                if (res.ok) {
                    finalizarLogin2FA(data);
                    return;
                }

                mostrarErro2FA('totpError', data.erro || 'Código inválido. Tente novamente.');
                document.getElementById('totpCodigo').value = '';
            } catch (_) {
                mostrarErro2FA('totpError', 'Erro de conexão. Tente novamente.');
            } finally {
                btn.textContent = 'Verificar';
                btn.disabled    = false;
            }
        }

        async function usarBackup2FA() {
            const codigo = document.getElementById('backupCodigo').value.trim();
            const btn    = document.getElementById('btnUsarBackup');
            document.getElementById('backupError').style.display = 'none';

            if (!codigo) {
                mostrarErro2FA('backupError', 'Digite o código de backup');
                return;
            }

            btn.textContent = 'Verificando...';
            btn.disabled    = true;

            try {
                const res  = await fetch('/api/auth/2fa/usar-backup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ temp_token: window._tempToken, codigo_backup: codigo })
                });
                const data = await res.json();

                if (res.ok) {
                    finalizarLogin2FA(data);
                    return;
                }

                mostrarErro2FA('backupError', data.erro || 'Código de backup inválido.');
                document.getElementById('backupCodigo').value = '';
            } catch (_) {
                mostrarErro2FA('backupError', 'Erro de conexão. Tente novamente.');
            } finally {
                btn.textContent = 'Usar Código de Backup';
                btn.disabled    = false;
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            // ── Formulário principal de login ──
            document.getElementById('loginForm').addEventListener('submit', handleLogin);

            // ── Mostrar/ocultar senha ──
            document.getElementById('btnToggleSenha').addEventListener('click', () => {
                const input = document.getElementById('senha');
                const ver   = document.getElementById('iconSenhaVer');
                const ocultar = document.getElementById('iconSenhaOcultar');
                const mostrar = input.type === 'password';
                input.type = mostrar ? 'text' : 'password';
                ver.style.display     = mostrar ? 'none'  : '';
                ocultar.style.display = mostrar ? ''      : 'none';
            });

            // ── Limpar erro ao digitar ──
            document.getElementById('email').addEventListener('input', limparErroLogin);
            document.getElementById('senha').addEventListener('input', limparErroLogin);

            // ── Botões 2FA ──
            document.getElementById('btnVerificar2fa').addEventListener('click', verificar2FA);
            document.getElementById('btnUsarBackup').addEventListener('click', usarBackup2FA);
            document.getElementById('linkUsarBackup').addEventListener('click', alternarModo2FA);
            document.getElementById('btnVoltarLogin').addEventListener('click', voltarLogin);

            // ── Inputs TOTP: filtrar não-dígitos + auto-submit ──
            document.getElementById('totpCodigo').addEventListener('input', e => {
                e.target.value = e.target.value.replace(/\D/g, '');
                if (e.target.value.length === 6) verificar2FA();
            });
            document.getElementById('totpCodigo').addEventListener('keydown', e => {
                if (e.key === 'Enter') verificar2FA();
            });
            document.getElementById('backupCodigo').addEventListener('keydown', e => {
                if (e.key === 'Enter') usarBackup2FA();
            });

            // ── Modal trial: fechar ──
            document.querySelectorAll('.btn-fechar-modal').forEach(btn =>
                btn.addEventListener('click', fecharModalTrial)
            );

            // ── Modal trial: voltar à etapa 1 ──
            document.querySelectorAll('.btn-voltar-etapa1').forEach(btn =>
                btn.addEventListener('click', voltarParaEtapa1)
            );

            // ── Modal trial: escolher método ──
            document.getElementById('btnIniciarPix').addEventListener('click', iniciarPagamentoPix);
            document.getElementById('btnMostrarCartao').addEventListener('click', mostrarFormCartao);

            // ── PIX: copiar, recarregar após pago, tentar novamente ──
            document.getElementById('btnCopiarPix').addEventListener('click', copiarPix);
            document.getElementById('btnPixReload').addEventListener('click', () => window.location.reload());
            document.getElementById('btnPixRetry').addEventListener('click', voltarParaEtapa1);

            // ── Cartão: recarregar após pago ──
            document.getElementById('btnCartaoReload').addEventListener('click', () => window.location.reload());

            // ── Formulário de pagamento cartão ──
            document.getElementById('formCartao').addEventListener('submit', pagarComCartao);

            // ── Formatadores de inputs de cartão ──
            document.getElementById('cartaoNome').addEventListener('input', e => {
                e.target.value = e.target.value.toUpperCase();
            });
            document.getElementById('cartaoNumero').addEventListener('input', e => formatarCartao(e.target));
            document.getElementById('cartaoValidade').addEventListener('input', e => formatarValidade(e.target));
            document.getElementById('cartaoCvv').addEventListener('input', e => {
                e.target.value = e.target.value.replace(/\D/g, '');
            });
            document.getElementById('cartaoCpf').addEventListener('input', e => formatarCpf(e.target));
            document.getElementById('cartaoCep').addEventListener('input', e => formatarCep(e.target));
            document.getElementById('cartaoTelefone').addEventListener('input', e => formatarTelefone(e.target));
        });
