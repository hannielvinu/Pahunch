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
