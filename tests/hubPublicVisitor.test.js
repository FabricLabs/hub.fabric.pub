'use strict';

const assert = require('assert');
const {
  computePublicHubVisitor,
  hasUnlockedHubSigningIdentity
} = require('../functions/hubPublicVisitor');

describe('hubPublicVisitor', function () {
  it('treats watch-only local identity (xpub only, not desktop-linked) as visitor', function () {
    assert.strictEqual(
      computePublicHubVisitor({
        localIdentity: { id: 'a', xpub: 'xpub661MyMwAqRbcF6GygV6Q6XAg8dqhPvDuhYHGniequi6HMbYhNNH5XC13Np3qRANHVD2mmnNGtMGBfDT69s2ovpHLr7q8syoAuyWqtRGEsYQ' },
        propsAuth: null
      }),
      true
    );
  });

  it('is not a visitor after Fabric Hub desktop login (watch-only xpub + linked flag)', function () {
    assert.strictEqual(
      computePublicHubVisitor({
        localIdentity: {
          id: 'a',
          xpub: 'xpub661MyMwAqRbcF6GygV6Q6XAg8dqhPvDuhYHGniequi6HMbYhNNH5XC13Np3qRANHVD2mmnNGtMGBfDT69s2ovpHLr7q8syoAuyWqtRGEsYQ',
          linkedFromDesktop: true,
          xprv: null,
          passwordProtected: false
        },
        propsAuth: null
      }),
      false
    );
  });

  it('is not a visitor when identity is password-protected but locked (no xprv in memory)', function () {
    assert.strictEqual(
      computePublicHubVisitor({
        localIdentity: {
          id: 'a',
          xpub: 'xpub661MyMwAqRbcF6GygV6Q6XAg8dqhPvDuhYHGniequi6HMbYhNNH5XC13Np3qRANHVD2mmnNGtMGBfDT69s2ovpHLr7q8syoAuyWqtRGEsYQ',
          passwordProtected: true,
          xprv: null
        },
        propsAuth: null
      }),
      false
    );
  });

  it('is not a visitor when local identity has xprv', function () {
    assert.strictEqual(
      computePublicHubVisitor({
        localIdentity: { id: 'a', xpub: 'x', xprv: 'xprv9s21ZrQH143K2cCWaTZPjPDwac1CzTW4LKMfzLFEMNZJUoDYppxpyPgZXY7CZkjefGJTrTyqKnMrM4RG6nGn7Q9cwjHggCtn3CdFGJahaWY' },
        propsAuth: null
      }),
      false
    );
  });

  it('is not a visitor when props auth has private key material', function () {
    assert.strictEqual(
      hasUnlockedHubSigningIdentity({
        localIdentity: null,
        propsAuth: { xprv: 'xprv9s21ZrQH143K2cCWaTZPjPDwac1CzTW4LKMfzLFEMNZJUoDYppxpyPgZXY7CZkjefGJTrTyqKnMrM4RG6nGn7Q9cwjHggCtn3CdFGJahaWY' }
      }),
      true
    );
  });
});
