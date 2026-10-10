import { blocked, guard } from './guard.js'; // first: refuses any request that would leave the phone
import { SAMPLES, describe, parseRules, verifyFor, isRoute, routeWords, leftovers } from './parser.js';
import { parseNote, warmNative, complete, agrees, translateLine, llmDevice } from './llm.js';
import { Vision, matchSigns, ocrLangs, distinctive } from './vision.js';
import { Overlay } from './overlay.js';
import { startNetMeter, formatBytes } from './netmeter.js';
import { say as speakAloud, text, buzz, stepText, Compass, unlockSpeech, localName, BUZZ } from './guide.js';
import { Detector } from './detector.js';
import { Scene, TYPE_TAG } from './scene.js';
import { Sensors, GyroTurn } from './sensors.js';
import { dictate, CommandListener, voiceAvailable, localSpeechStatus, installLocalSpeech, localeFor } from './voice.js';
import { listen, sttAvailable, SPEECH_LANGS, transcribeNote, clipAt } from './stt.js';
import { ASK, card as askCard } from './askcard.js';
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
  silent: { badge: 'Silent', title: 'Where to?', sub: 'Silent mode: every instruction is shown big and felt as vibration. Nothing needs to be heard.' },
  ride: { badge: 'Pickup', title: 'Find your passenger', sub: 'Paste where they said they are waiting: "opposite the bus stop, blue shirt".' },
};
const ambulance = () => document.body.dataset.mode === 'ambulance';
const silent = () => document.body.dataset.mode === 'silent';

// Every spoken line goes through here: in Silent mode it becomes a big on-screen card + flash + buzz instead.
function say(line, lang = 'en') {
  say.last = { line, lang };
  if (silent()) return showCue(line);
  speakAloud(line, lang);
}
let cueTimer;
function showCue(line) {
  const c = $('#cue');
  c.textContent = line;
  c.hidden = false;
  c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
  document.body.classList.remove('flashing'); void document.body.offsetWidth; document.body.classList.add('flashing');
  clearTimeout(cueTimer);
  cueTimer = setTimeout(() => (c.hidden = true), 7000);
}
document.querySelectorAll('#haptic-legend [data-buzz]').forEach((b) => (b.onclick = () => navigator.vibrate?.(BUZZ[b.dataset.buzz])));

// ---------- Router ----------
const screens = ['roles', 'home', 'call', 'plan', 'guide', 'arrive'];
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

$('#note').addEventListener('input', () => { state.altNote = null; state.spokenLang = null; if (!$('#note').value.trim()) state.vnote = null; });

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
  if (res.notRoute || !isRoute(res.graph)) {
    // Small talk ("hi how are you") or nothing checkable: never show an empty or made-up plan.
    if (state.lastVoice) { logVoice({ ...state.lastVoice, used: note, plan: '(not directions)', engine: '-' }); state.lastVoice = null; }
    const st = $('#mic-status');
    st.hidden = false;
    st.textContent = 'That doesn’t sound like directions. Say the landmarks and turns, like “past the temple, second left, blue gate opposite MedPlus”.';
    buzz('ask');
    return;
  }
  $('#mic-status').hidden = true;
  state.parse = res;
  state.graph = res.graph;
  state.custLang = null;
  if (state.lastVoice) { logVoice({ ...state.lastVoice, used: note, plan: res.graph.steps.map(describe).join(' → '), engine: res.graph.parser }); state.lastVoice = null; }
  state.graph.ms = Math.round((performance.now() - t0) * 10) / 10;
  state.graph.note = note;
  if (res.stats) state.inferences.push({ at: Date.now(), ...res.stats });
  if (res.fallback && $('#engine').value !== 'auto') toast(`On-device model not used (${res.fallback}). Rule parser took over.`);
  const pick = $('#voice').value;
  state.lang = pick === 'auto' ? state.spokenLang || state.graph.lang : pick; // reply in the language that was spoken
  renderPlan();
  show('plan');
  if (res.sure) crossCheck(note, state.graph);
};

// The rules read every word, so their plan is shown at once; the on-device model (Gemma 3n) still reads the
// same words in the background and says whether it agrees: a second, independent reading on the phone.
async function crossCheck(note, g) {
  const r = await parseNote(note, { mode: 'native' }).catch(() => null);
  if (!r?.stats || !r.llmGraph || state.graph !== g || $('#plan').hidden) return;
  state.inferences.push({ at: Date.now(), ...r.stats });
  state.parse.stats = r.stats;
  const same = agrees(r.llmGraph, g);
  $('#parsed-by').textContent += `
On-device AI cross-check (${r.stats.model.replace(/.gguf$/, '')}, ${(r.stats.ms / 1000).toFixed(1)} s): ${same ? 'same route ✓' : 'reads it a little differently, check the steps'}`;
}

$('#use-other').onclick = () => {
  const p = state.parse;
  const other = state.graph.parser === 'llm' ? p.rules : p.llmGraph;
  if (state.graph.parser === 'llm') p.llmGraph = state.graph;
  Object.assign(other, { note: state.graph.note, ms: state.graph.ms });
  state.graph = other;
  renderPlan();
};

// ---------- Plan ----------
// How each step can be checked, said plainly: a distinctive sign the camera can read is the only real check;
// colours, objects and turns are cues; everything else is the rider's call.
function chips(step) {
  const v = step.verify, out = [];
  const strong = v.signs.filter((w) => distinctive(w));
  for (const w of strong) out.push(['sign', `sign: ${w}`]);
  for (const w of v.signs.filter((x) => !distinctive(x))) out.push(['type', `common name: ${w}`]);
  if (!v.signs.length) for (const w of v.alt.slice(0, 2)) out.push(['type', `word: ${w}`]);
  if (v.colour) out.push(['colour', `colour cue: ${v.colour}`]);
  for (const o of v.objects || []) out.push(['type', `object cue: ${o}`]);
  if (v.compass) out.push(['compass', 'turn detected by sensor']);
  out.push(strong.length ? ['conf-high', 'camera can check'] : step.kind === 'turn' ? ['conf-medium', 'cue only'] : v.colour || v.alt.length || (v.objects || []).length ? ['conf-medium', 'cue only'] : ['conf-low', 'you confirm']);
  return out;
}

