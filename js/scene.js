// Appearance: what kind of place the camera is looking at, from how it looks (not from text).
// MediaPipe image classifier (EfficientNet-Lite0 int8, ImageNet classes) on the live camera; ImageNet labels
// are grouped into the landmark types the route uses. A temple with no English signboard can still be
// recognised as "temple-like" and trigger the confirmation question.

const here = (p) => new URL(p, location.href).href;

// ImageNet label -> appearance tag
const GROUPS = {
  temple: ['stupa', 'palace', 'church', 'mosque', 'monastery', 'altar', 'bell cote', 'castle', 'dome', 'triumphal arch', 'obelisk', 'pedestal'],
  gate: ['sliding door', 'picket fence', 'worm fence', 'chain-link fence', 'chainlink fence', 'grille', 'turnstile', 'prison', 'window screen', 'iron', 'stone wall'],
  shop: ['grocery store', 'bookshop', 'toyshop', 'barbershop', 'confectionery', 'shoe shop', 'tobacco shop', 'butcher shop', 'bakery', 'restaurant', 'cinema', 'pill bottle', 'pharmacy'],
  petrol: ['gas pump'],
  bus: ['trolleybus', 'minibus', 'school bus', 'passenger car', 'streetcar'],
  park: ['park bench', 'fountain'],
  house: ['patio', 'boathouse', 'mobile home', 'home theater', 'sliding door'],
};
const TAG_OF = {};
for (const [tag, labels] of Object.entries(GROUPS)) for (const l of labels) TAG_OF[l] ??= tag;

// Landmark type in the route -> appearance tag that can support it
export const TYPE_TAG = { temple: 'temple', church: 'temple', mosque: 'temple', gate: 'gate', door: 'gate', house: 'gate',
  store: 'shop', bakery: 'shop', pharmacy: 'shop', restaurant: 'shop', petrol: 'petrol', bus_stop: 'bus', park: 'park' };

export class Scene {
  constructor(video) { this.video = video; this.ready = false; this.ms = 0; this.tags = []; }

  async load() {
    if (this.ready) return;
    const { FilesetResolver, ImageClassifier } = await import('../lib/mediapipe/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks(here('lib/mediapipe/wasm'));
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: here('lib/detector/efficientnet_lite0.tflite'), delegate }, runningMode: 'VIDEO', maxResults: 5, scoreThreshold: 0.08 });
    try { this.clf = await ImageClassifier.createFromOptions(files, opts('GPU')); } catch { this.clf = await ImageClassifier.createFromOptions(files, opts('CPU')); }
    this.ready = true;
  }

  // -> [{ tag, label, score }] best first (one entry per tag)
  classify() {
    const v = this.video;
    if (!this.ready || !v.videoWidth || v.readyState < 2) return this.tags;
    const t0 = performance.now();
    const res = this.clf.classifyForVideo(v, t0);
    this.ms = Math.round(performance.now() - t0);
    const seen = new Map();
    for (const c of res.classifications?.[0]?.categories || []) {
      const label = (c.categoryName || c.displayName || '').toLowerCase();
      const tag = TAG_OF[label] || Object.entries(TAG_OF).find(([l]) => label.includes(l))?.[1];
      if (tag && !seen.has(tag)) seen.set(tag, { tag, label, score: c.score });
    }
    this.top = res.classifications?.[0]?.categories?.[0];
    this.tags = [...seen.values()].sort((a, b) => b.score - a.score);
    return this.tags;
  }
}
