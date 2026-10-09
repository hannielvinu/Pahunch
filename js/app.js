import { SAMPLES, describe } from './parser.js';
import { parseNote, warmNative } from './llm.js';
import { Vision, matchSigns } from './vision.js';
import { Overlay } from './overlay.js';
import { say, text, buzz, Compass, TurnDetector } from './guide.js';
import { deviceReport, describeDevice } from './device.js';
import { formatDigipin } from './digipin.js';
import { loadCards, saveCard, deleteCard, makeCard, setPosition, qrPayload, cardJson, shrinkPhoto, locate } from './doorcard.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

const state = { inferences: [], graph: null, i: 0, lang: 'en', asking: false, askCooldown: 0, signSeenAt: 0, startedAt: 0, running: false };
const vision = new Vision($('#video'));
const overlay = new Overlay($('#overlay'), $('#video'));
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
  const ai = st ? `${st.model} · ${st.backend} · ${(st.ms / 1000).toFixed(1)} s · ${st.tokensIn ?? '?'}→${st.tokensOut ?? '?'} tokens · ${st.tps ? st.tps.toFixed(1) : '?'} tok/s` : '';
  $('#parsed-by').textContent = g.parser === 'llm' && st
    ? `Route read on this phone by ${ai} · turns and floor checked against the note · language: ${g.lang}`
    : st && !p.fallback
      ? `Route by rule parser (instant), cross-checked on this phone by ${ai} · language: ${g.lang}`
      : `Parsed by: rule parser · ${g.ms} ms · language: ${g.lang}${p.fallback ? ` · on-device model not used: ${p.fallback}` : ''}`;
  $('#raw').hidden = !st;
  if (st) $('#raw-out').textContent = `Note: ${g.note}\n\n${st.out || '(empty)'}\n\n${st.tokensIn ?? '?'} prompt tokens (${st.cached ?? 0} from cache) · ${st.tokensOut ?? '?'} generated · ${(st.ms / 1000).toFixed(1)} s`;
  const showAgree = !!(p.rules && st);
  $('#agree').hidden = !showAgree;
  if (showAgree) {
    $('#agree').className = `agree ${p.agree ? 'ok' : 'warn'}`;
    $('#agree-text').textContent = p.agree ? '✓ AI and rule parser read the same route' : '⚠ AI and rule parser differ: check the steps';
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
  overlay.clearStep();
  if (s.kind === 'turn') {
    say(T().turn(s.ordinal, T()[s.turn]), state.lang);
    buzz(s.turn);
    state.turn = new TurnDetector(compass, s.turn, () => confirmStep(T().turned));
    overlay.setTurn(state.turn);
  } else {
    state.turn = null;
    say(T().look(spokenName(s.landmark)), state.lang);
  }
}

function confirmStep(line) {
  const s = step();
  if (s.kind === 'arrive') return arrive();
  if (line) say(line, state.lang);
  if (s.kind === 'turn') overlay.turnDone = true;
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
  if (!res) return;
  $('#ocr-ms').textContent = `OCR ${res.ms} ms`;
  const s = step();
  // Boxes are drawn for every read, also while a question is open: green = this step's sign, red = decoys.
  const m = s.kind === 'turn' ? { hit: null, word: null } : matchSigns(res.words, s.verify);
  const confirms = s.kind === 'pass' && m.hit === 'name';
  overlay.setBoxes(res.boxes, m.word, m.word && `✓ ${m.word} · step ${s.n} ${confirms ? 'confirmed' : 'spotted'}`);
  renderSeen(res.words, m.word);
  if (state.asking || !m.hit) return;
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
  overlay.start();
  announce();
  ocrLoop();
  tick();
}

function stopGuide() {
  if (!state.running) return;
  state.running = false;
  clearTimeout(state.raf);
  overlay.stop();
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
  const g = state.graph;
  const secs = Math.round((performance.now() - state.startedAt) / 1000);
  say(T().arrived(g.floor), state.lang);
  buzz('arrived');
  state.card = makeCard(g, { secs, lang: state.lang });
  saveCard(state.card);
  showCard(state.card, true);
  fixPosition(state.card);
}

