# Fabric Hub — Chromium extension

The extension runs **the same React application** as the hosted Hub (`HubInterface`, `Bridge`, `IdentityManager`), built with `webpack.extension.config.js` and `extension/scripts/popup.js`.

**Identity storage** is unchanged from the website: AES-protected material in **`localStorage`** under `fabric.identity.local`, and the unlocked xprv in **`sessionStorage`** under `fabric.identity.unlocked` for the current popup session (see `CLIENT_SECURITY_AUDIT.md`).

## Build

```bash
npm install
npm run build:extension
```

Chrome: **Extensions → Developer mode → Load unpacked** → select the `extension/` directory (after build: `vendor/`, `popup.bundle.js`, `manifest.json`, `popup.html`, `content.js`, `page-bridge.js`).

The content script injects **`page-bridge.js`** (a file URL, not inline script) so Hub pages with a strict **Content Security Policy** still expose `window.__FABRIC_HUB_EXTENSION__`.

## Hub URL

The popup may not have a useful default host. Set the Hub origin in **Settings** (`fabric.hub.address` in `localStorage` for the extension origin).

## Consuming `@fabric/hub` from another repo

The package name is `@fabric/hub`. You can depend on the git repo and `require('@fabric/hub/components/HubInterface')` via the `exports` field in `package.json`.

## `@fabric/passport` (separate extension) — background WebRTC mesh

The **Passport** extension (`fabric-browser-extension`) uses a different manifest and MV3 **service worker + offscreen** document to keep **Hub WebSocket signaling** alive after the user closes Hub tabs.

- **Hub-hosted installer page:** `assets/hub-mesh-bridge.html` — opens on the Hub origin; it `postMessage`s `FABRIC_HUB_REGISTER_MESH` / `FABRIC_HUB_UNREGISTER_MESH` (source `fabric-hub`). The Passport **content script** forwards that to the background, which stores `fabric_mesh_hub_registration` and starts the offscreen mesh (same as choosing **Register background mesh** in Passport Settings for the active Fabric node).
- **Site login (client-signed):** pages `postMessage` `{ source: 'fabric-site', type: 'FABRIC_SITE_LOGIN_REQUEST', sessionId, hub, origin, message }` (same origin). Passport queues the challenge, the popup approves, and POSTs BIP340 `{ signature, pubkeyHex, identity }` to `{hub}/sessions/:id/signatures` — the same player-login path as GoonCitizen desktop, GoonCitizen Android, and `fabric://login`. See Passport `src/constants/siteLogin.ts`, `src/UIElements/SiteLoginPrompt.tsx`.
- **Device link (mutual attestation):** Hub Identity → **Create link offer** returns `fabric://link?…` (QR + copy). The peer app opens that URL; on the Hub page, **Approve with Passport** `postMessage`s `{ source: 'fabric-site', type: 'FABRIC_DEVICE_LINK_REQUEST', sessionId, hub, origin }`. Passport signs as **responder**; the Hub initiator countersigns. After `linked`, both sides publish **IdentityCrossSign** (`POST /identity/cross-sign`) so the mesh treats the keys as one cluster. Seeds stay separate — see Hub `functions/fabricDeviceLink.js` and `functions/identityCluster.js`.

See Passport’s `src/background/fabricBackground.ts` and `src/fabric/hubMeshBridge.ts`.
