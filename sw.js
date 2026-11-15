// Pipeworks service worker — offline play after the first online visit.
// Bump CACHE on every release so phones pick up the new build.
const CACHE = 'pipeworks-v0.13.3';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Pages (navigations): network first, so a new build (or a gift link opened from a QR) runs the
// latest code right away; falls back to the cached copy when offline or after NAV_TIMEOUT ms.
// Everything else: stale-while-revalidate (answer from cache, refresh in the background).
const NAV_TIMEOUT = 3000;
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });   // ?debug, ?phase=4 work offline
      const network = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (req.mode === 'navigate') {
        const timeout = new Promise(r => setTimeout(() => r(null), NAV_TIMEOUT));
        const fresh = await Promise.race([network, timeout]);
        if (fresh && fresh.ok) return fresh;
      }
      return cached || (await network) || cache.match('./index.html');
    })
  );
});
