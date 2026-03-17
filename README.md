# hub.fabric.pub
Runs a simple Fabric peer with listening enabled by default.

## Quick Start
1. `npm install`
2. `npm start`

On first run, `npm start` builds the browser bundle (may take a minute), then
starts the Hub. For faster restarts during development (when assets are already
built), use `npm run start:fast`. Open http://localhost:8080 in your browser.
You will see a
**First-Time Setup** modal—configure your node name and Bitcoin/Lightning
options, then click **Complete Setup**. An admin token is created and stored in
your browser; you can then use the Hub UI.

## First-Time Setup
When you first open the Hub UI (no `stores/hub/settings.json` with
`IS_CONFIGURED`), a setup modal appears. You can:
- Set a **node name** (e.g. "Hub", "My Node")
- Choose **Bitcoin network** (Regtest for local dev, Signet/Testnet/Mainnet for real networks)
- Enable **managed Bitcoin** to run bitcoind automatically (recommended for regtest)
- Enable **managed Lightning** to run lightningd (optional; regtest only)

After setup, the admin token authenticates privileged operations (e.g. Generate Block).
It is stored in your browser only and never on the server.

## Explanation
`hub.fabric.pub` provides a simple script for running a Fabric node, with an
attached "Edge Node" served to the legacy web (on port `8080` by default). Run
the script directly:
```
node scripts/hub.js
```

## Configuration
You can modify `settings/local.js` to configure your instance; just restart the
script to load the new configuration. Make sure to wait patiently for any
existing process to close cleanly!

### Environment Variables
| Variable | Purpose |
|----------|---------|
| `FABRIC_SEED` / `FABRIC_MNEMONIC` | 24-word mnemonic for persistent identity and fund recovery |
| `FABRIC_PORT` | P2P listen port (default `7777`) |
| `FABRIC_HUB_PORT` / `PORT` | HTTP/Edge Node port (default `8080`) |

Example:
```
FABRIC_SEED="your mnemonic here" npm start
FABRIC_PORT=1337 FABRIC_HUB_PORT=9090 npm start
```

## Acknowledgements
`hub.fabric.pub` relies heavily on several supporting libraries, including
Babel, JSDoc and the very wonderful Semantic UI, and many other contributors to
the Node.js ecosystem (especially @indutnry, @chjj, and @chrisinajar).
