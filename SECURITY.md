# Security (`@fabric/hub` / hub.fabric.pub)
Rendezvous hub, browser gateway, and Bitcoin-facing operator surface.

## Adversarial environment
Fabric networks are intended for deployment where **peers, relays, hubs, and operators may be hostile**. Design and review against:

- Untrusted TCP / WebSocket / WebRTC neighbors (forgery, replay, amplification, pin hijack)
- Phishing of identity flows (`fabric://login`, device-link) toward attacker-controlled hubs
- Public observability of unsigned or plaintext application traffic unless an explicit seal is used
- No reliance on an “honest majority” of random internet peers for key custody

Hub admin capabilities (Beacon accept, generateblock, wallet spend, **regtest faucet**) require possession of the operator admin token / Schnorr proofs — never expose those to untrusted browsers. Regtest faucets are local/dev only and still require the admin token on `POST /services/bitcoin/faucet`. WebRTC `RelayFromWebRTC` must not Hub-re-sign client `BitcoinBlock` / unsigned `CONTRACT_MESSAGE` JSON.

**Basics coverage:** [`tests/adversarialEnvironment.basics.test.js`](tests/adversarialEnvironment.basics.test.js). Related: [`tests/fabricHubAllowlist.test.js`](tests/fabricHubAllowlist.test.js).

## Trust notes
- Admin token is client-held after first-time setup; treat XSS on the Hub UI as critical.
- Document market / inventory HTLC must rebuild buyer-bound addresses before funding (see `@fabric/core` SECURITY.md).
- Shared HTTP bind and public peering advertisement expand the attack surface — default carefully on production hosts.
- `bitcoinClient` attaches `hubAdminToken` only for Hub `/services/bitcoin` bases; explorer/payments URLs use `apiToken` only.
- **Fabric hallmarks** (`bitcoin.hallmarks` / `FABRIC_HALLMARKS`) spend wallet UTXOs when enabled (regtest); off by default. Commitment digests are public on L1 by design — never enable on mainnet until fee/policy review.

## Outstanding (PR #15 / RSI follow-ups)
- **Identity import** — xprv imports should persist through the encrypted identity path (not watch-only `id`/`xpub`) and restore locked/unlocked per password flow (heavy lift; extension sync no longer writes unlocked `xprv`/`masterXprv`).
- ~~**Encrypted backup export**~~ — primary “Download encrypted backup” requires an unlocked signing `xprv` (watch-only disabled + labeled).
- **Large WIP split** — PR #15 still spans far more than review-tool limits; land remaining RSI work as stacked PRs (identity, Bitcoin/HTLC, WebRTC, docs).
- **`GenericMessage` / WS** — see [MESSAGE_TRANSPORT.md](MESSAGE_TRANSPORT.md); prefer named AMP types on public hubs.
- ~~**`@fabric/core` / `@fabric/http` pin hygiene**~~ — pins: core `3c963834…`, http `68099636…` (refreshed via `feature/rsi`; plain `report:install` keeps the lockfile — bump with `npm install …#feature/rsi --allow-git=all`). Keep `package.json` on moving `feature/rsi` during RSI; re-pin releases to lockfile SHAs.
- ~~**Fabric coin types**~~ — `functions/fabricAccountDerivedIdentity.js` uses core `fabricIdentityDerivationPath` (default **7778**; optional `mainnet` / **7777**). Wire Hub UI / bitcoin network into that optional arg where product wants mainnet identity paths.
- **Site-login / device-link Origin gates** — inherited from `@fabric/http` (forgeable Origin/Referer for session/device-link redeem on shared hosts; Hub self-sign is now opt-in + loopback-only in http). Prefer possession proofs before production shared bind; cleartext production hubs are no longer default-allowlisted. Remaining http follow-ups: always-fresh device-link nonce (reject client-supplied), bind `sessionId` into link messages in a coordinated client bump, per-origin create quota.
- **Payment test route** — Hub defaults `exposePaymentTestRoute` **off**; set `FABRIC_HTTP_PAYMENTS_EXPOSE_TEST_ROUTE=1` (or legacy `FABRIC_HTTP_PAYMENTS_HIDE_TEST_ROUTE=0`) when needed for local 402 checks.
- ~~**Wallet summary cache**~~ — `fetchWalletSummaryWithCache` honors `bypassCache` / `maxCacheAgeMs` on the failure-fallback read path.
- ~~**HTLC key reveal chat**~~ — inbound `HTLC_KEY_REVEAL` is relay-only (no `_cacheChatMessage` / WS broadcast); inventory settlements retain `documentContentKey.readContentKey` as `preimageHex`.
- ~~**UI flag fetch**~~ — `fetchPersistedHubUiFeatureFlags` normalizes the server payload directly (no stale localStorage merge).
- ~~**Peer alias attribution**~~ — WebRTC aliases bind to the session peer id; hub-wire AMP aliases bind to `message.author` (not local identity).
- ~~**Tracked application contract keys**~~ — reject `__proto__` / `constructor` / `prototype` ids; pending republish must match signer/origin/definitionDigest.
- ~~**Setup status safety timer**~~ — timeout no longer flips `setupChecked` (avoids skipping onboarding); Retry stays on the loading gate.
- ~~**Beacon federation round close**~~ — core tip `addSignature` rejects further sigs when status is `ready` or `sealed`; Hub `createRound` wrapper defaults omitted `policy` to `{}`. Hub Beacon **finalizes** already-`ready` rounds on retry instead of returning `round not open`.
- **Local identity at-rest** — fresh identity save still uses `encryptLocalIdentityAtRest`; migrate to the stronger PBKDF2+AES-GCM backup scheme (heavy lift).
- **Docs index polish** — keep `docs/SIDECHAIN_AND_EXECUTION_INDEX.md` / ADR-001 path names aligned with current Hub/core modules when touching sidechain docs.
- **`extract-zip` (puppeteer / electron)** — GHSA-jmr9-qjv8-65gv; no patched release. Accepted for build/dev browser download; not on the Hub request path.

## Process
1. `npm run test:unit` (or `npm test`) before release.
2. Never commit `FABRIC_XPRV`, admin tokens, or production stores.
3. Review `@fabric/core` SECURITY.md when bumping Fabric deps.

## Disclosure
Canonical monitored contact: **`security@fabric.pub`**. GitHub Security Advisories and the repository issue tracker (`FABRIC_ISSUES_URL`) are alternate private channels.
