# Fabric Hub Security Audit
Living posture notes for **hub.fabric.pub** (`@fabric/hub` **0.1.0-RC1**). Re-run **`npm audit`** after dependency changes; keep this file aligned with the current lockfile.

## Status (2026-08-14)

| Area | Posture |
|------|---------|
| `@fabric/core` | Git pin `FabricLabs/fabric#feature/rsi` (lockfile SHA `1fc616492428ec6e8c731e3afb74fd841407aa0e`) |
| `@fabric/http` | Git pin `FabricLabs/fabric-http#feature/rsi` (lockfile SHA `852520a2bd1070bb974b1a34297811f3c63588eb`) |
| npm `allow-git` | **`.npmrc` `allow-git=all`** — required for nested git-dep preparation (commit-SHA fetches of core/http); `root` is insufficient |
| Node | **`engines.node` = `24.15.0`** (aligned with core / http) |
| WebSocket (`ws`) | **Mitigated** — direct + override **`8.21.2`** |
| Electron | **`39.8.10`** (clears Electron ≤39.8.9 advisory set on prior 36.x pin) |
| electron-builder | **`26.15.7`** + overrides `tar@7.5.22`, `builder-util-runtime@9.7.0` |
| nodemailer | **`9.0.4`** |
| webpack / webpack-dev-server | **`5.109.2`** / **`5.2.6`**; `uuid@11.1.1` override (sockjs / jayson) |
| React Router | **`react-router-dom@7.18.2`** — see residual below; webpack pins CJS entrypoints (see Recommendations) |
| npm audit (this tree) | **6 high** — `extract-zip` symlink traversal ([GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) / CVE-2026-56876) via `puppeteer` / `@puppeteer/browsers` (`@fabric/http`) and `electron`. **No upstream patched release.** Build/dev extraction only; do not pass untrusted zips to those tools. |

## Residual (accepted)

| Package | Severity | Notes |
|---------|----------|-------|
| `react-router` / `react-router-dom` **7.12–8.2** | high (advisory class) | [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) — **RSC mode** CSRF. Hub UI uses client **`BrowserRouter`** / SPA navigation, not React Server Components. Current `npm audit` does not flag this pin; keep watching for a non-RSC patch before changing it. Downgrading to **7.11.0** reintroduces earlier open-redirect advisories. Stay on **7.18.2**. |
| `extract-zip` (via puppeteer + electron) | high | Abandoned package; no patched version. Electron uses it at **build time**; Puppeteer browser download is **dev/test**. Not on the Hub HTTP request path. |

## Overrides for mitigated runtime findings

| Override | Why |
|----------|-----|
| `ws@8.21.2` | Direct + transitive (core/jayson, http, webpack-dev-server) |
| `uuid@11.1.1` | jayson + sockjs (webpack-dev-server) |
| `tar@7.5.22` | electron-builder / node-gyp extraction path |
| `builder-util-runtime@9.7.0` | electron-updater credential leak class |
| `elliptic` → `@soatok/elliptic-to-noble` | Existing Hub pin |
| `serialize-javascript@7.0.5` | Existing Hub pin |

`package.json` **`allowScripts.electron@39.8.10`** is required so CI/desktop can download the Electron binary under npm’s install-scripts policy.

## Recommendations

1. After dependency edits: **`npm ci`** (or `npm i`) then **`npm audit`** and **`npm run ci`** (`build` + `test:unit`).
2. Keep core/http on `feature/rsi` during RSI, then re-pin releases to lockfile SHAs; use **`npm run link:fabric`** for local monorepo work. **`npm run report:install` wipes `package-lock.json`** then `npm i --allow-git=all` — bump tips with `npm install FabricLabs/fabric#feature/rsi FabricLabs/fabric-http#feature/rsi --allow-git=all` when upstream moves.
3. Do not run **`npm audit fix --force`** casually — it has proposed Electron 43 and React Router downgrades that fight the chosen pins. There is **no** `extract-zip` fix to force in.
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
| Device-link FIFO eviction under create flood | Open — nit; per-origin quota |
| Identity import / stronger at-rest crypto | Deferred — heavy lift |
| Large WIP split into stacked PRs | Open — process |
| Fabric hallmarks (opt-in OP_RETURN) | In tree — Hub publish/scan + docs; regtest-only |

## Disclosure

Canonical monitored contact: **`security@fabric.pub`** (also listed on `@fabric/http` README / SECURITY). GitHub Security Advisories / hub issues URL (`FABRIC_ISSUES_URL`) are alternate private channels.
