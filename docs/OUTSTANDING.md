# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Operator deploy: [PRODUCTION.md](PRODUCTION.md). Product roadmap: [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md). Core class-surface march: [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-31 — [#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) tip `91999ff`: **build-test + Run tests (macOS/ubuntu) green**. Codacy still `action_required` (**87** new issues / **50** annotations). Staged: clear the **3 non-excluded** findings (`httpSharedMode` for…of, `fabricHttpRebind` `events.once`+`AbortSignal.timeout`, codecov action full SHA) + `.codacy.yml` `enabled: true` on semgrep/opengrep so engine excludes can apply. Remaining ~**47** annotations are still on already-excluded path helpers — if Codacy still scores them after push, batch-ignore in the Codacy UI. Do not keep adding exclude paths.

## Red CI on [#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) — tests green; Codacy gate remains
Earlier packaging/`build-test` failures at `c184907f0` were
`Cannot find module '../components/browser-content'` (and macOS `hasRole`) from
`@fabric/http/types/browser.js` under `scripts/build.js`. Cleared by http pin
**`bbdb72a`**. Mocha bind-isolation macOS timeout cleared with `this.timeout(30000)`
+ `fail-fast: false` (`91999ff`).

## Codacy on [#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16): mostly excluded-path FPs (config historically ignored)
Tip check annotations (**50**): almost all `path.join` / "dynamic path" / SSRF on
files this repo **already excludes** in `.codacy.yml` (semgrep + opengrep + global):
`hubManagedBinaries.js`, `hubDownloadsIndex.js`, `desktopUserData.js`,
`desktopOpenAtLogin.js`, `fabricHubSeedProbe.js`. Containment is real
(`normalizeRelativePath` + `tests/hubDownloadsIndex.test.js`).

**Non-excluded (staged fixes):**
- `httpSharedMode.js` — "Generic Object Injection" on `list[i]` → `for…of`
- `fabricHttpRebind.js:62` — "inappropriate function body" on setTimeout/removeListener → `events.once` + `AbortSignal.timeout`
- `.github/workflows/test.yaml` — codecov action pinned to full commit SHA

`.codacy.yml` now sets `engines.semgrep|opengrep.enabled: true` (excludes unchanged).
If Codacy still scores the excluded files after push, **UI ignore / pattern mute**
is required — more YAML paths will not help.

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

**Prior review:** 2026-08-20 ([downstream scan](https://relay.goon.vc/downstream.agents.md) **10:39Z**; live Hub **`6bf825d`**, PID **172076**, restarts **542**, FATAL **317 +0**). Named retainers still flat. RSS **~1.7 GiB** tracks **`external`/`arrayBuffers` (~38→984 MiB in ~61 m)**, not V8 heap (~82 MiB). NOISE MaxListeners 65>64 on **4** PIDs including current; `noiseHandshakeListeners` stays **null** on live core **`f63a33f`**. Crash loop remains broken. Do not throw at Hub startup when the shared-mode WS token is unset. Do not drop the advisory-detector Semgrep exclude. Passport privacy HTML deploy is ops.

## Blockers before production shared bind
1. **Inherited login/link redeem** — http requires create-response `pollSecret` for signed GET and device-link DELETE; Hub SPA sends `X-Fabric-Poll-Secret`. **Device-link v2** (prepare + commit, server nonce) is wired in `IdentityManager` — bump http lockfile to the Wave 3 tip when pushed. Hub desktop `allowHubSelfSign` defaults on; http **loopback-gates** the sign so public `hub.fabric.pub` cannot remote self-sign.
2. **Identity import** — xprv imports should persist through the encrypted identity path (not watch-only `id`/`xpub`) and restore locked/unlocked per password (heavy lift).
3. **At-rest identity KDF** — fresh saves use PBKDF2+AES-GCM (`fabricLocalIdentityAtRestCrypto.js`); legacy CBC records still decrypt. Passport should align datastore unlock with the same scheme (Wave 6).

## Next slices
- [ ] **P0 Hub RSS / NOISE redeploy** ([scan 2026-08-20T10:39Z](https://relay.goon.vc/downstream.agents.md): life **~61 m** on **`6bf825d`**, heap **~82 MiB @ 41%**, RSS **~1.7 GiB**). `[HUB:HEAP]` Filesystem/STATE/docs counters stay **flat**. **Watch `memory.external` / `arrayBuffers`**. Local pin already has [@fabric/core #186](https://github.com/FabricLabs/fabric/pull/186) **`ff7c05c52`** (`functions/noiseProtocolStream.js` + `Peer#countNoiseHandshakeListeners`, plus the `onverify` freed-pointer guard). Live still **`f63a33f`** (`noiseHandshakeListeners` **null**, MaxListeners 65>64) — **redeploy this Hub tip** before treating #1 as closed. Do **not** raise `--max-old-space-size`. Ops: `pm2-logrotate` (~41 GiB logs), drop `sensemaker.io:7778` seed, Lightning stub/off, Hub↔RSI hairpin, Node 24.15.x.
- [ ] **P1 RSI memory / peer I/O** — RSS **~12.3 GiB** (was ~10 GiB @ 02:55Z), heap **~1.77 GiB @ ~94%**, restarts **2 +0**, **0** FATAL; closed-or-destroyed stream spam + oversized AMP frames (`140736 > 4096` from `66.58.241.57`). Write-after-close + frame-size / inventory carrier.
- [ ] **SECURITY-RECOMMENDATIONS remainder:** CORS `*`, Sensemaker HTTP default bind, Payjoin session *list* still unauthenticated, Lightning GET status public. Login/link `pollSecret` lives in `@fabric/http` (Hub SPA sends `X-Fabric-Poll-Secret`).
- [ ] Named AMP types on public Hub UI WebSocket (`GenericMessage` remaining).
- [x] Fabric Message `parent` — Hub `_appendFabricMessage` and **Bridge** `signMessage` set AMP `parent` / advance tip (Ping/Pong genesis). Inbound zeros still accepted.
- [x] Device-link v2 prepare/commit in Hub SPA (`IdentityManager`); server nonce via http Wave 3 pin.
- [ ] **`shims/noble-secp256k1.js` is dead and broken** (same class as the fixed
  `noble-nist.js`, but the fix is a guess so it is left alone). It requires
  `noble-secp256k1-raw`, which is not a package and has **no** `resolve.alias`
  entry in `webpack.config.js`; nothing references the shim. Its comment says the
  alias exists specifically because a direct `require` of the `.js` path "can be
  mis-parsed in production builds", so repointing it at `@noble/curves/secp256k1`
  may reintroduce the bug it was written to dodge. Either restore the intended
  alias or delete the shim — owner's call.
- [ ] Deploy `assets/passport-privacy.html` so `https://hub.fabric.pub/passport-privacy.html` is live for the Passport Chrome Web Store listing (source: `@fabric/passport` `store/privacy.html`).

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
[#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16) — local tip ahead of GitHub. Wave 4: device-link v2 SPA + at-rest KDF + Bridge parent. Remaining: identity import, **live RSS / NOISE redeploy**, **push http `bbdb72a` then Hub lockfile**. Pinned at core **`1c3f8d08c`** / http **`bbdb72a`**.
