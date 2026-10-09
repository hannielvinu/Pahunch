import { SAMPLES, describe } from './parser.js';
import { parseNote, warmNative } from './llm.js';
import { Vision, matchSigns } from './vision.js';
import { say, text, buzz, Compass, TurnDetector } from './guide.js';
import { deviceReport, describeDevice } from './device.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

const state = { inferences: [], graph: null, i: 0, lang: 'en', asking: false, askCooldown: 0, signSeenAt: 0, startedAt: 0, running: false };
const vision = new Vision($('#video'));
const compass = new Compass();
compass.start();

// ---------- Router ----------
const screens = ['home', 'plan', 'guide', 'arrive'];
function show(name) {
  for (const s of screens) $(`#${s}`).hidden = s !== name;
  if (name !== 'guide') stopGuide();
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
}
window.addEventListener('hashchange', () => {
  const name = location.hash.slice(1);
  if (screens.includes(name) && (name === 'home' || state.graph)) show(name);
});

// ---------- Home ----------
for (const [lang, note] of Object.entries(SAMPLES)) {
  const b = el('button', 'chip', lang.toUpperCase());
  b.onclick = () => { $('#note').value = note; };
  $('#samples').append(b);
}

$('#paste').onclick = async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (t) $('#note').value = t;
    else toast('Clipboard is empty. Copy the directions on the laptop first.');
  } catch {
    toast('Clipboard blocked. Long-press the box and choose Paste.');
  }
};

$('#parse').onclick = async () => {
  const note = $('#note').value.trim();
  if (!note) return toast('Type, paste or pick a sample first.');
  vision.loadOcr('eng').catch((e) => toast(`OCR failed to load: ${e.message}`));
  const btn = $('#parse'), box = $('#thinking'), bar = $('#thinking-progress');
  btn.disabled = true;
  box.hidden = false;
  $('#thinking-out').textContent = '';
  const t0 = performance.now();
  const res = await parseNote(note, {
    mode: $('#engine').value,
    device: state.device,
    onStatus: (s) => ($('#thinking-status').textContent = s),
    onToken: (t) => { bar.hidden = true; $('#thinking-status').textContent = 'On-device model is writing the route…'; $('#thinking-out').textContent = t; },
    onProgress: (p) => { bar.hidden = false; bar.value = p; $('#thinking-status').textContent = `Loading on-device model into the GPU… ${Math.round(p * 100)}%`; },
  });
  btn.disabled = false;
  box.hidden = true;
  const g0 = res.graph;
  if (g0.parser === 'rules' && !g0.steps.some((s) => s.kind === 'turn' || s.landmark)) {
    // Nothing route-like in the note (e.g. "Hi"): don't show an empty plan.
    return toast('No landmarks or turns found. Try something like "past the temple, second left, blue gate opposite MedPlus".');
  }
  state.parse = res;
  state.graph = res.graph;
  state.graph.ms = Math.round((performance.now() - t0) * 10) / 10;
  state.graph.note = note;
  if (res.stats) state.inferences.push({ at: Date.now(), ...res.stats });
  if (res.fallback && $('#engine').value !== 'auto') toast(`On-device model not used (${res.fallback}). Rule parser took over.`);
  const pick = $('#voice').value;
  state.lang = pick === 'auto' ? state.graph.lang : pick;
  renderPlan();
  show('plan');
};

$('#use-other').onclick = () => {
  const p = state.parse;
  const other = state.graph.parser === 'llm' ? p.rules : p.llmGraph;
  if (state.graph.parser === 'llm') p.llmGraph = state.graph;
  Object.assign(other, { note: state.graph.note, ms: state.graph.ms });
  state.graph = other;
  renderPlan();
};

// ---------- Plan ----------
function chips(step) {
  const v = step.verify, out = [];
  for (const s of v.signs) out.push(['sign', s]);
  if (!v.signs.length) for (const s of v.alt.slice(0, 2)) out.push(['type', s]);
  if (v.colour) out.push(['colour', v.colour]);
  if (v.compass) out.push(['compass', `compass ${v.compass}`]);
  out.push([`conf-${v.confidence}`, v.confidence]);
  return out;
}

