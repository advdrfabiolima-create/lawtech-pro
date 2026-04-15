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

        const etapas = [
            {
                ok: s.configurou_escritorio,
                label: 'Configurar escritório',
                desc: 'Nome, OAB e endereço',
                href: '/config-page',
                icon: '⚙️'
            },
            {
                ok: s.cadastrou_cliente,
                label: 'Cadastrar 1º cliente',
                desc: 'Adicione um cliente',
                href: '/clientes-page',
                icon: '👤'
            },
            {
                ok: s.cadastrou_processo,
                label: 'Cadastrar 1º processo',
                desc: 'Vincule ao cliente',
                href: '/processos-page',
                icon: '📁'
            }
        ];

        const concluidas = etapas.filter(e => e.ok).length;
        const pct = Math.round((concluidas / etapas.length) * 100);

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

        banner.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
                        <span style="font-weight:700;color:#1e293b;font-size:14px;">
                            ⚡ Configure seu escritório para ativar o sistema
                        </span>
                        <span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;
                                     border-radius:20px;padding:2px 10px;font-size:12px;font-weight:600;">
                            ${concluidas}/3 etapas
                        </span>
                    </div>

                    <!-- Barra de progresso -->
                    <div style="background:#e2e8f0;border-radius:99px;height:6px;margin-bottom:14px;overflow:hidden;">
                        <div style="background:linear-gradient(90deg,#1E3A5F,#3b82f6);
                                    width:${pct}%;height:100%;border-radius:99px;
                                    transition:width .4s ease;"></div>
                    </div>

                    <!-- Etapas -->
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        ${etapas.map((et, i) => `
                            <a href="${et.href}"
                               style="display:inline-flex;align-items:center;gap:6px;
                                      padding:7px 12px;border-radius:8px;font-size:13px;font-weight:600;
                                      text-decoration:none;border:1px solid ${et.ok ? '#bbf7d0' : '#e2e8f0'};
                                      background:${et.ok ? '#f0fdf4' : '#f8fafc'};
                                      color:${et.ok ? '#15803d' : '#475569'};
                                      pointer-events:${et.ok ? 'none' : 'auto'};
                                      opacity:${et.ok ? '.8' : '1'};">
                                <span style="font-size:14px;">${et.ok ? '✅' : et.icon}</span>
                                <span>${et.label}</span>
                                ${!et.ok ? '<span style="color:#94a3b8;font-size:11px;">→ Fazer agora</span>' : ''}
                            </a>
                        `).join('')}
                    </div>
                </div>

                <!-- Botão fechar (temporário — volta no próximo carregamento) -->
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
