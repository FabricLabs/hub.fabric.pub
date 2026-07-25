# hub.fabric.pub — Agent Guidelines

## Project Overview
`hub.fabric.pub` is the Fabric rendezvous hub and browser gateway. It runs a Fabric peer node, exposes HTTP/WebSocket APIs, and serves a React UI for operators.

Primary responsibilities:
- peer discovery and connection brokerage
- websocket JSON-RPC bridge for browser clients
- WebRTC coordination for browser peer mesh
- document storage/publication and activity relay
- Bitcoin regtest operations and debugging surfaces
- optional Payjoin (BIP77) deposit negotiation flow

**Distributed execution (design):** multi-operator contracts, **Federation**-signed epochs, **Beacon**, delegation-style signing prompts, and Bitcoin anchoring are described in **[docs/DISTRIBUTED_CONTRACT_EXECUTION.md](docs/DISTRIBUTED_CONTRACT_EXECUTION.md)**. **Code map** (sidechain scan, execution contracts, Fabric `SidechainGenesis` example test, playnet scripts): **[docs/SIDECHAIN_AND_EXECUTION_INDEX.md](docs/SIDECHAIN_AND_EXECUTION_INDEX.md)**.

## Recent Work (Important)
Recent architecture work concentrated on Bitcoin and Payjoin:

- Added modular `services/payjoin.js` using Fabric types:
  - `Actor` for deterministic IDs
  - `Tree` for merkle roots over sessions/proposals/events
  - `Filesystem` persistence under `payjoin/`
- Wired Payjoin throughout Hub:
  - HTTP under **`/services/payjoin`** (mirrors: **`/payments/payjoin`**, legacy **`/services/bitcoin/payjoin`**): **GET** `/` (capabilities), **GET|POST** `/sessions` (list | create deposit session), **GET** `/sessions/:id`, **POST** `/sessions/:id/proposals` (submit proposal); BIP77 `proposalURL` uses the plural proposals path and the hub **`payjoin.endpointBasePath`** default **`/services/payjoin`**.
  - JSON-RPC methods (`GetPayjoinStatus`, `CreatePayjoinDeposit`, etc.)
  - session/proposal lifecycle persisted to disk
- Added browser E2E coverage for Payjoin:
  - `scripts/verify-payjoin-e2e.js`
  - `npm run test:e2e-payjoin`
- Improved Bitcoin UI reliability:
  - service health panel in `components/BitcoinHome.js`
  - block list fallback to `/services/bitcoin` status payload when explorer path is stale
  - block generation action validation for regtest-only
- Operational decision:
  - regtest follows one autonomous path in local settings (`managed: true`, RPC `20444`)
- **Block generation and Hub wallet:**
  - The "Generate Block" button and `generateblock` RPC always use the **Hub's wallet** (`bitcoin.getUnusedAddress()`). Client-supplied addresses are ignored so that all regtest block rewards go to the Hub node.
  - **Admin token required:** The Generate Block button is hidden unless the client has the admin token (from first-time setup). `POST /services/bitcoin/blocks` and the `generateblock` RPC both require `Authorization: Bearer <admin-token>` (HTTP) or `params.adminToken` (RPC).
  - **Hub wallet spend (`sendpayment` RPC / POST `/services/bitcoin` method `sendpayment`):** requires `params.adminToken` (same token). Used for optional **Pay from Bridge** (inventory HTLC funding from the hub bitcoind wallet). Per-identity payments use `POST /services/bitcoin/payments` instead.
  - The **Beacon** (interval block generation) uses the same Hub wallet and tracks a **core balance** (wallet balance in BTC and sats) after each epoch; this is stored in `services.bitcoin.beacon` and included in the Bitcoin status response and UI.
- **Beacon epoch chain (Fabric store):**
 - The Beacon uses the Hub's **Filesystem** to manage a Fabric store for epochs at `beacon/CHAIN`.
 - The chain is a list of **Fabric messages** of type `BEACON_EPOCH`; each message payload is the epoch object (clock, blockHash, height, balance, balanceSats, timestamp, **`contracts`** `{ clock, stateDigest }` = state root of operator-accepted tracked application contracts from `CONTRACT_PUBLISH`, optional **sidechain** `{ clock, stateDigest }`). On start the Beacon loads this chain and restores clock/state from the last message; on each epoch it appends a new message and persists via `fs.publish('beacon/CHAIN', { messages })`.
