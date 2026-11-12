'use strict';

const assert = require('assert');
const mt = require('../functions/messageTypes');

describe('messageTypes', function () {
  it('has no delegation signing types (Passport v2 removed Hub delegation)', function () {
    assert.strictEqual(mt.DELEGATION_SIGNATURE_REQUEST, undefined);
    assert.strictEqual(mt.isDelegationSignatureRequestActivity, undefined);
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
