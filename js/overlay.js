// Guide overlay: draws what the phone sees and decides on top of the camera (one canvas, requestAnimationFrame).
// OCR boxes (green = your landmark, red = decoy) and the turn arrow with its compass arc.
import { wordMatches } from './vision.js';

const GREEN = '#2ecc71', RED = '#ff4d4d', AMBER = '#ffb020';

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
    this.boxes = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // Per-step drawings; OCR boxes stay so a confirmation stays visible into the next step and then fade.
  clearStep() {
    this.turn = null;
    this.turnDone = false;
  }

  // turn: the step's TurnDetector (reads the live compass delta every frame).
  setTurn(turn) {
    this.turn = turn;
    this.turnDone = false;
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
    if (this.turn) this.drawTurn(ctx, W, H, now);
  }

  // Big arrow in the turn direction, and an arc that fills from 0° to 90° as the compass swings that way.
  drawTurn(ctx, W, H, now) {
    const sign = this.turn.want === 'right' ? 1 : -1, ccw = sign < 0;
    const d = this.turn.delta, done = this.turnDone;
    const along = d == null ? 0 : d * sign; // degrees turned in the asked direction
    const f = done ? 1 : Math.max(0, Math.min(1, along / 90));
    const cx = W / 2, cy = H * 0.46, R = Math.min(W, H) * 0.3, col = done ? GREEN : AMBER;
    const a0 = -Math.PI / 2, at = (deg) => a0 + sign * (deg / 90) * (Math.PI / 2);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 16;
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, at(90), ccw); ctx.stroke();
    if (f > 0) {
      ctx.strokeStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(cx, cy, R, a0, at(90 * f), ccw); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // Tick where the detector starts counting the turn (55°).
    const k = at(55);
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(k) * (R - 16), cy + Math.sin(k) * (R - 16)); ctx.lineTo(cx + Math.cos(k) * (R + 16), cy + Math.sin(k) * (R + 16)); ctx.stroke();
    // Arrow nudges toward the turn until it is confirmed.
    const nudge = done ? 0 : (Math.sin(now / 220) * 0.5 + 0.5) * R * 0.14;
    arrow(ctx, cx + sign * nudge, cy, R * 1.1, sign, col);
    const wrong = !done && d != null && along < -15;
    const line = done ? '✓ turn confirmed' : d == null ? 'no compass: tap “I’ve turned”' : wrong ? `wrong way · ${Math.round(-along)}°` : `${Math.round(Math.max(0, along))}° / 90°`;
    ctx.font = `800 ${Math.round(R * 0.26)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.strokeText(line, cx, cy + R + 22);
    ctx.fillStyle = wrong ? RED : col;
    ctx.fillText(line, cx, cy + R + 22);
    ctx.restore();
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

// Block arrow of length L centred on (cx, cy), pointing right (sign 1) or left (sign -1).
function arrow(ctx, cx, cy, L, sign, col) {
  const pts = [[-0.5, -0.13], [0.08, -0.13], [0.08, -0.34], [0.5, 0], [0.08, 0.34], [0.08, 0.13], [-0.5, 0.13]];
  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](cx + sign * x * L, cy + y * L));
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 18;
  ctx.fillStyle = col;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.stroke();
  ctx.restore();
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
