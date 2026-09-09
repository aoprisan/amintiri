// Stamped with the commit SHA by .github/workflows/deploy.yml, so every deploy
// lands on an installed client. Keep this line's shape — the workflow sed's it.
const CACHE = 'absolvire-v2';
// Fonts are versioned by URL and never change, so they survive a deploy.
const FONTS = 'absolvire-fonts';

// Without these the app cannot boot offline, so a failure here fails the install.
const CORE = [
  './', 'index.html', 'app.js', 'store.js', 'config.js', 'manifest.webmanifest',
  // The download lives on the same shelf as the album itself: a family that
  // opened it once should be able to take a copy home with no network.
  'zip.js', 'pdf.js', 'export.js',
];
// Nice to have offline; a miss must not cost us the whole service worker.
const EXTRA = [
  'icon.svg', 'icon-192.png', 'icon-512.png',
  'icon-maskable-192.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
];

const isFont = url =>
  url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

// Absolute URLs of everything we are willing to keep. Anything else same-origin
// — the API when API_BASE points at this host, and the photos it serves — goes
// to the network: the album must not serve a stale classmate list, and a cache
// holding every uploaded photo would grow without a bound.
const SHELL = new Set(
  CORE.concat(EXTRA).map(p => new URL(p, self.registration.scope).href)
);

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(async c => {
    await c.addAll(CORE);
    await Promise.allSettled(EXTRA.map(u => c.add(u)));
  })
));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(ks => Promise.all(
      ks.filter(k => k.startsWith('absolvire-') && k !== CACHE && k !== FONTS)
        .map(k => caches.delete(k))
    ))
    .then(() => self.clients.claim())
));

// The new worker waits rather than taking over mid-edit — a half-filled form
// with a photo and a recording in it is not worth a seamless update. The page
// asks for the swap once the user accepts the "new version" prompt.
self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

// Cache first — and deliberately so. A deploy changes index.html and app.js
// together, so serving a fresh page against a cached script would break the
// app in ways neither file shows on its own. Everything therefore comes from
// one cache generation, and a new deploy arrives whole: a new worker installs
// its own cache alongside this one, and the page swaps to it only when the
// reader accepts the update prompt.
async function navigate(e) {
  // Scoped to this worker's own cache: an unqualified caches.match() would
  // happily return the page a newer, still-waiting worker has just installed.
  const c = await caches.open(CACHE);
  const cached = await c.match('index.html');
  if (cached) return cached;
  try {
    return await fetch(e.request);
  } catch {
    return new Response(
      '<!doctype html><meta charset=utf-8><title>Offline</title>' +
      '<p style="font:1rem system-ui;padding:2rem">Albumul nu e disponibil offline încă. ' +
      'Deschide-l o dată cât ai internet.</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
    );
  }
}

// Shell assets are served from the cache the active worker installed, never
// refreshed behind its back, so they always match the page above.
async function fromShell(request) {
  const c = await caches.open(CACHE);
  const hit = await c.match(request);
  if (hit) return hit;
  // A miss means install skipped it (the optional icons); fetch and keep it.
  const res = await fetch(request);
  if (res.ok) c.put(request, res.clone());
  return res;
}

// Fonts are the one thing worth refreshing in place: they sit in their own
// cache, outlive every deploy, and a stale stylesheet costs nothing.
async function staleWhileRevalidate(request, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(request);
  const fresh = fetch(request)
    .then(res => { if (res.ok || res.type === 'opaque') c.put(request, res.clone()); return res; })
    .catch(() => null);
  return hit || (await fresh) || Response.error();
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  if (e.request.mode === 'navigate') return e.respondWith(navigate(e));

  // Google Fonts: cached so the album keeps its handwriting offline.
  if (isFont(url)) return e.respondWith(staleWhileRevalidate(e.request, FONTS));

  // Everything else — the backend in API_BASE above all — is left to the network.
  if (SHELL.has(url.href)) e.respondWith(fromShell(e.request));
});
