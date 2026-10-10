// The Pahunch Android app (android/) hosts this page and lends it the phone's own abilities:
// Android's speech recogniser (Google's, on-device with the offline language packs, the engine Gboard uses),
// text-to-speech, and satellite GPS that works in airplane mode. In Chrome `app` is null and the web paths run.

export const app = globalThis.PahunchNative || null;

const subs = {};
globalThis.__pahunch = (type, data) => { for (const f of subs[type] || []) { try { f(data); } catch (e) { console.warn(e); } } };
export function on(type, f) {
  (subs[type] ||= []).push(f);
  return () => { subs[type] = subs[type].filter((x) => x !== f); };
}

export const appInfo = (() => { try { return app ? JSON.parse(app.info()) : null; } catch { return null; } })();

const LOCALE = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN', kn: 'kn-IN', ml: 'ml-IN', tanglish: 'ta-IN', hinglish: 'hi-IN', auto: 'en-IN' };
export const localeOf = (lang) => LOCALE[lang] || 'en-IN';

const PACK = "This language's offline voice pack isn't on the phone yet. Connect once and download it in Voice settings.";
export const SPEECH_ERR = {
  NETWORK: PACK, NETWORK_TIMEOUT: PACK, SERVER: PACK, SERVER_DISCONNECTED: PACK, LANGUAGE_NOT_SUPPORTED: PACK, LANGUAGE_UNAVAILABLE: PACK,
  NO_MATCH: 'Didn’t catch that. Tap the mic and speak.', SPEECH_TIMEOUT: 'No speech heard. Tap the mic and speak.',
  INSUFFICIENT_PERMISSIONS: 'Allow the microphone for Pahunch (Android Settings → Apps → Pahunch).',
  RECOGNIZER_BUSY: 'Speech engine busy. Try again in a second.', AUDIO: 'Microphone busy. Try again.',
  NO_RECOGNIZER: 'No speech recogniser on this phone: install "Speech Services by Google".',
};

// Engine names for the screen, honestly: Google's recogniser, on the phone.
export const engineName = (engine) => (engine === 'on-device' ? 'Google speech · on this phone' : navigator.onLine ? 'Google speech' : 'Google speech · offline');

// One dictation: { stop(), done: Promise<{ text, engine }> }. Partial words stream to onPartial.
export function appListen(lang, { onPartial, onState, onLevel } = {}) {
  let off, finish, text = '', engine = '';
  const done = new Promise((resolve, reject) => {
    const cap = setTimeout(() => { app.stop(); setTimeout(() => finish(), 1500); }, 30000);
    finish = (err) => {
      if (!off) return;
      clearTimeout(cap); off(); off = null;
      if (text) resolve({ text, engine });
      else reject(err || Object.assign(new Error(SPEECH_ERR.NO_MATCH), { code: 'NO_MATCH' }));
    };
    off = on('speech', (d) => {
      if (d.engine) engine = d.engine;
      if (d.type === 'ready') onState?.('ready', engine);
      else if (d.type === 'start') onState?.('hearing', engine);
      else if (d.type === 'level') onLevel?.(+d.db);
      else if (d.type === 'partial') { text = d.text; onPartial?.(text); }
      else if (d.type === 'final') { text = d.text || text; finish(); }
      else if (d.type === 'error') finish(Object.assign(new Error(SPEECH_ERR[d.code] || `Speech: ${d.code}`), { code: d.code }));
    });
  });
  app.listen(localeOf(lang));
  return { stop: () => { app.stop(); setTimeout(() => finish?.(), 2500); }, done };
}

// Which languages have an offline pack (Android 13+): resolves { known, installed[], pending[], supported[] }.
export function offlinePacks(lang = 'en-IN') {
  if (!app) return Promise.resolve({ known: false });
  return new Promise((resolve) => {
    const off = on('languages', (d) => { off(); resolve({ known: d.known === true, installed: d.installed || [], pending: d.pending || [], supported: d.supported || [] }); });
    setTimeout(() => { off(); resolve({ known: false }); }, 4000);
    app.languages(lang);
  });
}

export function appLocation() {
  try { const s = app?.location(); return s ? JSON.parse(s) : null; } catch { return null; }
}
