'use strict';

const assert = require('assert');
const {
  HUB_BITCOIN_PRESETS,
  HUB_SETUP_APPLY_MIN_MS,
  applyBitcoinSetupToSettings,
  applyHubBitcoinRuntimeFromSetup,
  buildHubSetupInitialConfig,
  parseBitcoinSetupFromBody,
  parsePruneMib
} = require('../functions/hubBitcoinSetup');

describe('hubBitcoinSetup', function () {
  it('exposes a 2.5s minimum apply spinner', function () {
    assert.strictEqual(HUB_SETUP_APPLY_MIN_MS, 2500);
  });

  it('clamps invalid prune targets to Core’s 550 MiB minimum', function () {
    assert.strictEqual(parsePruneMib(0, 0), 0);
    assert.strictEqual(parsePruneMib(100, 0), 550);
    assert.strictEqual(parsePruneMib(5500, 0), 5500);
  });

  it('local-dev preset is Lopp-style regtest: no listen, txindex, no prune, no txrelay', function () {
    const parsed = parseBitcoinSetupFromBody({ BITCOIN_PRESET: 'local-dev' });
    assert.strictEqual(parsed.network, 'regtest');
    assert.strictEqual(parsed.listen, false);
    assert.strictEqual(parsed.txindex, true);
    assert.strictEqual(parsed.txrelay, false);
    assert.strictEqual(parsed.prune, 0);
    const settings = { bitcoin: {} };
    applyBitcoinSetupToSettings(settings, parsed);
    assert.strictEqual(settings.bitcoin.constraints.storage.size, 0);
    assert.strictEqual(settings.bitcoin.txrelay, false);
    assert.ok(settings.bitcoin.bitcoinExtraParams.includes('-blocksonly=1'));
    assert.ok(settings.bitcoin.bitcoinExtraParams.includes('-dbcache=450'));
    assert.ok(settings.bitcoin.bitcoinExtraParams.includes('-dnsseed=0'));
  });

  it('omits -blocksonly when transaction relay is on', function () {
    const parsed = parseBitcoinSetupFromBody({
      BITCOIN_PRESET: 'local-dev',
      BITCOIN_TXRELAY: true
    });
    assert.strictEqual(parsed.txrelay, true);
    const settings = { bitcoin: {} };
    applyBitcoinSetupToSettings(settings, parsed);
    assert.strictEqual(settings.bitcoin.txrelay, true);
    assert.ok(!settings.bitcoin.bitcoinExtraParams.includes('-blocksonly=1'));
  });

  it('forces full/txindex and txrelay when Lightning is enabled', function () {
    const parsed = parseBitcoinSetupFromBody({
      BITCOIN_PRESET: 'pruned',
      BITCOIN_PRUNE: 5500,
      LIGHTNING_MANAGED: true
    });
    assert.strictEqual(parsed.prune, 0);
    assert.strictEqual(parsed.txindex, true);
    assert.strictEqual(parsed.txrelay, true);
    const settings = { bitcoin: {} };
    applyBitcoinSetupToSettings(settings, parsed);
    assert.ok(!settings.bitcoin.bitcoinExtraParams.includes('-blocksonly=1'));
  });

  it('does not overlay Lopp knobs onto pre-knob STATE maps', function () {
    const settings = { bitcoin: { network: 'mainnet', listen: true, managed: true } };
    applyHubBitcoinRuntimeFromSetup(settings, {
      BITCOIN_NETWORK: 'mainnet',
      BITCOIN_MANAGED: true
    });
    assert.strictEqual(settings.bitcoin.network, 'mainnet');
    assert.strictEqual(settings.bitcoin.listen, true);
    assert.strictEqual(settings.bitcoin.bitcoinExtraParams, undefined);
  });

  it('keeps Core tx relay on for older STATE that never stored BITCOIN_TXRELAY', function () {
    const settings = { bitcoin: { network: 'regtest', managed: true } };
    applyHubBitcoinRuntimeFromSetup(settings, {
      BITCOIN_NETWORK: 'regtest',
      BITCOIN_MANAGED: true,
      BITCOIN_PRESET: 'local-dev',
      BITCOIN_LISTEN: false
    });
    assert.strictEqual(settings.bitcoin.txrelay, true);
    assert.ok(!settings.bitcoin.bitcoinExtraParams.includes('-blocksonly=1'));
  });

  it('buildHubSetupInitialConfig keeps API bootstrap compatible', function () {
    const cfg = buildHubSetupInitialConfig({
      NODE_NAME: 'Browser E2E Hub',
      BITCOIN_MANAGED: false,
      BITCOIN_HOST: '127.0.0.1',
      BITCOIN_RPC_PORT: '18443'
    });
    assert.strictEqual(cfg.NODE_NAME, 'Browser E2E Hub');
    assert.strictEqual(cfg.BITCOIN_MANAGED, false);
    assert.strictEqual(cfg.LIGHTNING_MANAGED, false);
    assert.strictEqual(cfg.BITCOIN_HOST, '127.0.0.1');
    assert.strictEqual(cfg.BITCOIN_TXRELAY, false);
    assert.strictEqual(cfg.IS_CONFIGURED, undefined);
    assert.ok(HUB_BITCOIN_PRESETS['local-dev']);
  });
});
