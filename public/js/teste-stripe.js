
        // ============================================================
        // ✅ CONFIGURAÇÃO STRIPE ELEMENTS (MÉTODO CORRETO)
        // ============================================================
        
        // ⚠️ TROCAR PELA SUA CHAVE PÚBLICA!
        const stripe = Stripe('pk_test_51T0o4eQyn7XA5V1cswOOpK4cYXOmSyQJQP4TfD7hs51vs95Wp29D4Zsb6Br2ATgSsDf7MVmI48TE5nhr4pFShugY00eS21OjGS');
        
        // Criar instância Elements
        const elements = stripe.elements();
        
        // Criar campo de cartão (tudo-em-um: número, validade, CVC)
        const cardElement = elements.create('card', {
            style: {
                base: {
                    fontSize: '16px',
                    color: '#1e293b',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    '::placeholder': {
                        color: '#94a3b8'
                    }
                },
                invalid: {
                    color: '#ef4444',
                    iconColor: '#ef4444'
                }
            },
            hidePostalCode: true
        });
        
        // Montar o campo no DOM
        cardElement.mount('#card-element');
        
        // Exibir erros em tempo real
        const cardErrors = document.getElementById('card-errors');
        cardElement.on('change', (event) => {
            if (event.error) {
                cardErrors.textContent = event.error.message;
            } else {
                cardErrors.textContent = '';
            }
        });
        
        console.log('✅ Stripe Elements inicializado!');
        console.log('📦 Stripe.js versão:', Stripe.version);
        
        // ============================================================
        // PROCESSAR FORMULÁRIO
        // ============================================================
        
        const form = document.getElementById('payment-form');
        const submitButton = document.getElementById('submit-button');
        const resultDiv = document.getElementById('result');
        
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            
            submitButton.disabled = true;
            submitButton.textContent = '⏳ Processando...';
            resultDiv.style.display = 'none';
            
            try {
                const cardholderName = document.getElementById('cardholder-name').value;
                
                console.log('🔐 Criando Payment Method...');
                
                // ✅ CRIAR PAYMENT METHOD (MÉTODO CORRETO)
                const { paymentMethod, error } = await stripe.createPaymentMethod({
                    type: 'card',
                    card: cardElement,
                    billing_details: {
                        name: cardholderName
                    }
                });
                
                if (error) {
                    throw new Error(error.message);
                }
                
                // ✅ SUCESSO!
                console.log('✅ Payment Method criado:', paymentMethod);
                
                resultDiv.className = 'result success';
                resultDiv.style.display = 'block';
                resultDiv.innerHTML = `
                    <h3>✅ Tokenização bem-sucedida!</h3>
                    <p><strong>Payment Method ID:</strong><br>${paymentMethod.id}</p>
                    <p><strong>Bandeira:</strong> ${paymentMethod.card.brand.toUpperCase()}</p>
                    <p><strong>Últimos 4 dígitos:</strong> **** ${paymentMethod.card.last4}</p>
                    <p><strong>Validade:</strong> ${paymentMethod.card.exp_month}/${paymentMethod.card.exp_year}</p>
                    <p><strong>País:</strong> ${paymentMethod.card.country || 'N/A'}</p>
                    <p><strong>Funding:</strong> ${paymentMethod.card.funding}</p>
                    
                    <details style="margin-top: 15px;">
                        <summary style="cursor: pointer; font-weight: bold;">📋 Ver JSON completo</summary>
                        <pre>${JSON.stringify(paymentMethod, null, 2)}</pre>
                    </details>
                    
                    <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px; margin-top: 15px; font-size: 13px; color: #92400e;">
                        <strong>💡 Próximo passo:</strong> Enviar este <code>paymentMethod.id</code> 
                        para o backend e salvar na tabela <code>cartoes</code>.
                    </div>
                `;
                
                // Limpar o formulário
                cardElement.clear();
                document.getElementById('cardholder-name').value = '';
                
            } catch (err) {
                console.error('❌ Erro:', err);
                
                resultDiv.className = 'result error';
                resultDiv.style.display = 'block';
                resultDiv.innerHTML = `
                    <h3>❌ Erro na tokenização</h3>
                    <p><strong>Mensagem:</strong> ${err.message}</p>
                    <p style="font-size: 13px; margin-top: 10px;">
                        <strong>Verifique:</strong><br>
                        • Cartão de teste válido: 4242 4242 4242 4242<br>
                        • Validade futura (ex: 12/25)<br>
                        • CVC com 3 dígitos (ex: 123)<br>
                        • Chave Stripe está correta
                    </p>
                `;
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = '🔐 Tokenizar Cartão';
            }
        });
    