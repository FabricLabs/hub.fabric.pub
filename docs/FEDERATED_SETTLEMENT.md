# Federated settlement (Hub)
Operator map for the core tracks in
[`@fabric/core` FEDERATED_SETTLEMENT.md](https://github.com/FabricLabs/fabric/blob/master/docs/FEDERATED_SETTLEMENT.md).

Deploy ladder (identity, regtest → signet → mainnet): [FEDERATION_DEPLOYMENT.md](FEDERATION_DEPLOYMENT.md).
Witness vs digest vs L1: core [SIGNATURE_PROOF_MODEL.md](https://github.com/FabricLabs/fabric/blob/master/docs/SIGNATURE_PROOF_MODEL.md).

## RPC / HTTP (F0 — shipped)
| Method | Role |
|--------|------|
| `CreateFederationPegInCredit` | Credit a matured vault deposit into `/federationReserve` |
| `ProposeFederationPegOut` | Burn / pending-burn a tip-bound withdrawal |
| `PrepareFederationVaultWithdrawalPsbt` | Build a partial vault PSBT; requires matching `withdrawalRequest` |

Pre-sign: Beacon auto-sign and vault prepare call
`federationValidatorVerify.evaluateValidatorSignGate` (local digests + reserve
conservation). Threshold ≥ 2 also needs `withdrawalWitnesses`.

Needs `npm run link:fabric` (or a pin) to a core tip that includes
`functions/federationReserveLedger.js` and `functions/federationValidatorVerify.js`.

## Environment
| Var | Purpose |
|-----|---------|
| `FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS` | Compressed pubkeys |
| `FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD` | k |
| `FABRIC_FEDERATION_PEGOUT_MAX_SATS` | Per-request cap (mainnet default 1 BTC) |
| `FABRIC_FEDERATION_PEGOUT_DAILY_MAX_SATS` | Rolling cap (mainnet default 5 BTC) |
| `FABRIC_SIDECHAIN_TRUSTED_PATCH` | Never on a shared vault (`1` is playnet only) |

Proposed (F2, not shipped): `FABRIC_FEDERATION_PEGIN_MATURITY` (default `100`
on mainnet).

## Track checklist (Hub)
| Track | Hub work | Do not enable on a shared vault until |
|-------|----------|----------------------------------------|
| **F1** Destination lock | Persist allowlist on sidechain; reject prepare if proof fails | F1 tests + delay-on-update |
| **F2** Peg loop | Watch `listunspent` on the vault; credit at maturity; reorg freeze; broadcast only after burn | Watcher + double-prepare tests |
| **F3** Emergency path | Surface recovery lock in Bitcoin / Federation UI; never store recovery keys on the Hub host | Taproot vectors + offline key ceremony |
| **F4** Aggregate spend | Wire real MuSig2 **or** remove UI copy that implies it | Core `musig2EpochAggregate` no longer a stub |
| **F5** Functionary signing | Export PSBT / descriptor for hardware; Hub may be watch-only | Spend key leaves `FABRIC_XPRV` on the signer host |
| **P1 / P2** | No Hub scan-key RPC; no blinding until core P2 is tagged | Core [AMOUNT_PRIVACY.md](https://github.com/FabricLabs/fabric/blob/master/docs/AMOUNT_PRIVACY.md) |
| **I1** | Path policy for `/instruments` when the track opens | Core [ISSUED_INSTRUMENTS.md](https://github.com/FabricLabs/fabric/blob/master/docs/ISSUED_INSTRUMENTS.md) |
| **X1** | Tag `@fabric/core`; pin this repo; redeploy | Vault holds coins others treat as theirs |

## UI honesty
- Federation / Beacon copy must not say “peg complete” while F1–F2 are open.
- Do not label epoch aggregate as MuSig2 until F4 is real.
- Amount-blinding toggles stay hidden until a tagged P2.

## Related
- [FEDERATION_DEPLOYMENT.md](FEDERATION_DEPLOYMENT.md)
- [DISTRIBUTED_CONTRACT_EXECUTION.md](DISTRIBUTED_CONTRACT_EXECUTION.md)
- [PAYMENTS_PROTOCOL.md](../PAYMENTS_PROTOCOL.md) (invoices, Payjoin, inventory HTLC — adapters)
