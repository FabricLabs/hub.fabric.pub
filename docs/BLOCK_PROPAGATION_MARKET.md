# Block Propagation Market (evaluation + roadmap)

**Status:** proposal. Post-`0.1.0-RC1` work; nothing here changes RC scope.

## 1. Thesis

Bitcoin block relay is a public good with a latency tail that matters to a few
parties: miners and pools (stale-block risk), exchanges and payment processors
(confirmation speed), and Lightning nodes (timely chain view for HTLC deadlines).
Today the fast path comes from free relay overlays (BIP152 compact blocks,
FIBRE, Falcon, satellite) that are run as donations or as a side effect of other
businesses.

The proposal is a **paid overlay**. Full nodes (Hubs) sell *time to first
validated block*. Buyers post standing Fabric bids; sellers order their dispatch
queue on each new tip by what those bids pay. Payment and the guarantees around
it ride Lightning. We trust the Lightning Network transaction graph as both the
payment rail and a Sybil-cost signal. Relays that buy upstream and resell
downstream turn this into a **self-balancing CDN**: bandwidth goes where the
price says latency is worth the most.

Ground rules:

- **Additive only.** Ordinary Bitcoin P2P relay is never withheld or delayed.
  The market sells *earlier* delivery over an extra channel; it does not sell
  access.
- **The good proves itself.** A block header carries its own proof of work and
  a compact block rebuilds against the buyer's mempool. Buyers verify the good
  without trusting the seller. Only *timing* needs a reputation or payment
  guarantee.
- **The bar is high.** Compact blocks already reach most nodes in well under a
  second. A real contribution has to cut the tail (distant, poorly connected,
  or censored nodes) or pay for infrastructure nobody funds today. Matching the
  median is not enough.

## 2. Current implementation

### 2.1 Chain-tip gossip
- ZMQ `hashblock` → `Hub#_handleBitcoinBlockUpdate` (`services/hub.js`, ~L8962)
  appends a `BitcoinBlock` log entry, records a Beacon epoch, calls
  `market.onBitcoinBlock`, and gossips a signed `BitcoinBlock` wire message via
  `agent.relayFrom('_hub', …)`.
- `@fabric/core` `Peer` relays `BitcoinBlock` with logical-tip dedupe
  (`_claimLogicalRegistrationOrPunish`; `fabric-clean/types/peer.js`, ~L3278).
  Duplicate re-signed tips are dropped, and bad body hashes are dropped and
  penalized.
- Resync replays recent `BitcoinBlock` payloads to newly connected peers.
- **Payload is tip and height only, never block bytes.** It tells you a block
  exists but does not deliver it.

### 2.2 Blocks as documents
- `functions/bitcoinBlockDocument.js`: published block summary documents
  (schemaVersion 3, immutable fields only, so `DocumentPublish` and HTLC
  preimages stay stable). Optional per-tx documents carry consensus `hex`.
- List price `documentInventoryBlockPriceSats` (`FABRIC_BITCOIN_DOC_BLOCK_PRICE_SATS`).
  On a pruned node, heights below `pruneheight` are unpublished.
- These documents are built for **archive/market** use (minutes), not
  propagation (milliseconds).

### 2.3 BID/ASK market
- Wire opcodes `P2P_DOCUMENT_BID` (0x63) and `P2P_DOCUMENT_ASK` (0x64)
  (`fabric-clean/constants.js`). Bids are signed and flooded with per-origin
  rate limits (`DOCUMENT_BID_MAX_RELAYS_PER_ORIGIN_PER_MINUTE`), routed back by
  bounded route tables (`PEER_MAX_DOCUMENT_BID_ROUTES`), with TTL ≤ 1 h and
  ≤ 32 asks per bid.
- `DocumentBook` (`fabric-clean/types/documentBook.js`) ranks providers by
  price, measured inventory RTT, delivery outcomes, refunds and fraud-proof
  penalties. Reputation is **local only**, though `exportTelemetry()` is
  already shaped for signing later.
- Hub `services/market.js` keeps telemetry and runs the budget agent
  (`@fabric/core/services/market`). `ChannelBook` payment channels
  (off-chain HTLC over `CONTRACT_MESSAGE`) are used before falling back to L1.
  A watchtower watches the channels.
- Republish markup (`documents.market.markupBps`, default 10 %) in
  `functions/documentInventoryMarket.js` is the buy-low/resell primitive a
  CDN tier needs.

### 2.4 Settlement
- L1 P2TR inventory HTLCs (`INVENTORY_HTLC_ONCHAIN.md`): one or more
  confirmations, so **far too slow** for a good that loses its value in
  seconds.
- Fabric channels (`fabric-clean/types/channelBook.js`): fast, but only
  between two parties. There is no routing graph.
- Core Lightning (`fabric-clean/services/lightning.js`): `createInvoice(…, { preimage, expiry })`,
  and `pay` returns the preimage. BOLT12 helpers are in `functions/lightningBolt12.js`.
  There is **no hold-invoice or keysend wrapper yet**.
