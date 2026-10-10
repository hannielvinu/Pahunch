// Rule parser: code-mixed Indian landmark directions -> step graph.
// Always available; the on-device LLM parser (later) falls back to this.
//
// Step graph:
// { floor, lang, parser:'rules', steps:[{ n, kind:'pass'|'turn'|'arrive', landmark?, turn?, ordinal?, road?,
//   ref?:{relation, landmark}, verify:{ signs, alt, colour, compass, confidence } }] }

const W = (s) => s.split(/\s+/).filter(Boolean);
const set = (...lists) => new Set(lists.flatMap(W));

const LEFT = set('left baayen baayein bayen baaye baye baen baayan baya baayi edakke edakkey edagade edakke idathu idadhu idadu idathu', 'बाएं बायें बाएँ बाये ಎಡಕ್ಕೆ ಎಡಗಡೆ இடது இடதுபுறம்');
const RIGHT = set('right daayen daayein dayen daaye daye daen daahine dahine balakke balakkey balagade valathu valadhu valadu', 'दाएं दायें दाएँ दाये ಬಲಕ್ಕೆ ಬಲಗಡೆ வலது வலதுபுறம்');
const STRAIGHT = set('straight seedha seedhe sidha sidhe nera nere neraga', 'सीधा सीधे ನೇರ நேரா');
const PASS = set('past after baad datti dati daati thandi thaandi tandi paar crossing', 'बाद पार ದಾಟಿ தாண்டி');
const ROAD = { lane: 'lane', gali: 'lane', galli: 'lane', गली: 'lane', cross: 'cross', road: 'road', rasta: 'road', raasta: 'road', street: 'street', theru: 'street', therு: 'street', தெரு: 'street', beedi: 'street', ರಸ್ತೆ: 'road', turn: 'turn', mod: 'turn', main: 'main' };
const ORD = {
  1: set('first 1st pehli pehla pehle pahli modala modalane modalne mudhal mudal mudalavathu', 'पहली पहला ಮೊದಲ ಮೊದಲನೇ முதல்'),
  2: set('second 2nd doosri doosra dusri dusra doosre eradane erdane eradu rendavathu randavathu irandavathu', 'दूसरी दूसरा ಎರಡನೇ இரண்டாவது'),
  3: set('third 3rd teesri teesra tisri mooraneya muraneya moonavathu munavathu', 'तीसरी तीसरा ಮೂರನೇ மூன்றாவது'),
  4: set('fourth 4th chauthi chautha nalkaneya naalavathu', 'चौथी चौथा ನಾಲ್ಕನೇ நான்காவது'),
};
const FLOOR = set('floor manzil manjil maala mala majale mahadi maadi', 'मंजिल मंज़िल माला ಮಹಡಿ மாடி');
const GROUND = set('ground neeche');
// Relations. Prepositions take the target before them ("gate opposite MedPlus");
// postpositions take it after ("MedPlus ke saamne gate").
const REL_PRE = { opposite: 'opposite', facing: 'opposite', front: 'opposite', next: 'next_to', beside: 'next_to', besides: 'next_to', near: 'near', behind: 'behind' };
const REL_POST = { saamne: 'opposite', samne: 'opposite', saamane: 'opposite', samane: 'opposite', सामने: 'opposite', edurige: 'opposite', eduru: 'opposite', ಎದುರು: 'opposite', ಎದುರಿಗೆ: 'opposite', ethire: 'opposite', ethirey: 'opposite', ethir: 'opposite', எதிரே: 'opposite', எதிர்: 'opposite', bagal: 'next_to', baazu: 'next_to', paas: 'near', पास: 'near', बगल: 'next_to', pakka: 'next_to', pakkada: 'next_to', ಪಕ್ಕ: 'next_to', pakkathula: 'next_to', pakkam: 'next_to', பக்கத்தில்: 'next_to', peeche: 'behind', hinde: 'behind', pinnadi: 'behind' };

