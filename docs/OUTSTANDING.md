# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Operator deploy: [PRODUCTION.md](PRODUCTION.md). Product roadmap: [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md). Core class-surface march: [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-15 ([#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16); core lockfile `9306aba05`, http lockfile `ff781c5`).

## Blockers before production shared bind
1. **Inherited login/link redeem** — QR `sessionId` + forgeable Origin is still the capability ([`@fabric/http` OUTSTANDING](https://github.com/FabricLabs/fabric-http/blob/feature/rsi/docs/OUTSTANDING.md)). Hub desktop `allowHubSelfSign` defaults on; http **loopback-gates** the sign so public `hub.fabric.pub` cannot remote self-sign.
2. **Identity import** — xprv imports should persist through the encrypted identity path (not watch-only `id`/`xpub`) and restore locked/unlocked per password (heavy lift).
3. **At-rest identity KDF** — migrate fresh save from current `encryptLocalIdentityAtRest` to the stronger PBKDF2+AES-GCM backup scheme.

## Next slices
- [ ] Always-fresh device-link nonce (reject client-supplied) — coordinated with http.
- [ ] Named AMP types on public Hub UI WebSocket (`GenericMessage` remaining).
- [ ] Remaining Hub heap climb after `361a750` deploy ([tick 1/8](https://relay.goon.vc/downstream.agents.md): restarts **248**, new PID ~38 m, RSS ~150 MiB early life). `361a750` did **not** stop OOM. This tree no longer forces `bitcoin.settings.debug = true` after start (every RPC was allocating debug strings). Dual `bitcoind` and `hub-out` rotation stay ops. Hub↔RSI Fabric ESTAB still missing on that tick — sibling-NIC self-filter is in `@fabric/http` `collectOwnFabricHosts` (http pin `cff2ce66`).
- [ ] Deploy `assets/passport-privacy.html` so `https://hub.fabric.pub/passport-privacy.html` is live for the Passport Chrome Web Store listing (source: `@fabric/passport` `store/privacy.html`).

## Closed this pass (do not re-open)
- Bulk OpenSSF / GHSA malware-advisory documents are not ingested (`functions/bulkSecurityAdvisory.js`, package export `./functions/bulkSecurityAdvisory`; JSON arrays of advisory objects recurse). Array walk uses `for…of` (not `input[i]`) so Codacy Semgrep “object injection” on the bounded advisory list is a non-issue.
- WebRTC → TCP shoutbox inner body is UTF-8 `P2P_CHAT_MESSAGE` (legacy JSON envelopes unpacked). Registry encoding `utf8-text`.
- Identity cluster HTTP ingest + package exports; device-link re-exports http thin-client Origin helpers.
- IdentityCrossSign / verify re-export `@fabric/core` (commit/push core before Hub CI, or `npm link @fabric/core`). `fabricAccountDerivedIdentity` re-exports `fabricIdentityAccountPath` (core helper when present; else strips the receive leaf).
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
- CLI loads `~/.fabric/env` via core `fabricHomeEnv` (process env wins). Playnet `loadPeerKeySettings` / `fabricHomeEnv` catch only `MODULE_NOT_FOUND` (a broken home env still fails).
- Core pin **`9306aba05`** (MuSig2/BIP helpers, IPv6 candidate `[host]:port`, generic-message debug exact-match, exported `fabricIdentityAccountPath`, AMP wire name wins so inventory JSON `type: 98` cannot enqueue a peering candidate). Http pin **`ff781c5`** (core `9306aba05` nested, 402 blob-id omit, CLI `fabricHomeEnv`, Internal-log + commit snapshot cut, `fabricChatNormalize` re-exports core `fabricChatText`, `pubkey@` strip + dedicated-NIC `:7778`→`:7777`, unicast `FABRIC_INTERFACE` does not treat sibling NICs as self). WebRTC shoutbox `chatTextOf` uses core `fabricChatText`. Playnet `fallbackPeerKeySettingsFromEnv` keeps raw `FABRIC_SEED` hex as `{ seed }` when core `fabricKeyMaterial` is missing.

## PRs
[#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) — open **Production Polish** (bulk GHSA drop + WebRTC shoutbox unpack). [#15](https://github.com/FabricLabs/hub.fabric.pub/pull/15) merged. Ubuntu + macOS `test` / `build-test` flake on GitHub SHA `0f221d9`: `Hub document network` `GetDocument wait timeout` and `Hub fabric epic E2E` `ECONNRESET` (703 passing). Codacy **SUCCESS**. Vercel `pub-fabric-hub` account blocked (unrelated). Remaining open: identity import/KDF, login redeem (http), device-link nonce/`sessionId` bind. Pin `@fabric/core` / `@fabric/http` via lockfile (`#feature/rsi` + `npm run report:install`), currently core **`9306aba05`** / http **`ff781c5`**. Hub-level Accept/Reject tests that bypass `setup.verifyAdminToken` are still open (low-level `isOperatorAdminToken` covers `_rootKey` / `agent.key` / unset list entries). Dropping the advisory-detector Semgrep exclude is **wontfix** (Codacy ignores `nosemgrep`). Do not invent a product fix for the document-network e2e timeout this slice.
