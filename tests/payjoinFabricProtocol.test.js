'use strict';

const assert = require('assert');
const { buildFabricPayjoinProtocolProfile } = require('../functions/payjoinFabricProtocol');

describe('payjoinFabricProtocol', () => {
  it('buildFabricPayjoinProtocolProfile includes payments API map and privacy mitigations', () => {
    const p = buildFabricPayjoinProtocolProfile({
      endpointBasePath: '/services/payjoin',
      taprootReceiveTemplate: true,
      receiverContribution: true,
      coinjoin: { path: '/services/coinjoin', maker: true, fidelityBonds: true },
      beaconFederationLeafConfigured: false,
      bip77MailboxExperimental: true
    });
    assert.strictEqual(p.canonicalPaymentsApi.payjoinRestBasePath, '/services/payjoin');
    assert.ok((p.canonicalPaymentsApi.legacyAliases.payjoin || []).includes('/payments/payjoin'));
    assert.strictEqual(p.canonicalPaymentsApi.onchainPaymentsPostPath, '/payments');
    assert.ok(Array.isArray(p.receiver.activeModes));
    assert.ok(p.receiver.activeModes.includes('bip78_http_psbt'));
    assert.ok(p.privacy.mitigations.length >= 2);
    assert.strictEqual(p.extensions.hubTaprootReceiveTemplate, true);
    assert.strictEqual(p.receiver.httpProposal.receiverContribution, true);
    assert.strictEqual(p.receiver.httpProposal.senderResign, 'SIGHASH_ALL');
    assert.ok(!p.privacy.mitigations.some((m) => m.id === 'acp_coinputs'));
    assert.deepStrictEqual(p.extensions.coinjoinMarket, { path: '/services/coinjoin', maker: true, fidelityBonds: true });
  });
});
