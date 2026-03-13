/**
 * LawTech Pro — Blog Engine
 * Renderização dinâmica de artigos via /data/blog.json
 */

const Blog = (() => {
    let allArticles = [];
    let allGuides = [];
    let currentFilter = 'todos';
    let currentSearch = '';
    let featuredSlug = '';

    // ── Ícones SVG por categoria ──────────────────────────────────────────────
    const categoryIcons = {
        tecnologia: `<svg viewBox="0 0 24 24"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></svg>`,
        tributario: `<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
        trabalho:   `<svg viewBox="0 0 24 24"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>`,
        digital:    `<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
        civil:      `<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
        penal:      `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="15" r="3"/></svg>`,
        gestao:     `<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
    };

    const guideIcons = {
        brain:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/></svg>`,
        shield:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`,
        briefcase: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
    };

    const categoryLabels = {
        tecnologia: 'Tecnologia', tributario: 'Tributário', trabalho: 'Trabalhista',
        digital: 'Direito Digital', civil: 'Processo Civil', penal: 'Penal', gestao: 'Gestão',
    };

    // ── Formatador de data ────────────────────────────────────────────────────
    function formatDate(dateStr) {
        const [year, month, day] = dateStr.split('-');
        const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        return `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`;
    }

    // ── Renderizar artigo destaque ────────────────────────────────────────────
    function renderFeatured(article) {
        if (!article) return '';
        const url = article.external_url || `blog-post.html?slug=${article.slug}`;
        const target = article.external_url ? 'target="_blank" rel="noopener"' : '';
        return `
        <article class="featured-article">
            <div class="featured-content">
                <span class="featured-badge">⚡ Artigo em Destaque</span>
                <h2>${article.title}</h2>
                <p>${article.excerpt}</p>
                <div class="featured-meta">
                    <span class="featured-meta-item">📅 ${formatDate(article.date)}</span>
                    <span class="featured-meta-item">⏱️ ${article.reading_time}</span>
                    <span class="featured-meta-item">🏷️ ${categoryLabels[article.category] || article.category}</span>
                </div>
                <a href="${url}" ${target} class="featured-cta">Ler artigo completo →</a>
            </div>
            <div class="featured-image-side">
                <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            </div>
        </article>`;
    }

    // ── Renderizar card de artigo ─────────────────────────────────────────────
    function renderCard(article) {
        const url = article.external_url || `blog-post.html?slug=${article.slug}`;
        const target = article.external_url ? 'target="_blank" rel="noopener"' : '';
        const icon = categoryIcons[article.category] || categoryIcons.tecnologia;
        const tags = (article.tags || []).slice(0, 3).map(t =>
            `<span class="article-tag">#${t}</span>`
        ).join('');

        return `
        <article class="article-card" data-category="${article.category}">
            <div class="article-image">
                <div class="article-icon">${icon}</div>
            </div>
            <div class="article-content">
                <div class="article-meta">
                    <span class="article-category cat-${article.category}">${categoryLabels[article.category] || article.category}</span>
                    <span class="article-date">${formatDate(article.date)}</span>
                </div>
                <h3 class="article-title">${article.title}</h3>
                <p class="article-excerpt">${article.excerpt}</p>
                <div class="article-tags">${tags}</div>
                <div class="article-footer">
                    <a href="${url}" ${target} class="read-more">Continuar lendo</a>
                    <span class="quick-read">⏱️ ${article.reading_time}</span>
                </div>
            </div>
        </article>`;
    }

    // ── Mid-page CTA ──────────────────────────────────────────────────────────
    function renderMidCta() {
        return `
        <div class="mid-cta">
            <div class="mid-cta-text">
                <h3>Automatize seu escritório com LawTech Pro</h3>
                <p>Gestão de processos, prazos, CRM jurídico e IA — tudo em uma plataforma.</p>
            </div>
            <a href="register.html" class="mid-cta-btn">
                Teste grátis por 7 dias →
            </a>
        </div>`;
    }

    // ── Filtrar artigos ───────────────────────────────────────────────────────
    function getFilteredArticles() {
        const featured = allArticles.find(a => a.slug === featuredSlug);
        let list = allArticles.filter(a => a.slug !== featuredSlug);

        if (currentFilter !== 'todos') {
            list = list.filter(a => a.category === currentFilter);
        }

        if (currentSearch.trim()) {
            const q = currentSearch.toLowerCase();
            list = list.filter(a =>
                a.title.toLowerCase().includes(q) ||
                a.excerpt.toLowerCase().includes(q) ||
                a.category.toLowerCase().includes(q) ||
                (a.tags || []).some(t => t.toLowerCase().includes(q))
            );
        }

        return { featured, list };
    }

    // ── Renderizar grid de artigos ────────────────────────────────────────────
    function renderArticles() {
        const grid = document.getElementById('articlesGrid');
        const title = document.getElementById('articlesTitle');
        const count = document.getElementById('articlesCount');
        const breadcat = document.getElementById('breadcrumbCategory');
        if (!grid) return;

        const { featured, list } = getFilteredArticles();
        const isSearching = currentSearch.trim().length > 0;
        const isFiltering = currentFilter !== 'todos';

        // Breadcrumb
        if (isFiltering) {
            breadcat.innerHTML = `<a href="#" onclick="Blog.setFilter('todos');return false">Blog</a> › ${categoryLabels[currentFilter] || currentFilter}`;
        } else {
            breadcat.textContent = 'Blog';
        }

        // Section title + count
        const label = isFiltering ? categoryLabels[currentFilter] : 'Todos os Artigos';
        title.textContent = isSearching ? `Resultados para "${currentSearch}"` : label;
        count.textContent = `${list.length} artigo${list.length !== 1 ? 's' : ''}`;

        // Empty state
        if (list.length === 0 && (isSearching || isFiltering)) {
            grid.innerHTML = `
            <div class="articles-empty">
                <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <h3>${isSearching ? 'Nenhum resultado encontrado' : 'Nenhum artigo nesta categoria'}</h3>
                <p>${isSearching ? `Tente outras palavras-chave ou <a href="#" onclick="Blog.clearSearch();return false">limpar a busca</a>.` : 'Novos artigos em breve.'}</p>
            </div>`;
            return;
        }

        // Build HTML
        let html = '';

        // Featured (só quando não está filtrando/buscando)
        if (!isFiltering && !isSearching && featured) {
            html += renderFeatured(featured);
        }

        // Mid CTA after 6th article
        list.forEach((article, i) => {
            if (i === 6) html += renderMidCta();
            html += renderCard(article);
        });

        grid.innerHTML = html;
    }

    // ── Atualizar contadores dos filtros ──────────────────────────────────────
    function updateFilterCounts() {
        const featured = allArticles.find(a => a.slug === featuredSlug);
        const others = allArticles.filter(a => a.slug !== featuredSlug);

        document.getElementById('count-todos').textContent = others.length;

        ['tecnologia','tributario','trabalho','digital','civil','penal'].forEach(cat => {
            const el = document.getElementById(`count-${cat}`);
            if (el) el.textContent = others.filter(a => a.category === cat).length;
        });
    }

    // ── Renderizar "Mais Lidos" ───────────────────────────────────────────────
    function renderPopularSection() {
        const section = document.getElementById('popularSection');
        if (!section) return;

        const popular = [...allArticles]
            .sort((a, b) => (b.views || 0) - (a.views || 0))
            .slice(0, 4);

        section.innerHTML = `
        <div class="popular-header">
            <h2>🔥 Mais lidos da semana</h2>
        </div>
        <div class="popular-grid">
            ${popular.map((a, i) => {
                const url = a.external_url || `blog-post.html?slug=${a.slug}`;
                const target = a.external_url ? 'target="_blank" rel="noopener"' : '';
                return `
                <a href="${url}" ${target} class="popular-card">
                    <div class="popular-rank">0${i + 1}</div>
                    <h3>${a.title}</h3>
                    <div class="popular-card-meta">
                        <span class="article-category cat-${a.category}">${categoryLabels[a.category]}</span>
                        <span>⏱️ ${a.reading_time}</span>
                    </div>
                </a>`;
            }).join('')}
        </div>`;
    }

    // ── Renderizar Guias ──────────────────────────────────────────────────────
    function renderGuides() {
        const section = document.getElementById('guidesSection');
        if (!section || !allGuides.length) return;

        section.innerHTML = `
        <div class="container">
            <div class="guides-header">
                <h2>📖 Guias Completos</h2>
            </div>
            <div class="guides-grid">
                ${allGuides.map(g => `
                <a href="blog-post.html?slug=${g.slug}" class="guide-card">
                    <div class="guide-icon">${guideIcons[g.icon] || guideIcons.briefcase}</div>
                    <div class="guide-info">
                        <span class="guide-label">${categoryLabels[g.category] || g.category}</span>
                        <h3>${g.title}</h3>
                        <p>${g.description}</p>
                        <div class="guide-meta">
                            <span>⏱️ ${g.reading_time}</span>
                            <span>📑 ${g.chapters} capítulos</span>
                        </div>
                    </div>
                </a>`).join('')}
            </div>
        </div>`;
    }

    // ── Sidebar: populares ────────────────────────────────────────────────────
    function renderSidebarPopular() {
        const el = document.getElementById('sidebarPopular');
        if (!el) return;

        const popular = [...allArticles]
            .sort((a, b) => (b.views || 0) - (a.views || 0))
            .slice(0, 5);

        el.innerHTML = popular.map((a, i) => {
            const url = a.external_url || `blog-post.html?slug=${a.slug}`;
            const target = a.external_url ? 'target="_blank" rel="noopener"' : '';
            return `
            <a href="${url}" ${target} class="popular-item">
                <span class="popular-num">0${i + 1}</span>
                <div class="popular-info">
                    <h4>${a.title}</h4>
                    <span>${categoryLabels[a.category]} · ${a.reading_time}</span>
                </div>
            </a>`;
        }).join('');
    }

    // ── Sidebar: categorias ───────────────────────────────────────────────────
    function renderSidebarCategories() {
        const el = document.getElementById('sidebarCategories');
        if (!el) return;

        const cats = ['tecnologia','tributario','trabalho','digital','civil','penal'];
        const counts = {};
        allArticles.forEach(a => { counts[a.category] = (counts[a.category] || 0) + 1; });

        el.innerHTML = cats
            .filter(c => counts[c] > 0)
            .map(c => `
            <a href="#" class="category-item" onclick="Blog.setFilter('${c}');return false">
                <span class="category-name">${categoryLabels[c]}</span>
                <span class="category-count-badge">${counts[c]}</span>
            </a>`).join('');
    }

    // ── Busca ─────────────────────────────────────────────────────────────────
    function initSearch() {
        const input = document.getElementById('blogSearch');
        const clearBtn = document.getElementById('searchClear');
        const countEl = document.getElementById('searchCount');
        if (!input) return;

        input.addEventListener('input', () => {
            currentSearch = input.value;
            clearBtn.style.display = currentSearch ? 'flex' : 'none';

            if (currentSearch.trim()) {
                const { list } = getFilteredArticles();
                countEl.textContent = `${list.length} resultado${list.length !== 1 ? 's' : ''} encontrado${list.length !== 1 ? 's' : ''}`;
            } else {
                countEl.textContent = '';
            }

            renderArticles();
        });

        clearBtn.addEventListener('click', () => {
            input.value = '';
            currentSearch = '';
            clearBtn.style.display = 'none';
            countEl.textContent = '';
            renderArticles();
            input.focus();
        });
    }

    // ── Filtros ───────────────────────────────────────────────────────────────
    function initFilters() {
        const buttons = document.querySelectorAll('.filter-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                setFilter(btn.getAttribute('data-filter'));
            });
        });
    }

    function setFilter(filter) {
        currentFilter = filter;
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
        });
        renderArticles();

        // Scroll suave para a seção de artigos
        const section = document.querySelector('.blog-main');
        if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function clearSearch() {
        const input = document.getElementById('blogSearch');
        if (input) { input.value = ''; }
        currentSearch = '';
        document.getElementById('searchClear').style.display = 'none';
        document.getElementById('searchCount').textContent = '';
        renderArticles();
    }

    // ── Newsletter ────────────────────────────────────────────────────────────
    function initNewsletter() {
        const form = document.getElementById('newsletterForm');
        if (!form) return;
        form.addEventListener('submit', e => {
            e.preventDefault();
            const btn = form.querySelector('.newsletter-btn');
            btn.textContent = '✓ Inscrito!';
            btn.style.background = '#10b981';
            btn.style.color = '#fff';
            form.querySelector('.newsletter-input').value = '';
            setTimeout(() => {
                btn.textContent = 'Inscrever-se';
                btn.style.background = '';
                btn.style.color = '';
            }, 3000);
        });
    }

    // ── Bootstrap ─────────────────────────────────────────────────────────────
    async function init() {
        try {
            const res = await fetch('/data/blog.json');
            if (!res.ok) throw new Error('Falha ao carregar blog.json');
            const data = await res.json();

            allArticles = data.articles || [];
            allGuides = data.guides || [];
            featuredSlug = data.featured_slug || '';

            updateFilterCounts();
            renderPopularSection();
            renderGuides();
            renderArticles();
            renderSidebarPopular();
            renderSidebarCategories();
            initSearch();
            initFilters();
            initNewsletter();

        } catch (err) {
            console.error('[Blog] Erro ao carregar dados:', err);
            const grid = document.getElementById('articlesGrid');
            if (grid) {
                grid.innerHTML = `
                <div class="articles-empty">
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <h3>Não foi possível carregar os artigos</h3>
                    <p>Tente recarregar a página.</p>
                </div>`;
            }
        }
    }

    // API pública
    return { init, setFilter, clearSearch };
})();

document.addEventListener('DOMContentLoaded', Blog.init);
