// The door card: what to say to the customer, in the customer's language, when rider and customer don't share one.
// Fixed phrases only (no generated language reaches a person): 5 phrases × 6 languages = 30, each in native script
// and romanised, every question answerable with yes / no or a number, so the rider can understand the reply.
// Landmark names are kept exactly as the customer said them; colours, place types and relations come from small
// word lists. Phrases still need a native speaker's check before they are marked as checked (CHECKED below).

import { localName } from './guide.js';

export const ASK = {
  en: {
    name: 'English',
    lead: ['I am at the {place}.', 'I am at the {place}.'],
    gate: ['Is this your gate? Please say yes or no.', 'Is this your gate? Please say yes or no.'],
    more: ['How many more gates from here? Please say a number.', 'How many more gates from here? Please say a number.'],
    floor: ['Which floor? Please say the number.', 'Which floor? Please say the number.'],
    down: ['Please come down to the gate.', 'Please come down to the gate.'],
    yes: [['yes', 'yes'], ['correct', 'correct'], ['this one', 'this one']],
    no: [['no', 'no'], ['not this', 'not this'], ['next one', 'next one']],
    nums: [['one', 'one'], ['two', 'two'], ['three', 'three'], ['four', 'four'], ['five', 'five']],
  },
  hi: {
    name: 'हिन्दी',
    lead: ['मैं {place} के पास हूँ।', 'Main {place} ke paas hoon.'],
    gate: ['क्या यही आपका गेट है? हाँ या ना बोलिए।', 'Kya yahi aapka gate hai? Haan ya na boliye.'],
    more: ['यहाँ से और कितने गेट? नंबर बोलिए।', 'Yahan se aur kitne gate? Number boliye.'],
    floor: ['कौन सी मंज़िल? नंबर बोलिए।', 'Kaun si manzil? Number boliye.'],
    down: ['प्लीज़ नीचे गेट पर आ जाइए।', 'Please neeche gate par aa jaiye.'],
    yes: [['हाँ', 'haan'], ['जी हाँ', 'ji haan'], ['सही', 'sahi']],
    no: [['नहीं', 'nahin'], ['ना', 'na'], ['अगला', 'agla (next)']],
    nums: [['एक', 'ek'], ['दो', 'do'], ['तीन', 'teen'], ['चार', 'chaar'], ['पाँच', 'paanch']],
  },
  ta: {
    name: 'தமிழ்',
    lead: ['நான் இப்போ {place} கிட்ட இருக்கேன்.', 'Naan ippo {place} kitta irukken.'],
    gate: ['இதுதான் உங்க கேட்டா? ஆமா இல்ல சொல்லுங்க.', 'Idhu dhaan unga gate-aa? Aama illa sollunga.'],
    more: ['இங்கிருந்து இன்னும் எத்தனை கேட்? நம்பர் சொல்லுங்க.', 'Ingirundhu innum ethana gate? Number sollunga.'],
    floor: ['எந்த மாடி? நம்பர் சொல்லுங்க.', 'Endha maadi? Number sollunga.'],
    down: ['ப்ளீஸ் கீழே கேட்டுக்கு வாங்க.', 'Please keezhe gate-ukku vaanga.'],
    yes: [['ஆமா', 'aama'], ['ஆமாம்', 'aamaam'], ['சரி', 'sari']],
    no: [['இல்ல', 'illa'], ['இல்லை', 'illai'], ['அடுத்தது', 'aduthadhu (next)']],
    nums: [['ஒண்ணு', 'onnu'], ['ரெண்டு', 'rendu'], ['மூணு', 'moonu'], ['நாலு', 'naalu'], ['அஞ்சு', 'anju']],
  },
  kn: {
    name: 'ಕನ್ನಡ',
    lead: ['ನಾನು ಈಗ {place} ಹತ್ರ ಇದೀನಿ.', 'Naanu eega {place} hatra ideeni.'],
    gate: ['ಇದೇನಾ ನಿಮ್ಮ ಗೇಟ್? ಹೌದು ಇಲ್ಲ ಅಂತ ಹೇಳಿ.', 'Idena nimma gate? Houdu illa anta heli.'],
    more: ['ಇಲ್ಲಿಂದ ಇನ್ನೂ ಎಷ್ಟು ಗೇಟ್? ನಂಬರ್ ಹೇಳಿ.', 'Illinda innu eshtu gate? Number heli.'],
    floor: ['ಯಾವ ಮಹಡಿ? ನಂಬರ್ ಹೇಳಿ.', 'Yaava mahadi? Number heli.'],
    down: ['ದಯವಿಟ್ಟು ಕೆಳಗೆ ಗೇಟ್ ಹತ್ರ ಬನ್ನಿ.', 'Dayavittu kelage gate hatra banni.'],
    yes: [['ಹೌದು', 'houdu'], ['ಹಾ', 'haa'], ['ಸರಿ', 'sari']],
    no: [['ಇಲ್ಲ', 'illa'], ['ಅಲ್ಲ', 'alla'], ['ಮುಂದಿನದು', 'mundinadu (next)']],
    nums: [['ಒಂದು', 'ondu'], ['ಎರಡು', 'eradu'], ['ಮೂರು', 'mooru'], ['ನಾಲ್ಕು', 'naalku'], ['ಐದು', 'aidu']],
  },
  ml: {
    name: 'മലയാളം',
    lead: ['ഞാൻ ഇപ്പോൾ {place} അടുത്താണ്.', 'Njan ippol {place} aduthaanu.'],
    gate: ['ഇതാണോ നിങ്ങളുടെ ഗേറ്റ്? അതെ അല്ല എന്ന് പറയൂ.', 'Ithaano ningalude gate? Athe alla ennu parayoo.'],
    more: ['ഇവിടെ നിന്ന് ഇനി എത്ര ഗേറ്റ്? നമ്പർ പറയൂ.', 'Ivide ninnu ini ethra gate? Number parayoo.'],
    floor: ['ഏത് നില? നമ്പർ പറയൂ.', 'Ethu nila? Number parayoo.'],
    down: ['ദയവായി താഴെ ഗേറ്റിലേക്ക് വരൂ.', 'Dayavaayi thaazhe gate-ilekku varoo.'],
    yes: [['അതെ', 'athe'], ['ആ', 'aa'], ['ശരി', 'shari']],
    no: [['അല്ല', 'alla'], ['ഇല്ല', 'illa'], ['അടുത്തത്', 'aduthathu (next)']],
    nums: [['ഒന്ന്', 'onnu'], ['രണ്ട്', 'randu'], ['മൂന്ന്', 'moonnu'], ['നാല്', 'naalu'], ['അഞ്ച്', 'anju']],
  },
  bn: {
    name: 'বাংলা',
    lead: ['আমি এখন {place} এর কাছে আছি।', 'Ami ekhon {place} er kachhe achhi.'],
    gate: ['এটাই কি আপনার গেট? হ্যাঁ বা না বলুন।', 'Etai ki apnar gate? Hyan ba na bolun.'],
    more: ['এখান থেকে আর কটা গেট? নম্বর বলুন।', 'Ekhan theke ar kota gate? Number bolun.'],
    floor: ['কোন তলা? নম্বর বলুন।', 'Kon tola? Number bolun.'],
    down: ['দয়া করে নিচে গেটে আসুন।', 'Doya kore niche gete ashun.'],
    yes: [['হ্যাঁ', 'hyan'], ['হুম', 'hum'], ['ঠিক', 'thik']],
    no: [['না', 'na'], ['নয়', 'noy'], ['পরেরটা', 'porerta (next)']],
    nums: [['এক', 'ek'], ['দুই', 'dui'], ['তিন', 'tin'], ['চার', 'char'], ['পাঁচ', 'panch']],
  },
};