- **Tracked application contracts:** inbound `CONTRACT_PUBLISH` → pending queue (`application-contracts/STATE`); operator **Accept** via `AcceptTrackedApplicationContract` (admin token) includes the namespace in the Beacon contracts root **and** provisions a contract sidechain document at `sidechains/<contractId>/` with parent seal at `/namespaces/<contractId>` ([ADR-001](docs/ADR-001-CONTRACT_NAMESPACE_SIDECHAINS.md)). UI: Beacon Federation page. Chat ingest normalizes Hub classic (`object.content`) and GoonCitizen (`object.body` / channel / handle) via `functions/fabricChatNormalize.js`.
- **Sidechain global state:** logical document at `sidechain/STATE`, updated via JSON Patch (`SubmitSidechainStatePatch` / HTTP `/services/distributed/sidechain`); per-epoch full snapshots at `sidechain/SNAPSHOTS` plus append-only `sidechain/JOURNAL`; L1 reorg and startup share `resolveStateForBeaconTip` (core `@fabric/core/functions/sidechainState`). Manifest may include `sidechainPolicy` path rules. Application namespaces reuse the same sidechain document helpers. Beacon Federation threshold rounds: `FederationSignRequest` + `SubmitBeaconEpochSignature`.
- **BitcoinBlock (Fabric P2P + message log):**
  - On each new local chain tip (ZMQ `hashblock`), the Hub appends a `BitcoinBlock` entry to the hub message log, calls `beacon.recordEpochFromBlock` when the Beacon is running (regtest: dedupes against the same tip already recorded by the interval `createEpoch`), and gossips a signed wire `Message` of type `BitcoinBlock` to Fabric peers via `agent.relayFrom('_hub', …)`. `@fabric/core` `Peer` relays `BitcoinBlock` to other TCP peers.
  - **L1 block/tx → Fabric documents (document market):** When `bitcoin.documentBlocks` is on (default), each tip triggers `getblock` … 2 and persists a published **block summary** document (`functions/bitcoinBlockDocument.js`, MIME `application/x-fabric-bitcoin-block+json`). Optional **per-transaction** documents when `documentTransactions` / **`FABRIC_BITCOIN_DOCUMENT_TX=1`** (`functions/bitcoinTransactionDocument.js`, MIME `application/x-fabric-bitcoin-transaction+json`). Canonical JSON uses **schemaVersion 3** with **only immutable fields** (no chain-tip–mutable RPC noise; tx body is consensus **`hex`** only) so **`DocumentPublish`** / inventory HTLC preimages stay stable. Listed prices: **`documentInventoryBlockPriceSats`** / **`documentInventoryTransactionPriceSats`** (env **`FABRIC_BITCOIN_DOC_BLOCK_PRICE_SATS`**, **`FABRIC_BITCOIN_DOC_TX_PRICE_SATS`**; `≤0` omits `purchasePriceSats`). **Pruned** `bitcoind`: hub **unpublishes** and deletes local index files for heights **below `pruneheight`** (no Fabric `Tombstone`); **`bitcoinPruned`** / **`bitcoinPruneHeight`** on Bitcoin status; **`BitcoinBlock`** / Beacon remain the shared tip story. See [PAYMENTS_PROTOCOL.md](PAYMENTS_PROTOCOL.md) phase **I**, [docs/PRODUCTION_ROADMAP.md](docs/PRODUCTION_ROADMAP.md) Progress log.
  - **Body-hash mismatch:** If a peer sends a wire message whose body double-SHA256 does not match the header `hash` field, `Peer` **drops** the message and emits a warning (see **`fabric/docs/MESSAGE_SECURITY.md`** in the Fabric repo).
- **AMP message fields (`@fabric/core`):** `hash` = double-SHA256(body); `preimage` = single SHA256(body) for default non-sensitive messages, or zeroed when `sensitive: true`, or an explicit HTLC/custom 32-byte value — see **`fabric/docs/MESSAGE_SECURITY.md`**.

## Architecture
### Hub types (`types/`)
- **`lightningChannel.js`** — `LightningChannel` extends `@fabric/core/types/channel` with CLN identifiers (`peerId`, `shortChannelId`, `clnChannelId`, `status`) for Hub Lightning integration. Import: `@fabric/hub/types/LightningChannel`. Unit tests: `tests/fabric.lightningChannel.test.js`. Full-stack Lightning tests with `lightningd` live in the **`fabric`** repo under `tests/lightning/` (not run from hub by default).

### Core Services (`services/`)
- `hub.js`: primary service orchestrator (peer, http, bitcoin, payjoin, filesystem, chain)
- `payjoin.js`: BIP77 session/proposal service
- `fabric.js`: remote Fabric synchronization wrapper
- Identity uses **secp256k1** (ECC) via `@fabric/core` Key/Identity — BIP32/BIP39, xprv/xpub. No RSA.

### UI (`components/`)
- `Bridge.js`: websocket + webrtc client bridge
- `HubInterface.js`: route shell and top-level composition
- `BitcoinHome.js`: Bitcoin/Lightning/Payjoin operations and diagnostics
- `BitcoinPaymentsHome.js`: payment and Payjoin proposal submission workflows
- `PeerList.js`, `DocumentList.js`, `DocumentView.js`, `ActivityStream.js`: operational views

### Entry Points
- **`scripts/hub.js`** — Node.js entry; instantiates Hub with settings and starts the service.
- **`scripts/browser.js`** — Webpack entry for client bundle.
- **`scripts/build.js`** — Build script for browser assets.

### Bitcoin Networks
See [BITCOIN_NETWORKS.md](BITCOIN_NETWORKS.md) for mainnet, testnet, signet, and regtest configuration. Default RPC ports: mainnet 8332, testnet 18332, signet 38332, regtest 18443 (hub managed regtest uses 20444).

### Payment protocols (roadmap)
Fabric-native invoices and settlement are the default product shape. Future **L402**, **x402**, and **MPP** (including Tempo-style routing) are **adapter targets**, not replacements for that core model. See [PAYMENTS_PROTOCOL.md](PAYMENTS_PROTOCOL.md).

