'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const {
  signFederationContractPayload,
  verifyFederationContractPayloadSignature,
  federationInviteCanonicalJson
} = require('../functions/federationContractInviteSigned');

describe('federationContractInviteSigned', function () {
  this.timeout(10000);

  it('signs and verifies canonical federation invite-shaped JSON', function () {
    const k = new Key();
    const payload = {
      type: 'FederationContractInvite',
      v: 1,
      inviteId: 'abc123',
      inviterHubId: 'deadbeef',
      contractId: 'beacon',
      note: null,
      invitedAt: 1700000000000
    };
    const signed = signFederationContractPayload(payload, k);
    assert.ok(signed.fabricSchnorrSigHex && signed.fabricSignerPubkeyHex);
    assert.strictEqual(federationInviteCanonicalJson(signed), federationInviteCanonicalJson(payload));
    const v = verifyFederationContractPayloadSignature(signed);
    assert.strictEqual(v.ok, true);
  });

  it('rejects tampered payload after signing', function () {
    const k = new Key();
    const signed = signFederationContractPayload({
      type: 'FederationContractInviteResponse',
      v: 1,
      inviteId: 'x',
      accept: true,
      responderPubkey: '02' + '11'.repeat(32),
      respondedAt: 1
    }, k);
    signed.accept = false;
    const v = verifyFederationContractPayloadSignature(signed);
    assert.strictEqual(v.ok, false);
  });
});