function renderPlan() {
  const g = state.graph, p = state.parse || {}, st = p.stats;
  const ai = st ? `${st.model} · ${st.backend} · ${(st.ms / 1000).toFixed(1)} s · ${st.tokensIn ?? '?'}→${st.tokensOut ?? '?'} tokens · ${st.tps ? st.tps.toFixed(1) : '?'} tok/s` : '';
  const usedAI = g.parser === 'llm' && st && !p.fallback;
  $('#parsed-by').textContent = usedAI
    ? `Understood on this phone in ${(st.ms / 1000).toFixed(1)} s · on-device AI (${st.model.replace(/.gguf$/, '')}${state.llmDevice ? ` · ${state.llmDevice}` : ''})`
    : `Understood on this phone in ${g.ms} ms · rule engine${p.sure ? ' (every word understood, AI not needed)' : ''}${p.fallback && p.fallback !== 'no on-device model running' ? ' (AI answer unclear)' : p.fallback ? ' (AI model not running)' : ''}`;
  if (false) $('#parsed-by').textContent = g.parser === 'llm' && st
    ? `Route read on this phone by ${ai} · turns and floor checked against the note · language: ${g.lang}`
    : st && !p.fallback
      ? `Route by rule parser (instant), cross-checked on this phone by ${ai} · language: ${g.lang}`
      : `Route read by the rule parser in ${g.ms} ms · language: ${g.lang}${p.fallback && p.fallback !== "no on-device model running" ? " · AI cross-check skipped (unclear answer)" : ""}`;
  if (p.rewrite) $('#parsed-by').textContent += `
AI understood: "${p.rewrite}"`;
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
    if (state.lang && state.lang !== 'en') { li.append(el('div', 'step-line', stepText(s, state.lang)), el('div', 'step-en', describe(s))); }
    else li.append(el('div', 'step-line', describe(s)));
    if (state.vnote?.segments?.length) {
      const clip = clipAt(state.vnote.segments, s.at ?? i / Math.max(1, g.steps.length));
      if (clip) {
        const b = el('button', 'hear', '▶ hear it');
        b.title = 'Play what the customer said for this step';
        b.onclick = (e) => { e.stopPropagation(); playClip(clip, b); };
        li.append(b);
      }
    }
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
  renderPlanNotes(g);
  $('#floor').textContent = g.floor != null ? `Floor: ${g.floor === 0 ? 'ground' : g.floor}` : '';
}

$('#edit').onclick = () => show('home');

// Play the moment of the voice note a step came from (2-3 s): every step traceable to what was said.
let clipTimer = null;
function playClip({ start, end }, btn) {
  const a = $('#vnote-audio');
  if (!a.src) return;
  clearTimeout(clipTimer);
  document.querySelectorAll('.hear.playing').forEach((x) => x.classList.remove('playing'));
  btn?.classList.add('playing');
  a.currentTime = start;
  a.play().catch(() => {});
  clipTimer = setTimeout(() => { a.pause(); btn?.classList.remove('playing'); }, Math.max(800, (end - start) * 1000));
}

// Where the customer's directions start, what is clearly missing, and what didn't become a step.
function renderPlanNotes(g) {
  const first = g.steps[0];
  const startEl = $('#plan-start'), gapEl = $('#plan-gap');
  startEl.hidden = false;
  startEl.textContent = first?.kind === 'turn'
    ? "Customer didn't say where these turns start: count them from where you are now."
    : first?.landmark ? `Start from: ${describe({ ...first, kind: 'pass' }).replace(/^Pass /, '')} (the customer's first landmark)` : '';
  if (!startEl.textContent) startEl.hidden = true;
  // Only hard gaps: no description of the destination at all.
  const last = g.steps.at(-1);
  gapEl.hidden = !!(last?.landmark || last?.ref);
  gapEl.textContent = gapEl.hidden ? '' : "The customer didn't describe the door itself: at the end, use Ask (gate? floor?).";
  const rest = leftovers(g.note || $('#note').value);
  $('#also').hidden = !rest.length;
  $('#also-list').replaceChildren(...rest.map((t) => {
    const li = el('li');
    li.append(el('span', null, `"${t}"`));
    if (state.vnote?.segments?.length) {
      const note = (g.note || $('#note').value), at = note.indexOf(t);
      const clip = at >= 0 ? clipAt(state.vnote.segments, at / Math.max(1, note.length)) : null;
      if (clip) { const b = el('button', 'hear', '▶ hear it'); b.onclick = () => playClip(clip, b); li.append(b); }
    }
    return li;
  }));
}

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
  const rl = state.lang && state.lang !== 'en';
  $('#step-line').textContent = rl ? stepText(s, state.lang) : describe(s);
  $('#step-en').textContent = rl ? describe(s) : '';
  const nx = state.graph.steps[state.i + 1];
  $('#step-next').textContent = nx ? `Next: ${rl ? stepText(nx, state.lang) : describe(nx)}` : '';
  $('#dots').replaceChildren(...state.graph.steps.map((_, k) => el('i', k < state.i ? 'done' : k === state.i ? 'now' : '')));
  $('#her-voice').hidden = !state.vnote?.segments?.length;
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
    state.turn = new GyroTurn(sensors, compass, s.turn, () => { state.lastHow = 'cue'; confirmStep(T().turned); });
    overlay.setTurn(state.turn);
  } else {
    state.turn = null;
    const look = T().look(spokenName(s.landmark));
    say(lead + (prefix ? look.charAt(0).toLowerCase() + look.slice(1) : look), state.lang);
  }
}

