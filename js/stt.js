// Offline speech-to-text: records the microphone in the page and sends 16 kHz WAV to whisper.cpp's server
// running in Termux on this phone (localhost:8082). Whisper detects the language itself.
//  - live: re-transcribes the audio so far every ~2 s (original language) for the on-screen transcript
//  - final: one pass with translate=true, so the route parser gets English whatever was spoken
// The analyser feeds a real waveform; recording stops by itself after ~1.6 s of silence.

const URL_STT = 'http://localhost:8082/inference';

export async function sttAvailable() {
  try { await fetch('http://localhost:8082/', { signal: AbortSignal.timeout(500) }); return true; } catch { return false; }
}

function toWav16k(chunks, rate) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(len);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
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

async function transcribe(wav, translate, ms = 20000) {
  const f = new FormData();
  f.append('file', wav, 'speech.wav');
  f.append('temperature', '0');
  f.append('response_format', 'json');
  if (translate) f.append('translate', 'true');
  const r = await fetch(URL_STT, { method: 'POST', body: f, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`speech server ${r.status}`);
  const j = await r.json();
  return (j.text || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(); // drop [BLANK_AUDIO], (music)…
}

// opts: { canvas, onPartial(text), onLevel(0..1) } -> { stop(), done: Promise<{ text, original, ms }> }
export function listen({ canvas, onPartial, onState } = {}) {
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
      if (spoke && quietSince && now - quietSince > 1600) stopFn();
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
      if (spoke && !busy && now - lastLive > 2000 && chunks.length > 4) {
        busy = true; lastLive = now;
        transcribe(toWav16k(chunks, ctx.sampleRate), false).then((t) => { if (t && !stopped) { original = t; onPartial?.(t); } }).catch(() => {}).finally(() => (busy = false));
      }
      if (!stopped) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    await new Promise((resolve) => { stopFn = resolve; setTimeout(resolve, 20000); });
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
    try { english = await transcribe(wav, true); } catch (e) { if (!original) throw e; }
    return { text: english || original, original, ms: Math.round(performance.now() - t0) };
  })();
  return { stop: () => stopFn?.(), done };
}
