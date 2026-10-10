// Draws the Pahunch app icons as PNG (Chrome needs 192 and 512 px PNGs to install the PWA).
// Same shapes as icons/icon.svg: red square, white map pin, red door with a white knob. No dependencies.
// Run: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const RED = [226, 55, 68], RED2 = [239, 79, 95], WHITE = [255, 255, 255];

// Colour at a point of the 64-unit design (null = transparent). full = maskable (no rounded corners).
function paint(x, y, full) {
  const r = 18;
  if (!full) {
    const cx = Math.min(Math.max(x, r), 64 - r), cy = Math.min(Math.max(y, r), 64 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
  }
  // pin: round head + tapering tail to (32, 53)
  const inHead = (x - 32) ** 2 + (y - 27.2) ** 2 <= 16.5 ** 2;
  const t = (y - 27.2) / 25.8;
  const inTail = t >= 0 && t <= 1 && Math.abs(x - 32) <= 16.5 * (1 - t ** 1.5) * Math.sqrt(1 - t * 0.35);
  if (inHead || inTail) {
    const inDoor = x >= 26.5 && x <= 37.5 && y <= 37 && (y >= 25.5 || (x - 32) ** 2 + (y - 25.5) ** 2 <= 5.5 ** 2);
    if (inDoor) return (x - 34.3) ** 2 + (y - 31.6) ** 2 <= 1.4 ** 2 ? WHITE : RED;
    return WHITE;
  }
  const k = (x + y) / 128; // background gradient, top-left to bottom-right
  return RED.map((c, i) => Math.round(c + (RED2[i] - c) * k));
}

function png(size, full) {
  const S = 4, raw = Buffer.alloc((size * 4 + 1) * size); // 4x4 supersampling for smooth edges
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const c = paint(((px + (sx + 0.5) / S) / size) * 64, ((py + (sy + 0.5) / S) / size) * 64, full);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(new URL('../icons/icon-192.png', import.meta.url), png(192, false));
writeFileSync(new URL('../icons/icon-512.png', import.meta.url), png(512, false));
writeFileSync(new URL('../icons/icon-maskable-512.png', import.meta.url), png(512, true));
console.log('icons written');
