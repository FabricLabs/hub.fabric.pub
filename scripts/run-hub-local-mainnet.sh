#!/usr/bin/env bash
# Run Hub against a local mainnet bitcoind (not Hub-managed). Pruned OK; match rpcuser/rpcpassword in bitcoin.conf.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env.local-mainnet" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/.env.local-mainnet"
  set +a
fi

export FABRIC_BITCOIN_NETWORK=mainnet
export FABRIC_BITCOIN_MANAGED=false
export FABRIC_BITCOIN_HOST="${FABRIC_BITCOIN_HOST:-127.0.0.1}"
export FABRIC_BITCOIN_RPC_PORT="${FABRIC_BITCOIN_RPC_PORT:-8332}"

if [[ -z "${BITCOIN_RPC_USER:-${FABRIC_BITCOIN_USERNAME:-}}" ]] || [[ -z "${BITCOIN_RPC_PASS:-${FABRIC_BITCOIN_PASSWORD:-}}" ]]; then
  echo "[run-hub-local-mainnet] Set BITCOIN_RPC_USER and BITCOIN_RPC_PASS (or FABRIC_BITCOIN_USERNAME / FABRIC_BITCOIN_PASSWORD)." >&2
  echo "  Copy .env.local-mainnet.example to .env.local-mainnet and edit, or export the variables in your shell." >&2
  exit 1
fi

exec node scripts/hub.js
