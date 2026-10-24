# Fabric Message envelope (v1)

JSON inside a **`GenericMessage`** body, keyed by **`@fabric/MessageEnvelope`: `"1"`**.

| Field | Purpose |
|--------|---------|
| `encryption` | `"none"` (default flows) or `"chacha20-poly1305-v1"` (`ciphertextHex`, `nonceHex` required). |
| `author` | Logical author for privacy/Taproot: `kind` + `hex` (32-byte pubkey hash, 64 hex chars). Use `taproot_contract_pubkey_hash` for contract-bound paths. |
| `signers` | Multisig / MuSig: `{ role, pubkeyHashHex?, mustSign?, notified? }[]`. |
| `display.prompt` | Shown before the message (e.g. “… would like you to sign the following message:”). |
| `intent` | Machine-readable reason (`contract_sign_request`, …). |

**Opaque links:** `fabric:<frame>` (no `//`): the whole `Message.toBuffer()`, base64url (canonical) or hex. Readers use `@fabric/core` `decodeFabricUri` (`functions/fabricUri`), which checks magic, size, body hash, a known type, and the BIP340 author signature when the frame is signed, and reports `signed` + `author`. A frame is the message and its proof together, so a `fabric:` string can cross a page, the extension, a native app, or a QR code and be checked on arrival. **Legacy:** `fabric://login?…`, `fabric://message?hex=…`.

## Site login over `fabric:`

| Type | Opcode | Body | Signed by |
|------|--------|------|-----------|
| `SiteLoginRequest` | `0x4230` | `origin`, `nonce`, `issuedAt`, `expiresAt`, `purpose` | the site (optional) |
| `SiteLoginResponse` | `0x4231` | `origin`, `nonce`, `issuedAt`, `expiresAt`, `identityId`, `pubkey`, `signer`, `xpub`, `crossSign` | the identity logging in |
| `FabricSignRequest` | `0x4232` | `origin`, `nonce`, `issuedAt`, `expiresAt`, `inner` (the `SiteLoginRequest` frame) | a device linked to the desktop |

Lifetimes are capped at 5 minutes (`SITE_LOGIN_MAX_TTL_MS`). A page asks Passport for a login to **itself**; Passport binds the request to the origin the browser reports. Passport answers itself, or wraps the request in a `FabricSignRequest` and asks a linked desktop at `POST /services/fabric/sign` (Hub on 8080, GoonCitizen on 3041). The page verifies with `verifySiteLoginResponse(fabric, { origin, nonce })`. Builders and verifiers: `@fabric/core` `functions/fabricSiteLogin`; the desktop routes: `@fabric/http` `functions/fabricLocalSigner`.

**Execution contracts:** `DelegationSignRequest` step + `RunExecutionContract` → `fabricMessageWireHex` + optional modal via `fabric:delegationSignRequest`.
