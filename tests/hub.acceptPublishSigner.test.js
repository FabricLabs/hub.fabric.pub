'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Contract = require('@fabric/core/types/contract');

describe('Hub Accept publish signer bridge', function () {
  it('Contract.publishSignerAuthorized gates Accept when authorities listed', function () {
    const owner = new Key();
    const attacker = new Key();
    const definition = {
      name: 'DemoApplication',
      validators: [owner.pubkey]
    };
    assert.strictEqual(
      Contract.publishSignerAuthorized(definition, owner.pubkey),
      true
    );
    assert.strictEqual(
      Contract.publishSignerAuthorized(definition, attacker.pubkey),
      false
    );
  });
});
