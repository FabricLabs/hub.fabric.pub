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

describe('Hub._bitcoinXpubAddressesFromRequest', () => {
  const hub = Object.create(Hub.prototype);

  it('reads a JSON body array or string before the query', () => {
    assert.equal(hub._bitcoinXpubAddressesFromRequest({
      body: { addresses: [' bcrt1qa ', 'bcrt1qb', ''] },
      query: { addresses: 'bcrt1qquery' }
    }), 'bcrt1qa,bcrt1qb');
    assert.equal(hub._bitcoinXpubAddressesFromRequest({ body: { addresses: 'bcrt1qa,bcrt1qb' } }), 'bcrt1qa,bcrt1qb');
  });

  it('falls back to ?addresses= and to nothing', () => {
    assert.equal(hub._bitcoinXpubAddressesFromRequest({ query: { addresses: ' bcrt1qquery ' } }), 'bcrt1qquery');
    assert.equal(hub._bitcoinXpubAddressesFromRequest({ query: {} }), '');
  });

  it('reads limit from the body before the query', () => {
    assert.equal(hub._bitcoinXpubBodyOrQuery({ body: { limit: 10 }, query: { limit: '40' } }, 'limit'), 10);
    assert.equal(hub._bitcoinXpubBodyOrQuery({ query: { limit: '40' } }, 'limit'), '40');
  });
});
