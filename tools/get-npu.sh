#!/data/data/com.termux/files/usr/bin/bash
# Installs the NPU engine: llama.cpp built with Qualcomm's Hexagon (NPU) backend by CI (.github/workflows/npu-engine.yml).
# Run once in Termux from the repo folder:  bash tools/get-npu.sh   then   bash tools/npu-bench.sh
set -e
URL=https://github.com/hannielvinu/Pahunch/releases/download/npu-engine/llama-npu-android.tgz
cd "$HOME"
curl -fL --retry 5 -o llama-npu-android.tgz "$URL"
rm -rf llama-npu && tar xzf llama-npu-android.tgz && rm -f llama-npu-android.tgz
chmod +x llama-npu/bin/*
echo "Installed $(cat llama-npu/version.txt) in ~/llama-npu"
echo "Next: bash tools/npu-bench.sh   (CPU vs NPU on the same model)"
