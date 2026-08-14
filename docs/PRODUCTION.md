# Production deployment
Operator checklist for running **hub.fabric.pub** beyond local development—suitable for a public or team-facing Hub.

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
| Payjoin E2E (optional) | `npm run ci:e2e-payjoin` — isolated `FABRIC_HUB_USER_DATA`, starts Hub, runs `verify-payjoin-e2e.js`. |
| Crowdfund L1 test (optional) | `npm run test:crowdfund-regtest` (managed regtest, integration path). |
| Document exchange L1 test (optional) | `npm run test:e2e-document-purchase` and `npm run test:e2e-storage-contract`. |

## Hub UI feature flags (browser + disk restore)
The SPA caches flags in **`localStorage`** key **`fabric.hub.uiFeatureFlags`** and hydrates from Hub setting **`HUB_UI_FEATURE_FLAGS`** on startup. With an admin token present, feature toggles on `/settings/admin` are persisted to `stores/hub/settings.json` and restored after hub restart. Keys include **`peers`**, **`sidechain`**, **`bitcoinPayments`**, **`bitcoinLightning`**, **`bitcoinCrowdfund`**, and **`bitcoin: true`** to enable all Bitcoin-related flags at once. Implementation: [`functions/hubUiFeatureFlags.js`](../functions/hubUiFeatureFlags.js). **Peers** in the top nav stays gated on the Hub **admin token** (browser `localStorage`).

Defaults are conservative; operators often enable **`bitcoin`** and **`sidechain`** for a full operator UI. See the JSON example in [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md#feature-flags-production).

## Security
- **Identity:** Set `FABRIC_SEED` / `FABRIC_MNEMONIC` in production so the Hub identity is stable and backed up. Never commit seeds or paste them into tickets.
- **Admin token:** Issued at first-time setup; stored in the **browser only**. Operators refresh via `POST /settings/refresh`. Treat like a high-privilege API key.
- **Network:** Put the HTTP surface behind **TLS** (reverse proxy: nginx, Caddy, Traefik). Bind P2P (`FABRIC_PORT`) and HTTP (`FABRIC_HUB_PORT` / `PORT`) intentionally; use `FABRIC_HUB_INTERFACE` / `INTERFACE` if you must restrict bind addresses.
- **Bitcoin RPC:** For non-regtest, use **cookie or restricted RPC** on a trusted network; do not expose `bitcoind` RPC to the open internet.
- **State on disk:** `stores/hub/` holds LevelDB, documents, message log, and optional regtest chain data. **Back up** this directory for production nodes; **do not** publish backups publicly.

## Environment reference
| Variable | Role |
|----------|------|
| `FABRIC_SEED` / `FABRIC_MNEMONIC` | 24-word seed for Hub identity |
| `FABRIC_PORT` | Fabric P2P listen (default `7777`); must be a **number** so the Peer binds correctly. On the shared `meta.fabric.pub` host, **7777** is Hub + `relay.goon.vc`; other apps use **7778+**. |
| `FABRIC_HUB_PORT` / `PORT` | HTTP/WebSocket (default `8080`) |
| `FABRIC_HUB_HOSTNAME` / `HOSTNAME` | Advertised hostname where applicable |
| `FABRIC_HUB_INTERFACE` / `INTERFACE` | Bind address (default `0.0.0.0`) |
| `FABRIC_BITCOIN_ENABLE` | Set to `false` to skip the Bitcoin service (Hub starts without `bitcoind`; used for headless E2E) |

See [README.md](../README.md) and [BITCOIN_NETWORKS.md](../BITCOIN_NETWORKS.md) for Bitcoin network ports and managed regtest notes.

## Process supervision
- Run `node scripts/hub.js` (or `npm run start:fast` after `npm run build`) under **systemd**, **supervisor**, or a container restart policy.
- Ensure a **single** Hub instance per port set; `EADDRINUSE` means another process holds the port.
- **Managed regtest + `pm2`:** if Hub Node OOMs, Core can be reparented to PID 1 and hold `stores/bitcoin-regtest`. This tree **attaches** via cookie RPC instead of spawning another `bitcoind` onto the lock. Ops: `pm2 stop hub`, confirm the lock holder is Hub’s datadir (not Sensemaker’s), then `pm2 start hub`. Rotate oversized `~/.pm2/logs/hub-*.log`. Do not raise `--max-old-space-size` as the only OOM fix.

## Protocol surfaces (for integrators)
- **WebSocket JSON-RPC** — peer, document, chat, Bitcoin, Payjoin, inventory HTLC (`ConfirmInventoryHtlcPayment`, etc.).
- **HTTP** — static UI, Bitcoin REST helpers, settings bootstrap.
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
