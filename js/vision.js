// Camera, signboard OCR (Tesseract.js, local files) and colour regions (left / centre / right).

const here = (p) => new URL(p, location.href).href;

// ---------- Sign matching (pure, testable) ----------

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function wordMatches(seen, want) {
  if (seen === want) return true;
  if (want.length < 4 || seen.length < 3) return false;
  if (want.length >= 5 && seen.length >= 5 && (seen.startsWith(want) || want.startsWith(seen))) return true; // GANESH ~ GANESHA
  if (want.length >= 7 && Math.abs(seen.length - want.length) <= 2) return lev(seen, want) <= 2;
  return editDistance(seen, want) <= 1;
}

function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let p = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; }
  }
  return d[b.length];
}

export function cleanWords(text) {
  return text.toUpperCase().split(/[^A-Z0-9ऀ-෿]+/).filter((w) => w.length >= 2);
}

// -> { hit: 'name' | 'type' | null, word }
export function matchSigns(words, verify) {
  for (const want of verify.signs) { const w = words.find((s) => wordMatches(s, want)); if (w) return { hit: 'name', word: want }; }
  // OCR often splits a sign ("MED PLUS"): also look in the words joined together.
  const joined = words.join('');
  for (const want of verify.signs) if (want.length >= 4 && joined.includes(want)) return { hit: 'name', word: want };
  for (const want of verify.alt) { const w = words.find((s) => wordMatches(s, want)); if (w) return { hit: 'type', word: want }; }
  return { hit: null, word: null };
}

// ---------- Colour ----------

function hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max / 255];
}

const COLOUR_TEST = {
  red: (h, s, v) => (h < 12 || h > 345) && s > 0.45 && v > 0.25,
  orange: (h, s, v) => h >= 12 && h < 38 && s > 0.5 && v > 0.35,
  yellow: (h, s, v) => h >= 38 && h < 68 && s > 0.4 && v > 0.4,
  green: (h, s, v) => h >= 75 && h < 165 && s > 0.3 && v > 0.2,
  blue: (h, s, v) => h >= 190 && h < 255 && s > 0.35 && v > 0.2,
  pink: (h, s, v) => h >= 300 && h <= 345 && s > 0.3 && v > 0.4,
  brown: (h, s, v) => h >= 10 && h < 40 && s > 0.35 && v <= 0.45 && v > 0.12,
  white: (h, s, v) => s < 0.14 && v > 0.82,
  black: (h, s, v) => v < 0.16,
  grey: (h, s, v) => s < 0.12 && v >= 0.3 && v <= 0.75,
};

// White balance for warm venue lights / blue shade, estimated from pixels that are probably neutral (walls,
// road, sky: bright and low in saturation) and clamped. Plain grey-world would treat a big blue gate filling
// the frame as a colour cast and cancel it: the closer the rider got, the less blue the gate looked.
export function whiteBalance(data) {
  let sr = 0, sg = 0, sb = 0, n = 0, all = 0;
  for (let k = 0; k < data.length; k += 16) {
    const r = data[k], g = data[k + 1], b = data[k + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    all++;
    if (mx > 90 && mx - mn < 0.35 * mx) { sr += r; sg += g; sb += b; n++; }
  }
  if (n < all * 0.04) return [1, 1, 1]; // nothing neutral in view: leave the colours alone
  const avg = (sr + sg + sb) / 3, c = (x) => Math.min(1.3, Math.max(0.77, avg / (x || 1)));
  return [c(sr), c(sg), c(sb)];
}

// Pixel mask of `colour` (for the live overlay), its share per third, and mean brightness (low light → torch).
export function colourScan(imageData, colour) {
  const test = COLOUR_TEST[colour];
  const { data, width, height } = imageData;
  const mask = new ImageData(width, height);
  const hits = [0, 0, 0], totals = [0, 0, 0];
  let light = 0;
  const [gr, gg, gb] = whiteBalance(data);
  const cap = (x) => (x > 255 ? 255 : x);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4, third = Math.min(2, Math.floor((x * 3) / width));
      const [h, s, v] = hsv(cap(data[k] * gr), cap(data[k + 1] * gg), cap(data[k + 2] * gb));
      light += v;
      totals[third]++;
      if (test && test(h, s, v)) { hits[third]++; mask.data[k + 3] = 255; }
    }
  }
  return { thirds: hits.map((n, i) => n / totals[i]), mask, brightness: light / (width * height) };
}

// Share of pixels of `colour` in the left, centre and right thirds of the frame (0..1 each).
export function colourThirds(imageData, colour) {
  const test = COLOUR_TEST[colour];
  if (!test) return null;
  const { data, width, height } = imageData;
  const hits = [0, 0, 0], totals = [0, 0, 0];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const k = (y * width + x) * 4, third = Math.min(2, Math.floor((x * 3) / width));
      totals[third]++;
      if (test(...hsv(data[k], data[k + 1], data[k + 2]))) hits[third]++;
    }
  }
  return hits.map((h, i) => h / totals[i]);
}

// ---------- Camera + OCR ----------

export class Vision {
  constructor(video) {
    this.video = video;
    this.small = document.createElement('canvas'); // colour analysis
    this.big = document.createElement('canvas'); // OCR input
    this.worker = null;
    this.ocrBusy = false;
    this.lastOcrMs = 0;
  }

  async startCamera() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  stopCamera() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  loadOcr(langs = 'eng', onProgress) {
    // One load at a time: the splash and "Plan route" both ask for it.
    if (this.worker && this.langs === langs) return Promise.resolve();
    if (this._loading?.langs === langs) return this._loading.p;
    const p = this._load(langs, onProgress).finally(() => { this._loading = null; });
    this._loading = { langs, p };
    return p;
  }