function confirmStep(line) {
  const s = step();
  (state.how ||= [])[state.i] = state.lastHow || 'rider';
  state.lastHow = null;
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

$('#yes').onclick = () => {
  if (step()?.kind === 'arrive') state.arriveBy = 'rider'; $('#ask').hidden = true; state.asking = false; confirmStep(T().spotted(spokenName(step().landmark))); };
$('#notyet').onclick = () => { $('#ask').hidden = true; state.asking = false; state.askCooldown = performance.now() + 4000; };
$('#turned').onclick = () => { state.lastHow = 'rider'; confirmStep(T().turned); };
$('#skip').onclick = () => { if (step()?.kind === 'arrive') state.arriveBy = 'rider'; confirmStep(); };
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
  overlay.setBoxes(res.boxes, m.word, m.word && (m.hit === 'name' ? `✓ ${m.word} · sign read` : `${m.word}? · check`));
  renderSeen(res.fresh || res.words, m.word);
  if (state.asking || !m.hit) return;
  if (s.kind === 'pass') {
    // A named signboard is strong evidence: confirm. A generic word ("TEMPLE") asks, except in ambulance mode.
    if (m.hit === 'name' || ambulance()) { state.lastHow = m.hit === 'name' ? 'sign' : 'cue'; confirmStep(T().spotted(spokenName(s.landmark))); }
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
  state.arriveBy = ownName ? 'own' : 'described';
  if (ownName || (sign && (!needColour || colour)) || (colour && !needSign)) { state.lastHow = ownName ? 'sign' : 'cue'; return confirmStep(); }
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

// Tap the camera view: read the centre box now, at full sharpness.
async function scanNow() {
  if (!state.running) return;
  $('#ocr-ms').textContent = 'scanning the box…';
  navigator.vibrate?.(30);
  try { const res = await vision.scanBox(); if (res) onOcr(res); else toast('Hold steady and tap again.'); } catch (e) { console.warn(e); }
}
$('#video').addEventListener('click', scanNow);

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
  const label = `seen: ${hit.label} · step ${s.n}`;
  if (state.objHits < 2 || state.asking) return { label: hit.label, text: label };
  if (s.kind === 'pass') { state.lastHow = 'cue'; confirmStep(T().spotted(spokenName(s.landmark))); }
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

async function startGuide(from = 0) {
  state.i = from;
  if (!from) state.how = [];
  state.arriveBy = null;
  state.startedAt = performance.now();
  show('guide');
  try {
    await vision.startCamera();
  } catch (e) {
    toast(`Camera unavailable: ${e.message}. Use Skip / Yes to step through.`);
  }
  try { state.wake = await navigator.wakeLock?.request('screen'); } catch {}
  const langs = ocrLangs(state.graph);
  if ((!vision.worker || vision.langs !== langs) && !LITE) {
    $('#ocr-ms').textContent = 'loading OCR…';
    try { await vision.loadOcr(langs); } catch (e) { toast(`OCR failed: ${e.message}`); }
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
  if (state.order) postOrder(state.order.id, 'status', { status: 'arrived' });
  const secs = Math.round((performance.now() - state.startedAt) / 1000);
  say(T().arrived(g.floor), state.lang);
  buzz('arrived');
  state.card = makeCard(g, { secs, lang: state.lang });
  state.card.photo = doorPhoto();
  saveCard(state.card);
  showCard(state.card, true);
  fixPosition(state.card);
}

// Door card: saved straight away, then filled in as the GPS fix and the photo arrive.
function showCard(card, fresh) {
  state.card = card;
  const own = state.arriveBy === 'own';
  void own;
  $('#arrive-title').textContent = fresh ? "You've arrived" : 'Arrival record';
  $('#arrive-sub').hidden = !fresh;
  $('#arrive-sub').textContent = `End of the customer's directions: ${card.dest}`;
  $('#arrive-ask').hidden = true;
  $('#arrive-yes').hidden = !fresh;
  $('#done-summary').hidden = true;
  $('#again').textContent = 'New route';
  $('#tick').hidden = !fresh;
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
  $('#card-pin').textContent = c.digipin ? formatDigipin(c.digipin) : state.locating ? 'locating…' : 'waiting for GPS';
  $('#card-acc').textContent = c.digipin ? `${c.approx ? 'approx. · last GPS fix + steps walked · ' : ''}±${c.acc ?? '?'} m · ${c.lat}, ${c.lon}` : state.locating ? '' : 'No satellites here (indoors). Fills in by itself when GPS returns.';
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

// Position for the door card. Offline there is no Wi-Fi/cell location, only satellites, which indoors may give
// nothing: use the live fix, else wait briefly, else the last good fix widened by the distance walked since
// (marked "approx."), and keep listening: a real fix arriving later replaces it.
async function fixPosition(card) {
  const apply = (e) => {
    setPosition(card, { latitude: e.lat, longitude: e.lon, accuracy: e.acc });
    card.approx = !!e.estimated;
    if (loadCards().some((c) => c.id === card.id)) saveCard(card);
    if (state.card === card) renderCard();
  };
  state.locating = true;
  renderCard();
  let e = sensors.estimate();
  if (!e || e.estimated) {
    const pos = await locate(12000);
    if (pos) e = { lat: pos.latitude, lon: pos.longitude, acc: pos.accuracy, estimated: false };
  }
  state.locating = false;
  if (e) apply(e);
  else if (state.card === card) renderCard();
  if (!e || e.estimated) {
    // Upgrade to a real fix when one comes (step outside, satellites found).
    const prev = sensors.onFix;
    sensors.onFix = (p) => { prev?.(p); if (p.acc <= 60 && (!card.digipin || card.approx)) { apply({ ...p, estimated: false }); sensors.onFix = prev; } };
  }
}

// The door photo is taken from the guide camera at the moment of arrival (no extra step for the rider).
function doorPhoto() {
  const v = $('#video');
  if (!v.videoWidth) return null;
  const c = document.createElement('canvas'), k = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
  c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/jpeg', 0.72); } catch { return null; }
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
  $('#doors-sum').textContent = `Recent arrivals (${cards.length})`;
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
  chip.textContent = requests ? `${requests} off-device request${requests > 1 ? 's' : ''} · ${formatBytes(bytes)}` : `${state.speechCloud ? 'App data 0 B · speech via Google (online)' : 'On-device · 0 B sent'}${blocked.length ? ` · ${blocked.length} blocked` : ''}`;
  chip.classList.toggle('cloud', !!state.speechCloud && !requests);
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
}, (heard, off) => {
  if (off) { $('#handsfree').setAttribute('aria-pressed', 'false'); return toast(off === 'network' ? 'Hands-free is off: no offline speech pack for this language. Tap Yes / Not yet.' : `Hands-free is off (${off}).`, 6000); }
  toast(`Heard: "${heard}"`);
});
$('#handsfree').onclick = () => {
  const on = $('#handsfree').getAttribute('aria-pressed') === 'true';
  if (on) { listener.stop(); $('#handsfree').setAttribute('aria-pressed', 'false'); return; }
  if (!voiceAvailable) return toast('Voice commands need Chrome speech recognition.');
  listener.start(state.lang);
  $('#handsfree').setAttribute('aria-pressed', 'true');
  toast('Listening: say "yes", "haan", "skip" or "repeat".');
};

// ---------- Keyboard voice (Gboard), only when chosen in Live sensors ----------
// The keyboard's own mic types into the note. Optional: the app's mic does offline speech itself (below).
const keyboardVoice = () => speechEngine === 'keyboard';

// Offline, the phone's speech engine (Google's, the one Gboard uses) works only if its offline pack for that
// language is installed. When it fails offline for a language, that language goes straight to on-device
// Whisper until the phone is back online, so the rider is asked to repeat at most once.
const phoneOfflineFails = new Set();
addEventListener('online', () => phoneOfflineFails.clear());
// Offline it is used only for languages Chrome has downloaded for on-device recognition (else straight to Whisper).
const localReady = new Set();
const onDeviceNow = () => !navigator.onLine && localReady.has(localeFor(speechLang));
const usePhoneEngine = () => voiceAvailable && speechEngine !== 'whisper' && (navigator.onLine || (onDeviceNow() && !phoneOfflineFails.has(speechLang)));
const phoneFailed = (e) => { if (!navigator.onLine && !['no-speech', 'aborted'].includes(e?.code)) phoneOfflineFails.add(speechLang); };
let kbd = null; // { t0 } while keyboard dictation is open
function kbdOpen() {
  const note = $('#note');
  kbd = { t0: performance.now() };
  $('#mic').classList.add('live');
  $('#mic-status').hidden = true;
  $('#kbd-hint').hidden = false;
  note.focus();
  note.select(); // new dictation replaces the old note; tap inside to add to it instead
  setTimeout(() => $('#kbd-hint').scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 450);
}
function kbdClose() {
  if (!kbd) return;
  const heard = $('#note').value.trim();
  if (heard) state.lastVoice = { at: new Date().toLocaleTimeString(), chip: 'keyboard', heard, english: '', ms: Math.round(performance.now() - kbd.t0) };
  kbd = null;
  $('#mic').classList.remove('live');
  $('#kbd-hint').hidden = true;
  $('#note').blur();
}
$('#kbd-plan').onclick = () => { kbdClose(); $('#parse').click(); };
$('#parse').addEventListener('click', kbdClose, { capture: true });

// ---------- Dictate directions ----------
$('#mic').onclick = async () => {
  unlockSpeech();
  const btn = $('#mic'), status = $('#mic-status');
  if (kbd) return kbdClose();
  if (btn.classList.contains('live')) { micStop?.(); return; }
  if (keyboardVoice()) return kbdOpen();
  btn.classList.add('live');
  const sheet = $('#vsheet');
  sheet.hidden = false;
  sheet.classList.remove('speaking', 'offline');
  $('#vlive').textContent = 'Speak the directions in any language';
  $('#vtrans').textContent = '';
  status.hidden = true;
  const native = ['hi', 'ta', 'kn', 'ml', 'tanglish', 'hinglish'].includes(speechLang);
  const done = (heard, english, ms) => {
    state.vnote = null;
    $('#note').value = heard;
    state.altNote = english && english !== heard ? english : null;
    state.spokenLang = { tanglish: 'ta', hinglish: 'hi', auto: null }[speechLang] ?? speechLang;
    state.lastVoice = { at: new Date().toLocaleTimeString(), chip: speechLang, heard, english: english || '', ms };
  };
  try {
    let heard = '';
    // 1) The phone's speech engine (best for Indian languages and code-mixing), live transcript in our sheet.
    //    Offline it runs on the phone when the language's offline pack is installed.
    if (usePhoneEngine()) {
      const offline = !navigator.onLine;
      $('#vtitle').textContent = offline ? 'Listening · Google on-device speech, offline' : 'Listening…';
      micStop = () => dictate.stop?.();
      const t0 = performance.now();
      try {
        heard = await dictate(speechLang, (p) => { sheet.classList.add('speaking'); $('#vlive').textContent = p; }, (m) => ($('#vtitle').textContent = m), { local: onDeviceNow() });
        if (heard) done(heard, '', Math.round(performance.now() - t0));
      } catch (e) {
        phoneFailed(e);
        if (!(await sttAvailable())) throw e; // nothing to fall back to
        $('#vtitle').textContent = offline ? 'No offline speech pack for this language · using on-device Whisper' : 'Switching to on-device Whisper…';
        $('#vlive').textContent = 'Please say it once more';
        sheet.classList.remove('speaking');
      }
    }
    // 2) Fallback: on-device Whisper (works with no network and no speech pack).
    if (!heard && (await sttAvailable())) {
      sheet.classList.add('offline');
      $('#vtitle').textContent = navigator.onLine ? 'Listening · on-device' : 'Listening · offline, on this phone';
      const rec = listen({ canvas: $('#vwave'), onPartial: (t) => { sheet.classList.add('speaking'); $('#vlive').textContent = t; }, onState: (m) => ($('#vtitle').textContent = m), getLang: () => speechLang });
      micStop = rec.stop;
      const r = await rec.done;
      if (r.text) {
        heard = native && r.original ? r.original : r.text;
        done(heard, r.text, r.ms);
        if (heard !== r.text) { status.hidden = false; status.textContent = `English: "${r.text}"`; }
      }
    }
    if (!heard) { status.hidden = false; status.textContent = 'Didn’t catch that. Tap the mic and try again, or tap the box and use the mic on your keyboard.'; }
  } catch (e) { status.hidden = false; status.textContent = e.code ? e.message : `Voice: ${e.message}. You can also type the directions.`; }
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

const ENGINE_LABELS = {
  auto: 'Speech: phone engine, Whisper fallback (in-app, offline too)',
  whisper: 'Speech: Whisper only (on-device)',
  keyboard: 'Speech: keyboard mic (Gboard)',
};
const engineLabel = () => ($('#engine-toggle').textContent = ENGINE_LABELS[speechEngine] || ENGINE_LABELS.auto);
$('#engine-toggle').onclick = () => {
  const order = Object.keys(ENGINE_LABELS);
  speechEngine = order[(order.indexOf(speechEngine) + 1) % order.length];
  try { localStorage.setItem('pahunch.speechEngine', speechEngine); } catch {}
  engineLabel();
};
setTimeout(engineLabel, 0);

// ---------- Call mode: the customer's call on speaker -> live captions in the rider's language -> route ----------
// Android does not let apps record phone calls, so the microphone listens to the speakerphone. Each finished
// sentence becomes a caption; if the rider reads another language, the on-device model translates it underneath.
// "Make the route" sends the whole conversation through the same understanding as a typed note.
const call = { on: false, lines: [], stop: null, queue: Promise.resolve() };
const callFrom = () => $('#call-from').value, callTo = () => $('#call-to').value;
const baseLang = (l) => ({ tanglish: 'ta', hinglish: 'hi', auto: null }[l] ?? l);
function speechBadge(cloud) {
  state.speechCloud = cloud;
  $('#call-speech').textContent = cloud ? 'Speech: Google (online)' : 'Speech: on this phone';
  $('#call-speech').classList.toggle('cloud', cloud);
  netChip();
}
function renderCaptions() {
  const box = $('#captions');
  if (!call.lines.length) return;
  box.replaceChildren(...call.lines.map((l) => {
    const p = el('div', 'cap');
    p.append(el('p', 'cap-orig', l.text));
    if (l.tr) p.append(el('p', 'cap-tr', l.tr));
    else if (l.translating) p.append(el('p', 'cap-tr dim', 'translating…'));
    return p;
  }));
  box.scrollTop = box.scrollHeight;
  $('#call-route').disabled = !call.lines.length;
}
function addCaption(text) {
  const line = { text, tr: null, translating: false };
  call.lines.push(line);
  const from = baseLang(callFrom()), to = callTo();
  if (to && to !== from && !(to === 'en' && !from)) {
    line.translating = true;
    call.queue = call.queue.then(async () => { line.tr = await translateLine(text, to); line.translating = false; renderCaptions(); });
  }
  renderCaptions();
  navigator.vibrate?.(40);
}
async function callLoop() {
  while (call.on) {
    let heard = '';
    try {
      if (voiceAvailable && speechEngine !== 'whisper' && (navigator.onLine || onDeviceNow())) {
        speechBadge(navigator.onLine && !onDeviceNow());
        const p = dictate(callFrom(), (t) => ($('#call-live').textContent = t), null, { local: onDeviceNow() });
        call.stop = () => dictate.stop?.();
        heard = await p;
      } else if (await sttAvailable()) {
        speechBadge(false);
        const rec = listen({ onPartial: (t) => ($('#call-live').textContent = t), getLang: () => callFrom() });
        call.stop = rec.stop;
        const r = await rec.done;
        heard = r.original || r.text;
      } else { toast('No speech engine available: type the directions instead.'); break; }
    } catch (e) {
      if (!['no-speech', 'aborted'].includes(e?.code) && !/no speech/i.test(e?.message || '')) { toast(`Speech: ${e.message}`); await new Promise((r) => setTimeout(r, 800)); }
    }
    $('#call-live').textContent = '';
    if (heard) addCaption(heard);
  }
}
function setListening(on) {
  call.on = on;
  $('#call-listen').textContent = on ? 'Stop listening' : 'Start listening';
  $('#call-listen').classList.toggle('live', on);
  if (on) { unlockSpeech(); callLoop(); } else { call.stop?.(); $('#call-live').textContent = ''; }
}
$('#callmode').onclick = () => { show('call'); speechBadge(navigator.onLine && voiceAvailable && speechEngine !== 'whisper' && !onDeviceNow()); renderCaptions(); };
$('#call-back').onclick = () => { setListening(false); show('home'); };
$('#call-listen').onclick = () => setListening(!call.on);
$('#call-route').onclick = async () => {
  setListening(false);
  await call.queue;
  $('#note').value = call.lines.map((l) => l.text).join('. ');
  state.altNote = call.lines.every((l) => l.tr) && callTo() === 'en' ? call.lines.map((l) => l.tr).join('. ') : null;
  state.spokenLang = callTo(); // guidance spoken / shown in the rider's language
  state.lastVoice = { at: new Date().toLocaleTimeString(), chip: `call:${callFrom()}`, heard: $('#note').value, english: '', ms: 0 };
  show('home');
  $('#parse').click();
};

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
const buildLang = () => (speechLang === 'auto' && build?.lang) || VOICE_OF[speechLang] || speechLang || 'en';
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
  $('#s-type').hidden = true;
  $('#s-mic').textContent = 'Speak';
  $('#ssheet').hidden = false;
  renderBuild();
};
$('#s-cancel').onclick = () => { micStop?.(); $('#s-type').blur(); $('#ssheet').hidden = true; build = null; };
// Keyboard voice in step mode: the field takes the dictated phrase; "Use this" (or the keyboard's Done) reads it back.
function stepFromKeyboard() {
  const f = $('#s-type'), heard = f.value.trim();
  if (!heard) { f.focus(); return toast('Tap the mic on your keyboard and say this step.'); }
  f.value = '';
  f.blur();
  takeStep(heard);
}
$('#s-type').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); stepFromKeyboard(); } });
$('#s-mic').onclick = async () => {
  const btn = $('#s-mic');
  if (keyboardVoice()) {
    const f = $('#s-type');
    if (!f.hidden && f.value.trim()) return stepFromKeyboard();
    f.hidden = false;
    btn.textContent = 'Use this';
    build.pending = null; renderBuild();
    $('#s-heard').textContent = 'Tap the mic on your keyboard and say this step.';
    f.focus();
    return;
  }
  if (btn.classList.contains('live')) return micStop?.();
  btn.classList.add('live'); btn.textContent = 'Listening… tap to stop';
  build.pending = null; renderBuild();
  let heard = '';
  try {
    if (usePhoneEngine()) {
      micStop = () => dictate.stop?.();
      try { heard = await dictate(speechLang, (p) => ($('#s-heard').textContent = p), null, { local: onDeviceNow() }); }
      catch (e) { phoneFailed(e); if (!(await sttAvailable())) throw e; $('#s-heard').textContent = 'Using on-device Whisper · please say it once more'; }
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
  if (!heard) { $('#s-heard').textContent = 'Didn’t catch that. Tap Speak and try again.'; return; }
  takeStep(heard);
};
function takeStep(heard) {
  $('#s-heard').textContent = `"${heard}"`;
  const parsed = parseRules(heard);
  if (speechLang === 'auto' && parsed.lang && parsed.lang !== 'en') build.lang = parsed.lang; // keyboard voice: reply in the language spoken
  let steps = routeWords(heard) ? parsed.steps.filter((s) => s.kind === 'turn' || s.landmark) : [];
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

// ---------- The customer's voice note -> route ----------
// Customers already explain the way in a voice note (WhatsApp, the order chat). Pahunch takes that note as it is:
// shared from WhatsApp, opened as a file, or handed over by a partner app, and transcribes it on this phone
// (Whisper in Termux, no network). The words land in the box, editable, and the route is planned from them.
async function openVoiceNote(blob, { name = 'voice note', from = '', lang = '' } = {}) {
  if (!blob || !blob.size) return toast('That voice note is empty.');
  show('home');
  const url = URL.createObjectURL(blob);
  $('#vnote').hidden = false;
  $('#vnote-audio').src = url;
  $('#vnote-meta').textContent = from || name;
  const status = $('#mic-status');
  status.hidden = false;
  if (!(await sttAvailable())) {
    status.textContent = 'Voice notes are transcribed by the on-device speech engine: start it in Termux (bash tools/start.sh --bg). You can play the note and type what it says.';
    return;
  }
  const box = $('#thinking');
  box.hidden = false;
  $('#thinking-out').textContent = '';
  $('#thinking-status').textContent = 'Listening to the voice note on this phone…';
  try {
    const r = await transcribeNote(blob, { lang: lang || speechLang, onProgress: (k, n) => ($('#thinking-status').textContent = n > 1 ? `Transcribing the voice note on this phone · part ${k} of ${n}…` : 'Transcribing the voice note on this phone…') });
    box.hidden = true;
    if (!r.text) { status.textContent = 'No speech found in that voice note. Play it and type the directions.'; return; }
    $('#note').value = r.text;
    state.vnote = { segments: r.segments, text: r.text };
    state.altNote = null;
    state.spokenLang = null;
    state.lastVoice = { at: new Date().toLocaleTimeString(), chip: 'voice note', heard: r.text, english: '', ms: r.ms };
    $('#vnote-meta').textContent = `${from ? from + ' · ' : ''}${r.seconds} s · transcribed on this phone in ${(r.ms / 1000).toFixed(1)} s`;
    status.hidden = true;
    $('#parse').click();
  } catch (e) {
    box.hidden = true;
    status.textContent = `Couldn't read that voice note (${e.message}). Play it and type the directions.`;
  }
}
$('#vnote-in').onchange = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) openVoiceNote(f, { name: f.name }); };

// Shared into Pahunch from WhatsApp or any app (installed PWA share target, see sw.js): a voice note or text.
async function takeShared() {
  try {
    const c = await caches.open('pahunch-share');
    const audio = await c.match('shared-audio'), txt = await c.match('shared-text');
    await c.delete('shared-audio'); await c.delete('shared-text');
    if (audio) return openVoiceNote(await audio.blob(), { from: 'Shared voice note' });
    const t = txt ? (await txt.text()).trim() : '';
    if (t) { show('home'); $('#note').value = t; $('#parse').click(); }
  } catch {}
}

// "Guide me in": the rider's own language for the plan and the voice, whatever language the customer used.
try { const g = localStorage.getItem('pahunch.guideLang'); if (g) $('#voice').value = g; } catch {}
$('#voice').onchange = () => { try { localStorage.setItem('pahunch.guideLang', $('#voice').value); } catch {} };

// ---------- Door card: say this to the customer ----------
const askStep = () => (state.graph?.steps || []).at(-1);
function custLang() {
  const l = state.custLang || (state.order && (LANG_BASE[state.order.lang] || state.order.lang)) || state.parse?.rules?.lang || state.graph?.lang || 'en';
  return ASK[l] ? l : 'en';
}
function renderAsk() {
  const c = askCard(askStep(), custLang());
  $('#ask-note').textContent = `In ${c.name}, word for word. Names are kept as the customer said them.${c.checked ? ' Checked by a native speaker.' : ''}`;
  const mine = askCard(askStep(), ASK[state.lang] ? state.lang : 'en');
  $('#ask-lines').replaceChildren(...c.lines.map((l, k) => {
    const li = el('li', l.key === state.lastQ ? 'on' : ''), say1 = el('div', 'say');
    say1.append(el('div', 'nat', l.native));
    if (l.roman !== l.native) say1.append(el('div', 'rom', l.roman));
    // what it means, in the rider's own language
    if (mine.lang !== c.lang && mine.lines[k]) say1.append(el('div', 'rom', `= ${mine.lines[k].native}`));
    const b = el('button', 'btn ghost spk', 'Speak');
    b.onclick = () => { state.lastQ = l.key; speakAloud(l.native, c.lang); renderAsk(); };
    li.onclick = (e) => { if (e.target === li || e.target.closest('.say')) { state.lastQ = l.key; renderAsk(); } };
    li.append(say1, b);
    if (state.order) {
      const send = el('button', 'btn primary send', 'Send');
      send.onclick = () => sendQuestion(l);
      li.append(send);
    }
    return li;
  }));
  const words = (list) => list.map(([n, r]) => (r && r !== n ? `${n} (${r})` : n)).join(' · ');
  // Tap what you heard: yes / no / a number.
  const chip = (label, cls, fn) => { const b = el('button', `chip-a ${cls}`, label); b.onclick = fn; return b; };
  $('#ask-yes').replaceChildren(...c.yes.map(([n, r]) => chip(r && r !== n ? `${n} (${r})` : n, 'yes', () => onAnswer('yes'))));
  $('#ask-no').replaceChildren(...c.no.map(([n, r]) => chip(r && r !== n ? `${n} (${r})` : n, 'no', () => onAnswer('no'))));
  $('#ask-nums').replaceChildren(...c.nums.map(([e, n, r], i) => chip(c.lang === 'en' ? e : `${i + 1} · ${e} / ${n}`, '', () => onAnswer('number', i + 1))));
  void words;
}
function openAsk() {
  unlockSpeech();
  $('#ask-lang').replaceChildren(...Object.entries(ASK).map(([k, v]) => { const o = el('option', null, v.name); o.value = k; return o; }));
  $('#ask-lang').value = custLang();
  renderAsk();
  $('#asheet').hidden = false;
}
$('#ask-lang').onchange = () => { state.custLang = $('#ask-lang').value; renderAsk(); };
$('#ask-open').onclick = openAsk;
$('#arrive-ask').onclick = openAsk;
$('#ask-close').onclick = () => ($('#asheet').hidden = true);
// Where a chat channel exists (the partner app's chat, or WhatsApp when numbers are shared): photo + question.
$('#ask-photo').onclick = async () => {
  const c = askCard(askStep(), custLang());
  const textMsg = c.lines.filter((l) => l.key === 'lead' || l.key === 'gate').map((l) => l.native).join(' ');
  const photo = state.card?.photo || doorPhoto();
  try {
    if (photo && navigator.canShare) {
      const blob = await (await fetch(photo)).blob();
      const file = new File([blob], 'door.jpg', { type: 'image/jpeg' });
      if (navigator.canShare({ files: [file] })) return await navigator.share({ files: [file], text: textMsg });
    }
    if (navigator.share) return await navigator.share({ text: textMsg });
    await navigator.clipboard.writeText(textMsg);
    toast('Question copied: paste it in the chat with the customer.');
  } catch (e) { if (e.name !== 'AbortError') toast(`Couldn't share: ${e.message}`); }
};

// ---------- Orders from the Instakart demo shop (same phone, tools/serve.py) ----------
// A customer orders on instakart.html and records voice directions in her language. The order arrives here; the
// rider accepts it and the voice note becomes the route in the rider's language.
const LANG_BASE = { tanglish: 'ta', hinglish: 'hi' };
const LANG_NAME = { ta: 'Tamil', hi: 'Hindi', kn: 'Kannada', ml: 'Malayalam', bn: 'Bengali', en: 'English', tanglish: 'Tamil + English', hinglish: 'Hindi + English' };
const postOrder = (id, kind, body) => fetch(`api/orders/${id}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => null);
const seenOrders = new Set();
async function pollOrders() {
  if ($('#home').hidden) return;
  let list;
  try { list = await (await fetch('api/orders', { cache: 'no-store' })).json(); } catch { return; }
  if (!Array.isArray(list)) return;
  const open = list.filter((o) => o.status === 'placed' && o.id !== state.order?.id);
  $('#orders').hidden = !open.length;
  $('#orders-list').replaceChildren(...open.slice(0, 3).map((o) => {
    const li = el('li'), d = el('div');
    const nItems = (o.items || []).reduce((a, i) => a + i.q, 0);
    d.append(el('strong', null, `${o.customer} · ${nItems} item${nItems === 1 ? '' : 's'} · ₹${o.total}`),
      el('span', 'meta', `Instakart #${o.id} · ${o.address} · voice directions in ${LANG_NAME[o.lang] || o.lang}`));
    const b = el('button', 'btn primary', 'Accept');
    b.onclick = () => acceptOrder(o);
    li.append(d, b);
    return li;
  }));
  if (open.some((o) => !seenOrders.has(o.id))) { buzz('ask'); open.forEach((o) => seenOrders.add(o.id)); }
}
setInterval(pollOrders, 2500);
async function acceptOrder(o) {
  state.order = o;
  state.custLang = LANG_BASE[o.lang] || o.lang;
  $('#orders').hidden = true;
  postOrder(o.id, 'status', { status: 'accepted' });
  showJob({ src: 'Instakart', id: o.id, who: `${o.customer} · ${o.address}` });
  if (o.note) return useOrderWords(o);
  if (!o.audio) return toast('This order has no voice directions.');
  try { openVoiceNote(await (await fetch(o.audio)).blob(), { from: `Instakart #${o.id} · ${LANG_NAME[o.lang] || o.lang}`, lang: o.lang }); }
  catch (e) { toast(`Couldn't load the voice note: ${e.message}`); }
}

