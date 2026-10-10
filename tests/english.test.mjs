// Run: node tests/english.test.mjs
// Customer's words -> English (on-device model, here a stand-in) -> route, cross-checked against her own words.
import assert from 'node:assert/strict';
import { understandNote } from '../js/llm.js';
import { describe } from '../js/parser.js';

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); } };

// Stand-in llama-server: answers the translation prompt with `english`, the route rewriter with `rewrite`.
let english = '', rewrite = '', calls = { translate: 0, rewrite: 0 };
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith('/health')) return new Response('{}');
  const body = JSON.parse(init.body);
  if (/translate a customer's delivery directions/i.test(body.messages[0].content)) {
    calls.translate++;
    return new Response(JSON.stringify({ choices: [{ message: { content: english } }] }));
  }
  calls.rewrite++;
  return new Response(new Blob([`data: ${JSON.stringify({ choices: [{ delta: { content: rewrite } }] })}\n\ndata: [DONE]\n\n`]).stream());
};
const run = async (note, en, rw = '') => { english = en; rewrite = rw; calls = { translate: 0, rewrite: 0 }; const r = await understandNote(note, { mode: 'auto' }); return { r, steps: r.graph.steps.map(describe).join(' | ') }; };

await check('Tamil note -> English -> route', async () => {
  const { r, steps } = await run('முருகன் கோவில் தாண்டி ரெண்டாவது தெருவுல ரைட், MedPlus எதிரே பச்சை கேட் வீடு, ரெண்டாவது மாடி',
    'After the Murugan temple, take the second street on the right; the house with the green gate opposite MedPlus, second floor.');
  assert.equal(calls.translate, 1);
  assert.match(r.english, /Murugan temple/);
  assert.match(steps, /temple .*2nd .*right .*green gate opposite MedPlus/);
  assert.equal(r.graph.floor, 2);
});
await check('a translation that flips the turn is corrected by her own words', async () => {
  const { steps } = await run('முருகன் கோவில் தாண்டி ரெண்டாவது தெருவுல ரைட், பச்சை கேட் வீடு',
    'After the Murugan temple, take the second street on the left; the green gate house.');
  assert.match(steps, /2nd .*right/, steps);
});
await check('Bengali note (few rule words) is understood through English', async () => {
  const { r, steps } = await run('মন্দিরের পরে ডানদিকে দ্বিতীয় গলি, লাল গেটের বাড়ি',
    'After the temple, the second lane on the right; the house with the red gate.');
  assert.ok(r.english);
  assert.match(steps, /temple .*2nd .*right .*red gate/);
});
await check('English notes skip translation', async () => {
  const { r } = await run('take the second left after the temple, blue gate', 'SHOULD NOT BE USED');
  assert.equal(calls.translate, 0); assert.equal(r.english, null);
});
await check('a chatty "translation" is rejected and her own words are used', async () => {
  const { r, steps } = await run('நேரா போய் லெஃப்ட் எடுத்துட்டு ரைட்', "I'm sorry, I cannot help with that.");
  assert.equal(r.english, null);
  assert.match(steps, /1st turn left .*1st turn right/);
});
process.exit(failed ? 1 : 0);