  async _load(langs, onProgress) {
    await this.worker?.terminate();
    const t0 = performance.now();
    this.worker = await Tesseract.createWorker(langs, 1, {
      workerPath: here('lib/tesseract/worker.min.js'),
      corePath: here('lib/tesseract-core/'),
      langPath: here('lib/lang'),
      gzip: false,
      logger: (m) => onProgress?.(m),
    });
    await this.worker.setParameters({
      tessedit_pageseg_mode: '11', // sparse text: signs scattered in a scene
      // English only: Latin letters (signs, not noise). With an Indian script loaded, no whitelist.
      tessedit_char_whitelist: langs === 'eng' ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&' : '',
    });
    this.langs = langs;
    this.ocrLoadMs = Math.round(performance.now() - t0);
  }

  grab(canvas, maxW) {
    const v = this.video;
    if (!v.videoWidth) return null;
    const scale = Math.min(1, maxW / v.videoWidth);
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    return ctx;
  }

  colour(colour) {
    const ctx = this.grab(this.small, 96);
    return ctx ? colourThirds(ctx.getImageData(0, 0, this.small.width, this.small.height), colour) : null;
  }

  // Colour mask + thirds + brightness from a small frame (cheap enough for every tick).
  scan(colour) {
    const ctx = this.grab(this.small, 120);
    return ctx ? colourScan(ctx.getImageData(0, 0, this.small.width, this.small.height), colour) : null;
  }

  // Phone torch for dark lanes, if the camera supports it.
  async setTorch(on) {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || !track.getCapabilities?.().torch || this.torch === on) return false;
    try { await track.applyConstraints({ advanced: [{ torch: on }] }); this.torch = on; return true; } catch { return false; }
  }

  // Grayscale + contrast stretch (2nd–98th percentile, so one bright sky or dark shadow doesn't flatten the sign).
  // invert: white letters on a dark board (most Indian shop signs) become dark on light, which OCR reads best.
  enhance(ctx, W, H, invert = false) {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const hist = new Uint32Array(256);
    let n = 0;
    for (let k = 0; k < d.length; k += 16) { hist[(d[k] * 3 + d[k + 1] * 6 + d[k + 2]) / 10 | 0]++; n++; }
    let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.02) { hi = i; break; } }
    const span = Math.max(40, hi - lo);
    for (let k = 0; k < d.length; k += 4) {
      let g = Math.max(0, Math.min(255, (((d[k] * 3 + d[k + 1] * 6 + d[k + 2]) / 10 - lo) * 255) / span));
      if (invert) g = 255 - g;
      d[k] = d[k + 1] = d[k + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
  }

  // Resolves with { words, boxes, text, ms } or null if the worker is still busy with the last frame.
  // boxes: [{ text, tokens, x, y, w, h }] with x/y/w/h as fractions of the camera frame (0..1).
  async read() {
    if (!this.worker || this.ocrBusy) return null;
    // Each read looks at the scene a different way, in turn: the wide centre, the same inverted (light text on
    // dark boards), and a 2x zoom on the middle (signs far down the lane). Words seen in the last few reads are
    // kept, so a sign doesn't have to be read in one single frame.
    const v = this.video;
    if (!v.videoWidth) return null;
    const VIEWS = [{ x: 0.06, y: 0.1, w: 0.88, h: 0.7 }, { x: 0.06, y: 0.1, w: 0.88, h: 0.7, invert: true }, { x: 0.25, y: 0.25, w: 0.5, h: 0.42 }];
    this.view = ((this.view ?? -1) + 1) % VIEWS.length;
    const C = VIEWS[this.view];
    const sw = v.videoWidth * C.w, sh = v.videoHeight * C.h;
    this.big.width = 1280;
    this.big.height = Math.round((1280 * sh) / sw);
    const ctx = this.big.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, v.videoWidth * C.x, v.videoHeight * C.y, sw, sh, 0, 0, this.big.width, this.big.height);
    this.enhance(ctx, this.big.width, this.big.height, C.invert);
    this.ocrBusy = true;
    const t0 = performance.now();
    try {
      const { data } = await this.worker.recognize(this.big);
      const W = this.big.width, H = this.big.height;
      const read = (data.words || []).filter((w) => w.confidence > 35 && /[A-Za-z0-9ऀ-෿]{2,}/.test(w.text));
      const boxes = [];
      for (const w of read) {
        const tokens = cleanWords(w.text), b = w.bbox;
        if (!tokens.length || !b) continue;
        boxes.push({ text: tokens.join(' '), tokens, x: C.x + (b.x0 / W) * C.w, y: C.y + (b.y0 / H) * C.h, w: ((b.x1 - b.x0) / W) * C.w, h: ((b.y1 - b.y0) / H) * C.h });
      }
      this.lastOcrMs = Math.round(performance.now() - t0);
      const now = performance.now(), words = cleanWords(read.map((w) => w.text).join(' '));
      this.recent = [...(this.recent || []).filter((r) => now - r.at < 3000), { at: now, words }];
      const seen = [...new Set(this.recent.flatMap((r) => r.words))];
      return { words: seen, fresh: words, boxes, text: data.text, ms: this.lastOcrMs };
    } finally {
      this.ocrBusy = false;
    }
  }
}

// OCR languages for a route: English, plus Hindi / Tamil / Kannada when a landmark name is written in that script.
export function ocrLangs(graph) {
  const names = (graph?.steps || []).flatMap((st) => [st.landmark?.name, st.ref?.landmark?.name]).filter(Boolean).join(' ');
  const extra = /[ऀ-ॿ]/.test(names) ? 'hin' : /[஀-௿]/.test(names) ? 'tam' : /[ಀ-೿]/.test(names) ? 'kan' : '';
  return extra ? `eng+${extra}` : 'eng';
}
