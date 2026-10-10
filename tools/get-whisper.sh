#!/data/data/com.termux/files/usr/bin/bash
# Offline speech-to-text for Pahunch: builds whisper.cpp's server in Termux and downloads a multilingual model.
# Run once, from the repo folder:  bash tools/get-whisper.sh [base]
#   default: ggml-small-q5_1 (190 MB, better for Hindi / Tamil / Kannada)   base: ggml-base (148 MB, faster)
set -u
cd "$(dirname "$0")/.."
REPO="$PWD"
pkg install -y git cmake clang make >/dev/null 2>&1 || pkg install -y git cmake clang make

if [ ! -x "$HOME/whisper.cpp/build/bin/whisper-server" ]; then
  [ -d "$HOME/whisper.cpp" ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$HOME/whisper.cpp"
  cd "$HOME/whisper.cpp"
  echo "Building whisper-server (one time, a few minutes)…"
  if ! { cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_SERVER=ON >/dev/null && cmake --build build -j 6 --target whisper-server; }; then
    echo "Retrying without OpenMP…"
    rm -rf build
    cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_OPENMP=OFF -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_SERVER=ON >/dev/null && cmake --build build -j 6 --target whisper-server
  fi
  cd "$REPO"
fi
[ -x "$HOME/whisper.cpp/build/bin/whisper-server" ] && echo "whisper-server built." || { echo "Build failed: paste the error to Claude."; exit 1; }

NAME=ggml-small-q5_1.bin
[ "${1:-}" = "base" ] && NAME=ggml-base.bin
mkdir -p models/whisper
for N in "$NAME" ggml-base.bin; do  # base also powers the fast live transcript
  [ -s "models/whisper/$N" ] && [ "$(stat -c %s "models/whisper/$N")" -gt 50000000 ] && { echo "have $N"; continue; }
  until curl -fL --retry 10 --retry-delay 5 -C - -o "models/whisper/$N" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$N"; do echo "retrying in 5 s…"; sleep 5; done
done
ls -la models/whisper
echo "Done. Restart with: bash tools/start.sh  (it starts the speech server on port 8082)"
