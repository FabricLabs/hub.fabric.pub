# Fabric Hub · hub.fabric.pub

**Self-hostable Fabric edge node** with a web operator console: P2P peer discovery, WebSocket JSON-RPC bridge for browsers, documents, optional **WebRTC** mesh, **Bitcoin** (L1 verify, regtest tooling, optional **Payjoin**), and **priced documents** with **P2TR inventory HTLC** flows tied to a canonical Fabric **`DocumentPublish`** envelope.

If you are a **software engineer** who wants to **fork or clone** and run the Hub on your machine, this page is the entry point. Deeper behavior, RPC tables, and operational notes live in **[AGENTS.md](AGENTS.md)**.

| Topic | Doc |
|--------|-----|
| Protocol & payments | [PAYMENTS_PROTOCOL.md](PAYMENTS_PROTOCOL.md) · [INVENTORY_HTLC_ONCHAIN.md](INVENTORY_HTLC_ONCHAIN.md) |
| Production deploy | [docs/PRODUCTION.md](docs/PRODUCTION.md) |
| Marketing overview | [docs/MARKETING_OVERVIEW.md](docs/MARKETING_OVERVIEW.md) |
| Release / checklist | [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) · [CHANGELOG.md](CHANGELOG.md) |

**Status:** `0.1.0-RC1` — run `npm run ci` before release tags.

---

## Run it locally (fork → clone → install → start)

You need **Node.js** with **npm** (npm ships with Node and is the usual “global” tool on your PATH). This repository does **not** publish a `bin` entry today: install dependencies **inside the cloned project**, then start the Hub from there—not `npm install -g` of this package.

### 1. Prerequisites

- **Node** matching **`engines`** in [package.json](package.json) (use **nvm**, **fnm**, **Volta**, or similar so your shell picks the right major version).
- **Git** and network access to **GitHub** — dependencies such as `@fabric/core` and `@fabric/http` are installed from **git URLs** pinned in `package.json`, not only from the public npm registry.
- Enough disk for `node_modules` and optional Bitcoin regtest data under `stores/`.

### 2. Clone and install

```bash
git clone https://github.com/FabricLabs/hub.fabric.pub.git
cd hub.fabric.pub
npm install
```

If you work against local Fabric trees, see **`npm run link:fabric`** in [AGENTS.md](AGENTS.md).

### 3. Start the Hub

```bash
npm start
```

This **builds the browser bundle** then runs **`node scripts/hub.js`**. Open **http://127.0.0.1:8080** (or **http://localhost:8080**) unless you changed **`FABRIC_HUB_PORT`** / **`PORT`**.

For quick iteration when assets are already built:

```bash
npm run start:fast
```

**First-time setup:** The UI onboarding flow sets the node name and related options. An **admin token** is issued to the **browser only** (not stored server-side) and gates privileged actions (e.g. **Generate Block** on regtest).

### 4. Sanity checks (optional)

```bash
npm run ci          # build + unit tests (good pre-push gate)
npm test            # includes browser-oriented tests; may need Chrome for some suites
npm run test:unit   # faster: skips selected suites
```

---

## Configuration

Defaults and merge behavior are in **`settings/`** (see **`settings/local.js`**). Prefer **environment variables** for secrets, ports, and host bindings (summary in [AGENTS.md](AGENTS.md); many are listed there under Configuration).

Examples:

```bash
FABRIC_SEED="your twenty-four word mnemonic …" npm start
FABRIC_PORT=7777 FABRIC_HUB_PORT=9090 npm start
```

---

## What you get (high level)

| Area | Capabilities |
|------|----------------|
| **P2P** | Fabric peer, peer list, chat/files, gossip, optional beacon / sidechain hooks (see AGENTS.md) |
| **Browser** | React UI, Bridge WebSocket client, optional WebRTC mesh coordination |
| **Documents** | Create, publish, distribute (storage contracts), purchase / claim flows |
| **Inventory HTLC** | Priced listings, P2TR hints, Hub RPC for confirmation & delivery phases |
| **Bitcoin** | RPC integration, L1 payment proof, mempool UX, optional managed regtest |
| **Payjoin** | BIP77-oriented sessions when enabled (details in AGENTS.md) |

---

## Acknowledgements

hub.fabric.pub builds on **Babel**, **JSDoc**, **Semantic UI**, and the Node.js ecosystem (with thanks to @indutny, @chjj, @chrisinajar and many others).
