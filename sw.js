// Network-first for app files (always fresh from the phone's localhost server), cache fallback so the
// installed app still opens if the server isn't running. Models are cached by transformers.js itself.
const CACHE = 'pahunch-v23';
const SHELL = ['./', 'index.html', 'css/app.css', 'css/theme.css', 'js/detector.js', 'js/guard.js', 'js/stt.js', 'js/native.js', 'js/scene.js', 'js/sensors.js', 'js/voice.js', 'js/overlay.js', 'js/netmeter.js', 'js/digipin.js', 'js/doorcard.js', 'lib/fonts/inter.woff2', 'lib/fonts/jakarta.woff2', 'js/app.js', 'js/parser.js', 'js/vision.js', 'js/guide.js', 'js/device.js', 'js/llm.js', 'lib/qrcode/qrcode.js', 'manifest.webmanifest', 'icons/logo.svg', 'lib/tesseract/tesseract.min.js', 'lib/tesseract/worker.min.js', 'lib/lang/eng.traineddata'];

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
