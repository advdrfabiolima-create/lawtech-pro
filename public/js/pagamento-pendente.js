
        lucide.createIcons();
        function logout() {
            localStorage.clear();
            window.location.href = '/login';
        }

        document.getElementById('btnLogout').addEventListener('click', logout);
