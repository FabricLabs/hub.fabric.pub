# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Operator deploy: [PRODUCTION.md](PRODUCTION.md). Product roadmap: [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md). Core class-surface march: [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-24 — suite audit pass. `npm run test:unit` **821 passing / 0 failing**.
The repeated `Could not wipe database: ModuleError: Database is not open` lines
are teardown noise on already-closed LevelDB handles, not failures, and need **no
Hub patch**: core `088dd9aff` (on `origin/feature/rsi`) added a `status !== 'open'`
pre-check plus a `LEVEL_DATABASE_NOT_OPEN` guard to `Store#flush`, and
`node_modules/@fabric/core/types/store.js` here is simply the pre-guard copy.
Refreshing the core dep silences it — one more item riding the same pin bump as
the P0 below.

One caveat on trusting this number: across five runs the suite showed a single
intermittent failure once and 821/0 the other four times. Given the visible
`ClassicLevel.open` and `FabricHTTPServer.stop` teardown errors in the output,
the likely cause is a store/server teardown race between suites rather than a
product bug — but it means **a clean run is not proof**, and the noise is what
makes the flake hard to name. Worth quieting the teardown paths so the next
occurrence is identifiable.

**`sanitizeCreated` went upstream.** `functions/fabricChatNormalize.js` existed
to patch `@fabric/http` emitting epoch-0 `created` for `Number(null)` /
`Number('')`. That guard is now in http itself (which also fixes a second bug
Hub's wrapper never caught: the `object.ts` fallback was being skipped, so a
message with a valid ISO timestamp still got 1970). The wrapper now probes the
pin at load and **collapses to the bare http module** once the fix is present,
so it deletes itself on the same dep refresh. Hub's
`tests/fabricChatNormalize.test.js` epoch-0 assertion keeps passing either way.

**Invite `expiresAt` went upstream the same way.** `functions/federationContractInvite.js`
probes the http pin and collapses when builders already stamp `expiresAt`; the
local `stampExpiresAt` fallback rejects non-positive `invitedAt`.

**Verified-dead but deliberately not deleted:**
`functions/oracleAttestation.local.js` and `functions/fabricPubkey.local.js` are
**byte-identical** to the installed http pin and reachable only from their own
wrapper's `catch`. Since `@fabric/http` is a hard dependency (HTTPServer), those
branches cannot execute. They still should **not** be removed casually: webpack
resolves both arms of a `try`/`catch` `require` statically, so deleting them can
break the browser bundle for zero behaviour gain. Gate removal on a clean
`npm run build`. `functions/fabricChatNormalize.local.js` genuinely **differs**
(~60 lines, pre-`fabricChatText`) and must stay.

