// Voice input: dictate directions, and hands-free answers during guidance ("yes", "haan", "skip", "repeat").
// Uses the phone's speech recognition service through Chrome (Google's engine on Android; works offline when the
// language's offline pack is installed). On-device Whisper (stt.js) is the automatic fallback.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceAvailable = !!SR;

// Newer Chrome builds can run Web Speech recognition on the device ("processLocally"), which also works offline.
export function localSpeechSupported() {
  try { return !!SR && 'processLocally' in new SR(); } catch { return false; }
}

const RECOG_LANG = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', ta: 'ta-IN', ml: 'ml-IN', bn: 'bn-IN', tanglish: 'ta-IN', hinglish: 'hi-IN', auto: 'en-IN' };
export const localeFor = (lang) => RECOG_LANG[lang] || 'en-IN';

// Chrome's on-device speech recognition (Google's models, downloaded per language, runs with no network).
// -> 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported' (this Chrome has no such API)
export async function localSpeechStatus(locale) {
  try {
    if (SR?.available) return await SR.available({ langs: [locale], processLocally: true });
    if (SR?.availableOnDevice) return await SR.availableOnDevice(locale); // earlier Chrome name
  } catch { return 'unavailable'; }
  return 'unsupported';
}
export async function installLocalSpeech(locale) {
  try {
    if (SR?.install) return !!(await SR.install({ langs: [locale], processLocally: true }));
    if (SR?.installOnDevice) return !!(await SR.installOnDevice(locale));
  } catch {}
  return false;
}

// One-shot dictation. onPartial gets the live transcript; resolves with the final text.
export function dictate(lang = 'en', onPartial, onState, { local = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!SR) return reject(new Error('speech recognition not available in this browser'));
    const r = new SR();
    r.lang = RECOG_LANG[lang] || 'en-IN';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    if (local) { if ('processLocally' in r) r.processLocally = true; else if ('mode' in r) r.mode = 'ondevice-only'; } // on-device, offline
    let text = '', finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(idle); resolve(text.trim()); };
    // Nothing recognised for 8 s: stop instead of waiting forever.
    let idle = setTimeout(() => { try { r.stop(); } catch {} setTimeout(finish, 800); }, 8000);
    r.onstart = () => onState?.('Mic on · speak now');
    r.onspeechstart = () => onState?.('Hearing you…');
    r.onresult = (e) => {
      clearTimeout(idle);
      idle = setTimeout(() => { try { r.stop(); } catch {} setTimeout(finish, 800); }, 4000);
      text = [...e.results].map((x) => x[0].transcript).join(' ');
      onPartial?.(text);
    };
    r.onerror = (e) => {
      if (finished) return;
      finished = true; clearTimeout(idle);
      const msg = { network: 'the phone speech engine has no offline pack for this language', 'no-speech': 'no speech heard', 'language-not-supported': 'language not installed in the phone speech engine', 'not-allowed': 'microphone permission is off for Chrome', 'service-not-allowed': 'phone speech engine not available' }[e.error] || e.error;
      reject(Object.assign(new Error(msg), { code: e.error }));
    };
    r.onend = finish;
    dictate.stop = () => { try { r.stop(); } catch {} setTimeout(finish, 1500); }; // Done always returns
    try { r.start(); } catch (err) { finished = true; reject(err); }
  });
}

const COMMANDS = {
  yes: /\b(yes|yeah|yep|correct|right one|haan|han|ha|ji|sahi|houdu|haudu|aamaa|ama|aama|okay|ok)\b/i,
  no: /\b(no|not yet|nahi|nahin|illa|alla|illai|wrong)\b/i,
  skip: /\b(skip|next|aage|mundhe|aduthu)\b/i,
  repeat: /\b(repeat|again|phir se|dobara|matte|marupadi)\b/i,
  stop: /\b(stop|cancel|ruko|nillisi|niruthu)\b/i,
};

export function commandOf(text) {
  for (const [cmd, re] of Object.entries(COMMANDS)) if (re.test(text)) return cmd;
  return null;
}

// Continuous listening for short commands while guiding. Restarts itself when Chrome ends a session.
export class CommandListener {
  constructor(onCommand, onHeard) {
    this.onCommand = onCommand;
    this.onHeard = onHeard;
    this.on = false;
  }
  start(lang = 'en') {
    if (!SR || this.on) return false;
    this.on = true;
    this.lang = lang;
    this._run();
    return true;
  }
  _run() {
    if (!this.on) return;
    const r = new SR();
    r.lang = RECOG_LANG[this.lang] || 'en-IN';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      const t = e.results[e.results.length - 1][0].transcript;
      this.onHeard?.(t);
      const c = commandOf(t);
      if (c) this.onCommand(c, t);
    };
    r.onerror = (e) => { if (['not-allowed', 'network', 'language-not-supported', 'service-not-allowed'].includes(e.error)) { this.on = false; this.onHeard?.('', e.error); } };
    r.onend = () => { if (this.on) setTimeout(() => this._run(), 300); };
    try { r.start(); this.r = r; } catch { this.on = false; }
  }
  stop() { this.on = false; try { this.r?.stop(); } catch {} }
}
