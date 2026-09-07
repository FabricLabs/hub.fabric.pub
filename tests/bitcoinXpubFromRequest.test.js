'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Hub = require('../services/hub');

describe('Hub._bitcoinXpubFromRequest', () => {
  const hub = Object.create(Hub.prototype);

  it('prefers X-Fabric-Xpub header over body and query', () => {
    assert.equal(hub._bitcoinXpubFromRequest({
      headers: { 'x-fabric-xpub': 'xpubFromHeader' },
      body: { xpub: 'xpubFromBody' },
      query: { xpub: 'xpubFromQuery' }
    }), 'xpubFromHeader');
  });

  it('prefers JSON body over query', () => {
    assert.equal(hub._bitcoinXpubFromRequest({
      headers: {},
      body: { xpub: 'xpubFromBody' },
      query: { xpub: 'xpubFromQuery' }
    }), 'xpubFromBody');
  });

  it('falls back to query for legacy clients', () => {
    assert.equal(hub._bitcoinXpubFromRequest({
      headers: {},
      query: { xpub: 'xpubFromQuery' }
    }), 'xpubFromQuery');
  });
});