Passport now
carries its own [AUDIT.md](https://github.com/FabricLabs/fabric-browser-extension/blob/feature/rsi/AUDIT.md),
which restates the `assets/passport-privacy.html` deploy as a listing blocker on
the Hub side.

**Prior review:** 2026-08-20 ([downstream scan](https://relay.goon.vc/downstream.agents.md) **10:39Z**; live Hub **`6bf825d`**, PID **172076**, restarts **542**, FATAL **317 +0**). Named retainers still flat. RSS **~1.7 GiB** tracks **`external`/`arrayBuffers` (~38→984 MiB in ~61 m)**, not V8 heap (~82 MiB). NOISE MaxListeners 65>64 on **4** PIDs including current; `noiseHandshakeListeners` stays **null** (live core **`f63a33f`** has no `Peer#countNoiseHandshakeListeners` — that lands in [@fabric/core #186](https://github.com/FabricLabs/fabric/pull/186) HEAD **`9c6ade0`**, not pinned here). Crash loop remains broken. Do not throw at Hub startup when the shared-mode WS token is unset. Do not drop the advisory-detector Semgrep exclude. Passport privacy HTML deploy is ops.

## Blockers before production shared bind
1. **Inherited login/link redeem** — http now requires create-response `pollSecret` for signed GET and device-link DELETE. Hub SPA sends `X-Fabric-Poll-Secret`. Remaining: bind `sessionId` into device-link attest messages ([`@fabric/http` OUTSTANDING](https://github.com/FabricLabs/fabric-http/blob/feature/rsi/docs/OUTSTANDING.md)). Hub desktop `allowHubSelfSign` defaults on; http **loopback-gates** the sign so public `hub.fabric.pub` cannot remote self-sign.
2. **Identity import** — xprv imports should persist through the encrypted identity path (not watch-only `id`/`xpub`) and restore locked/unlocked per password (heavy lift).
3. **At-rest identity KDF** — migrate fresh save from current `encryptLocalIdentityAtRest` to the stronger PBKDF2+AES-GCM backup scheme.

## Next slices
- [ ] **P0 Hub RSS outside named retainers** ([scan 2026-08-20T10:39Z](https://relay.goon.vc/downstream.agents.md): life **~61 m** on **`6bf825d`**, heap **~82 MiB @ 41%**, RSS **~1.7 GiB**). `[HUB:HEAP]` Filesystem/STATE/docs counters stay **flat**. **Watch `memory.external` / `arrayBuffers`** (38→984 MiB this life) — that is the RSS driver, not `heapUsed` sawtooth. Prior life (`72f2f22`, 02:55Z) was RSS **~0.7 GiB** with tens of MiB external. **NOISE** `MaxListenersExceededWarning` 65>64 on **4** consecutive PIDs; live core **`f63a33f`** still uses npm `noise-protocol-stream` so `retainers.noiseHandshakeListeners` is **null**. [@fabric/core #186](https://github.com/FabricLabs/fabric/pull/186) HEAD **`9c6ade0`** has `functions/noiseProtocolStream.js` + `Peer#countNoiseHandshakeListeners` plus `freeNative` pointer clear / `onready` teardown — **pin, redeploy** before treating this as shipped. Do **not** raise `--max-old-space-size`. Ops: `pm2-logrotate` (~41 GiB logs), drop `sensemaker.io:7778` seed, Lightning stub/off, Hub↔RSI hairpin, Node 24.15.x.
- [ ] **P1 RSI memory / peer I/O** — RSS **~12.3 GiB** (was ~10 GiB @ 02:55Z), heap **~1.77 GiB @ ~94%**, restarts **2 +0**, **0** FATAL; closed-or-destroyed stream spam + oversized AMP frames (`140736 > 4096` from `66.58.241.57`). Write-after-close + frame-size / inventory carrier.
- [ ] **SECURITY-RECOMMENDATIONS remainder:** CORS `*`, Sensemaker HTTP default bind, Payjoin session *list* still unauthenticated, Lightning GET status public. Login/link `pollSecret` lives in `@fabric/http` (Hub SPA sends `X-Fabric-Poll-Secret`).
- [ ] Named AMP types on public Hub UI WebSocket (`GenericMessage` remaining).
- [x] Fabric Message `parent` — originate previous-`id` chains like GoonCitizen
  (D-020). `_appendFabricMessage` now sets AMP `parent` / `frameId` (genesis zeros
  for Ping / Pong; `GENESIS_MESSAGE` is the chain root). Do not drop inbound genesis zeros yet.
- [ ] Always-fresh device-link nonce (reject client-supplied) — coordinated with http.
- [ ] Deploy `assets/passport-privacy.html` so `https://hub.fabric.pub/passport-privacy.html` is live for the Passport Chrome Web Store listing (source: `@fabric/passport` `store/privacy.html`).

## Closed this pass (do not re-open)
- Federation vault NUMS vs MuSig2: Hub defaults `internalKeyMode` to `nums` (`FABRIC_FEDERATION_INTERNAL_KEY_MODE`). Core n≥2 ladder default is MuSig2 (new address). Do not switch until NUMS UTXOs are swept.
- Bulk OpenSSF / GHSA malware-advisory documents are not ingested (`functions/bulkSecurityAdvisory.js`, package export `./functions/bulkSecurityAdvisory`; JSON arrays of advisory objects recurse). Array walk uses `for…of` (not `input[i]`) so Codacy Semgrep “object injection” on the bounded advisory list is a non-issue.
- WebRTC → TCP shoutbox inner body is UTF-8 `P2P_CHAT_MESSAGE` (legacy JSON envelopes unpacked). Registry encoding `utf8-text`.
- Identity cluster HTTP ingest + package exports; device-link re-exports http thin-client Origin helpers.
- IdentityCrossSign / verify re-export `@fabric/core` (commit/push core before Hub CI, or `npm link @fabric/core`). `fabricAccountDerivedIdentity` re-exports `fabricIdentityAccountPath` (core helper when present; else strips the receive leaf).
- Playnet `--production` (`hub.fabric.pub` + `relay.goon.vc`); document market helper export.
- HTTPS-only default hub allowlist; Hub self-sign remote path closed in http.
- Test workflow `hub/.nvmrc`; **fixed** bitcoinClient `hubAdminToken` on payments URLs; `verifyAdminToken` cap/sub; backup KDF import bounds.
- Dev-seed wipe marker is only cleared when restoring **that** seed (importing another mnemonic leaves suppression in place).
- Managed regtest attach-on-lock: cookie RPC probe + one spawn-failure retry; do not SIGKILL an attached orphan (`functions/bitcoinManagedAttach.js`). Heap OOM that orphaned Core remains a follow-up (teardown cannot run after V8 abort).
- Device-link per-origin create quota lives in `@fabric/http` `fabricDeviceLinkHttp` (Hub re-exports `MAX_SESSIONS_PER_ORIGIN` / `evictDeviceLinkOriginOverflow`).
- Expired `GET /sessions/:delegationToken` requires matching Bearer (http pin).
- Beacon ready-round retry tests use a real Schnorr witness (core pin verifies recovered rounds; fake `'00'` now correctly errors).
- Identity cluster keys are x-only / compressed hex only (no colon-smashed fallback).
- Operator Accept tokens verify against Hub `_rootKey` **or** Peer `agent.key` (`functions/operatorAdminToken.js`, package export). Hub-level Accept/Reject tests bypass `setup.verifyAdminToken` (`tests/hub.operatorAccept.test.js`). Low-level helper also rejects a non-`admin` subject.
- CLI loads `~/.fabric/env` via core `fabricHomeEnv` (process env wins). Playnet `loadPeerKeySettings` / `fabricHomeEnv` catch only `MODULE_NOT_FOUND` (a broken home env still fails).
- Core pin **`9938917`** (Filesystem publish retain cut + [#185](https://github.com/FabricLabs/fabric/pull/185) follow-ups; MuSig2 `autoAccept` default off, BIP-21 `req-*`, collection cwd-containment, Codacy `Number('…')` literals; plus MuSig2/BIP helpers, IPv6 candidate `[host]:port`, generic-message debug exact-match, exported `fabricIdentityAccountPath`, AMP wire name wins so inventory JSON `type: 98` cannot enqueue a peering candidate). Next core pin is [#186](https://github.com/FabricLabs/fabric/pull/186) (handshake-bus + gossip catalog + review follow-ups; HEAD **`9c6ade0`**). Http pin **`7d7f1c7`** (POST-null 400, device-link DELETE cancel; 402 blob-id omit, CLI `fabricHomeEnv`, Internal-log + commit snapshot cut, `fabricChatNormalize` re-exports core `fabricChatText`, `pubkey@` strip + dedicated-NIC `:7778`→`:7777`, unicast `FABRIC_INTERFACE` does not treat sibling NICs as self). WebRTC shoutbox `chatTextOf` uses core `fabricChatText`. Playnet `fallbackPeerKeySettingsFromEnv` keeps raw `FABRIC_SEED` hex as `{ seed }` when core `fabricKeyMaterial` is missing.
- Shared-mode re-export picks local `isHttpSharedModeEnabled` / `resolveHttpListenHost` / `DEFAULT_HTTP_LISTEN_ENV_KEYS` when the http pin omits those functions (not only `applySharedModeWebsocketGate`). Local `resolveHttpListenHost` matches http: constructor `host` beats inherited `INTERFACE` env. `applySharedModeWebsocketGate` still fail-closes `requireClientToken` without a token (HTTPServer rejects the handshake; do not throw at Hub startup). Dropping the advisory-detector Semgrep exclude remains **wontfix**.

## PRs
[#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) — GitHub/local HEAD **`64e0403`**. GitHub Actions `build-test` / macOS+Ubuntu tests **SUCCESS**. Codacy **ACTION_REQUIRED** on that tip: Semgrep path.join / pinned-URL on desktop userData, `/downloads` index, managed binaries, and seed `OPTIONS` probes — excluded in `.codacy.yml` like `hubLightningGate`. Shared-mode listen-host env lookup is named properties (not `env[key]`). CodeRabbit inline threads from #16 are in tree (bulk-advisory arrays, `EditDocument` filter, resync warn, shared-mode fallbacks, operator Accept tests including `_rootKey` + `agent.key`, playnet `loadFabricHomeEnv` only swallows `MODULE_NOT_FOUND`). Remaining open: identity import/KDF, login redeem (http), device-link nonce/`sessionId` bind, **RSS / NOISE deploy** (core [#186](https://github.com/FabricLabs/fabric/pull/186) HEAD **`9c6ade0`**). Pin `@fabric/core` / `@fabric/http` via lockfile (`#feature/rsi` + `npm run report:install`), currently core **`9938917`** / http **`7d7f1c7`**. Live (10:39Z): Hub **`6bf825d`**, core **`f63a33f`**, http **`4625215`**. Do not wire `applySharedModeWebsocketGate` inside the `HTTPServer` constructor. Do not throw at Hub startup when the shared-mode WS token is unset (handshake already fail-closes). Dropping the advisory-detector Semgrep exclude remains **wontfix**. Deploy `assets/passport-privacy.html` is ops, not this slice.
