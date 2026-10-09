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
        const [rel, refType] = (f[3] || '').trim().toLowerCase().split(/\s+/);
        const ref = RELATIONS.has(rel) && dash(refType) ? { relation: rel, landmark: landmark(refType, f[4], null, note) } : null;
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
const nativeBody = (note, extra) => JSON.stringify({ messages: messages(note), temperature: 0, max_tokens: 120, cache_prompt: true, ...extra });

// Fill the prompt cache in the background so the first real request is fast.
export async function warmNative() {
  if (!(await nativeUp())) return false;
  fetch(`${NATIVE_URL}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: nativeBody('go straight', { max_tokens: 1 }) }).catch(() => {});
  return true;
}

async function runNative(note, onToken) {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const r = await fetch(`${NATIVE_URL}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
    body: nativeBody(note, { stream: true, stream_options: { include_usage: true } }),
  });
  if (!r.ok) throw new Error(`llama-server ${r.status}`);
  // Server-sent events: one JSON chunk per token; the last chunks carry usage and timings.
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', out = '', usage = {}, timings = {}, model, first = 0;
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
        if (t) { first ||= performance.now(); out += t; onToken?.(out); }
      }
      if (looping(out)) { ctrl.abort(); break; }
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }
  const ms = Math.round(performance.now() - t0);
  return { out, ms, tokensIn: usage.prompt_tokens, tokensOut: usage.completion_tokens, cached: timings.cache_n, tps: timings.predicted_per_second, prefillTps: timings.prompt_per_second, model: model || 'Qwen2.5-1.5B GGUF', backend: 'llama.cpp (native, Termux)' };
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
  if (mode === 'rules') return { graph: rules, stats: null };
  let backend = mode;
  if (mode === 'auto') backend = (await nativeUp()) ? 'native' : device?.webgpu && (await hasBrowserModel()) ? 'browser' : null;
  if (!backend) return { graph: rules, stats: null, fallback: 'no on-device model running' };
  let stats = null;
  try {
    onStatus?.(backend === 'native' ? 'Asking the on-device model (llama.cpp)…' : 'Asking the on-device model (WebGPU)…');
    stats = backend === 'native' ? await runNative(note, onToken) : await runBrowser(note, onToken, device, onProgress);
    const g = parseLines(stats.out, note);
    Object.assign(g, { lang: rules.lang, parser: 'llm', floor: g.floor ?? rules.floor });
    return { graph: g, llmGraph: g, stats, rules, agree: agrees(g, rules) };
  } catch (e) {
    console.warn('LLM parse failed, using rules', e);
    return { graph: rules, stats, fallback: e.message }; // stats kept so the raw output can be inspected
  }
}

export { describe };
