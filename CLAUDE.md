# Pahunch: context for Claude (iQOO Hackathon 2026 Grand Finale, Mobility track)

**"Maps get you to the lane. Pahunch gets you to the door."** Spoken landmark directions
(English / Hindi / Kannada / Tamil, code-mixed) → camera-verified voice + haptic guidance to the exact door,
on the phone, offline. Every arrival will save a door card (photo, DIGIPIN, floor, route).

Builder: **Hanniel Vinu** (solo), github `hannielvinu`, hannielvinu@gmail.com.
Repo: github.com/hannielvinu/Pahunch (the Phase 1 prototype is `Pahunch-old`: never copy from it).

## Hard rules
- **Commits show only Hanniel.** No `Co-Authored-By: Claude`, no "Generated with Claude" lines. Plain messages.
- Commit + push after every working change (every 30–45 min). Timestamps prove the build happened in the event window.
- Original code only (written during the event). Open-source libs/models are fine, listed in README.
- Never claim the NPU or the Q3 chip runs the model. Truth: llama.cpp runs on the phone's CPU in Termux;
  the in-Chrome path uses the Adreno GPU via WebGPU. Mark unmeasured numbers as assumptions.
- "A well-built simple product beats a broken complex one": keep the core loop working at all times.

## Environment (everything runs on the iQOO 15 phone)
- Termux: `bash tools/start.sh` starts llama-server (port 8081) + `python -m http.server 8080`.
  App: Chrome at `http://localhost:8080` (localhost = secure context, so camera/compass/vibration work).
- `bash tools/get-models.sh [4b]` downloads models into `models/` (gitignored).
  start.sh prefers `Qwen3-4B-Instruct-2507-Q4_0.gguf`, else `qwen2.5-1.5b-instruct-q4_k_m.gguf`.
- Chrome on this phone: WebGPU ✓ (Adreno 8xx), **no shader-f16** → in-browser models must be q4 (fp32 math), not q4f16.
- The laptop is weak and crashes under load: it is only a keyboard/screen via Office Kit. Don't plan work on it.

## Code map (no build step, ES modules)
- `js/parser.js`: rule parser → step graph `{floor, lang, parser, steps:[{n, kind: pass|turn|arrive, landmark{type,name,colour}, turn, ordinal, road, ref{relation, landmark}, verify{signs, alt, colour, compass, confidence}}]}`
- `js/llm.js`: on-device LLM parser. Short line format (PASS/TURN/ARRIVE/FLOOR), strict reader, loop guard,
  names must appear in the note, turns/ordinals/floor/relation grounded from the rule parser.
  **Policy:** if the rule parser reads a complete route it is used and the AI cross-checks it (badge);
  otherwise the checked AI route is used. Prompt prefix is cached (`cache_prompt`).
- `js/vision.js`: camera, Tesseract OCR (local files in `lib/`), sign matching (1-edit tolerance), colour thirds.
- `js/guide.js`: voice prompts en/hi/kn/ta, vibration patterns, compass turn detector.
- `js/app.js`: screens home → plan → guide → arrive. `js/device.js`: WebGPU/sensor report.
- Tests: `node tests/parser.test.mjs`, `node tests/llm.test.mjs` (no model needed),
  `node tools/eval-llm.mjs` (needs llama-server: accuracy + latency of the real model).

## Status (Fri 9 Oct, ~23:00)
Done and verified on the phone: parser (4 samples), camera + OCR on real signs, compass turn, Hindi voice, vibration,
llama.cpp in Termux (Qwen2.5-1.5B: 1.7–2.2 s/route with prompt cache, but inaccurate alone, hence the grounding).

## Next (in order)
1. Evaluate Qwen3-4B with `node tools/eval-llm.mjs`. Go if ≥ 6/7 correct and < 5 s per route, else keep 1.5B as cross-check.
2. Arrival → door card: stock-camera photo (`<input type=file accept=image/* capture=environment>`), DIGIPIN
   (implement the public India Post algorithm fresh), floor, route; save in localStorage; QR (qrcode-generator).
3. GPS area gate (~150 m, demo toggle). 4. On-device voice input: Whisper tiny via transformers.js (WASM quantized
   or WebGPU q4); models in `finale-assets` / Hugging Face `onnx-community/whisper-tiny`.
5. Office Kit flows: "Paste from laptop" (done), "Send door card to laptop" (clipboard + JSON download).
6. Network meter (0 B during guidance), latency panel, QR scan-to-load (jsQR).

## Schedule
Checkpoints: Sat 10:00, Sat 19:00, Sun 09:00. LLM go/no-go Sat 16:30. Feature freeze Sun 10:00. Submit by Sun 11:30.
Sleep 00:00–08:00 Fri and 23:00–07:00 Sat (non-negotiable; Hanniel is unwell).
