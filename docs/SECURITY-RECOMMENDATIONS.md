# Fabric Network — security map and downstream recommendations

Date: 2026-08-19 (ET). Scope: FabricLabs/fabric, fabric-http, hub.fabric.pub, sensemaker, GoonCitizen/star-citizen-live. Remote review of public trees (no clones). Not a third-party audit.

Not this project: Fabric Foundation / ROBO / did:fabric.

---

## 1. What Fabric is

A Bitcoin-settled p2p protocol and Node library (`@fabric/core` 0.1.0-RC1). There is no global Fabric consensus. L1 finality is Bitcoin’s.

```
Identity  BIP32 m/44'/7777' (mainnet) or 7778' (else)  →  bech32m("id", SHA256(compressed_pubkey))
Funds     same master, BIP44 coin type 0               →  do not mix with identity keys
Wire      TCP:7777, noise-protocol-stream (prologue FABRIC), 208-byte AMP, BIP-340 tag "Fabric/Message"
Store     LevelDB; optional AES-CBC codec (not AEAD)
Bitcoin   bitcoind JSON-RPC + cookie; SPV stubbed
```

Default public mesh: `hub.fabric.pub:7777`. Default bind: `0.0.0.0:7777`.

NOISE static keys are ephemeral and are **not** the Fabric identity. Application authenticity is AMP Schnorr. Unsealed chat, gossip, and inventory are visible to every hop.

Closest prior art: Lightning (Noise + secp256k1 + HTLCs, **not** Sphinx), OpenBazaar (personal node + web UI + public gateway), JoinMarket (directory observer), BitAuth / LNURL-auth / Nostr NIP-42 (pubkey login).

---

## 2. Auth planes (verified)

| Plane | Hub | Sensemaker | Star Citizen Live |
|-------|-----|------------|-------------------|
| A user is | Operator (+ optional browser key) | MySQL username/email | Client-held BIP39 pubkey |
| Login | First `POST /settings` → Schnorr admin Token in `localStorage` | Password / Discord; `Token.toString()` | Unlock identity; `fabric://login` / Passport |
| Server session | None (`sessions: false`) | Cookie + Bearer; **signature not verified** | In-memory Bearer → pubkey, 24h |
| Fabric key | Node seed; browser identity optional | **One server seed** (`FIXTURE_SEED` if unset) | Encrypted `identity.json`; UI never holds seed |
| Maps Fabric id ↔ user? | Operator ≈ node | **No** | **Yes** |
| HTTP default bind | `0.0.0.0:8080` | `0.0.0.0:3040` | `127.0.0.1:3041` |
| Treats public hub as observer? | You *are* the hub | Implicit | Documented in THREAT-MODEL.md |

Hub RPC (`POST /services/rpc`) and WebSocket JSONCall have **no transport auth**. Operator power is a client-held Schnorr token (`OP_IDENTITY` / `admin`). User identity is proven locally or via BIP-340 site-login / device-link (`@fabric/http` `feature/rsi`). `X-Fabric-Signature` is declared and **never verified** in `fabric-http/middlewares/auth.js`. CORS is `*`.

IDENTITY.md HTTP headers sign **only the body** — weaker than BitAuth (URL+body) and LNURL/NIP-42 (domain + challenge).

---

## 3. Requirements for any downstream UI

1. Treat a public hub as an **unauthenticated API** and a **visible third party**. Do not assume `@fabric/http` `jsonRpc.requireAuth` applies to Hub.
2. Keep identity and spend keys **out of the web origin**. Browser `localStorage` may hold a public id or a short-lived delegation token, never the seed. Signing belongs in Electron main, Passport, or a remote signer (Nostr NIP-07/46 lesson).
3. Prove identity with **BIP-340 over a server-stored challenge** bound to method + URL + host + nonce (site-login / device-link). Do not sign only the HTTP body. Do not use `Token.toString()`.
4. Never put the hub **admin token** in a multi-user visitor app. XSS = generateblock / wallet send / self-destruct.
5. Add your own gates for Lightning, Payjoin create, and any spend. Hub does not.
6. Production: TLS at a proxy, bind HTTP to `127.0.0.1`, set `FABRIC_HUB_SETUP_UI_SECRET` before first start, never `FABRIC_DEV_PUSH_BROWSER_IDENTITY` on an exposed host.
7. If you introduce cookies: HttpOnly + Secure + SameSite=Strict, tighten CORS, add CSRF. None of that exists today.
8. Do not load untrusted Programs into `Machine` — it is host JavaScript, not a sandbox.

