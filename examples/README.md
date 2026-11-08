# @fabric/hub examples

Offline tutorials for Hub-owned helpers. They use an in-memory key and do not start the Hub, Bitcoin, or a listening port.

```bash
npm run example:tutorials
```

| Script | What it shows |
|--------|----------------|
| [operator-keys.js](operator-keys.js) | Identity and cosigner from the master |
| [signer-rules.js](signer-rules.js) | Sign, decline, fail closed, withdrawal cap |
| [federation-vault.js](federation-vault.js) | `nums` and `musig2` addresses |
| [document-markup.js](document-markup.js) | List price from a cost |
| [wire-catalog.js](wire-catalog.js) | Catalog opcodes against core |

The stack map lives in the `@fabric/core` checkout at `examples/TUTORIALS.md`. On this machine that checkout is the sibling `fabric-clean` repository.
