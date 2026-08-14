# Upstream alignment (Hub, `@fabric/http`, `@fabric/core`)

Downstream applications inherit Hub as the browser gateway and operator shell. For a coordinated major release, align these layers and **delete duplicated code** downstream by importing from `@fabric/hub` instead.

## Downstream Hub subclass

Some applications **subclass Hub** (e.g. compose `services/hub.js` and mount extra HTTP/routes). Prefer matching Hub SPA routes rather than forking them:

| Path | Component |
|------|-----------|
| `/settings` | `SettingsHome` |
| `/settings/security` | `SecurityHome` |
| `/sessions/:sessionId` | `SecuritySessionHome` |
| `/sessions`, `/security` | Redirect → `/settings/security` |

REST **`/sessions`** is unchanged. See **`package.json` → `exports`**. Layers:

- **`@fabric/hub`** — `HubInterface`, `DelegationSigningModal`, `SettingsHome`, `SecurityHome`, `SecuritySessionHome`; `fabricDelegation`, `fabricDesktopAuth`; Electron `main` / `preload`.
- **`@fabric/http`** — SPA fallback + route order vs JSON APIs; **`POST /services/rpc`**.
- **`@fabric/core`** — Key/Identity; follow **`functions/fabricMessageRegistry.js`** for message strings.

## `@fabric/hub` (this repo)

**Prefer importing from Hub rather than reimplementing:**

| Area | Hub surface | Downstream can drop |
|------|-------------|---------------------|
| Delegation + desktop auth | `functions/fabricDelegation.js`, `functions/fabricDesktopAuth.js` — **package exports** `@fabric/hub/functions/fabricDesktopAuth`, `…/fabricDeviceLink`, `…/fabricDelegation` | Custom session/sign REST, duplicate RPC names, `path.join(hubRoot, …)` deep-requires |
| UI shell | `HubInterface`, `DelegationSigningModal`, `SettingsHome`, `SecurityHome`, `SecuritySessionHome` — **`/settings`**, **`/settings/security`**, **`/sessions/:id`**; **`/sessions`**, **`/security`** → **`/settings/security`** | Duplicate routes / modals |
| Electron | `scripts/desktop.js`, `scripts/desktop-preload.js` | Native `dialog` flows; duplicate protocol handling |
| Exports | `package.json` `exports`: `./services/hub.js`, `./services/fabric`, `./services/email`, `./components/HubInterface`, `./components/DelegationSigningModal`, `./components/SettingsHome`, `./components/SecuritySessionHome`, `./types/LightningChannel`, `./functions/fabricDelegation` (+ Local), identity/auth mounts | — |

- **Delegation** — HTTP: `GET /sessions`, `GET /sessions/:sessionId/delegation/audit`, `GET|DELETE /sessions/:id`; RPC `PostDelegationSignatureMessage`, `GetDelegationSignatureMessage`, `ResolveDelegationSignatureMessage` (resolve uses delegation **sessionId** in params as capability; not limited to loopback). Downstream apps that own password `GET /sessions` may mount audit + DELETE via `mountFabricDelegationHttp({ mountSessionsList: false })`.
- **Hub service** — `services/hub.js` registers routes, JSON-RPC, WebSocket methods, optional `spaFallback` for SPA refresh.

## `@fabric/http`

