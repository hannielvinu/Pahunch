import { blocked, guard } from './guard.js'; // first: refuses any request that would leave the phone
import { SAMPLES, describe, parseRules, verifyFor } from './parser.js';
import { parseNote, warmNative, complete } from './llm.js';
import { Vision, matchSigns } from './vision.js';
import { Overlay } from './overlay.js';
import { startNetMeter, formatBytes } from './netmeter.js';
import { say, text, buzz, Compass, unlockSpeech, localName } from './guide.js';
import { Detector } from './detector.js';
import { Scene, TYPE_TAG } from './scene.js';
import { Sensors, GyroTurn } from './sensors.js';
import { dictate, CommandListener, voiceAvailable } from './voice.js';
import { listen, sttAvailable, SPEECH_LANGS } from './stt.js';
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
const detector = new Detector($('#video'));
const scene = new Scene($('#video'));
const sensors = new Sensors();
sensors.start();
const MODES = {
  delivery: { badge: 'Delivery', title: 'Where to?', sub: 'Speak or paste the directions exactly as the customer gave them.' },
  ambulance: { badge: 'Ambulance', title: 'Emergency call', sub: 'Type or speak what the caller said. Pahunch guides without stopping to ask.' },
  ride: { badge: 'Pickup', title: 'Find your passenger', sub: 'Paste where they said they are waiting: "opposite the bus stop, blue shirt".' },
};
const ambulance = () => document.body.dataset.mode === 'ambulance';

// ---------- Router ----------
const screens = ['roles', 'home', 'plan', 'guide', 'arrive'];
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
let demoIdx = 0;
$('#demo').onclick = () => { const notes = Object.values(SAMPLES); $('#note').value = notes[demoIdx++ % notes.length]; };
for (const [lang, note] of Object.entries(SAMPLES)) {
  const b = el('button', 'chip', { en: 'Try English', hi: 'Hinglish', kn: 'Kannada', ta: 'Tamil' }[lang] || lang);
  b.onclick = () => { $('#note').value = note; };
  $('#samples').append(b);
}

$('#note').addEventListener('input', () => { state.altNote = null; state.spokenLang = null; });

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
  if (!LITE) vision.loadOcr('eng').catch((e) => toast(`OCR failed to load: ${e.message}`));
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
  // If the native-script reading is incomplete, try the English translation of the same speech.
  if (state.altNote && !complete(res.rules || res.graph)) {
    const alt = await parseNote(state.altNote, { mode: 'rules' });
    if (complete(alt.graph)) Object.assign(res, alt, { stats: null, fallback: null });
  }
  const g0 = res.graph;
  if (g0.parser === 'rules' && !g0.steps.some((s) => s.kind === 'turn' || s.landmark)) {
    // Nothing route-like in the note (e.g. "Hi"): don't show an empty plan.
    return toast('No landmarks or turns found. Try something like "past the temple, second left, blue gate opposite MedPlus".');
  }
  state.parse = res;
  state.graph = res.graph;
  if (state.lastVoice) { logVoice({ ...state.lastVoice, used: note, plan: res.graph.steps.map(describe).join(' → '), engine: res.graph.parser }); state.lastVoice = null; }
  state.graph.ms = Math.round((performance.now() - t0) * 10) / 10;
  state.graph.note = note;
  if (res.stats) state.inferences.push({ at: Date.now(), ...res.stats });
  if (res.fallback && $('#engine').value !== 'auto') toast(`On-device model not used (${res.fallback}). Rule parser took over.`);
  const pick = $('#voice').value;
  state.lang = pick === 'auto' ? state.spokenLang || state.graph.lang : pick; // reply in the language that was spoken
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
  const usedAI = g.parser === 'llm' && st && !p.fallback;
  $('#parsed-by').textContent = usedAI
    ? `Understood on this phone in ${(st.ms / 1000).toFixed(1)} s · on-device AI (${st.model.replace(/.gguf$/, '')})`
    : `Understood on this phone in ${g.ms} ms · rule engine${p.fallback && p.fallback !== 'no on-device model running' ? ' (AI answer unclear)' : p.fallback ? ' (AI model not running)' : ''}`;
  if (false) $('#parsed-by').textContent = g.parser === 'llm' && st
    ? `Route read on this phone by ${ai} · turns and floor checked against the note · language: ${g.lang}`
    : st && !p.fallback
      ? `Route by rule parser (instant), cross-checked on this phone by ${ai} · language: ${g.lang}`
      : `Route read by the rule parser in ${g.ms} ms · language: ${g.lang}${p.fallback && p.fallback !== "no on-device model running" ? " · AI cross-check skipped (unclear answer)" : ""}`;
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
  g.steps.forEach((s, i) => {
    const li = el('li', `step kind-${s.kind}`);
    li.append(el('div', 'step-line', describe(s)));
    const row = el('div', 'chips');
    for (const [cls, label] of chips(s)) row.append(el('span', `tag ${cls}`, label));
    li.append(row);
    li.tabIndex = 0;
    li.onclick = () => openEditor(i); // tap a step to fix it
    list.append(li);
  });
  const add = el('li', 'step add-step', '+ Add a step');
  add.onclick = () => openEditor(g.steps.length);
  list.append(add);
  $('#floor').textContent = g.floor != null ? `Floor: ${g.floor === 0 ? 'ground' : g.floor}` : '';
}

