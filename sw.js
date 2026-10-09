// Network-first for app files (always fresh from the phone's localhost server), cache fallback so the
// installed app still opens if the server isn't running. Models are cached by transformers.js itself.
const CACHE = 'pahunch-v2';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/parser.js', 'js/vision.js', 'js/guide.js', 'js/device.js', 'js/llm.js', 'js/digipin.js', 'js/doorcard.js', 'lib/qrcode/qrcode.js', 'manifest.webmanifest', 'icons/icon.svg',
  'lib/tesseract/tesseract.min.js', 'lib/tesseract/worker.min.js', 'lib/lang/eng.traineddata'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/models/')) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});
