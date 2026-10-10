// Rule parser: code-mixed Indian landmark directions -> step graph.
// Always available; the on-device LLM parser (later) falls back to this.
//
// Step graph:
// { floor, lang, parser:'rules', steps:[{ n, kind:'pass'|'turn'|'arrive', landmark?, turn?, ordinal?, road?,
//   ref?:{relation, landmark}, verify:{ signs, alt, colour, compass, confidence } }] }

import { normaliseNative } from './native.js';

const W = (s) => s.split(/\s+/).filter(Boolean);
const set = (...lists) => new Set(lists.flatMap(W));

const LEFT = set('left baayen baayein bayen baaye baye baen baayan baya baayi edakke edakkey edagade edakke idathu idadhu idadu idathu idathottu idathottekku idathekku', 'बाएं बायें बाएँ बाये ಎಡಕ್ಕೆ ಎಡಗಡೆ இடது இடதுபுறம்');
const RIGHT = set('right daayen daayein dayen daaye daye daen daahine dahine balakke balakkey balagade valathu valadhu valadu valathottu valathottekku valathekku', 'दाएं दायें दाएँ दाये ಬಲಕ್ಕೆ ಬಲಗಡೆ வலது வலதுபுறம்');
const STRAIGHT = set('straight straightah straighta straightaa strait straite stret seedha seedhe sidha sidhe nera nere neraga nerah neraa nerey neere', 'सीधा सीधे ನೇರ நேரா');
const PASS = set('past after baad datti dati daati thandi thaandi tandi paar crossing kazhinju kazhinjal kadandhu kadanthu', 'बाद पार ದಾಟಿ தாண்டி');
// Speech engines and quick typing spell turns many ways: "righu", "rite", "leftu", "rightla", "lef".
// Tamil/Kannada/Malayalam suffixes (-u, -la, -le, -ku, -ah, -tu) stick to the English word.
const LEFT_SPELL = /^(?:left|lef|leff|lept|laft|lft|lfet|leftt)(?:u|a|aa|ah|la|le|lu|ku|ke|e|ae|tu|ttu|side)?$/;
const RIGHT_SPELL = /^(?:right|righ|rite|ryt|rait|raight|rigt|riht|rhight|righth|rightt)(?:u|a|aa|ah|la|le|lu|ku|ke|e|ae|tu|ttu|side)?$/;
const STRAIGHT_SPELL = /^(?:straight|strait|stret|streat|stright)(?:u|a|aa|ah|la|e)?$/;
const ROAD = { lane: 'lane', gali: 'lane', galli: 'lane', गली: 'lane', cross: 'cross', road: 'road', rasta: 'road', raasta: 'road', street: 'street', theru: 'street', theruvula: 'street', theruvil: 'street', vazhi: 'road', roadu: 'road', rasthe: 'road', therு: 'street', தெரு: 'street', beedi: 'street', ರಸ್ತೆ: 'road', turn: 'turn', mod: 'turn', main: 'main' };
const ORD = {
  1: set('first frist firts 1st pehli pehla pehle pahli modala modalane modalne mudhal mudal mudalavathu onnamathe onnaamathe', 'पहली पहला ಮೊದಲ ಮೊದಲನೇ முதல்'),
  2: set('second secund secnd sekand sekend seccond 2nd doosri doosra dusri dusra doosre eradane erdane eradu rendavathu randavathu irandavathu rendavadhu rendaavathu rendam randamathe randaamathe randamathu', 'दूसरी दूसरा ಎರಡನೇ இரண்டாவது'),
  3: set('third thrid therd tird 3rd teesri teesra tisri mooraneya muraneya moonavathu munavathu moonaavathu moonnamathe munnamathe', 'तीसरी तीसरा ಮೂರನೇ மூன்றாவது'),
  4: set('fourth forth 4th chauthi chautha nalkaneya naalavathu naalaavathu nalamathe naalamathe', 'चौथी चौथा ನಾಲ್ಕನೇ நான்காவது'),
};
const FLOOR = set('floor manzil manjil maala mala majale mahadi maadi', 'मंजिल मंज़िल माला ಮಹಡಿ மாடி');
const GROUND = set('ground neeche');
// Relations. Prepositions take the target before them ("gate opposite MedPlus");
// postpositions take it after ("MedPlus ke saamne gate").
const REL_PRE = { opposite: 'opposite', facing: 'opposite', front: 'opposite', next: 'next_to', beside: 'next_to', besides: 'next_to', near: 'near', behind: 'behind' };
const REL_POST = {
  // spellings speech engines produce: samni, saamney, edhire, pakathula, kitta…
  samni: 'opposite', saamni: 'opposite', samney: 'opposite', saamney: 'opposite', samnay: 'opposite', saamnay: 'opposite', samaney: 'opposite', samnae: 'opposite', edhire: 'opposite', edhir: 'opposite', ethirla: 'opposite', edhirla: 'opposite', munnadi: 'opposite', mundhe: 'opposite', munde: 'opposite',
  pakathula: 'next_to', pakkathile: 'next_to', pakathile: 'next_to', pakkatula: 'next_to', pakkathla: 'next_to', pakathla: 'next_to', bajju: 'next_to', bazu: 'next_to', kitta: 'near', kitte: 'near', kittae: 'near', nazdeek: 'near', hattira: 'near', hathira: 'near', adutha: 'next_to', saamne: 'opposite', samne: 'opposite', saamane: 'opposite', samane: 'opposite', सामने: 'opposite', edurige: 'opposite', eduru: 'opposite', ಎದುರು: 'opposite', ಎದುರಿಗೆ: 'opposite', ethire: 'opposite', ethirey: 'opposite', ethir: 'opposite', எதிரே: 'opposite', எதிர்: 'opposite', bagal: 'next_to', baazu: 'next_to', paas: 'near', पास: 'near', बगल: 'next_to', pakka: 'next_to', pakkada: 'next_to', ಪಕ್ಕ: 'next_to', pakkathula: 'next_to', pakkam: 'next_to', பக்கத்தில்: 'next_to', peeche: 'behind', hinde: 'behind', pinnadi: 'behind', munpil: 'opposite', ethirvasham: 'opposite', arikil: 'near', aduthu: 'near', pinnil: 'behind' };

