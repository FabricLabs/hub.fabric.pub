# Fabric Hub Security Audit
Living posture notes for **hub.fabric.pub** (`@fabric/hub` **0.1.0-RC1**). Re-run **`npm audit`** after dependency changes; keep this file aligned with the current lockfile.

## Status (2026-11-01)

| Area | Posture |
|------|---------|
| `@fabric/core` | Git pin `FabricLabs/fabric#feature/passport` (lockfile SHA `a76f49f03ce843dd2ac7dd4f4952fba0a04255b4`) |
| `@fabric/http` | Git pin `FabricLabs/fabric-http#feature/passport` (lockfile SHA `d6e836cd315e2ea3301ccfecd7f46239bd8b1f9c`) |
| npm `allow-git` | **`.npmrc` `allow-git=all`** — required for nested git-dep preparation (commit-SHA fetches of core/http); `root` is insufficient |
| Node | **`engines.node` = `26.12.1`** (aligned with core / http) |
| WebSocket (`ws`) | **Mitigated** — direct **`8.22.0`**; no override. jayson and webpack-bundle-analyzer keep their own `ws@7.5.13` (`^7.5.10`, patched) |
| Electron | **`44.9.3`** (clears the 39.x advisory set — popup/sandbox inheritance, cross-origin file/http reads, webview workers, permission origin attribution, eMudhra intermediates — and swaps `extract-zip` for `@electron-internal/extract-zip`). Needs macOS 13+, 64-bit only. 45 deprecates the synchronous `safeStorage` calls the admin-token store uses |
| electron-builder | **`26.18.0`** — resolves `tar@7.5.22` and pins `builder-util-runtime@9.7.0` itself; `@electron/asar`, `@electron/universal`, `ejs`, and `temp`'s `rimraf` are overridden (see Overrides) |
| nodemailer | **`10.2.1`** (10.x clears the 9.0.4 advisory set; 9.1.1 still left the addressparser DoS and cross-transport TLS `servername` reuse) |
| webpack / webpack-dev-server | **`5.112.2`** / **`6.1.0`** (no sockjs; proxy errors via http-proxy-middleware 4 `on.error`); `webpack-cli@5.1.4`; `terser-webpack-plugin@5.6.1`; `jsdom@30.1.3` (build-time HTML render, same as http) |
| bitcoinjs-lib / bip32 / ecpair | **`7.0.4`** / **`5.0.1`** / **`3.0.2`** — same as `@fabric/core`, so the tree holds one copy of each. Keys, scripts, and PSBT fields are `Uint8Array` and output values are `bigint` |
| mocha / c8 / jsdoc-to-markdown | **`12.0.3`** / **`12.0.0`** devDependencies; jsdoc-to-markdown **`9.1.3`** runs through `npx` in `make:api` and is not installed. mocha 12 resolves `serialize-javascript@7.1.4` (past the `</script` XSS, [GHSA-m5mm-p8h7-m29v](https://github.com/advisories/GHSA-m5mm-p8h7-m29v)) without an override |
| React Router | **`react-router-dom@7.18.4`** — see residual below; webpack pins CJS entrypoints (see Recommendations) |
| npm audit (this tree) | **0** (full and `--omit=dev`) with the overrides below; without them it reports 26 (23 moderate, 3 high) |

## Residual (accepted)

| Package | Severity | Notes |
|---------|----------|-------|
| `react-router` / `react-router-dom` **7.12–8.2** | high (advisory class) | [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) — **RSC mode** CSRF. Hub UI uses client **`BrowserRouter`** / SPA navigation, not React Server Components. Current `npm audit` does not flag this pin; keep watching for a non-RSC patch before changing it. Downgrading to **7.11.0** reintroduces earlier open-redirect advisories. Stay on **7.18.x**. |

## Overrides for mitigated findings

npm applies overrides only at the root, so the ones `@fabric/core` and `@fabric/http` carry do not reach this tree; Hub repeats them here.

| Override | Reason |
|----------|--------|
| `minimatch@>=9.0.0 <11.0.1` → `=11.0.3` | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (fixed only in 11.x). Range-keyed: 9–10 callers (`ts-morph` via core, `editorconfig` via `js-beautify`, mocha, c8, electron-builder) use the named `{ minimatch }` export 11 keeps; 3.x/5.x callers call the module itself, which 11 is not |
| `glob@>=9.0.0 <14.0.2` → `=14.0.3` | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) (AbortSignal bypass) |
| `page` → `path-to-regexp` `=1.9.0` | [GHSA-9wv6-86v2-598j](https://github.com/advisories/GHSA-9wv6-86v2-598j) (high, ReDoS) in `page`'s `~1.2.1` copy, reached through `@fabric/http` |
| `@electron/asar` → `=4.3.1` | 3.x pulls `glob@7` + `minimatch@3`. 4.x is ESM-only with the same functions; electron-builder loads it with `import()`, `electron-winstaller` through Node 26 `require(esm)` |
| `@electron/universal` → `=3.0.6` | 2.x pulls `dir-compare` (`minimatch@3`, even in dir-compare 5) and asar 3. 3.x takes the same `makeUniversalApp` options electron-builder passes and is loaded with `import()` |
| `ejs` → `=7.0.2` | 3.x pulls `jake` → `filelist` → `minimatch@5`. 7.x has no dependencies; electron-builder uses only `ejs.compile` (MSI target) |
| `temp` → `rimraf` `=6.1.3` | `rimraf@2.6` pulls `glob@7` + `minimatch@3`. `electron-winstaller` only calls `temp.track()` + `mkdir`, whose exit cleanup uses `rimraf.sync`, which 6.x keeps. `temp.cleanup()` (callback `rimraf`) would break, and nothing calls it |

Drop each when its parent moves past it (electron-builder adopting asar 4 / universal 3 / ejs ≥4, `page` adopting `path-to-regexp` ≥1.9, `electron-winstaller` leaving `temp`).

The `elliptic` → `@soatok/elliptic-to-noble` override went with `crypto-browserify`: webpack maps `crypto` / `node:crypto` to `@fabric/http/functions/browserCrypto` (noble hashes and ciphers), so no `elliptic`, `asn1.js`, or `browserify-*` package is installed or bundled.

Electron ≥42 has no install script: the binary downloads the first time `electron` runs (`npm run desktop`, or `npx install-electron`), so it needs no `allowScripts` entry.

## Recommendations

1. After dependency edits: **`npm ci`** (or `npm i`) then **`npm audit`** and **`npm run ci`** (`build` + `test:unit`).
2. Keep core/http on `feature/rsi` during RSI, then re-pin releases to lockfile SHAs; use **`npm run link:fabric`** for local monorepo work. **`npm run report:install` removes `package-lock.json`** then `npm i --allow-git=all` — bump tips with `npm install FabricLabs/fabric#feature/rsi FabricLabs/fabric-http#feature/rsi --allow-git=all` when upstream moves.
3. Do not run **`npm audit fix --force`** casually — it has proposed Electron, jsdoc-to-markdown, electron-builder and React Router downgrades that fight the chosen pins.
4. Revisit React Router when a release fixes GHSA-qwww without regressing open-redirect advisories.
5. Webpack must keep **`conditionNames`** without bare **`import`**, plus CJS aliases for **`react-router$` / `react-router-dom$` / `react-router/dom$`** — otherwise RR7’s `.mjs` exports break the SPA bundle at runtime.

### PR #15 review triage (`feature/rsi`)

| Item | Status |
|------|--------|
| Tracked-contract `__proto__` / overwrite | Fixed — `assertSafeContractId` + pending signer/origin/digest match |
| Setup-status timeout fail-closed | Fixed — timeout sets `setupStatusTimedOut` only (no `setupChecked`) |
| Peer alias attribution (WebRTC / hub wire) | Fixed |
| Chat `created` Number(null) → epoch 0 | Fixed — Hub wrap in `functions/fabricChatNormalize.js` |
| Beacon `addSignature` ready/sealed guard | Fixed upstream in core (`ready` \|\| `sealed`); Hub re-export |
| Beacon `createRound` omitted `policy` | Fixed — Hub wrapper defaults `policy = {}` (core also defaults) |
| Beacon ready-round persist retry | Fixed in core `Beacon#submitFederationEpochSignature`; Hub `contracts/beacon.js` is a thin subclass (duplicate override dropped) |
| `waitForHub` stalled-socket hang | Fixed — per-request `timeout` + `req.destroy` |
| Wallet cache / crowdfund account / docs upload race / edit `response.ok` | Fixed |
| Extension identity sync writing `xprv` | Fixed — `chrome.storage.local` payload is watch-only |
| Payment test route default | Fixed — opt-in (`FABRIC_HTTP_PAYMENTS_EXPOSE_TEST_ROUTE`) |
| Device-link linked GET starving the peer | Retired — device-link removed; pairing is core delegation (`DELEGATION_LINK_*`, code shown on both screens, native confirm) |
| Site-login / device-link Origin redeem | Retired — device-link removed; pairing is core delegation (`DELEGATION_LINK_*`, code shown on both screens, native confirm) |
| Device-link client-supplied nonce | Retired — device-link removed; pairing is core delegation (`DELEGATION_LINK_*`, code shown on both screens, native confirm) |
| Device-link FIFO eviction under create flood | Retired — device-link removed; pairing is core delegation (`DELEGATION_LINK_*`, code shown on both screens, native confirm) |
| Identity import / stronger at-rest crypto | Deferred — heavy lift |
| Large WIP split into stacked PRs | Open — process ([#15](https://github.com/FabricLabs/hub.fabric.pub/pull/15) merged; remaining RSI is follow-up PRs) |
| Fabric hallmarks (opt-in OP_RETURN) | In tree — Hub publish/scan + docs; regtest-only |

## Disclosure

Canonical monitored contact: **`security@fabric.pub`** (also listed on `@fabric/http` README / SECURITY). GitHub Security Advisories / hub issues URL (`FABRIC_ISSUES_URL`) are alternate private channels.
