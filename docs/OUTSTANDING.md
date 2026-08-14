# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Operator deploy: [PRODUCTION.md](PRODUCTION.md). Product roadmap: [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md). Core class-surface march: [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-14 (Hub `5441f838` + this slice, core `39bfbcb7b`, http `17abf49`).

## Blockers before production shared bind
1. **Inherited login/link redeem** — QR `sessionId` + forgeable Origin is still the capability ([`@fabric/http` OUTSTANDING](https://github.com/FabricLabs/fabric-http/blob/feature/rsi/docs/OUTSTANDING.md)). Hub desktop `allowHubSelfSign` defaults on; http **loopback-gates** the sign so public `hub.fabric.pub` cannot remote self-sign.
2. **Identity import** — xprv imports should persist through the encrypted identity path (not watch-only `id`/`xpub`) and restore locked/unlocked per password (heavy lift).
3. **At-rest identity KDF** — migrate fresh save from current `encryptLocalIdentityAtRest` to the stronger PBKDF2+AES-GCM backup scheme.

## Next slices
- [ ] Device-link per-origin create quota (unauthenticated offer flood / FIFO eviction).
- [ ] Always-fresh device-link nonce (reject client-supplied) — coordinated with http.
- [ ] Named AMP types on public Hub UI WebSocket (`GenericMessage` remaining).
- [ ] Split [PR #15](https://github.com/FabricLabs/hub.fabric.pub/pull/15) (review tools skip at 100+ files).

## Closed this pass (do not re-open)
- SPA `manifest.json` same-origin `/bundles/browser.min.js` (human “Terrible URI”).
- Identity cluster HTTP ingest + package exports; device-link re-exports http thin-client Origin helpers.
- Playnet `--production` (`hub.fabric.pub` + `relay.goon.vc`); document market helper export.
- HTTPS-only default hub allowlist; Hub self-sign remote path closed in http.
- Test workflow `hub/.nvmrc`; leftover bitcoinClient `hubAdminToken` on payments URLs; `verifyAdminToken` cap/sub; backup KDF import bounds.

## PRs
[#15](https://github.com/FabricLabs/hub.fabric.pub/pull/15) — only human inline comment was Terrible URI (fixed). Older CodeRabbit/Codacy nits are not this deploy cut.
