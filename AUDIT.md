# Fabric Hub Security Audit
Living posture notes for **hub.fabric.pub** (`@fabric/hub` **0.1.0-RC1**). Re-run **`npm audit`** after dependency changes; keep this file aligned with the current lockfile.

## Status (2026-10-24)

| Area | Posture |
|------|---------|
| `@fabric/core` | Git pin `FabricLabs/fabric#feature/channels` (lockfile SHA `1ba3b3cd0376858824c94ae17929eb2e77111a91`) |
| `@fabric/http` | Git pin `FabricLabs/fabric-http#feature/channels` (lockfile SHA `123c850294802dc6adc66fbee17060aa2a8548ea`) |
| npm `allow-git` | **`.npmrc` `allow-git=all`** — required for nested git-dep preparation (commit-SHA fetches of core/http); `root` is insufficient |
| Node | **`engines.node` = `26.12.1`** (aligned with core / http) |
| WebSocket (`ws`) | **Mitigated** — direct + override **`8.22.0`** |
| Electron | **`44.9.3`** (clears the 39.x advisory set — popup/sandbox inheritance, cross-origin file/http reads, webview workers, permission origin attribution, eMudhra intermediates — and swaps `extract-zip` for `@electron-internal/extract-zip`). Needs macOS 13+, 64-bit only. 45 deprecates the synchronous `safeStorage` calls the admin-token store uses |
| electron-builder | **`26.18.0`** + overrides `tar@7.5.22`, `builder-util-runtime@9.7.0` |
| nodemailer | **`10.2.1`** (10.x clears the 9.0.4 advisory set; 9.1.1 still left the addressparser DoS and cross-transport TLS `servername` reuse) |
| webpack / webpack-dev-server | **`5.112.2`** / **`5.2.6`**; `terser-webpack-plugin@5.6.1`; `uuid@11.1.1` override (sockjs / jayson) |
| mocha / c8 / jsdoc-to-markdown | **`12.0.3`** / **`12.0.0`** / **`9.1.3`**, all **devDependencies** (test, coverage, and `make:api` tooling only). mocha 12 resolves `serialize-javascript@7.1.4` (past the `</script` XSS, [GHSA-m5mm-p8h7-m29v](https://github.com/advisories/GHSA-m5mm-p8h7-m29v)) without an override |
| React Router | **`react-router-dom@7.18.4`** — see residual below; webpack pins CJS entrypoints (see Recommendations) |
| npm audit (this tree) | **0** (full and `--omit=dev`) |

## Residual (accepted)

| Package | Severity | Notes |
|---------|----------|-------|
| `react-router` / `react-router-dom` **7.12–8.2** | high (advisory class) | [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) — **RSC mode** CSRF. Hub UI uses client **`BrowserRouter`** / SPA navigation, not React Server Components. Current `npm audit` does not flag this pin; keep watching for a non-RSC patch before changing it. Downgrading to **7.11.0** reintroduces earlier open-redirect advisories. Stay on **7.18.x**. |

## Overrides for mitigated runtime findings

| Override | Why |
|----------|-----|
| `ws@8.22.0` | Direct + transitive (core/jayson, http, webpack-dev-server) |
| `uuid@11.1.1` | jayson + sockjs (webpack-dev-server) |
| `tar@7.5.22` | electron-builder / node-gyp extraction path |
| `builder-util-runtime@9.7.0` | electron-updater credential leak class |
| `elliptic` → `@soatok/elliptic-to-noble` | Existing Hub pin |
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
| Device-link linked GET starving the peer | Fixed upstream in `@fabric/http` (keep until TTL; Hub re-exports) |
| Site-login / device-link Origin redeem | Open — inherited from `@fabric/http` (possession proof). Http device-link also allows thin-client Origins on allowlisted hubs; still not a possession proof. |
| Device-link client-supplied nonce | Open — inherited from `@fabric/http` (prefer always-fresh nonce) |
| Device-link FIFO eviction under create flood | Fixed — http `MAX_SESSIONS_PER_ORIGIN`; Hub re-exports |
| Identity import / stronger at-rest crypto | Deferred — heavy lift |
| Large WIP split into stacked PRs | Open — process ([#15](https://github.com/FabricLabs/hub.fabric.pub/pull/15) merged; remaining RSI is follow-up PRs) |
| Fabric hallmarks (opt-in OP_RETURN) | In tree — Hub publish/scan + docs; regtest-only |

## Disclosure

Canonical monitored contact: **`security@fabric.pub`** (also listed on `@fabric/http` README / SECURITY). GitHub Security Advisories / hub issues URL (`FABRIC_ISSUES_URL`) are alternate private channels.