const COLOUR = {
  blue: 'blue neela neeli neele neel nila neelam neeli', red: 'red laal lal kempu sivappu sigappu chuvanna chuvappu', green: 'green hara hari hare hasiru pachai pacha',
  yellow: 'yellow peela peeli pila haladi manjal manja', white: 'white safed safedh bili bilee vellai vella vellaya', black: 'black kaala kala kaali kappu karuppu karutha',
  orange: 'orange narangi kesari', pink: 'pink gulabi', brown: 'brown bhura kandu', grey: 'grey gray',
};
export const COLOUR_OF = {};
for (const [c, words] of Object.entries(COLOUR)) for (const w of W(words)) COLOUR_OF[w] = c;
Object.assign(COLOUR_OF, { नीला: 'blue', नीले: 'blue', लाल: 'red', हरा: 'green', पीला: 'yellow', सफेद: 'white', काला: 'black', ನೀಲಿ: 'blue', ಕೆಂಪು: 'red', ಹಸಿರು: 'green', நீல: 'blue', சிவப்பு: 'red', பச்சை: 'green' });

// Landmark type -> words that name it in speech, and words likely painted on its signboard.
export const LANDMARKS = {
  temple: ['temple mandir mandira devasthana devasthanam devastana gudi kovil koil ambalam kshetram मंदिर ದೇವಸ್ಥಾನ ಗುಡಿ கோவில்', 'TEMPLE MANDIR DEVASTHANA KOVIL'],
  mosque: ['masjid mosque', 'MASJID MOSQUE'],
  church: ['church', 'CHURCH'],
  pharmacy: ['pharmacy medical medicals chemist dawakhana', 'PHARMACY MEDICAL MEDICALS CHEMIST'],
  hospital: ['hospital clinic aspatal aspatre', 'HOSPITAL CLINIC'],
  school: ['school', 'SCHOOL'], college: ['college', 'COLLEGE'],
  bank: ['bank', 'BANK'], atm: ['atm', 'ATM'],
  petrol: ['petrol pump bunk', 'PETROL BUNK PUMP FUEL'],
  store: ['store stores shop dukaan dukan angadi kadai kada mart supermarket kirana', 'STORES STORE SHOP MART'],
  bakery: ['bakery bakers', 'BAKERY BAKERS'],
  restaurant: ['hotel restaurant darshini bhavan cafe dhaba', 'HOTEL RESTAURANT DARSHINI BHAVAN CAFE'],
  park: ['park maidan', 'PARK'],
  bus_stop: ['bus stop busstop', 'BUS STOP'],
  apartment: ['apartment apartments flats residency enclave society building', 'APARTMENT APARTMENTS RESIDENCY ENCLAVE'],
  gate: ['gate darwaza darwaja gaate gatey', ''],
  door: ['door', ''],
  house: ['house ghar mane veedu veetu veetuku veettukku veetukku veettu manege', ''],
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

// Words pointing back to the place just named ("adhuku pakkathula" = next to that one).
const ANAPHORA = set('adhuku adhukku athuku athukku adhu athu adhoda athoda uske iske uska iska adara adakke athinte athinu its');
const WALA = set('wala wali wale waala waali waale with ulla irukkura irukkira irukura irora iruva');
const HONORIFIC = set('sri shri shree sree');
const STOP = set('the a an of to at on in is it go come take then and from main ke ki ka se mein me mai pe par wala wali wale ko le alli inda la le ge ige ali na also near this that your my his her their there here only just road see look find dekho dekhiye dekh nodi paaru paarunga area place station stand junction');
// Generic words that are never a landmark's proper name.
export const GENERIC = set('main road cross street lane gali area place side corner medical shop store building the');
// Turn verbs that follow "left/right" in code-mixed speech ("left cut pannu", "right lo", "baayen mudo").
const TURN_TAILS = 'cut|turn|take|mudna|mudne|mudke|mudkar|pannu|panni|pannunga|pannitu|edu|edunga|eduthu|eduthutu|eduthittu|eduthuttu|mudo|mudiye|mud|lo|le|lena|lijiye|thirumbu|thirumbunga|thirumbi|thirumbitu|tirugi|thirugi|togoli|togo|tagoli|thirinju|thiriyuka|thiriyu|ho|hogi|po|poi|ponga|poonga|poitu';
const TURN_WORD = '(?:left|right|baayen|baaye|bayen|daayen|daaye|dayen|edakke|balakke|idathu|valathu|idathottu|valathottu)';
// Split after every turn (and its verb: "left cut pannu", "right lo") so one breath with two turns gives two steps.
const TURN_SPLIT = new RegExp(String.raw`(?<=\b${TURN_WORD}\b(?:\s+(?:${TURN_TAILS}))*)\s+(?!(?:${TURN_TAILS})\b)`, 'i');

const SPLIT = /[.,;!?\n।]+|\b(?:then|and then|after that|uske baad|iske baad|phir|fir|amele|aamele|aamel|appuram|apparam|apram|piragu|aprm)\b/i;

const LANG_HINTS = {
  hi: set('se ke ki ka mein baad aao mudo mudiye saamne doosri manzil gali seedha baayen daayen neela mandir wala'),
  kn: set('inda alli edakke balakke datti nera banni eradane amele edurige devasthana neeli mahadi'),
  ta: set('poi po ponga pannu cut kadai veedu la nera vaanga thandi theru idathu valathu appuram ethire kovil rendavathu neela mudhal'),
};

function normalise(text) {
  return normaliseNative(text).replace(/[’']/g, '').replace(/(\d)\s*(st|nd|rd|th)\b/gi, '$1$2')
    // Hindi hands: "ulte haath" = left, "seedhe haath" = right (not "straight")
    .replace(/\b(?:ulte|ulta|ulti|baayein|baayen|bayen|baaye)\s+(?:haath|hath|hat|taraf|side)\b/gi, 'left')
    .replace(/\b(?:seedhe|sidhe|seedha|sidha|daayein|daayen|dayen|daaye)\s+(?:haath|hath|hat|taraf)\b/gi, 'right')
    // speech spellings of left / right / straight ("righu", "rite", "leftu", "rightla", "straightaa")
    .replace(/[\p{L}]+/gu, (w) => { const l = w.toLowerCase(); return LEFT_SPELL.test(l) ? 'left' : RIGHT_SPELL.test(l) ? 'right' : STRAIGHT_SPELL.test(l) ? 'straight' : w; })
    // "left side", "இடது பக்கம்" (left + side word): just the turn
    .replace(/\b(left|right)\s+(?:side|bagal|pakkam|pakka|taraf|bhag|vasham|bhaagakke)\b/gi, '$1')
    .replace(/\s+/g, ' ').trim();
}

function tokens(clause) {
  return clause.split(/[\s"()\-/:]+/).filter(Boolean).map((raw) => ({ raw, w: raw.toLowerCase() }));
}

function detectLang(text) {
  if (/[ഀ-ൿ]/.test(text)) return 'ml';
  if (/[ঀ-৿]/.test(text)) return 'bn';
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
  cut pannu panni pannunga po poi ponga poitu vaa vaanga edu edunga ah dhaan than romba konjam andha indha antha intha adhu idhu color colour coloured colored rang nillunga nillu nillunge nil iruken irukken irukom
  lo le lena lijiye khade khada khadi milenge milega hoon hun aao aaiye aana jao jaiye jana chalo chaliye mudo mudiye mud ruko dekho hai hain ho hoga raha rahe wahan yahan udhar idhar aur bas
  banni baa hogi hogu nodi tirugi thirugi illi ide alli vaanga vanga ponga poi thirumbu thirumbunga paarunga irukku iruku inge ange
  hi hii hiii hai helo how what why who whom whose when which doing done fine good great nice morning afternoon evening night
  today tomorrow yesterday now later sorry yes yeah no not namaste namaskar namaskara vanakkam kaise kaisa kaisi kya kyun aap tum
  mera meri tera teri hum enna epdi eppadi eppudi nalla nallaa sari seri hegiddira hegidiya chennagide sukhamano entha evide time
  call calling hear hearing listen test testing mic voice something anything nothing everything thing
  eduthu eduthutu eduthittu eduthuttu edukkanum edunga thirumbi thirumbitu thirumbanum poonga pongo poitu poyittu irundhu irunthu
  angae angey ingae oru onnu wahi wohi yahi aake aakar jaake jakar jaakar aage aagey seedhe togoli togo tagoli thago madi
  poyi poyal thirinju thiriyuka thiriyu cheyyu cheythu cheyth inte nte nde ude ulla kku kke ku venam vendam pannitu panniko
  kitta irunthu varum varu vandhu vanthu chalke chal lekar le_lo jayiye lena lene mudna mudne mudni mudke mudkar mudiyega muda
  chalna jaana jaake jake adhuku adhukku athuku athukku adhu athu adhoda athoda uske iske uska iska adara adakke athinte athinu its`);

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

const isLexical = (w) => LEFT.has(w) || RIGHT.has(w) || STRAIGHT.has(w) || PASS.has(w) || w in ROAD || FLOOR.has(w) || GROUND.has(w) ||
  w in COLOUR_OF || w in TYPE_OF || w in REL_PRE || w in REL_POST || Object.values(ORD).some((s) => s.has(w));

// Words just before a landmark word that look like its proper name ("Sri Ganesha" Temple, "Registration" desk).
function nameBefore(toks, i) {
  const name = [];
  for (let j = i - 1; j >= 0 && name.length < 3; j--) {
    const { raw, w } = toks[j];
    if (HONORIFIC.has(w)) continue;
    if (STOP.has(w) || VERBS.has(w) || isLexical(w) || !/^[\p{L}\p{M}\d&]+$/u.test(raw)) break;
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
      if (type === 'store' && prev?.end === i - 1 && prev.type !== 'store') { prev.end = i; continue; }
      if ((type === 'sign' || type === 'desk') && prev?.end === i - 1) {
        // "EXIT sign", "iQOO banner": the sign word belongs to the landmark before it.
        prev.end = i;
        prev.name ??= toks[i - 1].raw;
        continue;
      }
      if (prev && prev.end === i - 1 && !prev.name && prev.type !== type && !(toks[i - 1].w in BRANDS)) {
        // "Exit gate", "temple gate": one place, named by the first word.
        if (['house', 'door', 'apartment'].includes(type)) { prev.end = i; continue; } // "gate veedu": the gate is what the camera sees
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
    // also "the house with the red gate": wala/with plus articles and colours in between
    if (!between.some((w) => WALA.has(w)) || !between.every((w) => WALA.has(w) || ['the', 'a', 'an'].includes(w) || w in COLOUR_OF)) continue;
    if (b.type === 'gate' && ['house', 'door', 'apartment'].includes(a.type)) found.splice(k - 1, 1); // keep the gate
    else { a.end = b.end; found.splice(k, 1); }
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
  // (Latin letters only: unknown native-script words are mostly verb forms, not places.)
  const content = (j) => !used.has(j) && /^\p{Script=Latin}{3,}$/u.test(toks[j].raw) &&!STOP.has(toks[j].w) && !isLexical(toks[j].w) &&
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

// Words that only turn up in directions: turns, ordinals, floors, relations, colours, landmark types, brands, objects
// a camera can see, and place words the types don't cover. Small talk ("hi how are you") has none of them.
const PLACE_WORDS = set(`mall metro station signal circle junction office tower block flat flats colony nagar layout market hall
  theatre cinema hostel lodge complex plaza square chowk bridge flyover toll stadium airport railway platform pillar lamp pole post
  corner bend end machine fountain statue tank`);
const CHAT_OBJECTS = set('person people man woman phone mobile cat dog book books bed cup mug bag computer pc mouse keyboard');
const routeWord = (w) => isLexical(w) || w in BRANDS || PLACE_WORDS.has(w) || (w in OBJECTS && !CHAT_OBJECTS.has(w));
export function routeWords(text) {
  return tokens(normalise(text || '')).filter(({ w }) => routeWord(w)).length;
}
// A plan worth guiding with: at least one turn, or one landmark the camera or rider can actually check
// (a known type, a colour, a brand, a place word, an object), or a destination described by a relation.
const checkable = (lm) => !!lm && (lm.type !== 'other' || !!lm.colour || W((lm.name || '').toLowerCase()).some(routeWord));
export function isRoute(g) {
  return !!g?.steps?.some((s) => s.kind === 'turn' || checkable(s.landmark) || checkable(s.ref?.landmark));
}
// Words of the note the rule engine has no meaning for (not route vocabulary, filler, or a landmark name it used).
// None left = the rules read the whole note, so their route is exact; otherwise the on-device model helps.
export function unknownWords(note, graph = parseRules(note)) {
  const names = new Set();
  for (const s of graph.steps) for (const l of [s.landmark, s.ref?.landmark]) for (const w of W((l?.name || '').toLowerCase())) names.add(w);
  const hint = (w) => Object.values(LANG_HINTS).some((x) => x.has(w));
  const joiners = set('then phir fir amele aamele appuram apparam apram piragu aprm after that');
  return tokens(normalise(note || '')).map((t) => t.w.replace(/[.,;!?।]+/g, '')).filter(Boolean).filter((w) => !(joiners.has(w) || routeWord(w) || VERBS.has(w) || STOP.has(w) || WALA.has(w) ||
    HONORIFIC.has(w) || ANAPHORA.has(w) || hint(w) || names.has(w) || /^d/.test(w) || ['ah', 'a', 'la', 'le', 'na'].includes(w)));
}
// Shop-like types are easily swapped when translating ("medicine shop" / "pharmacy"): one family.
const FAMILY = { pharmacy: 'shop', store: 'shop', bakery: 'shop', restaurant: 'shop', hospital: 'care', school: 'edu', college: 'edu', gate: 'gate', door: 'gate', house: 'home', apartment: 'home' };
export function typeOrFamilySaid(note, type) {
  if (typeSaid(note, type)) return true;
  const f = FAMILY[type];
  return !!f && Object.entries(FAMILY).some(([t, g]) => g === f && typeSaid(note, t));
}
// Was a landmark of this type actually mentioned (any language word or brand for it)?
export function typeSaid(note, type) {
  return tokens(normalise(note || '')).some(({ w }) => TYPE_OF[w] === type || BRANDS[w]?.[0] === type);
}

const landmarkOut = (lm) => ({ type: lm.type, name: lm.name, colour: lm.colour });

// Equal, or exactly one letter changed / inserted / dropped.
function oneOff(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

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
    // one letter off a known relation word ("saamnee", "samnee")
    const near = w.length >= 5 && !(w in TYPE_OF) && Object.keys(REL_POST).find((k) => k.length >= 5 && /^[a-z]+$/.test(k) && oneOff(w, k));
    if (near) {
      r.rel = { relation: REL_POST[near], at: i, post: true };
      r.landmarks = r.landmarks.filter((lm) => !(lm.type === 'other' && lm.i === i && lm.end === i)); // it was the relation, not a place
      break;
    }
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
  const signs = target?.name ? W(target.name.toUpperCase().replace(/[^\p{L}\p{M}\d ]/gu, ' ')).filter((w) => w.length >= 3) : [];
  const alt = target ? W(LANDMARKS[target.type]?.[1] || '') : [];
  const colour = lm?.colour || null;
  const words = [...W((lm?.name || '').toLowerCase()), lm?.type === 'desk' ? 'table' : ''];
  const objects = [...new Set(words.map((w) => OBJECTS[w]).filter(Boolean))];
  const confidence = signs.length || objects.length ? 'high' : alt.length || colour ? 'medium' : 'low';
  return { signs, alt, colour, objects, compass: null, confidence };
}

export function parseRules(input) {
  const text = normalise(input);
  const graph = { floor: null, lang: detectLang(input), parser: 'rules', steps: [] };
  const push = (s) => graph.steps.push(s);

  let turnClause = false; // the previous clause ended with a turn
  let pendingRef = null;  // "opposite the bus stop," waiting for the place it describes
  const clauses = text.split(SPLIT).filter((c) => c && c.trim()).flatMap((c) => c.split(TURN_SPLIT));
  for (const clause of clauses.filter((c) => c && c.trim())) {
    const a = analyse(clause);
    if (a.floor !== undefined) graph.floor = a.floor;
    const lms = a.landmarks;

    if (a.turn) {
      // "Ganesh mandir ke baad doosri gali mein baayen" -> pass the temple, then turn.
      const turnAt = a.toks.findIndex((t) => LEFT.has(t.w) || RIGHT.has(t.w));
      const atWord = (lm) => ['at', 'near', 'from', 'after', 'by', 'beside'].includes(a.toks[lm.i - 1]?.w) || ['at', 'near', 'by'].includes(a.toks[lm.i - 2]?.w);
      const before = lms.filter((lm) => lm.i < turnAt || atWord(lm) || (a.passAt >= 0 && a.passAt > turnAt && lm.i < a.passAt));
      for (const lm of before) push({ kind: 'pass', landmark: landmarkOut(lm) });
      if (pendingRef) { push({ kind: 'pass', landmark: pendingRef.landmark }); pendingRef = null; }
      push({ kind: 'turn', turn: a.turn, ordinal: a.ordinal || 1, road: a.road });
      // "turn right, see the Remote PC text": landmarks after the turn come after it.
      for (const lm of lms) if (!before.includes(lm)) push({ kind: 'pass', landmark: landmarkOut(lm) });
      turnClause = graph.steps.at(-1)?.kind === 'turn';
      continue;
    }
    const afterTurn = turnClause;
    turnClause = false;
    if (!lms.length) continue;
    if (afterTurn && lms.length === 1 && !a.rel && ['at', 'after', 'past', 'by', 'from'].includes(a.toks[0]?.w)) {
      graph.steps.splice(graph.steps.length - 1, 0, { kind: 'pass', landmark: landmarkOut(lms[0]) });
      continue;
    }
    const prev = graph.steps.at(-1);
    // "hospital ethire oru kadai, adhuku pakkathula veedu": "adhuku / uske / its" points back to the place just named.
    if (a.rel && lms.length === 1 && prev?.landmark && a.toks.some((t) => ANAPHORA.has(t.w))) {
      push({ kind: 'arrive', landmark: landmarkOut(lms[0]), ref: { relation: a.rel.relation, landmark: prev.landmark } });
      continue;
    }
    // "opposite the bus stop, green shop": the relation is said first, the place in the next clause.
    if (a.rel && !a.rel.post && lms.length === 1 && lms[0].i > a.rel.at && (!prev || prev.kind === 'turn')) {
      pendingRef = { relation: a.rel.relation, landmark: landmarkOut(lms[0]) };
      continue;
    }
    if (pendingRef && lms.length === 1 && !a.rel) {
      push({ kind: 'arrive', landmark: landmarkOut(lms[0]), ref: pendingRef });
      pendingRef = null;
      continue;
    }

    // ", SBI bank ke bagal mein": a relation-only clause describes the place just named.
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

  if (pendingRef) push({ kind: 'pass', landmark: pendingRef.landmark });
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