$('#edit').onclick = () => show('home');

// ---------- Fix a step (tap on the plan) ----------
// Turns: left/right and which turn. Landmarks: type what it is ("blue gate", "Ganesha temple"), optional colour.
let editing = null;
function renumber(g) {
  const last = g.steps.at(-1);
  g.steps.forEach((s, i) => { if (s.kind === 'arrive' && i < g.steps.length - 1) s.kind = 'pass'; });
  if (last && last.kind === 'pass') last.kind = 'arrive';
  g.steps.forEach((s, i) => { s.n = i + 1; s.verify = verifyFor(s); });
}
function openEditor(i) {
  const g = state.graph, s = g.steps[i];
  editing = { i, kind: s?.kind === 'turn' ? 'turn' : 'place', turn: s?.turn || 'left', ordinal: s?.ordinal || 1,
    text: s && s.kind !== 'turn' ? [s.landmark?.colour, s.landmark?.name, s.landmark && s.landmark.type !== 'other' ? s.landmark.type.replace('_', ' ') : ''].filter(Boolean).join(' ') : '' };
  $('#esheet').hidden = false;
  $('#e-del').hidden = !s;
  $('#e-title').textContent = s ? `Step ${i + 1}` : 'New step';
  renderEditor();
}
function renderEditor() {
  const e = editing;
  document.querySelectorAll('#e-kind button').forEach((b) => b.classList.toggle('on', b.dataset.k === e.kind));
  $('#e-turn').hidden = e.kind !== 'turn';
  $('#e-place').hidden = e.kind === 'turn';
  document.querySelectorAll('#e-dir button').forEach((b) => b.classList.toggle('on', b.dataset.d === e.turn));
  document.querySelectorAll('#e-ord button').forEach((b) => b.classList.toggle('on', +b.dataset.o === e.ordinal));
  $('#e-text').value = e.text;
}
document.querySelectorAll('#e-kind button').forEach((b) => (b.onclick = () => { editing.kind = b.dataset.k; renderEditor(); }));
document.querySelectorAll('#e-dir button').forEach((b) => (b.onclick = () => { editing.turn = b.dataset.d; renderEditor(); }));
document.querySelectorAll('#e-ord button').forEach((b) => (b.onclick = () => { editing.ordinal = +b.dataset.o; renderEditor(); }));
$('#e-text').oninput = (ev) => (editing.text = ev.target.value);
$('#e-cancel').onclick = () => ($('#esheet').hidden = true);
$('#e-del').onclick = () => {
  state.graph.steps.splice(editing.i, 1);
  if (!state.graph.steps.length) state.graph.steps.push({ kind: 'arrive', landmark: null, ref: null });
  renumber(state.graph); $('#esheet').hidden = true; renderPlan();
};
$('#e-save').onclick = () => {
  const e = editing, g = state.graph, old = g.steps[e.i];
  let step;
  if (e.kind === 'turn') step = { kind: 'turn', turn: e.turn, ordinal: e.ordinal, road: old?.road || null };
  else {
    // Reuse the parser to read what was typed ("blue gate opposite MedPlus", "Ganesha temple").
    const p = parseRules(e.text || '').steps.find((x) => x.landmark) || null;
    if (!p) return toast('Type the landmark, e.g. "blue gate" or "Ganesha temple".');
    step = { kind: old?.kind === 'turn' || !old ? 'pass' : old.kind, landmark: p.landmark, ref: p.ref || null };
  }
  g.steps.splice(e.i, old ? 1 : 0, step);
  renumber(g); $('#esheet').hidden = true; renderPlan();
  buzz('spotted');
};
$('#start').onclick = () => { unlockSpeech(); startGuide(); };

// ---------- Guide ----------
const step = () => state.graph.steps[state.i];
const T = () => text(state.lang);

