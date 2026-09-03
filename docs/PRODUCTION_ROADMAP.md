# Production roadmap — hub.fabric.pub
Living plan for shipping core product themes: **browser Bitcoin wallet**, **crowdfunds + federation**, and **Payjoin + Lightning** with Fabric as the coordination layer. Update this file as work lands.

**Related:** [PRODUCTION.md](PRODUCTION.md) (deploy), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (tag gate), [AGENTS.md](../AGENTS.md) (architecture), [PAYMENTS_PROTOCOL.md](../PAYMENTS_PROTOCOL.md), [docs/DISTRIBUTED_CONTRACT_EXECUTION.md](DISTRIBUTED_CONTRACT_EXECUTION.md).

---

## Progress log
| 2026-08-20 | **AMP parent (D-020):** Hub `_appendFabricMessage` originates previous-`id` chains (`tests/hub.fabricMessageParent.test.js`). `GENESIS_MESSAGE` is the chain root; Ping / Pong stay zeros. Inbound zeros still accepted. Needs core `functions/fabricMessageParent` ([#186](https://github.com/FabricLabs/fabric/pull/186) / `npm link @fabric/core`). |
| 2026-08-20 | **Core [#186](https://github.com/FabricLabs/fabric/pull/186):** handshake-bus + gossip catalog on core `feature/rsi` (HEAD **`9c6ade0`**). Hub lockfile still **`9938917` / live `f63a33f`**. Pin + redeploy before treating playnet RSS/NOISE as fixed. Hub PR [#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) CodeRabbit fruit is in tree (operator Accept tests cover `_rootKey` and `agent.key`; playnet home-env only swallows `MODULE_NOT_FOUND`). |
| 2026-08-20 | **Core features gossip + L1 suite:** `npm run test:e2e-core-features-l1` (`tests/hub.core-features.l1.e2e.test.js`) — three isolated hubs, one managed regtest. Native `fabric-beacon` registry, satellite `CONTRACT_PUBLISH` Accept + Statechain patches + `CONTRACT_MESSAGE` rounds, hallmark OP_RETURN committing the contracts digest, unpriced inventory/`SendPeerFile`, priced inventory HTLC with `VerifyBitcoinL1Payment`. WebRTC spokes on each hub (plus a second on the registry) cover `SendWebRTCSignal`, `RelayFromWebRTC` chat/contract frames, and spoke-origin document fetch. **Still open:** browser walkthroughs (Phase E checkboxes). |
| 2026-08-20 | **Payjoin + crowdfund L1 evidence:** `npm run test:e2e-payjoin-l1` funds a Hub Payjoin deposit on isolated regtest then accepts a proposal (`tests/hub.payjoin.l1.e2e.test.js`). Crowdfund mocha (`test:crowdfund-regtest`) now POSTs `/settings` before bitcoind (setup deferral) and uses `hubSettingsMerge` + wallet `gettransaction` wait. UI testids: `hub-payjoin-deposit`, `hub-payjoin-board`, `hub-crowdfund-page`. **Still open:** Puppeteer click-through of Create Payjoin Deposit / campaign fund (Phase E checkboxes). |
| 2026-08-20 | **Inventory HTLC two-hub L1 suite passes:** `npm run test:e2e-inventory-htlc` (`tests/hub.inventory.htlc.e2e.test.js`) — seller managed regtest, buyer Fabric-only, first-class `P2P_INVENTORY_*` AMP, `RequestPeerInventory` → fund P2TR → `ConfirmInventoryHtlcPayment` → `P2P_FILE_SEND` ciphertext. Setup apply keeps constructor `bitcoinExtraParams` (`-maxtxfee=10`); L1 verify falls back to wallet `gettransaction` when `getrawtransaction` cannot see a confirmed wallet send. Compact HTLC quotes persist on the Document Market offer book. **Still open:** Puppeteer walkthrough of PeerView `data-testid="peer-inventory-htlc"` (Phase E checkbox stays unchecked until that browser pass lands). |
| 2026-08-13 | **Document Market inventory book:** Opt-in **`FABRIC_DOCUMENT_MARKET_ACCUMULATE`** stores peer document inventories in `collections.documentoffers`. **`FABRIC_DOCUMENT_MARKET_REPUBLISH`** lists held files at a markup (`markupBps` / `markupSats`) so this hub can sell to peers who lack a path to the original seller. Helper [`functions/documentInventoryMarket.js`](../functions/documentInventoryMarket.js); RPC `ListDocumentOffers` / `RefreshDocumentMarket`; Documents UI shows peer offers. Honest inventory replies remain local-blob-only. |
| 2026-03-29 | **L1 document market × Bitcoin index:** Auto-publish **block** (+ optional **tx**) Fabric documents with immutable canonical JSON (**schemaVersion 3** — `functions/bitcoinBlockDocument.js`, `functions/bitcoinTransactionDocument.js`) so inventory HTLC / `DocumentPublish` preimages stay stable. Default **`purchasePriceSats`** via `documentInventoryBlockPriceSats` / `documentInventoryTransactionPriceSats` (`FABRIC_BITCOIN_DOC_*`). **Pruned** `bitcoind`: local catalog + disk drop below **`pruneheight`** (no Fabric `Tombstone`); public status adds **`bitcoinPruned`** / **`bitcoinPruneHeight`**; Bitcoin UI prune row. Inventory gossip includes **`bitcoinHeight`** / hashes for peers. Tests: `tests/bitcoinBlockDocument.test.js`, `bitcoinTransactionDocument.test.js`, `bitcoinPruneInventory.test.js`. |
| 2026-03-24 | Feature visibility now persists to disk via setting `HUB_UI_FEATURE_FLAGS` (admin token required for writes) and hydrates at SPA startup. Added Lightning route aliases (`/services/lightning`, `/services/bitcoin/lightning`) to canonical `#fabric-bitcoin-lightning`. Crowdfund row actions now gate/disable Payments and Payjoin buttons when `bitcoinPayments` is off to avoid confusing redirects. |
| 2026-03-24 | Added this roadmap. Fixed `/settings` crash (`hasHubAdminPeerNav`); browser smoke for `/settings` and `/settings/federation` (with `sidechain` UI flag). **Treasury** home shortcut → Bitcoin Payjoin anchor `#fabric-bitcoin-payjoin` (or Lightning if Payments off); Payjoin segment id; federation page `settings-federation-heading`. Linked from [PRODUCTION.md](PRODUCTION.md), [CHANGELOG.md](../CHANGELOG.md), [AGENTS.md](../AGENTS.md). |
| 2026-03-24 | **Phase A:** `.github/workflows/e2e-rc.yml` (tags `v*` + manual), `scripts/ci-e2e-payjoin.sh`, `npm run ci:e2e-payjoin`, [PRODUCTION.md](PRODUCTION.md) UI flags section. **Phase B:** Settings + Bitcoin page copy (identity vs Hub wallet, backup link, RPC-unavailable hint). **Phase D:** operator deposits checklist on Bitcoin when backend is up. |
| 2026-03-24 | **Phase D:** Payjoin strip on Bitcoin — `fetchPayjoinSessions` in `refresh()` when `bitcoinPayments` flag on; counts not-expired and in-progress; link to Payments; `#fabric-bitcoin-payjoin-sessions-strip`. |

---

## Phase A — Shell stability (P0)
- [x] `npm run ci` (build + unit tests) as default gate
- [x] Browser smoke: `/settings` overview (no `ReferenceError`)
- [x] Browser smoke: Payments, Invoices, Crowdfunds, Admin, Beacon Federation, Distributed federation (`/settings/federation` + `sidechain` flag)
- [x] Optional CI: workflow **E2E RC** (`.github/workflows/e2e-rc.yml`) runs `test:e2e-browser` and `ci:e2e-payjoin` on **tags** `v*` and **`workflow_dispatch`**
- [x] Document production **UI feature flags** — [PRODUCTION.md](PRODUCTION.md) + [Feature flags](#feature-flags-production) below

---

## Phase B — Browser Bitcoin wallet (P0)
**Goal:** One BIP44 payment account under the Fabric identity; client balance, invoices, and sends aligned with `getSpendWalletContext` / `functions/bitcoinClient.js`.

- [x] Settings → [Bitcoin wallet & derivation](/settings/bitcoin-wallet) explains `m/44'/0'/0'`
- [x] Mainnet / operator messaging: **Identity vs Hub node wallet** callouts on Settings (Bitcoin wallet) and [Bitcoin](/services/bitcoin) summary
- [x] Backup / recovery UX copy — Settings Bitcoin wallet links to Security; identity manager remains the mnemonic surface
- [x] Harden error surfaces — Bitcoin page shows **Hub Bitcoin backend unavailable** when upstream is set but `bitcoind` is not reachable (existing refresh error path unchanged)

---

## Phase C — Crowdfunds + federations (P0 / P1)
**Goal:** Taproot crowdfund flows stable on regtest; federation policy for sidechain / beacon; docs clarify **multisig** scope (policy keys vs L1 multisig vs crowdfund vault).

- [x] Crowdfunds route + browser smoke (`/services/bitcoin/crowdfunds`)
- [x] Distributed federation UI (`/settings/federation`, flag `sidechain`)
- [x] `GetDistributedFederationPolicy` HTTP shape — [`tests/hub.http.js`](../tests/hub.http.js) (JSON-RPC). **Save policy with admin token** remains a manual / playnet integration path (`playnet.beacon.federation.integration.js`).
- [ ] End-to-end checklist: signet or mainnet-smoke for crowdfund create → fund → payout
- [x] Cross-links — [Beacon Federation](/settings/admin/beacon-federation) ↔ [Distributed federation](/settings/federation); manifest / epoch URLs on both pages

---

## Phase D — Payjoin + Lightning for Hub operators (P1)
**Goal:** Operators find **deposits** (Payjoin BIP77 + optional CLN) from Home and Bitcoin page without hunting; Fabric used for session coordination and UI notifications—not a substitute for BOLT/BIP78 on the wire.

- [x] Payjoin deposit UI on [Bitcoin](/services/bitcoin) (requires **Bitcoin → Payments** feature flag)
- [x] **Treasury** shortcut on Home → `#fabric-bitcoin-payjoin` when Payments are enabled; falls back to `#fabric-bitcoin-lightning` when only Lightning is enabled
- [x] Payjoin block anchor (`id="fabric-bitcoin-payjoin"`) for deep links and the Treasury button
- [x] **Operator deposits checklist** on [Bitcoin](/services/bitcoin) when the Hub Bitcoin backend is available
- [x] Metrics or status strip: open Payjoin sessions count (`#fabric-bitcoin-payjoin-sessions-strip`, link to `/services/bitcoin/payments`)

---

## Phase E — Release gate
- [ ] Human: follow [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) before tag (not automatable here)
- [ ] Pins for `@fabric/core` / `@fabric/http` aligned with RCs
- [ ] Deploy: TLS, `FABRIC_SEED`, backup `stores/hub/` per [PRODUCTION.md](PRODUCTION.md)

### Key feature acceptance (L1 + browser + tests)
- [ ] Crowdfund on L1: browser walkthrough + automated test evidence (`npm run screenshots:l1` → [USER_FLOWS.md](USER_FLOWS.md); mocha: `test:e2e-crowdfund-l1`)
- [ ] Payjoin on L1: browser walkthrough + automated test evidence (`npm run screenshots:l1` → [USER_FLOWS.md](USER_FLOWS.md); `test:e2e-payjoin` / `test:e2e-payjoin-l1`)
- [x] **L1-indexed sellable documents** — Block (+ optional tx) hub documents, list pricing, prune-aware local inventory, canonical binding for inventory HTLC (hub + unit tests; see Progress log 2026-03-29)
- [ ] Document exchange on L1: **end-to-end browser** walkthrough + dedicated automated suite (beyond unit tests / playnet market integration) — UI gallery: `npm run screenshots` / `screenshots:l1` → [USER_FLOWS.md](USER_FLOWS.md); mocha: `test:e2e-inventory-htlc`
- [ ] Admin visibility: clear node-wealth panel for operator outcomes

---

## Feature flags (production)
Defaults are conservative (`functions/hubUiFeatureFlags.js`). The SPA caches flags in `localStorage` and hydrates from Hub setting `HUB_UI_FEATURE_FLAGS` at startup (disk-backed in `stores/hub/STATE` `.settings`; writes require admin token). For a **full Bitcoin operator** UI in one browser profile, set:

```json
{
  "bitcoin": true,
  "sidechain": true,
  "bitcoinPayments": true,
  "bitcoinLightning": true,
  "bitcoinResources": true,
  "bitcoinCrowdfund": true
}
```

`bitcoin: true` enables all Bitcoin-related flags in one shot. **Peers** nav remains gated on the Hub **admin token** (same as Settings Peers card). Adjust per environment.

---

## Ownership / next steps
1. Keep this file’s **Progress log** and checkboxes current when merging roadmap work.
2. Prefer small PRs: one phase subsection per PR when possible.
3. After major milestones, add a line to [CHANGELOG.md](../CHANGELOG.md) under `[Unreleased]` or the next RC.
