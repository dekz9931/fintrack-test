// sw.js — MOD-019 offline start (ARC-001). App files are cached per release; a new release
// replaces the cache and the old one is deleted (F-27). Supabase calls are never cached.
const VERSION = '0.5.0';
const CACHE = `fintrack-v${VERSION}`;
const FILES = [
  './', './index.html', './styles.css', './config.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './vendor/supabase-2.117.3.js',
  './app/shell.js', './app/nav.js', './app/data.js', './app/outbox.js', './app/session.js', './app/format.js',
  './app/checks.js', './app/ui.js',
  './app/screens/signin.js', './app/screens/setup.js', './app/screens/forms.js', './app/screens/home.js',
  './app/screens/add.js', './app/screens/transactions.js', './app/screens/settings.js', './app/screens/more.js',
  './app/screens/later.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fintrack-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Network first for the page itself (sign-in returns with ?code=…); cached copy when offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