function spokenName(lm) {
  return localName(lm, state.lang);
}

function announce(prefix = '') {
  const s = step();
  state.stepAt = performance.now();
  state.colourSeenAt = 0;
  sensors.resetSteps();
  state.asking = false;
  state.signSeenAt = 0;
  $('#ask').hidden = true;
  $('#turned').hidden = s.kind !== 'turn';
  $('#step-count').textContent = `Step ${s.n} of ${state.graph.steps.length}`;
  $('#step-line').textContent = describe(s);
  $('#seen').replaceChildren();
  $('#colour-bars').hidden = !s.verify.colour;
  overlay.clearStep();
  // One utterance: "MedPlus detected. Now take the second turn on the left."
  // First step opens the route like a person would: "Okay, let's go. First, go straight."
  const intro = s.n === 1 && !prefix ? `${ambulance() ? 'Emergency route. ' : ''}${T().intro} ${s.kind === 'pass' ? T().straight + ' ' : ''}` : '';
  const lead = prefix ? `${prefix} ${T().now} ` : intro;
  if (s.kind === 'turn') {
    const inst = T().turn(s.ordinal, T()[s.turn]);
    say(lead + (prefix ? inst.charAt(0).toLowerCase() + inst.slice(1) : inst), state.lang);
    buzz(s.turn);
    state.turn = new GyroTurn(sensors, compass, s.turn, () => confirmStep(T().turned));
    overlay.setTurn(state.turn);
  } else {
    state.turn = null;
    const look = T().look(spokenName(s.landmark));
    say(lead + (prefix ? look.charAt(0).toLowerCase() + look.slice(1) : look), state.lang);
  }
}

function confirmStep(line) {
  const s = step();
  if (s.kind === 'arrive') return arrive();
  if (s.kind === 'turn') overlay.turnDone = true;
  buzz('spotted');
  flash();
  state.i++;
  speechSynthesis?.cancel();
  setTimeout(() => announce(line || ''), 700); // the confirmation and the next instruction are spoken together
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
    // A named signboard is strong evidence: confirm. A generic word ("TEMPLE") asks, except in ambulance mode.
    if (m.hit === 'name' || ambulance()) confirmStep(T().spotted(spokenName(s.landmark)));
    else ask(spokenName(s.landmark));
    return;
  }
  state.signSeenAt = performance.now();
  state.signHit = m.hit;
  decideArrive();
}

// Arrive when the evidence agrees (sign + colour, or the destination's own name); ask only on a single weak cue.
function decideArrive() {
  const s = step();
  if (!s || s.kind !== 'arrive' || state.asking) return;
  const now = performance.now();
  const sign = now - (state.signSeenAt || 0) < 10000, colour = now - (state.colourSeenAt || 0) < 4000;
  const needColour = !!s.verify.colour, needSign = s.verify.signs.length > 0;
  const ownName = sign && state.signHit === 'name' && s.landmark?.name;
  if (ownName || (sign && (!needColour || colour)) || (colour && !needSign)) return confirmStep();
  const firstCue = Math.min(...[state.signSeenAt, state.colourSeenAt].filter(Boolean));
  if ((sign || colour) && now - firstCue > (ambulance() ? 2000 : 4000)) {
    if (ambulance()) return confirmStep();
    ask(spokenName(s.landmark));
  }
}

function onColour(thirds, colour) {
  overlay.setColour(colour, thirds);
  const bars = $('#colour-bars').children;
  thirds.forEach((v, k) => { bars[k].style.setProperty('--fill', `${Math.min(100, Math.round(v * 250))}%`); bars[k].classList.toggle('on', v >= 0.08); });
  if (Math.max(...thirds) >= 0.08) { state.colourSeenAt ||= performance.now(); state.colourLast = performance.now(); }
  else if (performance.now() - (state.colourLast || 0) > 1500) state.colourSeenAt = 0;
  decideArrive();
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
  $('#heading').textContent = `${compass.heading == null ? 'compass –' : `heading ${Math.round(compass.heading)}°`}${d != null ? ` · turned ${Math.round(d)}°` : ''}`;
  const c = step()?.verify.colour;
  const scan = vision.scan(c || 'blue');
  if (scan) {
    state.brightness = scan.brightness;
    if (c) { overlay.setMask(scan.mask, c); onColour(scan.thirds, c); } else overlay.setMask(null);
    // Dark lane: switch the torch on (always allowed in ambulance mode).
    if (scan.brightness < 0.16 || (ambulance() && scan.brightness < 0.25)) vision.setTorch(true);
    else if (scan.brightness > 0.4) vision.setTorch(false);
  }
  const p = sensors.pos;
  const gps = $('#gps-chip');
  gps.textContent = p ? `GPS ±${p.acc} m` : `GPS: ${sensors.gpsError || 'searching'}`;
  gps.className = `pill ${p && p.acc < 50 ? 'good' : p ? '' : 'bad'}`;
  $('#walk-chip').textContent = `${sensors.steps} steps · ~${Math.round(sensors.steps * 0.7)} m`;
  state.raf = setTimeout(tick, 150);
}

