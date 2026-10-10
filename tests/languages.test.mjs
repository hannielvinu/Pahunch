// Run: node tests/languages.test.mjs
// How people actually say directions, in every supported language: native script, romanised (Tanglish, Hinglish,
// Kanglish, Manglish), mixed with English, and with speech-engine spellings ("righu", "rite", "leftu").
// Each case is checked by the rule engine alone (exact, no model), as a compact route signature:
import assert from 'node:assert/strict';
import { parseRules, isRoute, routeWords } from '../js/parser.js';

import { sig } from './sig.mjs';

let failed = 0, passed = 0;
const CASES = [
  // ---- English
  ['en', 'go straight, take the first left, then the second right', 'TL1 | TR2 | A:-'],
  ['en', 'From the main road go straight past the Sri Ganesha Temple, take the second left, then the blue gate opposite MedPlus pharmacy. Second floor.', 'P:temple | TL2 | A:gate/blue opposite pharmacy | F2'],
  ['en', 'turn right at the petrol pump, the white house next to SBI bank', 'P:petrol | TR1 | A:house/white next_to bank'],
  ['en', 'left, right, left', 'TL1 | TR1 | TL1 | A:-'],
  ['en', 'go strait and take rite at the temple', 'P:temple | TR1 | A:-'],
  ['en', 'lef turn then riht', 'TL1 | TR1 | A:-'],
  ['en', 'take the third left after the school, yellow house near the park, ground floor', 'P:school | TL3 | A:house/yellow near park | F0'],
  // ---- Hinglish
  ['hinglish', 'seedha jao phir left lo, mandir ke saamne neela gate', 'TL1 | A:gate/blue opposite temple'],
  ['hinglish', 'Ganesh mandir ke baad doosri gali mein baayen mudo', 'P:temple | TL2 | A:-'],
  ['hinglish', 'petrol pump se right lena, phir pehli gali left, laal gate wala ghar, teesri manzil', 'P:petrol | TR1 | TL1 | A:gate/red | F3'],
  ['hinglish', 'ulte haath mudo, phir seedhe haath', 'TL1 | TR1 | A:-'],
  ['hinglish', 'school ke bagal mein hara ghar', 'A:house/green next_to school'],
  ['hinglish', 'bhaiya seedha aake rightu le lo, phir leftu, wahi safed ghar hai', 'TR1 | TL1 | A:house/white'],
  // ---- Hindi (Devanagari)
  ['hi', 'सीधे जाइए, मंदिर के बाद दूसरी गली में बाएं मुड़िए, फिर मेडिकल के सामने नीला गेट, दूसरी मंजिल', 'P:temple | TL2 | A:gate/blue opposite pharmacy | F2'],
  ['hi', 'बाएं मुड़ो फिर दाएं', 'TL1 | TR1 | A:-'],
  ['hi', 'स्कूल के पास लाल गेट वाला घर', 'A:gate/red near school'],
  ['hi', 'आगे जाकर दाएं लीजिए, बैंक के बगल में सफेद घर', 'TR1 | A:house/white next_to bank'],
  // ---- Tanglish
  ['tanglish', 'nera poi left eduthutu righu', 'TL1 | TR1 | A:-'],
  ['tanglish', 'nera vaanga, kovil thandi rendavathu theru idathu, medical kadai ethire neela gate', 'P:temple | TL2 | A:gate/blue opposite pharmacy'],
  ['tanglish', 'bus stand kitta irundhu straight-ah vaanga, left cut pannunga, Apollo pharmacy pakkathula manjal veedu', 'P:bus_stop | TL1 | A:house/yellow next_to pharmacy'],
  ['tanglish', 'leftla thirumbi rightla poonga', 'TL1 | TR1 | A:-'],
  ['tanglish', 'rendavathu right, appuram first left, church pakkathula veedu', 'TR2 | TL1 | A:house next_to church'],
  ['tanglish', 'straightaa poitu leftu edunga, angae oru vellai veedu', 'TL1 | A:house/white'],
  // ---- Tamil (script)
  ['ta', 'நேரா போய் லெஃப்ட் எடுத்துட்டு ரைட்', 'TL1 | TR1 | A:-'],
  ['ta', 'முருகன் கோவில் தாண்டி ரெண்டாவது தெருவுல ரைட், அந்த பச்சை கேட் வீடு', 'P:temple | TR2 | A:gate/green'],
  ['ta', 'இடது பக்கம் திரும்புங்க, மெடிக்கல் எதிரே வெள்ளை வீடு, ரெண்டாவது மாடி', 'TL1 | A:house/white opposite pharmacy | F2'],
  ['ta', 'வலது பக்கம் திரும்பி நேரா போங்க, ஸ்கூல் பக்கத்துல நீல கேட்', 'TR1 | A:gate/blue next_to school'],
  // ---- Kanglish
  ['kanglish', 'nera hogi, eradane cross alli edakke tirugi, Ganesha gudi pakka neeli gate mane, eradane mahadi', 'TL2 | A:gate/blue next_to temple | F2'],
  ['kanglish', 'balakke tirugi, school edurige mane', 'TR1 | A:house opposite school'],
  ['kanglish', 'modala left, amele right togoli', 'TL1 | TR1 | A:-'],
  // ---- Kannada (script)
  ['kn', 'ನೇರ ಹೋಗಿ ಎಡಕ್ಕೆ ತಿರುಗಿ, ದೇವಸ್ಥಾನ ದಾಟಿ ಎರಡನೇ ಕ್ರಾಸ್ ಬಲಕ್ಕೆ, ನೀಲಿ ಗೇಟ್ ಮನೆ', 'TL1 | P:temple | TR2 | A:gate/blue'],
  ['kn', 'ಬಲಕ್ಕೆ ತಿರುಗಿ, ಶಾಲೆ ಎದುರು ಕೆಂಪು ಗೇಟ್', 'TR1 | A:gate/red opposite school'],
  // ---- Manglish
  ['manglish', 'nere poyi idathottu thirinju, ambalam kazhinju randamathe vazhi valathottu, chuvanna gate ulla veedu', 'TL1 | P:temple | TR2 | A:gate/red'],
  ['manglish', 'valathottu thirinju, school inte ethire veedu', 'TR1 | A:house opposite school'],
  // ---- Malayalam (script)
  ['ml', 'നേരെ പോയി ഇടത്തോട്ട് തിരിയുക, അമ്പലം കഴിഞ്ഞ് രണ്ടാമത്തെ റോഡ് വലത്തോട്ട്, ചുവന്ന ഗേറ്റ് ഉള്ള വീട്', 'TL1 | P:temple | TR2 | A:gate/red'],
  ['ml', 'വലത്തോട്ട് തിരിഞ്ഞ് സ്കൂളിന്റെ എതിരെ വീട്', 'TR1 | A:house opposite school'],
  // ---- Native script mixed with English words
  ['ta+en', 'நேரா போய் left எடுத்து, temple பக்கத்துல blue gate', 'TL1 | A:gate/blue next_to temple'],
  ['hi+en', 'मंदिर के बाद second left, फिर blue gate', 'P:temple | TL2 | A:gate/blue'],
  ['kn+en', 'ಎಡಕ್ಕೆ turn ಮಾಡಿ, school ಹತ್ತಿರ ಮನೆ', 'TL1 | A:house near school'],
  ['ml+en', 'ഇടത്തോട്ട് turn ചെയ്ത് temple കഴിഞ്ഞ് right', 'TL1 | P:temple | TR1 | A:-'],
];

const NOT_ROUTES = ['nalla irukkeengala', 'aap kaise ho bhaiya', 'hegiddira', 'sukhamano', 'எப்படி இருக்கீங்க', 'नमस्ते कैसे हो', 'ಹೇಗಿದ್ದೀರಾ', 'സുഖമാണോ', 'hello can you hear me', 'ok thank you bye'];

for (const [lang, note, want] of CASES) {
  try { assert.equal(sig(parseRules(note)), want); passed++; }
  catch (e) { failed++; console.log(`FAIL [${lang}] ${note}\n       got:  ${e.actual}\n       want: ${e.expected}`); }
}
for (const note of NOT_ROUTES) {
  const g = parseRules(note);
  if (routeWords(note) === 0 || !isRoute(g)) passed++;
  else { failed++; console.log(`FAIL not a route, but planned: ${note}  ->  ${sig(g)}`); }
}
console.log(`${passed} passed, ${failed} failed (${CASES.length} routes in 9 language forms + ${NOT_ROUTES.length} small-talk lines)`);
process.exit(failed ? 1 : 0);
