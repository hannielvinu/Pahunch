// Voice prompts (en/hi/kn/ta), vibration vocabulary and the compass turn detector.

const VOICE_LANG = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', ta: 'ta-IN' };

const TEXT = {
  en: {
    look: (x) => `Look for the ${x}.`, spotted: (x) => `${x} detected.`, now: 'Now', ask: (x) => `Is this the ${x}?`,
    turn: (o, d) => `Take the ${['', 'first', 'second', 'third', 'fourth'][o] || o} turn on the ${d}.`,
    turned: 'Turn confirmed.', arrived: (f) => `You have arrived.${f != null ? ` Floor ${f}.` : ''}`,
    left: 'left', right: 'right', dest: 'destination',
  },
  hi: {
    look: (x) => `${x} ढूंढिए।`, spotted: (x) => `${x} मिल गया।`, now: 'अब', ask: (x) => `क्या यह ${x} है?`,
    turn: (o, d) => `${['', 'पहली', 'दूसरी', 'तीसरी', 'चौथी'][o] || o} गली में ${d} मुड़िए।`,
    turned: 'मुड़ गए, बढ़िया।', arrived: (f) => `आप पहुँच गए।${f != null ? ` मंज़िल ${f}।` : ''}`,
    left: 'बाएं', right: 'दाएं', dest: 'मंज़िल',
  },
  kn: {
    look: (x) => `${x} ನೋಡಿ.`, spotted: (x) => `${x} ಸಿಕ್ಕಿತು.`, now: 'ಈಗ', ask: (x) => `ಇದು ${x} ಆ?`,
    turn: (o, d) => `${['', 'ಮೊದಲ', 'ಎರಡನೇ', 'ಮೂರನೇ', 'ನಾಲ್ಕನೇ'][o] || o} ರಸ್ತೆಯಲ್ಲಿ ${d} ತಿರುಗಿ.`,
    turned: 'ತಿರುಗಿದ್ದೀರಿ.', arrived: (f) => `ನೀವು ತಲುಪಿದ್ದೀರಿ.${f != null ? ` ಮಹಡಿ ${f}.` : ''}`,
    left: 'ಎಡಕ್ಕೆ', right: 'ಬಲಕ್ಕೆ', dest: 'ಸ್ಥಳ',
  },
  ta: {
    look: (x) => `${x} பாருங்கள்.`, spotted: (x) => `${x} கிடைத்தது.`, now: 'இப்போது', ask: (x) => `இது ${x} ஆ?`,
    turn: (o, d) => `${['', 'முதல்', 'இரண்டாவது', 'மூன்றாவது', 'நான்காவது'][o] || o} தெருவில் ${d} திரும்புங்கள்.`,
    turned: 'திரும்பிவிட்டீர்கள்.', arrived: (f) => `நீங்கள் வந்துவிட்டீர்கள்.${f != null ? ` மாடி ${f}.` : ''}`,
    left: 'இடது பக்கம்', right: 'வலது பக்கம்', dest: 'இடம்',
  },
};

export const text = (lang) => TEXT[lang] || TEXT.en;

let voices = [];
if ('speechSynthesis' in globalThis) {
  const load = () => (voices = speechSynthesis.getVoices());
  load();
  speechSynthesis.addEventListener?.('voiceschanged', load);
}

export function say(line, lang = 'en') {
  if (!('speechSynthesis' in globalThis)) return;
  const u = new SpeechSynthesisUtterance(line);
  u.lang = VOICE_LANG[lang] || 'en-IN';
  u.voice = voices.find((v) => v.lang.replace('_', '-') === u.lang) || null;
  u.rate = 1;
  // Chrome on Android can drop an utterance queued right after cancel(); only cancel when something is playing.
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    setTimeout(() => speechSynthesis.speak(u), 120);
  } else speechSynthesis.speak(u);
  say.last = { line, lang };
}

// Call from a tap: Chrome only lets a page talk after the user has interacted with it.
export function unlockSpeech() {
  if (!('speechSynthesis' in globalThis) || unlockSpeech.done) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
  unlockSpeech.done = true;
}

// Distinct patterns a rider can feel without looking: left = 2 taps, right = 3 taps,
// spotted = 1 tap, question = 2 long, arrived = long-short-long.
export const BUZZ = { left: [120, 90, 120], right: [120, 90, 120, 90, 120], spotted: [70], ask: [250, 120, 250], arrived: [450, 120, 150, 120, 450] };
export const buzz = (name) => navigator.vibrate?.(BUZZ[name] || 0);

// ---------- Compass ----------
// Heading from the absolute orientation sensor; a turn counts once the delta settles in 55-125 deg for 0.7 s.

export class Compass {
  constructor() {
    this.heading = null;
    this.onChange = null;
    this._h = (e) => {
      if (e.alpha == null) return;
      this.heading = (360 - e.alpha) % 360;
      this.onChange?.(this.heading);
    };
  }
  start() {
    const evt = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(evt, this._h);
    this.evt = evt;
  }
  stop() { if (this.evt) window.removeEventListener(this.evt, this._h); }
}

export class TurnDetector {
  constructor(compass, want, onTurn) {
    this.compass = compass;
    this.want = want;
    this.onTurn = onTurn;
    this.start = compass.heading;
    this.since = null;
  }
  // Signed change in heading since the step began: + is clockwise (right), - is left.
  get delta() {
    if (this.start == null || this.compass.heading == null) return null;
    return ((this.compass.heading - this.start + 540) % 360) - 180;
  }
  tick(now = performance.now()) {
    if (this.start == null) { this.start = this.compass.heading; return; }
    const d = this.delta;
    if (d == null) return;
    const ok = this.want === 'right' ? d >= 55 && d <= 125 : d <= -55 && d >= -125;
    if (!ok) { this.since = null; return; }
    this.since ??= now;
    if (now - this.since >= 700) { this.onTurn(); this.onTurn = () => {}; }
  }
}