- L1/L2 `LiquidityBook` / `Swap` (`fabric-clean/docs/LIQUIDITY_MARKET.md`)
  give sellers a way to rebalance inbound liquidity. Regtest only.
- Fidelity bonds (`services/coinjoin.js`) are a working example of costly,
  verifiable identity we can reuse.

### 2.5 Gaps
| Gap | Why it matters |
|-----|----------------|
| No block bytes on the Fabric wire | Nothing to sell yet |
| No compact / erasure-coded encoding | Full blocks over TCP gossip lose to BIP152 |
| BID is per-chunk *pull*; no standing subscription | Propagation is *push* on every tip |
| No dispatch priority in `Peer` relay | Price can't change who gets served first |
| No signed, timestamped delivery receipts | No way to settle latency claims |
| L1 HTLC too slow; no LN hold invoices | Guarantees have nothing to hang on |
| Reputation is local only; regtest-only guards | No network-wide signal; no real deployment |

## 3. Market design

### 3.1 The good
Delivering, for block `H`: (a) the 80-byte header (PoW checked on arrival),
then (b) a BIP152-style compact block (short ids + prefilled txs), then
(c) on request, the missing txs or erasure-coded shreds. What gets priced is
**the arrival time of (a) and (b)** relative to the first time *anyone* saw the
header.

### 3.2 Messages
Start as bodies under a `CONTRACT_MESSAGE` namespace (`block-relay`), the way
channels are done today. Promote them to opcodes only after the shape settles.

- **`BlockBid`** (buyer, signed, standing): `{ network, satsPerBlock,
  maxLatencyMs, firstOnly?, expiresAt, lnNode (pubkey), endpoints[],
  creditId? }`. This is a subscription, not a one-off chunk bid. It reuses the
  `P2P_DOCUMENT_BID` validation rules (TTL, rate limit, route table).
- **`BlockAsk`** (seller, signed): `{ satsPerBlock, tierLatencyMs (p50/p95
  claimed), capacity (subscribers), lnNode, bolt12Offer, bondRef? }`.
- **`BlockDelivery`** (seller → buyer): header plus compact block, plus a
  seller signature over `(blockHash, sendTsMs, subscriptionId)`.
- **`BlockReceipt`** (buyer → seller, signed): `(blockHash, recvTsMs,
  firstSeenTsMs, validated)`. The pair of signatures is evidence for
  settlement and reputation.

### 3.3 Priority dispatch
On each new tip, the seller sorts active subscriptions by
`satsPerBlock × reliability(buyer)` and writes to them in that order across
parallel sockets. Free peers, including normal Bitcoin P2P, are served on their
own path with no added delay. Price only orders the *paid* queue and decides
who gets dedicated capacity. When paid capacity is full, the lowest bids get
`BlockAsk` counter-offers. That is the price discovery.

### 3.4 Lightning-bound guarantees
- **Prepaid credit (Phase 2):** the buyer pays a BOLT12 offer for N blocks. The
  seller debits one block per delivery. Simple, and the buyer's risk is bounded
  by N.
- **Hold invoice per block (Phase 3):** the buyer pre-locks a hold-invoice HTLC
  for "the next block within `maxLatencyMs`". The seller settles it after a
  valid `BlockReceipt`, or after a timeout if the buyer stops responding. A
  late or missing delivery lets the HTLC expire and refunds the buyer. The
  preimage can be tied to the delivery, for example
  `preimage = H(sellerSecret || blockHash)` revealed with the delivery, so
  payment and delivery happen together.
- **Trusting the LN graph:** channel capacity and age, as seen in gossip, put a
  price on fake identities. Ranking can weigh a seller's (or buyer's) LN node
  stake the way `requireBond` weighs coinjoin makers. Reachability over LN is
  also evidence that the operator is still running.

### 3.5 Self-balancing CDN
A relay Hub buys a low-latency feed upstream (near pools) and resells
downstream at a markup (reuse `markupBps`). When a region is underserved,
downstream bids rise, which pays for new relays there. When a tier is
oversupplied, prices fall and relays drop off. Multi-source buyers take the
first valid copy and pay only that seller (`firstOnly`). This creates direct
competition on latency.

### 3.6 Risks
- **Centralization / mining fairness:** paid speed helps whoever can pay, which
  is mostly large pools. To offset this, the overlay should publish its latency
  data openly, keep a free tier, and aim to *help small miners* reach the fast
  path cheaply, not only sell the top tier.
- **Privacy:** a bid reveals that the bidder cares about latency (likely a
  miner). Offer onion-routed delivery (`SendOnion` / `P2P_FORWARD`) and
  LN-private payment.
- **Spam / DoS:** bids must carry a credit or bond reference before they get a
  queue slot. Existing per-origin limits apply.
- **Withholding and selfish mining:** a seller who is also a miner could delay
  competitors' blocks. Multi-source buying and receipt-based reputation catch
  this. It can never be worse than the free network, because the free network
  is never touched.
- **Clock trust:** latency evidence relies on timestamps. Use first-seen across
  several sources plus each party's own clock. Treat receipts as reputation
  evidence, not proof.

## 4. Phases