## Configuration (`settings/`)
- **`local.js`** — Runtime settings (merges `default.js`). Environment variables:
  - `FABRIC_SEED` / `FABRIC_MNEMONIC` — 24-word seed for persistent identity.
  - `FABRIC_PORT` — P2P listen port (default 7777).
  - `FABRIC_HUB_PORT` / `PORT` — HTTP listen port (default 8080).
  - `FABRIC_HUB_HOSTNAME` / `HOSTNAME` — HTTP hostname.
  - `FABRIC_HUB_INTERFACE` / `INTERFACE` — Bind interface (default 0.0.0.0).
  - `FABRIC_HUB_DEBUG` — Set to `true` or `1` for verbose hub logging (`settings.debug`).
  - `FABRIC_EXPLORER_URL` — Optional HTTP **origin** for `@fabric/core` Bitcoin explorer fallback (e.g. `http://127.0.0.1:8080` when this Hub serves `/services/bitcoin`). Omit for RPC-only block/tx in core; address-index helpers require an explorer.
- **Regtest LAN / playnet chain sync:** automatic **`addnode`** targets merge `settings.bitcoin.p2pAddNodes`, **`FABRIC_BITCOIN_P2P_ADDNODES`**, and (for **regtest** only) default **`hub.fabric.pub:18444`** unless **`FABRIC_BITCOIN_SKIP_PLAYNET_PEER=1`** (override with **`FABRIC_BITCOIN_PLAYNET_PEER`**). Implemented in `@fabric/core` `Bitcoin` after RPC ready; signet/testnet use the same list shape; **mainnet** skips public peers unless `p2pAddNodesAllowMainnet`. Manual: `npm run bitcoin:addnode` (see [BITCOIN_NETWORKS.md](BITCOIN_NETWORKS.md)). Browser `bitcoinClient` uses the local Hub `/services/bitcoin` only.
- **Sidechain signals (playnet):** optional per-block scan via **`FABRIC_SIDECHAIN_SCAN=1`** / `bitcoin.sidechainScan` — OP_RETURN magic + watched addresses; Activity `SidechainScan`. Timelock maturation (e.g. +100 blocks) is policy on top of height + `locktime` hints (`functions/sidechainBlockScan.js`).
- **L1 → document index:** **`FABRIC_BITCOIN_DOCUMENT_BLOCKS=0`** disables block documents; **`FABRIC_BITCOIN_DOCUMENT_TX=1`** enables per-tx documents; **`FABRIC_BITCOIN_DOC_BLOCK_PRICE_SATS`** / **`FABRIC_BITCOIN_DOC_TX_PRICE_SATS`** set default list prices (`0` = omit `purchasePriceSats`).

### Storage
- **`stores/hub/`** — Filesystem-based state persistence (LevelDB for peers, JSON for documents).
- **`stores/hub/settings.json`** — First-time setup settings (NODE_NAME, IS_CONFIGURED, etc.).
- Admin token is **client-only** (never stored on server); verified by Schnorr signature.
- **`assets/`** — Static web assets served by HTTP server.

## First-Time Setup
On first run (no `stores/hub/settings.json` with `IS_CONFIGURED`), the UI shows an Onboarding modal:
1. Operator sets node name and completes setup.
2. Hub creates and signs an admin token (Fabric Token, capability OP_IDENTITY).
3. Token is returned to the first client only; settings in `stores/hub/settings.json`.
4. Admin token authenticates `PUT /settings/:name` (Bearer header).
5. Token is stored in client `localStorage`; client refreshes via `POST /settings/refresh` before expiry (1-year lifetime).

**Settings API** (base path `/settings`): Serves `applicationString` (HTML) when `Accept: text/html`, JSON when `Accept: application/json`.
- `GET /settings` — List all settings; includes `{ configured, needsSetup }` for first-time setup status.
- `POST /settings` — Bootstrap when not configured: creates signed admin token (client-only) and initial config; returns `{ token, configured, expiresAt }`. Returns 403 when already configured.
- `POST /settings/refresh` — Refresh admin token (requires current token in `Authorization: Bearer` or body `{ token }`); returns `{ token, expiresAt }`.
- `GET /settings/:name` — Get a specific setting.
- `PUT /settings/:name` — Update a specific setting (requires `Authorization: Bearer <admin-token>`).

## RPC Methods (via WebSocket)
The Hub registers these methods on `this.http._registerMethod(...)`:

