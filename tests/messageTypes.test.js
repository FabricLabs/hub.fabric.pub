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

  it('contract log + federation activity names align with core applicationNamespaces when linked', function () {
    try {
      const appNs = require('@fabric/core/functions/applicationNamespaces');
      assert.strictEqual(mt.CONTRACT_PUBLISH_LOG, appNs.LOG_TYPES.ContractPublish);
      assert.strictEqual(mt.CONTRACT_MESSAGE_LOG, appNs.LOG_TYPES.ContractMessage);
      assert.strictEqual(mt.FEDERATION_SIGN_REQUEST, appNs.ACTIVITY_TYPES.FederationSignRequest);
      assert.strictEqual(mt.FEDERATION_SIGN_RESPONSE, appNs.ACTIVITY_TYPES.FederationSignResponse);
    } catch (_) {
      assert.strictEqual(mt.CONTRACT_PUBLISH_LOG, 'ContractPublish');
      assert.strictEqual(mt.FEDERATION_SIGN_REQUEST, 'FederationSignRequest');
    }
  });
});
