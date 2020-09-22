# hub.fabric.pub
Runs a simple Fabric peer with listening enabled by default.

## Quick Start
1. `npm install`
2. `npm start`

## Configuration
Use environment variable `FABRIC_SEED` to provide a 24-word mnemonic for
persistent identity and fund recovery:

```
FABRIC_SEED="your mnemonic here" yarn start
```

You can also alter which port the node will listen for P2P connections on
using the `FABRIC_PORT` environment variable:

```
FABRIC_PORT=1337 yarn start
```