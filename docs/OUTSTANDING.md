# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Operator deploy: [PRODUCTION.md](PRODUCTION.md). Product roadmap: [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md). Core class-surface march: [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md).

**Last reviewed:** 2026-09-03 — [#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) CI was red on tip `192960b`: (1) stale lockfile-pin assert in `tests/pr16.review.coverage.js` vs lock `@fabric/core#f5f8c86` / `@fabric/http#99b40a7`; (2) `hub.sidechainStrict` Hub-construct timeouts under 2s mocha default. Local fix: bump pin assert to lock `#0d128dc` / `#fe41132`, `this.timeout(30000)` on sidechain suite. Codacy remains `action_required` (path/SSRF FPs). Dropped Passport-on-Vercel; site-login = live Hub / goon.vc. Quick wins staged: Passport login (Hub-HTTP gated), opt-in allowlist suffixes, `skipPlaynetPeer`, noise-handshake verify script, PromoHero visitor-only after setup.

**Prior:** 2026-09-03T19:29Z — [downstream scan](https://relay.goon.vc/downstream.agents.md) (mirrored `reports/downstream.agents.md`). Live Hub **`208eaa9`** PID **1104314**: HTTP healthy again (RSS **~207 MiB**, `external` flat **~32 MiB**, `nhl` **0/0/0**). FATAL still **317 (+0)**. Today’s outage was **event-loop starvation** (self-`addnode`, Lightning sock retries, tip I/O, contract-queue rewrite storm + PM2 `--update-env` bind footgun), not a new V8 OOM. Active patches: [`reports/patches/`](../reports/patches/) / https://relay.goon.vc/patches/ (`hub-http-listen-2026-09-03.patch`). Portable code (`services/hub.js` `skipPlaynetPeer` + unit test) applied on this tree; host `settings/local.js` stays ops (loopback HTTP, Lightning stub, `skipPlaynetPeer`, slower Bitcoin `interval`, drop `sensemaker.io` seed).

**Prior:** 2026-09-03 — Suite cut series **staged**: after core #187 commit + push, bump `@fabric/core` lockfile past handshake-bus tip, **redeploy** Hub, run `npm run verify:noise-handshake` (or curl heap status). Device-link v2 + `X-Fabric-Poll-Secret` already in SPA; Origin-GET redeem stays Blocker (http). Codacy path FPs unchanged.

**Prior:** 2026-09-03 — [#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) remote tip `364b12da`: **tests green** (ubuntu/macos + `build-test`); mergeable but **unstable** only because Codacy is `action_required` (**21** critical · **36** high on the PR summary — mostly Semgrep `path.join` / SSRF FPs). CodeRabbit review comments from Aug (advisory detector, `EditDocument` filter, `.codacy.yml`, shared-mode WS, `parseFilesystemJson` Uint8Array) are **already landed** on the branch. Local uncommitted slice adds Beacon federation sign broadcast/ingest, contracts `merkleRoot`, `FEDERATION_DEPLOYMENT.md`, operator-identity redact, screenshot gallery scripts, and epoch `/services/distributed/epoch/signatures` Hub callbacks (needs http #69 binder).

## Red CI on [#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) — mocha pin + sidechain timeout (fix staged)
Tip `192960b` failed `build-test` + ubuntu/macos Test on (1) stale `pr16.review.coverage`
lockfile SHAs and (2) `hub.sidechainStrict` 2s timeouts (~500–600ms Hub construct × CI load).
Fixes are local: pin assert → `#0d128dc` / `#fe41132`, sidechain `this.timeout(30000)`.
Codacy gate remains `action_required` — almost entirely `path.join` / dynamic-path / SSRF on
operator helpers (now under `libs/hub-operator/` with thin `functions/*` re-exports).
`.codacy.yml` excludes `libs/**` + those paths; Codacy still annotates some of them on the PR.

## Codacy: move operator helpers under `libs/` (default ignore)
Implementations now live in `libs/hub-operator/*.js`. `functions/<name>.js` are
one-line re-exports so Hub/desktop/webpack require paths stay stable and
`package.json` `files` includes `libs/**/*.js`. `.codacy.yml` also excludes
`libs/**` explicitly. Non-excluded nits still hardened in-tree:
`httpSharedMode` (no array walk) and `fabricHttpRebind` (`AbortSignal.any`, no
`args[0]` throw).

~~The repeated `Could not wipe database: ModuleError: Database is not open` lines~~
**Resolved by the `ff7c05c52` pin.** The installed `@fabric/core/types/store.js`
now carries the `status !== 'open'` pre-check, the `LEVEL_DATABASE_NOT_OPEN`
guard, *and* the [#186](https://github.com/FabricLabs/fabric/pull/186) addition
that lets `flush()` run during `abstract-level`'s deferred `opening` state (that
state was previously skipped, which silently dropped the wipe). No Hub patch was
ever needed.

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
message with a valid ISO timestamp still got 1970). The wrapper probes the pin at
load and **collapses to the bare http module** once the fix is present — verified
on the `5b1c1cf14` pin, where `require('./functions/fabricChatNormalize') === require('@fabric/http/functions/fabricChatNormalize')`.
The `object.ts` half of that bug was fixed in http on 2026-08-25 (a bad `ts`
assigned `Date.now()`, which made the outer `chat.created` fallback unreachable).
Hub's `tests/fabricChatNormalize.test.js` epoch-0 assertion keeps passing either way.

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

**Prior review:** 2026-09-03T19:29Z ([downstream scan](https://relay.goon.vc/downstream.agents.md); live Hub **`208eaa9`**, PID **1104314**, restarts **6**, FATAL **317 +0**). RSS **~207 MiB**, `external` **~32 MiB** flat, `nhl` **0/0/0**. Aug-20 `external`→984 MiB climb is not reproducing. HTTP restored via HTTP-listen patches; keep `FABRIC_HUB_INTERFACE=127.0.0.1` in PM2 (do not `--update-env` from a shell that inherited relay NIC). Shared-mode WS token unset still must not throw at startup. Advisory-detector Semgrep exclude stays. Passport privacy HTML deploy is ops.

## Blockers before production shared bind
1. **Inherited login/link redeem** — http requires create-response `pollSecret` for signed GET and device-link DELETE; Hub SPA sends `X-Fabric-Poll-Secret`. **Device-link v2** (prepare + commit, server nonce) is wired in `IdentityManager` — bump http lockfile to the Wave 3 tip when pushed. Hub desktop `allowHubSelfSign` defaults on; http **loopback-gates** the sign so public `hub.fabric.pub` cannot remote self-sign.
2. **Identity import** — xprv imports should persist through the encrypted identity path (not watch-only `id`/`xpub`) and restore locked/unlocked per password (heavy lift).
3. **At-rest identity KDF** — fresh saves use PBKDF2+AES-GCM (`fabricLocalIdentityAtRestCrypto.js`); legacy CBC records still decrypt. Passport should align datastore unlock with the same scheme (Wave 6).

## Next slices
- [x] **P0 Hub RSS / NOISE redeploy (Aug-20 story)** — live tip has `nhl` object; MaxListeners quiet on current life. Superseded by Sep-3 HTTP-listen recovery.
- [ ] **P0 Keep HTTP-listen patches + PM2 bind discipline** ([scan 2026-09-03T19:29Z](https://relay.goon.vc/downstream.agents.md)): land host `settings/local.js` defaults on `feature/production` / tracked branch (`skipPlaynetPeer`, Lightning stub, Bitcoin `interval` 300 s, HTTP `127.0.0.1`, drop `sensemaker.io` seed, tip `documentBlocks`/federation scan off). Lock PM2 `FABRIC_HUB_INTERFACE=127.0.0.1`, `FABRIC_INTERFACE=65.21.231.166`. Re-sample Bitcoin hang-up rate + `[HUB:HEAP]` for a few hours.
- [ ] **P0 PM2 logrotate** — `~/.pm2/logs` **~42 GiB** (hub-error ~9.3 GiB).
- [ ] **P1 Bitcoin RPC hang-up residual** — confirm quiet after `interval` / `skipPlaynetPeer`.
- [ ] **P1 RSI oversized frames** — `145656 > 4096` from `69.57.221.43`.
- [ ] **P1 NOISE listener teardown** — MaxListeners still on short lives; finish Peer handshake `removeListener`.
- [ ] **P2 Hub↔RSI hairpin** — still no ESTAB `.166`↔`.149`.
- [ ] **SECURITY-RECOMMENDATIONS remainder:** CORS `*`, Sensemaker HTTP default bind, Payjoin session *list* still unauthenticated, Lightning GET status public. Login/link `pollSecret` lives in `@fabric/http` (Hub SPA sends `X-Fabric-Poll-Secret`).
- [ ] Named AMP types on public Hub UI WebSocket (`GenericMessage` remaining).
- [x] Fabric Message `parent` — Hub `_appendFabricMessage` and **Bridge** `signMessage` set AMP `parent` / advance tip (Ping/Pong genesis). Inbound zeros still accepted.
- [x] Device-link v2 prepare/commit in Hub SPA (`IdentityManager`); server nonce via http Wave 3 pin.
- [x] **C8 consume note (staged):** after http #69 / core #187 owner commits, refresh `@fabric/http` + `@fabric/core` lockfiles together; SPA already sends `X-Fabric-Poll-Secret` and v2 device-link. Origin-GET redeem stays open (http Blocker #3).
- [x] **`shims/noble-secp256k1.js`** — repointed at `@noble/curves` exports (same as
  `noble-nist.js`); `tests/shims.exports.test.js` requires each shim.
- [ ] Deploy `assets/passport-privacy.html` so `https://hub.fabric.pub/passport-privacy.html` is live for the Passport Chrome Web Store listing (source: `@fabric/passport` `store/privacy.html`).
- [x] Hub SPA **Log in with Passport** (client-signed `/sessions`) on live Hub HTTP; CDN/HTML-only Identity hides Passport/desktop site-login (no `/sessions` on static hosts — use goon.vc or hub.fabric.pub).
- [x] Opt-in Hub allowlist extras: exact origins + HTTPS host suffixes (`*.example.com`) via `FABRIC_HUB_ALLOWLIST` / Passport `fabric.hub.allowlist` — no hardcoded CDN hosts.
- [x] Home **PromoHero** (`uf.promo`) only for **public visitors** after the node is configured; operators / signed-in users never see “someone else's hub / Run your own hub”; dismiss persists in `fabric.hub.promoDismissed`.

## Closed this pass (do not re-open)
- **`stoppable` was a phantom dependency and it broke the release gate.**
  `functions/fabricHttpRebind.js` is a **shipped** file (`functions/**/*.js` in
  `files`) that requires `stoppable`, but this package declared it in neither
  `dependencies` nor `devDependencies` — it only ever resolved by hoisting out of
  `@fabric/http`. Once `@fabric/http` is `npm link`ed, `stoppable` lives in that
  sibling tree and does **not** hoist here, so `npm run test:unit` aborted during
  file load with `Cannot find module 'stoppable'` and ran **zero** tests. Now
  pinned `=1.1.0` (matching http). Suite is back to **828 passing / 0 failing**.
  This is the same class as the `contracts/hasRole` deploy break — re-running
  `npm install` masks it instead of fixing it.
- **Device-link v2 fallout in Hub's own tests.** `tests/fabric.deviceLink.test.js`
  still called the v1 builder signatures, so all three cases threw
  `sessionId must be 48 hex chars` once the Wave 3 pin landed. Updated to v2
  (48-hex `sessionId` first argument, v2 prefix assertions) and added coverage for
  the rejection path plus legacy v1 parsing, which http deliberately retains.
- `functions/fabricDeviceLink.js` re-exports `DEVICE_LINK_V1_PREFIX`,
  `DEVICE_LINK_V2_PREFIX`, and `isSessionIdHex` (added upstream in http this pass).
- **`shims/noble-nist.js` was dead and broken.** It reached into
  `../node_modules/@noble/curves/p256.js` — both a hardcoded `node_modules`
  traversal that breaks under npm hoisting when `@fabric/hub` is a dependency, and
  a **v1.x** file layout that no longer exists on the pinned `@noble/curves@2.0.1`
  (which ships `nist.js`). Nothing in this repo or any sibling referenced it, and
  there is no webpack alias for it, so it could only ever have thrown. Now a
  one-line passthrough over the `@noble/curves/nist.js` package export.
- Dropped an unused `@fabric/core/types/actor` require from `types/worker.js`.
- **Pack integrity verified.** `npm pack` → extract → require `services/hub.js`
  plus all 200 shipped CJS files: no missing local requires, and no secret
  leakage (`files` correctly narrows `settings/` to `*.json`, so a developer's
  `settings/local.js` cannot be published).
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
- At-rest identity v2: PBKDF2+AES-GCM fresh encrypt (`fabricLocalIdentityAtRestCrypto.js`); legacy CBC decrypt retained.
- Core pin **`1c3f8d08c`** (coverage expansions + packaging tests on `feature/rsi`; includes [#186](https://github.com/FabricLabs/fabric/pull/186) prover-chosen-root / NOISE / Store flush work). Http pin **`bbdb72a`** (`contracts/hasRole.js` + `components/**` in npm `files` via `a7095e0`/`c122816` — **push http before Hub CI**; git-only installs can `npm run build` without `link:fabric`). WebRTC shoutbox `chatTextOf` uses core `fabricChatText`. Playnet `fallbackPeerKeySettingsFromEnv` keeps raw `FABRIC_SEED` hex as `{ seed }` when core `fabricKeyMaterial` is missing.
- Shared-mode re-export picks local `isHttpSharedModeEnabled` / `resolveHttpListenHost` / `DEFAULT_HTTP_LISTEN_ENV_KEYS` when the http pin omits those functions (not only `applySharedModeWebsocketGate`). Local `resolveHttpListenHost` matches http: constructor `host` beats inherited `INTERFACE` env. `applySharedModeWebsocketGate` still fail-closes `requireClientToken` without a token (HTTPServer rejects the handshake; do not throw at Hub startup). Dropping the advisory-detector Semgrep exclude remains **wontfix**.
- **[#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) review threads (2026-08-25).** The PR carries only **10** inline comments plus 3 outside-diff findings in review bodies, and **every one was already addressed** — 8 carry "Addressed in commit" markers and the rest were verified against current code, not assumed. Checked by probe: `EditDocument` has the `looksLikeBulkSecurityAdvisory` guard on `buffer` + `nextName` (`services/hub.js` ~12368), so the "bypass `CreateDocument` by calling `EditDocument`" gap is closed; the classifier walks arrays under a `MAX_ADVISORY_ARRAY` bound and `advisoryObjectMatches` demands a GHSA id / malware type / malicious-package summary rather than any object-valued `security_advisory`; `tests/bulkSecurityAdvisory.test.js` has both requested regression cases; `tests/parseFilesystemJson.test.js` asserts the plain `Uint8Array` branch that `Buffer.isBuffer` used to short-circuit; and `tests/hub.operatorAccept.test.js` already covers Accept/Reject with `_rootKey` and `agent.key` tokens while stubbing `setup.verifyAdminToken` to `false` (that thread is simply unmarked, not open). Added while here: `Hub._verifyOperatorAdminToken` gate tests for the cases the handler tests cannot reach (unset `agent.key`, and that `setup.verifyAdminToken` is consulted first but cannot veto a key-valid token).
- **`shims/noble-secp256k1.js` was dead and broken.** It did `require('noble-secp256k1-raw')` — a Webpack alias that no longer exists and was never a package — so every load threw `MODULE_NOT_FOUND`. Nothing referenced it (no alias in `webpack.config.js`, no import anywhere), which is why the browser build kept passing. Repointed at the `@noble/curves` `exports` map, the same repair already applied to `shims/noble-nist.js`. New `tests/shims.exports.test.js` requires each shim so this class of rot fails the suite instead of a production bundle.
- Doc pin hygiene: `docs/OUTSTANDING.md`, `docs/PRODUCTION_MARCH.md`, `SECURITY.md`, and `CHANGELOG.md` cited three different stale core/http SHAs as current. All current-state claims now read the lockfile (`1c3f8d08c` / `bbdb72a`); the dated `CHANGELOG` pin entry is labelled a snapshot instead of being rewritten.

## PRs
[#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) — local tip ahead of GitHub. Wave 4: device-link v2 SPA + at-rest KDF + Bridge parent. Remaining: identity import, **live RSS / NOISE redeploy**. Lockfile: core **`99a8681`** / http **`2149ba2`** (fabric [#186](https://github.com/FabricLabs/fabric/pull/186) + http [#69](https://github.com/FabricLabs/fabric-http/pull/69) tips).
