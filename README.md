# Pahunch (पहुँच)

**Maps get you to the lane. Pahunch gets you to the door.**

**The language bridge for the last 100 metres.** The customer says how to reach her, in her language. Pahunch turns
her words into steps in the **rider's** language, checks them against what she actually said, reads signboards along
the way, and guides the rider by voice, big cards and vibration. Arrival completes the order.

*Pahunch only says what it can stand behind: steps come from her own words, a tick only on a sign it read.*

Built solo by Hanniel Vinu for the iQOO Hackathon 2026 Grand Finale (Mobility track), on an iQOO 15
(Snapdragon 8 Elite Gen 5). Runs as a Chrome PWA served from Termux on the phone.

## The demo: Instakart → Pahunch

1. **Customer, Instakart** (`instakart.html`, a demo quick-commerce shop, not a real brand): add items → checkout →
   pick the language she speaks (தமிழ், हिन्दी, ಕನ್ನಡ, മലയാളം, বাংলা, English, and mixes like Tanglish / Hinglish) →
   tap the mic and say how to reach her. Her words appear live as she speaks (Chrome's speech recognition, which is
   Google's recogniser, online at order time). She corrects them, then places the order.
   On a laptop/desktop Chrome her voice is also recorded and sent with the order; on a phone the page can listen
   **or** record, so it only listens.
2. **Rider, Pahunch:** the order pops up → **Accept**. On the phone:
   - her words are **translated to English** by Gemma 3n (a translation prompt that keeps names, turns, ordinals,
     colours and floors exact);
   - the route is read from the English and **cross-checked against her own words**: the turn directions and
     ordinals she said win over the translation;
   - numbered steps appear in **the rider's language** ("Guide me in"), English underneath, ▶ **hear it** (her own
     2–3 s of voice for that step, when the order has audio), and **Customer also said** for anything not turned
     into a step.
3. **Guidance:** camera + signboard OCR, cue labels (turn detected, colour seen), a big step card in the rider's
   language, the next step, progress dots, voice and vibration. **Silent guidance** for riders who can't use audio:
   big flashing cards and vibration patterns (still spoken).
4. **Arrival:** the end of her directions → the order is marked **Delivered** in Instakart too. Pahunch shows a
   summary: how many steps were checked by a sign, by cues, or confirmed by the rider.

Orders are stored on the phone (`orders/`, served by `tools/serve.py` at `/api/orders`).

## How each step is checked

| Check | Meaning |
|---|---|
| **✓ sign** | The camera read a *distinctive* signboard name from her words (cross-script: a Tamil name matches an English sign). Common names (Sri Lakshmi, Balaji…) never give a tick. |
| **cue** | A turn detected by the motion sensors, a colour seen, an object or place type seen. Evidence, not proof. |
| **you confirm** | Nothing on the phone can check it; the rider taps "I'm here". |

Gemma 3n only helps *read* the note. The landmarks it returns must be in the customer's words (any script) or they
are dropped, and small talk ("hi, how are you") never becomes a plan. Step cards and voice lines are built from
fixed phrases in each language (`stepText` in `js/guide.js`) filled with the names she said; Gemma's English line is
shown only as a reference ("In English: …").

## Under the hood

