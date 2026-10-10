// Voice prompts (en/hi/kn/ta), vibration vocabulary and the compass turn detector.

const VOICE_LANG = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', ta: 'ta-IN', ml: 'ml-IN', bn: 'bn-IN' };

// Spoken guidance, colloquial (how a person on the phone would guide you), in the rider's language.
// intro + straight start the route; spotted + now + next instruction are spoken as one sentence.
const TEXT = {
  en: {
    intro: "Okay, let's go.", straight: 'First, go straight.',
    look: (x) => `Look out for the ${x}.`, spotted: (x) => `Yes, that's the ${x}.`, ask: (x) => `Is this the ${x}?`,
    turn: (o, d) => `Take the ${['', 'first', 'second', 'third', 'fourth'][o] || o} turn on the ${d}.`,
    turned: "Good, you've turned.", arrived: (f) => `You've reached. This is the door.${f != null ? ` Floor ${f === 0 ? 'ground' : f}.` : ''}`,
    now: 'Now', left: 'left', right: 'right', dest: 'destination',
  },
  hi: {
    intro: 'ठीक है, चलिए।', straight: 'पहले सीधा जाइए।',
    look: (x) => `${x} देखते रहिए।`, spotted: (x) => `हाँ, सही है, ${x} आ गया।`, ask: (x) => `क्या यही ${x} है?`,
    turn: (o, d) => `${['', 'पहली', 'दूसरी', 'तीसरी', 'चौथी'][o] || o} गली में ${d} मुड़िए।`,
    turned: 'बढ़िया, मुड़ गए।', arrived: (f) => `पहुँच गए! यही दरवाज़ा है।${f != null ? ` ${f === 0 ? 'ग्राउंड फ़्लोर' : `${f} मंज़िल`}।` : ''}`,
    now: 'अब', left: 'बाएं', right: 'दाएं', dest: 'मंज़िल',
  },
  ta: {
    intro: 'சரி, இந்த ரூட்ல போலாம்.', straight: 'முதல்ல நேரா போங்க.',
    look: (x) => `${x} வருதான்னு பாருங்க.`, spotted: (x) => `ஆமா, கரெக்ட்! ${x} வந்துடுச்சு.`, ask: (x) => `இது தான் ${x}-ஆ?`,
    turn: (o, d) => `${['', 'முதல்', 'ரெண்டாவது', 'மூணாவது', 'நாலாவது'][o] || o} தெருவுல ${d} திரும்புங்க.`,
    turned: 'சூப்பர், திரும்பிட்டீங்க.', arrived: (f) => `வந்துட்டீங்க! இதுதான் வீடு.${f != null ? ` ${f === 0 ? 'கீழ் தளம்' : `${f}வது மாடி`}.` : ''}`,
    now: 'இப்போ', left: 'லெஃப்ட்', right: 'ரைட்', dest: 'இடம்',
  },
  kn: {
    intro: 'ಸರಿ, ಹೋಗೋಣ.', straight: 'ಮೊದಲು ನೇರವಾಗಿ ಹೋಗಿ.',
    look: (x) => `${x} ನೋಡ್ತಾ ಇರಿ.`, spotted: (x) => `ಹೌದು, ಸರಿ! ${x} ಬಂತು.`, ask: (x) => `ಇದೇನಾ ${x}?`,
    turn: (o, d) => `${['', 'ಮೊದಲ', 'ಎರಡನೇ', 'ಮೂರನೇ', 'ನಾಲ್ಕನೇ'][o] || o} ರಸ್ತೇಲಿ ${d} ತಿರುಗಿ.`,
    turned: 'ಸೂಪರ್, ತಿರುಗಿದ್ರಿ.', arrived: (f) => `ಬಂದ್ಬಿಟ್ರಿ! ಇದೇ ಮನೆ.${f != null ? ` ${f === 0 ? 'ನೆಲ ಮಹಡಿ' : `${f}ನೇ ಮಹಡಿ`}.` : ''}`,
    now: 'ಈಗ', left: 'ಎಡಕ್ಕೆ', right: 'ಬಲಕ್ಕೆ', dest: 'ಸ್ಥಳ',
  },
  ml: {
    intro: 'ശരി, പോകാം.', straight: 'ആദ്യം നേരെ പോകൂ.',
    look: (x) => `${x} നോക്കിക്കോളൂ.`, spotted: (x) => `അതെ, ശരിയാണ്! ${x} എത്തി.`, ask: (x) => `ഇതാണോ ${x}?`,
    turn: (o, d) => `${['', 'ഒന്നാമത്തെ', 'രണ്ടാമത്തെ', 'മൂന്നാമത്തെ', 'നാലാമത്തെ'][o] || o} റോഡിൽ ${d} തിരിയൂ.`,
    turned: 'കൊള്ളാം, തിരിഞ്ഞു.', arrived: (f) => `എത്തി! ഇതാണ് വീട്.${f != null ? ` ${f === 0 ? 'താഴത്തെ നില' : `${f}-ാം നില`}.` : ''}`,
    now: 'ഇനി', left: 'ഇടത്തോട്ട്', right: 'വലത്തോട്ട്', dest: 'സ്ഥലം',
  },
  bn: {
    intro: 'ঠিক আছে, চলুন।', straight: 'প্রথমে সোজা যান।',
    look: (x) => `${x} দেখতে থাকুন।`, spotted: (x) => `হ্যাঁ, ঠিক আছে! ${x} এসে গেছে।`, ask: (x) => `এটাই কি ${x}?`,
    turn: (o, d) => `${['', 'প্রথম', 'দ্বিতীয়', 'তৃতীয়', 'চতুর্থ'][o] || o} গলিতে ${d} ঘুরুন।`,
    turned: 'দারুণ, ঘুরে গেছেন।', arrived: (f) => `পৌঁছে গেছেন! এটাই দরজা।${f != null ? ` ${f === 0 ? 'গ্রাউন্ড ফ্লোর' : `${f} তলা`}।` : ''}`,
    now: 'এবার', left: 'বাঁদিকে', right: 'ডানদিকে', dest: 'গন্তব্য',
  },
};

