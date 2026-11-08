# Agent user pass (Hub `npm run dev`)
Resume notes for a **later agent** playing Hub as a **browser user** (not Hub operator/admin).

**Last updated:** 2026-08-20
**Origin:** webpack-dev-server `http://127.0.0.1:3000` (`npm run dev`) proxied to Hub HTTP `http://127.0.0.1:8080` (`npm run start:fast`).

## Identity (persistent)

Do **not** commit seeds. Machine-local files:

- [`local/cursor-agent-fabric-identity.json`](../local/cursor-agent-fabric-identity.json) (gitignored) — mnemonic + xpub/xprv
- [`assets/config.local.js`](../assets/config.local.js) (gitignored) — `window.FABRIC_DEV_BROWSER_SEED` + `FABRIC_DEV_BROWSER_IDENTITY = 'force'` so the SPA restores this wallet on load. Hub serves it only to this machine; open the UI at `http://127.0.0.1:<port>` or `http://localhost:<port>` (a LAN address or a proxy gets a stub without the seed)

This is a **player** hot wallet, not `FABRIC_XPRV` / Hub `_rootKey`. After first-time setup, **do not** use the admin Bearer for operator RPC (Generate Block, Accept contracts, Self-destruct). Clear `localStorage` admin token if onboarding wrote one, or ignore Admin chrome.

## Goals (user, not NODE_GOALS)

1. **Make a profit** — list or sell a Document, use Payments / invoices / document market, watch wallet sats.
2. **Stay identified** — keep the same Fabric id across reloads (dev seed + localStorage `fabric.identity.local`).
3. **Use the mesh as a client** — Identity, Wallet, Documents, Downloads, Chat/Peers as available without admin.

## How to start

```bash
cd ~/hub.fabric.pub
npm run start:fast    # Hub on :8080 (needed; webpack proxies /settings /services)
npm run dev           # SPA on :3000
```

Stores were wiped 2026-08-20 (`npm run reset:stores`). First load may show **first-time setup** because `/settings` is proxied (webpack cannot pretend to be HTML-only CDN). Completing setup configures the **node**; then continue as the player identity.

## Findings (this pass)

_Fill in as you browse. Newest first._

## Next actions

- [ ] Confirm identity chip matches `fabricId` in `local/cursor-agent-fabric-identity.json`
- [ ] Wallet receive / faucet (regtest) without admin token
- [ ] Create and price a document; attempt a purchase/sale path
- [ ] Note broken/incomplete UI; patch in this repo

## Constraints

- User, not admin: skip Admin, Beacon Accept, generateblock unless required to unblock a **user** profit path on empty regtest (then document why).
- Do not paste mnemonics or admin tokens into tracked markdown.
