# Fabric Hub — Chromium extension

The extension runs **the same React application** as the hosted Hub (`HubInterface`, `Bridge`, `IdentityManager`), built with `webpack.extension.config.js` and `extension/scripts/popup.js`.

**Identity storage** is unchanged from the website: a sealed account vault in **`localStorage`** under `fabric.identity.local` (master xprv sealed with the lock password, no mnemonic). Unlocked keys stay in popup memory only (see `CLIENT_SECURITY_AUDIT.md`).

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
- **Sign-in (Passport v2, spec in `@fabric/core` `docs/PASSPORT.md`):** the page gets a `PASSPORT_CHALLENGE` from its own server (`POST /sessions/challenges`) and posts `{ source: 'fabric-site', type: 'PASSPORT_CHALLENGE', challenge }` to its own window with a `MessagePort` (`@fabric/http` `functions/passportPage`; the page first asks whether Passport is there with a `PASSPORT_HELLO` on a transferred port, `probePassport`). Passport checks the challenge's origin against the tab's real URL, the popup shows the site and what is shared, and the reply `{ type: 'PASSPORT_ASSERTION', ok: true, assertion }` comes back on that port only. The page posts it to `POST /sessions`; the server redeems it once with its binding cookie. Passport never posts to a server itself and never reads a token. See Passport `src/constants/siteLogin.ts`, `src/UIElements/SiteLoginPrompt.tsx`.
- **Linked signers (delegation, `@fabric/core` `docs/DELEGATION.md`):** Passport pairs with the desktop Hub from **Linked signers → Pair with a Hub** (`DELEGATION_LINK_OFFER`; both sides show a six-digit code, the Hub in a native dialog), then grants flow both ways. Passport can then ask the Hub to sign a site sign-in or a shared-wallet invite / withdrawal (`DELEGATION_REQUEST` → `DELEGATION_RESULT`); the Hub's signing rules answer, or the request waits for the operator. Each side keeps its own key and message store. See Hub `services/delegation.js` and [docs/DESKTOP.md](docs/DESKTOP.md).

See Passport’s `src/background/fabricBackground.ts` and `src/fabric/hubMeshBridge.ts`.
