# Fabric Hub — desktop (Electron)
The desktop shell runs the same Hub **Node** process as `npm start` and opens a **BrowserWindow** to `http://127.0.0.1:<port>/` (default port from `settings/local.js`, usually `8080`).

## Layout
| Path | Role |
|------|------|
| `scripts/desktop.js` | Electron main: tray, app menu, **Run at startup**, runs Hub as an Electron **`utilityProcess`** (restarts it after a crash), sets `FABRIC_HUB_APP_ROOT` / `FABRIC_HUB_USER_DATA`, waits for HTTP behind a loading window, loads the UI |
| `scripts/startup/` | OS launchers packed as `resources/startup/` (macOS command + LaunchAgent, Windows cmd/vbs, Linux sh + XDG desktop) |
| `functions/desktopOpenAtLogin.js` | Login-item payload, XDG autostart, `desktop-shell.json` |
| `functions/desktopShellPolicy.js` | Navigation / external-link / IPC-sender / permission / Payjoin-target rules |
| `functions/desktopShellStatus.js` | Tray status lines, window-bounds restore |
| `functions/fabricSignApprovalDialog.js` | Native dialog for Passport sign and link requests (Decline by default, lists exactly what is shared) |
| `functions/desktopSecureStore.js` | `safeStorage`-encrypted `secure-store.json` for the admin token |
| `functions/desktopLogFile.js` | Rotating, secret-scrubbed `logs/fabric-hub.log` |
| `scripts/desktop-preload.js` | Exposes `window.fabricDesktop` (`isDesktopShell`, platform, versions, `onMessagePrompt`, `pullPendingMessagePrompt`, `getPaths`, `payjoinPost`, `secureStore`) |
| `scripts/desktopHubProbe.js` | Startup HTTP/P2P probes (whether to use an existing loopback Hub) |
| `components/FabricMessagePrompt.js` | In-app viewer for opaque `fabric:` frames (author or "Not signed"); it signs nothing |
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

## Signing in (Passport v2)
The Hub signs browsers in with Passport v2 (spec: `@fabric/core` `docs/PASSPORT.md`), mounted by `functions/hubPassport.js`:

| Route | What it does |
|---|---|
| `POST /sessions/challenges` | A `PASSPORT_CHALLENGE` for this Hub's pinned origin, plus the HttpOnly `fabric.passport` binding cookie |
| `POST /sessions { assertion }` | Redeems once with that cookie and sets the HttpOnly `fabric.session` cookie |
| `GET` / `DELETE /sessions/current` | Reads / ends the session |
| `POST /sessions/self` | **Desktop shell only.** Signs this window in as the Hub's own identity (**Identity → Sign in as this Hub**). Direct loopback socket, no proxy headers, `Origin` equal to the Hub's own loopback origin. |

Origins are pinned: loopback on the Hub port (`127.0.0.1`, `localhost`, `[::1]`), `FABRIC_HUB_PUBLIC_ORIGIN`, `payjoin.publicOrigin`, and each `FABRIC_HUB_ALLOWED_HOSTS` name on the Hub port. The `Host` header never adds one. The page never stores a token.

There is no `fabric://login` link and no QR login: the desktop app can't tell which page launched a link, so a phishing page could have used one to get a login for another site. The Hub never signs for another site's session and never gives a browser access to its own key.

### The desktop Hub as a Passport signer
Passport can ask this Hub to answer a sign-in with the Hub's identity instead of a key held in the extension. The Hub must first be paired with that Passport:

