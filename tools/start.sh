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

if [ -f "$MODEL" ] && command -v llama-server >/dev/null; then
  pkill -f llama-server 2>/dev/null
  # -t 4: llama.cpp CPU threads; -c 2048: enough for the prompt + few-shot examples.
  llama-server -m "$MODEL" --host 127.0.0.1 --port 8081 -c 2048 -t 4 > llama.log 2>&1 &
  LLAMA=$!
  echo "On-device LLM starting (pid $LLAMA, log: llama.log)…"
  for i in $(seq 1 60); do curl -s localhost:8081/health | grep -q ok && { echo "On-device LLM ready."; break; }; sleep 1; done
else
  echo "No LLM: run 'pkg install llama-cpp' and 'bash tools/get-models.sh' first. App still works with the rule parser."
fi

# Offline speech-to-text (whisper.cpp server, port 8082), if tools/get-whisper.sh has been run.
WHISPER_BIN="$HOME/whisper.cpp/build/bin/whisper-server"
WMODEL=$(ls models/whisper/ggml-small-q5_1.bin models/whisper/ggml-base.bin 2>/dev/null | head -1)
if [ -x "$WHISPER_BIN" ] && [ -n "$WMODEL" ]; then
  pkill -f whisper-server 2>/dev/null
  "$WHISPER_BIN" -m "$WMODEL" --host 127.0.0.1 --port 8082 -l auto -t 4 > whisper.log 2>&1 &
  WHISPER=$!
  echo "On-device speech ($WMODEL) starting (pid $WHISPER, log: whisper.log)"
else
  echo "No offline speech yet: run 'bash tools/get-whisper.sh' once."
fi

pkill -f "http.server 8080" 2>/dev/null
trap 'kill $LLAMA $WHISPER 2>/dev/null' EXIT
echo "App: http://localhost:8080"
python -m http.server 8080
