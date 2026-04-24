'use strict';

const assert = require('assert');
const mt = require('../functions/messageTypes');

describe('messageTypes', function () {
  it('isDelegationSignatureRequestActivity accepts canonical and legacy alias', function () {
    assert.strictEqual(mt.isDelegationSignatureRequestActivity(null), false);
    assert.strictEqual(mt.isDelegationSignatureRequestActivity({ type: 'P2P_CHAT_MESSAGE' }), false);
    assert.strictEqual(mt.isDelegationSignatureRequestActivity({ type: mt.DELEGATION_SIGNATURE_REQUEST }), true);
    assert.strictEqual(mt.isDelegationSignatureRequestActivity({ type: mt.LEGACY_DELEGATION_SIGN_REQUEST }), true);
  });
});
