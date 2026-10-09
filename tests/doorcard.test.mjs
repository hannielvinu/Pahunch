// Run: node tests/doorcard.test.mjs   (DIGIPIN against India Post's published examples, door card storage)
import assert from 'node:assert/strict';
import { encodeDigipin, decodeDigipin, formatDigipin } from '../js/digipin.js';
import { makeCard, setPosition, saveCard, loadCards, deleteCard, qrPayload } from '../js/doorcard.js';
import { parseRules, SAMPLES } from '../js/parser.js';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); } };

// Minimal localStorage stand-in; `limit` makes it throw like a full quota.
const memStore = (limit = Infinity) => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { if (v.length > limit) throw new Error('quota'); m.set(k, v); } };
};

check('DIGIPIN encodes India Post examples', () => {
  assert.equal(encodeDigipin(12.971601, 77.594584), '4P3JK852C9');
  assert.equal(encodeDigipin(13.11179621, 80.20264269), '4T396F42L7');
});

check('DIGIPIN decodes to within a cell (~4 m) and round-trips', () => {
  const p = decodeDigipin('4P3 JK85 2C9');
  assert.ok(Math.abs(p.lat - 12.971601) < 4e-5 && Math.abs(p.lon - 77.594584) < 4e-5);
  assert.equal(encodeDigipin(p.lat, p.lon), '4P3JK852C9');
  assert.equal(decodeDigipin('4P3JK852CA'), null);
});

check('DIGIPIN edges: outside India is null, corners stay in the grid', () => {
  assert.equal(encodeDigipin(51.5, -0.1), null);
  assert.equal(encodeDigipin(38.5, 99.5).length, 10);
  assert.equal(encodeDigipin(2.5, 63.5).length, 10);
  assert.equal(formatDigipin('4P3JK852C9'), '4P3 JK85 2C9');
});

check('door card from a route, with position and QR payload', () => {
  const g = { ...parseRules(SAMPLES.en), note: SAMPLES.en };
  const c = setPosition(makeCard(g, { secs: 42, at: 1 }), { latitude: 12.971601, longitude: 77.594584, accuracy: 6.4 });
  assert.equal(c.digipin, '4P3JK852C9');
  assert.equal(c.acc, 6);
  assert.equal(c.dest, 'blue gate opposite MedPlus pharmacy');
  assert.equal(c.route.length, g.steps.length);
  const q = JSON.parse(qrPayload(c));
  assert.equal(q.digipin, '4P3JK852C9');
  assert.equal(q.note, SAMPLES.en);
});

check('cards save newest first, replace by id, delete', () => {
  const s = memStore();
  const g = parseRules(SAMPLES.hi);
  const a = makeCard(g, { at: 1 }), b = makeCard(g, { at: 2 });
  saveCard(a, s); saveCard(b, s);
  assert.deepEqual(loadCards(s).map((c) => c.id), [b.id, a.id]);
  a.floor = 3; saveCard(a, s);
  assert.deepEqual(loadCards(s).map((c) => c.id), [a.id, b.id]);
  assert.equal(loadCards(s)[0].floor, 3);
  deleteCard(b.id, s);
  assert.equal(loadCards(s).length, 1);
});

check('full storage drops old photos before failing', () => {
  const s = memStore(3000);
  const g = parseRules(SAMPLES.en);
  const old = { ...makeCard(g, { at: 1 }), photo: 'x'.repeat(1500) };
  saveCard(old, s);
  const fresh = { ...makeCard(g, { at: 2 }), photo: 'y'.repeat(1000) };
  assert.ok(saveCard(fresh, s));
  const cards = loadCards(s);
  assert.equal(cards[0].photo, fresh.photo);
  assert.equal(cards[1].photo, null);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall door card tests passed');
