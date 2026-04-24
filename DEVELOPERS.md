# `hub.fabric.pub` Developers
The `hub.fabric.pub` project is a simple HTTP relay for the Fabric network.

## What This Project Is
`hub.fabric.pub` is a Fabric peer hub and browser-facing operator console.  It is not only an HTTP relay: it is a stateful service that combines Fabric networking, WebSocket RPC, document resources, Bitcoin regtest operations, and optional Payjoin workflows.

## Current Priorities
The most recent development focus is:
- robust local managed runtime behavior
- Bitcoin/Lightning observability in the UI
- Payjoin (BIP77) lifecycle integration and validation

## Key Files to Know First
- `services/hub.js`: central orchestrator and route/RPC registration
- `services/payjoin.js`: Payjoin service with deterministic IDs and merkle metadata
- `components/BitcoinHome.js`: service health + Bitcoin/Lightning/Payjoin operator UX
- `functions/bitcoinClient.js`: browser API client helpers and endpoint normalization
- `scripts/verify-payjoin-e2e.js`: two-context browser e2e for deposit/proposal flow

## Development Setup
```bash
npm install
npm start
```

`npm start` runs a build then starts the hub.

**Linking `@fabric/core` and `@fabric/http`:** To develop against local Fabric packages (e.g. Bitcoin service `bitcoinExtraParams`, HTTP server changes):

```bash
# From the fabric repo (e.g. ~/fabric)
cd /path/to/fabric && npm link

# From the fabric-http repo if you have it locally
cd /path/to/fabric-http && npm link

# From this repo
cd /path/to/hub.fabric.pub
npm link @fabric/core
npm link @fabric/http
```

To restore published packages: `npm install` (overwrites the symlinks with the versions from package.json).

**Major release / downstream (sensemaker, etc.):** See **[docs/UPSTREAM_MONOREPO.md](docs/UPSTREAM_MONOREPO.md)** and **[docs/SENSEMAKER_UPSTREAM.md](docs/SENSEMAKER_UPSTREAM.md)** for what to align across Hub, `@fabric/http`, and `@fabric/core` before bumping downstream apps.

The Hub passes `bitcoinExtraParams: ['-dnsseed=0']` and `listen: false` for managed regtest so bitcoind avoids DNS in restricted environments. For active UI iteration:
```bash
npm run dev
```

## Testing and Validation
```bash
npm test
npm run test:e2e-webrtc
npm run test:e2e-payjoin
npm run build
```

When debugging runtime health, always check:
- `GET /services/bitcoin`
- `GET /services/lightning`
- `GET /services/payjoin` (legacy `GET /services/bitcoin/payjoin`)

### Client vs bridge (UI labels)
The Bitcoin and Payments UIs label what is **client-side** (identity, xpub, derivation) vs **bridge** (Hub node: balance, UTXOs, transactions, payment execution). Send Payment and Lightning create/decode/pay are executed by the bridge.

### Lightning stub (L2 UI testing)
To enable a stub Lightning backend so the L2 buttons work without a real node: `FABRIC_LIGHTNING_STUB=1 npm start`. The Hub then returns `available: true`, `status: 'STUB'`, and stub responses for create invoice, decode, and pay.

### Faucet (regtest)
The **Faucet** on the Bitcoin page sends sats from the Beacon/Hub wallet to a given address. Regtest only; max 1,000,000 sats per request. Requires the Hub wallet to have balance (e.g. from Generate Block or Beacon epochs). `POST /services/bitcoin/faucet` with body `{ address, amountSats? }`.

## Recent Changes (Contributor Context)

### 1) Payjoin Service Added
- New `services/payjoin.js`
- Stores session/proposal state under `payjoin/` in filesystem
- Uses `Actor` IDs and `Tree` merkle summaries for deterministic metadata
- Exposed over HTTP + JSON-RPC through `services/hub.js`

### 2) Bitcoin UI Reliability Improvements
- `BitcoinHome` now shows service health status for Bitcoin and Lightning
- Explorer lists can fall back to `GetBitcoinStatus` block/tx summaries
- Regtest block generation controls are disabled unless service/network status allows it

### 3) E2E Browser Test Coverage
- Added `scripts/verify-payjoin-e2e.js`
- Added npm script: `test:e2e-payjoin`
- Demonstrates create-deposit (tab A) + submit-proposal (tab B) + status verification

## Operational Notes

### Single Instance Rule
Run one hub at a time per port set (`7777`, `8080`) to avoid `EADDRINUSE`.

### Port 7777 already in use
If you see `listen EADDRINUSE: address already in use 0.0.0.0:7777`, another process (often a previous Hub) is holding the P2P port. Find and stop it:

```bash
# See what is using port 7777
lsof -iTCP:7777 -sTCP:LISTEN

# Stop that process (use the PID from the second column)
kill <PID>
```

To run the Hub on a different P2P port: `FABRIC_PORT=7778 npm start`. (Peers in config may still expect `7777` unless you change them.)

### Managed Bitcoin Regtest
Local defaults assume managed regtest bitcoind on RPC `20444`. The Hub starts the Bitcoin service (which may spawn `bitcoind` via `@fabric/core`) and waits for it to become ready (or for the timeout, default 15s). If Bitcoin does not become ready in time, the Hub continues without Bitcoin and logs a warning. Set `FABRIC_BITCOIN_START_TIMEOUT_MS` to change the timeout (min 3s, max 60s). On shutdown, the Hub calls `bitcoin.stop()`; ensure no other bitcoind is using the same datadir or port before starting. For production, use an external bitcoind cluster and set `FABRIC_BITCOIN_MANAGED=false`.

## Coding Standards
- CommonJS only
- keep route handlers explicit with clear status payloads
- avoid silent failures on service startup paths; log actionable messages
- keep contributor docs updated with architectural changes in the same PR