export const QUESTIONS = ['lead', 'gate', 'more', 'floor', 'down'];
export const PHRASE_COUNT = Object.values(ASK).length * QUESTIONS.length; // 30
// Languages whose phrases a native speaker has checked (fill in after the check; shown on the card).
export const CHECKED = new Set([]);

// Romanised words for the place description (colour + type + relation), per language. Names stay as said.
const ROM = {
  hi: { blue: 'neela', red: 'laal', green: 'hara', yellow: 'peela', white: 'safed', black: 'kaala', orange: 'narangi', pink: 'gulabi', temple: 'mandir', pharmacy: 'medical', gate: 'gate', house: 'ghar', store: 'dukaan', school: 'school', hospital: 'hospital', bank: 'bank', park: 'park', bus_stop: 'bus stop', apartment: 'apartment', door: 'darwaza', petrol: 'petrol pump', church: 'church', mosque: 'masjid', opposite: 'ke saamne', next_to: 'ke bagal mein', near: 'ke paas', behind: 'ke peeche' },
  ta: { blue: 'neela', red: 'sivappu', green: 'pachai', yellow: 'manjal', white: 'vellai', black: 'karuppu', temple: 'kovil', pharmacy: 'medical', gate: 'gate', house: 'veedu', store: 'kadai', school: 'school', hospital: 'hospital', bank: 'bank', park: 'park', bus_stop: 'bus stop', apartment: 'apartment', door: 'kadhavu', petrol: 'petrol bunk', church: 'church', mosque: 'pallivasal', opposite: 'ethire', next_to: 'pakkathula', near: 'kitta', behind: 'pinnadi' },
  kn: { blue: 'neeli', red: 'kempu', green: 'hasiru', yellow: 'haladi', white: 'bili', black: 'kappu', temple: 'devasthana', pharmacy: 'medical', gate: 'gate', house: 'mane', store: 'angadi', school: 'school', hospital: 'aaspatre', bank: 'bank', park: 'park', bus_stop: 'bus stop', apartment: 'apartment', door: 'baagilu', petrol: 'petrol bunk', church: 'church', mosque: 'masjid', opposite: 'edurige', next_to: 'pakka', near: 'hatra', behind: 'hinde' },
  ml: { blue: 'neela', red: 'chuvanna', green: 'pacha', yellow: 'manja', white: 'vella', black: 'karutha', temple: 'ambalam', pharmacy: 'medical', gate: 'gate', house: 'veedu', store: 'kada', school: 'school', hospital: 'aashupathri', bank: 'bank', park: 'park', bus_stop: 'bus stop', apartment: 'apartment', door: 'vaathil', petrol: 'petrol pump', church: 'palli', mosque: 'palli', opposite: 'ethire', next_to: 'aduthu', near: 'aduthu', behind: 'pinnil' },
  bn: { blue: 'neel', red: 'laal', green: 'sobuj', yellow: 'holud', white: 'sada', black: 'kalo', temple: 'mondir', pharmacy: 'medical', gate: 'gate', house: 'bari', store: 'dokan', school: 'school', hospital: 'haspatal', bank: 'bank', park: 'park', bus_stop: 'bus stop', apartment: 'apartment', door: 'dorja', petrol: 'petrol pump', church: 'girja', mosque: 'masjid', opposite: 'er ulto dike', next_to: 'er pashe', near: 'er kachhe', behind: 'er pichhone' },
};
// Relation words in native script, placed after the reference (Indian languages use postpositions).
const REL = {
  hi: { opposite: 'के सामने', next_to: 'के बगल में', near: 'के पास', behind: 'के पीछे' },
  ta: { opposite: 'எதிரே', next_to: 'பக்கத்துல', near: 'கிட்ட', behind: 'பின்னாடி' },
  kn: { opposite: 'ಎದುರಿಗೆ', next_to: 'ಪಕ್ಕ', near: 'ಹತ್ರ', behind: 'ಹಿಂದೆ' },
  ml: { opposite: 'എതിരെ', next_to: 'അടുത്ത്', near: 'അടുത്ത്', behind: 'പിന്നിൽ' },
  bn: { opposite: 'এর উল্টো দিকে', next_to: 'এর পাশে', near: 'এর কাছে', behind: 'এর পিছনে' },
};
const EN_REL = { opposite: 'opposite', next_to: 'next to', near: 'near', behind: 'behind' };