---

## 4. Privacy for downstream users

Fabric is **not** an anonymity system (`PRIVACY.md`). `P2P_FORWARD` is nested source routing, not BOLT4/Sphinx.

Tell users, in product copy:

- Connecting to `hub.fabric.pub` (or `relay.goon.vc`) reveals IP, Fabric id, and any unsealed bodies (chat, missions, documents).
- A hosted Sensemaker is a conventional SaaS IdP: the operator sees chats, documents, emails, Discord tokens, and can impersonate users while session tokens are unsigned.
- WebRTC signaling (Hub Bridge) can leak the operator’s public IP via STUN (RFC 8828). Disable unless the user opted into mesh.
- LLM vendors, Discord, and email processors see content that leaves the node.
- Electrum-class trust: any HTTP path that asks a public hub for Bitcoin state can omit or lie. Keep L1 verify local.

Operator defaults that actually protect people: personal hub; public hub as bootstrap only; sealed documents / GroupChat v2 for anything private; `Referrer-Policy: no-referrer`; no user HTML in the operator console; no secrets in `localStorage`.

---

## 5. Priority work (project)

### P0 — treat as broken if exposed

1. **Stop using `Token.toString()` for auth.** Core `types/token.js` MACs JWT-shaped output with hardcoded `ffff`. Sensemaker `routes/sessions/create_session.js` issues exactly that (`TODO: sign token`) and `_userMiddleware` does not verify a signature. Switch to `toSignedString` / `verifySigned` (or drop Token and use a real server session).
2. **Sensemaker user dumps.** `GET /users` lists emails and admin flags with no auth (`routes/users/list_users.js`). `GET /users/:username` has the auth block commented out and `res.send(user)` of the full DB row (`routes/users/view_user.js`).
3. **Sensemaker disk routes.** `GET /services/disk` and `GET /services/disk/:path` are unauthenticated; the latter concatenates a request path (commented `TODO: secure this endpoint`).
4. **Committed Sensemaker `settings/local.js`.** Redis Cloud URL with embedded password, plus other operator secrets. Rotate that Redis credential. Stop committing gitignored settings.
5. **Hub Lightning / Payjoin / `GET /settings`.** Unauthenticated Lightning mutations if CLN is up; Payjoin session create can allocate a hub wallet address; `GET /settings` returns the full settings map (may include Bitcoin RPC credentials submitted at setup).

### P1 — architecture debt that will bite

6. Bind Hub and Sensemaker HTTP to loopback in production docs **and** defaults (SCL already does).
7. Enable Hub WS/RPC transport auth (`FABRIC_WS_REQUIRE_TOKEN`, method-level admin checks). Tighten CORS from `*`.
8. Bind IDENTITY.md / HTTP signatures to method+URL+host+nonce, or adopt LNURL-auth / NIP-42. Verify `X-Fabric-Signature` if the header is advertised.
9. NOISE static should be the Fabric identity (or libp2p-style: separate Noise static, signature over handshake transcript). Today a MITM can see/drop/delay unsealed traffic.
10. Replace Store/Codec AES-CBC with AES-GCM. Do not use `Key#deriveAddress('p2tr')` for funds (tweak is not BIP341 TapTweak).
11. Sensemaker cookies: HttpOnly / Secure / SameSite (client already has the TODO). Do not set tokens from JS.
12. Do not default Sensemaker identity to `FIXTURE_SEED`. Do not `console.debug` seed/xprv. Do not log in HTML with `FABRIC_DEV_PUSH_BROWSER_IDENTITY` on a public host.
13. `Capability#_generateToken` hardcoded macaroon `rootKey: 'secret'`. `Session.encrypt`/`decrypt` are no-ops. Confirm no consumer treats them as real.

### P2 — privacy and product honesty

