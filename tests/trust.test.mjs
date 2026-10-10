// Run: node tests/trust.test.mjs
// Pahunch only says what it can stand behind. With a stand-in llama-server that invents landmarks, this checks that
// nothing the customer didn't say reaches the plan; plus the door card phrases, "customer also said", step sources
// and the distinctive-name rule for signboards.
import assert from 'node:assert/strict';
import { parseNote } from '../js/llm.js';
import { parseRules, describe, leftovers } from '../js/parser.js';
import { ASK, QUESTIONS, PHRASE_COUNT, card } from '../js/askcard.js';
globalThis.ImageData = class {};
const { matchSigns, distinctive } = await import('../js/vision.js');

let failed = 0, passed = 0;
const check = async (name, fn) => { try { await fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); } };

let answer = '';
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/health')) return new Response('{}');
  return new Response(new Blob([`data: ${JSON.stringify({ model: 'gemma', choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`]).stream());
};
const aiPlan = async (note, out) => { answer = out; const r = await parseNote(note, { mode: 'native' }); return (r.llmGraph || r.graph).steps; };
const has = (steps, f) => steps.some((s) => [s.landmark, s.ref?.landmark].some((l) => l && f(l)));

// [customer's words, what a model might invent, what must NOT appear]
const INVENTED = [
  ['take the second left, the blue gate', 'go past the temple, take the second left, then the blue gate', (l) => l.type === 'temple'],
  ['first right then the white house', 'go past the bus stop, take the first right, then the white house', (l) => l.type === 'bus_stop'],
  ['left at the school, green gate', 'go past the hospital, go past the school, take the first left, then the green gate', (l) => l.type === 'hospital'],
  ['straight then right, red door', 'go past the park, take the first right, then the red door', (l) => l.type === 'park'],
  ['third left, yellow house', 'go past the petrol pump, take the third left, then the yellow house', (l) => l.type === 'petrol'],
  ['right after the bank, blue gate', 'go past the bank, go past the church, take the first right, then the blue gate', (l) => l.type === 'church'],
  ['first right, the white house', 'go past the Reliance store, take the first right, then the white house', (l) => /reliance/i.test(l.name || '') || l.type === 'store'],
  ['left after the temple, blue gate', 'go past the Hanuman temple, take the first left, then the blue gate', (l) => /hanuman/i.test(l.name || '')],
  ['opposite the bank, green house', 'then the green house opposite the SBI bank', (l) => /sbi/i.test(l.name || '')],
  ['second left, the gate', 'go past the Apollo pharmacy, take the second left, then the gate', (l) => /apollo/i.test(l.name || '') || l.type === 'pharmacy'],
  ['turn right near the school', 'go past the DPS school, take the first right', (l) => /dps/i.test(l.name || '')],
  ['left, then right, the house', 'go past the Ganesh temple, take the first left, take the first right, then the house', (l) => l.type === 'temple'],
  ['nera poi leftu, pachai gate veedu', 'go past the Murugan temple, take the first left, then the green gate', (l) => l.type === 'temple' || /murugan/i.test(l.name || '')],
  ['seedha jao, right lo, laal gate', 'go past the MedPlus pharmacy, take the first right, then the red gate', (l) => l.type === 'pharmacy' || /medplus/i.test(l.name || '')],
  ['second left', 'go past the bus stop, take the second left, then the blue gate', (l) => l.type === 'bus_stop' || l.type === 'gate'],
  ['நேரா போய் லெஃப்ட் எடுத்துட்டு ரைட்', 'go past the bus stop, take the first left, take the first right', (l) => l.type === 'bus_stop'],
  ['ரைட் எடுத்து பச்சை கேட் வீடு', 'go past the temple, take the first right, then the green gate', (l) => l.type === 'temple'],
  ['बाएं मुड़ो फिर दाएं, नीला गेट', 'go past the school, take the first left, take the first right, then the blue gate', (l) => l.type === 'school'],
  ['दाएं लीजिए, सफेद घर', 'go past the Ganesh temple, take the first right, then the white house', (l) => l.type === 'temple'],
  ['ಎಡಕ್ಕೆ ತಿರುಗಿ, ನೀಲಿ ಗೇಟ್', 'go past the bank, take the first left, then the blue gate', (l) => l.type === 'bank'],
  ['ഇടത്തോട്ട് തിരിയുക, ചുവന്ന ഗേറ്റ്', 'go past the park, take the first left, then the red gate', (l) => l.type === 'park'],
  ['বাঁদিকে ঘুরুন, নীল গেট', 'go past the hospital, take the first left, then the blue gate', (l) => l.type === 'hospital'],
];
let dropped = 0;
for (const [note, out, bad] of INVENTED) {
  await check(`invented landmark dropped: ${note}`, async () => {
    const steps = await aiPlan(note, out);
    assert.ok(!has(steps, bad), steps.map(describe).join(' | '));
    dropped++;
  });
}

