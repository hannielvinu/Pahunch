// Network-first for app files (always fresh from the phone's localhost server), cache fallback so the
// installed app still opens if the server isn't running. Models are cached by transformers.js itself.
const CACHE = 'pahunch-v49';
const SHELL = ['./', 'index.html', 'css/app.css', 'css/theme.css', 'js/detector.js', 'js/guard.js', 'js/stt.js', 'js/askcard.js', 'js/native.js', 'js/scene.js', 'js/androidstt.js', 'partner.html', 'js/sensors.js', 'js/voice.js', 'js/overlay.js', 'js/netmeter.js', 'js/digipin.js', 'js/doorcard.js', 'lib/fonts/inter.woff2', 'lib/fonts/jakarta.woff2', 'js/app.js', 'js/parser.js', 'js/vision.js', 'js/guide.js', 'js/device.js', 'js/llm.js', 'lib/qrcode/qrcode.js', 'manifest.webmanifest', 'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'lib/tesseract/tesseract.min.js', 'lib/tesseract/worker.min.js', 'lib/lang/eng.traineddata'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
// Old caches are dropped so an earlier version can never be mixed with this one.
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Share target (manifest): a voice note or text shared from WhatsApp or any app. Kept in a small cache for the
  // page to pick up, then the app opens on #shared. Nothing leaves the phone.
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const c = await caches.open('pahunch-share');
        const file = [...form.getAll('audio'), ...form.getAll('file')].find((f) => f && f.size);
        if (file) await c.put('shared-audio', new Response(file, { headers: { 'Content-Type': file.type || 'audio/ogg' } }));
        const t = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join(' ');
        if (t) await c.put('shared-text', new Response(t));
      } catch {}
      return Response.redirect('./index.html#shared', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/models/')) return;
  e.respondWith(fetch(e.request, { cache: 'no-store' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});
