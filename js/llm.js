// On-device LLM parser. Two local backends, same prompt and same strict output check:
//   native  - llama.cpp `llama-server` running in Termux on this phone (localhost:8081, OpenAI-style API)
//   browser - transformers.js on WebGPU, model files served from ./models/
// The model answers in a few short lines (cheap to generate, easy to validate); anything off-format
// falls back to the rule parser, and landmark names not present in the customer's note are dropped.
// Facts a small model tends to get wrong (turn direction, ordinal, floor, relation) are checked against
// the words in the note; when the rule parser already reads a complete route, its route is used and the
// model acts as a cross-check.

import { LANDMARKS, verifyFor, parseRules, describe, COLOUR_OF, TYPE_OF, BRANDS, GENERIC, mentionsRelation, routeWords, isRoute, typeOrFamilySaid, unknownWords } from './parser.js';

const NATIVE_URL = 'http://localhost:8081';
const BROWSER_MODEL = 'Qwen2.5-1.5B-Instruct';
const TYPES = new Set([...Object.keys(LANDMARKS), 'other']);
const COLOURS = new Set('blue red green yellow white black orange pink brown grey'.split(' '));
const RELATIONS = new Set(['opposite', 'next_to', 'near', 'behind']);
const ROADS = new Set(['lane', 'cross', 'road', 'street', 'turn']);

const SYSTEM = `You turn Indian delivery directions into route steps. Input may be English, Hindi, Kannada or Tamil, romanised or in native script, often mixed.
Reply ONLY with lines in this format, nothing else:
PASS <type> | <name> | <colour>
TURN <left|right> <ordinal 1-4> <lane|cross|road|street|turn>
ARRIVE <type> | <name> | <colour> | <relation> <ref type> | <ref name>
FLOOR <number>
Use - for anything not said. One line per landmark or turn, in the order travelled. The last place is ARRIVE.
types: ${[...TYPES].join(', ')}
colours: ${[...COLOURS].join(', ')}. relations: opposite, next_to, near, behind.
name = proper name as written on a signboard, in English letters (Ganesha, MedPlus, Registration). Never invent names.
Word hints: mandir/devasthana/gudi/kovil=temple, medical=pharmacy, gali/theru=lane, baayen/edakke/idathu=left, daayen/balakke/valathu=right, doosri/eradane/rendavathu=2, teesri/mooraneya/moonavathu=3, neela/neeli=blue, laal/kempu/sivappu=red, hara/hasiru/pachai=green, saamne/edurige/ethire=opposite, bagal/pakka=next_to, ke baad/datti/thandi=after, manzil/mahadi/maadi=floor.`;

const SHOTS = [
  ['From the bus stop go past Apollo pharmacy, take the third right, the white house next to the green bank. Ground floor.',
    'PASS bus_stop | - | -\nPASS pharmacy | Apollo | -\nTURN right 3 turn\nARRIVE house | - | white | next_to bank | -\nFLOOR 0'],
  ['School ke saamne se seedha, Hanuman mandir ke baad pehli gali mein daayen, laal gate wala ghar, teesri manzil',
    'PASS school | - | -\nPASS temple | Hanuman | -\nTURN right 1 lane\nARRIVE gate | - | red | - - | -\nFLOOR 3'],
];

// Structured output (llama.cpp turns this schema into a grammar, so every answer parses).
const COLOUR_ENUM = ['', ...COLOURS];
export const SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array', minItems: 1, maxItems: 8,
      items: {
        type: 'object',
        properties: {
          kind: { enum: ['pass', 'turn', 'arrive'] },
          place: { type: 'string', maxLength: 40 },
          colour: { enum: COLOUR_ENUM },
          turn: { enum: ['', 'left', 'right'] },
          n: { type: 'integer', minimum: 0, maximum: 4 },
          rel: { enum: ['', 'opposite', 'next_to', 'near', 'behind'] },
          ref: { type: 'string', maxLength: 40 },
        },
        required: ['kind', 'place', 'colour', 'turn', 'n', 'rel', 'ref'],
      },
    },
    floor: { type: 'integer', minimum: -1, maximum: 60 },
  },
  required: ['steps', 'floor'],
};

