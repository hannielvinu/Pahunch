#!/data/data/com.termux/files/usr/bin/bash
# Run in Termux on the phone, from the repo folder:  bash tools/get-models.sh [browser]
# Downloads open-source models straight onto the phone (resumable). Re-run safely if Wi-Fi drops.
#   default : Qwen2.5-1.5B-Instruct GGUF Q4_K_M (1.1 GB) for llama.cpp  -> models/gguf/
#   browser : also Qwen2.5-1.5B-Instruct ONNX q4 (1.8 GB) for WebGPU in Chrome -> models/Qwen2.5-1.5B-Instruct/
set -u
cd "$(dirname "$0")/.."
HF=https://huggingface.co
get() { # url out
  mkdir -p "$(dirname "$2")"
  echo "-> $2"
  until curl -fL --retry 10 --retry-delay 5 -C - -o "$2" "$1"; do echo "retrying in 5 s…"; sleep 5; done
}

get "$HF/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf" models/gguf/qwen2.5-1.5b-instruct-q4_k_m.gguf

if [ "${1:-}" = "browser" ]; then
  R=onnx-community/Qwen2.5-1.5B-Instruct
  for f in config.json generation_config.json tokenizer.json tokenizer_config.json special_tokens_map.json added_tokens.json merges.txt vocab.json; do
    get "$HF/$R/resolve/main/$f" "models/Qwen2.5-1.5B-Instruct/$f"
  done
  get "$HF/$R/resolve/main/onnx/model_q4.onnx" models/Qwen2.5-1.5B-Instruct/onnx/model_q4.onnx
fi
ls -la models/gguf
echo "Done. Start everything with: bash tools/start.sh"
