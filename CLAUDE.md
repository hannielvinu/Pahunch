# Pahunch: context for Claude (iQOO Hackathon 2026 Grand Finale, Mobility track)

**"Maps get you to the lane. Pahunch gets you to the door."** Spoken landmark directions (English / Hindi / Tamil /
Kannada / Malayalam, code-mixed) → route steps → camera-verified voice + haptic guidance to the exact door, on the
phone, offline. Every arrival saves a door card (DIGIPIN, photo, floor, route, QR). Full feature list: README.md.

Builder: **Hanniel Vinu** (solo), github `hannielvinu`. Repo: github.com/hannielvinu/Pahunch (`Pahunch-old` is the
Phase 1 prototype: never copy from it).

## Hard rules
- **Commits show only Hanniel.** No `Co-Authored-By: Claude`, no "Generated with Claude" lines.
- Commit + push after every working change. Run all four test files first (below); they must pass.
- Never claim the NPU or the Q3 chip runs a model. Truth: llama.cpp / whisper.cpp run on the CPU in Termux; vision
  runs on the Adreno GPU via MediaPipe. The OpenCL (GPU) llama.cpp build segfaults on this phone (GPU off by default).
- Don't break the working demo. Safe tags: `cp1-safe`, `cp2-safe`. Feature freeze Sat 17:30 for Checkpoint 2 (19:00).
- The laptop is weak: it only edits/pushes. Everything runs and is tested on the phone.

## Run (Termux, not Ubuntu)
- `bash tools/start.sh --bg` starts everything in the background and returns the prompt; `bash tools/stop.sh` stops all.
  Without `--bg`, Ctrl+C in that session kills all servers (this caused "ECONNREFUSED 8081" before).
- Ports: app 8080 (python http.server), llama-server 8081, whisper-server 8082 (final) + 8083 (live), speech bridge 8084.
- Models picked in this order (models/ is gitignored): LLM `gemma-3n-E2B-it-Q4_0.gguf` > qwen2.5-1.5b > Qwen3-1.7B > Qwen3-4B;
  Whisper final `ggml-medium-q5_0` > small > base, live = base. `MODEL=… bash tools/start.sh --bg` overrides.

## Pipeline
- **Voice**: online → Chrome Web Speech (Google's engine, per-language locale from the chips; Tanglish→ta-IN,
  Hinglish→hi-IN). **Offline (airplane mode) → keyboard voice**: the mic focuses the note and the rider taps the mic
  on Gboard; Gboard's own on-device speech recognition types the words in (needs Gboard as keyboard + its offline
  speech languages downloaded). Step-by-step mode does the same with a small field. Engine toggle (Live sensors):
  auto / keyboard always / Whisper only. Still in code but not on the default path: Termux:API bridge
  (tools/stt-bridge.py, js/androidstt.js; returned "no match" on this phone) and Whisper (js/stt.js).
- **Understanding**: `js/native.js` maps native-script route words (incl. transliterated English) to the parser's
  vocabulary. `js/parser.js` rule engine (exact, instant). `js/llm.js` **rewriter**: Gemma 3n rewrites any language/mix
  into ONE plain English route line ("go past the X, take the second left, then the Y opposite the Z, second floor"),
  the rules parse it, names must come from the note, turns/relations cross-checked; shown as "AI understood: …".
- **Seeing**: `js/vision.js` (Tesseract OCR centre crop, white-balanced colour mask), `js/detector.js` (EfficientDet
  objects), `js/scene.js` (EfficientNet appearance: temple/gate/shop…), `js/overlay.js`, `js/sensors.js` (fused heading
  for turns, steps, GPS). `js/guide.js` conversational voice lines in 5 languages + vibration. `js/guard.js` blocks
  off-device requests.

## Measured (on the phone)
- `node tools/eval-llm.mjs`: Gemma 3n E2B rewriter **7/7 at 5.0 s/route** (Qwen3-1.7B 4/7 at 3.8 s; old approaches 1/7–3/7).
- Tests: `node tests/parser.test.mjs && node tests/llm.test.mjs && node tests/overlay.test.mjs && node tests/doorcard.test.mjs`
- Voice: `node tools/eval-voice.mjs` scores recordings in tests/voice/ (needs whisper-server + ffmpeg).

## Offline voice (Sat 17:45)
Keyboard voice (Gboard mic, on-device) built from the laptop; confirm on the phone in airplane mode. Phone setup: Gboard default keyboard; Gboard settings → Voice
typing → on, Offline speech recognition / Faster voice typing → download English (India), Tamil, Hindi (and Kannada,
Malayalam if offered). Gboard is Google's recogniser, not ours: say so if asked.
