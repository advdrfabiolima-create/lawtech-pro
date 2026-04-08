// Manual de Utilização — JS externo (CSP não permite inline scripts)

document.addEventListener('DOMContentLoaded', function () {
    // Renderiza todos os ícones Lucide
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Destaca o link do índice conforme o scroll
    const sections = document.querySelectorAll('.section');
    const tocLinks = document.querySelectorAll('.toc-link');

    function atualizarAtivo() {
        var scrollY = window.scrollY + 120; // offset para o topo
        var atualId = null;

        sections.forEach(function (section) {
            if (section.offsetTop <= scrollY) {
                atualId = section.id;
            }
        });

        tocLinks.forEach(function (link) {
            if (atualId && link.getAttribute('href') === '#' + atualId) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }

    window.addEventListener('scroll', atualizarAtivo, { passive: true });
    atualizarAtivo(); // roda na carga inicial
});
