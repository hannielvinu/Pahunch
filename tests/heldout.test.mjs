// Run: node tests/heldout.test.mjs
// Held-out routes: written after the parser was tuned on tests/languages.test.mjs, to measure how it copes with
// phrasing it was not tuned on. Same signature format (see languages.test.mjs).
import { parseRules } from '../js/parser.js';
import { sig } from './sig.mjs';

const HELD = [
  ['en', 'keep going straight till the bank, then turn left, the house with the red gate', 'P:bank | TL1 | A:gate/red'],
  ['en', 'after the church take a right, then the second left, yellow building', 'P:church | TR1 | TL2 | A:apartment/yellow'],
  ['en', 'opposite the bus stop, green shop', 'A:store/green opposite bus_stop'],
  ['en', 'right at the signal, left at the hospital, third floor', 'P:other | TR1 | P:hospital | TL1 | A:- | F3'],
  ['hinglish', 'school ke baad left mudna, phir park ke saamne safed ghar', 'P:school | TL1 | A:house/white opposite park'],
  ['hinglish', 'pehle right lo, phir doosra left, hara gate', 'TR1 | TL2 | A:gate/green'],
  ['hinglish', 'masjid ke peeche wali gali mein right, neeche wala ghar', 'P:mosque | TR1 | A:house'],
  ['hi', 'बैंक के बाद बाएं, फिर दूसरी गली में दाएं, पीला घर', 'P:bank | TL1 | TR2 | A:house/yellow'],
  ['hi', 'पार्क के सामने हरा गेट, तीसरी मंजिल', 'A:gate/green opposite park | F3'],
  ['tanglish', 'school thandi leftu, apram rendavathu rightu, sivappu gate', 'P:school | TL1 | TR2 | A:gate/red'],
  ['tanglish', 'hospital ethire oru kadai, adhuku pakkathula veedu', 'P:store opposite hospital | A:house next_to store'],
  ['tanglish', 'temple kitta right eduthu straight vaanga, moonavathu veedu', 'P:temple | TR1 | A:house'],
  ['ta', 'பேங்க் தாண்டி இடது பக்கம் திரும்பி, பச்சை வீடு', 'P:bank | TL1 | A:house/green'],
  ['ta', 'ரைட் எடுத்து நேரா போய் ரெண்டாவது லெஃப்ட், கோவில் எதிரே வீடு', 'TR1 | TL2 | A:house opposite temple'],
  ['kanglish', 'bank datti balakke, neeli mane', 'P:bank | TR1 | A:house/blue'],
  ['kanglish', 'school hattira edakke tirugi, eradane mahadi', 'P:school | TL1 | A:- | F2'],
  ['kn', 'ಬ್ಯಾಂಕ್ ದಾಟಿ ಎಡಕ್ಕೆ ತಿರುಗಿ, ಹಸಿರು ಮನೆ', 'P:bank | TL1 | A:house/green'],
  ['kn', 'ದೇವಸ್ಥಾನದ ಎದುರು ಬಿಳಿ ಮನೆ, ಎರಡನೇ ಮಹಡಿ', 'A:house/white opposite temple | F2'],
  ['manglish', 'bank kazhinju idathottu, pacha gate ulla veedu', 'P:bank | TL1 | A:gate/green'],
  ['manglish', 'church inte aduthu valathottu thirinju, randamathe veedu', 'P:church | TR1 | A:house'],
  ['ml', 'ബാങ്ക് കഴിഞ്ഞ് ഇടത്തോട്ട് തിരിയുക, നീല ഗേറ്റ്', 'P:bank | TL1 | A:gate/blue'],
  ['ml', 'അമ്പലത്തിന്റെ എതിരെ വെള്ള വീട്', 'A:house/white opposite temple'],
  ['ta+en', 'school தாண்டி left, blue gate வீடு', 'P:school | TL1 | A:gate/blue'],
  ['hi+en', 'temple के बाद right, फिर green gate', 'P:temple | TR1 | A:gate/green'],
  ['speech', 'go strait take the secund left then rite', 'TL2 | TR1 | A:-'],
  ['speech', 'nera po leftu apram rightu', 'TL1 | TR1 | A:-'],
  ['speech', 'Seedha jao, baayein mudo, aur phir daayein', 'TL1 | TR1 | A:-'],
  ['speech', 'straight-a vandhu right cut panni left-la thirumbunga', 'TR1 | TL1 | A:-'],
  ['turns', 'left right left right', 'TL1 | TR1 | TL1 | TR1 | A:-'],
  ['turns', 'second right then third left', 'TR2 | TL3 | A:-'],
];

let ok = 0;
for (const [lang, note, want] of HELD) {
  const got = sig(parseRules(note));
  if (got === want) ok++;
  else console.log(`MISS [${lang}] ${note}\n       got:  ${got}\n       want: ${want}`);
}
console.log(`held-out: ${ok}/${HELD.length}`);
process.exit(ok === HELD.length ? 0 : 1);
