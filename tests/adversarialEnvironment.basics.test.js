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
      identity: { xpub: 'tpubExample' },
      clientBalance: { balanceSats: 0 }
    };
    assert.strictEqual(shouldAutoFundDesktopLocalKey(Object.assign({}, base, { network: 'regtest' })), true);
    assert.strictEqual(shouldAutoFundDesktopLocalKey(Object.assign({}, base, { network: 'mainnet' })), false);
    assert.strictEqual(shouldAutoFundDesktopLocalKey(Object.assign({}, base, { network: 'signet' })), false);
  });

  it('documents that Hub faucet HTTP spend requires admin token (regtest)', function () {
    // Regression guard for shared-mode drain: handler checks verifyAdminToken before sendtoaddress.
    const src = require('fs').readFileSync(require('path').join(__dirname, '../services/hub.js'), 'utf8');
    assert.ok(/_handleBitcoinFaucetRequest[\s\S]*verifyAdminToken/.test(src));
    assert.ok(/Admin token required for faucet/.test(src));
  });
});