// Door card: fixed phrases, all present in both scripts, answerable, numbers in English first.
await check(`door card: ${PHRASE_COUNT} phrases, every language complete`, () => {
  assert.equal(PHRASE_COUNT, 30);
  for (const [l, L] of Object.entries(ASK)) {
    for (const k of QUESTIONS) { assert.ok(L[k]?.[0] && L[k]?.[1], `${l}.${k}`); }
    assert.ok(L.yes.length && L.no.length && L.nums.length === 5, l);
  }
});
const gate = { kind: 'arrive', landmark: { type: 'gate', name: null, colour: 'green' }, ref: { relation: 'opposite', landmark: { type: 'pharmacy', name: 'MedPlus', colour: null } } };
await check('door card fills the place, keeps the name as said, no placeholder left', () => {
  for (const l of Object.keys(ASK)) {
    const c = card(gate, l);
    for (const line of c.lines) assert.ok(!line.native.includes('{place}') && !line.roman.includes('{place}'), `${l}: ${line.native}`);
    assert.ok(c.lines[0].native.includes('MedPlus') && c.lines[0].roman.includes('MedPlus'), l);
    assert.equal(c.nums[1][0], 'two'); // English numbers first
  }
});
await check('door card questions are yes/no or a number', () => {
  for (const l of Object.keys(ASK)) for (const k of ['gate', 'more', 'floor']) assert.ok(ASK[l][k][1].length > 5, `${l}.${k}`);
  assert.match(ASK.en.gate[0], /yes or no/); assert.match(ASK.en.more[0], /number/); assert.match(ASK.en.floor[0], /number/);
});
await check('Hindi place takes the oblique colour before "के पास"', () => {
  assert.match(card(gate, 'hi').lines[0].native, /हरे गेट/); assert.match(card(gate, 'hi').lines[0].roman, /hare gate/);
});

// Nothing silently dropped
await check('"customer also said": an unknown native-script phrase is kept, plain routes give nothing', () => {
  assert.deepEqual(leftovers('nera poi left eduthutu righu'), []);
  assert.equal(leftovers('முருகன் கோவில் தாண்டி ரைட், அந்த பழைய கிணறு பக்கத்துல பச்சை கேட் வீடு').length, 1);
});
await check('every step knows where in the note it came from, in order', () => {
  const st = parseRules('Main road se seedha aao, Ganesh mandir ke baad doosri gali mein baayen mudo, phir MedPlus medical ke saamne neela gate. Doosri manzil.').steps;
  assert.ok(st.every((s) => s.at >= 0 && s.at <= 1));
  assert.ok(st.every((s, i) => i === 0 || s.at >= st[i - 1].at));
  assert.ok(st.at(-1).at > 0.4);
});

// Signboards: ✓ only for a distinctive name
await check('common shop names are a cue, not a check', () => {
  assert.equal(matchSigns(['MEDPLUS'], { signs: ['MEDPLUS'], alt: [] }).hit, 'name');
  assert.equal(matchSigns(['SRI', 'LAKSHMI'], { signs: ['LAKSHMI'], alt: [] }).hit, 'type');
  assert.equal(matchSigns(['BALAJI'], { signs: ['BALAJI'], alt: [] }).hit, 'type');
  assert.ok(distinctive('MEDPLUS') && !distinctive('SRI') && !distinctive('VENKATESHWARA'));
});

// Cross-script signboards: a Tamil name matches an English sign; a Kannada sign matches an English name
await check('cross-script signboard matching', () => {
  const tamil = parseRules('முருகன் கோவில் தாண்டி ரைட்').steps[0].verify;
  assert.equal(matchSigns(['MURUGAN', 'TEMPLE'], tamil).hit, 'name');
  assert.equal(matchSigns(['ಮೆಡ್‌ಪ್ಲಸ್'], { signs: ['MEDPLUS'], alt: [] }).hit, 'name');
  assert.equal(matchSigns(['ಬೇಕರಿ'], { signs: ['MEDPLUS'], alt: [] }).hit, null);
});

console.log(`${passed} passed, ${failed} failed · invented landmarks dropped: ${dropped}/${INVENTED.length}`);
process.exit(failed ? 1 : 0);
