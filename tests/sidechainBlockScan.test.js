'use strict';

const assert = require('assert');
const { parseVerboseBlockForSidechainSignals } = require('../functions/sidechainBlockScan');

describe('sidechainBlockScan', function () {
  it('parses getblock-verbosity-2 fixture: op_return magic and watched address', function () {
    const magic = 'fab100';
    const block = {
      hash: 'deadbeef'.repeat(8),
      tx: [
        {
          txid: 'aa'.repeat(32),
          locktime: 0,
          vout: [
            {
              n: 0,
              value: 0,
              scriptPubKey: {
                type: 'nulldata',
                hex: '6a03' + magic + '00'
              }
            },
            {
              n: 1,
              value: 0.001,
              scriptPubKey: {
                type: 'witness_v0_keyhash',
                address: 'bcrt1qtestdeposit',
                hex: '0014abcd'
              }
            }
          ]
        }
      ]
    };
    const signals = parseVerboseBlockForSidechainSignals(block, 42, {
      opReturnMagicHex: magic,
      watchAddresses: ['bcrt1qtestdeposit']
    });
    assert.ok(signals.some((s) => s.kind === 'op_return_magic'));
    assert.ok(signals.some((s) => s.kind === 'watch_address_out'));
  });
});