const SYSTEM_JSON = `You convert directions to a house, shop or spot into route steps, in the order travelled.
Input can be English, Hindi, Kannada, Tamil, Malayalam (romanised, native script or mixed) or an English translation of speech.
Each step: kind = pass (a landmark you go past or reach), turn (a turn), arrive (the destination; always the last step).
place = the landmark in plain English words as you would read it on a sign or see it: "Ganesha temple", "MedPlus pharmacy", "coffee machine", "registration desk", "black chair". Use the customer's own proper names; never invent names. Empty for turns.
colour = colour of that landmark if said. turn = left/right for turns. n = which turn (1 first, 2 second...), 0 if not a turn.
rel/ref = for the destination only: its relation to another landmark ("blue gate opposite MedPlus" -> rel opposite, ref "MedPlus pharmacy").
floor = floor number if said (ground = 0), otherwise -1.
Word hints: mandir/devasthana/gudi/kovil/kshetram=temple, medical=pharmacy, gali/theru/rasta/road=lane, baayen/edakke/idathu/idathottu=left, daayen/balakke/valathu/valathottu=right, pehli/modala/mudhal=1, doosri/eradane/rendavathu/randamathe=2, teesri/mooraneya/moonavathu=3, neela/neeli=blue, laal/kempu/sivappu/chuvanna=red, hara/hasiru/pachai/pacha=green, peela/haladi/manjal=yellow, saamne/edurige/ethire/ethirvasham=opposite, bagal/pakka/pakkathu=next_to, ke baad/datti/thandi/kazhinju=after, manzil/mahadi/maadi/nila=floor.`;

const SHOTS_JSON = [
  ['From the bus stop go past Apollo pharmacy, take the third right, the white house next to the green bank. Ground floor.',
    { steps: [{ kind: 'pass', place: 'bus stop', colour: '', turn: '', n: 0, rel: '', ref: '' }, { kind: 'pass', place: 'Apollo pharmacy', colour: '', turn: '', n: 0, rel: '', ref: '' }, { kind: 'turn', place: '', colour: '', turn: 'right', n: 3, rel: '', ref: '' }, { kind: 'arrive', place: 'house', colour: 'white', turn: '', n: 0, rel: 'next_to', ref: 'green bank' }], floor: 0 }],
  ['School ke saamne se seedha, Hanuman mandir ke baad pehli gali mein daayen, laal gate wala ghar, teesri manzil',
    { steps: [{ kind: 'pass', place: 'school', colour: '', turn: '', n: 0, rel: '', ref: '' }, { kind: 'pass', place: 'Hanuman temple', colour: '', turn: '', n: 0, rel: '', ref: '' }, { kind: 'turn', place: '', colour: '', turn: 'right', n: 1, rel: '', ref: '' }, { kind: 'arrive', place: 'gate', colour: 'red', turn: '', n: 0, rel: '', ref: '' }], floor: 3 }],
  ['walk to the registration desk, turn left at the coffee machine, the black chair near the stage is my spot',
    { steps: [{ kind: 'pass', place: 'registration desk', colour: '', turn: '', n: 0, rel: '', ref: '' }, { kind: 'pass', place: 'coffee machine', colour: '', turn: '', n: 0, rel: '', ref: '' }, { kind: 'turn', place: '', colour: '', turn: 'left', n: 1, rel: '', ref: '' }, { kind: 'arrive', place: 'chair', colour: 'black', turn: '', n: 0, rel: 'near', ref: 'stage' }], floor: -1 }],
  ['Bus stand la irundhu nera vaanga, Murugan kovil thandi rendavathu theru valathu, pachai gate veedu',
    { steps: [{ kind: 'pass', place: 'bus stand', colour: '', turn: '', n: 0, rel: '', ref: '' }, { kind: 'pass', place: 'Murugan temple', colour: '', turn: '', n: 0, rel: '', ref: '' }, { kind: 'turn', place: '', colour: '', turn: 'right', n: 2, rel: '', ref: '' }, { kind: 'arrive', place: 'gate', colour: 'green', turn: '', n: 0, rel: '', ref: '' }], floor: -1 }],
];

export function messagesJson(note) {
  const m = [{ role: 'system', content: SYSTEM_JSON }];
  for (const [q, a] of SHOTS_JSON) m.push({ role: 'user', content: q }, { role: 'assistant', content: JSON.stringify(a) });
  m.push({ role: 'user', content: note });
  return m;
}

