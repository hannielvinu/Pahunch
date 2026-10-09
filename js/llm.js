// On-device LLM parser. Two local backends, same prompt and same strict output check:
//   native  - llama.cpp `llama-server` running in Termux on this phone (localhost:8081, OpenAI-style API)
//   browser - transformers.js on WebGPU, model files served from ./models/
// The model answers in a few short lines (cheap to generate, easy to validate); anything off-format
// falls back to the rule parser, and landmark names not present in the customer's note are dropped.

import { LANDMARKS, verifyFor, parseRules, describe } from './parser.js';

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

function landmark(type, name, colour, note) {
  type = (dash(type) || 'other').toLowerCase().replace(/\s+/g, '_');
  if (!TYPES.has(type)) type = 'other';
  colour = dash(colour)?.toLowerCase() ?? null;
  return { type, name: grounded(dash(name), note), colour: COLOURS.has(colour) ? colour : null };
}

export function parseLines(out, note) {
  const g = { floor: null, steps: [] };
  const bad = [];
  for (const raw of out.split('\n')) {
    const line = raw.trim().replace(/^[-*\d.)\s]+(?=[A-Z])/, '');
    if (!line) continue;
    const [head, ...rest] = line.split(/\s+/);
    const body = rest.join(' ');
    const f = body.split('|');
    switch (head.toUpperCase()) {
      case 'PASS': g.steps.push({ kind: 'pass', landmark: landmark(f[0].trim().split(/\s+/)[0], f[1], f[2], note) }); break;
      case 'TURN': {
        const [dir, ord, road] = body.toLowerCase().split(/\s+/);
        if (dir !== 'left' && dir !== 'right') { bad.push(line); break; }
        const n = Math.min(4, Math.max(1, parseInt(ord, 10) || 1));
        g.steps.push({ kind: 'turn', turn: dir, ordinal: n, road: ROADS.has(road) && road !== 'turn' ? road : null });
        break;
      }
      case 'ARRIVE': {
        const lm = landmark(f[0]?.trim(), f[1], f[2], note);
        const [rel, refType] = (f[3] || '').trim().toLowerCase().split(/\s+/);
        const ref = RELATIONS.has(rel) && dash(refType) ? { relation: rel, landmark: landmark(refType, f[4], null, note) } : null;
        g.steps.push({ kind: 'arrive', landmark: lm.type === 'other' && !lm.name && !lm.colour ? null : lm, ref });
        break;
      }
      case 'FLOOR': { const n = parseInt(body, 10); if (Number.isFinite(n) && n >= 0 && n < 100) g.floor = n; break; }
      default: bad.push(line);
    }
  }
  if (!g.steps.length) throw new Error('model returned no steps');
  if (bad.length > 1) throw new Error(`model went off-format: ${bad[0]}`);
  const last = g.steps.at(-1);
  if (last.kind === 'turn') g.steps.push({ kind: 'arrive', landmark: null, ref: null });
  else last.kind = 'arrive';
  g.steps.forEach((s, i) => { if (s.kind === 'arrive' && i < g.steps.length - 1) s.kind = 'pass'; s.n = i + 1; s.verify = verifyFor(s); });
  return g;
}

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

async function runNative(note, onToken) {
  const t0 = performance.now();
  const r = await fetch(`${NATIVE_URL}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: messages(note), temperature: 0, max_tokens: 200, stream: false }),
  });
  if (!r.ok) throw new Error(`llama-server ${r.status}`);
  const j = await r.json();
  const out = j.choices?.[0]?.message?.content ?? '';
  onToken?.(out);
  const ms = Math.round(performance.now() - t0);
  return { out, ms, tokensIn: j.usage?.prompt_tokens, tokensOut: j.usage?.completion_tokens, tps: j.timings?.predicted_per_second, prefillTps: j.timings?.prompt_per_second, model: j.model || 'Qwen2.5-1.5B GGUF', backend: 'llama.cpp (native, Termux)' };
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
  const ids = await model.generate({ ...inputs, max_new_tokens: 200, do_sample: false, streamer });
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
  if (mode === 'rules') return { graph: rules, stats: null };
  let backend = mode;
  if (mode === 'auto') backend = (await nativeUp()) ? 'native' : device?.webgpu && (await hasBrowserModel()) ? 'browser' : null;
  if (!backend) return { graph: rules, stats: null, fallback: 'no on-device model running' };
  try {
    onStatus?.(backend === 'native' ? 'Asking the on-device model (llama.cpp)…' : 'Asking the on-device model (WebGPU)…');
    const stats = backend === 'native' ? await runNative(note, onToken) : await runBrowser(note, onToken, device, onProgress);
    const g = parseLines(stats.out, note);
    Object.assign(g, { lang: rules.lang, parser: 'llm', floor: g.floor ?? rules.floor });
    return { graph: g, llmGraph: g, stats, rules, agree: agrees(g, rules) };
  } catch (e) {
    console.warn('LLM parse failed, using rules', e);
    return { graph: rules, stats: null, fallback: e.message };
  }
}

export { describe };
