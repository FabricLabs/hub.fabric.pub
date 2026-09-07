'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const { exclusiveOperatorKeySettings } = require('@fabric/core/functions/fabricOperatorIdentity');
const { redactHubSettingsForLog } = require('../functions/redactHubSettings');

const PHRASE_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PHRASE_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('Hub operator identity alignment', function () {
  it('collapses mixed mnemonic+xprv so Hub matches FABRIC_XPRV', function () {
    const fromMnemonic = new Key({ mnemonic: PHRASE_A });
    const fromXprv = new Key({ mnemonic: PHRASE_B });
    const exclusive = exclusiveOperatorKeySettings({
      mnemonic: PHRASE_A,
      xprv: fromXprv.xprv
    });
    const hubKey = new Key(exclusive);
    assert.strictEqual(hubKey.pubkey, fromXprv.pubkey);
    assert.notStrictEqual(hubKey.pubkey, fromMnemonic.pubkey);
  });

  it('redactHubSettingsForLog omits mnemonic and xprv', function () {
    const redacted = redactHubSettingsForLog({
      alias: '@fabric/hub',
      key: { mnemonic: PHRASE_A, xprv: 'xprv-secret', seed: 'aa'.repeat(32) }
    });
    assert.strictEqual(redacted.key.hasMnemonic, true);
    assert.strictEqual(redacted.key.hasXprv, true);
    assert.strictEqual(redacted.key.mnemonic, undefined);
    assert.strictEqual(redacted.key.xprv, undefined);
  });
});
