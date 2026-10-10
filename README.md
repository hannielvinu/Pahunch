# Pahunch (पहुँच)

**Maps get you to the lane. Pahunch gets you to the door.**

In India, addresses are landmarks, not coordinates: *"Ganesh mandir ke baad doosri gali mein baayen, MedPlus ke
saamne neela gate."* Maps get a rider to the lane; the last 100 metres are still solved by phone calls.
Pahunch reads the directions people already give (typed or spoken, in English, Hindi, Tamil, Kannada,
Malayalam or code-mixed), turns them into steps, and guides to the exact door with the camera, motion sensors,
voice and vibration. **Everything runs on the phone, offline.** Every arrival saves a door card (DIGIPIN, photo,
floor, route, QR), so the next visit needs no description at all.

Built from scratch by **Hanniel Vinu** during the iQOO Hackathon 2026 Grand Finale (Mobility track), 9–11 October
2026, on the iQOO 15. The commit history is the build log.

## What it does

| Stage | How |
|---|---|
| **Hear** | Type or speak. Online, speech goes through Chrome's Web Speech API (Google's engine), language picked or auto, including Tanglish / Hinglish modes. Offline (airplane mode), the mic hands over to the phone keyboard's own voice typing (Gboard, recognised on the phone with its offline languages) and the words stream straight into the note. Whisper (whisper.cpp in Termux) remains selectable. Native-script speech is understood directly; the English translation is kept as a backup. Step-by-step voice mode reads each step back for a yes. |
| **Plan** | Rule engine for landmarks, turns (several per sentence), ordinals, colours, relations (opposite / next to / near) and floors in five languages and their code-mixed forms, plus native-script vocabulary. An on-device LLM (Gemma 3n E2B, llama.cpp) rewrites what was said, in any language or mix, into one plain English route line that the rules then parse (shown as "AI understood"); its turns, floor and relations are checked against the customer's own words and landmark names must appear in what was said. Any step can be fixed with one tap. |
| **See** | Signboard OCR (Tesseract, enlarged centre of the view, fuzzy matching) - green box for the step's sign, red for decoys. Object detection (EfficientDet-Lite0) confirms everyday landmarks ("the black chair"). Appearance classifier (EfficientNet-Lite0) recognises temple-like buildings, gates, shop fronts, petrol pumps. Colour mask for "blue gate". Torch in the dark. |
| **Move** | Turns from the fused orientation sensor (camera heading, correct when the phone is upright, not thrown by indoor magnetics); steps walked from the accelerometer; GPS area and DIGIPIN. |
| **Guide** | Conversational voice in the rider's language ("ஆமா, கரெக்ட்! … இப்போ ரெண்டாவது தெருவுல லெஃப்ட் திரும்புங்க"), distinct vibration patterns, hands-free "yes / haan / skip". It asks instead of guessing when evidence is weak. |
| **Remember** | Door card on arrival: DIGIPIN (India Post grid, implemented from the public spec), GPS accuracy, door photo, floor, route, QR; "Send to laptop" as JSON. |
| **Integrate** | Partner apps open Pahunch with one link carrying the customer's words: `index.html#go=<directions>&mode=delivery` (demo: `partner.html`). |
| **Privacy** | A local-only network guard blocks any request that would leave the phone (it caught MediaPipe's usage telemetry); the chip shows "0 B sent · N blocked". |

Modes: delivery rider, ambulance / 108 (no questions, torch, emergency prompts), ride pickup.

## Measured on the iQOO 15 (Snapdragon 8 Elite Gen 5)

| What | Result |
|---|---|
| Qwen2.5-1.5B Q4_K_M, llama.cpp CPU (4 threads), with prompt cache | 1.6–2.2 s per route, ~33 tok/s generation |
| Qwen3-4B Q4_0 (go/no-go) | 3/7 test routes, 5.4 s/route: no-go |
| Qwen2.5-1.5B with JSON-schema output | 1/7, 8.3 s/route: reverted to the short line format |
| Rule engine on the test routes | 7/7, under 5 ms |
| **Gemma 3n E2B Q4_0 rewriter** (any language → one plain English line → rules), llama.cpp CPU, 6 threads | **7/7 messy multilingual test routes, 5.0 s/route** (6/7 at 4.8 s before keeping starting points and "don't go there" landmarks) |
| Qwen3-1.7B Q4_0 rewriter | 4/7, 3.8 s/route |
| Whisper (small q5_1 final pass, base for live transcript) | from ~1 min down to a few seconds after tuning (15 s audio window, 6 threads, flash attention, greedy) |

Numbers not listed here have not been measured; treat any other figure as an assumption.

**Hardware, honestly:** the language and speech models run on the phone's CPU (llama.cpp / whisper.cpp in
Termux); vision runs on the Adreno GPU through MediaPipe (WebGL). Chrome cannot reach the Hexagon NPU. The
production path is a native app using Qualcomm's QNN / Genie runtime for the NPU; `tools/start.sh` already
uses an OpenCL (Adreno GPU) build of llama.cpp when one is present.

## Run on the phone (Termux + Chrome)

```
pkg install git python llama-cpp
git clone https://github.com/hannielvinu/Pahunch && cd Pahunch
bash tools/get-models.sh        # Qwen2.5-1.5B GGUF (1.1 GB)
bash tools/get-whisper.sh       # builds whisper.cpp, downloads Whisper small + base (add "medium" for Indian languages)
bash tools/start.sh             # LLM :8081, speech :8082/:8083, app :8080
```
Open `http://localhost:8080` in Chrome (localhost is a secure context: camera, mic, sensors, vibration work).

## Tests and evaluation
- `node tests/parser.test.mjs` · `node tests/llm.test.mjs` · `node tests/overlay.test.mjs` · `node tests/doorcard.test.mjs`
- `node tools/eval-llm.mjs`: on-device LLM accuracy and latency on 7 routes (needs llama-server)
- `node tools/eval-voice.mjs`: recorded voice samples → speech → route, scored against the intended route

## Code map
`js/parser.js` rules · `js/native.js` native-script vocabulary · `js/llm.js` on-device LLM · `js/stt.js` offline speech ·
`js/voice.js` Chrome speech fallback + hands-free commands · `js/vision.js` camera, OCR, colour · `js/detector.js` objects ·
`js/scene.js` appearance · `js/overlay.js` drawing · `js/sensors.js` motion, heading, GPS · `js/guide.js` voice lines, vibration ·
`js/doorcard.js` + `js/digipin.js` door cards · `js/guard.js` network guard · `js/app.js` screens.

## Third-party (open source, unmodified)
Tesseract.js 5.1.1 + tesseract.js-core (Apache-2.0), tessdata_fast eng/hin/kan/tam (Apache-2.0).
qrcode-generator by Kazuhiko Arase (MIT), in `lib/qrcode/`.
MediaPipe Tasks Vision 1.1.0 (Apache-2.0) with EfficientDet-Lite0 int8 and EfficientNet-Lite0 int8 (Apache-2.0), in `lib/mediapipe/`, `lib/detector/`.
transformers.js 3.8.1 (Apache-2.0, bundles onnxruntime-web, MIT). Inter and Plus Jakarta Sans (SIL OFL 1.1), in `lib/fonts/`.
Qwen2.5-1.5B-Instruct and Qwen3 GGUF (Apache-2.0) via llama.cpp (MIT); Whisper models (MIT) via whisper.cpp (MIT); installed in Termux.
DIGIPIN is India Post's open addressing grid; `js/digipin.js` is written from the public specification and checked against India Post's published examples.