// "Ganesha temple" -> { type: temple, name: Ganesha }; "coffee machine" -> { type: other, name: coffee machine }
function placeToLandmark(place, colour, note) {
  const words = (place || '').replace(/[^\p{L}\d&' ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  let type = null, rest = [], c = colour || null;
  for (const w of words) {
    const lw = w.toLowerCase();
    if (!c && COLOUR_OF[lw]) { c = COLOUR_OF[lw]; continue; }
    const brand = BRANDS[lw];
    if (brand) { type ??= brand[0]; rest.push(brand[1]); continue; }
    const tw = typeOf(lw);
    if (tw) { type ??= tw; continue; }             // a second type word ("gate house") adds nothing for the camera
    if (/^(stand|station|stop|area|side|road|building|place)$/i.test(lw)) continue;  // "bus stand" is just the bus stop
    rest.push(w);
  }
  const name = cleanName(rest.join(' '), note) || (type ? null : cleanName(words.join(' '), note));
  return { type: type || 'other', name, colour: c && COLOURS.has(c) ? c : null };
}

export function parseJson(out, note) {
  let j;
  try { j = JSON.parse(out); } catch { throw new Error('model answer was not complete JSON'); }
  const steps = [];
  for (const s of (j.steps || []).slice(0, MAX_STEPS)) {
    if (s.kind === 'turn') {
      if (s.turn !== 'left' && s.turn !== 'right') continue;
      steps.push({ kind: 'turn', turn: s.turn, ordinal: Math.min(4, Math.max(1, s.n || 1)), road: null });
      continue;
    }
    const lm = placeToLandmark(s.place, s.colour, note);
    let ref = null;
    if (s.kind === 'arrive' && s.rel && s.ref && mentionsRelation(note)) ref = { relation: s.rel, landmark: placeToLandmark(s.ref, '', note) };
    if (empty(lm) && !ref && s.kind !== 'arrive') continue;
    steps.push({ kind: s.kind === 'arrive' ? 'arrive' : 'pass', landmark: empty(lm) ? null : lm, ref });
  }
  if (!steps.some((s) => s.kind === 'turn' || !empty(s.landmark))) throw new Error('model found no landmarks or turns');
  const g = { floor: Number.isInteger(j.floor) && j.floor >= 0 ? j.floor : null, steps };
  const last = g.steps.at(-1);
  if (last.kind === 'turn') g.steps.push({ kind: 'arrive', landmark: null, ref: null });
  else last.kind = 'arrive';
  g.steps.forEach((s, i) => { if (s.kind === 'arrive' && i < g.steps.length - 1) s.kind = 'pass'; s.n = i + 1; s.verify = verifyFor(s); });
  return g;
}

// Rewriter: the model's only job is to restate the directions as one plain English sentence in a fixed
// vocabulary ("go past the X, take the second left, then the X opposite the Y, second floor"). Small models
// do this well (it is translation + simplification, using the context of the whole message); the exact rule
// engine then turns that sentence into steps.
const SYSTEM_REWRITE = `You rewrite directions to a house, shop or spot as ONE short line of plain English, in the order travelled.
The input may be English, Hindi, Tamil, Kannada, Malayalam or a mix, in any script, and may ramble.
Use only these phrases, joined by commas:
"go past the <landmark>", "take the first|second|third|fourth left|right", "then the <colour> <landmark> opposite|next to|near the <landmark>", "<number> floor".
Keep the customer's proper names (temple names, shop names) in English letters. Translate colours and landmark words to English (mandir/kovil = temple, medical = pharmacy, gate, house, shop).
Keep the starting point as a landmark ("from the bus stop side" = "go past the bus stop"). A place they say not to enter or not to turn at is still a landmark to go past ("there is Apollo pharmacy, don't go there" = "go past the Apollo pharmacy"). Leave out filler. Never add landmarks that were not said: if only turns are said, write only the turns. Output only the line.`;

const SHOTS_REWRITE = [
  ['Main road se seedha aao, Ganesh mandir ke baad doosri gali mein baayen mudo, phir MedPlus medical ke saamne neela gate. Doosri manzil.',
    'go past the Ganesh temple, take the second left, then the blue gate opposite the MedPlus pharmacy, second floor'],
  ['நேரா போங்க, முருகன் கோவில் தாண்டி ரெண்டாவது தெருவுல ரைட், அந்த பச்சை கேட் வீடு',
    'go past the Murugan temple, take the second right, then the green gate'],
  ['bus stand kitta irundhu straight-ah vaanga, left cut pannunga, Apollo pharmacy pakkathula manjal veedu',
    'go past the bus stand, take the first left, then the yellow house next to the Apollo pharmacy'],
  ['ok so u come from the metro side, theres a big Reliance store, dont go inside, take the third right after it, our house is the white one in front of the park, 2nd floor',
    'go past the metro station, go past the Reliance store, take the third right, then the white house opposite the park, second floor'],
  ['nera poi left eduthutu appuram rightu',
    'take the first left, take the first right'],
  ['walk to the registration desk, then left at the coffee machine and you will see the black chair near the stage',
    'go past the registration desk, go past the coffee machine, take the first left, then the black chair near the stage'],
];

// The rewriter must answer with a route line in its fixed phrasing. A chat reply ("I am doing well, thank you for
// asking!"), a question, a refusal or an explanation is not a route and is thrown away.
export function rewriteOk(line) {
  const l = (line || '').toLowerCase().trim();
  if (!l || l.length > 300 || l.includes('?')) return false;
  if (/\b(i|i'm|im|me|you|your|sorry|hello|hi|hey|thank|thanks|assistant|language model|cannot|can't|unable|please|help)\b/.test(l)) return false;
  return /^(go|take|then|turn|walk|from|pass|cross|continue|keep|reach|after|at|the|first|second|third|fourth|ground|\d)\b/.test(l);
}

export function messagesRewrite(note) {
  const m = [{ role: 'system', content: SYSTEM_REWRITE }];
  for (const [q, a] of SHOTS_REWRITE) m.push({ role: 'user', content: q }, { role: 'assistant', content: a });
  m.push({ role: 'user', content: note });
  return m;
}

export function messages(note) {
  const m = [{ role: 'system', content: SYSTEM }];
  for (const [q, a] of SHOTS) m.push({ role: 'user', content: q }, { role: 'assistant', content: a });
  m.push({ role: 'user', content: note });
  return m;
}

// ---------- Output -> step graph (strict) ----------

const dash = (s) => { const t = (s ?? '').trim(); return !t || t === '-' ? null : t; };
const fold = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

// A name must be something the customer actually said (allowing one letter off, e.g. Ganesh/Ganesha).
function grounded(name, note) {
  if (!name) return null;
  if (/[^\u0000-ɏ]/.test(note)) return name; // native script note: names are transliterated, can't string-check
  const hay = note.split(/\s+/).map(fold);
  const ok = name.split(/\s+/).map(fold).filter(Boolean).every((w) => hay.some((h) => h === w || (w.length >= 5 && (h.startsWith(w) || w.startsWith(h))) || (w.length >= 4 && Math.abs(h.length - w.length) <= 1 && [...w].filter((c, i) => h[i] !== c).length <= 1)));
  return ok ? name : null;
}

// Map whatever word the model used for a type onto ours ("medical" -> pharmacy, "MedPlus" -> pharmacy).
function typeOf(word) {
  const w = (dash(word) || '').toLowerCase().replace(/\s+/g, '_');
  if (TYPES.has(w)) return w;
  return TYPE_OF[w] || BRANDS[w]?.[0] || null;
}

function cleanName(name, note) {
  const n = grounded(dash(name), note);
  return n && !n.toLowerCase().split(/\s+/).every((w) => GENERIC.has(w)) ? n : null;
}

function landmark(type, name, colour, note) {
  const c = dash(colour)?.toLowerCase() ?? null;
  const mapped = COLOUR_OF[c] || c;
  return { type: typeOf(type) || 'other', name: cleanName(name, note), colour: COLOURS.has(mapped) ? mapped : null };
}

const MAX_STEPS = 10;
const empty = (lm) => !lm || (lm.type === 'other' && !lm.name && !lm.colour);

// Small models sometimes loop on one line; stop reading at the first repeat.
export function looping(out) {
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > MAX_STEPS + 1 || lines.some((l, i) => i > 0 && l === lines[i - 1]);
}

export function parseLines(out, note) {
  const g = { floor: null, steps: [] };
  const bad = [];
  const seen = new Set();
  let looped = false;
  for (const raw of out.split('\n')) {
    const line = raw.trim().replace(/^[-*\d.)\s]+(?=[A-Z])/, '');
    if (!line) continue;
    if (seen.has(line)) { looped = true; break; } // the model is looping; keep what came before
    seen.add(line);
    const [head, ...rest] = line.split(/\s+/);
    const body = rest.join(' ');
    const f = body.split('|');
    switch (head.toUpperCase()) {
      case 'PASS': {
        const lm = landmark(f[0].trim().split(/\s+/)[0], f[1], f[2], note);
        if (empty(lm)) bad.push(line); // "PASS other | - | -" carries nothing the camera could check
        else g.steps.push({ kind: 'pass', landmark: lm });
        break;
      }
      case 'TURN': {
        const [dir, ord, road] = body.toLowerCase().split(/\s+/);
        if (dir !== 'left' && dir !== 'right') { bad.push(line); break; }
        const n = Math.min(4, Math.max(1, parseInt(ord, 10) || 1));
        g.steps.push({ kind: 'turn', turn: dir, ordinal: n, road: ROADS.has(road) && road !== 'turn' ? road : null });
        break;
      }
      case 'ARRIVE': {
        const lm = landmark(f[0]?.trim(), f[1], f[2], note);
        // "opposite pharmacy | MedPlus" is the format; also accept "next_to MedPlus | Medical".
        // A relation the note never mentions is dropped.
        const [rel, refWord] = (f[3] || '').trim().split(/\s+/);
        let ref = null;
        if (RELATIONS.has(rel?.toLowerCase()) && dash(refWord) && mentionsRelation(note)) {
          const brand = BRANDS[refWord.toLowerCase()];
          const lm = brand ? landmark(brand[0], brand[1], null, note) : landmark(typeOf(refWord) || typeOf(f[4]), typeOf(refWord) ? f[4] : refWord, null, note);
          ref = { relation: rel.toLowerCase(), landmark: lm };
        }
        g.steps.push({ kind: 'arrive', landmark: empty(lm) ? null : lm, ref });
        break;
      }
      case 'FLOOR': { const n = parseInt(body, 10); if (Number.isFinite(n) && n >= 0 && n < 100) g.floor = n; break; }
      default: bad.push(line);
    }
  }
  if (bad.length > 1 || (looped && bad.length)) throw new Error(`model went off-format: ${bad[0]}`);
  if (g.steps.length > MAX_STEPS) throw new Error(`model returned ${g.steps.length} steps`);
  if (!g.steps.some((s) => s.kind === 'turn' || !empty(s.landmark) || s.ref)) throw new Error('model found no landmarks or turns');
  const last = g.steps.at(-1);
  if (last.kind === 'turn') g.steps.push({ kind: 'arrive', landmark: null, ref: null });
  else last.kind = 'arrive';
  g.steps.forEach((s, i) => { if (s.kind === 'arrive' && i < g.steps.length - 1) s.kind = 'pass'; s.n = i + 1; s.verify = verifyFor(s); });
  return g;
}

// Replace what the model guessed with what the note actually says: turn directions and ordinals come
// from the rule parser's reading of the turn words; the floor only if a floor word is present.
export function ground(g, rules) {
  const ruleTurns = rules.steps.filter((s) => s.kind === 'turn');
  let k = 0;
  const steps = [];
  for (const s of g.steps) {
    if (s.kind !== 'turn') { steps.push(s); continue; }
    if (k < ruleTurns.length) { const r = ruleTurns[k++]; steps.push({ ...s, turn: r.turn, ordinal: r.ordinal, road: r.road ?? s.road }); }
    else if (!ruleTurns.length) steps.push(s); // rules saw no turn words (unfamiliar wording): trust the model
    // otherwise: a turn the note has no word for is dropped
  }
  while (k < ruleTurns.length) steps.splice(Math.max(0, steps.length - 1), 0, { ...ruleTurns[k++] });
  // The relation word (opposite / next to) is also read from the note when the rules found one.
  const rRef = rules.steps.at(-1)?.ref, last = steps.at(-1);
  if (rRef && last?.ref) last.ref = { ...last.ref, relation: rRef.relation };
  const out = { ...g, floor: rules.floor ?? g.floor, steps };
  out.steps.forEach((s, i) => { s.n = i + 1; s.verify = verifyFor(s); });
  return out;
}

// The rule parser read every step: a known destination, and every step is a turn or has a landmark.
export const complete = (rules) => !!rules.steps.at(-1)?.landmark && rules.steps.every((s) => s.kind === 'turn' || s.landmark);

// Same route? Compare step kinds, turn directions/ordinals and landmark types.
export function agrees(a, b) {
  const sig = (g) => g.steps.map((s) => (s.kind === 'turn' ? `T${s.turn[0]}${s.ordinal}` : `${s.kind[0]}:${s.landmark?.type || '-'}`)).join(' ');
  return sig(a) === sig(b);
}

// ---------- Backends ----------

async function nativeUp() {
  try {
    const r = await fetch(`${NATIVE_URL}/health`, { signal: AbortSignal.timeout(600) });
    return r.ok;
  } catch { return false; }
}

// cache_prompt keeps the system prompt + examples in llama.cpp's KV cache, so after the first call
// only the customer's note has to be read.
// Measured on the phone: the JSON-schema answer was ~3x longer (8.3 s/route) and no more accurate for a
// 1.5B model, so the short line format (~2 s) is the default. NATIVE_JSON = true switches back.
const NATIVE_JSON = false;
const NATIVE_REWRITE = true; // rewriter (plain English line -> rules); false = the older line format
const nativeBody = (note, extra) => JSON.stringify(NATIVE_REWRITE
  // chat_template_kwargs: Qwen3 models would otherwise "think" first (slow); other chat templates ignore it.
  ? { messages: messagesRewrite(note), temperature: 0, max_tokens: 90, cache_prompt: true, chat_template_kwargs: { enable_thinking: false }, ...extra }
  : NATIVE_JSON
  ? { messages: messagesJson(note), temperature: 0, max_tokens: 320, cache_prompt: true, response_format: { type: 'json_schema', json_schema: { name: 'route', schema: SCHEMA } }, ...extra }
  : { messages: messages(note), temperature: 0, max_tokens: 120, cache_prompt: true, ...extra });

// Fill the prompt cache in the background so the first real request is fast.
// Returns a short name of the model llama-server has loaded ("Gemma 3n E2B"), or false when it isn't running.
export async function warmNative() {
  if (!(await nativeUp())) return false;
  fetch(`${NATIVE_URL}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: nativeBody('go straight', { max_tokens: 1 }) }).catch(() => {});
  try {
    const r = await fetch(`${NATIVE_URL}/v1/models`, { signal: AbortSignal.timeout(1500) });
    return modelName((await r.json()).data?.[0]?.id);
  } catch { return 'on-device LLM'; }
}
// Where llama-server runs: tools/start.sh writes .llm-device ("npu") when the Hexagon NPU build started.
export async function llmDevice() {
  try { const r = await fetch('.llm-device', { cache: 'no-store' }); return r.ok && (await r.text()).trim() === 'npu' ? 'Hexagon NPU' : 'CPU'; } catch { return 'CPU'; }
}
export function modelName(id = '') {
  const f = id.split(/[\\/]/).pop().toLowerCase();
  if (f.includes('gemma-3n')) return 'Gemma 3n E2B';
  if (f.includes('qwen3-4b')) return 'Qwen3-4B';
  if (f.includes('qwen3-1.7b')) return 'Qwen3-1.7B';
  if (f.includes('qwen2.5')) return 'Qwen2.5-1.5B';
  return 'on-device LLM';
}

async function runNative(note, onToken) {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const post = (extra) => fetch(`${NATIVE_URL}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
    body: nativeBody(note, { stream: true, stream_options: { include_usage: true }, ...extra }),
  });
  let r = await post();
  // Older llama.cpp builds may not take the schema option: retry with the examples alone (still JSON).
  if (!r.ok && r.status >= 400 && r.status < 500) r = await post({ response_format: undefined });
  if (!r.ok) throw new Error(`llama-server ${r.status}`);
  // Server-sent events: one JSON chunk per token; the last chunks carry usage and timings.
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', out = '', usage = {}, timings = {}, model, first = 0, chunks = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split('\n\n');
      buf = events.pop();
      for (const ev of events) {
        const data = ev.replace(/^data: ?/, '').trim();
        if (!data || data === '[DONE]') continue;
        const j = JSON.parse(data);
        model ??= j.model;
        if (j.usage) usage = j.usage;
        if (j.timings) timings = j.timings;
        const t = j.choices?.[0]?.delta?.content;
        if (t) { first ||= performance.now(); chunks++; out += t; onToken?.(out); }
      }
      if (looping(out)) { ctrl.abort(); break; }
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }
  const ms = Math.round(performance.now() - t0);
  // Streaming puts token counts in `timings` (prompt_n excludes cached tokens); an aborted stream has neither.
  const tokensIn = usage.prompt_tokens ?? (timings.prompt_n != null ? timings.prompt_n + (timings.cache_n || 0) : undefined);
  const genSecs = first ? (performance.now() - first) / 1000 : 0;
  return { out, ms, tokensIn, tokensOut: usage.completion_tokens ?? timings.predicted_n ?? chunks, cached: timings.cache_n, tps: timings.predicted_per_second ?? (genSecs ? chunks / genSecs : undefined), prefillTps: timings.prompt_per_second, model: model || 'Qwen2.5-1.5B GGUF', backend: 'llama.cpp (native, Termux)' };
}

