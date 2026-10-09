import { parseRules, SAMPLES, describe } from './parser.js';
import { Vision, matchSigns } from './vision.js';
import { say, text, buzz, Compass, TurnDetector } from './guide.js';
import { deviceReport, describeDevice } from './device.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

const state = { graph: null, i: 0, lang: 'en', asking: false, askCooldown: 0, signSeenAt: 0, startedAt: 0, running: false };
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

$('#parse').onclick = () => {
  const note = $('#note').value.trim();
  if (!note) return toast('Type, paste or pick a sample first.');
  const t0 = performance.now();
  state.graph = parseRules(note);
  state.graph.ms = Math.round((performance.now() - t0) * 10) / 10;
  state.graph.note = note;
  const pick = $('#voice').value;
  state.lang = pick === 'auto' ? state.graph.lang : pick;
  renderPlan();
  show('plan');
  vision.loadOcr('eng').catch((e) => toast(`OCR failed to load: ${e.message}`));
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
  const g = state.graph;
  $('#parsed-by').textContent = `Parsed by: ${g.parser === 'rules' ? 'rule parser' : g.parser} · ${g.ms} ms · language: ${g.lang}`;
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

if ('serviceWorker' in navigator && !location.search.includes('nosw')) navigator.serviceWorker.register('sw.js').catch(() => {});
show('home');
