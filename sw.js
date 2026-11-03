// Service worker. Online, the page and the results data always come from the network
// (revalidated, so the browser's own cache can't hand back a stale copy), and are saved for
// offline use. Offline, the saved copies are used. Scripts and styles carry the version in
// their URL, so those are served from the saved copy for this version.
const VERSION = '1.0.7';
const SHELL = `lotd-shell-${VERSION}`;
const DATA = 'lotd-data';

const SHELL_FILES = [
  './',
  'index.html',
  'styles.css?v=1.0.7',
  'src/app.js?v=1.0.7',
  'src/league.js',
  'src/charts.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never saves old files.
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lotd-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Network first (revalidating with the server), saving the response; saved copy if offline. */
async function networkFirst(request, cacheName, key = request) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (fresh.ok) {
      await cache.put(key, fresh.clone());
      return fresh;
    }
    return (await cache.match(key)) || fresh;
  } catch (err) {
    const saved = await cache.match(key);
    if (saved) return saved;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.includes('/data/')) {
    e.respondWith(networkFirst(e.request, DATA));
    return;
  }
  if (e.request.mode === 'navigate') {
    // The page itself: always the latest when online, so a new version shows on first open.
    e.respondWith(networkFirst(e.request, SHELL, './'));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
