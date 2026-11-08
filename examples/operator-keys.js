'use strict';

/**
 * The Hub's own keys: identity and cosigner from the master, never the master itself.
 * Run: node examples/operator-keys.js
 */

const Key = require('@fabric/core/types/key');
const { generateMnemonic, importSeed } = require('@fabric/core/functions/accountKeys');
const { hubServerKeys } = require('../functions/hubAccount');

function fail (message) {
  console.error('[EXAMPLES:OPERATOR_KEYS]', message);
  process.exitCode = 1;
  throw new Error(message);
}

function main () {
  const root = new Key({ xprv: importSeed(generateMnemonic()) });
  const hub = { _rootKey: root, settings: { network: 'regtest' } };
  const keys = hubServerKeys(hub);

  if (!keys.identity || !keys.cosigner) fail('account 0 should yield an identity and a cosigner');
  if (keys.network !== 'regtest') fail('the tutorial hub is on regtest');
  const pubs = [root.pubkey, keys.identity.pubkey, keys.cosigner.pubkey].map((value) => String(value).toLowerCase());
  if (new Set(pubs).size !== 3) fail('root, identity, and cosigner must be three keys');

  console.log('[EXAMPLES:OPERATOR_KEYS]', 'network', keys.network);
  console.log('[EXAMPLES:OPERATOR_KEYS]', 'identity', pubs[1].slice(0, 16) + '…');
  console.log('[EXAMPLES:OPERATOR_KEYS]', 'cosigner', pubs[2].slice(0, 16) + '…');
  console.log('[EXAMPLES:OPERATOR_KEYS]', 'root is not a signer');
}

main();
