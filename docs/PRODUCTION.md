# Production deployment
Operator checklist for running **hub.fabric.pub** beyond local development—suitable for a public or team-facing Hub.

**Federation promotion (regtest → signet → mainnet, `fabric setup` identity):** [FEDERATION_DEPLOYMENT.md](FEDERATION_DEPLOYMENT.md).

## Playnet contracts (hub.fabric.pub + relay.goon.vc)

After this Hub is running on **hub.fabric.pub** with a Fabric Peer and Beacon:

1. **Hub registry (`fabric-beacon`)** — `_ensureBeaconNativeContract` publishes and Accepts the native Beacon ARC on Beacon start when validators (or the Hub identity key) exist. Disable only with `settings.beacon.publishNativeContract = false`. Confirm with:
   ```bash
   npm run playnet:status -- --production
   ```
   Look for `fabric-beacon registry` / `beaconContractId` and an accepted tracked contract of that id.
2. **GoonCitizen application contract** — from the GoonCitizen tree, with `FABRIC_XPRV` (same operator key) and `FABRIC_HUB_ADMIN_TOKEN`:
   ```bash
   npm run playnet:deploy-gooncitizen -- --production --accept
   ```
   That gossips `CONTRACT_PUBLISH` to `hub.fabric.pub:7777` and `relay.goon.vc:7777`, then Accepts the namespace on Hub (ADR-001 sidechain at `/namespaces/<id>`).

Env still overrides (`FABRIC_HUB_RPC_URL`, `FABRIC_PLAYNET_PEERS`). Do not commit admin tokens.

## Pre-flight
| Step | Command / action |
|------|-------------------|
| Node | Use **Node 24.15.x** (see `package.json` `engines`). |
| Install | `npm ci` (CI) or `npm install`. |
| Build + tests | `npm run ci` — builds the browser bundle and runs unit tests. |
| Browser E2E (optional) | `npm run test:e2e-browser` after Chrome install (`npx puppeteer browsers install chrome`). |
| Payjoin E2E (optional) | `npm run ci:e2e-payjoin` — isolated `FABRIC_HUB_USER_DATA`, starts Hub, runs `verify-payjoin-e2e.js` (session/proposal, Bitcoin off). L1 fund path: `npm run test:e2e-payjoin-l1`. |
| Crowdfund L1 test (optional) | `npm run test:crowdfund-regtest` (managed regtest, integration path). |
| Document exchange L1 test (optional) | `npm run test:e2e-inventory-htlc` (two-hub inventory HTLC), `npm run test:e2e-document-purchase` (same-hub invoice), and `npm run test:e2e-storage-contract`. |
| Core features gossip + L1 (optional) | `npm run test:e2e-core-features-l1` — three-hub mesh: Beacon registry, accepted application contract + internal messages, hallmark OP_RETURN, full document-market HTLC. |

## Heap / retainer telemetry
Hub logs a single parseable line **`[HUB:HEAP] {…}`** on start and every Beacon-aligned interval (default **10 min**, floor **60 s**). Payload includes `process.memoryUsage` (`rss`, `heapUsed`, **`external`**, **`arrayBuffers`**), V8 heap stats, in-memory retainer sizes (`documentsPublished`, fabric/activity maps, peers, last `STATE` write bytes), and **`noiseHandshakeListeners`** (`write` / `read` / `split` on the shared WASM bus) via `Peer#countNoiseHandshakeListeners` (**`null`** when the installed Peer omits the method). **Log-only** — durable `messages/`, documents, and STATE are not truncated, so full replay stays intact. Disable with **`FABRIC_HUB_HEAP_TELEMETRY=0`**; override cadence with **`FABRIC_HUB_HEAP_TELEMETRY_MS`**. Agents scrape PM2 stdout (pair with `pm2-logrotate`). After 2026-08-20T10:39Z (`6bf825d`): named retainers still **flat**; RSS **~1.7 GiB** tracked **`external`/`arrayBuffers` (~984 MiB)** not heap (~82 MiB); MaxListeners 65>64 on the current PID; `noiseHandshakeListeners` stayed **null** on live core **`f63a33f`**. Treat `noiseHandshakeListeners` ≫ `3 × peerConnections` as a leak once the field is non-null.

