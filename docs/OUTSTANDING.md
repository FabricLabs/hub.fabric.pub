# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Operator deploy: [PRODUCTION.md](PRODUCTION.md). Product roadmap: [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md). Core class-surface march: [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-14 ([#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16); core lockfile `0ed61d62`, http lockfile `61bb801`).

## Blockers before production shared bind
1. **Inherited login/link redeem** — QR `sessionId` + forgeable Origin is still the capability ([`@fabric/http` OUTSTANDING](https://github.com/FabricLabs/fabric-http/blob/feature/rsi/docs/OUTSTANDING.md)). Hub desktop `allowHubSelfSign` defaults on; http **loopback-gates** the sign so public `hub.fabric.pub` cannot remote self-sign.
2. **Identity import** — xprv imports should persist through the encrypted identity path (not watch-only `id`/`xpub`) and restore locked/unlocked per password (heavy lift).
3. **At-rest identity KDF** — migrate fresh save from current `encryptLocalIdentityAtRest` to the stronger PBKDF2+AES-GCM backup scheme.

## Next slices
- [ ] Always-fresh device-link nonce (reject client-supplied) — coordinated with http.
- [ ] Named AMP types on public Hub UI WebSocket (`GenericMessage` remaining).
- [ ] Remaining Hub heap OOM (~21m / ~4 GiB after `dcf8fb4` GHSA drop). Peer debug mirror is gated (this tree); core numeric-98 / no-full-stringify is on pin `0ed61d62`. Dual `bitcoind` on `stores/bitcoin-regtest` and `hub-out` rotation stay ops.

## Closed this pass (do not re-open)
- Bulk OpenSSF / GHSA malware-advisory documents are not ingested (`functions/bulkSecurityAdvisory.js`, package export `./functions/bulkSecurityAdvisory`; JSON arrays of advisory objects recurse).
- WebRTC → TCP shoutbox inner body is UTF-8 `P2P_CHAT_MESSAGE` (legacy JSON envelopes unpacked). Registry encoding `utf8-text`.
- Identity cluster HTTP ingest + package exports; device-link re-exports http thin-client Origin helpers.
- IdentityCrossSign / verify re-export `@fabric/core` (commit/push core before Hub CI, or `npm link @fabric/core`).
- Playnet `--production` (`hub.fabric.pub` + `relay.goon.vc`); document market helper export.
- HTTPS-only default hub allowlist; Hub self-sign remote path closed in http.
- Test workflow `hub/.nvmrc`; leftover bitcoinClient `hubAdminToken` on payments URLs; `verifyAdminToken` cap/sub; backup KDF import bounds.
- Dev-seed wipe marker is only cleared when restoring **that** seed (importing another mnemonic leaves suppression in place).
- Managed regtest attach-on-lock: cookie RPC probe + one spawn-failure retry; do not SIGKILL an attached orphan (`functions/bitcoinManagedAttach.js`). Heap OOM that orphaned Core remains a follow-up (teardown cannot run after V8 abort).
- Device-link per-origin create quota lives in `@fabric/http` `fabricDeviceLinkHttp` (Hub re-exports `MAX_SESSIONS_PER_ORIGIN` / `evictDeviceLinkOriginOverflow`).
- Expired `GET /sessions/:delegationToken` requires matching Bearer (http pin).
- Beacon ready-round retry tests use a real Schnorr witness (core pin verifies recovered rounds; fake `'00'` now correctly errors).
- Identity cluster keys are x-only / compressed hex only (no colon-smashed fallback).
- Operator Accept tokens verify against Hub `_rootKey` **or** Peer `agent.key` (`functions/operatorAdminToken.js`, package export).
- CLI loads `~/.fabric/env` via core `fabricHomeEnv` (process env wins).
- Core pin `0ed61d62` (home-env / key-material, numeric `P2P_PEERING_OFFER` dispatch, UTF-8 shoutbox `fabricChatText`, IPv6 `_connect` bracket strip). Http pin `61bb801` (CLI `fabricHomeEnv`, Internal-log + commit snapshot cut, `fabricChatNormalize` re-exports core `fabricChatText`, `pubkey@` strip + dedicated-NIC `:7778`→`:7777`). WebRTC shoutbox `chatTextOf` uses core `fabricChatText`.

## PRs
[#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) — open **Production Polish** (bulk GHSA drop + WebRTC shoutbox unpack). [#15](https://github.com/FabricLabs/hub.fabric.pub/pull/15) merged. Ubuntu CI **673 passing**; macOS `test` job flake: `hub.document.network.e2e` `ECONNRESET` (ubuntu green). Vercel `pub-fabric-hub` account blocked (unrelated). Remaining open: identity import/KDF, login redeem (http), device-link nonce/`sessionId` bind. Pin `@fabric/core` / `@fabric/http` via lockfile (`#feature/rsi` + `npm run report:install`), currently core **`0ed61d62`** / http **`61bb801`**.
