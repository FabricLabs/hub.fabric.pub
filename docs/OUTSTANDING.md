# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Operator deploy: [PRODUCTION.md](PRODUCTION.md). Product roadmap: [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md). Core class-surface march: [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-14 (Hub `3cc43d1` + this slice, core lockfile `ab0acf77b`, http lockfile `270ebbb`).

## Blockers before production shared bind
1. **Inherited login/link redeem** — QR `sessionId` + forgeable Origin is still the capability ([`@fabric/http` OUTSTANDING](https://github.com/FabricLabs/fabric-http/blob/feature/rsi/docs/OUTSTANDING.md)). Hub desktop `allowHubSelfSign` defaults on; http **loopback-gates** the sign so public `hub.fabric.pub` cannot remote self-sign.
2. **Identity import** — xprv imports should persist through the encrypted identity path (not watch-only `id`/`xpub`) and restore locked/unlocked per password (heavy lift).
3. **At-rest identity KDF** — migrate fresh save from current `encryptLocalIdentityAtRest` to the stronger PBKDF2+AES-GCM backup scheme.

## Next slices
- [ ] Always-fresh device-link nonce (reject client-supplied) — coordinated with http.
- [ ] Named AMP types on public Hub UI WebSocket (`GenericMessage` remaining).
- [ ] Split [PR #15](https://github.com/FabricLabs/hub.fabric.pub/pull/15) (review tools skip at 100+ files; Codacy reports a 100-issue cap on the whole PR).

## Closed this pass (do not re-open)
- SPA `manifest.json` same-origin `/bundles/browser.min.js` (human “Terrible URI”).
- Identity cluster HTTP ingest + package exports; device-link re-exports http thin-client Origin helpers.
- IdentityCrossSign / verify re-export `@fabric/core` (commit/push core before Hub CI, or `npm link @fabric/core`).
- Playnet `--production` (`hub.fabric.pub` + `relay.goon.vc`); document market helper export.
- HTTPS-only default hub allowlist; Hub self-sign remote path closed in http.
- Test workflow `hub/.nvmrc`; leftover bitcoinClient `hubAdminToken` on payments URLs; `verifyAdminToken` cap/sub; backup KDF import bounds.
- Dev-seed wipe marker is only cleared when restoring **that** seed (importing another mnemonic leaves suppression in place).
- Managed regtest attach-on-lock: cookie RPC probe + one spawn-failure retry; do not SIGKILL an attached orphan (`functions/bitcoinManagedAttach.js`). Heap OOM that orphaned Core remains a follow-up (teardown cannot run after V8 abort).
- Device-link per-origin create quota lives in `@fabric/http` `fabricDeviceLinkHttp` (Hub re-exports `MAX_SESSIONS_PER_ORIGIN` / `evictDeviceLinkOriginOverflow`).
- Expired `GET /sessions/:delegationToken` requires matching Bearer (http pin `270ebbb`).

## PRs
[#15](https://github.com/FabricLabs/hub.fabric.pub/pull/15) — only human inline comment was Terrible URI (fixed). Most June/July CodeRabbit “quick wins” are already in tree (`waitForHub` request timeout, wallet-cache `maxCacheAgeMs`, crowdfund BIP44 account, document upload race / `response.ok`, chrome.storage watch-only, `masterXpub` label, explorer admin token, UI flag normalize, payment test route opt-in, `verifyAdminToken` cap/sub, Semantic sync try/catch). Remaining open: identity import/KDF, login redeem (http), device-link nonce/`sessionId` bind, PR split. Pin `@fabric/core` / `@fabric/http` via lockfile (`#feature/rsi` + `npm run report:install`), currently core **`ab0acf77b`** / http **`270ebbb`**.
