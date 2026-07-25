# Sidechain & contract execution — code map
This file is a **navigation index** for “sidechain”, **playnet**, **distributed / federation execution**, and the **sandbox execution machine** across **hub.fabric.pub**, **@fabric/core**, and **@fabric/http**. Use it to find implementations vs. docs vs. examples vs. stubs.

**End-to-end Beacon + sidechain state + reorg design and roadmap (incl. conversation context):** [BEACON_SIDECHAIN_DESIGN_AND_ROADMAP.md](BEACON_SIDECHAIN_DESIGN_AND_ROADMAP.md).

For the architectural story, see [DISTRIBUTED_CONTRACT_EXECUTION.md](DISTRIBUTED_CONTRACT_EXECUTION.md). For Bitcoin P2P and optional block scan, see [BITCOIN_NETWORKS.md](../BITCOIN_NETWORKS.md) and [AGENTS.md](../AGENTS.md).

---

## 1. Hub (`hub.fabric.pub`) — runtime & UI
| Area | Role | Primary locations |
|------|------|-------------------|
| **L1 block scan (playnet signals)** | Optional `getblock … 2` pass: OP_RETURN magic + `watchAddresses`, timelock hints | `functions/sidechainBlockScan.js`, `services/hub.js` (`_maybeScanSidechainBlock`), `settings/local.js` (`bitcoin.sidechainScan`) |
| **L1 anchor of run digest** | Regtest OP_RETURN of `runCommitmentHex` (admin + wallet) | `functions/bitcoinExecutionAnchor.js`, RPC `AnchorExecutionRunCommitment`, `components/ContractView.js` |
| **Run commitment** | Canonical SHA-256 over trace/stack (local ↔ hub parity) | `functions/executionRunCommitment.js`, `RunExecutionContract` result field `runCommitmentHex` |
| **Sandbox “execution machine”** | Opcode metadata + stack steps; no I/O | `functions/fabricExecutionMachine.js`, RPC `CreateExecutionContract` / `RunExecutionContract`, `tests/fabricExecutionMachine.test.js` |
| **Distributed manifest / epoch HTTP** | Program id, allowed types, beacon summary | `@fabric/http` binder mounted in `services/hub.js`; `GET /services/distributed/manifest`, `/epoch` |
| **Beacon + federation witness** | `BEACON_EPOCH` chain, optional threshold sigs on load; payload may include **`sidechain`** head; **reorg** prunes by L1 height and emits `removedBeaconClocks`; pending **FederationSignRequest** rounds when k>1 | `contracts/beacon.js`, `functions/beaconFederationSigning.js`, env `FABRIC_DISTRIBUTED_*` in `services/hub.js` |
| **Sidechain global state (JSON Patch)** | `sidechain/STATE` + `SNAPSHOTS` + `JOURNAL`; RPC + HTTP `/services/distributed/sidechain`; core `@fabric/core/functions/sidechainState` | `functions/sidechainState.js` → core, `tests/sidechainState.test.js`, `tests/beacon.reorg.test.js` |
| **Contract sidechains (ADR-001)** | Accept CONTRACT_PUBLISH → `sidechains/<id>/` + parent `/namespaces/<id>` seal; contract patch RPCs | `functions/contractStatechains.js`, `tests/contractStatechains.test.js`, [ADR-001](ADR-001-CONTRACT_NAMESPACE_SIDECHAINS.md) |
| **Delegation signing (execution path)** | Envelope → wire `Message` → desktop/modal | `docs/FABRIC_MESSAGE_ENVELOPE.md`, `components/DelegationSigningModal.js`, `functions/fabricMessageEnvelope.js` |
| **Storage / distribute contracts (L1)** | Pay-to-distribute, invoice, `CreateStorageContract` | `components/DocumentView.js`, `components/ContractList.js`, `AGENTS.md` (Pay-to-Distribute) |
| **Contract proposals (PSBT / patch)** | Merkle + JSON Patch flows | `functions/contractProposalExchange.js`, `functions/txContractLabels.js`, `SubmitContractProposal` |
| **Bitcoin P2P playnet peers** | RPC `addnode` after RPC up | `settings/local.js` `bitcoin.p2pAddNodes`, env `FABRIC_BITCOIN_P2P_ADDNODES`; implemented in `@fabric/core` `services/bitcoin.js` |
| **Keyword** | Package metadata | `package.json` → `"sidechain"` keyword |

### Hub examples (tests & fixtures)

- `tests/sidechainBlockScan.test.js` — mocked `getblock` for scanner.
- `tests/sidechainState.test.js` — digest + JSON Patch application.
- `tests/executionRunCommitment.test.js` — commitment stability vs `runExecutionProgram`.
- `tests/hub.http.js` — `CreateExecutionContract` + `RunExecutionContract` + `runCommitmentHex`.
- `stores/hub/contracts/*.json` — sample persisted `ExecutionContract` JSON (dev artifacts).

### Hub stubs / follow-ups

- `functions/computeBestOffer.js` — TODO to use `fabricExecutionMachine`.
- Sidechain scanner does **not** persist a withdrawal state machine yet; federation maturation policy is still **documentation + future state**.

---

## 2. `@fabric/core` (Fabric repo)