// The order carries the customer's own words (recognised on her phone while she spoke, and checked by her).
// They are used as they are: the route is built from them on this phone, in the rider's language. Her voice note
// stays playable, and each step plays the matching part of it (timed by position, as there are no word timings).
async function useOrderWords(o) {
  show('home');
  $('#note').value = o.note;
  state.altNote = null;
  state.spokenLang = null;
  state.vnote = null;
  $('#vnote').hidden = !o.audio;
  $('#vnote-meta').textContent = `Instakart #${o.id} · words checked by the customer`;
  if (o.audio) {
    $('#vnote-audio').src = o.audio;
    try {
      const buf = await (await fetch(o.audio)).arrayBuffer();
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext, ctx = new AC();
      const dur = (await ctx.decodeAudioData(buf)).duration;
      ctx.close?.();
      if (dur > 0) state.vnote = { segments: [{ start: 0, end: dur, text: o.note }], text: o.note };
    } catch {}
  }
  state.lastVoice = { at: new Date().toLocaleTimeString(), chip: 'order words', heard: o.note, english: '', ms: 0 };
  $('#parse').click();
}

// The rider's question goes to the customer's order screen, in her language; her one-tap answer comes back.
async function sendQuestion(l) {
  state.lastQ = l.key;
  const expects = l.key === 'gate' ? 'yesno' : l.key === 'more' || l.key === 'floor' ? 'number' : 'ok';
  const o = await postOrder(state.order.id, 'messages', { from: 'rider', key: l.key, native: l.native, roman: l.roman, expects });
  const q = o?.messages?.at(-1);
  renderAsk();
  if (!q) return toast("Couldn't send the question.");
  $('#ask-reply').hidden = false;
  $('#ask-reply').textContent = 'Sent. Waiting for the customer…';
  clearInterval(state.replyTimer);
  state.replyTimer = setInterval(async () => {
    let list;
    try { list = await (await fetch('api/orders', { cache: 'no-store' })).json(); } catch { return; }
    const a = list.find((x) => x.id === state.order?.id)?.messages?.find((m) => m.from === 'customer' && m.re === q.at);
    if (!a) return;
    clearInterval(state.replyTimer);
    const meaning = a.answer === 'yes' ? 'yes' : a.answer === 'no' ? 'no' : a.answer;
    $('#ask-reply').textContent = `Customer answered: ${a.label} (${meaning})`;
    buzz('spotted');
    if (a.answer === 'yes' || a.answer === 'no') onAnswer(a.answer);
    else if (a.answer !== 'ok') onAnswer('number', +a.answer);
  }, 1500);
}

