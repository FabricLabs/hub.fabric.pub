#!/bin/sh
# Fabric Hub — start at login (Bitcoin, Fabric peer, Lightning).
# Packaged: resources/startup/linux/  (binary is ../../../FabricHub for unpacked dir).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -n "${APPIMAGE:-}" ] && [ -x "$APPIMAGE" ]; then
  exec "$APPIMAGE" --hidden "$@"
fi
if [ -x "$DIR/../../../FabricHub" ]; then
  exec "$DIR/../../../FabricHub" --hidden "$@"
fi
if command -v FabricHub >/dev/null 2>&1; then
  exec FabricHub --hidden "$@"
fi
echo "Fabric Hub executable not found. Install the .deb or AppImage, or use tray: Run at startup." >&2
exit 1
