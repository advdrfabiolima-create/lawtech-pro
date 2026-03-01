
        // Guard síncrono — redireciona antes de renderizar qualquer conteúdo
        (function() {
            var token = localStorage.getItem('token');
            if (!token) {
                window.location.replace('/login.html');
            }
        })();
    

// Validação assíncrona do token — invalida sessões expiradas ou forjadas
(function() {
    var token = localStorage.getItem('token');
    if (!token) { window.location.replace('/login.html'); return; }
    fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
        .then(function(r) {
            if (!r.ok) { localStorage.removeItem('token'); window.location.replace('/login.html'); }
        })
        .catch(function() { /* mantém a página se a rede falhar momentaneamente */ });
})();

// Função para inicializar ícones Lucide com retry
function initLucideIcons() {
    if (window.lucide) {
        try {
            lucide.createIcons();
            console.log('✅ Ícones Lucide inicializados com sucesso!');
        } catch (error) {
            console.error('❌ Erro ao inicializar Lucide:', error);
        }
    } else {
        console.warn('⚠️ Lucide não carregado ainda, tentando novamente...');
        setTimeout(initLucideIcons, 100);
    }
}

// Inicializar quando DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLucideIcons);
} else {
    initLucideIcons();
}

// Também inicializar após window.onload
window.addEventListener('load', initLucideIcons);

const searchInput = document.querySelector('.search-input');
const cards = document.querySelectorAll('.tribunal-card');

searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    cards.forEach(card => {
        const title = card.querySelector('h3').textContent.toLowerCase();
        const subtitle = card.querySelector('.card-subtitle').textContent.toLowerCase();
        card.style.display = (title.includes(searchTerm) || subtitle.includes(searchTerm)) ? 'block' : 'none';
    });
});

const filterChips = document.querySelectorAll('.filter-chip');
const sections = document.querySelectorAll('.section');

filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
        filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        
        const filterText = chip.textContent.toLowerCase();
        
        if (filterText === 'todos') {
            sections.forEach(section => section.style.display = 'block');
        } else {
            sections.forEach(section => {
                const category = section.getAttribute('data-category');
                section.style.display = category === filterText ? 'block' : 'none';
            });
        }
    });
});

const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

cards.forEach((card, index) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = `all 0.5s ease ${index * 0.03}s`;
    observer.observe(card);
});
