# Upstream alignment (Hub, `@fabric/http`, `@fabric/core`)

Downstream applications (e.g. **sensemaker**) inherit Hub as the browser gateway and operator shell. For a coordinated major release, align these layers and **delete duplicated code** downstream by importing from `@fabric/hub` instead.

## `@fabric/hub` (this repo)

**Prefer importing from Hub rather than reimplementing:**

| Area | Hub surface | Downstream can drop |
|------|-------------|---------------------|
| Delegation + desktop auth | `functions/fabricDelegation.js`, `functions/fabricDesktopAuth.js` | Custom session/sign REST, duplicate RPC names |
| UI shell | `HubInterface`, `DelegationSigningModal`, `SettingsHome`, `SecurityHome`, `SecuritySessionHome` — **`/settings`**, **`/settings/security`**, **`/sessions/:id`**; **`/sessions`**, **`/security`** → **`/settings/security`** | Duplicate routes / modals |
| Electron | `scripts/desktop.js`, `scripts/desktop-preload.js` | Native `dialog` flows; duplicate protocol handling |
| Exports | `package.json` `exports`: `./services/hub.js`, `./components/HubInterface`, `./components/DelegationSigningModal`, `./components/SettingsHome`, `./components/SecuritySessionHome`, `./types/LightningChannel` | — |

- **Delegation** — HTTP: `GET /sessions`, `GET /sessions/:sessionId/delegation/audit`, `GET|DELETE /sessions/:id`; RPC `PostDelegationSignatureMessage`, `GetDelegationSignatureMessage`, `ResolveDelegationSignatureMessage` (resolve uses delegation **sessionId** in params as capability; not limited to loopback).
- **Hub service** — `services/hub.js` registers routes, JSON-RPC, WebSocket methods, optional `spaFallback` for SPA refresh.

## `@fabric/http`

- **Branch** — Hub currently depends on `FabricLabs/fabric-http#feature/v0.1.0-RC1` (see `package.json`).
- **Lift here (reduce Hub/sensemaker glue)** — Single **JSON-RPC over HTTP** pipeline: `POST /services/rpc` with `{ method, params }`, shared error shape, optional **`jsonrpc: '2.0'`** in responses. **Route precedence** so `GET /sessions/:id/delegation/audit` and `POST /services/rpc` are not swallowed by SPA fallbacks. **WebSocket** `JSONCall` should mirror HTTP method registration so delegation works over either transport.
- **CORS** — If downstream serves UI from a different origin than the Hub API, centralize CORS + preflight in **fabric-http** rather than per-app.

## `@fabric/core`

- **Types** — Message opcodes, `Key` / `Identity`, Fabric message types for delegation audit (`DELEGATION_SIGNATURE_*` via Hub `_appendFabricMessage`).
- **Sidechain / contract namespaces** — prefer core over Hub copies:

| Surface | Core module | Hub facade / consumer |
|---------|-------------|------------------------|
| Logical sidechain document | `@fabric/core/functions/sidechainState` | `functions/sidechainState.js` (re-export) |
| Accept `CONTRACT_PUBLISH` → `sidechains/<id>/` + parent `/namespaces/<id>` seal | `@fabric/core/functions/contractStatechains` | `functions/contractStatechains.js` |
| Beacon k-of-n epoch Schnorr rounds | `@fabric/core/functions/beaconFederationSigning` | `functions/beaconFederationSigning.js` |
| Shared outer / body / activity type catalogs | `@fabric/core/functions/applicationNamespaces` | Hub + GoonCitizen message-type modules |
| Node `fs` contract sidechain (desktop/relay) | `@fabric/core/functions/contractSidechainLocal` | GoonCitizen `functions/contractSidechain.js` |

- **Linking** — `npm link @fabric/core` from a sibling `fabric/` checkout when developing all three (see **DEVELOPERS.md**). Hub facades use `try { require('@fabric/core/…') }` with a local fallback so CI against a lagging published tarball still boots.

## Downstream apps

Depend on published `@fabric/hub` (or git/path) and **compose** `HubInterface` / re-export routes instead of copying `fabricDelegation` or security components. Keep only **branding** (theme, copy, extra routes) in sensemaker.