## Hub UI feature flags (browser + disk restore)
The SPA caches flags in **`localStorage`** key **`fabric.hub.uiFeatureFlags`** and hydrates from Hub setting **`HUB_UI_FEATURE_FLAGS`** on startup. With an admin token present, feature toggles on `/settings/admin` are persisted in `stores/hub/STATE` `.settings` and restored after hub restart. Keys include **`peers`**, **`sidechain`**, **`bitcoinPayments`**, **`bitcoinLightning`**, **`bitcoinCrowdfund`**, and **`bitcoin: true`** to enable all Bitcoin-related flags at once. Implementation: [`functions/hubUiFeatureFlags.js`](../functions/hubUiFeatureFlags.js). **Peers** in the top nav stays gated on the Hub **admin token** (browser `localStorage`).

Defaults are conservative; operators often enable **`bitcoin`** and **`sidechain`** for a full operator UI. See the JSON example in [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md#feature-flags-production).

## Security
- **Identity:** Set `FABRIC_SEED` / `FABRIC_MNEMONIC` in production so the Hub identity is stable and backed up. Never commit seeds or paste them into tickets.
- **Admin token:** Issued at first-time setup; stored in the **browser only**. Operators refresh via `POST /settings/refresh`. Treat like a high-privilege API key.
- **Network:** Put the HTTP surface behind **TLS** (reverse proxy: nginx, Caddy, Traefik). Production HTTP should bind **loopback** (`FABRIC_HUB_INTERFACE=127.0.0.1` or `HTTP_SHARED_MODE=false`) so only the proxy is public. The constructor default remains `0.0.0.0` for LAN/playnet; Electron desktop already forces `127.0.0.1`. P2P (`FABRIC_PORT`) is a separate bind.
- **Bitcoin RPC:** For non-regtest, use **cookie or restricted RPC** on a trusted network; do not expose `bitcoind` RPC to the open internet.
- **State on disk:** `stores/hub/` holds LevelDB, documents, message log, and optional regtest chain data. **Back up** this directory for production nodes; **do not** publish backups publicly.

## Environment reference
| Variable | Role |
|----------|------|
| `FABRIC_SEED` / `FABRIC_MNEMONIC` | 24-word seed for Hub identity |
| `FABRIC_PORT` | Fabric P2P listen (default `7777`); must be a **number** so the Peer binds correctly. On the shared `meta.fabric.pub` host, **7777** is Hub + `relay.goon.vc`; other apps use **7778+**. |
| `FABRIC_HUB_PORT` / `PORT` | HTTP/WebSocket (default `8080`) |
| `FABRIC_HUB_HOSTNAME` / `HOSTNAME` | Advertised hostname where applicable |
| `FABRIC_HUB_INTERFACE` / `INTERFACE` | HTTP bind. Constructor default `0.0.0.0`. Production behind a proxy: `127.0.0.1`. |
| `FABRIC_HUB_SEEDS` | Comma-separated Hub HTTP origins baked into the browser bundle (also `window.FABRIC_HUB_SEEDS`). CDN HTML clients OPTIONS each origin, use the first reachable Hub for WebRTC signaling, probe `/services/peering`, and list Documents from inventories. |
| `FABRIC_FEDERATION_INTERNAL_KEY_MODE` | Federation Taproot internal key: default **`nums`** (historical vault). `musig2` is a **new address** vs pre-#185 NUMS UTXOs — sweep before switching. |

See [README.md](../README.md) and [BITCOIN_NETWORKS.md](../BITCOIN_NETWORKS.md) for Bitcoin network ports and managed regtest notes.

## Process supervision
- Run `node scripts/hub.js` (or `npm run start:fast` after `npm run build`) under **systemd**, **supervisor**, or a container restart policy.
- Ensure a **single** Hub instance per port set; `EADDRINUSE` means another process holds the port.
- **Managed regtest + `pm2`:** if Hub Node OOMs, Core can be reparented to PID 1 and hold `stores/bitcoin-regtest`. This tree **attaches** via cookie RPC instead of spawning another `bitcoind` onto the lock. Ops: `pm2 stop hub`, confirm the lock holder is Hub’s datadir (not Sensemaker’s), then `pm2 start hub`.
- **PM2 logs (P0):** install **`pm2-logrotate`** (`pm2 install pm2-logrotate`). Playnet `~/.pm2/logs` has grown to tens of GiB (`hub-error` / `hub-out`) with no rotation. Truncate once, then rotate. Do **not** raise `--max-old-space-size` as the OOM fix.
- **Node:** Hub PM2 should be **24.15.x** (same as RSI / `package.json` `engines`), not 24.5.x.
- **Fabric `peers`:** do not seed **`sensemaker.io:7778`** (or `:7777`) when Sensemaker already listens on this host (`:7778`). Point at the **local** address or drop the row — remote DNS timeouts stall every boot.
- **Lightning:** managed `lightningd` is **opt-in** (`lightning.managed: true` or `lightning.enable: true`). First-time setup downloads official Linux x86_64 CLN into `binaries/`, or uses Homebrew on macOS. PATH and `binaries/` both count. Datadir-only settings from `scripts/hub.js` must not spawn CLN. Stub: `FABRIC_LIGHTNING_STUB=1`.

## Protocol surfaces (for integrators)
- **WebSocket JSON-RPC** — peer, document, chat, Bitcoin, Payjoin, inventory HTLC (`ConfirmInventoryHtlcPayment`, etc.).
- **HTTP** — static UI, Bitcoin REST helpers, settings bootstrap. Serving `assets/` from a bare HTTP/CDN host (no `scripts/hub.js`) is HTML-only: the SPA probes `GET /settings` and hides operator surfaces until that response is Hub JSON. Set **`FABRIC_HUB_SEEDS`** (comma-separated HTTPS origins, also `window.FABRIC_HUB_SEEDS` in `assets/config.local.js`) so the client can OPTIONS those Hubs, use one as WebRTC signaling, and list Documents from peer inventories. HTTPS pages cannot reach `http://` seeds (mixed content). **`/downloads`** is static + SPA: `index.json` and installer files from `assets/downloads/` (generated at build; blobs gitignored).
- **Document purchase binding** — `CreatePurchaseInvoice` / `ClaimPurchase` and inventory HTLC use **`@fabric/core/functions/publishedDocumentEnvelope`**. Hub [`functions/publishedDocumentEnvelope.js`](../functions/publishedDocumentEnvelope.js) loads **sibling** `../fabric/...` when present, else the installed **`@fabric/core`** package (declared in `package.json`).
- **Operator visibility** — Admin page (`/settings/admin`) includes worker queue controls and a node wealth panel (wallet balance + labeled Payjoin/HTLC/storage flow counters/totals from `GetNodeWealthSummary`).
- **Contract proposals (PSBT + batched messages)** — `ContractProposal` AMP type, Merkle chain, and RFC 6902 state patches are defined in **`@fabric/core`** (`docs/CONTRACT_PROPOSAL.md`). Hub helpers: [`functions/psbtFabric.js`](../functions/psbtFabric.js), [`functions/contractProposalExchange.js`](../functions/contractProposalExchange.js).

## Marketing-facing summary
Short positioning copy lives in [MARKETING_OVERVIEW.md](MARKETING_OVERVIEW.md). Protocol narrative: [PAYMENTS_PROTOCOL.md](../PAYMENTS_PROTOCOL.md), [INVENTORY_HTLC_ONCHAIN.md](../INVENTORY_HTLC_ONCHAIN.md).

## Coordinated RC (three repos)
| Repository | Release gate |
|------------|----------------|
| [fabric](https://github.com/FabricLabs/fabric) | `npm run ci` |
| [fabric-http](https://github.com/FabricLabs/fabric-http) | `npm run ci` |
| **hub.fabric.pub** (this) | `npm run ci` |

Tag checklist: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). Changelog: [CHANGELOG.md](../CHANGELOG.md). Roadmap: [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md).

## CI recommendation
```bash
npm run ci
```

Use this in GitHub Actions / GitLab CI before tagging releases.

## Fabric protocol: sessions and WebRTC
Browser clients use **Hub JSON-RPC** for WebRTC signaling (`RegisterWebRTCPeer`, `SendWebRTCSignal`, …). That path is **not** the same as TCP **`P2P_SESSION_OFFER` / `P2P_SESSION_OPEN`** in **`@fabric/core`**, but the **early phases** map cleanly for docs and support. Canonical comparison: [`@fabric/core` **docs/SESSION_AND_WEBRTC.md**](https://github.com/FabricLabs/fabric/blob/develop/docs/SESSION_AND_WEBRTC.md) (adjust branch when pinning releases).