// What the customer said, heard on the call (tapped) or answered in the shop app.
function onAnswer(kind, n) {
  if (kind === 'yes') { if (state.lastQ === 'floor') return; $('#asheet').hidden = true; return finishDelivery(); }
  if (kind === 'no') {
    // Not this gate: ask how many more, then guide on.
    state.lastQ = 'more';
    renderAsk();
    toast('Not this gate. Ask: how many more gates?');
    return;
  }
  if (kind === 'number' && state.lastQ === 'floor') { if (state.card) { state.card.floor = n; saveCard(state.card); renderCard(); } toast(`Floor ${n}`); return; }
  if (kind === 'number') {
    // "2 more gates": a new last step, confirmed by the rider, then ask again.
    const g = state.graph, last = g.steps.at(-1);
    last.kind = 'pass';
    const next = { kind: 'arrive', landmark: { type: 'other', name: `the gate ${n} further on`, colour: null }, ref: null,
      say: { en: `the gate ${n} further on`, hi: `${n} गेट और आगे`, ta: `இன்னும் ${n} கேட் தள்ளி`, kn: `ಇನ್ನೂ ${n} ಗೇಟ್ ಮುಂದೆ`, ml: `ഇനിയും ${n} ഗേറ്റ് മുന്നോട്ട്`, bn: `আরও ${n}টা গেট পরে` } };
    g.steps.push(next);
    g.steps.forEach((st, i) => { st.n = i + 1; st.verify = verifyFor(st); });
    next.verify = { signs: [], alt: [], colour: null, objects: [], compass: null, confidence: 'low' }; // you confirm
    $('#asheet').hidden = true;
    show('guide');
    startGuide(g.steps.length - 1);
  }
}

