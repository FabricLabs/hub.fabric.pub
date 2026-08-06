# Fabric Hub Security Audit
Living posture notes for **hub.fabric.pub** (`@fabric/hub` **0.1.0-RC1**). Re-run **`npm audit`** after dependency changes; keep this file aligned with the current lockfile.

## Status (2026-08-06)

| Area | Posture |
|------|---------|
| `@fabric/core` | Git pin `FabricLabs/fabric#feature/rsi` |
| `@fabric/http` | Git pin `FabricLabs/fabric-http#feature/rsi` (post security pass) |
| npm `allow-git` | **`.npmrc` `allow-git=all`** — required for nested git-dep preparation (commit-SHA fetches of core/http); `root` is insufficient |
| Node | **`engines.node` = `24.15.0`** (aligned with core / http) |
| WebSocket (`ws`) | **Mitigated** — direct + override **`8.21.2`** |
| Electron | **`39.8.10`** (clears Electron ≤39.8.9 advisory set on prior 36.x pin) |
| electron-builder | **`26.15.7`** + overrides `tar@7.5.22`, `builder-util-runtime@9.7.0` |
| nodemailer | **`9.0.4`** |
| webpack / webpack-dev-server | **`5.109.2`** / **`5.2.6`**; `uuid@11.1.1` override (sockjs / jayson) |
| React Router | **`react-router-dom@7.18.2`** — see residual below; webpack pins CJS entrypoints (see Recommendations) |
| npm audit | Prefer **0** highs on runtime paths; residual RSC advisory documented |

## Residual (accepted)

| Package | Severity | Notes |
|---------|----------|-------|
| `react-router` / `react-router-dom` **7.12–8.2** | high | [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) — **RSC mode** CSRF. Hub UI uses client **`BrowserRouter`** / SPA navigation, not React Server Components. Downgrading to **7.11.0** reintroduces earlier open-redirect advisories on the 6.x–7.17 line. Stay on **7.18.2** until an upstream patch lands outside the RSC range. |

## Overrides that keep the tree clean

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
2. Keep core/http git pins on the same RC branch; use **`npm run link:fabric`** for local monorepo work.
3. Do not run **`npm audit fix --force`** casually — it has proposed Electron 43 and React Router downgrades that fight the chosen pins.
4. Revisit React Router when a release fixes GHSA-qwww without regressing open-redirect advisories.
5. Webpack must keep **`conditionNames`** without bare **`import`**, plus CJS aliases for **`react-router$` / `react-router-dom$` / `react-router/dom$`** — otherwise RR7’s `.mjs` exports break the SPA bundle at runtime.

## Disclosure

Report vulnerabilities per project README / operator contacts (`security@fabric.pub` where listed).
