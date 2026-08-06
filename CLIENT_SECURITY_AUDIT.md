# Client-Side Security Audit — hub.fabric.pub

**Date:** March 13, 2025  
**Scope:** Browser client (React UI, Bridge, components, storage, WebSocket/WebRTC)  
**Focus:** XSS, injection, sensitive data handling, authentication, storage security

---

## Executive Summary

The hub.fabric.pub client handles sensitive operations (admin tokens, identity keys, Bitcoin wallet data) and user-generated content. This audit identifies several findings across XSS, storage, and configuration security. Most issues are medium severity with clear remediation paths.

---

## 1. Cross-Site Scripting (XSS)

### 1.1 HIGH — Changelog: Unsanitized Markdown Rendering

**Location:** `components/Changelog.js` (lines 32, 35, 45, 48)

**Issue:** `marked.parse()` output is rendered via `dangerouslySetInnerHTML` without sanitization. Marked.js does **not** sanitize by default and has a history of XSS bypasses. The TODO notes "populate from GitHub releases"—once external content is used, this becomes a direct XSS vector.

```js
<span dangerouslySetInnerHTML={{ __html: marked.parse(announTitle) }} />
<span dangerouslySetInnerHTML={{ __html: marked.parse(announcement.body) }} />
```

**Recommendation:** Use DOMPurify to sanitize before rendering:

```js
const DOMPurify = require('dompurify');
// ...
<span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(announTitle || '')) }} />
```

Alternatively, render markdown as plain text or use a library with safe defaults (e.g. markdown-it with appropriate plugins).

**Note:** Changelog does not appear to be imported in active routes; it may be dead code. If removed, this finding can be closed. If retained or used for GitHub releases, sanitization is required.

---

### 1.2 LOW — browser.js: innerHTML for Relative Time

**Location:** `scripts/browser.js` (line 91)

```js
el.innerHTML = toRelativeTime(el.getAttribute('title'));
```

**Issue:** `innerHTML` is used. `toRelativeTime()` returns deterministic strings (e.g. "5 minutes ago", "just now") and does not incorporate user input. The `title` attribute is only used as a date input to `new Date()`; the output is from internal logic. **Risk is low** because the output is controlled.

**Recommendation:** Prefer `textContent` for defense in depth:

```js
el.textContent = toRelativeTime(el.getAttribute('title'));
```

---

### 1.3 SAFE — Activity Stream Chat Content

**Location:** `components/ActivityStream.js` (line 188)

```js
{content}
```

Chat content is rendered as React children (not `dangerouslySetInnerHTML`), so React escapes it. **No XSS risk** for chat display.

---

## 2. Sensitive Data Storage

### 2.1 MEDIUM — Admin Token in localStorage

**Location:** `components/HubInterface.js`, `components/Onboarding.js`

**Issue:** The admin token (Fabric Token with OP_IDENTITY) is stored in `localStorage` under `fabric.hub.adminToken`. localStorage is:

- Accessible to any script on the same origin (XSS can exfiltrate it)
- Persists across sessions
- Not protected by HttpOnly

**Recommendation:** Consider:

- `sessionStorage` for shorter-lived tokens
- Memory-only storage with refresh on page load (trade-off: token lost on refresh)
- Document that the token is a capability; if stolen via XSS, the attacker already has script access

---

### 2.2 MEDIUM — Identity Keys in localStorage/sessionStorage

**Location:** `components/HubInterface.js`, `components/IdentityManager.js`

**Issue:** Private keys (`xprv`) and encrypted identity data are stored in:

- `localStorage` (`fabric.identity.local`) — encrypted with user password when `passwordProtected`
- `sessionStorage` (`fabric.identity.unlocked`) — plaintext xprv when unlocked

**Risk:** XSS can read these. Password-protected storage uses AES-256-CBC with a key derived from user password + salt, which is reasonable for at-rest protection but does not mitigate XSS.

**Recommendation:** Document the threat model. For high-security deployments, consider Web Crypto–based key storage or hardware-backed solutions. Ensure no sensitive keys are logged.

---

### 2.3 LOW — Bitcoin Wallet Data in localStorage

**Location:** `functions/bitcoinClient.js`

**Keys:** `fabric.bitcoin.upstream`, `fabric.bitcoin.balanceCache`, `fabric.bitcoin.wallets`

**Issue:** Upstream URLs, balance cache, and wallet metadata are stored in localStorage. No private keys, but `apiToken` may be present. Balance cache could leak financial metadata.

**Recommendation:** Avoid storing `apiToken` in localStorage if it grants broad access. Consider short TTL for balance cache.

---

## 3. URL and Configuration Handling

### 3.1 LOW — Hub Address (WebSocket URL) from User Input

**Location:** `components/HubInterface.js` (line 676–691), `components/Bridge.js` (`_parseHubAddressString`, `_applyHubAddressString`)

**Issue:** The hub address is user-configurable and persisted to localStorage. It is used to construct the WebSocket URL. `_parseHubAddressString` uses `new URL()` which enforces a valid URL; invalid input returns `null` and the address is rejected. **Open redirect / SSRF risk is mitigated** by the URL parser.