let tf = null, browser = null;

export async function loadBrowser({ f16, onProgress } = {}) {
  if (browser) return browser;
  tf ??= await import('../lib/transformers/transformers.min.js');
  tf.env.allowRemoteModels = false;
  tf.env.allowLocalModels = true;
  tf.env.localModelPath = new URL('models/', location.href).href;
  tf.env.backends.onnx.wasm.wasmPaths = new URL('lib/transformers/', location.href).href;
  const dtype = f16 ? 'q4f16' : 'q4'; // this phone's Adreno exposes no shader-f16 to Chrome, so q4 (fp32 maths)
  const t0 = performance.now();
  const files = {};
  const progress = (p) => {
    if (p.status === 'progress' && p.total) files[p.file] = [p.loaded, p.total];
    const [l, t] = Object.values(files).reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
    onProgress?.(t ? l / t : 0, p);
  };
  const tokenizer = await tf.AutoTokenizer.from_pretrained(BROWSER_MODEL);
  const model = await tf.AutoModelForCausalLM.from_pretrained(BROWSER_MODEL, { dtype, device: 'webgpu', progress_callback: progress });
  browser = { tokenizer, model, dtype, loadMs: Math.round(performance.now() - t0) };
  return browser;
}

async function runBrowser(note, onToken, device, onProgress) {
  const { tokenizer, model, dtype } = await loadBrowser({ f16: device?.f16, onProgress });
  const inputs = tokenizer.apply_chat_template(messages(note), { add_generation_prompt: true, return_dict: true });
  const tokensIn = inputs.input_ids.dims.at(-1);
  let text = '', first = 0, n = 0;
  const streamer = new tf.TextStreamer(tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: (t) => { first ||= performance.now(); n++; text += t; onToken?.(text); } });
  const t0 = performance.now();
  const ids = await model.generate({ ...inputs, max_new_tokens: 120, do_sample: false, streamer });
  const ms = Math.round(performance.now() - t0);
  const outIds = ids.slice(null, [tokensIn, null]);
  const out = tokenizer.batch_decode(outIds, { skip_special_tokens: true })[0];
  const tokensOut = outIds.dims.at(-1);
  const genMs = first ? performance.now() - first : ms;
  return { out, ms, tokensIn, tokensOut, tps: tokensOut / Math.max(0.001, genMs / 1000), prefillTps: first ? tokensIn / ((first - t0) / 1000) : null, model: `${BROWSER_MODEL} ${dtype}`, backend: 'transformers.js (WebGPU)' };
}