function renderPlan() {
  const g = state.graph, p = state.parse || {}, st = p.stats;
  $('#parsed-by').textContent = g.parser === 'llm' && st
    ? `Parsed on this phone by ${st.model} · ${st.backend} · ${(st.ms / 1000).toFixed(1)} s · ${st.tokensIn ?? '?'}→${st.tokensOut ?? '?'} tokens · ${st.tps ? st.tps.toFixed(1) : '?'} tok/s · language: ${g.lang}`
    : `Parsed by: rule parser · ${st ? "instant" : `${g.ms} ms`} · language: ${g.lang}${st ? ` · AI took ${(st.ms / 1000).toFixed(1)} s` : ""}${p.fallback ? ` · on-device model not used: ${p.fallback}` : ""}`;
  $('#raw').hidden = !st;
  if (st) $('#raw-out').textContent = `Note: ${g.note}\n\n${st.out || '(empty)'}\n\n${st.tokensIn ?? '?'} prompt tokens (${st.cached ?? 0} from cache) · ${st.tokensOut ?? '?'} generated · ${(st.ms / 1000).toFixed(1)} s`;
  const showAgree = !!(p.rules && st);
  $('#agree').hidden = !showAgree;
  if (showAgree) {
    $('#agree').className = `agree ${p.agree ? 'ok' : 'warn'}`;
    $('#agree-text').textContent = p.agree ? '✓ Rule parser reads the same route' : '⚠ Rule parser reads it differently';
    $('#use-other').hidden = p.agree;
    $('#use-other').textContent = g.parser === 'llm' ? 'Use rule parser' : 'Use AI result';
  }
  const list = $('#steps');
  list.replaceChildren();
  for (const s of g.steps) {
    const li = el('li', `step kind-${s.kind}`);
    li.append(el('div', 'step-line', describe(s)));
    const row = el('div', 'chips');
    for (const [cls, label] of chips(s)) row.append(el('span', `tag ${cls}`, label));
    li.append(row);
    list.append(li);
  }
  $('#floor').textContent = g.floor != null ? `Floor: ${g.floor === 0 ? 'ground' : g.floor}` : '';
}

$('#edit').onclick = () => show('home');
$('#start').onclick = () => startGuide();

// ---------- Guide ----------
const step = () => state.graph.steps[state.i];
const T = () => text(state.lang);

function spokenName(lm) {
  if (!lm) return T().dest;
  const type = { pharmacy: 'pharmacy', temple: 'temple', store: 'store', sign: 'sign', desk: 'desk' }[lm.type] || lm.type.replace('_', ' ');
  return [lm.colour, lm.name, lm.name && (lm.type === 'sign' || lm.type === 'gate') ? '' : type].filter(Boolean).join(' ');
}

function announce() {
  const s = step();
  state.asking = false;
  state.signSeenAt = 0;
  $('#ask').hidden = true;
  $('#turned').hidden = s.kind !== 'turn';
  $('#step-count').textContent = `Step ${s.n} of ${state.graph.steps.length}`;
  $('#step-line').textContent = describe(s);
  $('#seen').replaceChildren();
  $('#colour-bars').hidden = !s.verify.colour;
  if (s.kind === 'turn') {
    say(T().turn(s.ordinal, T()[s.turn]), state.lang);
    buzz(s.turn);
    state.turn = new TurnDetector(compass, s.turn, () => confirmStep(T().turned));
  } else {
    state.turn = null;
    say(T().look(spokenName(s.landmark)), state.lang);
  }
}

function confirmStep(line) {
  const s = step();
  if (s.kind === 'arrive') return arrive();
  if (line) say(line, state.lang);
  buzz('spotted');
  flash();
  state.i++;
  setTimeout(announce, 1200); // let the confirmation finish before the next instruction
}

function ask(target) {
  if (state.asking || performance.now() < state.askCooldown) return;
  state.asking = true;
  $('#ask-q').textContent = `Is this the ${target}?`;
  $('#ask').hidden = false;
  say(T().ask(target), state.lang);
  buzz('ask');
}

$('#yes').onclick = () => { $('#ask').hidden = true; state.asking = false; confirmStep(T().spotted(spokenName(step().landmark))); };
$('#notyet').onclick = () => { $('#ask').hidden = true; state.asking = false; state.askCooldown = performance.now() + 4000; };
$('#turned').onclick = () => confirmStep(T().turned);
$('#skip').onclick = () => confirmStep();
$('#stop').onclick = () => show('plan');

