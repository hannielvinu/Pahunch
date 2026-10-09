// Run: node tests/parser.test.mjs
import assert from 'node:assert/strict';
import { parseRules, SAMPLES, describe } from '../js/parser.js';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); } };

for (const [lang, note] of Object.entries(SAMPLES)) {
  check(`sample ${lang}: temple -> left turn (2nd) -> blue gate opposite MedPlus, floor 2`, () => {
    const g = parseRules(note);
    const lines = g.steps.map(describe);
    assert.equal(g.steps.length, 3, lines.join(' | '));
    const [a, b, c] = g.steps;
    assert.equal(a.kind, 'pass'); assert.equal(a.landmark.type, 'temple'); assert.match(a.landmark.name, /^Ganesh/i);
    assert.deepEqual([b.kind, b.turn, b.ordinal], ['turn', 'left', 2]);
    assert.equal(c.kind, 'arrive'); assert.equal(c.landmark.type, 'gate'); assert.equal(c.landmark.colour, 'blue');
    assert.equal(c.ref?.relation, 'opposite'); assert.equal(c.ref.landmark.name, 'MedPlus');
    assert.deepEqual(c.verify.signs, ['MEDPLUS']);
    assert.equal(g.floor, 2);
    assert.equal(g.lang, lang);
  });
}

check('venue route: exit sign, right, registration desk', () => {
  const g = parseRules('Walk past the EXIT sign, take the first right, then the Registration desk next to the iQOO banner');
  const lines = g.steps.map(describe);
  assert.equal(g.steps.length, 3, lines.join(' | '));
  assert.deepEqual(g.steps[0].verify.signs, ['EXIT']);
  assert.deepEqual([g.steps[1].turn, g.steps[1].ordinal], ['right', 1]);
  assert.equal(g.steps[2].landmark.name, 'Registration');
  assert.equal(g.steps[2].ref.landmark.name, 'iQOO');
});

check('single landmark becomes the destination', () => {
  const g = parseRules('the green gate near Sri Lakshmi Stores');
  assert.equal(g.steps.length, 1, g.steps.map(describe).join(' | '));
  assert.equal(g.steps[0].kind, 'arrive');
  assert.equal(g.steps[0].landmark.colour, 'green');
  assert.deepEqual(g.steps[0].verify.signs, ['LAKSHMI']);
});

check('empty / nonsense still yields an arrive step', () => {
  const g = parseRules('hello there');
  assert.equal(g.steps.length, 1); assert.equal(g.steps[0].kind, 'arrive');
});

for (const note of Object.values(SAMPLES)) console.log('   ', parseRules(note).steps.map(describe).join('  →  '));
process.exit(failed ? 1 : 0);
