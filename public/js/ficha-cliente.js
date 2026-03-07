
    console.log('🎯 Formulário de Ficha iniciado - Versão CORRIGIDA');

    // Máscaras
    IMask(document.getElementById('cep'), { mask: '00000-000' });

    let maskDoc = IMask(document.getElementById('documento'), {
        mask: '000.000.000-00'
    });

    IMask(document.getElementById('telefone'), {
    mask: '(00) 00000-0000'
    });

    // Atualiza indicador de progresso
    function updateProgress(step) {
        const dots = document.querySelectorAll('.progress-dot');
        dots.forEach((dot, index) => {
            if (index <= step) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
    }

    function alternarTipoPessoa(tipo) {
        const labelDoc = document.getElementById('labelDoc');
        const grupoNasc = document.getElementById('grupoNascimento');
        const inputNasc = document.getElementById('nascimento');
        const inputDoc = document.getElementById('documento');

        maskDoc.destroy();

        if (tipo === 'PF') {
            labelDoc.innerHTML = "CPF <span class='required'>*</span>";
            inputDoc.placeholder = "000.000.000-00";
            maskDoc = IMask(inputDoc, { mask: '000.000.000-00' });
            grupoNasc.style.display = "block";
            inputNasc.required = true;
        } else {
            labelDoc.innerHTML = "CNPJ <span class='required'>*</span>";
            inputDoc.placeholder = "00.000.000/0000-00";
            maskDoc = IMask(inputDoc, { mask: '00.000.000/0000-00' });
            grupoNasc.style.display = "none";
            inputNasc.required = false;
            inputNasc.value = "";
        }
    }

    async function buscarEndereco(cep) {
        const v = cep.replace(/\D/g, '');
        if (v.length !== 8) return;

        console.log('🔍 Buscando CEP:', v);
        updateProgress(1);

        try {
            const res = await fetch(`https://viacep.com.br/ws/${v}/json/`);
            const data = await res.json();
            if (!data.erro) {
                document.getElementById('endereco').value = `${data.logradouro}, ${data.bairro}`;
                document.getElementById('cidade').value = data.localidade;
                document.getElementById('uf').value = data.uf;
                console.log('✅ CEP encontrado:', data);
                updateProgress(2);
            } else {
                console.warn('⚠️ CEP não encontrado');
                mostrarErro('CEP não encontrado. Preencha manualmente.');
            }
        } catch (err) {
            console.error("❌ Erro ao buscar CEP:", err);
        }
    }

    function mostrarErro(mensagem) {
        const errorMsg = document.getElementById('errorMessage');
        errorMsg.textContent = '⚠️ ' + mensagem;
        errorMsg.classList.add('show');
        errorMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        setTimeout(() => {
            errorMsg.classList.remove('show');
        }, 6000);
    }

    document.getElementById('formFicha').onsubmit = async (e) => {
        e.preventDefault();
        
        console.log('📤 Iniciando envio do formulário...');
        
        const urlParams = new URLSearchParams(window.location.search);
        const leadIdCapturado = urlParams.get('leadId'); // Pega da URL ?leadId=XXX

        if (!leadIdCapturado) {
            console.error('❌ LeadId não encontrado na URL');
            mostrarErro('Link inválido. Entre em contato com o escritório.');
            return;
        }

        const cidade = document.getElementById('cidade').value.trim();
        const uf = document.getElementById('uf').value;
        
        if (!cidade || !uf) {
            mostrarErro('Por favor, preencha a Cidade e o UF.');
            return;
        }

        const btn = e.target.querySelector('button[type="submit"]');
        btn.classList.add('loading');
        btn.textContent = 'Enviando...';

        try {
            // ✅ CORREÇÃO: Enviando "leadId" ao invés de "id"
            const API_BASE = location.hostname.includes('localhost')
            ? 'http://localhost:3000'
            : 'https://www.lawtechpro.com.br';

            const urlFinal = `${API_BASE}/api/crm/public/onboarding`;
            console.log('🚀 Enviando para:', urlFinal);

            const payload = {
                leadId: parseInt(leadIdCapturado),  // ✅ CORRIGIDO
                nome: document.getElementById('nome').value.trim(),
                tipoPessoa: document.querySelector('input[name="tipoPessoa"]:checked').value,
                documento: document.getElementById('documento').value.replace(/\D/g, ''), // ✅ REMOVE MÁSCARA DO CPF/CNPJ
                email: document.getElementById('email').value.trim() || null,
                telefone: document.getElementById('telefone').value.trim(),
                nascimento: document.getElementById('nascimento').value || null,
                cep: document.getElementById('cep').value.replace(/\D/g, ''), // ✅ REMOVE MÁSCARA DO CEP
                cidade: cidade,
                uf: uf,
                endereco: document.getElementById('endereco').value.trim(),
                numero: null, // Campo adicional esperado pelo backend
                complemento: null, // Campo adicional esperado pelo backend
                bairro: null // Campo adicional esperado pelo backend
            };

            console.log('📦 Payload enviado:', payload);

            const res = await fetch(urlFinal, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            console.log('📥 Resposta recebida:', res.status);

            if (res.ok) {
                const data = await res.json();
                console.log('✅ Sucesso:', data);
                updateProgress(2);
                document.getElementById('successMessage').classList.add('show');
                e.target.style.display = 'none';
            } else {
                const err = await res.json();
                console.error('❌ Erro no servidor:', err);
                mostrarErro(err.mensagem || err.erro || "Erro ao processar dados.");
                btn.classList.remove('loading');
                btn.textContent = 'Enviar Dados para o Escritório';
            }
        } catch (err) {
            console.error("❌ Falha de rede:", err);
            mostrarErro("Falha de conexão. Verifique sua internet e tente novamente.");
            btn.classList.remove('loading');
            btn.textContent = 'Enviar Dados para o Escritório';
        }
    };

    document.querySelectorAll('[name="tipoPessoa"]').forEach(r => {
        r.addEventListener('change', () => alternarTipoPessoa(r.value));
    });

    // Validação visual simples
    document.querySelectorAll('input[required], select[required]').forEach(field => {
        field.addEventListener('blur', function() {
            this.style.borderColor = this.value.trim() === '' ? 'var(--error)' : 'var(--border)';
        });
    });
