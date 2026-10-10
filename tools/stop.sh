#!/data/data/com.termux/files/usr/bin/bash
# Stops everything tools/start.sh started.
pkill -f llama-server; pkill -f whisper-server; pkill -f stt-bridge.py; pkill -f "http.server 8080"; pkill -f "serve.py 8080"; echo stopped
