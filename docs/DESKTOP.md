# Fabric Hub — desktop (Electron)
The desktop shell runs the same Hub **Node** process as `npm start` and opens a **BrowserWindow** to `http://127.0.0.1:<port>/` (default port from `settings/local.js`, usually `8080`).

## Layout
| Path | Role |
|------|------|
| `scripts/desktop.js` | Electron main: tray, **Run at startup**, spawns Hub with `ELECTRON_RUN_AS_NODE`, sets `FABRIC_HUB_APP_ROOT` / `FABRIC_HUB_USER_DATA`, waits for HTTP, loads the UI |
| `scripts/startup/` | OS launchers packed as `resources/startup/` (macOS command + LaunchAgent, Windows cmd/vbs, Linux sh + XDG desktop) |
| `functions/desktopOpenAtLogin.js` | Login-item payload, XDG autostart, `desktop-shell.json` |
| `scripts/desktop-preload.js` | Exposes `window.fabricDesktop` (`isDesktopShell`, platform, versions, `onLoginPrompt`, `pullPendingLoginPrompt`) |
| `scripts/desktopHubProbe.js` | Startup HTTP/P2P probes (whether to use an existing loopback Hub) |
| `components/DelegationSigningModal.js` | In-app Semantic UI modals for **fabric://login** approval and **delegation** signature queue (replaces native OS dialogs) |
| `dist/` | **electron-builder** output (gitignored): installers / unpacked apps |

Writable state (LevelDB, Bitcoin regtest data, Hub `STATE`) lives under the OS **userData** directory when env `FABRIC_HUB_USER_DATA` is set (the desktop shell always sets this).

**Reset first-time setup (desktop is not the git checkout):**

1. Quit Fabric Hub (and any other process on the Hub HTTP port, default **8080**).
2. From the repo: **`npm run reset:stores`** — wipes CLI `stores/hub`, desktop **Fabric Hub** userData `stores/hub`, the legacy **Electron** profile copy, and (default) Bitcoin/Lightning datadirs + logs beside those roots. **`npm run reset:stores -- --setup-only`** leaves chain data. **`--dry-run`** prints paths. Tray **Reveal Hub data folder** still shows the live desktop root:
   - macOS packaged / current desktop: `~/Library/Application Support/Fabric Hub/stores/hub`
   - unpackaged `electron scripts/desktop.js` **before** the userData pin: `~/Library/Application Support/Electron/stores/hub`
   - Linux: `~/.config/Fabric Hub/stores/hub`
   - Windows: `%APPDATA%\Fabric Hub\stores\hub`
3. Relaunch. `rm -rf stores/hub` in the repo only resets **`npm start`** (cwd). Admin → **Self-destruct** wipes the live process’s data directory.

Unpackaged Electron used to store Hub `STATE` in the generic **Electron** profile. The shell now pins userData to **Fabric Hub** (same as a packaged build) and copies `stores/`, `desktop-shell.json`, and `logs/` from the Electron profile when Fabric Hub is empty. `FABRIC_DESKTOP_SKIP_ELECTRON_MIGRATE=1` skips that copy. Static assets are read from **`FABRIC_HUB_APP_ROOT`** (the app bundle / `app.asar` when packaged), so the Hub does not rely on `process.cwd()` for `./assets` in packaged builds.

### External Hub on loopback (no duplicate embedded node)
On startup the shell probes **`http://127.0.0.1:<FABRIC_HUB_PORT>/`** with **HTTP `OPTIONS`** (same discovery shape as `@fabric/http` — JSON `name`, `description`, `resources`). If the response matches a Fabric Hub (`hub.fabric.pub` server name or `/services/` routes in `resources`), the desktop **does not** spawn `scripts/hub.js` and only opens the BrowserWindow (embedded Hub is skipped; quit does not stop your external Hub). It also probes **Fabric P2P** on **`127.0.0.1:7777`** (configurable) with a short-lived `@fabric/core` `Peer` client so logs can show whether a Fabric listener is present; **attachment** is still decided from the HTTP OPTIONS Hub metadata.

