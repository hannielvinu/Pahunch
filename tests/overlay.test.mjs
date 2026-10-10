// Run: node tests/overlay.test.mjs   (pure parts of the guide overlay: cover mapping, decoy marking)
import assert from 'node:assert/strict';
import { coverMap, toScreen, markBoxes } from '../js/overlay.js';
import { isOffDevice, tally, formatBytes } from '../js/netmeter.js';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); } };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

check('cover: landscape frame on a portrait screen crops the sides', () => {
  const m = coverMap(1280, 720, 400, 800); // scale = 800/720
  near(m.dh, 800); near(m.oy, 0);
  near(m.dw, 1280 * 800 / 720); near(m.ox, (400 - m.dw) / 2);
  const c = toScreen({ x: 0.5, y: 0.5, w: 0, h: 0 }, m);
  near(c.x, 200); near(c.y, 400); // frame centre stays at screen centre
});

check('cover: same aspect is a plain scale', () => {
  const m = coverMap(640, 480, 320, 240);
  const r = toScreen({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, m);
  assert.deepEqual([r.x, r.y, r.w, r.h], [80, 120, 160, 60]);
});

check('only the matched sign is green; decoys stay red', () => {
  const boxes = [
    { text: 'APOLLO', tokens: ['APOLLO'], x: 0, y: 0, w: 0.1, h: 0.1 },
    { text: 'MEDPIUS', tokens: ['MEDPIUS'], x: 0.5, y: 0, w: 0.1, h: 0.1 }, // OCR slip, 1 edit
    { text: 'PHARMACY', tokens: ['PHARMACY'], x: 0.5, y: 0.2, w: 0.1, h: 0.1 },
  ];
  assert.deepEqual(markBoxes(boxes, 'MEDPLUS').map((b) => b.hit), [false, true, false]);
  assert.deepEqual(markBoxes(boxes, null).map((b) => b.hit), [false, false, false]);
});

check('network meter counts only off-device traffic', () => {
  assert.equal(isOffDevice('http://localhost:8080/js/app.js'), false);
  assert.equal(isOffDevice('http://127.0.0.1:8081/completion'), false);
  assert.equal(isOffDevice('data:image/png;base64,xx'), false);
  assert.equal(isOffDevice('https://huggingface.co/x.onnx'), true);
  const t = tally([
    { name: 'http://localhost:8080/index.html', transferSize: 5000 },
    { name: 'http://localhost:8081/completion', transferSize: 900 },
    { name: 'https://cdn.example.com/a.js', transferSize: 2048 },
    { name: 'https://opaque.example.com/b', transferSize: 0, encodedBodySize: 0 },
  ]);
  assert.deepEqual({ requests: t.requests, bytes: t.bytes }, { requests: 2, bytes: 2048 });
  assert.deepEqual([...t.hosts].sort(), ['cdn.example.com', 'opaque.example.com']);
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(2048), '2.0 KB');
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall overlay tests passed');
