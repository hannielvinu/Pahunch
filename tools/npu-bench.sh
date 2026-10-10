#!/data/data/com.termux/files/usr/bin/bash
# CPU vs Hexagon NPU on the same model, same prompt sizes (llama-bench). Results go to npu-bench.log.
# Stop the servers first so the phone is idle:  bash tools/stop.sh
cd "$(dirname "$0")/.."
NPU="$HOME/llama-npu"
MODEL=${MODEL:-$(ls models/gguf/gemma-3n-E2B-it-Q4_0.gguf models/gguf/*.gguf 2>/dev/null | head -1)}
[ -x "$NPU/bin/llama-bench" ] || { echo "Run: bash tools/get-npu.sh"; exit 1; }
[ -f "$MODEL" ] || { echo "No model in models/gguf"; exit 1; }
export LD_LIBRARY_PATH="$NPU/lib:/vendor/lib64" ADSP_LIBRARY_PATH="$NPU/lib"
{
  echo "== $(date) · $(cat "$NPU/version.txt") · $MODEL"
  echo "-- CPU (6 threads)"
  "$NPU/bin/llama-bench" -m "$MODEL" -p 256 -n 32 -t 6 -ngl 0 -dev none 2>&1 | grep -E "^\|" || "$NPU/bin/llama-bench" -m "$MODEL" -p 256 -n 32 -t 6 -ngl 0 2>&1 | tail -6
  echo "-- Hexagon NPU (HTP0)"
  GGML_HEXAGON_VERBOSE=1 "$NPU/bin/llama-bench" -m "$MODEL" -p 256 -n 32 -t 6 -ngl 99 -dev HTP0 2>&1 | grep -E "^\||ggml-hex|error|Arch" | head -20
} | tee -a npu-bench.log
echo "Saved to npu-bench.log. pp = reading the prompt (tokens/s), tg = writing the answer (tokens/s)."
