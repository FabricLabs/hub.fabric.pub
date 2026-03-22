# Payments × document exchange — integration plan

This document extends [PAYMENTS_PROTOCOL.md](../PAYMENTS_PROTOCOL.md) with a concrete path for surfacing **payment state** next to **document exchange** flows in the Hub UI and APIs.

## Git / diff evaluation (working tree)
**Scope (tracked changes, excluding `stores/`, theme assets, and large bundles):** ~21 files — `services/hub.js`, `components/*` (Bitcoin, Bridge, Contracts, Documents, Invoice, Peers, TopPanel), `package.json`, `settings/local.js`, `webpack.config.js`, `scripts/hub.js`, etc.

**Shipped in this branch (high level)**
| Area | What changed |
|------|----------------|
| **L1 verification** | `_l1PaymentVerificationDetail`, `GET .../transactions/:txid?address=&amountSats=` / RPC / WS with `confirmations`, `inMempool`, `matchedSats`. |
| **Bitcoin status** | Public sanitizer exposes `mempoolTxCount` where available. |
| **Invoice UX** | Confirmation vs mempool, polling, tx deep links. |
| **Explorer / payments UI** | Mempool labels, tx links, payment-result copy on `BitcoinHome`. |
| **TopPanel** | Mempool badge when `mempoolTxCount > 0`. |
| **ContractView** | Payment tx status (mempool / confirmations) via `fetchTransactionByHash`. |
| **Documents** | Author / publisher copy; default publish price 25 sats; `DocumentList` `fabricPeerId` wiring (fix: variable must be defined at top of `DocumentsPage`). |
| **PeerView** | Publisher inventory + author hints for HTLC inventory. |
| **Docs / agent notes** | [LOCAL_CLI_TESTING.md](LOCAL_CLI_TESTING.md), this plan, `AGENTS.md` quick pointers (paths may be untracked until committed). |

**Repo / process outstanding**
- Many valuable files are still **untracked** (`docs/`, `AGENTS.md`, `PAYMENTS_PROTOCOL.md`, `functions/*.js`, tests, etc.) — **commit or `.gitignore`** intentionally so CI and teammates see one story.
- **`assets/bundles/browser.min.js`** and **`stores/**`** churn — avoid committing unless intentional; prefer rebuild in CI.
- **`feature/sensemaker`** branch mixes several concerns — consider splitting PRs: Bitcoin/mempool, documents copy, invoices, peer/inventory.

## Current surfaces
- **L1 invoices** — `Invoice` component, verify via `verifyL1Payment` / `VerifyBitcoinL1Payment` (confirmations, mempool hint).
- **Storage contracts** — `ContractView` shows `txid` with **mempool vs confirmed** from `fetchTransactionByHash`.
- **Inventory HTLC** — priced documents, `bitcoinUri`, `ConfirmInventoryHtlcPayment`; delivery over `P2P_FILE_SEND` (see protocol doc Phase B–F).

## Near-term UI / API alignment
| Area | Goal | Status |
|------|------|--------|
| **DocumentView** | When a document has a **storage contract**, show **payment tx** mempool / confirmations (same pattern as `ContractView`), linked to `/services/bitcoin/transactions/:txid`. | **Done** — `GET /contracts/:id` + `fetchTransactionByHash` under “Network storage contract”. |
| **DocumentView** | While **distribute** modal has a valid **txid**, tx deep link + **poll** depth (12s) + mempool / confirmation line. | **Done** |
| **DocumentList** | **Storage** (→ contract) + **L1 price** labels for published priced docs; per-row storage L1 status when `storageL1Status` is present (batched hub RPC). | **Done** |
| **Activity stream** | `Invoice` emits `fabric:l1PaymentActivity` (unconfirmed once, confirmed once); **ActivityStream** renders `CLIENT_NOTICE` + tx link; notices preserved on `globalStateUpdate`. | **Done** |
| **WebSocket** | Keep **`services.bitcoin`** / `mempoolTxCount` in sync with any new banners. | Done for TopPanel; extend if DocumentList gets indicators. |

## HTLC + L1 invoice consistency
- Reuse **one** user-facing vocabulary: *mempool / unconfirmed*, *N confirmations*, *settled*.
- For **inventory HTLC**, **PeerView** links funding **txid** (feedback + valid input) to `/services/bitcoin/transactions/:txid` with mempool copy; optional live depth poll deferred.
- Longer term: a single **`PaymentStatus`** object in JSON-RPC results `{ txid, confirmations, inMempool, matchedSats }` for invoices, contracts, and HTLC confirmations.

## Backend / test outstanding
- **Unit tests:** [`tests/hub.l1PaymentVerification.detail.test.js`](../tests/hub.l1PaymentVerification.detail.test.js) covers `_l1PaymentVerificationDetail` with a mocked Bitcoin service.
- **L1 verify REST:** `GET /services/bitcoin/transactions/:txid?address=&amountSats=` (same path as raw tx; query selects proof). [`functions/bitcoinClient.js`](../functions/bitcoinClient.js) `verifyL1Payment`; UI **`/services/bitcoin/resources`**.

## Testing
- Regtest: pay → mempool UI → **Generate block** (admin) → confirmed.
- `npm run test:unit` in `hub.fabric.pub`; Payjoin: `npm run test:e2e-payjoin` where applicable.

## Production & marketing
- **Deploy / security / CI:** [PRODUCTION.md](PRODUCTION.md) — `npm run ci` (build + unit tests), TLS, seeds, `stores/hub/` backups.
- **Positioning & copy blocks:** [MARKETING_OVERVIEW.md](MARKETING_OVERVIEW.md) — one-liner, bullets by audience, **three-repo** stack table.
- **Tag / RC:** [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) · [CHANGELOG.md](../CHANGELOG.md).
- **Root README:** [README.md](../README.md) — quick start and feature table for visitors.
- **HTLC / purchase binding:** Canonical **`DocumentPublish`** envelope + preimage (`functions/publishedDocumentEnvelope.js`); UI copy in `DocumentView` for post-phase-2 decrypt.

## References
- [INVENTORY_HTLC_ONCHAIN.md](../INVENTORY_HTLC_ONCHAIN.md)
- [MESSAGE_TRANSPORT.md](../MESSAGE_TRANSPORT.md)
- [LOCAL_CLI_TESTING.md](LOCAL_CLI_TESTING.md)
