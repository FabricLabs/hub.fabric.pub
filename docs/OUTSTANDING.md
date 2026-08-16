# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Operator deploy: [PRODUCTION.md](PRODUCTION.md). Product roadmap: [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md). Core class-surface march: [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-16 ([crash scan](https://relay.goon.vc/downstream.agents.md) 03:58Z; [#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) GitHub `250a178`; core lockfile `f1b5e147`, http lockfile `ff781c5`).

## Blockers before production shared bind
1. **Inherited login/link redeem** — QR `sessionId` + forgeable Origin is still the capability ([`@fabric/http` OUTSTANDING](https://github.com/FabricLabs/fabric-http/blob/feature/rsi/docs/OUTSTANDING.md)). Hub desktop `allowHubSelfSign` defaults on; http **loopback-gates** the sign so public `hub.fabric.pub` cannot remote self-sign.
2. **Identity import** — xprv imports should persist through the encrypted identity path (not watch-only `id`/`xpub`) and restore locked/unlocked per password (heavy lift).
3. **At-rest identity KDF** — migrate fresh save from current `encryptLocalIdentityAtRest` to the stronger PBKDF2+AES-GCM backup scheme.

## Next slices
- [ ] Always-fresh device-link nonce (reject client-supplied) — coordinated with http.
- [ ] Named AMP types on public Hub UI WebSocket (`GenericMessage` remaining).
- [ ] Remaining Hub heap climb after `361a750` deploy ([crash scan 2026-08-16T03:58Z](https://relay.goon.vc/downstream.agents.md): **28** PM2 restarts since 2026-08-14T21:31Z, **+16** in ~5.8 h, ~22 min mean; current PID ~3 m / heap ~957 MiB @ 88%). Cause is **only** V8 heap OOM (mark-compact / heap-limit). `361a750` did **not** stop OOM. This tree (`250a178`) no longer forces `bitcoin.settings.debug = true` after start — **production still needs that deploy**. Dual `bitcoind` and `hub-out` rotation stay ops. Hub↔RSI Fabric ESTAB still missing (both have external peers); sibling-NIC self-filter is in `@fabric/http` `collectOwnFabricHosts` (http pin `ff781c5`, live Hub still `61bb801`). Do not raise `--max-old-space-size` as the only fix.
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
- Core pin **`f1b5e147`** (MuSig2 `autoAccept` default off, BIP-21 `req-*`, collection cwd-containment, Codacy `Number('…')` literals; plus MuSig2/BIP helpers, IPv6 candidate `[host]:port`, generic-message debug exact-match, exported `fabricIdentityAccountPath`, AMP wire name wins so inventory JSON `type: 98` cannot enqueue a peering candidate). Http pin **`ff781c5`** (nested core on GitHub still `9306aba05` until http is pushed; 402 blob-id omit, CLI `fabricHomeEnv`, Internal-log + commit snapshot cut, `fabricChatNormalize` re-exports core `fabricChatText`, `pubkey@` strip + dedicated-NIC `:7778`→`:7777`, unicast `FABRIC_INTERFACE` does not treat sibling NICs as self). WebRTC shoutbox `chatTextOf` uses core `fabricChatText`. Playnet `fallbackPeerKeySettingsFromEnv` keeps raw `FABRIC_SEED` hex as `{ seed }` when core `fabricKeyMaterial` is missing.
- Shared-mode re-export picks local `isHttpSharedModeEnabled` / `resolveHttpListenHost` / `DEFAULT_HTTP_LISTEN_ENV_KEYS` when the http pin omits those functions (not only `applySharedModeWebsocketGate`). Local `resolveHttpListenHost` matches http: constructor `host` beats inherited `INTERFACE` env. `applySharedModeWebsocketGate` still fail-closes `requireClientToken` without a token (HTTPServer rejects the handshake; do not throw at Hub startup). Dropping the advisory-detector Semgrep exclude remains **wontfix**.

## PRs
[#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) — GitHub HEAD **`250a178`**. Ubuntu + macOS `build-test` failed on `GetDocument wait timeout` (document-network + fabric epic e2e): `Filesystem.readFile` returns a Buffer and Hub only JSON-parsed strings, so GetDocument returned a document without `contentBase64` (`no document` in the wait helper). Local staged fix: `functions/parseFilesystemJson.js` on GetDocument / local-blob / priced-publish. Codacy SUCCESS. Vercel `pub-fabric-hub` account blocked (unrelated). Remaining open: identity import/KDF, login redeem (http), device-link nonce/`sessionId` bind. Pin `@fabric/core` / `@fabric/http` via lockfile (`#feature/rsi` + `npm run report:install`), currently core **`f1b5e147`** / http **`ff781c5`**. Hub-level Accept/Reject tests that bypass `setup.verifyAdminToken` are still open (low-level `isOperatorAdminToken` covers `_rootKey` / `agent.key` / unset list entries). Do not wire `applySharedModeWebsocketGate` inside the `HTTPServer` constructor. Do not throw at Hub startup when the shared-mode WS token is unset (handshake already fail-closes). Dropping the advisory-detector Semgrep exclude remains **wontfix**.