function renderSeen(words, matched) {
  const box = $('#seen');
  box.replaceChildren();
  for (const w of words.slice(0, 8)) box.append(el('span', `seen-word${matched && w.startsWith(matched.slice(0, 4)) ? ' hit' : ''}`, w));
}

function onOcr(res) {
  if (!res || state.asking) return;
  $('#ocr-ms').textContent = `OCR ${res.ms} ms`;
  const s = step();
  if (s.kind === 'turn') return renderSeen(res.words);
  const m = matchSigns(res.words, s.verify);
  renderSeen(res.words, m.word);
  if (!m.hit) return;
  if (s.kind === 'pass') {
    if (m.hit === 'name') confirmStep(T().spotted(spokenName(s.landmark)));
    else ask(spokenName(s.landmark));
    return;
  }
  // Arrive: the named sign (often the reference, e.g. MedPlus) narrows it down; colour or a direct name match triggers the question.
  state.signSeenAt = performance.now();
  if (!s.verify.colour || s.landmark?.name) ask(spokenName(s.landmark));
}

function onColour(thirds) {
  const bars = $('#colour-bars').children;
  thirds.forEach((v, k) => { bars[k].style.setProperty('--fill', `${Math.min(100, Math.round(v * 250))}%`); bars[k].classList.toggle('on', v >= 0.15); });
  const s = step();
  if (s.kind !== 'arrive' || state.asking) return;
  const best = Math.max(...thirds);
  const signRecent = performance.now() - state.signSeenAt < 10000;
  if (best >= 0.15 && (!s.verify.signs.length || signRecent || best >= 0.35)) ask(spokenName(s.landmark));
}

async function ocrLoop() {
  while (state.running) {
    try { onOcr(await vision.read()); } catch (e) { console.warn(e); }
    await new Promise((r) => setTimeout(r, 120));
  }
}

function tick() {
  if (!state.running) return;
  state.turn?.tick();
  const d = state.turn?.delta;
  $('#heading').textContent = compass.heading == null ? 'compass: no sensor' : `heading ${Math.round(compass.heading)}°${d != null ? ` · turned ${Math.round(d)}°` : ''}`;
  const c = step()?.verify.colour;
  if (c) { const t = vision.colour(c); if (t) onColour(t); }
  state.raf = setTimeout(tick, 200);
}

async function startGuide() {
  state.i = 0;
  state.startedAt = performance.now();
  show('guide');
  try {
    await vision.startCamera();
  } catch (e) {
    toast(`Camera unavailable: ${e.message}. Use Skip / Yes to step through.`);
  }
  try { state.wake = await navigator.wakeLock?.request('screen'); } catch {}
  if (!vision.worker) {
    $('#ocr-ms').textContent = 'loading OCR…';
    try { await vision.loadOcr('eng'); } catch (e) { toast(`OCR failed: ${e.message}`); }
  }
  state.running = true;
  announce();
  ocrLoop();
  tick();
}

function stopGuide() {
  if (!state.running) return;
  state.running = false;
  clearTimeout(state.raf);
  vision.stopCamera();
  state.wake?.release?.();
  speechSynthesis?.cancel();
}

function flash() {
  const f = $('#flash');
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');
}

// ---------- Arrive ----------
function arrive() {
  const g = state.graph, s = step();
  const secs = Math.round((performance.now() - state.startedAt) / 1000);
  say(T().arrived(g.floor), state.lang);
  buzz('arrived');
  $('#arrived-what').textContent = describe(s).replace(/^Arrive: /, '');
  $('#arrived-floor').textContent = g.floor != null ? `Floor ${g.floor === 0 ? 'ground' : g.floor}` : '';
  $('#arrived-time').textContent = `Time to door: ${secs} s`;
  show('arrive');
}
$('#again').onclick = () => show('home');

// ---------- Misc ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

deviceReport().then((r) => { state.device = r; $('#device').textContent = describeDevice(r); });
warmNative();

if ('serviceWorker' in navigator && !location.search.includes('nosw')) navigator.serviceWorker.register('sw.js').catch(() => {});
show('home');
