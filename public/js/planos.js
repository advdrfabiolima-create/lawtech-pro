// FUNÇÃO PARA ALTERNAR PREÇOS (MENSAL/ANUAL)
function alternarPrecos() {
    const isAnual = document.getElementById('billing-toggle').checked;
    const valores = document.querySelectorAll('.val');
    const periodos = document.querySelectorAll('.periodo');
    const totaisAnuais = document.querySelectorAll('.total-anual');
    const labelMensal = document.getElementById('text-mensal');
    const labelAnual = document.getElementById('text-anual');

    valores.forEach(span => {
        // No modo anual mostra o valor mensal equivalente (já armazenado em data-anual)
        span.innerText = isAnual ? span.getAttribute('data-anual') : span.getAttribute('data-mensal');
    });

    // Período sempre /mês (exibimos o equivalente mensal mesmo no anual)
    periodos.forEach(small => {
        small.innerText = '/mês';
    });

    // Mostra/oculta o total anual abaixo do preço
    totaisAnuais.forEach(el => {
        el.style.display = isAnual ? 'block' : 'none';
    });

    if (isAnual) {
        labelAnual.classList.add('active');
        labelMensal.classList.remove('active');
    } else {
        labelMensal.classList.add('active');
        labelAnual.classList.remove('active');
    }
    
    // Atualiza os botões ao virar a chave
    atualizarEstadoDosBotoes();
}

const BOTOES_MAP = {
    1: 'btn-plano-Basico',
    2: 'btn-plano-Intermediario',
    3: 'btn-plano-Avancado',
    4: 'btn-plano-Premium'
};

let planoSelecionado = null;

function abrirModalConfirmacao(nomePlano) {
    planoSelecionado = nomePlano;
    const isAnual = document.getElementById('billing-toggle').checked;
    const ciclo = isAnual ? 'Anual' : 'Mensal';

    const BENEFICIOS = {
        'Básico': 'Configuração essencial para o seu dia a dia.',
        'Intermediário': 'Ideal para quem busca produtividade e avisos por e-mail. 📧',
        'Avançado': 'Relatórios avançados para gestão completa. 📊',
        'Premium': 'O poder máximo da LawTech Pro em suas mãos. 👑'
    };
    document.getElementById('tituloPlano').innerText = `Plano ${nomePlano} (${ciclo})`;
    document.getElementById('descricaoPlano').innerHTML = `<strong>Excelente escolha!</strong><br>${BENEFICIOS[nomePlano]}`;
    document.getElementById('modalPlano').style.display = 'flex';
}

function fecharModalPlano() {
    document.getElementById('modalPlano').style.display = 'none';
}

async function confirmarUpgrade() {
    if (!planoSelecionado) return;
    
    const btnConfirmar = document.getElementById('btnConfirmar');
    const textoOriginal = btnConfirmar.innerText;
    btnConfirmar.innerText = '⏳ Processando...';
    btnConfirmar.disabled = true;
    
    if (!API.getToken()) {
        alert('❌ Você precisa estar logado para fazer upgrade!');
        window.location.href = '/login.html';
        return;
    }

    const isAnual = document.getElementById('billing-toggle').checked;

    const nomesParaId = { 'Básico': 1, 'Intermediário': 2, 'Avançado': 3, 'Premium': 4 };
    const novoPlanoId = nomesParaId[planoSelecionado];

    console.log('🎯 Iniciando upgrade:', {
        plano: planoSelecionado,
        id: novoPlanoId,
        ciclo: isAnual ? 'anual' : 'mensal'
    });

    try {
        const response = await API.post('/api/planos/upgrade', {
            planoId: novoPlanoId,
            nomePlano: planoSelecionado,
            ciclo: isAnual ? 'anual' : 'mensal',
            cpfUsuario: '00000000000'
        });

        console.log('📡 Resposta do servidor:', response.status);

        if (response.ok) {
            const data = await response.json();
            console.log('✅ Upgrade realizado:', data);
            alert("✅ Plano atualizado com sucesso!");
            fecharModalPlano();
            window.location.href = '/dashboard-modern';
        } else {
            const errorData = await response.json();
            console.error('❌ Erro do servidor:', errorData);
            alert("❌ Erro ao atualizar plano: " + (errorData.erro || 'Erro desconhecido'));
            btnConfirmar.innerText = textoOriginal;
            btnConfirmar.disabled = false;
        }
    } catch (error) {
        console.error("❌ Erro na requisição:", error);
        alert("❌ Erro de conexão ao processar upgrade. Tente novamente.");
        btnConfirmar.innerText = textoOriginal;
        btnConfirmar.disabled = false;
    }
}