function finishDelivery() {
  if (state.order) postOrder(state.order.id, 'status', { status: 'delivered' });
  const h = state.how || [], n = (k) => h.filter((x) => x === k).length;
  const part = (c, w) => (c ? `${c} ${c > 1 ? 'steps' : 'step'} ${w}` : '');
  show('arrive');
  $('#arrive-title').textContent = 'Delivered';
  $('#arrive-sub').hidden = true;
  $('#arrive-ask').hidden = $('#arrive-yes').hidden = true;
  $('#tick').hidden = false;
  $('#done-summary').hidden = false;
  $('#done-summary').textContent = [part(n('sign'), 'checked by a sign'), part(n('cue'), 'by cues'), part(n('rider'), 'confirmed by you')].filter(Boolean).join(', ') + '.';
  $('#again').textContent = state.order ? 'Back to orders' : 'New route';
  state.order = null;
  $('#job').hidden = true;
}
$('#arrive-yes').onclick = () => finishDelivery();
$('#her-voice').onclick = () => {
  const s = state.graph?.steps[state.i];
  const clip = s && state.vnote?.segments?.length ? clipAt(state.vnote.segments, s.at ?? state.i / state.graph.steps.length) : null;
  if (clip) playClip(clip, $('#her-voice'));
};

// ---------- Developer mode: tap the logo 5 times (or open with ?dev) ----------
// Sensor readouts, the field-test panel, voice log and engine switch stay out of the rider's way.
function setDev(on) { document.body.classList.toggle('dev', on); try { localStorage.setItem('pahunch.dev', on ? '1' : ''); } catch {} }
try { setDev(/[?&]dev\b/.test(location.search) || localStorage.getItem('pahunch.dev') === '1'); } catch {}
let devTaps = [];
document.querySelectorAll('.topbar .mark').forEach((m) => m.addEventListener('click', () => {
  const now = Date.now();
  devTaps = [...devTaps.filter((t) => now - t < 3000), now];
  if (devTaps.length < 5) return;
  devTaps = [];
  const on = !document.body.classList.contains('dev');
  setDev(on);
  toast(on ? 'Developer mode on' : 'Developer mode off');
}));

