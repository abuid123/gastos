/* Service worker: guarda la app para que abra sin internet.
   Cada vez que cambies algún archivo, subí VERSION para que los teléfonos bajen la versión nueva. */
const VERSION = 'v2';
const CACHE = `gasto-diario-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'sql-wasm.js',
  'sql-wasm.wasm',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'archivo.woff2',
  'instrument-sans.woff2',
  'dm-mono-400.woff2',
  'dm-mono-500.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gasto-diario-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Responde desde la caché al instante y, en paralelo, la refresca desde la red.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const key = req.mode === 'navigate' ? new URL('index.html', self.registration.scope).href : req;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic' && !res.redirected) cache.put(key, res.clone());
        return res;
      })
      .catch(() => null);
    if (cached) { event.waitUntil(fresh); return cached; }
    return (await fresh) || new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