- **`FABRIC_DESKTOP_ALWAYS_SPAWN_HUB=1`** — always spawn the embedded Hub (previous behavior).
- **`FABRIC_DESKTOP_P2P_PROBE_HOST`** — override P2P probe host (default `127.0.0.1`).
- **`FABRIC_PORT` / `FABRIC_P2P_PORT`** — P2P probe port (default `7777`).

**Dev note:** With `electron scripts/desktop.js`, `app.getAppPath()` is the `scripts/` folder, not the repo root. `scripts/desktop.js` sets `FABRIC_HUB_APP_ROOT` to the parent of `scripts/` (the repo root) so `scripts/hub.js` and `assets/` resolve correctly.

### Playnet L1 mesh + desktop (Fabric + Bitcoin P2P)

With the **desktop Hub** running on loopback (HTTP default **8080**, Fabric P2P default **7777**, Bitcoin regtest P2P port from **Bitcoin → status** or your `bitcoin` settings), you can merge it into the **ephemeral playnet** from `tests/playnet.market.integration.js`:

| Env | Purpose |
|-----|---------|
| `FABRIC_PLAYNET_DESKTOP_FABRIC` | `host:port` of this Hub’s Fabric listener (e.g. `127.0.0.1:7777`). Each playnet mesh hub calls `AddPeer` to it. |
| `FABRIC_PLAYNET_DESKTOP_BITCOIN_P2P` | `host:port` of this Hub’s **Bitcoin Core P2P** (regtest). Playnet hub 0 adds it via `p2pAddNodes` / `addnode` so both nodes sync the same regtest chain. |
| `FABRIC_PLAYNET_DESKTOP_HTTP` | Base URL for logs, e.g. `http://127.0.0.1:8080`. If unset but either variable above is set, hints default to `http://127.0.0.1:8080`. |
| `FABRIC_PLAYNET_BROWSER_HTTP_BASE` | Optional: point automated Puppeteer + `GetBitcoinStatus` at this Hub (usually the same as desktop HTTP). |
| `FABRIC_PLAYNET_BROWSER_USE_DESKTOP_HTTP=1` | Shorthand: use `FABRIC_PLAYNET_DESKTOP_HTTP` (or the default above) as the browser/status base. |
| `FABRIC_PLAYNET_DESKTOP_STAR=1` | **Local desktop “star” in one flag:** applies loopback defaults from `settings/local.js` for any unset `FABRIC_PLAYNET_DESKTOP_*` — Fabric `127.0.0.1:<FABRIC_PORT>` (default 7777), HTTP `http://127.0.0.1:<PORT>` (default 8080), Bitcoin Core P2P `127.0.0.1:<bitcoin.port>` or **8333** when `bitcoin.port` is unset (matches `@fabric/core` managed bitcoind `-port`). Also sends Puppeteer / `GetBitcoinStatus` at that HTTP URL. Host override: `FABRIC_PLAYNET_DESKTOP_STAR_HOST`. npm: `npm run test:playnet-mesh-l1-desktop-star` (start the **desktop Hub** first). |

**Bitcoin P2P listen:** Managed regtest defaults to `-listen=0`. For playnet hub 0’s `addnode` to reach this machine, enable **`bitcoin.listen: true`** (or equivalent) on the desktop Hub so Core accepts inbound P2P on the port above.

**Reciprocal Fabric peer:** On the desktop UI (Peers) or via JSON-RPC `AddPeer`, connect to the **playnet hub 0** Fabric port printed in the test output (`[PLAYNET:MCP] … 127.0.0.1:<ephemeral>`).

**IDE browser (MCP):** After a run with desktop env set, the test prints `[PLAYNET:MCP]` lines with deep links to `/services/bitcoin`, `#bitcoin-explorer`, and a sample transaction from the run—use those URLs in Cursor’s browser tools to walk blocks and txs on the **desktop** shell.

