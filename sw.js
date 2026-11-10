// Lets the app open with no internet. Only caches the app's own files – never your data.
// Network first, so updates published to GitHub show up the next time you open the app online.

const CACHE = 'my-budget-v5';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/ui.js',
  './js/calc.js',
  './js/money.js',
  './js/dates.js',
  './js/store.js',
  './js/state.js',
  './js/ops.js',
  './js/budget.js',
  './js/recurring.js',
  './js/calendar.js',
  './js/components.js',
  './js/sheets/entry.js',
  './js/sheets/welcome.js',
  './js/views/home.js',
  './js/views/activity.js',
  './js/views/goals.js',
  './js/views/reminders.js',
  './js/views/recap.js',
  './js/crypto.js',
  './js/motion.js',
  './js/vault.js',
  './js/lock.js',
  './js/backup.js',
  './js/sheets/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