| Method | Purpose |
|--------|---------|
| `GetNetworkStatus` | Returns clock, peers, documents, contract ID, network address, setup status |
| `GetSetupStatus` | Returns { configured, needsSetup } for first-time setup |
| `ListPeers` | Alias for GetNetworkStatus (peer list focus) |
| `AddPeer` | Connect to a Fabric peer by address |
| `RemovePeer` | Disconnect from a peer |
| `GetPeer` | Get detailed info for a peer |
| `SetPeerNickname` | Set local nickname for a peer |
| `SendPeerMessage` | Send chat message to a specific peer |
| `SendPeerFile` | Send a document to a specific peer |
| `ConfirmInventoryHtlcPayment` | After funding a P2TR inventory HTLC: `{ settlementId, txid }` → verifies L1, then phase 2 `P2P_FILE_SEND` to buyer |
| `GetInventoryHtlcSellerReveal` | **Admin only** — `{ settlementId, adminToken }` → preimage + script hex fields; `claimTxid` after successful on-chain claim; may include `relayReturnHop`, `requesterFabricId` when settlement used a relay |
| `ClaimInventoryHtlcOnChain` | **Admin only** — `{ settlementId, adminToken, toAddress?, feeSats? }` → builds tapscript seller claim, signs with hub identity key, `sendrawtransaction`; requires `fundedTxid` on settlement |
| `SubmitChatMessage` | Broadcast chat to all peers and WebSocket clients (Hub `content` or GoonCitizen `body` / channel / handle) |
| `ListTrackedApplicationContracts` | Pending + accepted CONTRACT_PUBLISH namespaces and contracts `stateRoot` |
| `AcceptTrackedApplicationContract` | **Admin** — `{ contractId, adminToken }` → accept into Beacon-tracked set |
| `RejectTrackedApplicationContract` | **Admin** — `{ contractId, adminToken }` → drop pending or untrack accepted |
| `EmitTombstone` | **Admin only** — `{ messageId?, documentId?, adminToken }` (at least one of `messageId`, `documentId`) — appends Fabric message `Tombstone` to the hub log (`_appendFabricMessage`), updates `STATE`, may JSON Patch `remove` an activity row, may **unpublish** a document id from `collections.documents`; broadcasts `GenericMessage` `{ type: 'Tombstone', object: { activityMessageId, documentId } }` so Bridge fires `fabric:tombstone` |
| `CreateDocument` | Store a document (base64 content) |
| `ListDocuments` | List document metadata |
| `GetDocument` | Retrieve document with content |
| `PublishDocument` | Add document to global state |
| `VerifyBitcoinL1Payment` | Params `{ txid, address, amountSats }` — confirms L1 pays invoice address (via Hub `bitcoind`) |
| `RegisterWebRTCPeer` | Register browser WebRTC peer id (Hub signaling; not PeerJS) |
| `ListWebRTCPeers` | List available WebRTC peers for mesh; each entry includes `lastSeen` / `registeredAt` (plus `connectedAt`) so browsers can match hub ordering after heartbeats; cross-cluster ids also arrive via `P2P_PEER_GOSSIP` on WebRTC data channels (`RelayFromWebRTC` / Fabric P2P relays the same type) |
| `SendWebRTCSignal` | Relay WebRTC signaling (offer/answer/ICE) between browser clients |
| `RelayFromWebRTC` | Relay messages received via WebRTC data channel to all WebSocket clients and Fabric P2P peers |
| `CreateExecutionContract` | Params `{ name?, program: { steps: [...] } }` — runs the sandboxed Fabric opcode machine, persists `ExecutionContract` |
| `RunExecutionContract` | Params `{ contractId }` — re-runs the stored program; returns `RunExecutionContractResult` (trace/stack, `runCommitmentHex` SHA-256 of canonical run, no contract mutation) |
| `GetSidechainState` | Returns `{ version, clock, stateDigest, content, policy }` for logical sidechain document (`sidechain/STATE`) |
| `GetSidechainJournal` | Params `{ limit?, includePatches? }` — append-only patch journal summary |
| `GetSidechainSnapshots` | Params `{ limit?, includeContent? }` — sealed snapshot index by beacon clock |
| `SubmitSidechainStatePatch` | Params `{ patches, basisClock, federationWitness? }` — RFC6902 ops on `content`; `adminToken` when no federation validators configured |
| `GetContractSidechainState` | Params `{ contractId }` — contract sidechain document for an **accepted** CONTRACT_PUBLISH namespace (`sidechains/<id>/`; ADR-001) |
| `SubmitContractSidechainStatePatch` | Params `{ contractId, patches, basisClock?, federationWitness?, adminToken? }` — patch contract sidechain + seal head at Hub `/namespaces/<id>` |
| `ListPendingBeaconEpochSignatures` | Pending Beacon Federation epoch sign rounds (threshold not yet met) |
| `SubmitBeaconEpochSignature` | Params `{ commitmentDigest, pubkey, signature }` — BIP340 over `signingStringForBeaconEpoch` |
| `AnchorExecutionRunCommitment` | Params `{ commitmentHex, adminToken }` — **regtest + named wallet only**: broadcasts OP_RETURN of the 32-byte digest; returns `AnchorExecutionRunCommitmentResult` with `txid` |
| `PostDelegationSignatureMessage` | Params `{ sessionToken, message, purpose? }` — appends Fabric message `DELEGATION_SIGNATURE_REQUEST`; returns `{ messageId, preview, … }` |
| `GetDelegationSignatureMessage` | Params `{ sessionToken, messageId }` — poll pending / approved / rejected (same shape as verify flow) |
| `ResolveDelegationSignatureMessage` | Params `{ sessionId, messageId, status: 'approved' \| 'rejected' }` — same-origin **`POST /services/rpc`** (possession of `sessionId`); appends `DELEGATION_SIGNATURE_RESOLUTION` |

