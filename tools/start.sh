#!/data/data/com.termux/files/usr/bin/bash
# Run in Termux on the phone, from the repo folder:  bash tools/start.sh   (or --bg to run in the background)
# Starts the on-device LLM (llama.cpp server, port 8081) in the background and the app server (port 8080).
# Then open http://localhost:8080 in Chrome. Ctrl+C stops both.
cd "$(dirname "$0")/.."
termux-wake-lock 2>/dev/null
# First existing file, in the order given (ls would sort them alphabetically).
pick() { for f in "$@"; do [ -f "$f" ] && { echo "$f"; return; }; done; }
# Default: Qwen2.5-1.5B as the cross-check (Qwen3-4B measured 3/7 at 5.4 s/route on this phone: no-go).
# MODEL=models/gguf/Qwen3-4B-Instruct-2507-Q4_0.gguf bash tools/start.sh  to try the 4B model.
if [ -z "${MODEL:-}" ]; then
  # Gemma 3n E2B (Google, mobile-first, strong in Indian languages) if downloaded, else Qwen2.5-1.5B.
  MODEL=$(pick models/gguf/gemma-3n-E2B-it-Q4_0.gguf models/gguf/qwen2.5-1.5b-instruct-q4_k_m.gguf models/gguf/Qwen3-1.7B-Q4_0.gguf models/gguf/Qwen3-4B-Instruct-2507-Q4_0.gguf)
fi
echo "Model: $MODEL"

wait_llm() { for i in $(seq 1 "$1"); do curl -s localhost:8081/health | grep -q ok && return 0; kill -0 "$LLAMA" 2>/dev/null || return 1; sleep 1; done; return 1; }
CPU_BIN=$(command -v llama-server)
GPU_BIN="$HOME/llama.cpp/build/bin/llama-server"
if [ -f "$MODEL" ] && { [ -n "$CPU_BIN" ] || [ -x "$GPU_BIN" ]; }; then
  pkill -f llama-server 2>/dev/null
  STARTED=""
  # Try the Adreno GPU (OpenCL) build first if it exists (GPU=0 skips it); fall back to the CPU build.
  # The vendor library path is set for this one process only.
  if [ "${GPU:-1}" = "1" ] && [ -x "$GPU_BIN" ]; then
    LD_LIBRARY_PATH="/vendor/lib64:/system/vendor/lib64" "$GPU_BIN" -m "$MODEL" --host 127.0.0.1 --port 8081 -c 2048 -t ${LLAMA_THREADS:-6} -ngl 99 > llama.log 2>&1 &
    LLAMA=$!
    echo "On-device LLM starting on the Adreno GPU (OpenCL)…"
    if wait_llm 30; then STARTED=gpu; else echo "GPU build did not start (see llama.log); using CPU."; kill "$LLAMA" 2>/dev/null; cp llama.log llama-gpu.log 2>/dev/null; fi
  fi
  if [ -z "$STARTED" ] && [ -n "$CPU_BIN" ]; then
    # -t 4: CPU threads; -c 2048: prompt + few-shot examples.
    "$CPU_BIN" -m "$MODEL" --host 127.0.0.1 --port 8081 -c 2048 -t ${LLAMA_THREADS:-6} > llama.log 2>&1 &
    LLAMA=$!
    echo "On-device LLM starting on the CPU (pid $LLAMA, log: llama.log)…"
    wait_llm 60 && STARTED=cpu
  fi
  # A model this llama.cpp build cannot load (e.g. Gemma 3n on an old build): fall back to Qwen2.5-1.5B.
  FALLBACK=models/gguf/qwen2.5-1.5b-instruct-q4_k_m.gguf
  if [ -z "$STARTED" ] && [ "$MODEL" != "$FALLBACK" ] && [ -f "$FALLBACK" ] && [ -n "$CPU_BIN" ]; then
    echo "Could not load $MODEL (see llama-model.log); falling back to Qwen2.5-1.5B."
    cp llama.log llama-model.log 2>/dev/null
    MODEL=$FALLBACK
    "$CPU_BIN" -m "$MODEL" --host 127.0.0.1 --port 8081 -c 2048 -t ${LLAMA_THREADS:-6} > llama.log 2>&1 &
    LLAMA=$!
    wait_llm 60 && STARTED="cpu, Qwen2.5-1.5B"
  fi
  [ -n "$STARTED" ] && echo "On-device LLM ready ($STARTED)." || echo "On-device LLM failed to start: tail -20 llama.log"
else
  echo "No LLM: run 'pkg install llama-cpp' and 'bash tools/get-models.sh' first. App still works with the rule parser."
fi

# Offline speech-to-text (whisper.cpp server, port 8082), if tools/get-whisper.sh has been run.
WHISPER_BIN="$HOME/whisper.cpp/build/bin/whisper-server"
# Best available model for the final pass (WHISPER_MODEL=... overrides).
WMODEL=${WHISPER_MODEL:-$(pick models/whisper/ggml-medium-q5_0.bin models/whisper/ggml-small-q5_1.bin models/whisper/ggml-base.bin)}
LIVEMODEL=$(pick models/whisper/ggml-base.bin)
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
if [ "${1:-}" = "--bg" ]; then
  # Background mode: everything keeps running after this script returns (stop with: bash tools/stop.sh)
  nohup python -m http.server 8080 > http.log 2>&1 &
  echo "App: http://localhost:8080  (all servers running in the background; stop with: bash tools/stop.sh)"
  exit 0
fi
trap 'kill $LLAMA $WHISPER $WHISPER_LIVE 2>/dev/null' EXIT
echo "App: http://localhost:8080  (Ctrl+C here stops ALL servers; use another Termux session for other commands)"
python -m http.server 8080