**Recommendation:** Optionally restrict to `ws://` and `wss://` schemes when parsing, and validate host against an allowlist for locked-down deployments.

---

### 3.2 SAFE — Document Download / Data URLs

**Location:** `components/DocumentView.js` (lines 151–154, 169)

```js
downloadHref = `data:${mime};base64,${contentBase64}`;
imageSrc = `data:${mime};base64,${contentBase64}`;
```

**Issue:** `mime` comes from document metadata. A malicious `mime` (e.g. `text/html`) could produce a data URL that renders as HTML. However, `data:` URLs in `href`/`src` are same-origin and the content is document-owned; the main risk would be if `mime` were attacker-controlled from a different document.

**Recommendation:** Validate `mime` against an allowlist of safe MIME types before building data URLs.

---

## 4. Authentication and Token Handling

### 4.1 LOW — Token in Request Body and Header

**Location:** `components/HubInterface.js` (`_refreshAdminTokenIfNeeded`)

```js
body: JSON.stringify({ token }),
'Authorization': `Bearer ${token}`
```

**Issue:** Token is sent in both header and body. Redundant but not inherently insecure. Ensure server does not log request bodies.

---

### 4.2 SAFE — Onboarding CSRF

**Location:** `components/Onboarding.js`

**Issue:** `POST /settings` during first-time setup has no CSRF token. The operation is idempotent (returns 403 when already configured) and creates a new token. Risk is low; an attacker could trigger setup only if the hub is unconfigured.

---

## 5. WebSocket and WebRTC

### 5.1 LOW — WebSocket Message Handling

**Location:** `components/Bridge.js`

**Issue:** Incoming WebSocket messages are parsed as JSON and used to update global state. Malformed or malicious payloads could cause JSON parse errors or unexpected state. The Bridge uses `fast-json-patch` for updates; ensure patch operations are validated.

**Recommendation:** Validate JSON-RPC and patch structure before applying. Reject messages that fail schema validation.

---

### 5.2 LOW — WebRTC Signaling

**Location:** `components/Bridge.js` (SendWebRTCSignal, RelayFromWebRTC)

**Issue:** WebRTC signaling and relay flow through the hub. Ensure the hub validates and rate-limits signaling messages to prevent abuse (e.g. connection exhaustion).

---

## 6. Content Security and Headers

### 6.1 MEDIUM — No Content-Security-Policy

**Finding:** No CSP headers were found in the codebase. The client loads scripts, styles, and potentially WebSocket/WebRTC connections. Without CSP, XSS impact is higher (e.g. inline scripts, `eval`).

**Recommendation:** Add a strict CSP, for example:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss: ws:; img-src 'self' data: blob:; font-src 'self'
```

Tune `connect-src` for WebSocket/WebRTC and any external APIs. Use `report-uri` or `report-to` for monitoring.

---

### 6.2 LOW — No X-Frame-Options / X-Content-Type-Options

**Recommendation:** Add:

- `X-Frame-Options: DENY` or `SAMEORIGIN` to reduce clickjacking
- `X-Content-Type-Options: nosniff` to prevent MIME sniffing

---

## 7. Third-Party and Build

### 7.1 LOW — Webpack DefinePlugin

**Location:** `webpack.config.js`

```js
'process.env.NODE_ENV': JSON.stringify('production')
```

**Issue:** Build is always `production`. Ensure no debug endpoints or verbose errors are enabled in production.

---

### 7.2 INFO — Semantic UI Search

**Location:** `libraries/semantic/src/definitions/modules/search.js`

**Issue:** Semantic UI search uses `window.open(href)` and `window.location.href = href` for results. If `href` is user-controlled, this could be an open redirect. Verify that Semantic search is only used with trusted hrefs.

---

## 8. Summary of Recommendations

| Priority | Finding | Action |
|----------|---------|--------|
| High | Changelog XSS | Add DOMPurify or remove Changelog if unused |
| Medium | Admin token in localStorage | Document risk; consider sessionStorage or memory-only |
| Medium | Identity keys in storage | Document threat model; consider Web Crypto |
| Medium | No CSP | Add Content-Security-Policy header |
| Low | innerHTML in browser.js | Use textContent |
| Low | MIME in data URLs | Validate mime against allowlist |
| Low | Security headers | Add X-Frame-Options, X-Content-Type-Options |

---

## 9. Positive Findings

- **Activity Stream:** Chat content is rendered safely via React (no innerHTML).
- **Bridge hub address:** URL parsing rejects invalid input.
- **Identity encryption:** Password-protected identities use AES-256-CBC with salt.
- **Admin token refresh:** Token refresh uses Authorization header correctly.
- **EncodeURIComponent:** Used for route params (e.g. `/peers/${encodeURIComponent(actorId)}`).

---

## Appendix: Files Reviewed

- `scripts/browser.js`
- `components/Bridge.js` (partial)
- `components/HubInterface.js`
- `components/Onboarding.js`
- `components/Changelog.js`
- `components/ActivityStream.js`
- `components/ChatInput.js`
- `components/DocumentView.js`
- `components/IdentityManager.js`
- `functions/bitcoinClient.js`
- `functions/toRelativeTime.js`
- `webpack.config.js`
