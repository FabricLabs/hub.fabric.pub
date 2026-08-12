# Payment protocol direction
This note sets expectations for **how Fabric handles value transfer** in the stack (`@fabric/core`, `@fabric/http`, `@fabric/hub`). It is guiding policy, not a finished spec.

## Primary goal: Fabric-native payments
Ship a **small, auditable protocol** first:

- **Fabric messages and types** — Invoices, settlement hints, and receipts expressed with `Message`, `Actor`, and related types; signed where security requires it.
- **L1 and optional Payjoin** — On-chain invoices and BIP77-style negotiation already fit this model in the Hub.
- **L1 settlement check** — For external wallets (especially mainnet), the Hub exposes `VerifyBitcoinL1Payment` (WebSocket), **`GET /services/bitcoin/transactions/:txid?address=&amountSats=`** (transaction resource with query-driven payment-proof view), and `POST /services/bitcoin` with `method: verifyl1payment` for JSON-RPC callers: the node confirms via `getrawtransaction` that outputs pay at least that amount to the invoice address. Requires the Hub’s `bitcoind` to be able to return the transaction (e.g. txindex or wallet awareness).
- **Document exchange (inventory HTLC)** — **Primary Document market income path.** **Phase 1:** Buyer sends `INVENTORY_REQUEST` with optional `buyerRefundPublicKey` (compressed secp256k1, 66 hex chars). For each **priced** document (`purchasePriceSats` on the published collection entry, or a request-level `htlcAmountSats` fallback), the seller Hub attaches an `htlc` object: P2TR script-path output with NUMS internal key; scripts are hashlock+seller claim vs CLTV+buyer refund; includes **`bitcoinUri`** / **`amountBtc`** for wallet funding. **Priced publish seals** plaintext with a random content key **`K`** (ciphertext-at-rest; see `functions/documentContentKey.js`); HTLC preimage = **`K`**. Legacy unpriced/unsealed docs still use `SHA256` of the Fabric **`DocumentPublish`** envelope (`publishedDocumentEnvelope`). **Relay:** Intermediate hubs forward requests when `target` is another Fabric id they have a session with, and forward `INVENTORY_RESPONSE` to `target` (buyer id). `RequestPeerInventory` accepts `inventoryTarget` when the WebSocket peer is only the next hop; `inventoryRelayTtl` limits hops (default 6). **Phase 2:** Buyer funds the advertised `paymentAddress` for at least `amountSats`, then calls `ConfirmInventoryHtlcPayment` with `{ settlementId, txid }`. The seller Hub verifies the transaction, streams ciphertext via `P2P_FILE_SEND`, and sends buyer-targeted **`HTLC_KEY_REVEAL`** with `preimageHex` (= `K`). Bridge auto-unlocks. Chunks may include `deliveryFabricId` / `fileRelayTtl` for hop-by-hop file forward (TTL default 8). **On-chain claim** via admin `ClaimInventoryHtlcOnChain`; see [INVENTORY_HTLC_ONCHAIN.md](INVENTORY_HTLC_ONCHAIN.md). **Pruned Bitcoin Core:** local catalog drop below **`pruneheight`**; **Beacon** / P2P **`BitcoinBlock`** remain the shared tip signal. UI defaults favor Documents + Peers + Bitcoin invoices/explorer; server `FEATURE_FLAGS.DISTRIBUTE` stays off (broken hosting-offer path gated).
- **Transports** — Browser clients use the **binary WebSocket** with Fabric `Message` frames (`JSONCall`, `P2P_RELAY`, `ChatMessage`, …). **`GenericMessage` is transitional**; standard types and opcodes are catalogued in [`functions/fabricMessageRegistry.js`](functions/fabricMessageRegistry.js) ([MESSAGE_TRANSPORT.md](MESSAGE_TRANSPORT.md)). Reversible payloads inside `GenericMessage` use **`FabricBridgeEnvelope`** until promoted to first-class outer types with binary layouts. WebRTC may carry the same **`Message` buffers**; optional WebSocket auth is documented there.

External standards should **adapt into** this envelope, not replace it on day one.

## Future interoperability (adapters, not core couplings)
These are **intentionally deferred**. When we integrate them, they should live behind clear boundaries (adapters, feature flags, or separate modules) so `@fabric/core` stays usable without a particular HTTP payment extension.

