
        // Sistema de filtros por categoria
        document.addEventListener('DOMContentLoaded', function() {
            const filterButtons = document.querySelectorAll('.filter-btn');
            const articles = document.querySelectorAll('.article-card');
            
            filterButtons.forEach(button => {
                button.addEventListener('click', function() {
                    // Remove active de todos os botões
                    filterButtons.forEach(btn => btn.classList.remove('active'));
                    // Adiciona active no botão clicado
                    this.classList.add('active');
                    
                    const filter = this.getAttribute('data-filter');
                    
                    // Filtra os artigos
                    articles.forEach(article => {
                        if (filter === 'todos') {
                            article.style.display = 'block';
                            article.style.animation = 'fadeIn 0.5s ease';
                        } else {
                            const category = article.getAttribute('data-category');
                            if (category === filter) {
                                article.style.display = 'block';
                                article.style.animation = 'fadeIn 0.5s ease';
                                // Scroll suave até o primeiro artigo da categoria
                                if (articles[0] === article || Array.from(articles).indexOf(article) === Array.from(articles).findIndex(a => a.getAttribute('data-category') === filter)) {
                                    setTimeout(() => {
                                        article.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }, 100);
                                }
                            } else {
                                article.style.display = 'none';
                            }
                        }
                    });
                });
            });
        });
        
        // Animação de fade in
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    