## Message Types (P2P & WebSocket)
- `P2P_CHAT_MESSAGE` — Chat over Fabric P2P
- `P2P_FILE_SEND` — File transfer over P2P
- `ChatMessage` — WebSocket broadcast of chat
- `P2P_CHAT_MESSAGE` — Chat over WebRTC mesh (matches Fabric P2P pattern); when received, Bridge wraps in `P2P_RELAY` envelope and relays via `RelayFromWebRTC` to hub
- `P2P_RELAY` — Relay envelope for onion routing; preserves original message + signature; hub broadcasts to WebSocket clients and Fabric P2P
- `FileMessage` — WebSocket broadcast of received files
- `JSONCall` / `JSONCallResult` — RPC request/response

### Hub ↔ browser (Fabric frames)
- **SPA refresh:** `spaFallback` (default on) + **`res.format`** on **`GET /settings`** / **`GET /settings/:name`** (HTML vs JSON). In-app: **`/settings`**, **`/settings/security`**; **`/sessions`** and **`/security`** redirect to **`/settings/security`**; **`/sessions/:id`** is session detail (same path as REST `GET /sessions/:id` when not HTML). **`/services/bitcoin/…`** etc. rely on the same pattern so refresh returns the shell. Hub UI routes prefer **plural** resource paths (**`/activities`**, **`/peers`**, **`/documents`**, **`/contracts`**, **`/sidechains`**); **`/activity`** → **`/activities`**, **`/home`** → **`/`**, and legacy singular **`/document/…`** / **`/peer/…`** redirect to **`/documents/…`** / **`/peers/…`**. Short bookmarks (**`/payments`**, **`/invoices`**, **`/resources`**, **`/bitcoin`**, **`/wallet`**, **`/tx/:txid`**, **`/block/:hash`**) **redirect** to the canonical **`/services/bitcoin/…`** paths. Unknown paths show an in-app **not found** segment instead of a blank shell.
- WebSocket carries **binary** `Message` buffers (see `@fabric/http` `HTTPServer`). Bridge parses with `Message.fromBuffer`; JSON-RPC uses outer type `JSONCall`. The same RPC surface is available over **HTTP** as JSON-RPC 2.0 **`POST /services/rpc`** only (enabled on the Hub via `jsonRpc` in the `HTTPServer` constructor; implemented in `@fabric/http`).
- **L1 invoice verify (HTTP):** `GET /services/bitcoin/transactions/:txid?address=&amountSats=` — same resource as the raw transaction; with both query params the response is the payment proof (`verified`, `confirmations`, `inMempool`, `matchedSats`). Alternate: JSON-RPC `verifyl1payment` on `POST /services/bitcoin`. Client: [`functions/bitcoinClient.js`](functions/bitcoinClient.js) `verifyL1Payment`. UI: `/services/bitcoin/resources`.
- **Standard types** — Cohesive outer-type list, opcodes, and inner types pending promotion: [`functions/fabricMessageRegistry.js`](functions/fabricMessageRegistry.js); **`GenericMessage` is transitional** (see [MESSAGE_TRANSPORT.md](MESSAGE_TRANSPORT.md)). Core AMP bodies are typed fields (`@fabric/core` `docs/MESSAGE_BODY.md`); HTTP maps JSON. GoonCitizen GroupOffer / federation invites may also arrive as opaque `fabric:<hex>` `CONTRACT_MESSAGE`s.
- **FabricBridgeEnvelope** — Optional `GenericMessage` JSON body with `@fabric/BridgeEnvelope`, `v`, `fabricType`, `payload` ([MESSAGE_TRANSPORT.md](MESSAGE_TRANSPORT.md), [`functions/fabricBridgeEnvelope.js`](functions/fabricBridgeEnvelope.js)). Bridge dispatches `fabricBridgeEnvelope` window event when present.
- **Activity tombstone** — Hub appends a `Tombstone` entry via `_appendFabricMessage` (sequential `messages/*.json` + chain hooks) and broadcasts `GenericMessage` JSON `{ type: 'Tombstone', object: { activityMessageId, documentId } }`. Bridge dispatches `fabric:tombstone` on `window` with that detail (and may also apply JSON Patch `remove` for `/messages/<id>` when an activity row is removed). Unpublishing uses optional `documentId` on `EmitTombstone` to drop the doc from the hub published catalog (file remains under `documents/<id>.json`).
- **WebRTC** — Data channel `binaryType` is `arraybuffer`; binary frames are parsed like the WebSocket path. `sendToWebRTCPeer` accepts `Message` / `Buffer` / `ArrayBuffer` or legacy JSON objects.
- **WebSocket auth (optional)** — `settings.websocket`: `requireClientToken`, `clientToken`; env `FABRIC_WS_REQUIRE_TOKEN=1`, `FABRIC_WS_CLIENT_TOKEN`. Browser: `window.FABRIC_WS_CLIENT_TOKEN` so the Bridge appends `?token=` to the WS URL.

## Development
### Chromium extension (same UI as the site)
- **`npm run build:extension`** — produces `extension/popup.bundle.js` and copies Semantic + jQuery into `extension/vendor/`. Load **unpacked** from the `extension/` directory. Identity storage matches the web app (`localStorage` / `sessionStorage`); see **[EXTENSION.md](EXTENSION.md)**.

