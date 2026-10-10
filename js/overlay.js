// Guide overlay: draws what the phone sees and decides on top of the camera (one canvas, requestAnimationFrame).
// OCR boxes (green = your landmark, red = decoy), the turn arrow with its compass arc, and colour thirds.
import { wordMatches } from './vision.js';

const GREEN = '#2ecc71', RED = '#ff4d4d', AMBER = '#ffb020', CYAN = '#22d3ee';
const PAINT = { red: '#ff3b30', orange: '#ff9500', yellow: '#ffd60a', green: '#30d158', blue: '#2f8bff', pink: '#ff5fa2',
  brown: '#a2733f', white: '#ffffff', black: '#111111', grey: '#9a9a9a' };
const THIRDS = ['left', 'centre', 'right'];
export const COLOUR_ON = 0.15; // share of a third that counts as "colour found" (same threshold as the guide)

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
    this.dets = [];
    this.mask = null;
    this.maskCanvas = document.createElement('canvas');
    this.scanning = true;
  }

  // Object detections from detector.js: [{ label, score, x, y, w, h }] (fractions of the frame).
  // hit: { label, text } when one class is the current step's landmark (drawn green).
  setDetections(dets, hit) { this.dets = dets || []; this.detHit = hit || null; this.detsAt = performance.now(); }

  // Pixel mask of the target colour (ImageData, alpha = hit), drawn tinted over the video.
  setMask(mask, name) {
    if (!mask) { this.mask = null; return; }
    const c = this.maskCanvas;
    c.width = mask.width; c.height = mask.height;
    const g = c.getContext('2d');
    g.putImageData(mask, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = PAINT[name] || AMBER;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    this.mask = { name, at: performance.now() };
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
    this.colour = null;
  }

  // Latest colour reading: share of `name` in the left / centre / right thirds of the frame.
  setColour(name, thirds) {
    this.colour = { name, thirds, at: performance.now() };
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
    if (this.mask && now - this.mask.at < 800) this.drawMask(ctx, m);
    if (this.colour && now - this.colour.at < 1000) this.drawColour(ctx, m, W, H);
    this.drawDetections(ctx, m, now);
    if (!this.turn) this.drawReticle(ctx, W, H, now);
    this.drawBoxes(ctx, m, now);
    if (this.turn) this.drawTurn(ctx, W, H, now);
  }

  drawMask(ctx, m) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.imageSmoothingEnabled = false; // blocky mask reads as "pixels the phone classified"
    ctx.drawImage(this.maskCanvas, m.ox, m.oy, m.dw, m.dh);
    ctx.restore();
  }

  // Corner-bracket boxes with class + confidence, like a CV demo; fades if detection stalls.
  drawDetections(ctx, m, now) {
    if (!this.dets.length || now - (this.detsAt || 0) > 1200) return;
    ctx.save();
    ctx.lineWidth = 3;
    for (const d of this.dets) {
      const r = toScreen(d, m), c = Math.min(22, r.w / 4, r.h / 4);
      const isHit = this.detHit && d.label === this.detHit.label, col = isHit ? GREEN : CYAN;
      ctx.lineWidth = isHit ? 5 : 3;
      ctx.strokeStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = isHit ? 16 : 8;
      ctx.beginPath();
      for (const [x, y, dx, dy] of [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]]) {
        ctx.moveTo(x + dx * c, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * c);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = isHit ? 0.16 : 0.08; ctx.fillStyle = col; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.globalAlpha = 1;
      label(ctx, isHit ? `${this.detHit.text} · ${Math.round(d.score * 100)}%` : `${d.label} ${Math.round(d.score * 100)}%`, r.x, r.y - 4, col, '#012', 'bold 13px Inter, system-ui, sans-serif');
    }
    ctx.restore();
  }

  // Centre reticle with a sweeping scan line: shows the camera is actively reading.
  drawReticle(ctx, W, H, now) {
    const w = W * 0.72, h = H * 0.34, x = (W - w) / 2, y = H * 0.3, c = 26;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (const [px, py, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.moveTo(px + dx * c, py); ctx.lineTo(px, py); ctx.lineTo(px, py + dy * c);
    }
    ctx.stroke();
    if (this.scanning) {
      const sy = y + ((now / 1600) % 1) * h;
      const g = ctx.createLinearGradient(0, sy - 18, 0, sy + 2);
      g.addColorStop(0, 'rgba(34,211,238,0)'); g.addColorStop(1, 'rgba(34,211,238,.55)');
      ctx.fillStyle = g; ctx.fillRect(x, sy - 18, w, 20);
      ctx.fillStyle = CYAN; ctx.fillRect(x, sy, w, 2);
    }
    ctx.restore();
  }

  // Tint each third of the frame where the target colour shows up, labelled e.g. "blue · left".
  drawColour(ctx, m, W, H) {
    const { name, thirds } = this.colour, paint = PAINT[name] || AMBER;
    ctx.save();
    thirds.forEach((v, k) => {
      if (v < COLOUR_ON) return;
      const x0 = Math.max(0, m.ox + (k / 3) * m.dw), x1 = Math.min(W, m.ox + ((k + 1) / 3) * m.dw);
      if (x1 <= x0) return; // this third is cropped off screen
      ctx.globalAlpha = Math.min(0.4, 0.12 + v * 0.5);
      ctx.fillStyle = paint;
      ctx.fillRect(x0, 0, x1 - x0, H);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3; ctx.strokeStyle = paint;
      ctx.strokeRect(x0 + 1.5, 1.5, x1 - x0 - 3, H - 3);
      const dark = name === 'white' || name === 'yellow';
      label(ctx, `${name} · ${THIRDS[k]}`, x0 + 8, H * 0.5 - 22, paint, dark ? '#111' : '#fff', 'bold 16px Inter, system-ui, sans-serif');
    });
    ctx.restore();
  }

  // Big arrow in the turn direction, and an arc that fills from 0° to 90° as the compass swings that way.
  drawTurn(ctx, W, H, now) {
    const sign = this.turn.want === 'right' ? 1 : -1, ccw = sign < 0;
    const d = this.turn.delta, done = this.turnDone;
    const along = d == null ? 0 : d * sign; // degrees turned in the asked direction
    const f = done ? 1 : Math.max(0, Math.min(1, along / 60)); // full ring = the angle where the turn counts
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
    // Arrow nudges toward the turn until it is confirmed.
    const nudge = done ? 0 : (Math.sin(now / 220) * 0.5 + 0.5) * R * 0.14;
    arrow(ctx, cx + sign * nudge, cy, R * 1.1, sign, col);
    const wrong = !done && d != null && along < -15;
    const dir = this.turn.want === 'right' ? 'RIGHT' : 'LEFT';
    const line = done ? '✓ Turned' : d == null ? `Turn ${dir}, then tap “I’ve turned”` : wrong ? 'Other way' : along < 10 ? `Turn ${dir} now` : `Turning… ${Math.round(Math.min(100, (along / 60) * 100))}%`;
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
        label(ctx, this.hitLabel, r.x - 4, r.y - 8, GREEN, '#031', 'bold 18px Inter, system-ui, sans-serif');
      } else {
        ctx.lineWidth = 2;
        ctx.strokeStyle = RED;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        if (r.h >= 12 && redLabels++ < 5) label(ctx, '✗ not your landmark', r.x, r.y - 3, RED, '#fff', '12px Inter, system-ui, sans-serif');
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