| Stage | How |
|---|---|
| **Hear** | Instakart: Chrome Web Speech in the chosen language. Pahunch's own mic: Chrome Web Speech online; Chrome's on-device recogniser where the language is downloaded; otherwise **whisper.cpp** on the phone (Termux). Orders without words are transcribed by Whisper on the phone. |
| **Translate** | Gemma 3n E2B (Q4_0) in llama.cpp on the phone's CPU: her words → one plain English line (`js/llm.js` `toEnglish`). |
| **Plan** | Rule engine (`js/parser.js`, `js/native.js`): landmarks, turns, ordinals, colours, relations (opposite / next to / near), floors, in five languages, native script, romanised and code-mixed. `understandNote()` parses the English, then `ground()` keeps the turns, ordinals and floor read from her own words. If the rules understand every word she said, that reading is used directly. |
| **See** | Signboard OCR (Tesseract.js: English, Hindi, Kannada, Tamil), colour mask, object detection (EfficientDet-Lite0) and place type (EfficientNet-Lite0) through MediaPipe on the Adreno GPU. |
| **Move** | Turns from the fused orientation sensor; steps from the accelerometer; GPS. |
| **Guide** | Voice lines in the rider's language (`js/guide.js`), distinct vibration patterns, big cards, hands-free "yes / haan / skip". |
| **Privacy** | `js/guard.js` blocks requests that would leave the phone from the Pahunch app; the chip shows "0 B sent · N blocked". (Instakart's live words use Google's recogniser; that is the customer's side, at order time.) |

## Measured

| What | Result |
|---|---|
| Model choice: rewriter on 7 messy multilingual routes | Qwen2.5-1.5B 1/7 · Qwen3-4B 3/7 · Qwen3-1.7B 4/7 · **Gemma 3n E2B 7/7 at 5.0 s/route** (llama.cpp, CPU, 6 threads) |
| Rules, 40 tuned routes + 10 small-talk lines (`tests/languages.test.mjs`) | 50/50 |
| **30 held-out routes** written after tuning (`tests/heldout.test.mjs`) | **23/30 on the first run** (77%; 2 of the 7 misses were wrong expectations), 30/30 after general fixes |
| Invented landmarks dropped (`tests/trust.test.mjs`, `tests/understanding.test.mjs`) | 22/22 |
| Small-talk lines rejected | 14/14 |

**Not measured yet:** time saved in a field test, accuracy on real voice notes from strangers, NPU speed, thermals.
Treat any other figure as an assumption.

**Hardware, honestly:** llama.cpp and whisper.cpp run on the CPU in Termux; vision runs on the Adreno GPU through
MediaPipe (WebGL). A browser can't reach the Hexagon NPU (WebNN on Android falls back to the CPU). `tools/get-npu.sh`
fetches a llama.cpp build with Qualcomm's Hexagon backend (built in CI, `.github/workflows/npu-engine.yml`) and
`tools/npu-bench.sh` compares CPU vs NPU. It has **not** been verified on the phone, so no NPU claim is made.
The app shows which device ran the model ("· CPU" or "· Hexagon NPU").

## Run on the phone (Termux + Chrome)

```
pkg install git python llama-cpp openssl-tool
git clone https://github.com/hannielvinu/Pahunch && cd Pahunch
bash tools/get-models.sh        # LLM GGUF (Gemma 3n E2B is picked first when present in models/)
bash tools/get-whisper.sh       # whisper.cpp + models ("turbo" for large-v3-turbo)
bash tools/start.sh --bg        # app :8080, llama-server :8081, whisper :8082/:8083, https :8443
bash tools/stop.sh              # stop everything
```

- Pahunch: `http://localhost:8080` in Chrome (localhost is a secure context: camera, mic, sensors, vibration).
- Instakart on the same phone: `http://localhost:8080/instakart.html`.
- Instakart on a laptop (same Wi-Fi): `start.sh` makes a local certificate and prints
  `https://<phone-ip>:8443/instakart.html` → Advanced → Proceed → allow the mic. Add `?debug=1` for a mic log.
- Developer tools: tap the logo 5× (or `?dev`).

## Tests

```
node tests/parser.test.mjs && node tests/llm.test.mjs && node tests/overlay.test.mjs && node tests/doorcard.test.mjs && node tests/understanding.test.mjs && node tests/languages.test.mjs && node tests/heldout.test.mjs && node tests/vision.test.mjs && node tests/trust.test.mjs && node tests/english.test.mjs
```

- `tests/english.test.mjs`: translation → route → cross-check against her words.
- `tests/understanding.test.mjs`: chat, questions, prompt injection, invented landmarks (with a stand-in llama-server).
- `node tools/eval-llm.mjs`: model accuracy and latency on the 7 routes (needs llama-server).
- `node tools/eval-voice.mjs`: recordings in `tests/voice/` → speech → route, scored (needs whisper-server + ffmpeg).

## Code map
`instakart.html` demo shop · `js/app.js` screens and guidance · `js/llm.js` translation, rewriter, cross-check ·
`js/parser.js` rules · `js/native.js` native-script vocabulary · `js/stt.js` offline speech · `js/voice.js` Chrome
speech + hands-free commands · `js/vision.js` OCR, colour · `js/detector.js` objects · `js/scene.js` place type ·
`js/overlay.js` drawing · `js/sensors.js` motion, heading, GPS · `js/guide.js` voice lines, vibration ·
`js/guard.js` network guard · `tools/serve.py` app server + order store.

Also in the code, not part of the final demo: door cards with DIGIPIN (`js/doorcard.js`, `js/digipin.js`, written
from India Post's public specification), a fixed-phrase question card (`js/askcard.js`), an emergency mode, and a
partner-app hand-over link (`index.html#go=<directions>&mode=delivery`).

## Third-party (open source, unmodified)
Tesseract.js 5.1.1 + tesseract.js-core (Apache-2.0), tessdata_fast eng/hin/kan/tam (Apache-2.0).
MediaPipe Tasks Vision 1.1.0 (Apache-2.0) with EfficientDet-Lite0 int8 and EfficientNet-Lite0 int8 (Apache-2.0).
transformers.js 3.8.1 (Apache-2.0, bundles onnxruntime-web, MIT). qrcode-generator by Kazuhiko Arase (MIT).
Inter and Plus Jakarta Sans (SIL OFL 1.1).
Gemma 3n E2B (Gemma Terms of Use), Qwen2.5 / Qwen3 GGUF (Apache-2.0, used in the model comparison) via llama.cpp (MIT);
Whisper models (MIT) via whisper.cpp (MIT); installed in Termux, not in this repo.