## Prerequisites
- Node **22.x** (see `package.json` `engines`)
- **Build the browser bundle first** — installers expect `assets/` populated (`npm run build` / `build:browser`)

## Browser login via desktop (`fabric:` protocol)
The **only** supported custom scheme for this flow is **`fabric:`** (e.g. `fabric://login?sessionId=...&hub=...`). Fabric Hub **re-registers** as the default `fabric:` handler on every app launch and on **macOS activate** (dock icon), so running this app overrides handlers left by other installers or dev builds. Packaged installs also declare `fabric` via **electron-builder** (`package.json` → `build.protocols`). If the wrong app still opens, quit it, start **Fabric Hub** once, then try **Log in with Fabric Hub (desktop)** again.

To use the **same Fabric identity as this Hub node** in a normal browser (e.g. Chrome on `http://127.0.0.1:8080`):

1. Run the **Fabric Hub desktop** app so the Hub is listening on loopback.
2. In the browser, open **Identity** → **Log in with Fabric Hub (desktop)**.
3. The UI creates a short-lived session and triggers **`fabric://login?sessionId=...&hub=...`** (your current origin is the `hub` query parameter for the desktop app to call back).
4. The OS opens the desktop app (if registered as the `fabric` protocol handler). The shell **POST**s to `{hub}/sessions/:sessionId/signatures` after you approve; the Hub accepts **loopback** TCP **or** a caller whose **Origin** / **Referer** matches the pending session’s browser **origin** (so a LAN hub URL still works when the UI was opened at that origin). The Hub records the **signature** for that login session.
5. The browser **polls** `GET /sessions/:sessionId` until the session is `signed`, then stores an **xpub-only** identity in `localStorage` and records the link under **`fabric.linkedDevices`**.

**REST surface:** `POST /sessions` (create session, body `{ origin }` — off loopback, the same **Origin** / **Referer** / **Sec-Fetch-Site**+**Host** rules must match that `origin`), `GET /sessions/:sessionId` (poll; while **pending**, response includes **`message`**, **`origin`**, **`nonce`**, and **`acceptsClientSignature: true`**), `POST /sessions/:sessionId/signatures` completes the session in one of two modes:

1. **Client-signed player login** (Passport, any Fabric wallet) — body `{ signature, pubkeyHex, identity: { id, xpub } }` where `signature` is BIP340 Schnorr over the **server-stored** challenge. Crypto verification is the authenticator; the Hub does **not** use its root key.
2. **Hub self-sign** (legacy “link browser to this Hub node”) — empty / non-client body; Hub signs with its root key. Requires **loopback** TCP **or** **Origin** / **Referer** / same-site **Host** matching the pending session origin.

**`localhost`** and **`127.0.0.1`** with the same port are treated as the same origin for those checks so a browser tab on `http://localhost:…` can pair with Electron on `http://127.0.0.1:…`. The first **`signed`** poll response **retires** the ephemeral desktop `sessionId` (a second GET returns **404**; the browser keeps **`delegationToken`**). For clients that are not **loopback**, polling requires **Origin**, **Referer**, or same-site **Sec-Fetch-Site** + **Host** to match the registered `origin`. The **Electron** main process **GET**s the session and delivers the payload to the renderer (**IPC** + optional pull); **`DelegationSigningModal`** (Hub) or an application **`FabricLoginModal`** shows an **in-app** confirmation modal (origin + message to sign), then **POST**s signatures only if the user approves. Same **`/sessions`** collection shape as downstream apps inheriting Hub; completion uses a **signatures** subresource instead of a `sign` verb.

**Hex `Message` links:** canonical **`fabric:<hex>`** (opaque, no `//`); legacy **`fabric://message?hex=…`** and **`fabric://login?…&messageHex=…`**. Parsed in **`functions/fabricProtocolUrl.js`**; envelope JSON **`docs/FABRIC_MESSAGE_ENVELOPE.md`**.