| Direction | Role |
|-----------|------|
| **L402** | HTTP `402 Payment Required` flows (often Lightning-oriented). Useful for interop with web-native payment prompts; map responses into Fabric messages where it helps operators. |
| **x402** | Ecosystems built around machine-readable HTTP payment requirements. Evaluate each profile for trust model and fee semantics before treating any as canonical. |
| **MPP (multi-path payments)** | Split liquidity across routes (common in Lightning; **Tempo** and similar stacks may expose MPP-style behavior). Relevant when Lightning is a first-class path in the demo app, not a prerequisite for Fabric L1 flows. |

## Culture
- Prefer **one Fabric-native happy path** documented and tested end-to-end.
- Add L402 / x402 / MPP as **optional layers** that produce or consume the same Fabric-level invoice/settlement objects.
- Avoid embedding third-party payment HTTP details into `@fabric/core` defaults; keep explorers and bridges **configured**, not hard-coded.

See also [BITCOIN_NETWORKS.md](BITCOIN_NETWORKS.md) for RPC and LAN mainnet setup, and [docs/PAYMENTS_DOCUMENT_EXCHANGE_PLAN.md](docs/PAYMENTS_DOCUMENT_EXCHANGE_PLAN.md) for Hub UI alignment with document exchange.

**Stack docs (three core repos):** [fabric](https://github.com/FabricLabs/fabric), [fabric-http](https://github.com/FabricLabs/fabric-http), and **hub.fabric.pub** each ship `docs/PRODUCTION.md`, `docs/MARKETING_OVERVIEW.md`, `docs/RELEASE_CHECKLIST.md`, `CHANGELOG.md`, and **`npm run ci`**.

## Roadmap (Fabric-native happy path)
| Phase | Scope | Status |
|-------|--------|--------|
| **A** | L1 invoice / `VerifyBitcoinL1Payment` + UI (`Invoice`, mainnet external pay) | Shipped |
| **B** | Inventory `INVENTORY_REQUEST` / `INVENTORY_RESPONSE`; priced docs; P2TR HTLC metadata per item; `ConfirmInventoryHtlcPayment` → `P2P_FILE_SEND` | Shipped |
| **C** | Typed RPC result `ConfirmInventoryHtlcPaymentResult` + browser `inventoryHtlcConfirmResult` event for UX | Shipped |
| **D** | BIP21 `bitcoinUri` / `amountBtc` on each inventory `htlc`; Peer UI QR + copy | Shipped |
| **E** | Operator doc [INVENTORY_HTLC_ONCHAIN.md](INVENTORY_HTLC_ONCHAIN.md); admin `GetInventoryHtlcSellerReveal` for preimage + scripts | Shipped |
| **F** | Relayed inventory + HTLC phase 2 `P2P_FILE_SEND` (`deliveryFabricId` / `fileRelayTtl`); seller reply on request TCP path | Shipped |
| **G** | L402 / x402 / MPP **adapters** behind flags (see table above) | Deferred |
| **H** | Seller **on-chain claim**: `ClaimInventoryHtlcOnChain` (admin) — PSBT/sign/broadcast via hub identity key | Shipped |
| **I** | **L1 block/tx Fabric documents** for the document market: auto-index from `getblock` … 2, default **`purchasePriceSats`**, optional per-tx docs (`FABRIC_BITCOIN_DOCUMENT_TX=1`); **prune-aware** local catalog; canonical **schema v3** bodies for stable preimages | Shipped |

**L2 vs L1:** Hub `types/lightningChannel.js` extends `@fabric/core/types/channel` with CLN-facing ids for BOLT-style payment channels. That is separate from inventory **L1** P2TR HTLC (`functions/inventoryHtlc.js`): both may use Taproot patterns, but inventory settlement is **Fabric protocol** (document delivery), not Lightning `pay_chan`. Upstream `fabric/tests/lightning/` exercises `lightningd` when present.

**Verification (hub.fabric.pub):** `npm run test:unit` (includes `tests/inventoryHTLC.test.js`, `tests/inventoryRelay.test.js`, `tests/fabric.lightningChannel.test.js`, `tests/fabricBridgeEnvelope.test.js`, `tests/fabricMessageRegistry.test.js`, `tests/bitcoinBlockDocument.test.js`, `tests/bitcoinTransactionDocument.test.js`, `tests/bitcoinPruneInventory.test.js`); exercise Payjoin / regtest flows with `npm run test:e2e-payjoin` where applicable.
