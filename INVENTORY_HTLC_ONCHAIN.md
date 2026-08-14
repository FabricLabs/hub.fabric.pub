# Inventory P2TR HTLC — on-chain reference

This supplements [PAYMENTS_PROTOCOL.md](PAYMENTS_PROTOCOL.md). The Hub’s **phase 2** is off-chain file delivery after L1 funding is verified; **moving coins on-chain** (seller claim or buyer refund) is manual today.

## Output structure

- **Internal key (NUMS):** fixed x-only pubkey `50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0` (same as `inventoryHtlc.TAPROOT_INTERNAL_NUMS` in code). Key-path spends are not used for the happy path.
- **Script tree (two tapleaves):**
  1. **Claim (seller):** `OP_SHA256 <32-byte hash> OP_EQUALVERIFY <seller_xonly_32> OP_CHECKSIG`
     Witness stack order for script satisfaction: `[schnorr_sig_64_or_65, preimage_32, ...controlBlock]`.
  2. **Refund (buyer):** `<lockheight> OP_CHECKLOCKTIMEVERIFY OP_DROP <buyer_xonly_32> OP_CHECKSIG`
     Spending tx **nLockTime** must be ≥ `lockheight` (block height mode).

Construction matches `functions/inventoryHtlc.js` (`buildInventoryHtlcP2tr`).

## Funding (buyer)

- Prefer **`bitcoinUri`** / **`amountBtc`** from the inventory `htlc` object (BIP21). Wallets vary in Taproot URI support; fallback: paste **`paymentAddress`** and send **at least** **`amountSats`**.
- **Fees** are not included in the invoice amount; the buyer’s wallet deducts fees from inputs.

## Seller claim (after buyer funded)

**Priced sealed documents (Document market):** on `PublishDocument` with `purchasePriceSats > 0`, the Hub seals plaintext with a random 32-byte content key **`K`** (AES-256-GCM ciphertext-at-rest; key stored only under `documents/{id}.content-key`). The HTLC hashlock preimage is **`K`** (`paymentHash = SHA256(K)`). After `ConfirmInventoryHtlcPayment`, the seller sends ciphertext via `P2P_FILE_SEND` and reveals **`K`** to the buyer with a separate **`HTLC_KEY_REVEAL`** chat payload (never embedded in relayed file chunks). The Bridge auto-unlocks with `unlockHtlcEncryptedDocument`.

**Legacy unsealed documents:** the preimage is **deterministic**: `SHA256` of the
**unsigned** Fabric `DocumentPublish` envelope from
`documentPublishEnvelopeBuffer` (AMP header with **zero signature** — never a
Schnorr-signed gossip `toBuffer()`). See **`@fabric/core/functions/publishedDocumentEnvelope`**
and **`documentPaymentHash.resolveDocumentContentHashHex`**. JSON-RPC
`CreatePurchaseInvoice` / `ClaimPurchase` bind `contentHash` to `SHA256(K)` for
sealed docs, or the envelope payment hash for legacy docs.

The preimage is **sensitive** until revealed to the paying buyer (and/or on-chain in the seller claim witness). Operators can retrieve script material for external signing:

- **JSON-RPC (WebSocket):** `GetInventoryHtlcSellerReveal` with params `{ settlementId, adminToken }` (same admin capability as hub setup).
  Response `type: GetInventoryHtlcSellerRevealResult` includes `preimageHex`, `claimScriptHex`, `numsInternalPubkeyHex`, `sellerPublicKeyHex`, `paymentAddress`, etc.

**Do not** log or broadcast the preimage. Anyone with the preimage can satisfy the hash leg (in combination with a valid seller signature).

Building a full Taproot script-path spend requires:

- `bitcoinjs-lib` (or Bitcoin Core `converttopsbt` / wallet workflows) with **tapleaf hash**, **Merkle path**, **control block**, and **Schnorr** signature for the seller key on the sighash.
- Reference: bitcoinjs [Taproot PSBT](https://github.com/bitcoinjs/bitcoinjs-lib/blob/master/test/psbt.spec.ts) patterns for `tapLeafScript` / `tapInternalKey`.

The Hub can **broadcast the seller claim** after funding: JSON-RPC **`ClaimInventoryHtlcOnChain`** with `{ settlementId, adminToken, toAddress? (default: hub wallet new address), feeSats? }`. It builds a tapscript-path spend (same leaf as `claimScriptHex`), signs with the **hub Fabric identity** key (must match `sellerPublicKeyHex` on the settlement), and calls `sendrawtransaction`. **`GetInventoryHtlcSellerReveal`** includes `claimTxid` when set.

Buyer **refund** (CLTV path) is still manual — different key material and `nLockTime`.

## Buyer refund

After **chain height** ≥ `refundLockHeight` (from `htlc` / seller reveal), the buyer constructs a transaction with `nLockTime = refundLockHeight`, spends via the **refund** leaf with their key. Wallet must allow setting nLockTime and RBF as needed.

## Relayed inventory (multi-hop)

Listing metadata can traverse an intermediate Fabric peer: the buyer’s hub sends `RequestPeerInventory` to the **next hop** with `inventoryTarget` set to the **seller’s** Fabric id; each intermediate hub re-forwards `INVENTORY_REQUEST` until it reaches the seller. `INVENTORY_RESPONSE` is forwarded back using its `target` field (original requester’s Fabric id); the seller **always replies on the TCP session that delivered the request** (so relayed requests still get a response on the correct link).

**HTLC phase 2** — After payment, the seller hub sends `P2P_FILE_SEND` chunks with `deliveryFabricId` (buyer’s Fabric id) and `fileRelayTtl` when the HTLC was negotiated over a relay (`relayReturnHop` stored server-side). Intermediaries forward chunks toward `deliveryFabricId` without storing the file; TTL (default 8, max 16) decrements per hop. Direct buyer–seller sessions omit relay fields (legacy path).

Payloads for inventory HTLC settlement use **AES-256-GCM**. For **sealed** docs the hub sends ciphertext-at-rest with the seal IV in `htlcFileV1` (no second encrypt). For **legacy** docs it encrypts transit bytes with a random IV; the key is the HTLC preimage. The browser stores ciphertext until **`HTLC_KEY_REVEAL`** delivers the preimage (auto-unlock), or the operator pastes the preimage manually; it then decrypts and re-encrypts with the local identity document key as usual.

**Trust** — Relays see **ciphertext** for HTLC phase 2 (and inventory metadata), but **must not** see `HTLC_KEY_REVEAL.preimageHex` in file chunks (reveal is a separate buyer-targeted message, hop-forwarded like inventory). `SendPeerFile` / non-HTLC transfers may still be plaintext. Use only with operators you accept as transport. Admin RPC `GetInventoryHtlcSellerReveal` includes `relayReturnHop` / `requesterFabricId` when present for debugging path selection.

## Verification vs spend

- **`ConfirmInventoryHtlcPayment`** only checks that a **confirmed or visible** transaction pays **`paymentAddress`** at least **`amountSats`** (`getrawtransaction` on seller’s `bitcoind`).
- Separate **confirmation depth** policy is not enforced in this version.