### Mutual device-link (`fabric://link`)
Separate seeds per app (Passport / Hub browser / downstream applications). Hub Identity → **Create link offer** → `POST /device-links` → `fabric://link?sessionId&hub`. Responder approves (application protocol handler or Passport **Approve with Passport** / `FABRIC_DEVICE_LINK_REQUEST`), then the initiator countersigns. Challenge: `fabric:device-link:1:<nonce>:<initiatorId>:<responderId>:<label>`. Routes: `POST|GET /device-links`, `POST /device-links/:id/signatures`. See `functions/fabricDeviceLink.js`.

**Verification:** the poll response includes `message`, `signature`, and `pubkeyHex`. You can paste those into **Identity → Verify signature** in the UI to confirm the Hub key signed the challenge.

This path is for **demonstration** on localhost; production should use HTTPS on the hub, sane **CORS** defaults, and (for remote hubs) the same **origin** discipline the server already applies off loopback.

## BIP21 `bitcoin:` (payments)
The desktop app registers the **`bitcoin:`** scheme (alongside **`fabric:`**) on launch and on macOS **activate**, and declares it in **electron-builder** (`package.json` → `build.protocols`). Opening a **`bitcoin:`** link (OS default handler, second instance, or **`open` on macOS**) loads **Bitcoin Payments → Make Payment** with fields prefilled:

- **Plain URI** (`bitcoin:<address>?amount=…`) → query params `payTo` + `payAmountSats`.
- **Payjoin** (`…&pj=<https endpoint>`) → query param **`bitcoinUri`** (full URI) so the UI can parse `pj=` and use the Payjoin path.

Another wallet may already own **`bitcoin:`** on your system; set **Fabric Hub** as the default handler in OS settings if you want these links to open here.

### Delegation & external signing
**Browser activity stream:** delegation signing requests appear in the **Notifications** / **Activity** streams, tagged **`#delegation`**. Approve/reject in the **desktop** shell uses **`DelegationSigningModal`** (in-app modal), not a native OS dialog.

After a successful desktop link, the browser receives a **`delegationToken`** (`fabric.delegation` in `localStorage`) and shows **External signing enabled** on **Identity** / **`/settings/security`**. Signing intents use **`DELEGATION_SIGNATURE_REQUEST`** / **`DELEGATION_SIGNATURE_RESOLUTION`**; RPC **`PostDelegationSignatureMessage`**, **`GetDelegationSignatureMessage`**, **`ResolveDelegationSignatureMessage`** on **`POST /services/rpc`**. **`GET /sessions/:sessionId/delegation/audit`**, **`GET|DELETE /sessions/:sessionId`**, loopback **`GET /sessions`**. **SPA:** **`/settings/security`** (list), **`/sessions/:id`** (per-token UI); **`/sessions`**, **`/security`** → **`/settings/security`**. Toasts: **`functions/toast.js`**, **react-toastify**.

## Commands
```bash
# Iterative UI + Hub in Electron (dev)
npm run desktop

# Same as desktop, but attach Chrome DevTools to the **Electron main** process (Node inspector on port 9229)
# In Chrome: open chrome://inspect → “Open dedicated DevTools for Node” → configure 127.0.0.1:9229 if needed
npm run desktop:debug

# Scripts use `env -u ELECTRON_RUN_AS_NODE` so the **shell** Electron binary is real Electron (not Node-as-Electron).
# If your environment sets ELECTRON_RUN_AS_NODE for other tools, the desktop entry still clears it for the main process only;
# the embedded `scripts/hub.js` child continues to set it as before.

# Produce platform installers (current OS / arch)
npm run build:desktop

# Prefetch bitcoind/lightningd for every OS, then mac + Windows + Linux installers
npm run build:installers

# Public `/downloads` FileBrowser reads `assets/downloads/index.json` (written by the
# browser build; installer files are copied here after electron-builder).

# Unpacked app only (faster sanity check; output under dist/)
npm run build:desktop:dir
```