- **Branch** — see `package.json` for the pinned git ref (`feature/rsi` or release tag).
- **Invite JSON** — `functions/federationContractInvite` (FederationContractInvite v1/v2 + application `groupId` / `groupName` / `inviteePubkey`). Hub and application repos re-export; do **not** reintroduce parse/build in `@fabric/core`.
- **Lift here (reduce Hub/app glue)** — Single **JSON-RPC over HTTP** pipeline: `POST /services/rpc` with `{ method, params }`, shared error shape, optional **`jsonrpc: '2.0'`** in responses. **Route precedence** so `GET /sessions/:id/delegation/audit` and `POST /services/rpc` are not swallowed by SPA fallbacks. **WebSocket** `JSONCall` should mirror HTTP method registration so delegation works over either transport.
- **Hub origin allowlist + HTTP shared mode** — `@fabric/http/functions/fabricHubAllowlist` and `@fabric/http/functions/httpSharedMode` (`resolveHttpListenHost`). Hub/apps re-export; Passport mirrors the allowlist in-extension.
- **Site login / device-link identity HTTP** — `@fabric/http/functions/fabricSiteLoginVerify`, `fabricSiteLogin`, `fabricSiteLoginHttp`, `fabricDeviceLinkMessages`, `fabricDeviceLinkHttp`, `fabricDeviceLinkClient`, `fabricProtocolLogin`, `fabricDeviceLinkProtocol`. Hub `fabricDesktopAuth` / `fabricDeviceLink` are thin wrappers (SPA + delegation hooks). Application `fabricSiteLogin` wraps http session helpers + Bearer issuance.
- **OracleAttestation + peer host** — `@fabric/http/functions/oracleAttestation` (BIP340 envelope sign/verify + `stableStringify`); `@fabric/http/functions/fabricPeerHost` (seeds, self-dial filters, injectable `createIsKnownAppRelayType`). Hub `services/peering.js` and application LiveRelay / `FabricNetwork` consume these; claim builders stay app-specific.
- **Peering HTTP mount + chat normalize** — `@fabric/http/functions/fabricPeeringHttp` (`tryHandlePeeringHttp`, `buildPeeringCapabilitiesBody`); `@fabric/http/functions/fabricPubkey` + `fabricChatNormalize` (x-only author id). Hub/apps re-export; LiveRelay binds claim builders into the shared mount.
- **Hub.start phases** — [`docs/HUB_LIFECYCLE.md`](HUB_LIFECYCLE.md) / `functions/hubLifecycle.js`: named phases + `beforeRoutes`/`afterRuntime` hooks for subclasses; LiveRelay stays compose-only.
- **CORS** — If downstream serves UI from a different origin than the Hub API, centralize CORS + preflight in **fabric-http** rather than per-app.

## `@fabric/core`

- **Types** — Message opcodes, `Key` / `Identity`, Fabric message types for delegation audit (`DELEGATION_SIGNATURE_*` via Hub `_appendFabricMessage`).
- **Sidechain / contract namespaces** — prefer core over Hub copies:

| Surface | Core module | Hub facade / consumer |
|---------|-------------|------------------------|
| Logical sidechain document | `@fabric/core/functions/sidechainState` | `functions/sidechainState.js` (re-export) |
| Accept `CONTRACT_PUBLISH` → `sidechains/<id>/` + parent `/namespaces/<id>` seal | `@fabric/core/functions/contractStatechains` | `functions/contractStatechains.js` |
| Beacon k-of-n epoch Schnorr rounds | `@fabric/core/functions/beaconFederationSigning` | `functions/beaconFederationSigning.js` |
| Contract-namespace tip Schnorr (`ContractStateTip`) | `@fabric/core/functions/contractStateSigning` | `functions/contractStateSigning.js` — **update Hub docs/RPC if tip kind changes** |
| Contract Taproot failover ladder (`after`/`until`/migrate) | `@fabric/core/functions/contractTaproot` | `functions/federationVault.js` (re-export); Beacon treasury via `toAddress(spendLadder)` |
| Shared outer / body / activity type catalogs | `@fabric/core/functions/applicationNamespaces` | Hub + application message-type modules |
| Node `fs` contract sidechain (desktop/relay) | `@fabric/core/functions/contractSidechainLocal` | Application `functions/contractSidechain.js` |

- **Linking** — `npm link @fabric/core` from a sibling `fabric/` checkout when developing all three (see **DEVELOPERS.md**). Hub facades use `try { require('@fabric/core/…') }` with a local fallback so CI against a lagging published tarball still boots.

## Downstream apps

Depend on published `@fabric/hub` (or git/path) and **compose** `HubInterface` / re-export routes instead of copying `fabricDelegation` or security components. Keep only **branding** (theme, copy, extra routes) in the application repo.
