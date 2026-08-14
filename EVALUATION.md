# hub.fabric.pub — First-Principles Evaluation

**Purpose:** Evaluate the Hub as a flagship example project for Fabric.
**Focus:** Security, code quality, de-duplication, functionality, and simplicity.

---

## 1. Executive Summary

The Hub is a well-architected Fabric rendezvous node with clear separation of concerns. Core security (admin token, input validation, timing-safe comparison) is in place. Several improvements will strengthen it as a flagship example: remove dead code with XSS risk, consolidate validation, add security headers, and simplify the route surface.

---

## 2. Security Assessment

### 2.1 Implemented ✓

| Area | Implementation |
|------|----------------|
| **Admin auth** | SetupService: Schnorr-signed tokens via `Token.verifySigned`; client-only, never stored |
| **Protected routes** | `PUT /settings/:name`, `POST /services/bitcoin/blocks`, `generateblock` RPC require admin token |
| **Input validation** | Peer addresses: `PEER_ADDRESS_RE`, `MAX_ADDRESS_LENGTH` (256); document size: `MAX_DOCUMENT_BYTES` (8 MiB) |
| **Timing safety** | `crypto.timingSafeEqual` for legacy token comparison in SetupService |
| **L1 payment verification** | `_verifyL1Payment` checks txid, address, amount via bitcoind RPC |
| **Bitcoin address validation** | `bitcoin.validateAddress()` for faucet/send; network-specific hints |

### 2.2 Gaps Addressed

| Finding | Severity | Action |
|---------|----------|--------|
| Changelog: unsanitized `dangerouslySetInnerHTML` + `marked.parse` | High | Remove (dead code, not imported) |
| browser.js: `innerHTML` for relative time | Low | Use `textContent` for defense in depth |
| No X-Frame-Options / X-Content-Type-Options | Low | Add security headers in HTTP server |

### 2.3 Documented Trade-offs

- **JSON-RPC / WebSocket:** Unauthenticated by design; intended for trusted/dev environments (see hub.js JSDoc).
- **Admin token in localStorage:** XSS can exfiltrate; document that stolen token implies script access.
- **Identity:** All identity uses **secp256k1** (ECC) via `@fabric/core` Key/Identity. Removed unused RSA-based `services/identity.js`, `services/crypto.js`, `services/storage.js`.

---

## 3. Code Quality

### 3.1 Strengths

- **Consistent response helpers:** `_jsonOrShell`, `_jsonOnly` centralize JSON/HTML and error handling.
- **Validation patterns:** `_normalizePeerInput`, `PEER_ADDRESS_RE` used consistently.
- **Service split:** Hub, SetupService, PayjoinService, FabricService have clear roles.

### 3.2 De-duplication Opportunities

| Pattern | Occurrences | Recommendation |
|---------|-------------|----------------|
| Document size check | 4 places (CreateDocument, PublishDocument, CreateStorageContract, P2P file) | Add `_validateDocumentSize(buf)` helper |
| Route format (list/view) | list_peers, list_documents, list_contracts, view_* | Already use `res.format`; consider shared factory if more routes added |

### 3.3 Dead / Stub Code

| Item | Status | Recommendation |
|------|--------|-----------------|
| `Changelog.js` | Not imported; uses `Message`, `marked` without imports (would fail) | Remove |
| `_handleContractListRequest`, `_handleContractViewRequest` | Never registered; routes use ROUTES.contracts.* | Remove from hub.js |
| ~~`services/identity.js`, `services/storage.js`, `services/crypto.js`~~ | ~~RSA-based~~ | **Removed** — unused; Identity uses @fabric/core secp256k1 |
| REST create routes (contracts, documents, peers, messages) | Return "Not yet implemented" | Document that JSON-RPC is primary; keep stubs or remove routes |

---

## 4. Functionality

### 4.1 Working

- Peer discovery, add/remove, chat, file send
- Document create/list/get/publish via JSON-RPC
- Bitcoin status, blocks, faucet, block generation (admin), Payjoin
- Settings bootstrap, refresh, admin-protected PUT
- WebRTC mesh, relay from WebRTC to P2P

### 4.2 Stub / Partial

- REST `POST /contracts`, `POST /documents`, `POST /peers`, `POST /messages` → "Not yet implemented"
- REST `view_peer`, `list_messages`, `view_message` → "Not yet implemented"
- Documents REST list uses `this.state.documents` (in-memory); JSON-RPC uses Filesystem

---

## 5. Streamlining Recommendations

1. **Remove dead Changelog** — Eliminates XSS risk, reduces confusion.
2. **Fix browser.js innerHTML** — Use `textContent` for relative-time updates.
3. **Add `_validateDocumentSize`** — Single helper for all document/file size checks.
4. **Add security headers** — `X-Frame-Options`, `X-Content-Type-Options` in HTTP middleware.
5. **Remove unused hub handlers** — `_handleContractListRequest`, `_handleContractViewRequest`.
6. **Clarify REST vs RPC** — In AGENTS.md: JSON-RPC is primary; REST is supplementary. Stub routes can stay for future use or be removed.

---

## 6. Flagship Checklist

| Criterion | Status |
|-----------|--------|
| Clear architecture | ✓ |
| Security basics (auth, validation, timing-safe) | ✓ |
| No known XSS vectors | ✓ (after Changelog removal) |
| Minimal dead code | Pending cleanup |
| Consolidated validation | Pending `_validateDocumentSize` |
| Security headers | Pending |
| Documented trade-offs | ✓ (AGENTS.md, CLIENT_SECURITY_AUDIT.md) |

---

## 7. Files Modified (This Pass)

- `components/Changelog.js` — Removed (dead, XSS risk)
- `scripts/browser.js` — innerHTML → textContent for relative-time updates
- `services/hub.js` — Add `_validateDocumentSize`, consolidate 4 size checks, remove dead `_handleContractListRequest`/`_handleContractViewRequest`, add security headers middleware
