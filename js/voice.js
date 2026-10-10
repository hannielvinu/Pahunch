// Voice input: dictate directions, and hands-free answers during guidance ("yes", "haan", "skip", "repeat").
// Uses the phone's speech recognition service through Chrome (Google's engine on Android; works offline when the
// language's offline pack is installed). On-device Whisper (stt.js) is the automatic fallback.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceAvailable = !!SR;

const RECOG_LANG = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', ta: 'ta-IN', ml: 'ml-IN', tanglish: 'ta-IN', hinglish: 'hi-IN', auto: 'en-IN' };

// One-shot dictation. onPartial gets the live transcript; resolves with the final text.
export function dictate(lang = 'en', onPartial, onState) {
  return new Promise((resolve, reject) => {
    if (!SR) return reject(new Error('speech recognition not available in this browser'));
    const r = new SR();
    r.lang = RECOG_LANG[lang] || 'en-IN';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
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
    r.onerror = (e) => { if (finished) return; finished = true; clearTimeout(idle); reject(new Error(e.error === 'network' ? 'online speech needs internet (offline voice: run tools/get-whisper.sh)' : e.error === 'no-speech' ? 'no speech heard' : e.error)); };
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
    r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'network') { this.on = false; this.onHeard?.(`(voice off: ${e.error})`); } };
    r.onend = () => { if (this.on) setTimeout(() => this._run(), 300); };
    try { r.start(); this.r = r; } catch { this.on = false; }
  }
  stop() { this.on = false; try { this.r?.stop(); } catch {} }
}
