# hub.fabric.pub
Runs a simple Fabric peer with listening enabled by default.

## Quick Start
1. `npm install`
2. `npm start`

## Explanation
`hub.fabric.pub` provides a simple script for running a Fabric node, with an attached "Edge Node" served to the legacy web (on port `8080` by default).  Run the script directly:
```
node scripts/hub.js
```

## Configuration
You can modify `settings/local.js` to configure your instance; just restart the script to load the new configuration.  Make sure to wait patiently for any existing process to close cleanly!

### Environment Variables
Use environment variable `FABRIC_SEED` to provide a 24-word mnemonic for
persistent identity and fund recovery:
```
FABRIC_SEED="your mnemonic here" npm start
```

You can also alter which port the node will listen for P2P connections on using
the `FABRIC_PORT` environment variable:
```
FABRIC_PORT=1337 npm start
```

## Acknowledgements
`hub.fabric.pub` relies heavily on several supporting libraries, including Babel, JSDoc and the very wonderful Semantic UI, and many other contributors to the Node.js ecosystem (especially @indutnry, @chjj, and @chrisinajar).