// ---------- A job handed over by a partner app ----------
function showJob({ src, id, who } = {}) {
  $('#job').hidden = !(who || id);
  $('#job-src').textContent = src || 'Partner app';
  $('#job-id').textContent = id ? `#${id}` : '';
  $('#job-who').textContent = who || '';
}

// ---------- Offline voice: Chrome's own on-device speech recognition, where this Chrome offers it ----------
// Chrome can download speech models per language and recognise on the phone (no network). Shown only when this
// Chrome supports it; otherwise offline voice uses Whisper on the phone.
const PACK_LANGS = [['en-IN', 'English'], ['hi-IN', 'हिन्दी'], ['ta-IN', 'தமிழ்'], ['kn-IN', 'ಕನ್ನಡ'], ['ml-IN', 'മലയാളം']];
async function showVoicePacks() {
  const line = $('#voice-pack');
  const st = await Promise.all(PACK_LANGS.map(([l]) => localSpeechStatus(l)));
  PACK_LANGS.forEach(([l], i) => (st[i] === 'available' ? localReady.add(l) : localReady.delete(l)));
  // Nothing on-device here (or nothing to download): offline voice is Whisper, so don't show a row of dashes.
  if (!st.some((x) => ['available', 'downloadable', 'downloading'].includes(x))) { line.hidden = true; return; }
  line.hidden = false;
  line.replaceChildren(document.createTextNode('Offline voice: '));
  PACK_LANGS.forEach(([l, name], i) => {
    const ok = st[i] === 'available';
    const b = el('b', null, `${name} ${ok ? '✓' : st[i] === 'downloadable' ? '↓' : '–'}`);
    if (st[i] === 'downloadable') {
      b.style.cursor = 'pointer';
      b.onclick = async () => {
        if (!navigator.onLine) return toast('Connect once to download this language for offline voice.');
        toast(`Downloading ${name} for offline voice…`);
        toast((await installLocalSpeech(l)) ? `${name} ready offline.` : `${name} could not be downloaded.`);
        showVoicePacks();
      };
    }
    line.append(b, document.createTextNode(i < PACK_LANGS.length - 1 ? ' · ' : ''));
  });
}

