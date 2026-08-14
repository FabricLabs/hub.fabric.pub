'use strict';

const assert = require('assert');
const { resolveBitcoinClientAuthToken } = require('../functions/bitcoinClient');

describe('bitcoinClient.resolveBitcoinClientAuthToken', function () {
  const settings = {
    hubAdminToken: 'admin-secret',
    apiToken: 'api-only'
  };

  it('uses hub admin token only for Hub /services/bitcoin bases', function () {
    assert.strictEqual(
      resolveBitcoinClientAuthToken(settings, '/services/bitcoin'),
      'admin-secret'
    );
    assert.strictEqual(
      resolveBitcoinClientAuthToken(settings, 'http://127.0.0.1:8080/services/bitcoin'),
      'admin-secret'
    );
  });

  it('does not send hub admin token to explorer or payments URLs', function () {
    assert.strictEqual(
      resolveBitcoinClientAuthToken(settings, 'https://explorer.example/api'),
      'api-only'
    );
    assert.strictEqual(
      resolveBitcoinClientAuthToken(settings, 'https://payments.example/payments'),
      'api-only'
    );
  });
});
