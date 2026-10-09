// Guide overlay: draws what the phone sees and decides on top of the camera (one canvas, requestAnimationFrame).
// OCR boxes (green = your landmark, red = decoy).
import { wordMatches } from './vision.js';

const GREEN = '#2ecc71', RED = '#ff4d4d';

// The video uses object-fit: cover, so the frame is scaled to fill the element and the overflow is cropped.
// Returns how a point at fraction (u, v) of the frame lands on screen: x = ox + u * dw, y = oy + v * dh.
export function coverMap(vw, vh, W, H) {
  const s = Math.max(W / vw, H / vh), dw = vw * s, dh = vh * s;
  return { ox: (W - dw) / 2, oy: (H - dh) / 2, dw, dh };
}

export function toScreen(b, m) {
  return { x: m.ox + b.x * m.dw, y: m.oy + b.y * m.dh, w: b.w * m.dw, h: b.h * m.dh };
}

// Mark the boxes that contain the matched sign word.
export function markBoxes(boxes, hitWord) {
  return boxes.map((b) => ({ ...b, hit: !!hitWord && b.tokens.some((t) => wordMatches(t, hitWord)) }));
}

export class Overlay {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = canvas.getContext('2d');
    this.boxes = [];
    this.boxesAt = 0;
    this.hitLabel = '';
    this.running = false;
  }

  start() {
    this.running = true;
    const loop = (t) => {
      if (!this.running) return;
      this.draw(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.clearStep();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  clearStep() {
    this.boxes = [];
  }

  // hitWord: the sign word that matched this step (or null); label: what to write on its box.
  setBoxes(boxes, hitWord, label) {
    this.boxes = markBoxes(boxes || [], hitWord);
    this.hitLabel = label;
    this.boxesAt = performance.now();
  }

  fit() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight, dpr = devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { W, H };
  }

  draw(now) {
    const { W, H } = this.fit(), ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    const v = this.video;
    if (!v.videoWidth) return;
    const m = coverMap(v.videoWidth, v.videoHeight, W, H);
    this.drawBoxes(ctx, m, now);
  }

  drawBoxes(ctx, m, now) {
    // Hold each OCR result for 1.5 s, then fade over 1 s (OCR runs slower than the screen).
    const age = now - this.boxesAt, alpha = age < 1500 ? 1 : Math.max(0, 1 - (age - 1500) / 1000);
    if (!alpha || !this.boxes.length) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textBaseline = 'bottom';
    let redLabels = 0;
    // Decoys first so the green box is drawn on top.
    for (const b of [...this.boxes].sort((a, c) => a.hit - c.hit)) {
      const r = toScreen(b, m);
      if (b.hit) {
        ctx.lineWidth = 6;
        ctx.strokeStyle = GREEN;
        ctx.shadowColor = GREEN;
        ctx.shadowBlur = 16;
        ctx.strokeRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
        ctx.shadowBlur = 0;
        label(ctx, this.hitLabel, r.x - 4, r.y - 8, GREEN, '#031', 'bold 18px system-ui, sans-serif');
      } else {
        ctx.lineWidth = 2;
        ctx.strokeStyle = RED;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        if (r.h >= 12 && redLabels++ < 5) label(ctx, '✗ not your landmark', r.x, r.y - 3, RED, '#fff', '12px system-ui, sans-serif');
      }
    }
    ctx.restore();
  }
}

function label(ctx, text, x, y, bg, fg, font) {
  ctx.font = font;
  const w = ctx.measureText(text).width + 12, h = parseInt(font.match(/(\d+)px/)[1], 10) + 8;
  const W = ctx.canvas.clientWidth;
  x = Math.max(4, Math.min(x, W - w - 4));
  y = Math.max(h + 4, y);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y - h, w, h, 6) : ctx.rect(x, y - h, w, h);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.fillText(text, x + 6, y - 4);
}
