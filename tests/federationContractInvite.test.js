'use strict';

const assert = require('assert');
const {
  parseFederationContractInvite,
  parseFederationContractInviteResponse,
  buildFederationContractInviteJson,
  buildFederationContractInviteResponseJson
} = require('../functions/federationContractInvite');

describe('federationContractInvite', () => {
  it('round-trips invite JSON', () => {
    const json = buildFederationContractInviteJson({
      inviteId: 'abc123',
      inviterHubId: 'deadbeef',
      contractId: 'c1',
      note: 'hello',
      invitedAt: 99
    });
    const p = parseFederationContractInvite(json);
    assert.strictEqual(p.inviteId, 'abc123');
    assert.strictEqual(p.inviterHubId, 'deadbeef');
    assert.strictEqual(p.contractId, 'c1');
    assert.strictEqual(p.note, 'hello');
    assert.strictEqual(p.invitedAt, 99);
  });

  it('round-trips response JSON', () => {
    const json = buildFederationContractInviteResponseJson({
      inviteId: 'abc',
      accept: true,
      responderPubkey: '02aa',
      respondedAt: 1
    });
    const p = parseFederationContractInviteResponse(json);
    assert.strictEqual(p.inviteId, 'abc');
    assert.strictEqual(p.accept, true);
    assert.strictEqual(p.responderPubkey, '02aa');
    assert.strictEqual(p.respondedAt, 1);
  });

  it('rejects malformed payloads', () => {
    assert.strictEqual(parseFederationContractInvite('not json'), null);
    assert.strictEqual(parseFederationContractInvite('{}'), null);
    assert.strictEqual(parseFederationContractInviteResponse('{"type":"FederationContractInviteResponse","v":1}'), null);
  });
});
