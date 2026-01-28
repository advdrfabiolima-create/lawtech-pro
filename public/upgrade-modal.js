/**
 * ====================================================================
 * SISTEMA UNIVERSAL DE MODAIS DE UPGRADE - LAWTECH PRO
 * ====================================================================
 * Este arquivo contém funções reutilizáveis para exibir modais de
 * upgrade quando o usuário tenta acessar funcionalidades restritas.
 */

/**
 * Exibir modal de upgrade genérico
 * @param {string} feature - Nome da funcionalidade (ex: "CRM", "IA Jurídica", "Boletos")
 * @param {string} planoNecessario - Plano mínimo necessário
 * @param {string} mensagemCustomizada - Mensagem personalizada (opcional)
 */
function mostrarModalUpgrade(feature, planoNecessario, mensagemCustomizada) {
    // Remover modais existentes
    const existente = document.getElementById('overlay-upgrade-universal');
    if (existente) existente.remove();
    
    const mensagemPadrao = `A funcionalidade "${feature}" não está disponível no seu plano atual. Faça upgrade para o plano ${planoNecessario} para desbloquear este recurso.`;
    const mensagem = mensagemCustomizada || mensagemPadrao;
    
    // Definir funcionalidades por plano
    const funcionalidadesPlanos = {
        "Intermediário": [
            "• Até 15 usuários simultâneos",
            "• 100 prazos mensais",
            "• Financeiro Jurídico completo",
            "• Relatórios avançados",
            "• Suporte prioritário",
            "• Integrações básicas"
        ],
        "Avançado": [
            "• Tudo do Intermediário",
            "• Usuários completamente ilimitados",
            "• 500 prazos mensais",
            "• Cálculos Jurídicos",
            "• Automações avançadas",
            "• API completa"
        ],
        "Premium": [
            "• Tudo do Avançado",
            "• Usuários completamente ilimitados",
            "• CRM Jurídico completo",
            "• IA Jurídica integrada",
            "• Integração DJEN completa",
            "• Alertas via WhatsApp"
        ]
    };
    
    const funcionalidades = funcionalidadesPlanos[planoNecessario] || funcionalidadesPlanos["Premium"];
    const listaPontosHTML = funcionalidades.join('<br>');
    
    const overlay = document.createElement('div');
    overlay.id = 'overlay-upgrade-universal';
    overlay.innerHTML = `
    <div style="position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(15,23,42,0.8); z-index:9999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(8px); animation:fadeIn 0.3s;">
        <div style="background:white; max-width:520px; width:90%; border-radius:24px; padding:40px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25); animation:slideUp 0.4s; position:relative;">
            
            <!-- Ícone de topo -->
            <div style="width:72px; height:72px; margin:0 auto 24px; background:linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px rgba(59,130,246,0.2);">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                    <path d="M2 17l10 5 10-5"></path>
                    <path d="M2 12l10 5 10-5"></path>
                </svg>
            </div>
            
            <h3 style="margin:0 0 15px 0; color:#0f172a; font-size:24px; font-weight:800; text-align:center;">Recurso ${planoNecessario}</h3>
            
            <p style="color:#64748b; margin:0 0 30px 0; font-size:16px; line-height:1.6; text-align:center;">${mensagem}</p>
            
            <!-- Box de funcionalidades -->
            <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:12px; padding:20px; margin-bottom:30px; text-align:left;">
                <p style="margin:0; font-size:14px; color:#92400e; line-height:1.8;">
                    <strong style="display:block; margin-bottom:12px; font-size:15px;">🚀 O Plano ${planoNecessario} inclui:</strong>
                    ${listaPontosHTML}
                </p>
            </div>
            
            <!-- Botões -->
            <div style="display:flex; gap:12px; justify-content:center;">
                <button onclick="window.location.href='/planos-page'" 
                        style="background:linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); color:#000; border:none; padding:16px 32px; border-radius:12px; font-weight:800; font-size:15px; cursor:pointer; box-shadow:0 4px 14px rgba(251,191,36,0.4); transition:0.3s; flex:1;"
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(251,191,36,0.5)';"
                        onmouseout="this.style.transform=''; this.style.boxShadow='0 4px 14px rgba(251,191,36,0.4)';">
                    🎯 Ver Planos e Preços
                </button>
                
                <button onclick="document.getElementById('overlay-upgrade-universal').remove()" 
                        style="background:transparent; color:#64748b; border:2px solid #e2e8f0; padding:16px 24px; border-radius:12px; font-weight:700; cursor:pointer; transition:0.3s;"
                        onmouseover="this.style.borderColor='#cbd5e1'; this.style.background='#f8fafc';"
                        onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='transparent';">
                    Depois
                </button>
            </div>
        </div>
    </div>
    
    <style>
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    @keyframes slideUp {
        from { transform: translateY(30px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
    }
    </style>`;
    
    document.body.appendChild(overlay);
}

/**
 * Exibir modal de limite atingido (prazos, usuários, etc)
 * @param {string} recurso - Nome do recurso (ex: "prazos", "usuários")
 * @param {number} limite - Limite atual
 * @param {string} planoNecessario - Plano necessário para aumentar limite
 */
function mostrarModalLimite(recurso, limite, planoNecessario) {
    const mensagens = {
        "prazos": `Você atingiu o limite de ${limite} prazos mensais do seu plano atual.`,
        "usuarios": `Você atingiu o limite de ${limite} usuários do seu plano atual.`,
        "processos": `Você atingiu o limite de ${limite} processos do seu plano atual.`
    };
    
    const mensagem = mensagens[recurso] || `Você atingiu o limite de ${limite} ${recurso} do seu plano atual.`;
    mostrarModalUpgrade(recurso.toUpperCase(), planoNecessario, mensagem);
}

/**
 * Interceptar erros 402 (Payment Required) das APIs
 * Automaticamente exibe o modal quando uma requisição retorna 402
 */
function interceptar402(response, featureName) {
    if (response.status === 402) {
        response.json().then(data => {
            const feature = data.feature || featureName || "Este recurso";
            const plano = data.current_plan || "seu plano atual";
            const mensagem = data.message || `${feature} não está disponível no ${plano}.`;
            const planoNecessario = determinarPlanoNecessario(data.feature);
            
            mostrarModalUpgrade(feature, planoNecessario, mensagem);
        }).catch(() => {
            mostrarModalUpgrade(featureName || "Este recurso", "Premium", "Funcionalidade não disponível no seu plano.");
        });
        return true;
    }
    return false;
}

/**
 * Determinar qual plano é necessário baseado na feature
 */
function determinarPlanoNecessario(feature) {
    const mapeamento = {
        "crm": "Premium",
        "ia_juridica": "Premium",
        "calculos": "Avançado",
        "financeiro_avancado": "Intermediário",
        "prazos": "Intermediário",
        "usuarios": "Intermediário"
    };
    
    return mapeamento[feature] || "Premium";
}

// Exportar para uso global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        mostrarModalUpgrade,
        mostrarModalLimite,
        interceptar402
    };
}