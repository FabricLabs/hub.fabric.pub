'use strict';

/**
 * Fabric Hub **Beacon Federation** — operator catalog entry for the Hub Beacon
 * epoch sealer + its native `fabric-beacon` CONTRACT_PUBLISH / ARC namespace.
 *
 * Wire genesis lives in `@fabric/core/functions/beaconContractDefinition`
 * (network-agnostic). Hub `startBeacon` auto-registers and accepts it into the
 * tracked set; L1 Taproot vault and ARC `spendAddress` share
 * `taproot-authority-ladder-v1`.
 *
 * @see docs/DISTRIBUTED_CONTRACT_EXECUTION.md
 */

module.exports = {
  id: 'beacon-federation',
  name: 'Beacon Federation',
  kind: 'fabric-hub-beacon',
  contractName: 'fabric-beacon',
  interfaces: ['arc.core', 'fabric.beacon'],
  networkId: 'this hub',
  description: 'Binds beacon epochs to Bitcoin L1 and optional sidechain digests: validator pubkeys and threshold (this page), canonical signing strings, `federationWitness` on sealed epochs, and a Taproot federation vault for L1 deposits. The same authority set is published as a native ARC (`fabric-beacon`) under tracked application contracts — Actor id is content-addressed without Bitcoin network in genesis so the contract redeploys across regtest / signet / mainnet with Accept overlays.',
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
    notes: 'Vault and fabric-beacon ARC share spendPolicy { publisher, validators, threshold, csvBlocks, softMode } via taproot-authority-ladder-v1. Redeploy: bind beacon/NETWORK per environment; set FABRIC_BEACON_RESET_NETWORK=1 once when promoting chains.'
  }
};
