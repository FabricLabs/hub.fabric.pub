'use strict';

/**
 * The same two keys, two vault addresses: nums and musig2.
 * Run: node examples/federation-vault.js
 *
 * Nothing is broadcast and nothing is scanned.
 */

const Key = require('@fabric/core/types/key');
const {
  resolveFederationInternalKeyMode,
  buildFederationVaultFromPolicy
} = require('../functions/federationVault');

function fail (message) {
  console.error('[EXAMPLES:FEDERATION_VAULT]', message);
  process.exitCode = 1;
  throw new Error(message);
}

function vault (pubs, internalKeyMode) {
  return buildFederationVaultFromPolicy({
    validators: pubs,
    threshold: 2,
    networkName: 'regtest',
    publisher: pubs[0],
    internalKeyMode
  });
}

function main () {
  const pubs = [new Key().pubkey, new Key().pubkey];
  if (resolveFederationInternalKeyMode({}, {}) !== 'nums') {
    fail('an empty Hub setting should keep the historical nums internal key');
  }
  if (resolveFederationInternalKeyMode({ federation: { internalKeyMode: 'musig2' } }, {}) !== 'musig2') {
    fail('settings should be able to select musig2');
  }

  const nums = vault(pubs, 'nums');
  const musig = vault(pubs, 'musig2');
  if (!nums.address || !musig.address) fail('each mode should produce an address');
  if (nums.address === musig.address) fail('nums and musig2 should be different addresses');

  console.log('[EXAMPLES:FEDERATION_VAULT]', 'nums', nums.address);
  console.log('[EXAMPLES:FEDERATION_VAULT]', 'musig2', musig.address);
}

main();