| Area | Role | Primary locations |
|------|------|-------------------|
| **Sidechain document helpers** | Digest, patch + path policy, journal, restore, serialize queue, wire body helpers (**not** a Fabric type) | `functions/sidechainState.js`, `docs/DISTRIBUTED_EXECUTION.md`, `tests/functions.sidechainState.js` |
| **Program + Machine** | Multi-language programs (`fabric-opcodes`, `bitcoin-script`, …); `loadProgram` / `runProgram` / `parseManifest`; L1 redeem scaffold | `types/program.js`, `types/machine.js`, `docs/PROGRAM.md`, `tests/fabric.program.js` |
| **Protocol helpers (not a type)** | Canonical JSON, beacon epoch signing, federation verify, manifest v1 | `functions/fabricCanonicalJson.js`, `functions/beaconFederationSigning.js`, `functions/fabricProgramManifest.js` (deprecated thin re-export: `types/distributedExecution.js`) |
| **Federation (multisig / miniscript)** | Validators, `sign` / `verifyMultiSignature` | `types/federation.js` (see also [DISTRIBUTED_CONTRACT_EXECUTION.md](DISTRIBUTED_CONTRACT_EXECUTION.md) caveats on templates) |
| **Bitcoin: playnet P2P** | `p2pAddNodes`, `applyP2pAddNodes`, `playnet` datadir case | `services/bitcoin.js`, `tests/bitcoin.p2pAddNodes.test.js` |
| **Playnet / sidechain **placeholders**** | Global constants (empty strings) | `constants.js` → `FABRIC_PLAYNET_ADDRESS`, `FABRIC_PLAYNET_ORIGIN`, `LIGHTNING_SIDECHAIN_NUM` |
| **CLI** | “You must specify a sidechain” error path | `types/cli.js` |
| **Lightning path** | Playnet socket example in settings | `types/cli.js` (`lightning-playnet` path comment) |
| **Generic `Machine` type** | Deterministic VM; loads `Program` (not only Hub opcode sandbox) | `types/machine.js`, `docs/PROGRAM.md` |

### Fabric examples (conceptual / demo)

| Example | What it demonstrates |
|---------|------------------------|
| `tests/lightning/lightning.sidechain.simple.js` | **Fabric message**-level narrative: `SidechainGenesis`, Taproot-style msgs, “deposits”, JSONL replay — **not** wired to Hub or Bitcoin Core ZMQ |
| `settings/playnet.json` | Test key material / playnet-oriented settings for keystore tests |
| `tests/fabric.key.js`, `tests/fabric.keystore.js` | Use `settings/playnet` |
| `scripts/playnet.js` | Script entry (see repo for current behavior) |
| `README.md` / `QUICKSTART.md` | Public **playnet** faucet link; `scripts/bitcoin-playnet.sh` + `stores/bitcoin-playnet` flow |
| `CHANGELOG.md` | “Public playnet” RC note |

---

## 3. `@fabric/http` (fabric-http repo)

| Area | Role | Primary locations |
|------|------|-------------------|
| **Distributed HTTP surface** | Mount manifest + epoch + sidechain routes on a server (`/statechain` transitional alias) | `types/distributedExecutionHttp.js`, `tests/distributedExecutionHttp.test.js` |

---

## 4. How the pieces relate (one paragraph)

**Hub** ties **real Bitcoin** (managed regtest, ZMQ tips, optional `p2pAddNodes`, optional **sidechain block scan**) to **operator UI** and **Fabric** message logs (`BitcoinBlock`, `BEACON_EPOCH`, execution contracts). **Distributed execution** policy (manifest, epoch digest, federation witnesses) lives in
**`@fabric/core` `Machine` + `Program` + `functions/beaconFederationSigning`** (and related helpers)
+ **Beacon** + **HTTP binder** in **@fabric/http**. There is no `DistributedExecution` type.

---

## 5. Suggested consolidation (production direction)

1. **Single vocabulary** in code comments: use “playnet” for shared regtest topology; “sidechain scan” for Hub L1 observer; avoid overloading “sidechain” for unrelated Lightning demos without a prefix (`FabricSidechainGenesis` vs `L1SidechainScan`).
2. **Promote** stable types from `lightning.sidechain.simple.js` or Hub scan results into **`@fabric/core`** only when schemas freeze (deposit record, `matureAtHeight`, withdrawal request).
3. **Retire or link** `computeBestOffer` TODO to a real `runExecutionProgram` policy or delete if dead.
4. **Fill or remove** `FABRIC_PLAYNET_ADDRESS` / `FABRIC_PLAYNET_ORIGIN` in `constants.js` when a single playnet deployment story is chosen.

---

## 6. Quick grep recipes

```bash
# Hub
rg -i 'sidechain|playnet|ExecutionContract|RunExecutionContract|distributedExecution|runCommitment|sidechainScan' --glob '*.js' --glob '*.md'

# Fabric (sibling repo)
rg -i 'sidechain|playnet|SidechainGenesis|distributedExecution|p2pAddNodes' --glob '*.js' --glob '*.md'

# fabric-http
rg -i 'distributedExecution' --glob '*.js'
```

Last updated as an index; behavior details remain in the linked source files and AGENTS.
