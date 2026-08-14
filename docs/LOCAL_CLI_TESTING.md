# Fast local testing — Hub + Fabric CLI

## Hub (this repo)

```bash
cd hub.fabric.pub
npm install
npm run start:fast    # skips webpack; use when you only changed server code
# Full rebuild + hub:
npm start
```

Useful env vars (see `settings/local.js`): `FABRIC_HUB_PORT`, `FABRIC_PORT`, `FABRIC_MNEMONIC`, `FABRIC_EXPLORER_URL=http://127.0.0.1:8080` (origin of this Hub for core helpers).

**Mempool / confirmation UX:** open **Bitcoin** from the nav or **TopPanel** “Mempool N” when the node reports a non-empty queue; **Payments** and **Invoices** link to transaction detail routes for unconfirmed sends.

## Fabric `@fabric/core` CLI (sibling repo)

From the **`fabric/`** tree:

```bash
npm install
npm run chat           # default P2P chat TUI (same as: node scripts/cli.js chat)
npm run exchange       # local exchange node
npm run fabric:start   # bootstrap peer (scripts/cli.js start)
```

Common global options (see `scripts/cli.js`):

- `--port <n>` — P2P port (default `7777`); use a different port for a second peer on the same machine.
- `--seed "<24 words>"` — deterministic identity.
- `--receive` — print a receive address and exit.

Install globally from a dev checkout: `npm link` in `fabric/`, then `fabric --help`.

**C / TUI binary:** if you use the native Fabric CLI, see **`fabric/CLI_README.md`** in a sibling checkout for build and runtime notes (orthogonal to the Node `scripts/cli.js`).

## Suggested two-peer smoke

1. Terminal A: `cd hub.fabric.pub && npm run start:fast`
2. Terminal B: `cd fabric && npm run chat -- --port 7778` (or `exchange` / `fabric:start` depending on scenario)
3. In the Hub UI, **Peers → Add peer** to the address shown by the Fabric CLI.

For paid flows on regtest, fund via Hub **Bitcoin** page, send payment, watch **mempool** state, then **Generate block** (admin token) to clear confirmations.

**Two regtest `bitcoind` peers (LAN):** connect Core P2P with `npm run bitcoin:addnode -- <host>:18444 add` (see [BITCOIN_NETWORKS.md](../BITCOIN_NETWORKS.md)); the UI always reads this Hub’s `/services/bitcoin`.
