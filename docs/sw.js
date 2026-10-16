// Offline app shell: the app opens even without connection; scans wait in the device queue.
const CACHE = 'stockcount-v5' + self.registration.scope;
const SHELL = ['./', 'index.html', 'app.css?v=4', 'config.js?v=4', 'app.js?v=4', 'excel.js?v=4', 'admin.js?v=4', 'vendor/html5-qrcode.min.js', 'vendor/exceljs.min.js', 'manifest.json', 'icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k.indexOf(self.registration.scope) >= 0 || k === 'stockcount-v2').map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // never touch API calls
  e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
    .catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
});
