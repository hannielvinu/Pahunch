// Native-script route words -> the parser's vocabulary, so speech transcribed in Tamil / Hindi / Kannada /
// Malayalam script is understood directly (no translation step to add errors). Matching is by prefix, so
// case endings work: வீட்டுக்கு -> house, ಎದುರಿಗೆ -> opposite, बाएँ -> left. English words that people mix in,
// written in the native script (லெஃப்ட், राइट, ರೈಟ್), are included. Proper names are left untouched.

const MAP = {
  // ---- Tamil
  இடது: 'left', இடப்பக்கம்: 'left', இடதுபக்கம்: 'left', லெஃப்ட்: 'left', லெப்ட்: 'left', லெப்டு: 'left',
  வலது: 'right', வலப்பக்கம்: 'right', வலதுபக்கம்: 'right', ரைட்: 'right', ரைட்டு: 'right',
  நேரா: 'straight', நேராக: 'straight', ஸ்ட்ரெய்ட்: 'straight', ஸ்ட்ரைட்: 'straight', ஸ்ட்ரெயிட்: 'straight',
  முதல்: 'first', ஒண்ணாவது: 'first', ரெண்டாவது: 'second', இரண்டாவது: 'second', ரெண்டாம்: 'second', மூணாவது: 'third', மூன்றாவது: 'third', நாலாவது: 'fourth', நான்காவது: 'fourth',
  கோவில்: 'temple', கோயில்: 'temple', சர்ச்: 'church', மசூதி: 'mosque', பள்ளிவாசல்: 'mosque',
  கேட்: 'gate', வாசல்: 'gate', வீடு: 'house', வீட்ட: 'house', வீட்டு: 'house', கடை: 'store', மெடிக்கல்: 'pharmacy', மருந்தகம்: 'pharmacy',
  ஸ்கூல்: 'school', பள்ளிக்கூட: 'school', ஆஸ்பத்திரி: 'hospital', மருத்துவமனை: 'hospital', பேங்க்: 'bank', வங்கி: 'bank', பஸ்: 'bus', ஸ்டாப்: 'stop', பார்க்: 'park',
  எதிரே: 'saamne', எதிர்ல: 'saamne', எதிர: 'saamne', எதிர்: 'saamne', பக்கத்துல: 'bagal', பக்கத்தில்: 'bagal', பக்கம்: 'bagal', கிட்ட: 'paas', அருகில்: 'paas', அருகே: 'paas',
  தாண்டி: 'baad', கடந்து: 'baad', அப்புறம்: 'appuram', அப்பறம்: 'appuram', பிறகு: 'appuram',
  தெரு: 'gali', சந்து: 'gali', ரோடு: 'road', ரோட்: 'road', மாடி: 'floor', தளம்: 'floor', ஃப்ளோர்: 'floor',
  பச்சை: 'green', நீல: 'blue', நீலம்: 'blue', சிவப்பு: 'red', சிகப்பு: 'red', மஞ்சள்: 'yellow', வெள்ளை: 'white', கருப்பு: 'black', கறுப்பு: 'black', ஆரஞ்சு: 'orange',
  போங்க: 'go', போ: 'go', திரும்பு: 'turn', திரும்புங்க: 'turn',
  // ---- Hindi
  बाएं: 'left', बाएँ: 'left', बायें: 'left', बाये: 'left', बाईं: 'left', बाँए: 'left', लेफ्ट: 'left',
  दाएं: 'right', दाएँ: 'right', दायें: 'right', दाये: 'right', दाईं: 'right', दाहिने: 'right', राइट: 'right',
  सीधा: 'straight', सीधे: 'straight', स्ट्रेट: 'straight',
  पहली: 'first', पहला: 'first', दूसरी: 'second', दूसरा: 'second', दूसरे: 'second', तीसरी: 'third', तीसरा: 'third', चौथी: 'fourth', चौथा: 'fourth',
  मंदिर: 'temple', मन्दिर: 'temple', मस्जिद: 'mosque', चर्च: 'church', गेट: 'gate', दरवाज: 'door', घर: 'house', मकान: 'house', दुकान: 'store',
  मेडिकल: 'pharmacy', दवाखान: 'pharmacy', स्कूल: 'school', अस्पताल: 'hospital', बैंक: 'bank', बस: 'bus', स्टॉप: 'stop', पार्क: 'park',
  सामने: 'saamne', बगल: 'bagal', पास: 'paas', बाद: 'baad', पार: 'baad', फिर: 'phir',
  गली: 'gali', सड़क: 'road', रोड: 'road', मंज़िल: 'floor', मंजिल: 'floor', फ्लोर: 'floor',
  नीला: 'blue', नीले: 'blue', नीली: 'blue', हरा: 'green', हरे: 'green', हरी: 'green', लाल: 'red', पीला: 'yellow', पीले: 'yellow', सफ़ेद: 'white', सफेद: 'white', काला: 'black', काले: 'black',
  के: 'ke', की: 'ki', का: 'ka', में: 'mein', से: 'se', वाला: 'wala', वाले: 'wala', वाली: 'wala', मुड़: 'mudo', मुड: 'mudo', जाइए: 'go', जाओ: 'go',
  // ---- Kannada
  ಎಡಕ್ಕೆ: 'left', ಎಡಗಡೆ: 'left', ಎಡ: 'left', ಲೆಫ್ಟ್: 'left', ಬಲಕ್ಕೆ: 'right', ಬಲಗಡೆ: 'right', ಬಲ: 'right', ರೈಟ್: 'right',
  ನೇರ: 'straight', ಸ್ಟ್ರೈಟ್: 'straight', ಮೊದಲ: 'first', ಮೊದಲನೇ: 'first', ಎರಡನೇ: 'second', ಮೂರನೇ: 'third', ನಾಲ್ಕನೇ: 'fourth',
  ದೇವಸ್ಥಾನ: 'temple', ಗುಡಿ: 'temple', ದೇವಾಲಯ: 'temple', ಗೇಟ್: 'gate', ಮನೆ: 'house', ಅಂಗಡಿ: 'store', ಮೆಡಿಕಲ್: 'pharmacy', ಶಾಲೆ: 'school', ಸ್ಕೂಲ್: 'school',
  ಆಸ್ಪತ್ರೆ: 'hospital', ಬ್ಯಾಂಕ್: 'bank', ಬಸ್: 'bus', ಪಾರ್ಕ್: 'park', ಎದುರು: 'saamne', ಪಕ್ಕ: 'bagal', ಹತ್ತಿರ: 'paas', ದಾಟಿ: 'baad', ಆಮೇಲೆ: 'amele',
  ರಸ್ತೆ: 'road', ಕ್ರಾಸ್: 'cross', ಮಹಡಿ: 'floor', ಹಸಿರು: 'green', ನೀಲಿ: 'blue', ಕೆಂಪು: 'red', ಹಳದಿ: 'yellow', ಬಿಳಿ: 'white', ಕಪ್ಪು: 'black', ತಿರುಗಿ: 'turn',
  // ---- Malayalam
  ഇടത്ത്: 'left', ഇടത്തോട്ട്: 'left', ഇടതു: 'left', ലെഫ്റ്റ്: 'left', വലത്ത്: 'right', വലത്തോട്ട്: 'right', വലതു: 'right', റൈറ്റ്: 'right',
  നേരെ: 'straight', സ്ട്രെയിറ്റ്: 'straight', ഒന്നാമത്തെ: 'first', രണ്ടാമത്തെ: 'second', മൂന്നാമത്തെ: 'third', നാലാമത്തെ: 'fourth',
  അമ്പലം: 'temple', ക്ഷേത്രം: 'temple', പള്ളി: 'church', ഗേറ്റ്: 'gate', വീട്: 'house', വീട്ടി: 'house', കട: 'store', മെഡിക്കൽ: 'pharmacy', സ്കൂൾ: 'school',
  ആശുപത്രി: 'hospital', ബാങ്ക്: 'bank', ബസ്: 'bus', എതിരെ: 'saamne', എതിർവശ: 'saamne', അടുത്ത്: 'paas', സമീപം: 'paas', കഴിഞ്ഞ്: 'baad', പിന്നെ: 'phir',
  റോഡ്: 'road', വഴി: 'road', നില: 'floor', പച്ച: 'green', നീല: 'blue', ചുവന്ന: 'red', ചുവപ്പ്: 'red', മഞ്ഞ: 'yellow', വെള്ള: 'white', കറുത്ത: 'black', തിരിയ: 'turn',
  // ---- Bengali
  বাঁদিকে: 'left', বাঁদিক: 'left', বাঁয়ে: 'left', বামে: 'left', বাঁ: 'left', লেফট: 'left', ডানদিকে: 'right', ডানদিক: 'right', ডানে: 'right', ডান: 'right', রাইট: 'right',
  সোজা: 'straight', প্রথম: 'first', দ্বিতীয়: 'second', তৃতীয়: 'third', চতুর্থ: 'fourth',
  মন্দির: 'temple', মসজিদ: 'mosque', গির্জা: 'church', গেট: 'gate', বাড়ি: 'house', দোকান: 'store', মেডিকেল: 'pharmacy', ওষুধের: 'pharmacy', স্কুল: 'school', হাসপাতাল: 'hospital', ব্যাংক: 'bank', পার্ক: 'park',
  সামনে: 'saamne', উল্টোদিকে: 'saamne', পাশে: 'bagal', কাছে: 'paas', পরে: 'baad', পেরিয়ে: 'baad', তারপর: 'phir', গলি: 'gali', রাস্তা: 'road', তলা: 'floor', তলায়: 'floor',
  নীল: 'blue', সবুজ: 'green', লাল: 'red', হলুদ: 'yellow', সাদা: 'white', কালো: 'black', ঘুরুন: 'turn', যান: 'go', আসুন: 'aao',
  // ---- filler words (come / go / there / that / is…) mapped to words the parser already ignores
  எடு: 'edu', திரும்ப: 'turn', போயி: 'poi', ஒரு: 'oru', அங்கே: 'there', வந்து: 'vandhu', இருந்து: 'irundhu',
  आगे: 'aage', जाकर: 'jakar', जाके: 'jaake', चलिए: 'chaliye', चलो: 'chalo', मुड़िए: 'mudiye',
  ಮಾಡಿ: 'madi', ತಗೊಳ್ಳಿ: 'togoli', ತೆಗೆದುಕೊಳ್ಳಿ: 'togoli', ಮುಂದೆ: 'munde',
  ഉള്ള: 'wala', തിരി: 'turn', ചെയ്: 'cheyyu', എടുത്ത്: 'eduthu', സ്കൂളി: 'school', ബാങ്കി: 'bank', അമ്പലത്തി: 'temple', ക്ഷേത്രത്തി: 'temple', പള്ളി: 'church',
  வாங்க: 'vaanga', வா: 'vaa', போய்: 'poi', அந்த: 'andha', இந்த: 'indha', கலர்: 'color', பண்ண: 'pannu', கட்: 'cut', இருக்கு: 'irukku', நில்லு: 'nillunga', அங்க: 'there', இங்க: 'here',
  आइए: 'aao', आओ: 'aao', आना: 'aana', जाना: 'jana', है: 'hai', हैं: 'hain', वहाँ: 'wahan', वहां: 'wahan', यहाँ: 'yahan', उस: 'that', इस: 'this', और: 'aur', लीजिए: 'lijiye', लो: 'lo',
  ಬನ್ನಿ: 'banni', ಬಾ: 'baa', ಹೋಗಿ: 'hogi', ಅಲ್ಲಿ: 'alli', ಇಲ್ಲಿ: 'illi', ಆ: 'that', ಈ: 'this', ಇದೆ: 'ide',
  വരൂ: 'vaa', വാ: 'vaa', പോകൂ: 'go', പോയി: 'poi', അവിടെ: 'there', ഇവിടെ: 'here', ആ: 'that', ഈ: 'this', ഉണ്ട്: 'irukku',
};