const COLOUR = {
  blue: 'blue neela neeli neele neel nila neelam neeli', red: 'red laal lal kempu sivappu sigappu', green: 'green hara hari hare hasiru pachai pacha',
  yellow: 'yellow peela peeli pila haladi manjal', white: 'white safed safedh bili bilee vellai', black: 'black kaala kala kaali kappu karuppu',
  orange: 'orange narangi kesari', pink: 'pink gulabi', brown: 'brown bhura kandu', grey: 'grey gray',
};
export const COLOUR_OF = {};
for (const [c, words] of Object.entries(COLOUR)) for (const w of W(words)) COLOUR_OF[w] = c;
Object.assign(COLOUR_OF, { नीला: 'blue', नीले: 'blue', लाल: 'red', हरा: 'green', पीला: 'yellow', सफेद: 'white', काला: 'black', ನೀಲಿ: 'blue', ಕೆಂಪು: 'red', ಹಸಿರು: 'green', நீல: 'blue', சிவப்பு: 'red', பச்சை: 'green' });

// Landmark type -> words that name it in speech, and words likely painted on its signboard.
export const LANDMARKS = {
  temple: ['temple mandir mandira devasthana devasthanam devastana gudi kovil koil मंदिर ದೇವಸ್ಥಾನ ಗುಡಿ கோவில்', 'TEMPLE MANDIR DEVASTHANA KOVIL'],
  mosque: ['masjid mosque', 'MASJID MOSQUE'],
  church: ['church', 'CHURCH'],
  pharmacy: ['pharmacy medical medicals chemist dawakhana', 'PHARMACY MEDICAL MEDICALS CHEMIST'],
  hospital: ['hospital clinic aspatal aspatre', 'HOSPITAL CLINIC'],
  school: ['school', 'SCHOOL'], college: ['college', 'COLLEGE'],
  bank: ['bank', 'BANK'], atm: ['atm', 'ATM'],
  petrol: ['petrol pump bunk', 'PETROL BUNK PUMP FUEL'],
  store: ['store stores shop dukaan dukan angadi kadai mart supermarket kirana', 'STORES STORE SHOP MART'],
  bakery: ['bakery bakers', 'BAKERY BAKERS'],
  restaurant: ['hotel restaurant darshini bhavan cafe dhaba', 'HOTEL RESTAURANT DARSHINI BHAVAN CAFE'],
  park: ['park maidan', 'PARK'],
  bus_stop: ['bus stop busstop', 'BUS STOP'],
  apartment: ['apartment apartments flats residency enclave society building', 'APARTMENT APARTMENTS RESIDENCY ENCLAVE'],
  gate: ['gate darwaza darwaja gaate gatey', ''],
  door: ['door', ''],
  house: ['house ghar mane veedu', ''],
  // Generic signage, useful indoors (venue, malls, offices).
  sign: ['sign board signboard banner poster text written likha', ''],
  desk: ['desk counter booth stall', ''],
  stage: ['stage', 'STAGE'], exit: ['exit', 'EXIT'], entrance: ['entrance entry', 'ENTRANCE ENTRY'],
  lift: ['lift elevator', 'LIFT'], stairs: ['stairs staircase steps', 'STAIRS'],
  tree: ['tree ped mara maram', ''],
};
export const TYPE_OF = {};
for (const [t, [spoken]] of Object.entries(LANDMARKS)) for (const w of W(spoken)) TYPE_OF[w] = t;
export const BRANDS = { medplus: ['pharmacy', 'MedPlus'], apollo: ['pharmacy', 'Apollo'], dmart: ['store', 'DMart'], reliance: ['store', 'Reliance'], bigbazaar: ['store', 'Big Bazaar'], iqoo: ['sign', 'iQOO'], vivo: ['sign', 'vivo'], hp: ['petrol', 'HP'], kfc: ['restaurant', 'KFC'], dominos: ['restaurant', 'Dominos'] };

const WALA = set('wala wali wale waala waali waale with');
const HONORIFIC = set('sri shri shree sree');
const STOP = set('the a an of to at on in is it go come take then and from main ke ki ka se mein me mai pe par wala wali wale ko le alli inda la le ge ige ali na also near this that your my his her their there here only just road see look find dekho dekhiye dekh nodi paaru paarunga area place');
// Generic words that are never a landmark's proper name.
export const GENERIC = set('main road cross street lane gali area place side corner medical shop store building the');
const SPLIT = /[.,;!?\n।]+|\b(?:then|and then|after that|uske baad|iske baad|phir|fir|amele|aamele|aamel|appuram|apparam|apram|piragu|aprm)\b/i;

