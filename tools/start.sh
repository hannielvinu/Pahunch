#!/data/data/com.termux/files/usr/bin/bash
# Run in Termux on the phone, from the repo folder:  bash tools/start.sh
# Starts the on-device LLM (llama.cpp server, port 8081) in the background and the app server (port 8080).
# Then open http://localhost:8080 in Chrome. Ctrl+C stops both.
cd "$(dirname "$0")/.."
termux-wake-lock 2>/dev/null
MODEL=models/gguf/qwen2.5-1.5b-instruct-q4_k_m.gguf

if [ -f "$MODEL" ] && command -v llama-server >/dev/null; then
  pkill -f llama-server 2>/dev/null
  # -t 6: use the big cores; -c 2048: enough for the prompt + few-shot examples.
  llama-server -m "$MODEL" --host 127.0.0.1 --port 8081 -c 2048 -t 6 > llama.log 2>&1 &
  LLAMA=$!
  echo "On-device LLM starting (pid $LLAMA, log: llama.log)…"
  for i in $(seq 1 60); do curl -s localhost:8081/health | grep -q ok && { echo "On-device LLM ready."; break; }; sleep 1; done
else
  echo "No LLM: run 'pkg install llama-cpp' and 'bash tools/get-models.sh' first. App still works with the rule parser."
fi

pkill -f "http.server 8080" 2>/dev/null
trap 'kill $LLAMA 2>/dev/null' EXIT
echo "App: http://localhost:8080"
python -m http.server 8080
