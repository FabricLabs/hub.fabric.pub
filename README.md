# Fabric Hub · hub.fabric.pub

**Self-hostable Fabric edge node** with a web operator console: P2P peer discovery, WebSocket JSON-RPC bridge, documents, optional **WebRTC** mesh, **Bitcoin** (L1 verify, regtest tooling, optional **Payjoin**), and **priced documents** with **P2TR inventory HTLC** metadata bound to a canonical Fabric **`DocumentPublish`** envelope.

- **Protocol & payments:** [PAYMENTS_PROTOCOL.md](PAYMENTS_PROTOCOL.md) · [INVENTORY_HTLC_ONCHAIN.md](INVENTORY_HTLC_ONCHAIN.md)
- **Production deploy:** [docs/PRODUCTION.md](docs/PRODUCTION.md)
- **Marketing copy:** [docs/MARKETING_OVERVIEW.md](docs/MARKETING_OVERVIEW.md)  
- **Release / tag steps:** [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) · [CHANGELOG.md](CHANGELOG.md)  
- **Agent / dev details:** [AGENTS.md](AGENTS.md)

**Status:** `0.1.0-RC1` — run `npm run ci` before release tags.

---

## Quick Start

1. `npm install`
2. `npm start`

`npm start` builds the browser bundle then starts the Hub. For faster restarts when assets are already built, use `npm run start:fast`. Open **http://localhost:8080** (default).

**First-time setup:** A modal walks through node name and Bitcoin/Lightning options. An **admin token** is created and kept in the **browser only** (never stored on the server); it gates privileged actions such as **Generate Block** (regtest).

## Verify before you ship

```bash
npm run ci          # build + unit tests (recommended for CI)
npm test            # full test suite including browser test file
npm run test:unit   # unit tests only (faster)
```

## Run directly

```bash
node scripts/hub.js
```

## Configuration

Edit `settings/local.js` and restart. Prefer **environment variables** for secrets and ports.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `FABRIC_SEED` / `FABRIC_MNEMONIC` | 24-word mnemonic for persistent Hub identity |
| `FABRIC_PORT` | P2P listen port (default `7777`) |
| `FABRIC_HUB_PORT` / `PORT` | HTTP / WebSocket port (default `8080`) |
| `FABRIC_HUB_HOSTNAME` / `HOSTNAME` | HTTP hostname |
| `FABRIC_HUB_INTERFACE` / `INTERFACE` | Bind interface (default `0.0.0.0`) |

Example:

```bash
FABRIC_SEED="your twenty-four word mnemonic …" npm start
FABRIC_PORT=1337 FABRIC_HUB_PORT=9090 npm start
```

## Features (high level)

| Area | What you get |
|------|----------------|
| **P2P** | Fabric peer, peer list, chat/files, gossip |
| **Browser** | React UI, Bridge WebSocket client, optional WebRTC |
| **Documents** | Create, publish, distribute (storage contracts), purchase invoice / claim |
| **Inventory HTLC** | Priced listings, P2TR hints, `ConfirmInventoryHtlcPayment`, encrypted phase-2 delivery |
| **Bitcoin** | RPC integration, L1 proof via `GET /transactions/:txid?address=&amountSats=`, mempool/confirmation UX, optional managed regtest |
| **Payjoin** | BIP77-style flows when enabled ([AGENTS.md](AGENTS.md)) |

## Acknowledgements

hub.fabric.pub builds on **Babel**, **JSDoc**, **Semantic UI**, and the broader Node.js ecosystem (with thanks to @indutny, @chjj, @chrisinajar and many others).
