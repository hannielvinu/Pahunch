import { SAMPLES, describe } from './parser.js';
import { parseNote, warmNative } from './llm.js';
import { Vision, matchSigns } from './vision.js';
import { Overlay } from './overlay.js';
import { startNetMeter, formatBytes } from './netmeter.js';
import { say, text, buzz, Compass, unlockSpeech } from './guide.js';
import { Detector } from './detector.js';
import { Sensors, GyroTurn } from './sensors.js';
import { dictate, CommandListener, voiceAvailable } from './voice.js';
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
const sensors = new Sensors();
sensors.start();
const MODES = {
  delivery: { badge: '🛵 Delivery', title: 'Where to?', sub: 'Speak or paste the directions exactly as the customer gave them.' },
  ambulance: { badge: '🚑 Ambulance', title: 'Emergency call', sub: 'Type or speak what the caller said. Pahunch guides without stopping to ask.' },
  ride: { badge: '🚖 Pickup', title: 'Find your passenger', sub: 'Paste where they said they are waiting: "opposite the bus stop, blue shirt".' },
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
$('#start').onclick = () => { unlockSpeech(); startGuide(); };

// ---------- Guide ----------
const step = () => state.graph.steps[state.i];
const T = () => text(state.lang);

function spokenName(lm) {
  if (!lm) return T().dest;
  const type = { pharmacy: 'pharmacy', temple: 'temple', store: 'store', sign: 'sign', desk: 'desk' }[lm.type] || lm.type.replace('_', ' ');
  return [lm.colour, lm.name, lm.name && (lm.type === 'sign' || lm.type === 'gate') ? '' : type].filter(Boolean).join(' ');
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
  const lead = prefix ? `${prefix} ${T().now} ` : ambulance() && s.n === 1 ? 'Emergency route. ' : '';
  if (s.kind === 'turn') {
    say(lead + T().turn(s.ordinal, T()[s.turn]), state.lang);
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

// Object detection on the live camera (MediaPipe), throttled so OCR keeps its share of the phone.
function detectLoop() {
  if (!state.running) return;
  const t0 = performance.now();
  try {
    const dets = detector.detect();
    overlay.setDetections(dets);
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
  if (!vision.worker) {
    $('#ocr-ms').textContent = 'loading OCR…';
    try { await vision.loadOcr('eng'); } catch (e) { toast(`OCR failed: ${e.message}`); }
  }
  state.running = true;
  overlay.start();
  announce();
  ocrLoop();
  tick();
  if (!detector.ready) detector.load().then(detectLoop).catch((e) => ($('#det-ms').textContent = `vision off: ${e.message}`));
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
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

startNetMeter(({ requests, bytes }) => {
  const chip = $('#net');
  chip.classList.toggle('off', requests > 0);
  chip.textContent = requests ? `⚠ ${requests} off-device request${requests > 1 ? 's' : ''} · ${formatBytes(bytes)}` : 'On-device · 0 B sent';
});
deviceReport().then((r) => { state.device = r; $('#device').textContent = describeDevice(r); });
renderDoors();

// ---------- Hands-free answers ----------
const listener = new CommandListener((cmd) => {
  if (cmd === 'yes' && state.asking) $('#yes').click();
  else if (cmd === 'no' && state.asking) $('#notyet').click();
  else if (cmd === 'skip') $('#skip').click();
  else if (cmd === 'repeat' && say.last) say(say.last.line, say.last.lang);
  else if (cmd === 'stop') $('#stop').click();
}, (heard) => toast(`🎤 "${heard}"`));
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
  if (btn.classList.contains('live')) { dictate.stop?.(); return; }
  const lang = $('#voice').value === 'auto' ? 'en' : $('#voice').value;
  btn.classList.add('live');
  status.hidden = false;
  status.textContent = 'Listening… speak the directions';
  try {
    const textOut = await dictate(lang, (p) => { $('#note').value = p; });
    if (textOut) { $('#note').value = textOut; status.textContent = '✓ Got it. Tap Plan route.'; } else status.textContent = 'Didn’t catch that. Try again.';
  } catch (e) { status.textContent = `Voice: ${e.message}. Type or paste instead.`; }
  btn.classList.remove('live');
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

// ---------- Live sensors panel ----------
setInterval(() => {
  if ($('#home').hidden || !$('#sensors-panel').open) return;
  $('#sensors').textContent = sensors.report({ heading: compass.heading, brightness: state.brightness });
}, 400);

// ---------- Splash: warm up models, then continue ----------
async function boot() {
  const mark = (k, ok, note) => { const li = document.querySelector(`#boot [data-k="${k}"]`); li.classList.add(ok ? 'ok' : 'skip'); if (note) li.insertAdjacentHTML('beforeend', `<em>${note}</em>`); };
  const t0 = performance.now();
  const jobs = [
    detector.load().then(() => mark('camera', true, `EfficientDet · ${detector.delegate}`), () => mark('camera', false, 'unavailable')),
    new Promise((r) => (window.Tesseract ? r() : addEventListener('load', r, { once: true }))).then(() => vision.loadOcr('eng')).then(() => mark('ocr', true, 'Tesseract · 4 languages'), () => mark('ocr', false, 'failed')),
    warmNative().then((up) => mark('llm', up, up ? 'Qwen2.5 · llama.cpp' : 'rules only (start.sh)')),
    new Promise((r) => setTimeout(r, 900)).then(() => mark('sensors', !!(sensors.gyro || compass.heading != null || sensors.pos), sensors.gyro ? 'gyro ✓ compass ✓' : 'limited')),
  ];
  await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, 9000))]);
  await new Promise((r) => setTimeout(r, Math.max(0, 1600 - (performance.now() - t0))));
  let saved = null;
  try { saved = localStorage.getItem('pahunch.mode'); } catch {}
  setMode(saved || 'delivery');
  show(saved ? 'home' : 'roles');
  $('#splash').classList.add('out');
  setTimeout(() => ($('#splash').hidden = true), 450);
}

if ('serviceWorker' in navigator && !location.search.includes('nosw')) navigator.serviceWorker.register('sw.js').catch(() => {});
for (const s of screens) $(`#${s}`).hidden = true;
boot();
