// Network meter: counts every resource the page loads from anywhere other than this phone (localhost),
// using the browser's own Resource Timing entries. The app server (8080) and llama.cpp (8081) are local.
// Blind spot: requests made inside Web Workers (Tesseract) have their own timeline and are not seen here;
// the OCR worker only loads files from localhost.

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isOffDevice(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !LOCAL.has(u.hostname);
  } catch { return false; }
}

// transferSize is the real wire size (0 when served from cache); cross-origin servers without
// Timing-Allow-Origin report 0 sizes, so the request count is shown too.
export function tally(entries, into = { requests: 0, bytes: 0 }) {
  for (const e of entries) {
    if (!isOffDevice(e.name)) continue;
    into.requests++;
    into.bytes += e.transferSize || e.encodedBodySize || 0;
  }
  return into;
}

export function formatBytes(n) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

export function startNetMeter(onChange) {
  const total = { requests: 0, bytes: 0 };
  onChange(total);
  if (!('PerformanceObserver' in globalThis)) return total;
  try {
    new PerformanceObserver((list) => {
      const before = total.requests;
      tally(list.getEntries(), total);
      if (total.requests !== before) onChange(total);
    }).observe({ type: 'resource', buffered: true });
  } catch {}
  return total;
}