const LANG_HINTS = {
  hi: set('se ke ki ka mein baad aao mudo mudiye saamne doosri manzil gali seedha baayen daayen neela mandir wala'),
  kn: set('inda alli edakke balakke datti nera banni eradane amele edurige devasthana neeli mahadi'),
  ta: set('la nera vaanga thandi theru idathu valathu appuram ethire kovil rendavathu neela mudhal'),
};

function normalise(text) {
  return text.replace(/[’']/g, '').replace(/(\d)\s*(st|nd|rd|th)\b/gi, '$1$2').replace(/\s+/g, ' ').trim();
}

function tokens(clause) {
  return clause.split(/[\s"()\-/:]+/).filter(Boolean).map((raw) => ({ raw, w: raw.toLowerCase() }));
}

function detectLang(text) {
  if (/[ऀ-ॿ]/.test(text)) return 'hi';
  if (/[ಀ-೿]/.test(text)) return 'kn';
  if (/[஀-௿]/.test(text)) return 'ta';
  const words = W(text.toLowerCase());
  let best = 'en', score = 1;
  for (const [lang, hints] of Object.entries(LANG_HINTS)) {
    const s = words.filter((w) => hints.has(w)).length;
    if (s > score) { best = lang; score = s; }
  }
  return best;
}

// Words that are never part of a landmark's name: verbs and fillers in the four languages.
const VERBS = set(`walk walking go going come coming take turn turning see look find reach reached keep move pass cross head enter
  is are was its thats there will you your our we us they then before until till up down inside outside towards toward into onto
  ok okay so get got stand standing wait waiting stop stopped near nearby beside front back side way spot place point location
  hello hey please thanks thank bro sir madam bhaiya anna boss dear just also very big small new old first last
  lo le lena lijiye khade khada khadi milenge milega hoon hun aao aaiye aana jao jaiye jana chalo chaliye mudo mudiye mud ruko dekho hai hain ho hoga raha rahe wahan yahan udhar idhar aur bas
  banni baa hogi hogu nodi tirugi thirugi illi ide alli vaanga vanga ponga poi thirumbu thirumbunga paarunga irukku iruku inge ange`);

// Everyday objects the on-device vision model (COCO classes) can see, by the words people use for them.
export const OBJECTS = {
  person: 'person', people: 'person', man: 'person', woman: 'person', guard: 'person', security: 'person', volunteer: 'person',
  car: 'car', cab: 'car', taxi: 'car', bike: 'motorcycle', scooter: 'motorcycle', motorcycle: 'motorcycle', bicycle: 'bicycle', cycle: 'bicycle',
  bus: 'bus', truck: 'truck', chair: 'chair', chairs: 'chair', sofa: 'couch', couch: 'couch', table: 'dining table', tables: 'dining table',
  plant: 'potted plant', plants: 'potted plant', pot: 'potted plant', tv: 'tv', television: 'tv', screen: 'tv', monitor: 'tv', display: 'tv',
  laptop: 'laptop', laptops: 'laptop', computer: 'laptop', pc: 'laptop', keyboard: 'keyboard', mouse: 'mouse', phone: 'cell phone', mobile: 'cell phone',
  bottle: 'bottle', bottles: 'bottle', cup: 'cup', mug: 'cup', clock: 'clock', book: 'book', books: 'book', bag: 'backpack', backpack: 'backpack',
  umbrella: 'umbrella', bench: 'bench', fridge: 'refrigerator', refrigerator: 'refrigerator', microwave: 'microwave', oven: 'oven', sink: 'sink',
  toilet: 'toilet', bed: 'bed', vase: 'vase', dog: 'dog', cat: 'cat', signal: 'traffic light', hydrant: 'fire hydrant',
};

const isLexical = (w) => LEFT.has(w) || RIGHT.has(w) || STRAIGHT.has(w) || PASS.has(w) || w in ROAD || FLOOR.has(w) ||
  w in COLOUR_OF || w in TYPE_OF || w in REL_PRE || w in REL_POST || Object.values(ORD).some((s) => s.has(w));

// Words just before a landmark word that look like its proper name ("Sri Ganesha" Temple, "Registration" desk).
function nameBefore(toks, i) {
  const name = [];
  for (let j = i - 1; j >= 0 && name.length < 3; j--) {
    const { raw, w } = toks[j];
    if (HONORIFIC.has(w)) continue;
    if (STOP.has(w) || isLexical(w) || !/^[\p{L}\d&]+$/u.test(raw)) break;
    name.unshift(raw);
  }
  return name.join(' ') || null;
}

function findLandmarks(toks) {
  const found = [];
  for (let i = 0; i < toks.length; i++) {
    const { w } = toks[i];
    if (w in BRANDS) {
      const [type, name] = BRANDS[w];
      const next = toks[i + 1]?.w;
      const skip = next && TYPE_OF[next] === type ? 1 : 0; // "MedPlus pharmacy" is one landmark
      found.push({ i, end: i + skip, type, name });
      i += skip;
    } else if (w in TYPE_OF) {
      let type = TYPE_OF[w];
      if (w === 'bus' && toks[i + 1]?.w === 'stop') i++;
      else if (w === 'stop') continue;
      const prev = found.at(-1);
      if ((type === 'sign' || type === 'desk') && prev?.end === i - 1) {
        // "EXIT sign", "iQOO banner": the sign word belongs to the landmark before it.
        prev.end = i;
        prev.name ??= toks[i - 1].raw;
        continue;
      }
      if (prev && prev.end === i - 1 && !prev.name && prev.type !== type && !(toks[i - 1].w in BRANDS)) {
        // "Exit gate", "temple gate": one place, named by the first word.
        prev.name = toks[prev.i].raw;
        prev.type = type;
        prev.end = i;
        continue;
      }
      found.push({ i: found.length && TYPE_OF[toks[i - 1]?.w] === type ? found.pop().i : i, end: i, type, name: null });
    }
  }
  // "green gate wala ghar" = the house with the green gate: one place; the gate is what the camera can check.
  for (let k = found.length - 1; k > 0; k--) {
    const a = found[k - 1], b = found[k];
    const between = toks.slice(a.end + 1, b.i).map((t) => t.w);
    if (between.length && between.every((w) => WALA.has(w))) { a.end = b.end; found.splice(k, 1); }
  }
  for (const lm of found) if (!lm.name) lm.name = nameBefore(toks, lm.i);
  // Anything else that looks like a noun phrase is a landmark too ("the coffee machine", "Remote PC", "black chair"):
  // the camera checks it by reading its name or by seeing the object.
  const used = new Set();
  for (const lm of found) {
    for (let j = lm.i; j <= lm.end; j++) used.add(j);
    const nameWords = new Set((lm.name || '').toLowerCase().split(/\s+/));
    for (let j = lm.i - 1; j >= Math.max(0, lm.i - 4); j--) if (nameWords.has(toks[j].w) || HONORIFIC.has(toks[j].w)) used.add(j);
  }
  const hint = (w) => Object.values(LANG_HINTS).some((s) => s.has(w));
  const content = (j) => !used.has(j) && /^\p{L}{3,}$/u.test(toks[j].raw) && !STOP.has(toks[j].w) && !isLexical(toks[j].w) &&
    !VERBS.has(toks[j].w) && !HONORIFIC.has(toks[j].w) && !WALA.has(toks[j].w) && !hint(toks[j].w);
  for (let j = 0; j < toks.length; j++) {
    if (!content(j)) continue;
    let e = j;
    while (e + 1 < toks.length && content(e + 1)) e++;
    const s = Math.max(j, e - 2); // at most three words
    found.push({ i: s, end: e, type: 'other', name: toks.slice(s, e + 1).map((x) => x.raw).join(' ') });
    j = e;
  }
  found.sort((a, b) => a.i - b.i);
  for (const lm of found) {
    for (let j = lm.i - 1; j >= Math.max(0, lm.i - 4); j--) {
      if (toks[j].w in COLOUR_OF) { lm.colour = COLOUR_OF[toks[j].w]; break; }
      if (found.some((o) => o !== lm && o.end === j)) break;
    }
    lm.colour ??= null;
  }
  return found;
}

const landmarkOut = (lm) => ({ type: lm.type, name: lm.name, colour: lm.colour });

function analyse(clause) {
  const toks = tokens(clause);
  const at = (pred) => toks.findIndex((t) => pred(t.w));
  const r = { toks, landmarks: findLandmarks(toks) };
  const li = at((w) => LEFT.has(w)), ri = at((w) => RIGHT.has(w));
  r.turn = li >= 0 && (ri < 0 || li < ri) ? 'left' : ri >= 0 ? 'right' : null;
  r.straight = at((w) => STRAIGHT.has(w)) >= 0;
  r.passAt = at((w) => PASS.has(w));
  const fi = at((w) => FLOOR.has(w));
  if (fi >= 0) {
    const near = toks.slice(Math.max(0, fi - 2), fi + 3).map((t) => t.w);
    if (near.some((w) => GROUND.has(w))) r.floor = 0;
    else for (const [n, s] of Object.entries(ORD)) if (near.some((w) => s.has(w))) r.floor = +n;
    const digit = near.join(' ').match(/\b(\d+)(?:st|nd|rd|th)?\b/);
    if (r.floor === undefined && digit) r.floor = +digit[1];
  }
  for (const [n, s] of Object.entries(ORD)) {
    const oi = at((w) => s.has(w));
    if (oi >= 0 && !(fi >= 0 && Math.abs(oi - fi) <= 2)) { r.ordinal = +n; break; }
  }
  r.road = toks.map((t) => ROAD[t.w]).find((x) => x && x !== 'turn' && x !== 'main') || null;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i].w;
    if (w in REL_PRE) { r.rel = { relation: REL_PRE[w], at: i, post: false }; break; }
    if (w in REL_POST) { r.rel = { relation: REL_POST[w], at: i, post: true }; break; }
  }
  // "2nd cross" is a road, not a landmark called "2nd".
  r.landmarks = r.landmarks.filter((lm) => !(lm.type === 'gate' && r.turn && !r.rel));
  return r;
}

// Does the note mention any relation word (opposite, saamne, bagal…)?
export function mentionsRelation(note) {
  return tokens(normalise(note)).some((t) => t.w in REL_PRE || t.w in REL_POST);
}

export function verifyFor(step) {
  const lm = step.landmark;
  if (step.kind === 'turn') return { signs: [], alt: [], colour: null, objects: [], compass: step.turn, confidence: 'medium' };
  const target = lm?.name ? lm : step.ref?.landmark?.name ? step.ref.landmark : lm;
  const signs = target?.name ? W(target.name.toUpperCase().replace(/[^\p{L}\d ]/gu, ' ')).filter((w) => w.length >= 3) : [];
  const alt = target ? W(LANDMARKS[target.type]?.[1] || '') : [];
  const colour = lm?.colour || null;
  const words = [...W((lm?.name || '').toLowerCase()), lm?.type === 'desk' ? 'table' : ''];
  const objects = [...new Set(words.map((w) => OBJECTS[w]).filter(Boolean))];
  const confidence = signs.length || objects.length ? 'high' : alt.length || colour ? 'medium' : 'low';
  return { signs, alt, colour, objects, compass: null, confidence };
}

export function parseRules(input) {
  const text = normalise(input);
  const graph = { floor: null, lang: detectLang(text), parser: 'rules', steps: [] };
  const push = (s) => graph.steps.push(s);

  for (const clause of text.split(SPLIT).filter((c) => c && c.trim())) {
    const a = analyse(clause);
    if (a.floor !== undefined) graph.floor = a.floor;
    const lms = a.landmarks;

    if (a.turn) {
      // "Ganesh mandir ke baad doosri gali mein baayen" -> pass the temple, then turn.
      const turnAt = a.toks.findIndex((t) => LEFT.has(t.w) || RIGHT.has(t.w));
      const atWord = (lm) => ['at', 'near', 'from', 'after', 'by', 'beside'].includes(a.toks[lm.i - 1]?.w) || ['at', 'near', 'by'].includes(a.toks[lm.i - 2]?.w);
      const before = lms.filter((lm) => lm.i < turnAt || atWord(lm) || (a.passAt >= 0 && a.passAt > turnAt && lm.i < a.passAt));
      for (const lm of before) push({ kind: 'pass', landmark: landmarkOut(lm) });
      push({ kind: 'turn', turn: a.turn, ordinal: a.ordinal || 1, road: a.road });
      // "turn right, see the Remote PC text": landmarks after the turn come after it.
      for (const lm of lms) if (!before.includes(lm)) push({ kind: 'pass', landmark: landmarkOut(lm) });
      continue;
    }
    if (!lms.length) continue; // "go straight from the main road", floor-only clauses, filler

    // ", SBI bank ke bagal mein": a relation-only clause describes the place just named.
    const prev = graph.steps.at(-1);
    if (a.rel && lms.length === 1 && prev && prev.kind !== 'turn' && !prev.ref) {
      prev.kind = 'arrive';
      prev.ref = { relation: a.rel.relation, landmark: landmarkOut(lms[0]) };
      continue;
    }

    if (a.rel && lms.length >= 2) {
      const before = lms.filter((l) => l.end < a.rel.at), after = lms.filter((l) => l.i > a.rel.at);
      const target = a.rel.post ? after[0] || before.at(-1) : before.at(-1) || after[0];
      const ref = a.rel.post ? before.at(-1) || after[1] : after[0] || before.at(-2);
      for (const lm of lms) if (lm !== target && lm !== ref && lm.i < target.i) push({ kind: 'pass', landmark: landmarkOut(lm) });
      push({ kind: 'arrive', landmark: landmarkOut(target), ref: ref ? { relation: a.rel.relation, landmark: landmarkOut(ref) } : null });
      continue;
    }
    for (const lm of lms) push({ kind: 'pass', landmark: landmarkOut(lm) });
  }

  const last = graph.steps.at(-1);
  if (last && last.kind === 'pass') last.kind = 'arrive';
  if (!graph.steps.some((s) => s.kind === 'arrive')) push({ kind: 'arrive', landmark: null, ref: null });
  // Only the final step is the destination; earlier "arrive" guesses become landmarks to pass.
  graph.steps.forEach((s, i) => { if (s.kind === 'arrive' && i < graph.steps.length - 1) s.kind = 'pass'; });
  graph.steps.forEach((s, i) => { s.n = i + 1; s.verify = verifyFor(s); });
  return graph;
}

export const SAMPLES = {
  en: 'From the main road go straight past the Sri Ganesha Temple, take the second left, then the blue gate opposite MedPlus pharmacy. Second floor.',
  hi: 'Main road se seedha aao, Ganesh mandir ke baad doosri gali mein baayen mudo, phir MedPlus medical ke saamne neela gate. Doosri manzil.',
  kn: 'Main road inda nera banni, Ganesha devasthana datti eradane cross alli edakke, amele MedPlus medical edurige neeli gate. Eradane floor.',
  ta: 'Main road la nera vaanga, Ganesha kovil thandi rendavathu theru idathu, appuram MedPlus medical ethire neela gate. Rendavathu floor.',
};

// Human-readable line for a step (plan screen, captions).
export function describe(step) {
  const lm = (l) => (l ? [l.colour, l.name, l.type === 'other' ? '' : l.type.replace('_', ' ')].filter(Boolean).join(' ') : 'destination');
  const ord = ['', '1st', '2nd', '3rd', '4th'][step.ordinal] || `${step.ordinal}th`;
  if (step.kind === 'turn') return `Take the ${ord} ${step.road || 'turn'} ${step.turn}`;
  if (step.kind === 'pass') return `Pass ${lm(step.landmark)}`;
  const ref = step.ref ? ` ${step.ref.relation.replace('_', ' ')} ${lm(step.ref.landmark)}` : '';
  return `Arrive: ${lm(step.landmark)}${ref}`;
}