| Phase | Goal | Deliverables | Exit metric |
|-------|------|--------------|-------------|
| **P0 Measure** | Know the baseline | Record ZMQ arrival vs Fabric `BitcoinBlock` arrival per peer in `market` telemetry; `/services/market/blocks` latency view; signet + mainnet *read-only* | p50/p95 tip latency published for ≥ 3 Hubs |
| **P1 Fast free relay** | Have a good worth selling | Header-first relay with PoW check before forwarding; BIP152 short-id compact blocks over Fabric (reconstruct from local mempool, fetch missing txs); never relay invalid blocks | Fabric compact path within 10 % of Core's own compact-block latency on signet |
| **P2 Subscriptions** | Price signal + priority | `BlockBid`/`BlockAsk`/`BlockDelivery`/`BlockReceipt` bodies; priority dispatch in Hub; BOLT12 prepaid credit through CLN; signed receipts feed `DocumentBook`-style ranking | Paid subscriber measurably ahead of free peers under load; settlement runs end to end on signet |
| **P3 LN guarantees** | Trust-minimized SLA | Hold-invoice + keysend support in `services/lightning.js`; per-block HTLC tied to delivery; latency-SLA refunds; LN-graph / bond weighting; signed telemetry export | Zero-trust per-block payment on signet; disputes settle without the operator stepping in |
| **P4 CDN tiers** | Self-balancing coverage | Buy/resell relays with markup; multi-source `firstOnly`; FIBRE-style erasure-coded shreds over UDP/WebRTC; onion-routed delivery option | Regional tail latency (p95) beats the free network in at least one underserved region |
| **P5 Ecosystem** | A real contribution | BIP-style spec of the messages; reference client usable from Core-adjacent tools (`-blocknotify`, a `sendcmpct` bridge peer); open latency dataset; mainnet opt-in behind explicit operator flags | Third-party nodes and a pool subscribe; spec reviewed upstream |

### 4.1 P0 / P1 implementation status

Built and unit-tested. Not yet measured on a live signet or mainnet mesh, so
the exit metrics above are still open.

- **`functions/compactBlock.js`**: BIP152-style compact blocks. SipHash-2-4
  short ids over wtxids (keys = SHA256(header ‖ nonce)), coinbase prefilled,
  parts of ≤ 6500 ids so each fits a Fabric frame, `BlockRelayTxResponse`
  batches, and `CompactBlockAssembly`. The assembly checks header PoW on
  construction, refuses txs whose short id does not match their slot, and
  checks the merkle and witness roots before returning block hex.
- **`services/blockRelay.js`** (`Hub#_getBlockRelay`):
  - *P0:* records ZMQ arrival before the serial block queue, plus every peer's
    `BitcoinBlock` gossip and compact arrivals, as `deltaMs` against local
    arrival. Per-peer p50/p95 and `aheadOfLocal` are served at
    **`GET /services/market/blocks`** and RPC **`GetBlockRelayStatus`**.
    Kept in memory for the last 144 tips.
  - *P1:* on a local tip, sends compact parts point to point to peers that
    have not shown the block. A received block is forwarded only after its
    header PoW passes, then rebuilt from `getrawmempool` /
    `getrawtransaction` plus a `BlockRelayTxRequest` to the sender, then given
    to `bitcoind` with `submitblock` (which fully validates it). Limits:
    8 blocks being rebuilt at once, 60 s TTL, 5 s tx-request timeout, 3 tx
    requests per peer per block.
  - Config: `bitcoin.blockRelay { enable, submit, maxBlocks, txRequestTimeoutMs }`,
    env `FABRIC_BLOCK_RELAY`. Relay is on by default except on mainnet;
    telemetry is always on.
- **`@fabric/core` `Peer`**: emits `generic` `{ type, body, origin, signer }`
  for unhandled `GenericMessage` bodies. They are not mesh-relayed, which lets
  the Hub validate before forwarding. Hub needs a core with this hook; older
  cores only lose compact relay, and telemetry still works.
- **Known limits:**
  - Managed bitcoind runs `-blocksonly=1`, so its mempool is empty and every
    transaction is fetched from the sender. Compact relay only saves bandwidth
    on Hubs with tx relay on.
  - Transactions over ~52 KB hex are not served over Fabric; the receiver
    falls back to Bitcoin P2P.
  - Telemetry is not persisted across restarts.

## 5. Recommendation and open questions

**Recommendation:** start P0 and P1 now, because they pay off even with no
market: Fabric would carry a real block, and we would have honest numbers.
Hold P2+ until P0 shows a tail that is worth paying to close. Most of the
market already exists (BID/ASK routing, `DocumentBook` ranking, channels,
markup, bonds). The pieces still missing are **push subscriptions**,
**dispatch priority**, and **Lightning hold invoices**.

Open questions:
1. Should the first buyer be pools (paying for the top tier) or small miners
   and LN nodes (paying to fix the tail)? This decides the positioning.
2. Opcode or `CONTRACT_MESSAGE` namespace for `BlockBid` long term?
3. Do we accept CLN-only for LN (hold invoices need a plugin), or abstract over
   LND/LDK early?
4. How much latency telemetry is public, and how much stays local reputation?