export const text = (lang) => TEXT[lang] || TEXT.en;

let voices = [];
if ('speechSynthesis' in globalThis) {
  const load = () => (voices = speechSynthesis.getVoices());
  load();
  speechSynthesis.addEventListener?.('voiceschanged', load);
}

function bestVoice(lang) {
  const base = lang.split('-')[0];
  let best = null, top = -1;
  for (const v of voices) {
    const l = v.lang.replace('_', '-');
    const s = (l === lang ? 4 : l.startsWith(base) ? 2 : -9) + (/google/i.test(v.name) ? 1 : 0) + (v.localService ? 1 : 0) + (/female|network|enhanced|natural/i.test(v.name) ? 0.5 : 0);
    if (s > top) { top = s; best = v; }
  }
  return top > 0 ? best : null;
}

export function say(line, lang = 'en') {
  if (!('speechSynthesis' in globalThis)) return;
  const u = new SpeechSynthesisUtterance(line);
  u.lang = VOICE_LANG[lang] || 'en-IN';
  u.voice = bestVoice(u.lang);
  u.rate = 0.96;
  u.pitch = 1;
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

// Landmark words in the rider's language, so a Tamil sentence says "நீல கேட்", not "blue gate".
const LOCAL = {
  bn: { temple: 'মন্দির', pharmacy: 'মেডিকেল', gate: 'গেট', house: 'বাড়ি', store: 'দোকান', bus_stop: 'বাস স্টপ', school: 'স্কুল', hospital: 'হাসপাতাল', bank: 'ব্যাংক', petrol: 'পেট্রোল পাম্প', park: 'পার্ক', mosque: 'মসজিদ', church: 'গির্জা', apartment: 'অ্যাপার্টমেন্ট',
    blue: 'নীল', red: 'লাল', green: 'সবুজ', yellow: 'হলুদ', white: 'সাদা', black: 'কালো', orange: 'কমলা', pink: 'গোলাপি', brown: 'বাদামি', grey: 'ধূসর' },
  hi: { temple: 'मंदिर', pharmacy: 'मेडिकल', gate: 'गेट', house: 'घर', store: 'दुकान', bus_stop: 'बस स्टॉप', school: 'स्कूल', hospital: 'अस्पताल', bank: 'बैंक', petrol: 'पेट्रोल पंप', park: 'पार्क', mosque: 'मस्जिद', church: 'चर्च', apartment: 'अपार्टमेंट',
    blue: 'नीला', red: 'लाल', green: 'हरा', yellow: 'पीला', white: 'सफ़ेद', black: 'काला', orange: 'नारंगी', pink: 'गुलाबी', brown: 'भूरा', grey: 'स्लेटी' },
  ta: { temple: 'கோவில்', pharmacy: 'மெடிக்கல்', gate: 'கேட்', house: 'வீடு', store: 'கடை', bus_stop: 'பஸ் ஸ்டாப்', school: 'ஸ்கூல்', hospital: 'ஆஸ்பத்திரி', bank: 'பேங்க்', petrol: 'பெட்ரோல் பங்க்', park: 'பார்க்', mosque: 'மசூதி', church: 'சர்ச்', apartment: 'அபார்ட்மென்ட்',
    blue: 'நீல', red: 'சிவப்பு', green: 'பச்சை', yellow: 'மஞ்சள்', white: 'வெள்ளை', black: 'கருப்பு', orange: 'ஆரஞ்சு', pink: 'பிங்க்', brown: 'பிரவுன்', grey: 'சாம்பல்' },
  kn: { temple: 'ದೇವಸ್ಥಾನ', pharmacy: 'ಮೆಡಿಕಲ್', gate: 'ಗೇಟ್', house: 'ಮನೆ', store: 'ಅಂಗಡಿ', bus_stop: 'ಬಸ್ ಸ್ಟಾಪ್', school: 'ಶಾಲೆ', hospital: 'ಆಸ್ಪತ್ರೆ', bank: 'ಬ್ಯಾಂಕ್', petrol: 'ಪೆಟ್ರೋಲ್ ಬಂಕ್', park: 'ಪಾರ್ಕ್', mosque: 'ಮಸೀದಿ', church: 'ಚರ್ಚ್', apartment: 'ಅಪಾರ್ಟ್‌ಮೆಂಟ್',
    blue: 'ನೀಲಿ', red: 'ಕೆಂಪು', green: 'ಹಸಿರು', yellow: 'ಹಳದಿ', white: 'ಬಿಳಿ', black: 'ಕಪ್ಪು', orange: 'ಕಿತ್ತಳೆ', pink: 'ಗುಲಾಬಿ', brown: 'ಕಂದು', grey: 'ಬೂದು' },
  ml: { temple: 'ക്ഷേത്രം', pharmacy: 'മെഡിക്കൽ', gate: 'ഗേറ്റ്', house: 'വീട്', store: 'കട', bus_stop: 'ബസ് സ്റ്റോപ്പ്', school: 'സ്കൂൾ', hospital: 'ആശുപത്രി', bank: 'ബാങ്ക്', petrol: 'പെട്രോൾ പമ്പ്', park: 'പാർക്ക്', mosque: 'പള്ളി', church: 'പള്ളി', apartment: 'അപ്പാർട്ട്മെന്റ്',
    blue: 'നീല', red: 'ചുവന്ന', green: 'പച്ച', yellow: 'മഞ്ഞ', white: 'വെള്ള', black: 'കറുത്ത', orange: 'ഓറഞ്ച്', pink: 'പിങ്ക്', brown: 'തവിട്ട്', grey: 'ചാര' },
};

export function localName(lm, lang = 'en') {
  if (!lm) return text(lang).dest;
  const L = LOCAL[lang] || {};
  const type = lm.type === 'other' || (lm.name && (lm.type === 'sign' || lm.type === 'desk')) ? '' : L[lm.type] || lm.type.replace('_', ' ');
  return [lm.colour ? L[lm.colour] || lm.colour : '', lm.name, type].filter(Boolean).join(' ');
}
