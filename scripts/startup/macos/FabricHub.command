#!/bin/sh
# Fabric Hub — start at login (Bitcoin, Fabric peer, Lightning).
# Packaged layout: Fabric Hub.app/Contents/Resources/startup/macos/
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$DIR/../../../MacOS/FabricHub"
if [ -x "$BIN" ]; then
  exec "$BIN" --hidden "$@"
fi
if [ -x "$DIR/FabricHub" ]; then
  exec "$DIR/FabricHub" --hidden "$@"
fi
open -a "Fabric Hub" --args --hidden "$@"
