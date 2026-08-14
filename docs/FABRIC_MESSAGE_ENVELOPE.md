# Fabric Message envelope (v1)

JSON inside a **`GenericMessage`** body, keyed by **`@fabric/MessageEnvelope`: `"1"`**.

| Field | Purpose |
|--------|---------|
| `encryption` | `"none"` (default flows) or `"chacha20-poly1305-v1"` (`ciphertextHex`, `nonceHex` required). |
| `author` | Logical author for privacy/Taproot: `kind` + `hex` (32-byte pubkey hash, 64 hex chars). Use `taproot_contract_pubkey_hash` for contract-bound paths. |
| `signers` | Multisig / MuSig: `{ role, pubkeyHashHex?, mustSign?, notified? }[]`. |
| `display.prompt` | Shown before the message (e.g. “… would like you to sign the following message:”). |
| `intent` | Machine-readable reason (`contract_sign_request`, …). |

**Opaque links:** `fabric:<Message.toBuffer() as hex>` (no `//`). **Legacy:** `fabric://login?…`, `fabric://message?hex=…`.

**Execution contracts:** `DelegationSignRequest` step + `RunExecutionContract` → `fabricMessageWireHex` + optional modal via `fabric:delegationSignRequest`.