const KEYS = Object.keys(MAP).sort((a, b) => b.length - a.length); // longest prefix first
const NON_LATIN = /[ऀ-෿]/;

export function canonical(word) {
  if (!NON_LATIN.test(word)) return null;
  const k = KEYS.find((key) => word.startsWith(key));
  return k ? MAP[k] : null;
}

// Replace native route words in a sentence; everything else (names, punctuation) stays as it is.
export function normaliseNative(text) {
  if (!NON_LATIN.test(text)) return text;
  return text.replace(/[^\s,.;!?।|]+/gu, (w) => canonical(w) ?? w);
}

// ---------- Transliteration to Latin letters (Devanagari, Bengali, Tamil, Kannada, Malayalam) ----------
// The five scripts share one Unicode layout (same offset = same sound), so one table serves all. Used to show a
// customer's native-script name to a rider who reads another script (முருகன் -> "murukan"), and to match a
// signboard read in one script against a name said in another ("ಮೆಡ್‌ಪ್ಲಸ್" ~ MEDPLUS). Rough, phonetic; matching is fuzzy.
const T_BASES = [0x0900, 0x0980, 0x0b80, 0x0c80, 0x0d00];
const T_CONS = { 0x15: 'k', 0x16: 'kh', 0x17: 'g', 0x18: 'gh', 0x19: 'ng', 0x1a: 'ch', 0x1b: 'chh', 0x1c: 'j', 0x1d: 'jh', 0x1e: 'ny', 0x1f: 't', 0x20: 'th', 0x21: 'd', 0x22: 'dh', 0x23: 'n', 0x24: 't', 0x25: 'th', 0x26: 'd', 0x27: 'dh', 0x28: 'n', 0x29: 'n', 0x2a: 'p', 0x2b: 'ph', 0x2c: 'b', 0x2d: 'bh', 0x2e: 'm', 0x2f: 'y', 0x30: 'r', 0x31: 'r', 0x32: 'l', 0x33: 'l', 0x34: 'zh', 0x35: 'v', 0x36: 'sh', 0x37: 'sh', 0x38: 's', 0x39: 'h', 0x58: 'q', 0x59: 'kh', 0x5a: 'g', 0x5b: 'z', 0x5c: 'r', 0x5d: 'rh', 0x5e: 'f', 0x5f: 'y' };
const T_VOW = { 0x05: 'a', 0x06: 'aa', 0x07: 'i', 0x08: 'ee', 0x09: 'u', 0x0a: 'oo', 0x0b: 'ri', 0x0e: 'e', 0x0f: 'e', 0x10: 'ai', 0x12: 'o', 0x13: 'o', 0x14: 'au' };
const T_SIGN = { 0x3e: 'aa', 0x3f: 'i', 0x40: 'ee', 0x41: 'u', 0x42: 'oo', 0x43: 'ri', 0x46: 'e', 0x47: 'e', 0x48: 'ai', 0x4a: 'o', 0x4b: 'o', 0x4c: 'au', 0x57: 'au' };
const T_CHILLU = { 0x0d7a: 'n', 0x0d7b: 'n', 0x0d7c: 'r', 0x0d7d: 'l', 0x0d7e: 'l', 0x0d7f: 'k' };

