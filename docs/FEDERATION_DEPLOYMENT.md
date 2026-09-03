# Federation deployment ladder

Operator path for promoting the **local developer Hub** as the **first mainnet federation member**, using one identity from `fabric setup`, through regtest → peering → signet → mainnet.

See also [SIGNATURE_PROOF_MODEL.md](https://github.com/FabricLabs/fabric/blob/master/docs/SIGNATURE_PROOF_MODEL.md) (core) and [DISTRIBUTED_CONTRACT_EXECUTION.md](DISTRIBUTED_CONTRACT_EXECUTION.md).

## Identity bootstrap (all stages)

The suite identity is the **Fabric Environment** from `fabric setup`: password-sealed `~/.fabric/wallet.json`, optional idle auto-lock (`fabric setup --timeout`, `FABRIC_LOCK_TIMEOUT_MINUTES`), backup/restore. Hub and playnet scripts load the **same exclusive bag** (`@fabric/core/functions/fabricOperatorIdentity`):

1. **`FABRIC_XPRV`** — BIP32 `xprv`/`tprv` (signing). May also be an `xpub`/`tpub` or compressed pubkey hex for **watch-only / combined** identity (MuSig aggregate); signing then needs wallet or another private env var.
2. **`FABRIC_SEED`** — raw BIP32 seed hex
3. **`FABRIC_MNEMONIC`** — BIP39 phrase (default `fabric setup` generate)
4. **`~/.fabric/wallet.json`** — unlock with `FABRIC_PASSWORD`

Do not put a leftover mnemonic *and* an xprv in the same Key bag: `Key` is mnemonic-first, while env loaders are xprv-first. That mismatch is what made Hub `_rootKey` diverge from playnet deploy.

```bash
npm i -g @fabric/core
fabric setup          # TTY: sealed ~/.fabric/wallet.json (+ mnemonic backup)
export FABRIC_PASSWORD=…   # unlock wallet for Hub / playnet scripts
# Optional: stamp private env from the unlocked wallet
cd hub.fabric.pub && npm run operator-identity:print-env
```

- Hub `_rootKey` is the HD **master** from that bag. Peer `agent.key` is the protocol **derived** node (same seed, different pubkey). `--accept` mints admin tokens for both.
- First federation validator set: **1-of-1** with the operator compressed pubkey until co-validators join. Combined federation keys go in `FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS`, not as a second Hub mnemonic.
- Env:
  - `FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS=<operator_pubkey_hex>`
  - `FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD=1`

Strict signature-first gates apply **as soon as validators are set** — configure 1-of-1 on regtest to exercise production behavior before mainnet.

## Stage map

| Stage | Bitcoin | Fabric peering | Gate |
|-------|---------|----------------|------|
| **1 — Regtest solo** | Managed regtest (Hub RPC 20444) | Loopback / optional local Peer | Hub onboarding; native `fabric-beacon` Accept |
| **2 — Regtest + peering** | Regtest + playnet `addnode` | `hub.fabric.pub:7777`, `relay.goon.vc:7777`; regtest P2P `hub.fabric.pub:18444` | Signed sidechain patches + GoonCitizen RSI on mesh |
| **3 — Signet** | Signet bitcoind (RPC 38332) | Same Fabric seeds | `FABRIC_BEACON_RESET_NETWORK=1` once — rebind beacon/sidechain |
| **4 — Mainnet** | Local or remote mainnet Core | Public seeds | Same `FABRIC_XPRV`; federation witness on all writes |

```text
fabric setup → regtest solo → regtest + peering → signet → mainnet (first member)
                      ↑                              ↑
              1-of-1 federation              FABRIC_BEACON_RESET_NETWORK=1
```

## Stage 1 — Regtest solo

1. `npm install` + `npm run link:fabric` in hub.fabric.pub; `npm start` or `npm run desktop`.
2. Complete Hub first-time setup; admin token stays client-side only.
3. Set federation validators to operator pubkey (1-of-1).
4. `npm run ci`; confirm native beacon contract Accept on start.

## Stage 2 — Regtest + peering

1. Regtest P2P: default playnet peer `hub.fabric.pub:18444` unless `FABRIC_BITCOIN_SKIP_PLAYNET_PEER=1`.
2. Fabric Peer on 7777; verify `GET /services/peering`.
3. From star-citizen-live: `npm run playnet:deploy-gooncitizen -- --local-registry --accept`.
4. Verify signed `SIDECHAIN_STATE_PATCH` / RSI snapshots update Hub sidechain and appear in the next Beacon epoch digest.

## Stage 3 — Signet

1. Set `FABRIC_BITCOIN_NETWORK=signet` (or settings); attach to signet bitcoind.
2. **Stop Hub** → `FABRIC_BEACON_RESET_NETWORK=1` → restart (once per promotion).
3. Re-Accept tracked application contracts; confirm `beacon/NETWORK` matches signet.
4. Signet faucet for funds. Regtest-only RPC (Generate Block, hallmark, execution anchor) stays disabled unless explicitly extended.

## Stage 4 — Mainnet (first federation member)

1. Same `FABRIC_XPRV` from `fabric setup` — identity continuity is intentional.
2. `FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS` = operator pubkey; threshold 1 until co-validators onboard.
3. Remote pruned mainnet Core OK ([`scripts/run-hub-local-mainnet.sh`](../scripts/run-hub-local-mainnet.sh)).
4. Backup `stores/hub/beacon/`, `stores/hub/sidechain/`, `stores/hub/application-contracts/` before promotion.
5. Second member: add validator pubkey → raise threshold → update native beacon ARC `spendPolicy.validators` (see `GET /services/distributed/manifest` redeploy checklist).

## Network promotion (`FABRIC_BEACON_RESET_NETWORK`)

Beacon and sidechain stores are bound to a Bitcoin network (`beacon/NETWORK`). Promoting regtest → signet → mainnet requires a one-time reset:

```bash
# Hub stopped
export FABRIC_BEACON_RESET_NETWORK=1
# restart Hub on the new network
```

Implemented in `@fabric/core/functions/beaconNetworkGuard.js`. Clears L1-tied `beacon/CHAIN`, snapshots, and optionally `sidechain/STATE` when rebinding.

## L1 surfaces by network

| Surface | Regtest | Signet | Mainnet |
|---------|---------|--------|---------|
| Beacon epoch (block-linked) | Yes — each validator follows local L1 | Yes — `contracts.merkleRoot` + digests | Yes — k-of-n BIP340 accumulate |
| Sidechain patch (federation witness) | Yes | Yes | Yes |
| Generate Block (admin) | Yes | No | No |
| Fabric hallmark OP_RETURN | Yes | No | No |
| Execution run anchor OP_RETURN | Yes | No | No |

Hallmark and execution anchors are observability only — not federation proof. See core `SIGNATURE_PROOF_MODEL.md`.

## Strict mode summary

When federation validators are configured:

- Sidechain patches: **`federationWitness` required** (no admin token).
- Beacon: **`federationWitnessFailClosed`** on invalid/missing epoch witnesses.
- Trusted internal sidechain apply: disabled unless `FABRIC_SIDECHAIN_TRUSTED_PATCH=1`.
- Contract Accept: pending publish **signer** must be in contract authority list.
