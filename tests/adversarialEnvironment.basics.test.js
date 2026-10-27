'use strict';

/**
 * Basics tied to SECURITY.md § Adversarial environment.
 */

const assert = require('assert');
const {
  isAllowedFabricHub,
  assertAllowedFabricHub
} = require('../functions/fabricHubAllowlist');
const {
  isFaucetNetwork,
  buildFaucetServiceDescriptor,
  faucetFromOptionsDocument
} = require('../functions/bitcoinFaucetCapability');
const { shouldAutoFundDesktopLocalKey } = require('../functions/fundLocalKeyFromHubFaucet');

describe('adversarialEnvironment.basics (@fabric/hub)', function () {
  afterEach(function () {
    delete global.window;
  });

  it('rejects phishing hubs that try to solicit site-login completions', function () {
    assert.strictEqual(isAllowedFabricHub('https://evil.example'), false);
    assert.strictEqual(isAllowedFabricHub('https://hub.fabric.pub.evil.example'), false);
    assert.strictEqual(isAllowedFabricHub('https://attacker.invalid'), false);

    const bad = assertAllowedFabricHub('https://attacker.invalid/sessions');
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.error);
  });

  it('allows the Hub\'s own public origin and loopback by default', function () {
    assert.strictEqual(isAllowedFabricHub('https://hub.fabric.pub'), true);
    assert.strictEqual(isAllowedFabricHub('http://127.0.0.1:8080'), true);
    assert.strictEqual(isAllowedFabricHub('http://localhost:8080'), true);

    const ok = assertAllowedFabricHub('https://hub.fabric.pub/sessions');
    assert.strictEqual(ok.ok, true);
  });

  it('does not advertise regtest faucet on signet/mainnet (dev-only surface)', function () {
    assert.strictEqual(isFaucetNetwork('mainnet'), false);
    assert.strictEqual(isFaucetNetwork('signet'), false);
    assert.strictEqual(
      buildFaucetServiceDescriptor({ network: 'mainnet', bitcoinAvailable: true, balanceSats: 1e8 }),
      null
    );
    assert.strictEqual(
      buildFaucetServiceDescriptor({ network: 'signet', bitcoinAvailable: true, balanceSats: 1e8 }),
      null
    );
    // Hostile OPTIONS claiming a mainnet faucet must be ignored by clients.
    assert.strictEqual(faucetFromOptionsDocument({
      services: {
        faucet: {
          available: true,
          network: 'mainnet',
          endpointBasePath: '/services/bitcoin/faucet'
        }
      }
    }), null);
  });

  it('refuses desktop auto-faucet outside regtest', function () {
    global.window = {
      fabricDesktop: { isDesktopShell: true },
      sessionStorage: {
        getItem () { return null; },
        setItem () {}
      }
    };
    const base = {
      identity: { id: 'dev', wallet: { segwit: { xpub: 'tpubExample' } } },
      clientBalance: { balanceSats: 0 }
    };
    assert.strictEqual(shouldAutoFundDesktopLocalKey(Object.assign({}, base, { network: 'regtest' })), true);
    assert.strictEqual(shouldAutoFundDesktopLocalKey(Object.assign({}, base, { network: 'mainnet' })), false);
    assert.strictEqual(shouldAutoFundDesktopLocalKey(Object.assign({}, base, { network: 'signet' })), false);
  });

  it('open faucet is regtest-only and rate limited before any wallet spend', function () {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../services/hub.js'), 'utf8');
    const start = src.indexOf('_handleBitcoinFaucetRequest (req, res)');
    const handler = src.slice(start, src.indexOf('sendtoaddress', start));
    assert.ok(/network !== 'regtest'/.test(handler));
    assert.ok(/_faucetLimiter\.take/.test(handler));
  });

  it('faucet limiter caps per address and in total, then resets', function () {
    const { createFaucetLimiter } = require('../functions/bitcoinFaucetCapability');
    let t = 0;
    const limiter = createFaucetLimiter({ perAddress: 2, total: 3, windowMs: 1000, now: () => t });
    assert.strictEqual(limiter.take('a'), null);
    assert.strictEqual(limiter.take('a'), null);
    assert.ok(limiter.take('a'));
    assert.strictEqual(limiter.take('b'), null);
    assert.ok(limiter.take('c'));
    t = 1000;
    assert.strictEqual(limiter.take('a'), null);
  });
});
