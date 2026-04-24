'use strict';

const assert = require('assert');
const { buildFabricPayjoinProtocolProfile } = require('../functions/payjoinFabricProtocol');

describe('payjoinFabricProtocol', () => {
  it('buildFabricPayjoinProtocolProfile includes payments API map and privacy mitigations', () => {
    const p = buildFabricPayjoinProtocolProfile({
      endpointBasePath: '/services/payjoin',
      joinmarketTaprootTemplate: true,
      beaconFederationLeafConfigured: false
    });
    assert.strictEqual(p.canonicalPaymentsApi.payjoinRestBasePath, '/services/payjoin');
    assert.ok((p.canonicalPaymentsApi.legacyAliases.payjoin || []).includes('/payments/payjoin'));
    assert.strictEqual(p.canonicalPaymentsApi.onchainPaymentsPostPath, '/payments');
    assert.ok(Array.isArray(p.receiver.activeModes));
    assert.ok(p.privacy.mitigations.length >= 2);
    assert.strictEqual(p.extensions.joinmarketTaprootReceiveTemplate, true);
  });
});
