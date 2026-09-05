'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const contractPublishAuthority = require('@fabric/core/functions/contractPublishAuthority');

describe('Hub Accept publish signer bridge', function () {
  it('contractPublishSignerAuthorized gates Accept when authorities listed', function () {
    const owner = new Key();
    const attacker = new Key();
    const definition = {
      name: 'DemoApplication',
      validators: [owner.pubkey]
    };
    assert.strictEqual(
      contractPublishAuthority.contractPublishSignerAuthorized(definition, owner.pubkey),
      true
    );
    assert.strictEqual(
      contractPublishAuthority.contractPublishSignerAuthorized(definition, attacker.pubkey),
      false
    );
  });
});