// The step's landmark is an everyday object ("the black chair", "laptop table"): the vision model can confirm it.
// Needs the same object in 2 frames within a second, so one flicker doesn't move the route on.
function onDetections(dets) {
  const s = step();
  const want = s?.kind !== 'turn' ? s?.verify.objects || [] : [];
  const hit = want.length ? dets.find((d) => want.includes(d.label) && d.score >= 0.5) : null;
  if (!hit) { state.objHits = 0; return null; }
  const now = performance.now();
  state.objHits = now - (state.objAt || 0) < 1000 ? (state.objHits || 0) + 1 : 1;
  state.objAt = now;
  const label = `✓ ${hit.label} · step ${s.n}`;
  if (state.objHits < 2 || state.asking) return { label: hit.label, text: label };
  if (s.kind === 'pass') confirmStep(T().spotted(spokenName(s.landmark)));
  else { state.signSeenAt = now; state.signHit = s.verify.signs.length ? 'type' : 'name'; decideArrive(); }
  return { label: hit.label, text: label };
}

// Appearance agrees with the step's landmark type ("looks like a temple") in two readings in a row:
// a medium-strength cue, so it asks (ambulance mode confirms). Signboards stay the strong cue.
function onScene(tags) {
  const chip = $('#scene-chip');
  const top = tags[0];
  chip.hidden = !top && !scene.top;
  if (top) chip.textContent = `Looks like: ${top.tag} ${Math.round(top.score * 100)}%`;
  else if (scene.top) { chip.hidden = false; chip.textContent = `Sees: ${scene.top.categoryName || scene.top.displayName} ${Math.round(scene.top.score * 100)}%`; }
  const s = step();
  const want = s && s.kind !== 'turn' ? TYPE_TAG[s.landmark?.type] : null;
  const hit = want && tags.find((t) => t.tag === want && t.score >= 0.12);
  chip.classList.toggle('good', !!hit);
  state.sceneHits = hit ? (state.sceneHits || 0) + 1 : 0;
  if (state.sceneHits < 2 || state.asking) return;
  state.sceneHits = 0;
  if (ambulance()) return confirmStep(T().spotted(spokenName(s.landmark)));
  if (s.kind === 'arrive') { state.colourSeenAt ||= performance.now(); decideArrive(); }
  ask(spokenName(s.landmark));
}

// Object detection on the live camera (MediaPipe), throttled so OCR keeps its share of the phone.
function detectLoop() {
  if (!state.running) return;
  const t0 = performance.now();
  try {
    const dets = detector.detect();
    overlay.setDetections(dets, onDetections(dets));
    // Appearance (what kind of place) every ~5th frame: lighter than detection, changes slowly.
    if (scene.ready && (state.sceneTick = (state.sceneTick || 0) + 1) % 5 === 0) onScene(scene.classify());
    if (detector.ready) $('#det-ms').textContent = `vision ${detector.ms} ms · ${detector.delegate}`;
  } catch (e) { console.warn(e); }
  state.detTimer = setTimeout(detectLoop, Math.max(60, 140 - (performance.now() - t0)));
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
  if (!vision.worker && !LITE) {
    $('#ocr-ms').textContent = 'loading OCR…';
    try { await vision.loadOcr('eng'); } catch (e) { toast(`OCR failed: ${e.message}`); }
  }
  state.running = true;
  overlay.start();
  announce();
  ocrLoop();
  tick();
  if (!LITE && !scene.ready) scene.load().catch(() => {});
  if (LITE) {} else if (!detector.ready) detector.load().then(detectLoop).catch((e) => ($('#det-ms').textContent = `vision off: ${e.message}`));
  else detectLoop();
  if (ambulance()) navigator.vibrate?.([200, 100, 200, 100, 200]);
}