export async function hasBrowserModel() {
  try { return (await fetch(`models/${BROWSER_MODEL}/config.json`, { method: 'HEAD' })).ok; } catch { return false; }
}

// mode: 'auto' | 'native' | 'browser' | 'rules'. Always returns a usable graph.
export async function parseNote(note, { mode = 'auto', device, onToken, onStatus, onProgress } = {}) {
  const rules = parseRules(note);
  // Small talk or anything without a single route word ("hi how are you"): nothing to plan, and the model is not
  // asked at all (a chat model would chat back).
  if (!routeWords(note)) return { graph: rules, stats: null, notRoute: true };
  if (mode === 'rules') return { graph: rules, stats: null };
  // The rules understood every word: their route is exact and instant, the model could only add risk.
  if (mode === 'auto' && isRoute(rules) && !unknownWords(note, rules).length) return { graph: rules, stats: null, sure: true };
  let backend = mode;
  if (mode === 'auto') backend = (await nativeUp()) ? 'native' : device?.webgpu && (await hasBrowserModel()) ? 'browser' : null;
  if (!backend) return { graph: rules, stats: null, fallback: 'no on-device model running' };
  let stats = null;
  try {
    onStatus?.(backend === 'native' ? 'Asking the on-device model (llama.cpp)…' : 'Asking the on-device model (WebGPU)…');
    stats = backend === 'native' ? await runNative(note, onToken) : await runBrowser(note, onToken, device, onProgress);
    if (backend === 'native' && NATIVE_REWRITE) {
      // First real line of the answer, ignoring any <think>…</think> block some models emit.
      const line = (stats.out.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').split('\n').map((l) => l.trim()).find(Boolean) || '').replace(/^["'\s]+|["'\s]+$/g, '');
      if (!rewriteOk(line)) throw new Error('model did not answer with a route');
      const rw = parseRules(line);
      // Names in the rewrite must come from the customer's words (skipped for native-script notes: transliterated).
      for (const s of rw.steps) for (const lm of [s.landmark, s.ref?.landmark]) if (lm?.name) lm.name = cleanName(lm.name, note);
      // A landmark type the customer never mentioned was invented: drop it. In Latin letters a name of theirs can
      // stand on its own (checked above); in native script names can't be string-checked, so the type must be said.
      const latin = !/[^\u0000-ɏ]/.test(note);
      const invented = (lm) => lm && lm.type !== 'other' && (!latin || !lm.name) && !typeOrFamilySaid(note, lm.type);
      for (const s of rw.steps) {
        if (invented(s.landmark)) s.landmark = null;
        if (invented(s.ref?.landmark)) s.ref = null;
        if (s.landmark && s.landmark.type === 'other' && !s.landmark.name && !s.landmark.colour) s.landmark = null;
      }
      // A landmark whose name was dropped and that has no type, colour or relation left says nothing: remove it.
      rw.steps = rw.steps.filter((s) => s.kind === 'turn' || s.ref || (s.landmark && (s.landmark.name || s.landmark.colour || s.landmark.type !== 'other')) || s === rw.steps.at(-1));
      rw.steps.forEach((s) => { s.verify = verifyFor(s); });
      const g = ground(rw, rules);
      if (!isRoute(g)) throw new Error('model found no route');
      Object.assign(g, { lang: rules.lang, parser: 'llm', rewrite: line });
      const agree = agrees(g, rules);
      const turns = (x) => x.steps.filter((s) => s.kind === 'turn').length;
      // Rules exact and complete + same route: use them. Otherwise the AI's reading of the context wins when it
      // is complete and its turn count matches what the note says.
      const useAI = !complete(rules) ? complete(g) || g.steps.length > 1 : !agree && complete(g) && (turns(g) === turns(rules) || turns(rules) === 0);
      return { graph: useAI ? g : rules, llmGraph: g, stats, rules, agree, rewrite: line };
    }
    const g = ground(backend === 'native' && NATIVE_JSON ? parseJson(stats.out, note) : parseLines(stats.out, note), rules);
    Object.assign(g, { lang: rules.lang, parser: 'llm' });
    const agree = agrees(g, rules);
    return { graph: complete(rules) ? rules : g, llmGraph: g, stats, rules, agree };
  } catch (e) {
    console.warn('LLM parse failed, using rules', e);
    return { graph: rules, stats, fallback: e.message }; // stats kept so the raw output can be inspected
  }
}

// ---------- Customer's words -> English -> route ----------
// Step 1: a faithful English translation of the customer's directions, on this phone (Gemma 3n). Names stay as said,
// and every turn, ordinal, colour, relation and floor is kept exactly: those are what the route is built from.
const SYSTEM_EN = `You translate a customer's delivery directions into plain English for a delivery rider.
The input may be Tamil, Hindi, Kannada, Malayalam, Bengali, English or a mix, in any script.
Translate faithfully and completely, in the same order. Keep every landmark, shop, temple and street name as it is, in English letters.
Keep left/right, first/second/third, colours, opposite / next to / near / behind / after, and floor numbers exactly as said.
Do not add, explain or summarise anything. Output only the English, on one line.`;
const SHOTS_EN = [
  ['முருகன் கோவில் தாண்டி ரெண்டாவது தெருவுல ரைட், MedPlus எதிரே பச்சை கேட் வீடு, ரெண்டாவது மாடி',
    'After the Murugan temple, take the second street on the right; the house with the green gate opposite MedPlus, second floor.'],
  ['Main road se seedha aao, Ganesh mandir ke baad doosri gali mein baayen, MedPlus ke saamne neela gate',
    'Come straight from the main road; after the Ganesh temple, take the second lane on the left; the blue gate opposite MedPlus.'],
  ['ಬ್ಯಾಂಕ್ ದಾಟಿ ಎಡಕ್ಕೆ ತಿರುಗಿ, ಶಾಲೆ ಎದುರು ನೀಲಿ ಗೇಟ್ ಮನೆ, ಮೂರನೇ ಮಹಡಿ',
    'After the bank, turn left; the house with the blue gate opposite the school, third floor.'],
];
export async function toEnglish(text) {
  if (!text?.trim()) return null;
  try {
    const messages = [{ role: 'system', content: SYSTEM_EN }];
    for (const [q, ans] of SHOTS_EN) messages.push({ role: 'user', content: q }, { role: 'assistant', content: ans });
    messages.push({ role: 'user', content: text });
    const r = await fetch(`${NATIVE_URL}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ messages, temperature: 0, max_tokens: 160, cache_prompt: true, chat_template_kwargs: { enable_thinking: false } }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const out = (j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').split('\n').map((l) => l.trim()).find(Boolean) || '';
    const clean = out.replace(/^["'\s]+|["'\s]+$/g, '');
    // A chat reply or a refusal is not a translation.
    return clean && !/\b(i am|i'm|sorry|cannot|as an ai|language model)\b/i.test(clean) ? clean : null;
  } catch { return null; }
}

// Step 2: understand the route from the English, and cross-check it against the customer's own words.
// -> parseNote's result plus { english }. Turns, ordinals and floor that the rules read in her own words win
// over the translation (ground()); if her words alone were fully understood, that exact reading is kept.
export async function understandNote(note, opts = {}) {
  const own = parseRules(note);
  const t0 = performance.now();
  const english = /[^\u0000-ɏ]/.test(note) || own.lang !== 'en' ? await toEnglish(note) : null;
  const translateMs = Math.round(performance.now() - t0);
  if (!english) return { ...(await parseNote(note, opts)), english: null };
  opts.onStatus?.('Understanding the route…');
  const res = await parseNote(english, { ...opts, mode: opts.mode === 'rules' ? 'rules' : 'auto' });
  if (res.notRoute || !isRoute(res.graph)) return { ...(await parseNote(note, opts)), english };
  const sure = isRoute(own) && !unknownWords(note, own).length;
  const graph = sure ? own : Object.assign(ground(res.graph, own), { lang: own.lang, parser: res.graph.parser });
  return { ...res, graph, rules: own, english, translateMs, sure, agree: agrees(res.graph, own) };
}

export { describe };

// ---------- Translation (Call mode captions in the rider's language), same on-device model ----------
const LANG_NAME = { en: 'English', hi: 'Hindi', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', bn: 'Bengali' };

// -> translated text, or null if the on-device model is not running / fails (captions still show the original).
export async function translateLine(text, lang) {
  if (!text || !LANG_NAME[lang]) return null;
  try {
    const r = await fetch(`${NATIVE_URL}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        messages: [
          { role: 'system', content: `Translate what the customer says into simple ${LANG_NAME[lang]} for a delivery rider. Keep shop, temple and street names as they are. Output only the translation, one line.` },
          { role: 'user', content: text },
        ],
        temperature: 0, max_tokens: 140, cache_prompt: true, chat_template_kwargs: { enable_thinking: false },
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const out = (j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').split('\n').map((l) => l.trim()).find(Boolean);
    return out || null;
  } catch { return null; }
}
