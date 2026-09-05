# Bitcoin Networks: Mainnet, Testnet, Signet, Regtest

Research and preparation for hub.fabric.pub multi-network support.

## Network Overview

| Network   | Purpose                    | Consensus      | Block time | RPC port | P2P port | Address prefix |
|-----------|----------------------------|----------------|------------|----------|----------|----------------|
| **mainnet** | Production, real value     | PoW            | ~10 min    | 8332     | 8333     | bc1, 1, 3      |
| **testnet** | Public testing, PoW        | PoW            | Variable   | 18332    | 18333    | tb1, m/n, 2    |
| **signet**  | Stable testing, federated | Signed blocks  | ~1 min     | 38332    | 38333    | tb1 (same as testnet) |
| **regtest** | Local dev, full control   | On-demand mine | Instant    | 18443*   | 18444    | bcrt1           |

\* Hub uses 20444 for managed regtest to avoid clashes with other regtest nodes.

## Key Differences

### Testnet vs Signet

- **Testnet**: Proof-of-Work like mainnet. Decentralized but unreliable—large reorgs, long gaps, or bursts of blocks. Good for public experimentation.
- **Signet** (BIP 325): Federated consensus; blocks must be signed by designated signers. Predictable block times (~1 min), stable, suitable for integration testing, L2 testing, and multi-party coordination. Coins have no real value.

### Signet Advantages

- Predictable block production
- No mining cost (unlike regtest, has real chain structure)
- Suitable for CI/CD and coordinated testing
- Custom signets possible via `-signetchallenge` and `-signetseednode`

### Default Ports (bitcoind)

| Network   | RPC  | P2P  |
|-----------|------|------|
| mainnet   | 8332 | 8333 |
| testnet   | 18332| 18333|
| signet    | 38332| 38333|
| regtest   | 18443| 18444|

## bitcoind Configuration

```bash
# Mainnet (default)
bitcoind

# Testnet
bitcoind -testnet

# Signet (default global signet)
bitcoind -signet

# Regtest
bitcoind -regtest
```

## Chain Data Subdirectories

Bitcoin Core uses chain-specific subdirs under datadir:

| Network   | Subdir    |
|-----------|-----------|
| mainnet   | (root)    |
| testnet   | testnet3 |
| signet    | signet   |
| regtest   | regtest  |

Cookie file: `datadir/<subdir>/.cookie`

## Hub / Fabric Support

### Current State

- **Fabric Bitcoin service** (`@fabric/core`): Supports mainnet, testnet, signet, regtest, testnet4. Correct default RPC ports. Spawns bitcoind with `-testnet`, `-signet`, `-regtest` as needed.
- **Hub**: Onboarding offers regtest, signet, testnet, mainnet. Managed mode auto-enabled for regtest only.
- **Cookie path**: Fabric had `signet` chain subdir missing; fixed in this prep.
- **Fabric P2P chain tip:** The Hub gossips each new local chain tip (ZMQ `hashblock`) to Fabric TCP peers as a signed `BitcoinBlock` message; peers relay. This is separate from Bitcoin Core P2P—operators align on which network the Fabric app targets (one network per deployment; regtest in dev). See `AGENTS.md` (Beacon + `BitcoinBlock`).

### Configuration

- **Env**: `FABRIC_BITCOIN_NETWORK=signet|testnet|mainnet|regtest`
- **Setup**: `stores/hub/STATE` → `.settings.BITCOIN_NETWORK` (and optional `BITCOIN_PRESET` / prune / listen / dbcache knobs from first-time setup)
- **Unmanaged**: When `BITCOIN_MANAGED=false`, use default RPC port per network (not always 8332).
- **Explorer HTTP fallback** (`@fabric/core` `Bitcoin`): optional `FABRIC_EXPLORER_URL` or `bitcoin.explorerBaseUrl` (origin only, e.g. `http://localhost:8080`). Unset means RPC-only for block/tx; address-index queries need an explorer or hub that exposes `/services/bitcoin/addresses/...`.

### Demonstration: mainnet with a LAN full node

Use this when Bitcoin Core runs on another machine (for example a known-good node on your network).

1. On first-time setup, choose **Mainnet**, turn **managed** off, and set:
   - **Host**: RPC host (e.g. `127.0.0.1`)
   - **RPC port**: `8332` unless your node uses a custom port
   - **Username / password**: as in the remote node’s `bitcoin.conf`, or use cookie auth if you run the Hub on the same filesystem as that node (unusual for LAN RPC; user/pass is typical).
