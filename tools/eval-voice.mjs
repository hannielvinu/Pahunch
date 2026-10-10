// Voice -> route accuracy, end to end, without anyone speaking: replays recorded samples through the
// on-device speech server and the route parser, and scores against the route that was meant.
//
// Samples: tests/voice/<name>.<m4a|mp3|wav|ogg|aac> + tests/voice/<name>.json
//   { "lang": "ta" | "tanglish" | "hinglish" | "hi" | "kn" | "ml" | "en" | "auto",
//     "expect": "pass the Ganesha temple, take the second left, then the blue gate opposite MedPlus" }
// "expect" is written in plain English so the rule parser reads it exactly.
//
// Needs: whisper-server on :8082 (tools/start.sh) and ffmpeg (pkg install ffmpeg).
// Run:   node tools/eval-voice.mjs            (add --lang=ta to override every sample's language)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseRules, describe } from '../js/parser.js';
import { agrees } from '../js/llm.js';
import { SPEECH_LANGS } from '../js/stt.js';

const DIR = 'tests/voice';
const override = process.argv.find((a) => a.startsWith('--lang='))?.slice(7);
const URL = 'http://localhost:8082/inference';

async function transcribe(wavPath, lang, translate) {
  const f = new FormData();
  f.append('file', new Blob([fs.readFileSync(wavPath)], { type: 'audio/wav' }), 'a.wav');
  f.append('temperature', '0');
  f.append('response_format', 'json');
  f.append('language', SPEECH_LANGS[lang]?.code || lang);
  if (SPEECH_LANGS[lang]?.prompt) f.append('prompt', SPEECH_LANGS[lang].prompt);
  if (translate) f.append('translate', 'true');
  const r = await fetch(URL, { method: 'POST', body: f });
  return ((await r.json()).text || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

const audio = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /\.(m4a|mp3|wav|ogg|aac|opus)$/i.test(f)) : [];
if (!audio.length) { console.log(`No samples. Put recordings + .json files in ${DIR}/ (see the header of this file).`); process.exit(0); }

let ok = 0, n = 0;
for (const file of audio) {
  const base = file.replace(/\.[^.]+$/, '');
  const metaPath = path.join(DIR, `${base}.json`);
  if (!fs.existsSync(metaPath)) { console.log(`skip ${file}: no ${base}.json`); continue; }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const lang = override || meta.lang || 'auto';
  const wav = path.join('/tmp', `${base}.wav`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(DIR, file), '-ar', '16000', '-ac', '1', wav]);
  const t0 = Date.now();
  const native = await transcribe(wav, lang, false);
  const english = SPEECH_LANGS[lang]?.code === 'en' || lang === 'en' ? native : await transcribe(wav, lang, true);
  const ms = Date.now() - t0;
  const expect = parseRules(meta.expect);
  // Same choice the app makes: native words first, English translation if the native reading is incomplete.
  let got = parseRules(native);
  const complete = (g) => !!g.steps.at(-1)?.landmark && g.steps.every((s) => s.kind === 'turn' || s.landmark);
  if (!complete(got) && english !== native) { const alt = parseRules(english); if (complete(alt)) got = alt; }
  const good = agrees(got, expect);
  n++; if (good) ok++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${file}  [${lang}]  ${(ms / 1000).toFixed(1)} s`);
  console.log(`      heard   : ${native}`);
  if (english !== native) console.log(`      english : ${english}`);
  console.log(`      got     : ${got.steps.map(describe).join(' → ')}`);
  console.log(`      expected: ${expect.steps.map(describe).join(' → ')}`);
}
console.log(`\nVoice -> route: ${ok}/${n} correct`);
