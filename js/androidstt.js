// Android's own speech recogniser via the local bridge (tools/stt-bridge.py + Termux:API): the engine Gboard
// uses, offline-capable, driven from the app's mic button. Words stream back as Server-Sent Events.

const BASE = 'http://localhost:8084';

export async function bridgeAvailable() {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(500) });
    return !!(await r.json()).ok;
  } catch { return false; }
}

// -> { stop(), done: Promise<string> } ; onPartial gets each partial / final line as it arrives.
export function bridgeListen({ onPartial } = {}) {
  let es, last = '', finish;
  const done = new Promise((resolve, reject) => {
    finish = (err) => {
      if (!es) return;
      es.close(); es = null;
      clearTimeout(cap);
      if (last) resolve(last); else reject(err || new Error('no speech heard'));
    };
    const cap = setTimeout(() => finish(), 20000); // never wait forever
    es = new EventSource(`${BASE}/listen`);
    es.onmessage = (e) => {
      const t = JSON.parse(e.data || '""');
      if (t) { last = t; onPartial?.(t); }
    };
    es.addEventListener('done', () => finish());
    es.onerror = () => finish(new Error('speech bridge stopped'));
  });
  const stop = () => {
    fetch(`${BASE}/stop`).catch(() => {});
    setTimeout(() => finish?.(), 1500); // keep what was heard
  };
  return { stop, done };
}