2. Or edit `stores/hub/STATE` `.settings` after setup (keys vary by bootstrap; mirror what onboarding writes), ensuring `BITCOIN_MANAGED` is false and host/port/network match the remote node.
3. **Firewall / bind**: the remote `bitcoind` must accept RPC from the Hub host (`rpcbind`, `rpcallowip`, and no firewall drop). **Use RPC over a trusted LAN or TLS/stunnel; never expose raw RPC to the internet.**
4. **Fabric CLI / `@fabric/core`**: point a non-managed wallet at the same RPC with `FABRIC_BITCOIN_NODE=127.0.0.1` (optional `:port`) or `bitcoin.spvNode` in settings, as documented in the core CLI help.

Regtest defaults in repo settings are unchanged; mainnet is an explicit operator choice via setup or settings.

### Regtest: connect two `bitcoind` instances (P2P)

The browser reads blocks/transactions from **this Hub’s** `/services/bitcoin` only. To share a regtest chain between machines, connect peers at the **Bitcoin Core** layer with `addnode` (not HTTP failover).

From the repo root, against the **managed regtest** datadir (`stores/bitcoin-regtest`, RPC **20444** by default):

```bash
npm run bitcoin:addnode -- <other-host>:18444 add
npm run bitcoin:addnode -- list    # getaddednodeinfo
npm run bitcoin:addnode -- peers   # getpeerinfo
```

Use the remote machine’s **P2P** port (default regtest **18444** unless overridden). Env: `FABRIC_BITCOIN_DATADIR`, `FABRIC_BITCOIN_RPC_PORT`, optional `FABRIC_BITCOIN_RPC_USER` / `FABRIC_BITCOIN_RPC_PASSWORD` for RPC auth.

Hub **managed regtest** runs `bitcoind` with **no inbound P2P** (`listen=0`). Outbound `addnode` to a peer that **does** accept P2P still works; two hubs both on managed regtest need a third listening node or a custom `bitcoind` config if you require mutual discovery.

### Playnet (shared regtest) — automatic `addnode` from settings
For a small **test network** (e.g. LAN at `192.168.50.5` plus `hub.fabric.pub`) you can list Bitcoin **P2P** endpoints in `settings/local.js` under `bitcoin.p2pAddNodes` (or set **`FABRIC_BITCOIN_P2P_ADDNODES=192.168.50.5:18444,hub.fabric.pub:18444`**). After RPC is ready, **`@fabric/core`** `Bitcoin` runs `addnode <host:port> add` for each entry (regtest/signet/testnet only; **mainnet is skipped** unless `bitcoin.p2pAddNodesAllowMainnet: true`).

**Regtest default peer:** The Hub **always** includes **`hub.fabric.pub:18444`** in that merged list so local managed regtest can sync L1 height with the public playnet seed (Bitcoind P2P, not HTTP). Opt out with **`FABRIC_BITCOIN_SKIP_PLAYNET_PEER=1`**. Point elsewhere with **`FABRIC_BITCOIN_PLAYNET_PEER=host:port`**.

- Omitted port defaults to the usual P2P port for the active network (regtest **18444**).
- This does **not** replace `npm run bitcoin:addnode` for one-off debugging; it keeps playnet nodes aligned on boot. The Bitcoin UI **Network** table lists configured `addnode` targets when present.

### Sidechain block scan (optional)
With **`FABRIC_SIDECHAIN_SCAN=1`** or `bitcoin.sidechainScan.enable: true`, the Hub runs a **lightweight per-block pass** on each new tip (`getblock … 2`): OP_RETURN payloads containing a configurable magic prefix (`fab100` by default) and pays to **`watchAddresses`**. Matching txs emit Activity `SidechainScan` and log `[HUB:SIDECHAIN]` in debug mode. **Timelock policy** (e.g. “withdraw after +100 blocks”) is enforced in federation/state logic using the reported `locktime` and chain height — the scanner only surfaces markers; covenant rules belong in `@fabric/core` / Hub state machines as they harden.

**Smoke check (optional):** from a machine that can reach the node’s RPC, `FABRIC_MAINNET_RPC_SMOKE=1 BITCOIN_RPC_HOST=192.168.50.5 BITCOIN_RPC_USER=… BITCOIN_RPC_PASSWORD=… npm run test:smoke-mainnet-rpc` calls `getblockchaininfo` and asserts `chain === main`.

### Address Placeholders

- regtest: `bcrt1...`
- testnet/signet: `tb1...` or `2N...`
- mainnet: `bc1...` or `3...`

## References

- [BIP 325: Signet](https://bips.dev/325)
- [Bitcoin Optech: Signet](https://bitcoinops.org/en/topics/signet/)
- [Bitcoin Core files](https://github.com/bitcoin/bitcoin/blob/master/doc/files.md)