// ---------- Splash: warm up models, then continue ----------
// ?lite: skip loading the AI models (design preview on a weak laptop).
const LITE = location.search.includes('lite');

async function boot() {
  const mark = (k, ok, note) => { const li = document.querySelector(`#boot [data-k="${k}"]`); li.classList.add(ok ? 'ok' : 'skip'); if (note) li.insertAdjacentHTML('beforeend', `<em>${note}</em>`); };
  const t0 = performance.now();
  const jobs = LITE ? ['camera', 'ocr', 'llm', 'sensors'].map((k) => Promise.resolve(mark(k, true, 'preview'))) : [
    Promise.all([detector.load(), scene.load().catch(() => null)]).then(() => mark('camera', true, `objects + places · ${detector.delegate}`), () => mark('camera', false, 'unavailable')),
    new Promise((r) => (window.Tesseract ? r() : addEventListener('load', r, { once: true }))).then(() => vision.loadOcr('eng')).then(() => mark('ocr', true, 'Tesseract · English, Indian scripts on demand'), () => mark('ocr', false, 'failed')),
    warmNative().then(async (name) => { state.llmDevice = name ? await llmDevice() : null; mark('llm', !!name, name ? `${name} · ${state.llmDevice}` : 'rules only (start.sh)'); }),
    new Promise((r) => setTimeout(r, 900)).then(() => mark('sensors', !!(sensors.gyro || compass.heading != null || sensors.pos), sensors.gyro ? 'gyro ✓ compass ✓' : 'limited')),
  ];
  await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, 2500))]);
  await new Promise((r) => setTimeout(r, Math.max(0, 1600 - (performance.now() - t0))));
  let saved = null;
  try { saved = localStorage.getItem('pahunch.mode'); } catch {}
  const link = new URLSearchParams(location.hash.slice(1));
  if (location.hash === '#shared') {
    setMode(saved || 'delivery');
    show('home');
    takeShared();
  } else if (link.get('audio') === 'partner') {
    // A partner app handed over the order with the customer's voice note (demo: stored by partner.html).
    setMode(link.get('mode') || saved || 'delivery');
    showJob({ src: link.get('src'), id: link.get('job'), who: link.get('who') });
    show('home');
    let blob = null;
    try { const d = localStorage.getItem('pahunch.partner.audio'); if (d) blob = await (await fetch(d)).blob(); } catch {}
    if (blob) openVoiceNote(blob, { from: 'From the order' });
    else if (link.get('go')) { $('#note').value = link.get('go'); setTimeout(() => $('#parse').click(), 300); }
  } else if (link.get('go')) {
    // Opened from a partner app (delivery / 108 dispatch): load its directions and plan straight away.
    setMode(link.get('mode') || saved || 'delivery');
    $('#note').value = link.get('go');
    showJob({ src: link.get('src'), id: link.get('job'), who: link.get('who') });
    show('home');
    setTimeout(() => $('#parse').click(), 300);
  } else {
    setMode(saved || 'delivery');
    show(saved ? 'home' : 'roles');
  }
  showVoicePacks();
  window.__booted = true;
  $('#splash').classList.add('out');
  setTimeout(() => ($('#splash').hidden = true), 450);
}

if ('serviceWorker' in navigator && !location.search.includes('nosw')) navigator.serviceWorker.register('sw.js').catch(() => {});
for (const s of screens) $(`#${s}`).hidden = true;
boot();
