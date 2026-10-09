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
  return editDistance(seen, want) <= 1;
}

export function cleanWords(text) {
  return text.toUpperCase().split(/[^A-Z0-9ऀ-෿]+/).filter((w) => w.length >= 2);
}

// -> { hit: 'name' | 'type' | null, word }
export function matchSigns(words, verify) {
  for (const want of verify.signs) { const w = words.find((s) => wordMatches(s, want)); if (w) return { hit: 'name', word: want }; }
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

  async loadOcr(langs = 'eng', onProgress) {
    if (this.worker && this.langs === langs) return;
    await this.worker?.terminate();
    const t0 = performance.now();
    this.worker = await Tesseract.createWorker(langs, 1, {
      workerPath: here('lib/tesseract/worker.min.js'),
      corePath: here('lib/tesseract-core/'),
      langPath: here('lib/lang'),
      gzip: false,
      logger: (m) => onProgress?.(m),
    });
    await this.worker.setParameters({ tessedit_pageseg_mode: '11' }); // sparse text: signs scattered in a scene
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

  // Resolves with { words, text, ms } or null if the worker is still busy with the last frame.
  async read() {
    if (!this.worker || this.ocrBusy) return null;
    const ctx = this.grab(this.big, 1024);
    if (!ctx) return null;
    this.ocrBusy = true;
    const t0 = performance.now();
    try {
      const { data } = await this.worker.recognize(this.big);
      const words = (data.words || []).filter((w) => w.confidence > 45).map((w) => w.text);
      this.lastOcrMs = Math.round(performance.now() - t0);
      return { words: cleanWords(words.join(' ')), text: data.text, ms: this.lastOcrMs };
    } finally {
      this.ocrBusy = false;
    }
  }
}
