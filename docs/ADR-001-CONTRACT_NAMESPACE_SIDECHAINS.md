# ADR-001 — Contract-namespace sidechains via Contract publish

**Date:** 2026-07-20 · **Status:** Accepted · **Deciders:** Neorion

## Context

Bitcoin mainnet produces one block every ~10 minutes on average. `hub.fabric.pub` operates as a Fabric Protocol rendezvous for bootstrapping many applications. A small set of nodes (the **Beacon Federation**) signs valid **sidechain blocks** that confirm the latest Bitcoin block hash with federation Schnorr signatures.

Downstream **applications** publish a contract describing their namespace, creating a further sidechain under the Hub beacon sidechain. Inside that namespace, Groups (and similar constructs) create still further sidechains. Every level must use the **same document implementation** (`@fabric/core` `functions/sidechainState` + `Chain` / `Block` family) and the **Contract publishing protocol** (`CONTRACT_PUBLISH` / `CONTRACT_MESSAGE` / accepted tracked contracts)—not a parallel “nested” type.

## Decision

1. **L1 clock** — Beacon epochs advance with Bitcoin tips (mainnet-like: one epoch per new block). Each epoch payload includes `blockHash`, `height`, and sealed digests.
2. **Beacon Federation** — Validators and threshold (k-of-n Schnorr) authorize epoch seals via `federationWitness` over `signingStringForBeaconEpoch(fullPayload)`. When threshold > 1, the Hub runs a **signature collection round** before appending the epoch.
3. **One sidechain document implementation** — `@fabric/core` `functions/sidechainState` (`sidechain/STATE` + `SNAPSHOTS` + `JOURNAL`, RFC6902 patches, path policy, reorg rewind) is the only sealed-document helper set (not a Fabric type). Contract namespaces reuse it at `sidechains/<contractId>/`.
4. **Namespaces by Contract** — Accepting a `CONTRACT_PUBLISH` into the Beacon-tracked set provisions a **contract sidechain document** at `sidechains/<contractId>/`. The parent Hub sidechain seals the child head at `/namespaces/<contractId>` (`{ contractId, clock, stateDigest, … }`). Child digests also refresh `contracts.stateRoot` on the epoch.
5. **Application trees** — An accepted application namespace sits under the Hub. Group Federation contracts are further namespaces under that application (parent seal under the application chain’s `/namespaces/<groupContractId>`). Further levels follow the same rule.
6. **Ignore-unknown** — Peers still gossip unknown contract ids; apps only materialize chains for namespaces they accept.

```text
Bitcoin tip
  → BEACON_EPOCH (federation Schnorr)
      → Hub sidechain head (payload.sidechain)
          → /namespaces/<appContractId> → app sidechain document (same helpers)
              → /namespaces/<groupContractId> → group sidechain document (same helpers)
```

## Consequences

- **Positive:** Uniform verify path from L1 → Hub → app → group; apps do not invent parallel chain formats; Contract publish remains the namespace boundary.
- **Negative:** More store paths and digest sync work; multi-validator epochs need a short pending-round window before seal.
- **Guardrails:** Do not bump frozen application genesis `messageTypes` for chain plumbing; compact public digests only; fail-closed federation witnesses remain default on Beacon load. Prefer “contract sidechain” / “namespace seal” wording—not “nested chain” (which implies a different implementation).

## Related

- [BEACON_SIDECHAIN_DESIGN_AND_ROADMAP.md](BEACON_SIDECHAIN_DESIGN_AND_ROADMAP.md)
- [DISTRIBUTED_CONTRACT_EXECUTION.md](DISTRIBUTED_CONTRACT_EXECUTION.md)
- `@fabric/core` `docs/DISTRIBUTED_EXECUTION.md`, `docs/APPLICATION_NAMESPACES.md`
- Application **D-016**-style decisions (contract-namespace sidechains under Hub Beacon)