### Desktop (Electron)
- **`npm run desktop`** — builds browser assets and launches Electron; `scripts/desktop.js` spawns the Hub with `ELECTRON_RUN_AS_NODE`, sets **`FABRIC_HUB_APP_ROOT`** (packaged: `app.getAppPath()`; dev: repo root — `app.getAppPath()` would wrongly be `scripts/`) and **`FABRIC_HUB_USER_DATA`** (writable `stores/`, Bitcoin datadir, etc.). HTTP bind: **loopback by default** when `HTTP_SHARED_MODE` is unset; **Admin → HTTP shared mode** persists `HTTP_SHARED_MODE` so the hub binds `0.0.0.0` for LAN access (same as CLI; no `FABRIC_HUB_INTERFACE` override from Electron). The shell still loads the UI at `127.0.0.1`. See **[docs/DESKTOP.md](docs/DESKTOP.md)**.
- **`fabric:` protocol** — Opaque **`fabric:<hex>`** (wire **`Message`** only); legacy **`fabric://login?…`**, **`fabric://message?…`**; envelope JSON **`docs/FABRIC_MESSAGE_ENVELOPE.md`**. **`DelegationSigningModal`** + **`fabric:delegationSignRequest`** (e.g. **`RunExecutionContract`**). **`functions/fabricProtocolUrl.js`**, **`functions/fabricMessageEnvelope.js`**, **`scripts/desktop.js`**, **`functions/fabricDesktopAuth.js`**, **`services/hub.js`**.
- **`npm run build:desktop`** — **electron-builder** installers for the current OS (macOS dmg/zip, Windows NSIS, Linux AppImage/deb). Build each platform on its native runner in CI for all three.
- **`npm run build:desktop:dir`** — unpacked app under `dist/` for quick checks (no installer).

### Quick Start
```bash
npm install
npm start
```

Fast iteration without rebuilding the browser bundle: `npm run start:fast`. Local Hub + Fabric CLI workflows: **[docs/LOCAL_CLI_TESTING.md](docs/LOCAL_CLI_TESTING.md)**.

