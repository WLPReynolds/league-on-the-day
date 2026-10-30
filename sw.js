// Service worker: app shell is cached per version; results data is served from cache
// and refreshed in the background (past seasons never change; the current one does).
const VERSION = '1.0.0';
const SHELL = `lotd-shell-${VERSION}`;
const DATA = 'lotd-data';

const SHELL_FILES = [
  './',
  'index.html',
  'styles.css?v=1.0.0',
  'src/app.js?v=1.0.0',
  'src/league.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'data/index.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lotd-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.includes('/data/')) {
    // Stale-while-revalidate for results data.
    e.respondWith(caches.open(DATA).then(async (c) => {
      const cached = await c.match(e.request);
      const fresh = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
      if (cached) { e.waitUntil(fresh.catch(() => {})); return cached; }
      return fresh;
    }));
    return;
  }

  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