// Variável global para guardar o estado vindo do banco
let meuPlanoAtual = { id: 0, ciclo: 'mensal' };

// Função Unificada para Atualizar os Botões
function atualizarEstadoDosBotoes() {
    const isAnual = document.getElementById('billing-toggle').checked;
    const cicloSelecionado = isAnual ? 'anual' : 'mensal';

    console.log('🔄 atualizarEstadoDosBotoes() chamada');
    console.log('   Toggle Anual?', isAnual);
    console.log('   Ciclo Selecionado:', cicloSelecionado);
    console.log('   Plano Atual:', meuPlanoAtual);

    Object.keys(BOTOES_MAP).forEach(id => {
        const btn = document.getElementById(BOTOES_MAP[id]);
        if (btn) {
            const idNum = parseInt(id);
            const isPlanoAtual = (idNum === meuPlanoAtual.id && cicloSelecionado === meuPlanoAtual.ciclo);
            
            console.log(`   Botão ${id}: atual=${meuPlanoAtual.id}, cicloAtual=${meuPlanoAtual.ciclo}, match=${isPlanoAtual}`);
            
            // Regra: Só bloqueia se o ID do plano E o Ciclo forem iguais ao que está no banco
            if (isPlanoAtual) {
                console.log(`   ✅ Botão ${id} DESABILITADO (é o plano atual)`);
                btn.innerText = "Plano Ativo";
                btn.disabled = true;
                btn.classList.add('disabled');
                btn.closest('.plano-card').style.borderColor = "var(--success)";
            } else {
                console.log(`   ⚪ Botão ${id} ATIVO`);
                // Libera para troca
                btn.innerText = (id == 4) ? "Ativar Premium" : (id == 1 ? "Selecionar Básico" : "Selecionar plano");
                btn.disabled = false;
                btn.classList.remove('disabled');
                btn.closest('.plano-card').style.borderColor = "var(--border)";
                if(id == 2) btn.closest('.plano-card').style.borderColor = "var(--primary)"; // Mantém destaque do Intermediário
            }
        }
    });
}

// Carregamento Inicial
document.addEventListener('DOMContentLoaded', async () => {
    if (!API.getToken()) {
        console.log('❌ Token não encontrado');
        return;
    }

    console.log('🔑 Token encontrado, carregando plano...');

    try {
        const response = await API.get('/api/planos/meu-plano');

        console.log('📡 Status da resposta:', response.status);

        if (response.ok) {
            const dados = await response.json();
            console.log('✅ Dados recebidos do servidor:', dados);
            
            // Sincroniza a variável global com o banco
            meuPlanoAtual = { 
                id: parseInt(dados.id), 
                ciclo: dados.ciclo || 'mensal' 
            };
            
            console.log('💾 meuPlanoAtual definido como:', meuPlanoAtual);
            
            // Se no banco estiver 'anual', vira a chave visualmente
            if (meuPlanoAtual.ciclo === 'anual') {
                console.log('🔄 Virando toggle para Anual');
                document.getElementById('billing-toggle').checked = true;
            }
            
            // Atualiza os textos e os botões conforme a posição da chave
            console.log('🔄 Chamando alternarPrecos()...');
            alternarPrecos(); 
            
            console.log('✅ Carregamento inicial completo!');
        } else {
            console.error('❌ Erro ao carregar plano:', response.status);
        }
    } catch (err) { 
        console.error('❌ Erro na carga inicial:', err); 
    }
});