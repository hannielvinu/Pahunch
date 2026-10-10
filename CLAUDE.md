# Pahunch: context for Claude (iQOO Hackathon 2026 Grand Finale, Mobility track)

**"Maps get you to the lane. Pahunch gets you to the door."** Spoken landmark directions (English / Hindi / Tamil /
Kannada / Malayalam, code-mixed) → route steps → camera-verified voice + haptic guidance to the exact door, on the
phone, offline. Every arrival saves a door card (DIGIPIN, photo, floor, route, QR). Full feature list: README.md.

Builder: **Hanniel Vinu** (solo), github `hannielvinu`. Repo: github.com/hannielvinu/Pahunch (`Pahunch-old` is the
Phase 1 prototype: never copy from it).

## Hard rules
- **Commits show only Hanniel.** No `Co-Authored-By: Claude`, no "Generated with Claude" lines.
- Commit + push after every working change. Run all seven test files first (below); they must pass.
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
- **Voice** (all through the app's own mic): Chrome Web Speech → the phone's Google speech engine (same engine family as
  Gboard), per-language locale from the chips (Tanglish→ta-IN, Hinglish→hi-IN). It is tried offline too: it works in
  airplane mode when that language's offline pack is installed in the Google app. If it fails offline, the same sheet
  switches to on-device Whisper ("say it once more") and that language goes straight to Whisper until back online.
  Engine toggle (Live sensors): phone engine + Whisper / Whisper only / keyboard mic (Gboard, optional).
  The Termux:API bridge (tools/stt-bridge.py) is no longer used. Likely cause of its "ERROR_NO_MATCH" (unconfirmed):
  Termux:API records from the background, and Android gives background apps silent audio.
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
- Tests: `node tests/parser.test.mjs && node tests/llm.test.mjs && node tests/overlay.test.mjs && node tests/doorcard.test.mjs && node tests/understanding.test.mjs && node tests/languages.test.mjs && node tests/heldout.test.mjs`
- Voice: `node tools/eval-voice.mjs` scores recordings in tests/voice/ (needs whisper-server + ffmpeg).

## Not directions / chat input (Sat 18:15)
"hi how are you" once gave a plan built from Gemma's chat reply. Now: no route word in the note → no model call,
"That doesn't sound like directions"; the rewriter's answer must look like a route line (rewriteOk) or it is thrown
away; latin-script landmark types the customer never said are dropped; a plan is shown only if isRoute().
tests/understanding.test.mjs fakes llama-server and covers these (chat, questions, injection, empty, invented).

## Offline voice: phone setup (once, while online)
Google app → Settings → Voice → Offline speech recognition → download English (India), Hindi, Tamil (and Kannada,
Malayalam). Voice language in the Google app should include them. Chrome needs microphone permission.

## Language coverage (Sat evening)
tests/languages.test.mjs: 40 routes (English, Hinglish, Hindi, Tanglish, Tamil, Kanglish, Kannada, Manglish, Malayalam,
native+English mixes, speech spellings like "righu"/"rite"/"leftu") + 10 small-talk lines, rules only: 50/50.
tests/heldout.test.mjs: 30 routes written after tuning: 23/30 on first run (2 of the 7 misses were wrong expectations),
30/30 after general fixes. Routing: if the rules understand every word (unknownWords empty) the model is not asked
("every word understood, AI not needed"); otherwise Gemma rewrites and its landmarks must be said (any script).
