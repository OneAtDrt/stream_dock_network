#!/usr/bin/env bash
# Installs (or updates) the Network plugin into Mirabox Stream Dock and restarts Stream Dock.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/com.oneatdrt.network.sdPlugin"
DEST="$HOME/Library/Application Support/HotSpot/StreamDock/plugins/com.oneatdrt.network.sdPlugin"

(cd "$SRC/plugin" && npm install --omit=dev --silent)
mkdir -p "$DEST"
rsync -a --delete --exclude 'log/' --exclude '.omc/' --exclude '*.test.js' "$SRC/" "$DEST/"
echo "Installed to $DEST"

if pgrep -x StreamDock >/dev/null; then
  osascript -e 'quit app "StreamDock"' || pkill -x StreamDock || true
  while pgrep -x StreamDock >/dev/null; do sleep 0.5; done
fi
open -a StreamDock
echo "Stream Dock restarted. Actions are in the 'Network' category: 'Network' (knob: turn to cycle pages), 'Network Status', 'Ping' and 'Speed'."