// Door card: saved straight away, then filled in as the GPS fix and the photo arrive.
function showCard(card, fresh) {
  state.card = card;
  $('#tick').hidden = !fresh;
  $('#arrive-title').textContent = fresh ? "You've arrived" : 'Saved door';
  $('#del').hidden = fresh;
  renderCard();
  show('arrive');
}

function renderCard() {
  const c = state.card;
  $('#arrived-what').textContent = c.dest;
  $('#arrived-floor').textContent = c.floor != null ? `Floor ${c.floor === 0 ? 'ground' : c.floor}` : '';
  $('#card-pin').textContent = c.digipin ? formatDigipin(c.digipin) : state.locating ? 'locating…' : 'no GPS fix';
  $('#card-acc').textContent = c.digipin ? `±${c.acc ?? '?'} m · ${c.lat}, ${c.lon}` : '';
  $('#locate').hidden = !!c.digipin || state.locating;
  $('#card-photo').hidden = !c.photo;
  if (c.photo) $('#card-photo').src = c.photo;
  $('#photo-hint').textContent = c.photo ? 'Retake photo' : '📷 Take a photo of the door';
  $('#card-route').replaceChildren(...c.route.map((r) => el('li', null, r)));
  $('#arrived-time').textContent = `${c.secs != null ? `Time to door: ${c.secs} s · ` : ''}${new Date(c.at).toLocaleString()}`;
  renderQr(qrPayload(c));
  renderDoors();
}

function renderQr(data) {
  const box = $('#card-qr');
  box.replaceChildren();
  if (!window.qrcode) return;
  try {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']; // Hindi / Kannada / Tamil notes
    const qr = qrcode(0, 'L');
    qr.addData(data, 'Byte');
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (e) {
    box.append(el('p', 'meta', `QR too big: ${e.message ?? e}`));
  }
}

async function fixPosition(card) {
  state.locating = true;
  renderCard();
  const pos = await locate();
  state.locating = false;
  if (pos) { setPosition(card, pos); if (loadCards().some((c) => c.id === card.id)) saveCard(card); }
  else toast('No GPS fix. Step outside and tap Retry GPS.');
  if (state.card === card) renderCard();
}

$('#photo-in').onchange = async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f || !state.card) return;
  try {
    state.card.photo = await shrinkPhoto(f);
    if (!saveCard(state.card)) toast('Storage full: photo not saved.');
    renderCard();
  } catch (err) { toast(`Photo failed: ${err.message}`); }
};

$('#locate').onclick = () => fixPosition(state.card);

$('#send').onclick = async () => {
  const json = cardJson(state.card);
  let copied = false;
  try { await navigator.clipboard.writeText(json); copied = true; } catch {}
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = `pahunch-door-${state.card.digipin || state.card.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(copied ? 'Door card copied and downloaded as JSON.' : 'Door card downloaded as JSON.');
};

$('#del').onclick = () => { deleteCard(state.card.id); state.card = null; renderDoors(); show('home'); };
$('#again').onclick = () => show('home');

function renderDoors() {
  const cards = loadCards();
  $('#doors').hidden = !cards.length;
  $('#doors-sum').textContent = `Saved doors (${cards.length})`;
  $('#doors-list').replaceChildren(...cards.map((c) => {
    const li = el('li');
    const b = el('button', 'door');
    if (c.photo) { const img = el('img'); img.src = c.photo; img.alt = ''; b.append(img); }
    const t = el('span');
    t.append(el('strong', null, c.dest), el('span', 'meta', `${c.digipin ? formatDigipin(c.digipin) : 'no DIGIPIN'}${c.floor != null ? ` · floor ${c.floor}` : ''} · ${new Date(c.at).toLocaleDateString()}`));
    b.append(t);
    b.onclick = () => showCard(c, false);
    li.append(b);
    return li;
  }));
}

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
renderDoors();

if ('serviceWorker' in navigator && !location.search.includes('nosw')) navigator.serviceWorker.register('sw.js').catch(() => {});
show('home');
