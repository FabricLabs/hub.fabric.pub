#!/usr/bin/env bash
# Start the Hub on 18080 (no managed bitcoind), wait for HTTP, run verify-payjoin-e2e.js, then stop the Hub.
# Uses an isolated FABRIC_HUB_USER_DATA so local stores/hub/settings.json cannot force managed bitcoind.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
E2E_HOME="$(mktemp -d)"
export FABRIC_HUB_USER_DATA="$E2E_HOME"
mkdir -p "$E2E_HOME/stores/hub"
export FABRIC_BITCOIN_ENABLE=false
export FABRIC_BITCOIN_MANAGED=false
export FABRIC_LIGHTNING_STUB=true
export FABRIC_PORT="${FABRIC_PORT:-17777}"
export FABRIC_HUB_PORT=18080
export PORT=18080

node scripts/hub.js &
PID=$!
cleanup () {
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -rf "$E2E_HOME" 2>/dev/null || true
}
trap cleanup EXIT

echo "[ci-e2e-payjoin] waiting for Hub on 18080..."
for _ in $(seq 1 90); do
  if curl -sf -H "Accept: application/json" "http://127.0.0.1:18080/settings" >/dev/null 2>&1; then
    echo "[ci-e2e-payjoin] Hub ready"
    HUB_URL=http://127.0.0.1:18080/ npm run test:e2e-payjoin
    exit 0
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "[ci-e2e-payjoin] Hub process exited early" >&2
    exit 1
  fi
  sleep 1
done
echo "[ci-e2e-payjoin] timeout waiting for Hub" >&2
exit 1