1. In Passport, add the desktop Hub as a device. Passport makes a device-link offer on the Hub's loopback `/device-links`.
2. The Hub shows a native dialog with a six-digit code; Passport shows the same code. Approve only if they match.
3. From then on, a sign-in in the browser can be answered by the Hub: Passport sends a `PASSPORT_SIGN_REQUEST`, the Hub shows a native dialog naming the site, the account, and exactly what is shared, and on approval returns a `PASSPORT_ASSERTION` signed by its identity key (account 0 on the challenge's network, `signer: 'hub'`).

Routes (`functions/fabricLocalSignerHub.js` on `@fabric/http` `fabricLocalSigner`): `GET /services/fabric/identity`, `POST /services/fabric/sign`, `POST /services/fabric/link { sessionId }`. They answer only a direct loopback socket naming a loopback `Host` whose `Origin` is Passport: a Chrome build listed in `FABRIC_PASSPORT_EXTENSION_IDS` / `settings.passport.extensionIds`, or any Firefox build (`moz-extension://`). Sign requests must come from a device in the Hub's identity cluster; each nonce works once; requests from before the Hub started are refused. Link and sign prompts are separate, link prompts come at most every 30 seconds, and a dialog closes when its request expires. A CLI Hub has no dialog and serves none of these routes.

### `fabric:` links
The Hub registers the **`fabric:`** scheme on every launch and on **macOS activate**, and declares it via **electron-builder** (`package.json` → `build.protocols`). It opens:

- **`fabric:<frame>`** (opaque, no `//`) and legacy **`fabric://message?hex=…`** — shown read-only in **`FabricMessagePrompt`** with the author or "Not signed". Nothing is signed from it. Parsed in **`functions/fabricProtocolUrl.js`**; envelope JSON **`docs/FABRIC_MESSAGE_ENVELOPE.md`**.
- **`fabric://link?…`** — handed to the Identity device-link UI.

### Mutual device-link
Separate seeds per app (Passport / Hub browser / downstream applications). Hub Identity → **Create link offer** → `POST /device-links`. The responder approves (Passport **Approve with Passport**, or the app that owns the offer), then the initiator countersigns. Strings are `fabric:device-link:3:offer:…` and `fabric:device-link:3:link:…`, naming the session, nonce, ids, label, and origin. Routes: `POST|GET /device-links`, `POST /device-links/:id/signatures`. See `functions/fabricDeviceLink.js`.

## BIP21 `bitcoin:` (payments)
The desktop app registers the **`bitcoin:`** scheme (alongside **`fabric:`**) on launch and on macOS **activate**, and declares it in **electron-builder** (`package.json` → `build.protocols`). Opening a **`bitcoin:`** link (OS default handler, second instance, or **`open` on macOS**) loads **Bitcoin Payments → Make Payment** with fields prefilled:

- **Plain URI** (`bitcoin:<address>?amount=…`) → query params `payTo` + `payAmountSats`.
- **Payjoin** (`…&pj=<https endpoint>`) → query param **`bitcoinUri`** (full URI) so the UI can parse `pj=` and use the Payjoin path.

Another wallet may already own **`bitcoin:`** on your system; set **Fabric Hub** as the default handler in OS settings if you want these links to open here.

## Commands
```bash
# Iterative UI + Hub in Electron (dev)
npm run desktop

# Same as desktop, but attach Chrome DevTools to the **Electron main** process (Node inspector on port 9229)
# In Chrome: open chrome://inspect → “Open dedicated DevTools for Node” → configure 127.0.0.1:9229 if needed
npm run desktop:debug

# Scripts use `env -u ELECTRON_RUN_AS_NODE` so the **shell** Electron binary is real Electron (not Node-as-Electron).
# The embedded `scripts/hub.js` runs as an Electron utilityProcess, so it never needs ELECTRON_RUN_AS_NODE
# (packaged builds turn the RunAsNode fuse off).

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
| userData `desktop-shell.json` | Remembers the tray choices (`openAtLogin`, `preventSleep`) and the window position (`windowBounds`, `windowMaximized`) |

Installed builds default **on** so a first-run user gets a node that comes back after reboot. `npm run desktop` (unpackaged) defaults **off** so developers do not register the Electron binary as a login item.

Login launches use `--hidden` (macOS reports them through `wasOpenedAtLogin`): Hub still starts Bitcoin / Fabric / Lightning; the window stays in the tray until **Show Fabric Hub**.

Manual wiring (same `--hidden` flag):

- **macOS:** `resources/startup/macos/FabricHub.command` or copy `com.pub.fabric.hub.plist` to `~/Library/LaunchAgents/`
- **Windows:** `resources/startup/windows/FabricHub-startup.cmd` (or `.vbs` for no console) in the Startup folder / Task Scheduler
- **Linux:** `resources/startup/linux/fabrichub-startup.sh` or the sample `.desktop` under `~/.config/autostart/`

### Tray status, notifications, menu
- The tray lists the Hub state (starting / running / restarting / stopped, or "using the Hub already running"), then — polled every 30 s from loopback `GET /services/peering`, `/services/bitcoin`, and `/services/lightning` — Fabric peer count, Bitcoin height or sync %, and Lightning state.
- When the window is hidden or not focused, a Passport sign or link request or a `fabric:` message raises a native notification; clicking it brings the window up. Nothing is signed from the notification: Passport requests are answered only in their native dialog.
- Tray / **File** menu: **Restart Hub**, **Reveal Hub data folder**, **Reveal logs**. Tray **Keep computer awake** (`powerSaveBlocker` `prevent-app-suspension`, off by default; `FABRIC_DESKTOP_PREVENT_SLEEP=1|0` forces it).
- The app menu has no **Reload** / **DevTools** in packaged builds (DevTools are disabled outright) unless `FABRIC_DESKTOP_DEVTOOLS=1`; `npm run desktop` keeps them.
- Window size, position, and maximized state come back on the next launch (only onto a display that still exists).

### Crashes and logs
If the Hub process exits on its own, the shell restarts it with backoff (1 s, 2 s, 4 s … up to 30 s). After more than five exits in five minutes it stops and asks: **Restart**, **Show log**, or **Quit**. On quit it asks the Hub to shut down (Bitcoin / Lightning / LevelDB close cleanly) and kills it only after 30 s.

Main-process output and the Hub's stdout / stderr go to **`<userData>/logs/fabric-hub.log`** (5 MiB, three rotations), with xprv-family keys, Bearer tokens, token query parameters, JSON secret fields, and `FABRIC_*` secret env assignments scrubbed. If startup fails, the error dialog offers the log.

## Security & privacy
| Area | Behavior |
|------|----------|
| Renderer | `sandbox`, `contextIsolation`, no `nodeIntegration`, `webSecurity`; no `<webview>` |
| Navigation | The window only shows the Hub origin (`127.0.0.1` / `localhost` on the Hub port). Other http(s) / `mailto:` links open in the OS browser; other schemes are dropped. |
| IPC | Every `fabricDesktop` call is answered only for the Hub UI in the top-level frame |
| Payjoin | `payjoinPost` goes to the Hub origin or a public **https** host (no credentials in the URL, no private / loopback addresses even after DNS), 30 s timeout, 1 MiB caps. `FABRIC_DESKTOP_PAYJOIN_ALLOW_PRIVATE=1` allows LAN receivers. |
| Permissions | Denied by default; the Hub origin may use clipboard write, fullscreen, and notifications. No device (USB / HID / serial) access. |
| Spellcheck | Linux would download Hunspell dictionaries from Google, so it is off there unless `FABRIC_DESKTOP_SPELLCHECK=1` |
| Admin token | Stored with Electron **`safeStorage`** (macOS Keychain, Windows DPAPI, Linux libsecret / kwallet) in `<userData>/secure-store.json` (mode 0600) and held in renderer memory; an existing `localStorage` copy is moved there on first launch. Linux without a keyring (`basic_text`) keeps browser storage. |
| Packaged fuses | `build.electronFuses`: RunAsNode, `NODE_OPTIONS`, and `--inspect` off; cookie encryption, embedded asar integrity, and load-only-from-asar on |
| Hub HTTP | Loopback trust needs a loopback socket **and** a rebind-safe `Host` (IP literal, `localhost`, or `FABRIC_HUB_ALLOWED_HOSTS` / the configured hostname) **and** no proxy forward headers; other Hosts on a loopback socket get **421**. Responses carry a Content-Security-Policy (`FABRIC_HUB_CSP=0` turns it off). |


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
