# Pahunch (पहुँच)

**Maps get you to the lane. Pahunch gets you to the door.**

**The language bridge for the last 100 metres.** The customer's voice note becomes steps in the rider's language,
with signboards read along the way. At the door, Pahunch gives the rider a question in the customer's language, one
whose answer the rider can understand.

*Pahunch only says what it can stand behind: checked phrases, answerable questions, a tick only on a sign it read.*

- **Voice note in:** handed over by a partner app at the last 100 m, shared from WhatsApp, or opened as a file;
  transcribed on the phone (Whisper, with timings). No third-party AI hears the customer.
- **Steps in the rider's language,** English underneath. Each step has **▶ hear it**, the 2–3 s of the customer's
  own voice it came from. Anything not turned into a step is shown under **Customer also said**, in her words.
- **Honest checks:** ✓ only for a distinctive signboard name the camera read (across scripts: a Tamil name matches an
  English sign); turns, colours and objects are cues; everything else says "you confirm".
- **At the door:** "Arrived ✓" only when the door's own sign was read; otherwise "You're at the place the customer
  described" and the **door card**: 30 fixed phrases (5 × 6 languages), native script + romanised + Speak, answered by
  yes/no or a number, with "Listen for" words.
- **No generated language reaches a person.** Gemma 3n on the phone only helps *read* messy notes, and its landmarks
  must be in the customer's words (22/22 invented landmarks dropped in tests).

## The demo: Instakart → Pahunch
1. **Customer** opens `instakart.html` (a demo quick-commerce shop, not a real brand), adds items, picks the language she
   speaks, and **records voice directions**. Her words appear live as she speaks (Chrome's speech recognition, the same as Pahunch's
   online mic; online at order time) and she corrects them before placing the order. The order carries her checked words
   (on phones the page can't record audio while recognising, so the shop listens only).
2. **Rider** (Pahunch, on the phone): the order pops up on the home screen → **Accept**. Her words are **translated to
   English on the phone** (Gemma 3n, a translation prompt that keeps names, turns, ordinals, colours and floors exact),
   the route is read from the English and **cross-checked against her own words** (directions and ordinals she said win),
   then shown in the rider's language. The voice note is
   (her checked words; Whisper on the phone only if an order has none) becomes numbered steps in **the rider's language** ("Guide me in: हिन्दी"), each with
   ▶ her own words, then guidance by voice, vibration and the camera.
3. **Arrival:** the end of the customer's directions: "You've arrived" → **Mark as delivered** → Delivered on both
   screens, with a summary of how each step was confirmed (sign / cue / you). Whether it is her exact gate is not
   Pahunch's job: it gets the rider to the place she described.

Orders live in `orders/` on the phone, served by `tools/serve.py` (`/api/orders`). Nothing leaves the phone.

## What it does

| Stage | How |
|---|---|
| **Hear** | Type or speak into the app's mic. Speech goes to the phone's own Google speech engine through Chrome's Web Speech API, language picked or auto, including Tanglish / Hinglish; in airplane mode it runs on the phone when the language's offline pack is installed. Otherwise the app switches to Whisper (whisper.cpp in Termux, on the phone) in the same screen. Small talk ("hi, how are you") is recognised as not being directions: no plan is made and the AI is not asked. |
| **Plan** | Rule engine for landmarks, turns (several per sentence), ordinals, colours, relations (opposite / next to / near) and floors in five languages and their code-mixed forms, plus native-script vocabulary. An on-device LLM (Gemma 3n E2B, llama.cpp) rewrites what was said, in any language or mix, into one plain English route line that the rules then parse (shown as "AI understood"); its turns, floor and relations are checked against the customer's own words and landmark names must appear in what was said. Any step can be fixed with one tap. |
| **See** | Signboard OCR (Tesseract, enlarged centre of the view, fuzzy matching) - green box for the step's sign, red for decoys. Object detection (EfficientDet-Lite0) confirms everyday landmarks ("the black chair"). Appearance classifier (EfficientNet-Lite0) recognises temple-like buildings, gates, shop fronts, petrol pumps. Colour mask for "blue gate". Torch in the dark. |
| **Move** | Turns from the fused orientation sensor (camera heading, correct when the phone is upright, not thrown by indoor magnetics); steps walked from the accelerometer; GPS area and DIGIPIN. |
| **Guide** | Conversational voice in the rider's language ("ஆமா, கரெக்ட்! … இப்போ ரெண்டாவது தெருவுல லெஃப்ட் திரும்புங்க"), distinct vibration patterns, hands-free "yes / haan / skip". It asks instead of guessing when evidence is weak. |
| **Remember** | Door card on arrival: DIGIPIN (India Post grid, implemented from the public spec), GPS accuracy, door photo, floor, route, QR; "Send to laptop" as JSON. |
| **Integrate** | Partner apps open Pahunch with one link carrying the customer's words: `index.html#go=<directions>&mode=delivery` (demo: `partner.html`). |
| **Privacy** | A local-only network guard blocks any request that would leave the phone (it caught MediaPipe's usage telemetry); the chip shows "0 B sent · N blocked". |

Modes: delivery rider, deaf / hard-of-hearing rider (Silent mode), ambulance / 108 (no questions, torch, emergency prompts), ride pickup. Languages: English, Hindi, Tamil, Kannada, Malayalam, Bengali, plus Tanglish and Hinglish.

## Who uses it
The **rider** (delivery partner, 108 ambulance crew, cab driver) is the user; the **customer** only does what they
already do: say how to reach them, once, in their own words (a voice note in the order, or to the 108 call-taker).
The partner app (delivery, dispatch, ride-hailing) holds those words and, when the rider reaches the last ~100 m
where map navigation ends, hands the job to Pahunch with one link (`index.html#go=<words>&mode=delivery&job=…&who=…`).
Pahunch plans, guides to the door, and saves a door card, so the next rider to that customer needs no directions.
`partner.html` demonstrates all three sides: the customer speaking directions, the rider's last-100 m hand-over,
and 108 dispatch.

## Why DIGIPIN on the door card
DIGIPIN is India Post's national grid: every ~4 m × 4 m square in India has a 10-character code, computed from
latitude/longitude by a public formula, so it works offline and needs no server. It turns "the blue gate opposite
MedPlus, 2nd floor" into something any system can store and share (delivery apps, 108, India Post). Offline, the
phone has satellites only: indoors it may have no fix. Then the card uses the last good fix widened by the steps
walked since (marked approx.) and fills in by itself when GPS returns.

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

## Offline voice in the PWA
Online, the mic uses Chrome's Web Speech API (Google's recogniser), per language. Offline (airplane mode), it uses
Chrome's **on-device speech recognition** for every language this Chrome has downloaded for on-device use (the home
screen shows "Offline voice: English ✓ · தமிழ் ↓ …"; tap ↓ while online to download). Languages without it go to
Whisper running in Termux on the phone (`bash tools/get-whisper.sh turbo` installs large-v3-turbo, the most accurate
for Indian languages). Install Pahunch from Chrome's menu (Add to home screen / Install app) to run it full screen.

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
- `node tests/parser.test.mjs` · `node tests/llm.test.mjs` · `node tests/overlay.test.mjs` · `node tests/doorcard.test.mjs` · `node tests/understanding.test.mjs` (chat, injection, invented landmarks, with a stand-in llama-server) · `node tests/languages.test.mjs` + `node tests/heldout.test.mjs` (70 routes across English, Hindi, Tamil, Kannada, Malayalam in native script, romanised and mixed) · `node tests/vision.test.mjs` · `node tests/trust.test.mjs` (invented landmarks, door card phrases, cross-script signs, step sources)
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
