// Run: node tests/vision.test.mjs   (colour detection and sign matching on synthetic frames, no camera)
import assert from 'node:assert/strict';
globalThis.ImageData = class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
const { colourScan, whiteBalance, matchSigns, cleanWords, ocrLangs } = await import('../js/vision.js');

let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); } };

// A frame painted by fn(x, y) -> [r, g, b]
function frame(w, h, fn) {
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = fn(x, y); const k = (y * w + x) * 4; img.data.set([r, g, b, 255], k); }
  return img;
}

check('a blue gate filling the whole frame is still blue (close up)', () => {
  const t = colourScan(frame(120, 90, () => [35, 75, 190]), 'blue').thirds;
  assert.ok(Math.min(...t) > 0.9, t.join(', '));
});
check('a red gate filling the frame is still red', () => {
  const t = colourScan(frame(120, 90, () => [190, 35, 40]), 'red').thirds;
  assert.ok(Math.min(...t) > 0.9, t.join(', '));
});
check('warm light: blue gate on the right under a yellowish cast is found there, wall not called blue', () => {
  const img = frame(120, 90, (x) => (x > 80 ? [70, 95, 170] : [225, 200, 160]));
  const t = colourScan(img, 'blue').thirds;
  assert.ok(t[2] > 0.5 && t[0] < 0.05, t.join(', '));
});
check('a green gate in the centre, grey wall around', () => {
  const t = colourScan(frame(120, 90, (x) => (x > 40 && x < 80 ? [40, 140, 60] : [150, 150, 150])), 'green').thirds;
  assert.ok(t[1] > 0.5 && t[0] < 0.05 && t[2] < 0.05, t.join(', '));
});
check('white balance is left alone when nothing neutral is in view', () => {
  assert.deepEqual(whiteBalance(frame(40, 30, () => [35, 75, 190]).data), [1, 1, 1]);
});
check('white balance corrects a strong cast within limits', () => {
  const g = whiteBalance(frame(40, 30, () => [230, 200, 170]).data);
  assert.ok(g[2] > 1.05 && g[0] < 1 && g.every((x) => x >= 0.77 && x <= 1.3), g.join(', '));
});
check('sign matching: split and misread words', () => {
  const v = { signs: ['MEDPLUS'], alt: ['PHARMACY'] };
  assert.equal(matchSigns(cleanWords('MED PLUS pharmacy'), v).hit, 'name');
  assert.equal(matchSigns(cleanWords('MEDPLU5'), v).hit, 'name');
  assert.equal(matchSigns(cleanWords('APOLLO PHARMACY'), v).hit, 'type');
  assert.equal(matchSigns(cleanWords('BAKERY'), v).hit, null);
});
check('OCR languages follow the script of landmark names', () => {
  assert.equal(ocrLangs({ steps: [{ landmark: { name: 'MedPlus' } }] }), 'eng');
  assert.equal(ocrLangs({ steps: [{ landmark: { name: 'முருகன்' } }] }), 'eng+tam');
  assert.equal(ocrLangs({ steps: [{ landmark: { name: 'गणेश' } }] }), 'eng+hin');
});
process.exit(failed ? 1 : 0);