14. SCL README still says “Fabric-free.” Fix that. Operators will misconfigure if they believe there is no mesh.
15. Default SCL hubs read global chat and mission offers. Prefer GroupChat v2 seals; E2E DirectChat is already on their follow-up list.
16. Passport (`FabricLabs/fabric-browser-extension`) is the right custody home for web login. Keep seeds out of Sensemaker’s stub `KeyManagementModal`.
17. Empty Sensemaker `documents/privacy-policy.md` — do not ship a hosted instance without saying who sees what.
18. Outstanding: third-party review of `peer.js`, HTLC/P2TR helpers, sealed exchange. In-repo AUDIT.md is honest that this is experimental.

---

## 6. What good looks like

Star Citizen Live is the aligned consumer: per-player key, encrypted at rest, site-login Schnorr, allowlisted hubs, loopback HTTP, honest threat model. Sensemaker is the anti-pattern: password SaaS in front of a single node key, with Fabric used as transport for the operator, not the user.

New UIs should copy SCL (and Hub site-login / device-link / Passport), not Sensemaker.

---

Sources: public READMEs, IDENTITY/SECURITY/PRIVACY/AUDIT, fabric-http `middlewares/auth.js` + `feature/rsi` site-login, hub `services/setup.js` + `services/hub.js` + SECURITY.md, Sensemaker session/user/disk routes + `authActions.js` (verified raw), SCL `docs/THREAT-MODEL.md` (verified raw).

---

## 7. Status on local trees (2026-08-19)

Re-checked against clones (not a new remote audit). **Do not** treat this as closing Hub/http login-redeem Highs.

| # | Original rec | Status |
|---|--------------|--------|
| P0-1 Token.toString auth | **Closed for Sensemaker.** Sessions use node-signed Schnorr (`issueNodeSessionToken`). Core `Token.toString()` still exists as a non-auth scaffold (`ffff` MAC); `verifySigned` rejects it. |
| P0-2 user dumps | **List** is admin-gated. **View** no longer returns the password hash; public JSON is a card; email/admin flags need self or admin. |
| P0-3 disk routes | **Gated** (admin JSON) + path containment / symlink realpath. |
| P0-4 committed `settings/local.js` | **Still tracked** despite `.gitignore`. Local file still has a Redis Cloud URL. **Rotate that credential.** `git rm --cached settings/local.js` when you next commit. Do not commit the file. |
| P0-5 Hub Lightning / Payjoin / settings | **Partial.** `BITCOIN_PASSWORD` redacted on unauthenticated GET. Live Lightning mutations need admin Bearer. Payjoin Hub-wallet address allocation needs admin. Stub Lightning and client-supplied Payjoin addresses stay open. GET Lightning status remains public. |
| P1-6 loopback defaults | SCL already loopback. Hub production docs now say bind `127.0.0.1` behind Caddy; constructor default is still `0.0.0.0`. Sensemaker HTTP default still `0.0.0.0`. |
| P1-7 WS token / CORS | Shared-mode WS already fail-closes without a token. Do not throw at Hub startup. CORS `*` remains. |
| P1-8 X-Fabric-Signature | Header is **declared and unused**. Middleware does not verify it. Do not invent site-login possession proof. |
| P1-9 NOISE = identity | **Skip** (architecture). |
| P1-10 AES-GCM / p2tr tweak | **Skip**. |
| P1-11 Sensemaker cookies | **HttpOnly + SameSite=strict**; Secure on HTTPS / `X-Forwarded-Proto`. |
| P1-12 FIXTURE_SEED / seed logs | Production **refuses** FIXTURE_SEED. Debug log no longer prints seed/xprv. `settings/local.js` still falls back to FIXTURE_SEED locally. |
| P1-13 Capability / Session.encrypt | Documented as scaffolds / no-ops. Tests still lock the macaroon fixture. |
| P2-14 SCL “Fabric-free” | **Closed.** README describes the Fabric Peer. |
| P2-15 GroupChat v2 seals | Not a one-line fix. |
| P2-16 Passport custody | Still the right home. |
| P2-17 empty privacy policy | **Filled** (`documents/privacy-policy.md`). |
| P2-18 peer.js third-party review | Outstanding. |