export function translit(text) {
  let out = '';
  const cs = [...(text || '')];
  for (let i = 0; i < cs.length; i++) {
    const cp = cs[i].codePointAt(0);
    if (T_CHILLU[cp]) { out += T_CHILLU[cp]; continue; }
    const base = T_BASES.find((b) => cp >= b && cp < b + 0x80);
    if (base === undefined) { out += cp === 0x200c || cp === 0x200d ? '' : cs[i]; continue; }
    const o = cp - base;
    if (T_CONS[o]) {
      out += T_CONS[o];
      let j = i + 1, n = j < cs.length ? cs[j].codePointAt(0) - base : -1;
      if (n === 0x3c) { j++; n = j < cs.length ? cs[j].codePointAt(0) - base : -1; } // nukta
      if (T_SIGN[n] !== undefined) { out += T_SIGN[n]; i = j; }
      else if (n === 0x4d) { i = j; }                                        // virama: no vowel
      else {
        // Hindi / Bengali drop the final inherent "a" (राम -> ram); Dravidian scripts write their own endings.
        const wordEnd = j >= cs.length || !/[\u0900-\u0dff]/.test(cs[j]);
        out += wordEnd && (base === 0x0900 || base === 0x0980) && out.length > 2 ? '' : 'a';
        i = j - 1;
      }
    } else if (T_VOW[o]) out += T_VOW[o];
    else if (o === 0x02 || o === 0x01) out += 'n';                          // anusvara, candrabindu
    else if (o === 0x03) out += 'h';                                        // visarga
    else if (T_SIGN[o]) out += T_SIGN[o];
    // other marks (nukta alone, accents, digits handled as is) are skipped
  }
  return out;
}
