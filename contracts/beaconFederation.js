'use strict';

/**
 * Fabric Hub **Beacon Federation** — operator-defined k-of-n Schnorr witnesses on
 * `BEACON_EPOCH` payloads, plus a separate L1 Taproot federation vault (PSBT co-signing).
 * This is not an external sidechain; it is configured on **this** hub (see Distributed federation below).
 *
 * @see docs/DISTRIBUTED_CONTRACT_EXECUTION.md
 */

module.exports = {
  id: 'beacon-federation',
  name: 'Beacon Federation',
  kind: 'fabric-hub-beacon',
  networkId: 'this hub',
  description: 'Binds beacon epochs to Bitcoin L1 and optional sidechain digests: validator pubkeys and threshold (this page), canonical signing strings, `federationWitness` on sealed epochs, and a Taproot federation vault for L1 deposits (UTXO scan on the Hub; spends coordinated off-hub via PSBT).',
  links: [
    { label: 'Beacon Federation (operator UI)', to: '/settings/admin/beacon-federation' },
    { label: 'Distributed manifest (JSON)', href: '/services/distributed/manifest' },
    { label: 'Beacon epoch summary (JSON)', href: '/services/distributed/epoch' },
    { label: 'Federation vault', href: '/services/distributed/vault' },
    { label: 'Vault UTXOs', href: '/services/distributed/vault/utxos' },
    { label: 'Federation registry (JSON)', href: '/services/distributed/federation-registry' },
    {
      label: 'Distributed execution (design doc)',
      href: 'https://github.com/FabricLabs/hub.fabric.pub/blob/master/docs/DISTRIBUTED_CONTRACT_EXECUTION.md'
    }
  ],
  l1Bitcoin: {
    notes: 'Vault uses a deterministic P2TR federation address from the configured validator set. Incoming deposits are tracked with a default 144-block maturity before spend policy (operator-facing; see Beacon Federation UI).'
  }
};