function stopGuide() {
  if (!state.running) return;
  state.running = false;
  clearTimeout(state.raf);
  clearTimeout(state.detTimer);
  listener.stop();
  $('#handsfree').setAttribute('aria-pressed', 'false');
  vision.setTorch(false);
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
  // Fresh arrival: tick pops with a ring burst, then the door card rises in (CSS, see .celebrate).
  const scr = $('#arrive');
  scr.classList.remove('celebrate');
  void scr.offsetWidth;
  scr.classList.toggle('celebrate', fresh);
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
  $('#photo-hint').textContent = c.photo ? 'Retake photo' : 'Take a photo of the door';
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
  const live = sensors.pos && Date.now() - sensors.pos.at < 60000 ? { latitude: sensors.pos.lat, longitude: sensors.pos.lon, accuracy: sensors.pos.acc } : null;
  const pos = live || (await locate());
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
function toast(msg, ms = 4000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function netChip({ requests, bytes, hosts } = startNetMeter.total || {}) {
  const chip = $('#net');
  chip.onclick = () => { const u = startNetMeter.total?.urls || []; toast(requests ? `Left the phone: ${u.join('  |  ') || [...hosts].join(', ')}` : 'Nothing has left this phone.', 12000); };
  chip.classList.toggle('off', requests > 0);
  chip.textContent = requests ? `${requests} off-device request${requests > 1 ? 's' : ''} · ${formatBytes(bytes)}` : `On-device · 0 B sent${blocked.length ? ` · ${blocked.length} blocked` : ''}`;
  if (!requests && blocked.length) chip.onclick = () => toast(`Blocked from leaving the phone: ${blocked.join('  |  ')}`, 12000);
}
startNetMeter(netChip);
guard.onBlock = () => netChip();
deviceReport().then((r) => { state.device = r; $('#device').textContent = describeDevice(r); });
renderDoors();

// ---------- Hands-free answers ----------
const listener = new CommandListener((cmd) => {
  if (cmd === 'yes' && state.asking) $('#yes').click();
  else if (cmd === 'no' && state.asking) $('#notyet').click();
  else if (cmd === 'skip') $('#skip').click();
  else if (cmd === 'repeat' && say.last) say(say.last.line, say.last.lang);
  else if (cmd === 'stop') $('#stop').click();
}, (heard) => toast(`Heard: "${heard}"`));
$('#handsfree').onclick = () => {
  const on = $('#handsfree').getAttribute('aria-pressed') === 'true';
  if (on) { listener.stop(); $('#handsfree').setAttribute('aria-pressed', 'false'); return; }
  if (!voiceAvailable) return toast('Voice commands need Chrome speech recognition.');
  listener.start(state.lang);
  $('#handsfree').setAttribute('aria-pressed', 'true');
  toast('Listening: say "yes", "haan", "skip" or "repeat".');
};

// ---------- Dictate directions ----------
$('#mic').onclick = async () => {
  unlockSpeech();
  const btn = $('#mic'), status = $('#mic-status');
  if (btn.classList.contains('live')) { micStop?.(); return; }
  btn.classList.add('live');
  const sheet = $('#vsheet');
  sheet.hidden = false;
  sheet.classList.remove('speaking', 'offline');
  $('#vlive').textContent = 'Speak the directions in any language';
  $('#vtrans').textContent = '';
  status.hidden = true;
  const native = ['hi', 'ta', 'kn', 'ml', 'tanglish', 'hinglish'].includes(speechLang);
  const done = (heard, english, ms) => {
    $('#note').value = heard;
    state.altNote = english && english !== heard ? english : null;
    state.spokenLang = { tanglish: 'ta', hinglish: 'hi', auto: null }[speechLang] ?? speechLang;
    state.lastVoice = { at: new Date().toLocaleTimeString(), chip: speechLang, heard, english: english || '', ms };
  };
  try {
    let heard = '';
    // 1) The phone's speech engine (best for Indian languages and code-mixing), live transcript in our sheet.
    if (voiceAvailable && speechEngine !== 'whisper') {
      $('#vtitle').textContent = 'Listening…';
      micStop = () => dictate.stop?.();
      const t0 = performance.now();
      try {
        heard = await dictate(speechLang, (p) => { sheet.classList.add('speaking'); $('#vlive').textContent = p; }, (m) => ($('#vtitle').textContent = m));
        if (heard) done(heard, '', Math.round(performance.now() - t0));
      } catch (e) {
        if (!(await sttAvailable())) throw e; // nothing to fall back to
        $('#vtitle').textContent = 'Switching to on-device Whisper…';
      }
    }
    // 2) Fallback: on-device Whisper (works with no network and no speech pack).
    if (!heard && (await sttAvailable())) {
      sheet.classList.add('offline');
      $('#vtitle').textContent = 'Listening · on-device';
      const rec = listen({ canvas: $('#vwave'), onPartial: (t) => { sheet.classList.add('speaking'); $('#vlive').textContent = t; }, onState: (m) => ($('#vtitle').textContent = m), getLang: () => speechLang });
      micStop = rec.stop;
      const r = await rec.done;
      if (r.text) {
        heard = native && r.original ? r.original : r.text;
        done(heard, r.text, r.ms);
        if (heard !== r.text) { status.hidden = false; status.textContent = `English: "${r.text}"`; }
      }
    }
    if (!heard) { status.hidden = false; status.textContent = 'Didn’t catch that. Tap the mic and try again.'; }
  } catch (e) { status.hidden = false; status.textContent = `Voice: ${e.message}. Type the directions instead.`; }
  sheet.hidden = true;
  btn.classList.remove('live');
};

let micStop = null;
let speechEngine = 'auto';
try { speechEngine = localStorage.getItem('pahunch.speechEngine') || 'auto'; } catch {}
// Spoken language for offline voice: Auto, or pinned (much better for Hindi / Tamil / Kannada / Malayalam).
let speechLang = 'auto';
try { speechLang = localStorage.getItem('pahunch.speechLang') || 'auto'; } catch {}
function renderLangs() {
  $('#vlangs').replaceChildren(...Object.entries(SPEECH_LANGS).map(([k, v]) => {
    const b = el('button', 'vlang' + (k === speechLang ? ' on' : ''), v.label);
    b.onclick = () => { speechLang = k; try { localStorage.setItem('pahunch.speechLang', k); } catch {} renderLangs(); };
    return b;
  }));
}
renderLangs();
$('#vdone').onclick = () => micStop?.();

// ---------- Voice log (what was heard -> what was planned), to diagnose real failures ----------
const VKEY = 'pahunch.voicelog';
function logVoice(entry) {
  try { const l = JSON.parse(localStorage.getItem(VKEY) || '[]'); l.push(entry); localStorage.setItem(VKEY, JSON.stringify(l.slice(-15))); } catch {}
}
$('#vlog-copy').onclick = async () => {
  let l = [];
  try { l = JSON.parse(localStorage.getItem(VKEY) || '[]'); } catch {}
  if (!l.length) return toast('No voice attempts logged yet: use the mic, then Plan route.');
  const txt = l.map((e, i) => `#${i + 1} ${e.at} chip=${e.chip} ${(e.ms / 1000).toFixed(1)}s\n heard:   ${e.heard}\n english: ${e.english}\n used:    ${e.used}\n plan:    ${e.plan} [${e.engine}]`).join('\n\n');
  try { await navigator.clipboard.writeText(txt); toast(`Copied ${l.length} voice attempts. Paste them to Claude.`); }
  catch { $('#sensors').textContent = txt; toast('Clipboard blocked: the log is shown in the panel; select and copy it.'); }
};

const engineLabel = () => ($('#engine-toggle').textContent = speechEngine === 'whisper' ? 'Speech: Whisper only (offline)' : 'Speech: phone engine (Whisper fallback)');
$('#engine-toggle').onclick = () => { speechEngine = speechEngine === 'whisper' ? 'auto' : 'whisper'; try { localStorage.setItem('pahunch.speechEngine', speechEngine); } catch {} engineLabel(); };
setTimeout(engineLabel, 0);

// ---------- Field test: with vs without Pahunch ----------
// "Without" runs are timed here (description + calls); "with" runs come from door cards (time to door).
const TKEY = 'pahunch.trials';
const loadTrials = () => { try { return JSON.parse(localStorage.getItem(TKEY) || '[]'); } catch { return []; } };
const saveTrials = (t) => { try { localStorage.setItem(TKEY, JSON.stringify(t)); } catch {} };
let run = null;
function renderTrials() {
  const base = loadTrials(), withP = loadCards().filter((c) => c.secs != null && !c.excluded);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const b = avg(base.map((x) => x.secs)), w = avg(withP.map((c) => c.secs)), bc = avg(base.map((x) => x.calls));
  $('#t-sum').textContent = [
    `Without Pahunch: ${base.length} run(s)${b != null ? ` · avg ${Math.round(b)} s · ${bc.toFixed(1)} calls` : ''}`,
    `With Pahunch:    ${withP.length} run(s)${w != null ? ` · avg ${Math.round(w)} s · 0 calls` : ''}`,
    b != null && w != null ? `Saved:           ${Math.round(b - w)} s per delivery (${Math.round((1 - w / b) * 100)}%)` : 'Do at least one run of each to compare.',
  ].join('\n');
}
$('#t-go').onclick = () => {
  if (!run) { run = { at: performance.now(), calls: 0 }; $('#t-go').textContent = 'Found it · stop'; $('#t-call').disabled = false; return; }
  const t = loadTrials(); t.push({ secs: Math.round((performance.now() - run.at) / 1000), calls: run.calls, when: Date.now() }); saveTrials(t);
  run = null; $('#t-go').textContent = 'Start "without" run'; $('#t-call').disabled = true; $('#t-call').textContent = '+1 call'; renderTrials();
};
$('#t-call').onclick = () => { if (run) { run.calls++; $('#t-call').textContent = `+1 call (${run.calls})`; } };
$('#t-clear').onclick = () => { if (confirm('Clear the "without" runs? Door cards are kept.')) { saveTrials([]); renderTrials(); } };
$('#trials').addEventListener('toggle', renderTrials);

// ---------- Step-by-step voice ----------
// Short phrases are recognised far better than one long sentence. Each phrase is parsed on its own,
// read back in the rider's language ("Ganesha கோவில் தாண்டி, சரியா?"), and kept only when confirmed.
const CONFIRM_Q = { en: 'Right?', hi: 'ठीक है?', ta: 'சரியா?', kn: 'ಸರಿನಾ?', ml: 'ശരിയാണോ?' };
const VOICE_OF = { tanglish: 'ta', hinglish: 'hi', auto: 'en' };
let build = null;
const buildLang = () => VOICE_OF[speechLang] || speechLang || 'en';
function stepWords(st, lang) {
  const T2 = text(lang);
  if (st.kind === 'turn') return T2.turn(st.ordinal, T2[st.turn]);
  return localName(st.landmark, lang);
}
function renderBuild() {
  $('#s-title').textContent = `Step ${build.steps.length + 1}`;
  $('#s-list').replaceChildren(...build.steps.map((s) => el('li', null, describe({ ...s, kind: s.kind === 'arrive' ? 'pass' : s.kind }))));
  $('#s-ok').hidden = !build.pending;
  $('#s-got').textContent = build.pending ? build.pending.map((s) => describe({ ...s, kind: s.kind === 'arrive' ? 'pass' : s.kind })).join(' → ') : '';
}
$('#stepmode').onclick = () => {
  unlockSpeech();
  build = { steps: [], pending: null };
  $('#s-heard').textContent = '';
  $('#ssheet').hidden = false;
  renderBuild();
};
$('#s-cancel').onclick = () => { micStop?.(); $('#ssheet').hidden = true; build = null; };
$('#s-mic').onclick = async () => {
  const btn = $('#s-mic');
  if (btn.classList.contains('live')) return micStop?.();
  btn.classList.add('live'); btn.textContent = 'Listening… tap to stop';
  build.pending = null; renderBuild();
  let heard = '';
  try {
    if (voiceAvailable && speechEngine !== 'whisper') {
      micStop = () => dictate.stop?.();
      try { heard = await dictate(speechLang, (p) => ($('#s-heard').textContent = p)); } catch (e) { if (!(await sttAvailable())) throw e; }
    }
    if (!heard && (await sttAvailable())) {
      const rec = listen({ canvas: $('#s-wave'), onPartial: (t) => ($('#s-heard').textContent = t), getLang: () => speechLang });
      micStop = rec.stop;
      const r = await rec.done;
      heard = ['hi', 'ta', 'kn', 'ml'].includes(speechLang) && r.original ? r.original : r.text;
      if (heard !== r.text) build.alt = r.text;
    }
  } catch (e) { toast(`Voice: ${e.message}`); }
  btn.classList.remove('live'); btn.textContent = 'Speak';
  $('#s-heard').textContent = heard ? `"${heard}"` : 'Didn’t catch that. Tap Speak and try again.';
  if (!heard) return;
  let steps = parseRules(heard).steps.filter((s) => s.kind === 'turn' || s.landmark);
  if (!steps.length && build.alt) steps = parseRules(build.alt).steps.filter((s) => s.kind === 'turn' || s.landmark);
  build.alt = null;
  if (!steps.length) { toast('No landmark or turn in that. Try "second left" or "Ganesh mandir".'); return; }
  build.pending = steps;
  renderBuild();
  const lang = buildLang();
  say(`${steps.map((s) => stepWords(s, lang)).join(', ')}. ${CONFIRM_Q[lang] || CONFIRM_Q.en}`, lang);
  buzz('ask');
};
$('#s-ok').onclick = () => { build.steps.push(...build.pending); build.pending = null; $('#s-heard').textContent = ''; renderBuild(); buzz('spotted'); };
$('#s-done').onclick = () => {
  if (build.pending) build.steps.push(...build.pending);
  if (!build.steps.length) return toast('Say at least one step first.');
  const g = { floor: null, lang: buildLang(), parser: 'rules', steps: build.steps.map((s) => ({ ...s })), note: build.steps.map(describe).join(', '), ms: 0 };
  renumber(g);
  $('#ssheet').hidden = true; build = null;
  state.parse = { rules: g };
  state.graph = g;
  state.lang = g.lang;
  renderPlan();
  show('plan');
};

// ---------- Modes ----------
function setMode(mode) {
  const m = MODES[mode] ? mode : 'delivery';
  document.body.dataset.mode = m;
  try { localStorage.setItem('pahunch.mode', m); } catch {}
  $('#mode-badge').textContent = MODES[m].badge;
  $('#home-title').textContent = MODES[m].title;
  $('#home-sub').textContent = MODES[m].sub;
}
document.querySelectorAll('.role').forEach((b) => (b.onclick = () => { setMode(b.dataset.mode); show('home'); }));
$('#mode-badge').onclick = () => show('roles');

$('#selftest').onclick = () => {
  unlockSpeech();
  const lang = state.lang || 'en';
  say(text(lang).spotted('Pahunch voice'), lang);
  const vib = navigator.vibrate ? navigator.vibrate([250, 120, 250]) : false;
  const n = speechSynthesis?.getVoices?.().length ?? 0;
  toast(`Voice: ${n} voices installed${n ? '' : ' (install Google Text-to-speech voices)'} · Vibration: ${vib ? 'sent' : 'blocked (check phone vibration / Do Not Disturb)'}`, 7000);
};

// ---------- Live sensors panel ----------
setInterval(() => {
  if ($('#home').hidden || !$('#sensors-panel').open) return;
  $('#sensors').textContent = sensors.report({ heading: compass.heading, brightness: state.brightness });
}, 400);

// ---------- Splash: warm up models, then continue ----------
// ?lite: skip loading the AI models (design preview on a weak laptop).
const LITE = location.search.includes('lite');

async function boot() {
  const mark = (k, ok, note) => { const li = document.querySelector(`#boot [data-k="${k}"]`); li.classList.add(ok ? 'ok' : 'skip'); if (note) li.insertAdjacentHTML('beforeend', `<em>${note}</em>`); };
  const t0 = performance.now();
  const jobs = LITE ? ['camera', 'ocr', 'llm', 'sensors'].map((k) => Promise.resolve(mark(k, true, 'preview'))) : [
    Promise.all([detector.load(), scene.load().catch(() => null)]).then(() => mark('camera', true, `objects + places · ${detector.delegate}`), () => mark('camera', false, 'unavailable')),
    new Promise((r) => (window.Tesseract ? r() : addEventListener('load', r, { once: true }))).then(() => vision.loadOcr('eng')).then(() => mark('ocr', true, 'Tesseract · 4 languages'), () => mark('ocr', false, 'failed')),
    warmNative().then((up) => mark('llm', up, up ? 'Qwen2.5 · llama.cpp' : 'rules only (start.sh)')),
    new Promise((r) => setTimeout(r, 900)).then(() => mark('sensors', !!(sensors.gyro || compass.heading != null || sensors.pos), sensors.gyro ? 'gyro ✓ compass ✓' : 'limited')),
  ];
  await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, 9000))]);
  await new Promise((r) => setTimeout(r, Math.max(0, 1600 - (performance.now() - t0))));
  let saved = null;
  try { saved = localStorage.getItem('pahunch.mode'); } catch {}
  const link = new URLSearchParams(location.hash.slice(1));
  if (link.get('go')) {
    // Opened from a partner app (delivery / 108 dispatch): load its directions and plan straight away.
    setMode(link.get('mode') || saved || 'delivery');
    $('#note').value = link.get('go');
    show('home');
    setTimeout(() => $('#parse').click(), 300);
  } else {
    setMode(saved || 'delivery');
    show(saved ? 'home' : 'roles');
  }
  $('#splash').classList.add('out');
  setTimeout(() => ($('#splash').hidden = true), 450);
}

if ('serviceWorker' in navigator && !location.search.includes('nosw')) navigator.serviceWorker.register('sw.js').catch(() => {});
for (const s of screens) $(`#${s}`).hidden = true;
boot();
