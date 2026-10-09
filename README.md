# Pahunch

**Maps get you to the lane. Pahunch gets you to the door.**

Pahunch turns spoken landmark directions (English, Hindi, Kannada, Tamil, code-mixed) into camera-verified,
voice and haptic guidance to the exact door, on the phone and offline.

Built from scratch during the iQOO Hackathon 2026 Grand Finale (Mobility track), 9–11 Oct 2026. The commit history is the build log.

## Run on the phone
```
pkg install git python
git clone https://github.com/hannielvinu/Pahunch && cd Pahunch
python -m http.server 8080
```
Then open `http://localhost:8080` in Chrome (localhost is a secure context, so camera, compass and vibration all work).

## Tests
`node tests/parser.test.mjs` · `node tests/llm.test.mjs` · `node tests/doorcard.test.mjs`

## Third-party (open source, unmodified)
Tesseract.js 5.1.1 + tesseract.js-core (Apache-2.0), tessdata_fast eng/hin/kan/tam (Apache-2.0).
qrcode-generator 1.4.4 by Kazuhiko Arase (MIT), in `lib/qrcode/`.

DIGIPIN is India Post's open addressing grid; `js/digipin.js` is written from the public specification and
checked against India Post's published examples.