function romName(lm, lang) {
  if (!lm) return '';
  const R = ROM[lang] || {};
  const type = lm.type === 'other' ? '' : R[lm.type] || lm.type.replace('_', ' ');
  return [lm.colour ? R[lm.colour] || lm.colour : '', lm.name, type].filter(Boolean).join(' ');
}

// "green gate opposite MedPlus pharmacy" in the customer's language: [native, romanised].
export function placeWords(step, lang) {
  const lm = step?.landmark, ref = step?.ref;
  if (lang === 'en' || !ASK[lang]) {
    const t = [localName(lm, 'en'), ref?.landmark ? `${EN_REL[ref.relation] || ''} ${localName(ref.landmark, 'en')}` : ''].filter(Boolean).join(' ');
    return [t, t];
  }
  const native = [ref?.landmark ? `${localName(ref.landmark, lang)} ${REL[lang]?.[ref.relation] || ''}` : '', localName(lm, lang)].filter(Boolean).join(' ');
  const rom = [ref?.landmark ? `${romName(ref.landmark, lang)} ${ROM[lang]?.[ref.relation] || ''}` : '', romName(lm, lang)].filter(Boolean).join(' ');
  // Hindi: the place is followed by "के पास", so colour adjectives take the oblique form (हरा -> हरे, neela -> neele).
  if (lang === 'hi') return [native.replace(/(हरा|नीला|पीला|काला)(?= )/g, (w) => w.slice(0, -1) + 'े').trim(), rom.replace(/(?<![a-z])(hara|neela|peela|kaala)(?![a-z])/g, (w) => w.slice(0, -1) + 'e').trim()];
  return [native.trim(), rom.trim()];
}

// The card for one place in one language: [{ key, native, roman }], plus what to listen for.
export function card(step, lang) {
  const L = ASK[lang] || ASK.en;
  const [pn, pr] = placeWords(step, ASK[lang] ? lang : 'en');
  const fill = (t, p) => t.replace('{place}', p || '…');
  return {
    lang: ASK[lang] ? lang : 'en',
    name: L.name,
    lines: QUESTIONS.filter((k) => k !== 'lead' || step?.landmark || step?.ref).map((k) => ({ key: k, native: fill(L[k][0], pn), roman: fill(L[k][1], pr) })),
    yes: L.yes, no: L.no,
    // Numbers are very often said in English, even mid-sentence in Tamil or Hindi: English first.
    nums: ASK.en.nums.map((e, i) => [e[0], L.nums[i]?.[0] || '', L.nums[i]?.[1] || '']),
    checked: CHECKED.has(lang),
  };
}
