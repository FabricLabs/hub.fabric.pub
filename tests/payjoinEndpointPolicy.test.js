'use strict';

const assert = require('assert');
const { checkPayjoinEndpoint, isPrivateHost } = require('../functions/payjoinEndpointPolicy');
const { parseBitcoinUriForPayjoin } = require('../functions/payjoinBrowserWallet');

describe('payjoinEndpointPolicy', function () {
  it('accepts https and http to .onion', function () {
    assert.ok(checkPayjoinEndpoint('https://pay.example/pj').ok);
    assert.ok(checkPayjoinEndpoint('http://abcdefghijklmnop.onion/pj').ok);
  });

  it('refuses userinfo (rust-payjoin #1896) and bad ports', function () {
    assert.match(checkPayjoinEndpoint('http://x.onion:1@evil.com/pj').error, /userinfo/);
    assert.match(checkPayjoinEndpoint('https://user@pay.example/pj').error, /userinfo/);
    assert.strictEqual(checkPayjoinEndpoint('https://pay.example:99999/pj').ok, false);
  });

  it('refuses plain http and other schemes on mainnet', function () {
    assert.match(checkPayjoinEndpoint('http://pay.example/pj').error, /https/);
    assert.match(checkPayjoinEndpoint('http://127.0.0.1:8080/pj', { allowInsecure: true }).error, /https/, 'allowInsecure never applies on mainnet');
    assert.strictEqual(checkPayjoinEndpoint('ftp://pay.example/pj').ok, false);
    assert.strictEqual(checkPayjoinEndpoint('javascript:alert(1)').ok, false);
  });

  it('refuses private hosts when the Hub dials', function () {
    for (const url of [
      'https://localhost/pj',
      'https://127.0.0.1/pj',
      'https://10.1.2.3/pj',
      'https://172.16.0.1/pj',
      'https://192.168.1.1/pj',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/pj',
      'https://[fd00::1]/pj',
      'https://[::ffff:127.0.0.1]/pj',
      'https://router/pj'
    ]) {
      assert.strictEqual(checkPayjoinEndpoint(url, { privateHosts: false }).ok, false, url);
      assert.strictEqual(checkPayjoinEndpoint(url).ok, true, `${url} is fine for a browser payer`);
    }
    assert.strictEqual(checkPayjoinEndpoint('https://pay.example/pj', { privateHosts: false }).ok, true);
  });

  it('off mainnet, allowInsecure permits http and local hosts', function () {
    assert.ok(checkPayjoinEndpoint('http://127.0.0.1:8080/pj', { networkName: 'regtest', allowInsecure: true, privateHosts: false }).ok);
    assert.strictEqual(checkPayjoinEndpoint('http://127.0.0.1:8080/pj', { networkName: 'regtest', privateHosts: false }).ok, false);
  });

  it('classifies hosts', function () {
    assert.strictEqual(isPrivateHost('8.8.8.8'), false);
    assert.strictEqual(isPrivateHost('100.64.0.1'), true);
    assert.strictEqual(isPrivateHost('pay.example'), false);
  });

  it('parseBitcoinUriForPayjoin applies the policy', function () {
    const addr = 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    const evil = `bitcoin:${addr}?amount=0.001&pj=${encodeURIComponent('http://x.onion:1@evil.com/pj')}`;
    assert.strictEqual(parseBitcoinUriForPayjoin(evil, { networkName: 'regtest' }), null);
    const local = `bitcoin:${addr}?amount=0.001&pj=${encodeURIComponent('http://127.0.0.1:8080/services/payjoin/sessions/s/proposals')}`;
    assert.ok(parseBitcoinUriForPayjoin(local, { networkName: 'regtest' }), 'regtest payer may use a local http Hub');
    assert.strictEqual(parseBitcoinUriForPayjoin(local, { networkName: 'mainnet' }), null);
  });
});
