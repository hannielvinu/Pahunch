// Run: node tests/llm.test.mjs   (checks the strict output reader, no model needed)
import assert from 'node:assert/strict';
import { parseLines, agrees, looping } from '../js/llm.js';
import { parseRules, SAMPLES, describe } from '../js/parser.js';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); } };

const good = 'PASS temple | Ganesh | -\nTURN left 2 lane\nARRIVE gate | - | blue | opposite pharmacy | MedPlus\nFLOOR 2';

check('reads a well-formed answer and agrees with rules', () => {
  const g = parseLines(good, SAMPLES.hi);
  assert.equal(g.steps.map(describe).join(' | '), 'Pass Ganesh temple | Take the 2nd lane left | Arrive: blue gate opposite MedPlus pharmacy');
  assert.equal(g.floor, 2);
  assert.deepEqual(g.steps[2].verify.signs, ['MEDPLUS']);
  assert.ok(agrees(g, parseRules(SAMPLES.hi)));
});

check('drops a hallucinated name not in the note', () => {
  const g = parseLines('PASS temple | Shiva | -\nARRIVE gate | - | blue | - - | -', SAMPLES.en);
  assert.equal(g.steps[0].landmark.name, null);
});

check('keeps names that differ by a letter (Ganesh/Ganesha)', () => {
  assert.equal(parseLines('ARRIVE temple | Ganesha | - | - - | -', SAMPLES.hi).steps[0].landmark.name, 'Ganesha');
});

check('tolerates bullets / numbering and unknown types', () => {
  const g = parseLines('1. PASS fountain | Neptune | -\n- TURN right 9 road\nARRIVE door | - | - | - - | -', 'past the Neptune fountain, right, the door');
  assert.equal(g.steps[0].landmark.type, 'other');
  assert.equal(g.steps[1].ordinal, 4);
  assert.equal(g.steps.at(-1).kind, 'arrive');
});

check('rejects chatty / off-format output', () => {
  assert.throws(() => parseLines('Sure! Here are the steps:\nYou should go to the temple.', 'x'));
});

check('trailing turn gets a destination step', () => {
  const g = parseLines('TURN left 1 lane', 'first left');
  assert.equal(g.steps.length, 2); assert.equal(g.steps[1].kind, 'arrive');
});

check("a looping answer is detected and rejected if it went off-track", () => {
  const loop = 'PASS temple | Ganesh | -\n' + 'PASS other | - | -\n'.repeat(30);
  assert.ok(looping(loop));
  assert.throws(() => parseLines(loop, SAMPLES.hi));
  const g = parseLines('PASS temple | Ganesh | -\nTURN left 2 lane\nTURN left 2 lane\nTURN left 2 lane', SAMPLES.hi);
  assert.equal(g.steps.length, 3);
});

check("all-empty answer falls back", () => {
  assert.throws(() => parseLines("ARRIVE other | - | - | - - | -", "hello"));
});
process.exit(failed ? 1 : 0);
