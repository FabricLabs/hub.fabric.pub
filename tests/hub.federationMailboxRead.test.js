'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const delegation = require('@fabric/core/types/delegation');
const Hub = require('../services/hub');

describe('Hub#_readFederationMailbox', function () {
  function setup () {
    const asked = [];
    const hub = {};
    const federations = { framesFor (pubkey, opts) { asked.push({ pubkey, opts }); return { messages: [], next: 0, more: false }; } };
    const read = (headers, query = {}) => Hub.prototype._readFederationMailbox.call(hub, federations, { headers, query });
    return { asked, read };
  }

  it('serves frames only for the key that signed the proof, once per proof', function () {
    const { asked, read } = setup();
    const key = new Key();
    const { uri } = delegation.createMailboxFetch({ since: 7 }, key);
    const out = read({ 'x-fabric-mailbox': uri }, { limit: '5', pubkey: new Key().pubkey });
    assert.strictEqual(out.type, 'FederationMessages');
    assert.strictEqual(asked[0].pubkey, key.pubkey, 'the proof, not ?pubkey=, names the member');
    assert.strictEqual(asked[0].opts.since, 7);
    assert.throws(() => read({ 'x-fabric-mailbox': uri }), (e) => e.statusCode === 409);
  });

  it('refuses a bare ?pubkey= or a malformed proof', function () {
    const { asked, read } = setup();
    assert.throws(() => read({}, { pubkey: new Key().pubkey }), (e) => e.statusCode === 401);
    assert.throws(() => read({ 'x-fabric-mailbox': 'fabric:00' }), (e) => e.statusCode === 401);
    assert.strictEqual(asked.length, 0);
  });
});