### Targets (electron-builder)

- **macOS:** `.dmg` and `.zip` (see `package.json` → `build.mac.target`)
- **Windows:** NSIS installer (`build.win.target`)
- **Linux:** AppImage and `.deb` (`build.linux.target`). Root `desktopName` (`pub.fabric.hub`) plus `linux.syncDesktopName` keep `WM_CLASS` aligned with the installed `.desktop` file.

Code signing / notarization for macOS and Windows Authenticode are **not** configured here; add certificates and `electron-builder` env in CI as needed.

## Tray & run at startup

The desktop app is meant as an **easy node**: Bitcoin Core, Fabric peer, and Lightning stay running from the tray. Closing the window **hides** to the tray (does not stop Hub). **Quit Fabric Hub** on the tray (or the OS app-quit command) stops the node.

Packaged installers copy `scripts/startup/` to **`resources/startup/`** beside `app.asar`. Those scripts start the app with `--hidden`. The tray checkbox is the supported control:

| Control | How |
|---------|-----|
| Tray → **Run at startup** | Toggle OS login item (macOS / Windows) and Linux `~/.config/autostart/pub.fabric.hub.desktop` |
| `FABRIC_OPEN_AT_LOGIN=0` / `=1` | Force off / on (wins over the tray persist file) |
| `settings/local.js` → `openAtLogin` | Optional boolean if you add it; tray persist still wins after first launch |
| userData `desktop-shell.json` | Remembers the tray choice (`openAtLogin`) |

Installed builds default **on** so a first-run user gets a node that comes back after reboot. `npm run desktop` (unpackaged) defaults **off** so developers do not register the Electron binary as a login item.

Login launches use `--hidden` (and macOS `openAsHidden`): Hub still starts Bitcoin / Fabric / Lightning; the window stays in the tray until **Show Fabric Hub**.

Manual wiring (same `--hidden` flag):

- **macOS:** `resources/startup/macos/FabricHub.command` or copy `com.pub.fabric.hub.plist` to `~/Library/LaunchAgents/`
- **Windows:** `resources/startup/windows/FabricHub-startup.cmd` (or `.vbs` for no console) in the Startup folder / Task Scheduler
- **Linux:** `resources/startup/linux/fabrichub-startup.sh` or the sample `.desktop` under `~/.config/autostart/`


## Icons
The suite mark is a serif lowercase **f** (Arvo) in white on royal purple `#4C1D95`. Canonical generator: `@fabric/http` `npm run make:icons` (copies into this `build/` and `assets/`).

electron-builder reads:

- `build/icon.icns` (macOS)
- `build/icon.ico` (Windows)
- `build/icon.png` (Linux; 512×512 or larger)

Browser favicons are `assets/favicon.svg`, `assets/favicon.ico`, and `assets/apple-touch-icon.png`.

Semantic UI font/icon fixes for the **browser extension** are tracked separately (e.g. `fabric-browser-extension`); the desktop shell loads the same bundled `assets/` as the site.

## Desktop build notes
`package.json` → `build.files` is an explicit allowlist (not the whole repo). It must include every Node boot path: `scripts/desktop.js` / `scripts/hub.js`, `settings/`, **`contracts/`** (`settings/local.js` loads Beacon / Liquid catalog entries), root **`constants.js`**, plus `services/`, `functions/`, `types/`, `routes/`, and `assets/`. `tests/electronPackFiles.test.js` walks those requires. After changing that list, rebuild (`npm run build:desktop`) and replace the installed app — an old asar will still crash.

`@fabric/http` no longer depends on the npm **`peer`** package (legacy Express PeerJS signaling server). WebRTC uses **native `RTCPeerConnection`** in the Bridge and Hub WebSocket / JSON-RPC signaling (`RegisterWebRTCPeer`, etc.).
