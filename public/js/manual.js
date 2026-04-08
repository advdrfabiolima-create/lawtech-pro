// Manual de Utilização — JS externo (CSP não permite inline scripts)

document.addEventListener('DOMContentLoaded', function () {
    // Renderiza todos os ícones Lucide
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Destaca o link do índice conforme o scroll
    const sections = document.querySelectorAll('.section');
    const tocLinks = document.querySelectorAll('.toc-link');

    const observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting) {
                tocLinks.forEach(function (link) { link.classList.remove('active'); });
                var activeLink = document.querySelector('.toc-link[href="#' + entry.target.id + '"]');
                if (activeLink) activeLink.classList.add('active');
            }
        });
    }, { threshold: 0.3, rootMargin: '-60px 0px -60% 0px' });

    sections.forEach(function (section) { observer.observe(section); });
});
