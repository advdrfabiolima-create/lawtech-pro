/**
 * Banner de Onboarding — LawTech Pro
 *
 * Exibe um card de progresso persistente até o usuário completar as 3 etapas
 * de ativação do escritório. Inclua este script nas páginas principais.
 *
 * Dependência: api.js (deve ser carregado antes)
 */
(function () {
    const STORAGE_KEY = 'onboarding_concluido';

    // Se já foi marcado como concluído nesta sessão, não faz nada
    if (sessionStorage.getItem(STORAGE_KEY) === '1') return;

    async function carregarOnboarding() {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        if (!token) return;

        let status;
        try {
            const res = await fetch('/api/onboarding/status', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) return;
            status = await res.json();
        } catch (_) { return; }

        if (status.concluido) {
            sessionStorage.setItem(STORAGE_KEY, '1');
            return;
        }

        renderizarBanner(status);
    }

    function renderizarBanner(s) {
        // Evita duplicar o banner se já existir
        if (document.getElementById('onboarding-banner')) return;

        // Regras de desbloqueio sequencial:
        // Etapa 1 — Escritório: sempre ativa
        // Etapa 2 — Clientes: só ativa após escritório configurado
        // Etapa 3 — Processos: só ativa após ter ao menos 1 cliente
        const etapas = [
            {
                num: 1,
                ok: s.configurou_escritorio,
                ativa: true,
                label: 'Dados do Escritório',
                sublabel: 'Nome, OAB e endereço',
                href: '/config-page',
                icon: '⚙️'
            },
            {
                num: 2,
                ok: s.cadastrou_cliente,
                ativa: s.configurou_escritorio,
                label: 'Clientes',
                sublabel: 'Cadastre ao menos 1 cliente',
                href: '/clientes-page',
                icon: '👤'
            },
            {
                num: 3,
                ok: s.cadastrou_processo,
                ativa: s.cadastrou_cliente,
                label: 'Processos',
                sublabel: 'Vincule ao cliente cadastrado',
                href: '/processos-page',
                icon: '📁'
            }
        ];

        const concluidas = etapas.filter(e => e.ok).length;
        const pct = Math.round((concluidas / etapas.length) * 100);

        // Próxima etapa pendente (para destaque)
        const proxima = etapas.find(e => !e.ok);

        const banner = document.createElement('div');
        banner.id = 'onboarding-banner';
        banner.style.cssText = `
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-left: 4px solid #1E3A5F;
            border-radius: 10px;
            padding: 16px 20px;
            margin: 0 0 20px 0;
            box-shadow: 0 2px 8px rgba(0,0,0,.06);
        `;

        function cardEtapa(et) {
            if (et.ok) {
                // Concluída
                return `
                <div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:140px;flex:1;max-width:200px;">
                    <div style="width:100%;padding:10px 14px;border-radius:8px;border:1px solid #bbf7d0;
                                background:#f0fdf4;text-align:center;">
                        <div style="font-size:18px;margin-bottom:2px;">✅</div>
                        <div style="font-size:12px;font-weight:700;color:#15803d;">${et.label}</div>
                        <div style="font-size:11px;color:#86efac;margin-top:1px;">Concluído</div>
                    </div>
                </div>`;
            }
            if (et.ativa) {
                // Pendente e desbloqueada — destaque azul se for a próxima
                const isProxima = proxima && et.num === proxima.num;
                return `
                <a href="${et.href}" style="display:flex;flex-direction:column;align-items:center;gap:4px;
                            min-width:140px;flex:1;max-width:200px;text-decoration:none;">
                    <div style="width:100%;padding:10px 14px;border-radius:8px;box-sizing:border-box;
                                border:${isProxima ? '2px solid #3b82f6' : '1px solid #e2e8f0'};
                                background:${isProxima ? '#eff6ff' : '#f8fafc'};
                                text-align:center;transition:box-shadow .2s;">
                        <div style="font-size:18px;margin-bottom:2px;">${et.icon}</div>
                        <div style="font-size:12px;font-weight:700;color:${isProxima ? '#1d4ed8' : '#475569'};">
                            ${et.label}
                        </div>
                        <div style="font-size:11px;color:${isProxima ? '#3b82f6' : '#94a3b8'};margin-top:1px;">
                            ${isProxima ? '→ Fazer agora' : et.sublabel}
                        </div>
                    </div>
                </a>`;
            }
            // Bloqueada
            return `
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:140px;flex:1;max-width:200px;
                        cursor:not-allowed;" title="Complete a etapa anterior primeiro">
                <div style="width:100%;padding:10px 14px;border-radius:8px;box-sizing:border-box;
                            border:1px solid #e2e8f0;background:#f1f5f9;text-align:center;opacity:.55;">
                    <div style="font-size:18px;margin-bottom:2px;">🔒</div>
                    <div style="font-size:12px;font-weight:700;color:#94a3b8;">${et.label}</div>
                    <div style="font-size:11px;color:#cbd5e1;margin-top:1px;">Complete a etapa anterior</div>
                </div>
            </div>`;
        }

        // Setas separadoras entre etapas
        const seta = `<div style="font-size:18px;color:#cbd5e1;flex-shrink:0;align-self:center;padding-bottom:4px;">→</div>`;

        banner.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
                        <span style="font-weight:700;color:#1e293b;font-size:14px;">
                            ⚡ Siga a ordem abaixo para ativar o sistema
                        </span>
                        <span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;
                                     border-radius:20px;padding:2px 10px;font-size:12px;font-weight:600;">
                            ${concluidas}/3 etapas concluídas
                        </span>
                    </div>

                    <!-- Barra de progresso -->
                    <div style="background:#e2e8f0;border-radius:99px;height:5px;margin-bottom:14px;overflow:hidden;">
                        <div style="background:linear-gradient(90deg,#1E3A5F,#3b82f6);
                                    width:${pct}%;height:100%;border-radius:99px;
                                    transition:width .4s ease;"></div>
                    </div>

                    <!-- Etapas sequenciais -->
                    <div style="display:flex;align-items:stretch;gap:8px;flex-wrap:wrap;">
                        ${etapas.map((et, i) => cardEtapa(et) + (i < etapas.length - 1 ? seta : '')).join('')}
                    </div>
                </div>

                <!-- Botão fechar -->
                <button id="onboarding-fechar"
                    style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:18px;
                           line-height:1;padding:2px;flex-shrink:0;margin-top:2px;"
                    title="Ocultar por agora">×</button>
            </div>
        `;

        // Insere no início do main content (compatível com as variantes de layout do projeto)
        const alvo =
            document.getElementById('main-content') ||
            document.querySelector('main.content') ||
            document.querySelector('.main-content') ||
            document.querySelector('main') ||
            document.querySelector('.content') ||
            document.body;

        alvo.insertBefore(banner, alvo.firstChild);

        // Fechar temporariamente (só esta sessão, próximo carregamento verifica novamente)
        document.getElementById('onboarding-fechar').addEventListener('click', () => {
            banner.remove();
        });
    }

    // Aguarda DOM estar pronto antes de injetar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', carregarOnboarding);
    } else {
        carregarOnboarding();
    }
})();
