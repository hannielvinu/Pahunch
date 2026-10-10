#!/data/data/com.termux/files/usr/bin/bash
# Run in Termux on the phone, from the repo folder:  bash tools/start.sh
# Starts the on-device LLM (llama.cpp server, port 8081) in the background and the app server (port 8080).
# Then open http://localhost:8080 in Chrome. Ctrl+C stops both.
cd "$(dirname "$0")/.."
termux-wake-lock 2>/dev/null
# Default: Qwen2.5-1.5B as the cross-check (Qwen3-4B measured 3/7 at 5.4 s/route on this phone: no-go).
# MODEL=models/gguf/Qwen3-4B-Instruct-2507-Q4_0.gguf bash tools/start.sh  to try the 4B model.
if [ -z "${MODEL:-}" ]; then
  MODEL=models/gguf/qwen2.5-1.5b-instruct-q4_k_m.gguf
  [ -f "$MODEL" ] || MODEL=models/gguf/Qwen3-4B-Instruct-2507-Q4_0.gguf
fi
echo "Model: $MODEL"

# Prefer the llama.cpp built with the Adreno GPU (OpenCL) backend (tools/lunch-setup.sh); GPU=0 forces CPU.
LLAMA_BIN=$(command -v llama-server)
GPU_ARGS=""
if [ "${GPU:-1}" = "1" ] && [ -x "$HOME/llama.cpp/build/bin/llama-server" ]; then
  LLAMA_BIN="$HOME/llama.cpp/build/bin/llama-server"
  GPU_ARGS="-ngl 99"
  export LD_LIBRARY_PATH="/vendor/lib64:/system/vendor/lib64:${LD_LIBRARY_PATH:-}"  # Adreno libOpenCL.so
  echo "Using llama.cpp with the Adreno GPU (OpenCL) backend"
fi
if [ -f "$MODEL" ] && [ -n "$LLAMA_BIN" ]; then
  pkill -f llama-server 2>/dev/null
  # -t 4: CPU threads; -c 2048: prompt + few-shot examples; -ngl 99: all layers on the GPU (OpenCL build only).
  "$LLAMA_BIN" -m "$MODEL" --host 127.0.0.1 --port 8081 -c 2048 -t 4 $GPU_ARGS > llama.log 2>&1 &
  LLAMA=$!
  echo "On-device LLM starting (pid $LLAMA, log: llama.log)…"
  for i in $(seq 1 60); do curl -s localhost:8081/health | grep -q ok && { echo "On-device LLM ready."; break; }; sleep 1; done
else
  echo "No LLM: run 'pkg install llama-cpp' and 'bash tools/get-models.sh' first. App still works with the rule parser."
fi

# Offline speech-to-text (whisper.cpp server, port 8082), if tools/get-whisper.sh has been run.
WHISPER_BIN="$HOME/whisper.cpp/build/bin/whisper-server"
# Best available model for the final pass (WHISPER_MODEL=... overrides).
WMODEL=${WHISPER_MODEL:-$(ls models/whisper/ggml-medium-q5_0.bin models/whisper/ggml-small-q5_1.bin models/whisper/ggml-base.bin 2>/dev/null | head -1)}
LIVEMODEL=$(ls models/whisper/ggml-base.bin 2>/dev/null | head -1)
if [ -x "$WHISPER_BIN" ] && [ -n "$WMODEL" ]; then
  pkill -f whisper-server 2>/dev/null
  # Final pass: 6 threads, 15 s audio window (-ac 768 instead of the default 30 s), flash attention, greedy decoding.
  "$WHISPER_BIN" -m "$WMODEL" --host 127.0.0.1 --port 8082 -l auto -t 6 -ac 768 -fa -nt -bs 1 > whisper.log 2>&1 &
  WHISPER=$!
  echo "On-device speech ($WMODEL) starting (pid $WHISPER, log: whisper.log)"
  # Live transcript: a lighter model on its own port so it never delays the final pass.
  if [ -n "$LIVEMODEL" ] && [ "$LIVEMODEL" != "$WMODEL" ]; then
    "$WHISPER_BIN" -m "$LIVEMODEL" --host 127.0.0.1 --port 8083 -l auto -t 2 -ac 512 -fa -nt -bs 1 > whisper-live.log 2>&1 &
    WHISPER_LIVE=$!
    echo "Live transcript ($LIVEMODEL) on port 8083"
  fi
else
  echo "No offline speech yet: run 'bash tools/get-whisper.sh' once."
fi

pkill -f "http.server 8080" 2>/dev/null
trap 'kill $LLAMA $WHISPER $WHISPER_LIVE 2>/dev/null' EXIT
echo "App: http://localhost:8080"
python -m http.server 8080
