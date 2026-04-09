const CACHE_NAME = 'lawtech-app-v9';
const APP_SHELL = [
    '/app',
    '/js/app.js',
    '/manifest.json',
    'https://unpkg.com/lucide@0.451.0/dist/umd/lucide.min.js'
];

self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            return cache.addAll(APP_SHELL).catch(function () {
                // ignora erros de cache em dev
            });
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (k) { return k !== CACHE_NAME; })
                    .map(function (k) { return caches.delete(k); })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', function (e) {
    var url = e.request.url;

    // API calls: sempre network-first (dados em tempo real)
    if (url.includes('/api/')) {
        e.respondWith(
            fetch(e.request).catch(function () {
                return new Response(
                    JSON.stringify({ erro: 'Sem conexão com a internet', offline: true }),
                    { headers: { 'Content-Type': 'application/json' } }
                );
            })
        );
        return;
    }

    // App shell: cache-first
    e.respondWith(
        caches.match(e.request).then(function (cached) {
            return cached || fetch(e.request).then(function (response) {
                if (response.ok && e.request.method === 'GET') {
                    var clone = response.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(e.request, clone);
                    });
                }
                return response;
            });
        })
    );
});
