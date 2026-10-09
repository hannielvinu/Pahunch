// Accuracy + latency check for the on-device LLM, no browser needed.
// Run in Termux (llama-server must be running via tools/start.sh):  node tools/eval-llm.mjs
// For each note: the AI's own (checked) route vs the expected route, plus time and tokens/s.
import { parseNote, agrees } from '../js/llm.js';
import { parseRules, SAMPLES, describe } from '../js/parser.js';

// Expected routes, written as a note the rule parser reads exactly (or the sample itself).
const CASES = [
  ...Object.entries(SAMPLES).map(([lang, note]) => ({ name: `sample ${lang}`, note, expect: parseRules(note) })),
  { name: 'venue', note: "See the iQOO board and turn right see remote pc text that's the area",
    expect: parseRules('Pass the iQOO board, take the first right, then the remote pc text') },
  { name: 'hindi custom', note: 'Petrol bunk ke baad pehla right, green gate wala ghar, SBI bank ke bagal mein',
    expect: parseRules('past the petrol bunk, take the first right, then the green gate next to SBI bank') },
  { name: 'messy english', note: 'ok so u come from the bus stop side, theres a big Apollo pharmacy, dont go there, take the third right after it, our house is the yellow one in front of the park',
    expect: parseRules('From the bus stop go past Apollo pharmacy, take the third right, then the yellow house opposite the park') },
];

let ok = 0, total = 0, ms = 0, n = 0;
for (const c of CASES) {
  const res = await parseNote(c.note, { mode: 'native' });
  total++;
  const ai = res.llmGraph;
  const good = ai && agrees(ai, c.expect);
  if (good) ok++;
  if (res.stats) { ms += res.stats.ms; n++; }
  console.log(`${good ? 'PASS' : 'FAIL'}  ${c.name}  ${res.stats ? `${(res.stats.ms / 1000).toFixed(1)} s, ${res.stats.tps?.toFixed(1)} tok/s` : `(no AI: ${res.fallback})`}`);
  console.log(`      AI      : ${ai ? ai.steps.map(describe).join(' → ') : '-'}`);
  console.log(`      expected: ${c.expect.steps.map(describe).join(' → ')}`);
  console.log(`      app uses: ${res.graph.parser === 'llm' ? 'AI route' : 'rule route'}`);
  if (!good && res.stats) console.log(`      raw     : ${res.stats.out.replace(/\n/g, ' ⏎ ')}`);
}
console.log(`\nAI alone: ${ok}/${total} routes correct · mean ${(ms / Math.max(1, n) / 1000).toFixed(1)} s per route`);
