// Android's own speech recogniser via the local bridge (tools/stt-bridge.py + Termux:API): the engine Gboard
// uses, offline-capable, driven from the app's mic button. Words stream back as Server-Sent Events.

const BASE = 'http://localhost:8084';

export async function bridgeAvailable() {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(500) });
    return !!(await r.json()).ok;
  } catch { return false; }
}

// Android reports failures as text lines ("ERROR: ERROR_NO_MATCH"); they must never become the transcript.
const ERRORS = {
  ERROR_NO_MATCH: "Didn't catch that. Tap the mic and speak right after the beep.",
  ERROR_SPEECH_TIMEOUT: 'No speech heard. Tap the mic and speak right after the beep.',
  ERROR_NETWORK: "Android's recogniser needs the network: download the offline speech pack for this language.",
  ERROR_NETWORK_TIMEOUT: "Android's recogniser needs the network: download the offline speech pack for this language.",
  ERROR_SERVER: "Android's recogniser needs the network: download the offline speech pack for this language.",
  ERROR_LANGUAGE_UNAVAILABLE: 'Offline speech pack for this language is not installed.',
  ERROR_LANGUAGE_NOT_SUPPORTED: 'Offline speech pack for this language is not installed.',
  ERROR_INSUFFICIENT_PERMISSIONS: 'Termux:API has no microphone permission (Android Settings → Apps → Termux:API → Permissions).',
  ERROR_RECOGNIZER_BUSY: 'Speech recogniser busy. Try again in a second.',
};

// "ERROR: ERROR_NO_MATCH" -> 'ERROR_NO_MATCH'; normal text -> null.
export function androidError(line) {
  const m = /^\s*ERROR\b[:\s]*([A-Z_]*)/.exec(line || '');
  return m ? m[1] || 'ERROR' : null;
}
export const errorMessage = (code) => ERRORS[code] || `Android speech recogniser failed (${code}).`;

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
    let failed = null;
    es.onmessage = (e) => {
      const t = JSON.parse(e.data || '""');
      const code = androidError(t);
      if (code) { failed = code; return; }
      if (t) { last = t; onPartial?.(t); }
    };
    es.addEventListener('stterror', (e) => { failed = JSON.parse(e.data || '""') || 'ERROR'; });
    es.addEventListener('done', () => finish(failed && new Error(errorMessage(failed))));
    es.onerror = () => finish(new Error('speech bridge stopped'));
  });
  const stop = () => {
    fetch(`${BASE}/stop`).catch(() => {});
    setTimeout(() => finish?.(), 1500); // keep what was heard
  };
  return { stop, done };
}