### Bug reports (fatal errors)
On fatal Hub exits (failed startup, `uncaughtException`, `unhandledRejection`, main rejection), the console logs where to report: default **[hub.fabric.pub issues](https://github.com/FabricLabs/hub.fabric.pub/issues)**. Override with **`FABRIC_ISSUES_URL`**. The browser bundle also prints the hint on unhandled rejections and synchronous `Error` instances from `window.onerror` (see [`functions/fabricReportHint.js`](functions/fabricReportHint.js)).

### Cursor agent Fabric identity (local only; never commit)
Optional persistent BIP39 identity for automation lives in **`local/cursor-agent-fabric-identity.json`** (gitignored). **`npm run cursor-agent:init`** creates it; **`npm run cursor-agent:emit-hub-config`** writes **`assets/config.local.js`** with **`FABRIC_DEV_BROWSER_*`** so the Hub SPA bootstraps the same key (file gitignored). Fresh clones get **`assets/config.local.js`** copied from **`assets/config.local.example.js`** on **`npm run build`** when the file is missing. **`npm run cursor-agent:sync-sensemaker`** copies the JSON to sibling **`sensemaker/local/`**. **`npm run cursor-agent:print-env`** prints a **`FABRIC_MNEMONIC`** export line for shell / `.env` (redirect yourself; do not commit).

### Local monorepo (`@fabric/core`, `@fabric/http`, `@fabric/hub`)
**`package.json`** pins **`@fabric/core`** and **`@fabric/http`** from Git for CI and fresh clones. For day-to-day work with local trees (e.g. **`~/fabric-clean`** and **`~/fabric-http`**), run **`npm run link:fabric`** once (or after `npm install` replaces symlinks). That script runs **`npm link`** in each repo and then **`npm link @fabric/core @fabric/http`** in the hub. Override paths with **`FABRIC_CORE`** and **`FABRIC_HTTP`**.

**`npm run desktop`** runs a preflight (`scripts/ensure-fabric-linked.js`) so missing deep modules (**`@fabric/http/types/distributedExecutionHttp`**, **`@fabric/core/types/machine`**, **`@fabric/core/functions/beaconFederationSigning`**) fail fast with a **`npm run link:fabric`** hint.

```bash
# Typical layout: clones at ~/fabric-clean and ~/fabric-http
npm install
npm run link:fabric
npm run desktop
# or: FABRIC_CORE=~/my-core FABRIC_HTTP=~/my-http npm run link:fabric
```

WebRTC uses native APIs in Bridge; **`types/swarm.js`** in fabric-http is a no-op stub (no **`peerjs`** npm stack).

Message / Peer security model and sparse-mesh notes: **`fabric/docs/MESSAGE_SECURITY.md`**.

Restore published deps by switching `@fabric/core` back to a git tag and `npm install` from a clean lockfile when not developing against a local Fabric tree.

### Testing
```bash
npm test           # Mocha tests in tests/
npm run coverage   # c8 coverage
```

### Build Commands
```bash
npm run build              # Build browser bundle
npm run build:semantic     # Rebuild Semantic UI (libraries/semantic + gulp)
npm run build:desktop      # Browser bundle + Electron installers (current platform)
npm run make:api           # Generate API.md from JSDoc
```

### Production and release
- **[docs/PRODUCTION_ROADMAP.md](docs/PRODUCTION_ROADMAP.md)** — living roadmap (browser wallet, crowdfunds/federation, Payjoin+Lightning). See also **[docs/PRODUCTION.md](docs/PRODUCTION.md)** and **[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)**.

## Code Conventions
- Use `'use strict';` at file top.
- Prefer `require()` over ES imports (CommonJS throughout).
- Emit events for state changes; UI subscribes via Bridge.
- Log with `[FABRIC:HUB]` or `[HUB]` prefix for server, `[BRIDGE]` for client.
- Error handling: wrap async operations in try/catch, emit `error` events.

### Startup Safety Notes
- Only run one Hub instance per machine/port set.
- If startup fails with `EADDRINUSE`, stop old `node scripts/hub.js` processes.
- If managed bitcoind fails after abrupt shutdown, clear stale regtest lock files:
  - `stores/bitcoin-regtest/regtest/.lock`
  - `stores/bitcoin-regtest/regtest/blocks/.lock`
- If bitcoind reports the datadir lock is held, stop the orphaned process (e.g. `pgrep -fl bitcoind` for the Hub datadir) before restarting.
- If managed Core Lightning fails with `lightningd already running? Error locking PID file`, stop the old `lightningd` for `stores/lightning/hub` (or reboot the Hub after a clean `SIGTERM` so it tears down CLN).

## Pay-to-Distribute (L1)
When Bitcoin is available, distributing (storage contracts) requires an L1 payment:
1. `CreateDistributeInvoice({ documentId, amountSats, durationYears?, ... })` — returns `{ address, amountSats }`
2. Pay to the address (via Send Payment or external wallet)
3. `CreateStorageContract({ documentId, amountSats, txid, ... })` — verifies payment and creates contract

Publish remains free. The distribute amount is user-specified.

## RPC Surface (WebSocket / JSONCall)
Common methods include:
- peers: `ListPeers`, `AddPeer`, `RemovePeer`, `GetPeer`
- chat/files: `SendPeerMessage`, `SubmitChatMessage`, `EmitTombstone` (admin), `SendPeerFile`, `RelayFromWebRTC`
- documents: `CreateDocument`, `ListDocuments`, `GetDocument`, `PublishDocument`
- distribute: `CreateDistributeInvoice`, `CreateStorageContract`
- bitcoin: `GetBitcoinStatus`, `ListBlocks`, `ListTransactions`, `SendPayment`, `VerifyBitcoinL1Payment`, `GenerateBlock`
- inventory HTLC: `RequestPeerInventory` third param `{ buyerRefundPublicKey?, htlcLocktimeBlocks?, htlcAmountSats?, inventoryTarget?, inventoryRelayTtl? }` — `inventoryTarget` is the seller Fabric id when the first param is only a **relay**; hubs forward `INVENTORY_REQUEST` / `INVENTORY_RESPONSE` (`inventoryRelayTtl` default 6). Seller replies to the **immediate** TCP peer (relay-safe). Settlement stores `relayReturnHop` when the buyer is not on the request socket; phase 2 may send `P2P_FILE_SEND` with `deliveryFabricId` + `fileRelayTtl` via that hop so relays forward chunks without persisting. `ConfirmInventoryHtlcPayment` → `ConfirmInventoryHtlcPaymentResult`; Bridge `inventoryHtlcConfirmResult`. On-chain: `INVENTORY_HTLC_ONCHAIN.md`. Seller preimage: `GetInventoryHtlcSellerReveal` (admin). Seller claim broadcast: `ClaimInventoryHtlcOnChain` (admin).
- payjoin: `GetPayjoinStatus`, `CreatePayjoinDeposit`, `ListPayjoinSessions` (default `includeExpired`; each session includes **proposal summaries** with `proposalTxid` when known), `GetPayjoinSession`, `SubmitPayjoinProposal` — HTTP: **GET** `/services/payjoin`, **GET|POST** `/services/payjoin/sessions`, **GET** `/services/payjoin/sessions/:id`, **POST** `/services/payjoin/sessions/:id/proposals` (aliases: `/payments/payjoin/...`, `/services/bitcoin/payjoin/...`)
- peering: `GetPeeringStatus`, `GetPeeringAttestation` — **GET** `/services/peering` (discovery + inline **`OracleAttestation`** signed by the Hub identity key), **GET** `/services/peering/attestation` (attestation body only). Uses the same `@type: 'OracleAttestation'` / `kind: 'PeeringCapability'` shape as other oracle-backed services (e.g. a price feed would use `kind: 'PriceQuote'`). See [`services/peering.js`](services/peering.js) and [`@fabric/core/types/oracle`](https://github.com/FabricLabs/fabric/blob/master/types/oracle.js).
- distributed execution: **GET** `/services/distributed/manifest` (program id/hash, allowed message types incl. `SIDECHAIN_STATE_PATCH`, `CONTRACT_PUBLISH`, `CONTRACT_MESSAGE`, optional federation policy + tracked-contracts summary), **GET** `/services/distributed/epoch` (beacon epoch summary, merkle, last commitment digest, contracts snapshot). Core: **`Machine` + `Program`** + `functions/beaconFederationSigning` / `fabricProgramManifest` / `sidechainState` (HTTP binder: `@fabric/http/types/distributedExecutionHttp`). See [docs/DISTRIBUTED_CONTRACT_EXECUTION.md](docs/DISTRIBUTED_CONTRACT_EXECUTION.md). Sidechain state: `GetSidechainState`, `SubmitSidechainStatePatch` ([`functions/sidechainState.js`](functions/sidechainState.js)). Tracked contracts: `ListTrackedApplicationContracts`, `AcceptTrackedApplicationContract` ([`functions/trackedApplicationContracts.js`](functions/trackedApplicationContracts.js)).
- contracts: `SubmitContractProposal` — relay `ContractProposal` (Merkle batched messages + JSON Patch + optional PSBT); wallet tx list labels include linked flows (`functions/txContractLabels.js`, persisted `fabric/tx-labels.json`); execution: `CreateExecutionContract`, `RunExecutionContract` ([`functions/fabricExecutionMachine.js`](functions/fabricExecutionMachine.js)) — `FabricOpcode` steps cannot reference `Ping`/`Pong` (transport keepalives only)

## Key Dependencies
- **`@fabric/core`** — Peer, Message, Key, Contract, Chain, Collection, Filesystem
- **`@fabric/http`** — HTTPServer with WebSocket support
- **WebRTC** — Browser mesh uses native `RTCPeerConnection` + Hub WebSocket signaling (`RegisterWebRTCPeer`, `SendWebRTCSignal`, etc.); no `peerjs` npm package
- **`react`** / **`semantic-ui-react`** — UI framework
- **`webpack`** — Browser bundling

## Testing Notes
- Tests live in `tests/` (not `stores/schemas/tests/` which are backups).
- `tests/fabricBridgeEnvelope.test.js` — reversible `GenericMessage` envelope helpers
- `tests/fabricMessageRegistry.test.js` — outer opcodes stay aligned with `@fabric/core` constants
- `tests/hub.http.js` — HTTP API tests
- `tests/hub.contracts.js` — Contract system tests
- `tests/hub.integration.js` — Integration tests
- `tests/browser.interface.test.js` — Puppeteer browser tests (page load, nav, routes). Requires Chrome: `npx puppeteer browsers install chrome`. Use `HUB_E2E=1` for full E2E with hub startup.
- `tests/hubSettingsMerge.test.js` — `hubSettingsMerge` vs `lodash.merge` for **`peers`**
- `tests/hub.document.network.e2e.test.js` / `tests/hub.fabric.epic.e2e.test.js` — multi-hub Fabric mesh RPC E2E (`npm run test:document-network`, `npm run test:fabric-epic`)

## Conventions
- CommonJS only (`require`, `module.exports`)
- `'use strict';` at top of files
- prefer explicit status/error objects over throwing in route handlers
- preserve existing log prefixes (`[HUB]`, `[FABRIC:HUB]`, `[BRIDGE]`, `[BITCOIN]`)
- Merging Hub settings over `settings/local.js`: use **`functions/hubSettingsMerge`** when overrides must set **`peers: []`** (or any explicit peer list). Plain **`lodash.merge`** combines arrays by index, so an empty `peers` array does **not** remove default seeds from `local.js`.

## Verification Commands
```bash
npm run ci              # release gate: build + unit tests (needs @fabric/core with publishedDocumentEnvelope, or sibling ../fabric checkout)
npm run build
npm test
npm run test:unit          # Excludes browser tests
npm run test:browser       # Browser tests (static server; needs Chrome)
npm run test:e2e-browser   # Full E2E: starts hub, runs browser tests
npm run test:e2e-webrtc
npm run test:e2e-payjoin
npm run test:e2e-all-browser   # Chained: HUB_E2E browser + payjoin + webrtc + L1 contracts suite (`test:e2e-contracts-l1`; needs Hub w/ Bitcoin + admin token unless blocked)
npm run test:stack             # Full stack: `ci` + `test:lightning` + `test:webrtc` + `test:e2e-all-browser`
npm run test:stack:no-l1       # Same as test:stack but skips on-chain L1 JSON-RPC suite (FABRIC_STACK_SKIP_L1_CONTRACTS)
npm run test:lightning     # L2 HTTP stub + bitcoinClient helpers (no lightningd)
npm run bitcoin:addnode -- --help   # managed regtest: bitcoin-cli addnode helper (see BITCOIN_NETWORKS.md)
npm run report:dependency-trees     # `npm ls` JSON + ASCII trees for @fabric/hub, $FABRIC_CORE (default ~/fabric-clean), $FABRIC_HTTP (default ~/fabric-http) → reports/dependency-trees/
# Optional: probe LAN mainnet Core (default host 192.168.50.5:8332); requires FABRIC_MAINNET_RPC_SMOKE=1 and RPC auth
FABRIC_MAINNET_RPC_SMOKE=1 BITCOIN_RPC_USER=… BITCOIN_RPC_PASSWORD=… npm run test:smoke-mainnet-rpc
```

## Structure
```text
hub.fabric.pub/
├── assets/           # Static files (HTML, CSS, bundles)
├── build/            # electron-builder icons (see build/README.md)
├── types/            # Hub extensions of Fabric types (e.g. LightningChannel)
├── components/       # React UI components
├── routes/           # HTTP route handlers
├── scripts/          # Entry points and build scripts (incl. `desktop.js` / `hub.js`)
├── services/         # Core services (Hub, Fabric)
├── settings/         # Configuration files
├── stores/           # Persistent storage
├── tests/            # Test suites
└── webpack.config.js # Browser bundle config
```
