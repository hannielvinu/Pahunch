#!/data/data/com.termux/files/usr/bin/bash
# Long downloads and builds, unattended. Run from Termux (not Ubuntu), from the repo folder:
#   nohup bash tools/lunch-setup.sh > lunch-setup.log 2>&1 &
# Then check later:  tail -30 lunch-setup.log
# Each part is independent: one failing does not stop the others. Nothing running is restarted.
cd "$(dirname "$0")/.."
termux-wake-lock 2>/dev/null
step() { echo; echo "===== $(date +%H:%M) $*"; }
get() { # url out
  mkdir -p "$(dirname "$2")"
  [ -s "$2" ] && [ "$(stat -c %s "$2")" -gt 50000000 ] && { echo "have $2"; return 0; }
  for i in $(seq 1 30); do curl -fL --retry 5 --retry-delay 5 -C - -o "$2" "$1" && return 0; echo "retry $i…"; sleep 10; done
  return 1
}

step "1/5 ffmpeg (Termux) for the voice test runner"
pkg install -y ffmpeg && echo "ffmpeg OK" || echo "ffmpeg FAILED"

step "2/5 ffmpeg + node in Ubuntu (for Claude on the phone)"
if command -v proot-distro >/dev/null; then
  proot-distro login ubuntu -- bash -c "apt-get update -qq && apt-get install -y -qq ffmpeg nodejs >/dev/null" && echo "Ubuntu ffmpeg OK" || echo "Ubuntu ffmpeg FAILED"
fi

step "3/5 Whisper medium (539 MB): better Indian languages and code-mixing"
get "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin" models/whisper/ggml-medium-q5_0.bin && echo "whisper medium OK" || echo "whisper medium FAILED"

step "4/5 Qwen3-1.7B Q4_0 (1.06 GB, Apache-2.0): newer small LLM to re-test the parser"
get "https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_0.gguf" models/gguf/Qwen3-1.7B-Q4_0.gguf && echo "Qwen3-1.7B OK" || echo "Qwen3-1.7B FAILED"

step "5/5 llama.cpp with the Adreno GPU (OpenCL) backend, built from source (optional)"
pkg install -y git cmake clang make opencl-headers ocl-icd >/dev/null 2>&1
if [ ! -x "$HOME/llama.cpp/build/bin/llama-server" ]; then
  [ -d "$HOME/llama.cpp" ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp "$HOME/llama.cpp"
  cd "$HOME/llama.cpp" && cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_OPENCL=ON -DLLAMA_CURL=OFF >/dev/null \
    && cmake --build build -j 6 --target llama-server && echo "llama.cpp OpenCL build OK" || echo "llama.cpp OpenCL build FAILED (CPU llama-server still works)"
  cd - >/dev/null
else
  echo "already built"
fi

step "DONE"
ls -la models/whisper models/gguf 2>/dev/null
echo "Restart to use the medium speech model:  pkill -f llama-server; pkill -f whisper-server; pkill -f http.server; bash tools/start.sh"
