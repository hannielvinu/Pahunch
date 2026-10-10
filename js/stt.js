// Offline speech-to-text: records the microphone in the page and sends 16 kHz WAV to whisper.cpp's server
// running in Termux on this phone (localhost:8082). Whisper detects the language itself.
//  - live: re-transcribes the audio so far every ~2 s (original language) for the on-screen transcript
//  - final: one pass with translate=true, so the route parser gets English whatever was spoken
// The analyser feeds a real waveform; recording stops by itself after ~1.6 s of silence.

const URL_STT = 'http://localhost:8082/inference';   // accurate (small): final pass
const URL_LIVE = 'http://localhost:8083/inference';  // fast (base): live transcript, optional
const MAX_S = 15;                                        // matches -ac 768 on the server

export async function sttAvailable() {
  try { await fetch('http://localhost:8082/', { signal: AbortSignal.timeout(500) }); return true; } catch { return false; }
}

function toWav16k(chunks, rate, lastSeconds = MAX_S) {
  let all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  const keep = Math.floor(lastSeconds * rate);
  if (all.length > keep) all = all.subarray(all.length - keep);
  const len = all.length;
  const ratio = rate / 16000, n = Math.floor(len / ratio);
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    // average the source samples that fall into this output sample (simple low-pass + decimate)
    const a = Math.floor(i * ratio), b = Math.min(len, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let k = a; k < b; k++) s += all[k];
    s = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Vocabulary hints per language: steer recognition towards direction words (Whisper "initial prompt").
export const SPEECH_LANGS = {
  auto: { label: 'Auto', prompt: 'Directions: go straight, turn left, turn right, second cross, temple, mandir, kovil, pharmacy, opposite, saamne, blue gate, second floor.' },
  // Code-mixed speech, written in Latin letters (how most people actually give directions).
  tanglish: { label: 'Tanglish', code: 'en', prompt: 'Straight-ah po, left cut pannu, right cut pannu, rendavathu theru, kovil thandi, medical kadai ethire, neela gate veedu, second floor.' },
  hinglish: { label: 'Hinglish', code: 'en', prompt: 'Seedha aao, left lo, right mudo, doosri gali, mandir ke baad, medical ke saamne, neela gate wala ghar, doosri manzil.' },
  en: { label: 'English', prompt: 'Directions: go straight, turn left, turn right, second lane, temple, pharmacy, blue gate, opposite, next to.' },
  hi: { label: 'हिन्दी', prompt: 'रास्ता: सीधा आइए, बाएं मुड़िए, दाएं मुड़िए, दूसरी गली, मंदिर, नीला गेट, सामने, बगल में.' },
  ta: { label: 'தமிழ்', prompt: 'வழி: நேராக வாங்க, இடது பக்கம் திரும்புங்க, வலது பக்கம், இரண்டாவது தெரு, கோவில், நீல கேட், எதிரே.' },
  kn: { label: 'ಕನ್ನಡ', prompt: 'ದಾರಿ: ನೇರವಾಗಿ ಬನ್ನಿ, ಎಡಕ್ಕೆ ತಿರುಗಿ, ಬಲಕ್ಕೆ, ಎರಡನೇ ಕ್ರಾಸ್, ದೇವಸ್ಥಾನ, ನೀಲಿ ಗೇಟ್, ಎದುರು.' },
  ml: { label: 'മലയാളം', prompt: 'വഴി: നേരെ വരൂ, ഇടത്തോട്ട് തിരിയുക, വലത്തോട്ട്, രണ്ടാമത്തെ റോഡ്, ക്ഷേത്രം, നീല ഗേറ്റ്, എതിരെ.' },
};

async function transcribe(wav, translate, ms = 20000, url = URL_STT, lang = 'auto') {
  const f = new FormData();
  f.append('file', wav, 'speech.wav');
  f.append('temperature', '0');
  f.append('response_format', 'json');
  if (translate) f.append('translate', 'true');
  f.append('language', SPEECH_LANGS[lang] ? SPEECH_LANGS[lang].code || lang : 'auto'); // a known language beats auto-detect
  if (SPEECH_LANGS[lang]?.prompt) f.append('prompt', SPEECH_LANGS[lang].prompt);
  const r = await fetch(url, { method: 'POST', body: f, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`speech server ${r.status}`);
  const j = await r.json();
  return (j.text || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(); // drop [BLANK_AUDIO], (music)…
}

// opts: { canvas, onPartial(text), onLevel(0..1) } -> { stop(), done: Promise<{ text, original, ms }> }
export function listen({ canvas, onPartial, onState, getLang = () => 'auto' } = {}) {
  let stopFn;
  const done = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    src.connect(analyser);
    src.connect(proc);
    proc.connect(ctx.destination);
    let stopped = false, spoke = false, quietSince = 0, busy = false, lastLive = 0, original = '';
    const startedAt = performance.now();
    const live = await fetch('http://localhost:8083/', { signal: AbortSignal.timeout(400) }).then(() => true, () => false);
    proc.onaudioprocess = (e) => { if (!stopped) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };

    // Real waveform from the microphone
    const g = canvas?.getContext('2d'), data = new Uint8Array(analyser.fftSize);
    let raf;
    const draw = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const x of data) sum += ((x - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / data.length), now = performance.now();
      if (rms > 0.04) { spoke = true; quietSince = 0; } else if (spoke && !quietSince) quietSince = now;
      if ((spoke && quietSince && now - quietSince > 1500) || now - startedAt > MAX_S * 1000) stopFn();
      if (g) {
        const W = (canvas.width = canvas.clientWidth * devicePixelRatio), H = (canvas.height = canvas.clientHeight * devicePixelRatio);
        g.clearRect(0, 0, W, H);
        g.lineWidth = 3 * devicePixelRatio;
        g.strokeStyle = getComputedStyle(canvas).color || '#e23744';
        g.beginPath();
        for (let i = 0; i < data.length; i += 4) {
          const x = (i / data.length) * W, y = H / 2 + ((data[i] - 128) / 128) * H * 1.6;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
      // Live transcript every ~2 s while talking (skipped if the last request is still running)
      // Live transcript only from the fast server (never queue work in front of the final pass).
      if (live && spoke && !busy && now - lastLive > 1200 && chunks.length > 4) {
        busy = true; lastLive = now;
        transcribe(toWav16k(chunks, ctx.sampleRate, 10), false, 8000, URL_LIVE, getLang()).then((t) => { if (t && !stopped) { original = t; onPartial?.(t); } }).catch(() => {}).finally(() => (busy = false));
      }
      if (!stopped) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    await new Promise((resolve) => { stopFn = resolve; setTimeout(resolve, MAX_S * 1000 + 500); });
    stopped = true;
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    proc.disconnect(); src.disconnect();
    const wav = toWav16k(chunks, ctx.sampleRate);
    ctx.close();
    if (!spoke) return { text: '', original: '', ms: 0 };
    onState?.('Transcribing on this phone…');
    const t0 = performance.now();
    // One final pass in English (for the parser); the live transcript already holds the original words.
    let english = '';
    const lang = getLang();
    // Original words (for the screen) and English (for the parser); English input needs only one pass.
    try {
      if ((SPEECH_LANGS[lang]?.code || lang) === 'en') english = await transcribe(wav, false, 20000, URL_STT, lang); // already Latin text
      else { english = await transcribe(wav, true, 20000, URL_STT, lang); original = (await transcribe(wav, false, 20000, URL_STT, lang).catch(() => original)) || original; }
    } catch (e) { if (!original) throw e; }
    return { text: english || original, original, ms: Math.round(performance.now() - t0) };
  })();
  return { stop: () => stopFn?.(), done };
}
