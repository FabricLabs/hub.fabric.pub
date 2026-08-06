# Document publish envelope & L1 payment binding

Hub-facing notes for hashing a stored document into buy / HTLC commitments.
Canonical crypto lives in **`@fabric/core`**.

**Buy / HTLC commitment (single path):** `@fabric/core/functions/documentPaymentHash`
→ `resolveDocumentContentHashHex`. Wire field: **`contentHashHex`**.

## Binding modes

| Mode | Preimage | Payment hash (`contentHashHex`) |
|------|----------|----------------------------------|
| **Sealed (priced)** | Content key `K` (AES-256-GCM) | `SHA256(K)` |
| **Legacy unsealed envelope** | `SHA256(unsigned DocumentPublish AMP bytes)` | `SHA256(preimage)` |
| **Unsealed blob** | (per-blob settle) | `blobPaymentHashHex` |

### Unsigned envelope (legacy)

1. Build **unsigned** AMP bytes via `documentPublishEnvelopeBuffer` — signature
   field **must** be all zeros.
2. Preimage = `SHA256(those bytes)`.
3. `purchaseContentHashHex` = `SHA256(preimage)`.

Do **not** hash a Schnorr-**signed** gossip `DocumentPublish` frame — signing
changes bytes 144–207 and diverges from the payment commitment.

## API (`@fabric/core/functions/*`)

| Export | Purpose |
|--------|---------|
| `documentPaymentHash` | `resolveDocumentContentHashHex`, alias normalize |
| `publishedDocumentEnvelope` | Unsigned envelope + legacy `purchaseContentHashHex` |
| `documentContentKey` / `documentSealedExchange` | AES-GCM seal; `paymentHashHexFromKey` |
| `inventoryHtlc` | P2TR HTLC build / claim / refund |

Hub `functions/*.js` files are thin re-exports of the above.

## Consumption

- Hub invoice / inventory HTLC / ClaimPurchase use `documentPaymentHash`.
- **@fabric/http** — `X-Fabric-Payment-Request` `documentOffer.contentHashHex` must
  be the resolved commitment (never file `sha256`).

## Tests

- Core: `tests/l1.document.exchange.expectations.js`, `tests/functions.documentPaymentHash.js`
- Hub: `tests/inventoryHTLC.test.js`, `tests/documentContentKeyHtlc.test.js`

## See also

- [L1 document exchange](L1_DOCUMENT_EXCHANGE.md)
- [INVENTORY_HTLC_ONCHAIN.md](../INVENTORY_HTLC_ONCHAIN.md)
- [PAYMENTS_PROTOCOL.md](../PAYMENTS_PROTOCOL.md)
- Core [`docs/PAYMENTS_DOCUMENT_BINDING.md`](https://github.com/FabricLabs/fabric/blob/master/docs/PAYMENTS_DOCUMENT_BINDING.md)
