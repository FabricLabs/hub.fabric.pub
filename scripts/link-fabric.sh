#!/usr/bin/env bash
# Link local @fabric/core and @fabric/http into this repo (Electron/desktop and node hub).
# Defaults match a typical layout: ~/fabric-clean and ~/fabric-http.
#
# Usage:
#   npm run link:fabric
#   FABRIC_CORE=/path/to/core FABRIC_HTTP=/path/to/http npm run link:fabric

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="${FABRIC_CORE:-$HOME/fabric-clean}"
HTTP="${FABRIC_HTTP:-$HOME/fabric-http}"

for d in "$CORE" "$HTTP"; do
  if [[ ! -d "$d" ]]; then
    echo "[link-fabric] ERROR: directory not found: $d" >&2
    echo "[link-fabric] Set FABRIC_CORE and FABRIC_HTTP, or clone to ~/fabric-clean and ~/fabric-http" >&2
    exit 1
  fi
  if [[ ! -f "$d/package.json" ]]; then
    echo "[link-fabric] ERROR: not an npm package (no package.json): $d" >&2
    exit 1
  fi
done

echo "[link-fabric] Global link from: $CORE"
(cd "$CORE" && npm install && npm link)

echo "[link-fabric] Global link from: $HTTP"
(cd "$HTTP" && npm install && npm link)

echo "[link-fabric] Wiring into: $ROOT"
cd "$ROOT"
npm link @fabric/core @fabric/http

# Linking replaces node_modules/@fabric/http (and its hoisted deps). Install direct hub imports explicitly.
if ! node -e "require('isomorphic-ws'); require('ws');" 2>/dev/null; then
  echo "[link-fabric] Restoring peeled deps (isomorphic-ws, ws)…"
  npm install --no-audit --no-fund isomorphic-ws@=4.0.1 ws@=8.18.0
fi

echo "[link-fabric] UI theme: \`npm run build:semantic\` / \`npm run make:fonts\` in this repo delegate to the linked @fabric/http package."
echo "[link-fabric] Note: a bare \`npm install\` may replace links; re-run this script after."
