'use strict';

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const {
  buildPayjoinJoinmarketTaproot,
  buildPayjoinHubTaproot,
  buildPayjoinTaprootTemplate,
  generatePlaceholderFederationXOnly,
  resolveBeaconFederationXOnly,
  TEMPLATE_ID,
  HUB_TAPROOT_TEMPLATE_ID,
  JOINMARKET_TAPROOT_CONTRACT_VERSION,
  HUB_TAPROOT_CONTRACT_VERSION
} = require('../functions/payjoinJoinmarketTaproot');
const PayjoinService = require('../services/payjoin');

bitcoin.initEccLib(ecc);

describe('Hub-custody Taproot payjoin receive templates', () => {
  const op = Buffer.from(
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    'hex'
  );
  const fed = Buffer.from(generatePlaceholderFederationXOnly(), 'hex');

  it('legacy joinmarket_taproot_v1 still builds its script-path address', () => {
    const b = buildPayjoinJoinmarketTaproot({
      networkName: 'regtest',
      operatorPubkeyCompressed: op,
      federationXOnly: fed
    });
    assert.strictEqual(b.template, TEMPLATE_ID);
    assert.strictEqual(b.contractVersion, JOINMARKET_TAPROOT_CONTRACT_VERSION);
    assert.ok(/^bcrt1p/.test(b.address), 'regtest P2TR');
    assert.strictEqual(b.leafOrder.length, 2);
    assert.ok(b.leaves.joinmarket_operator.scriptHex.length > 0);
    assert.ok(b.leaves.beacon_federation_reserve.scriptHex.length > 0);
    assert.ok(!/joinmarket/i.test(b.label), 'label does not claim JoinMarket');
  });

  it('hub_taproot_v2 uses the operator key as internal key (key-path spendable)', () => {
    const b = buildPayjoinHubTaproot({
      networkName: 'regtest',
      operatorPubkeyCompressed: op,
      federationXOnly: fed
    });
    assert.strictEqual(b.template, HUB_TAPROOT_TEMPLATE_ID);
    assert.strictEqual(b.contractVersion, HUB_TAPROOT_CONTRACT_VERSION);
    assert.strictEqual(b.internalPubkeyHex, op.subarray(1).toString('hex'));
    assert.strictEqual(b.keyPath, 'hub_operator');
    assert.deepStrictEqual(b.leafOrder, ['beacon_federation_reserve']);
    const leaf = Buffer.from(b.leaves.beacon_federation_reserve.scriptHex, 'hex');
    const expected = bitcoin.payments.p2tr({
      internalPubkey: op.subarray(1),
      scriptTree: { output: leaf },
      network: bitcoin.networks.regtest
    });
    assert.strictEqual(b.address, expected.address);
    assert.notStrictEqual(b.address, buildPayjoinTaprootTemplate(TEMPLATE_ID, {
      networkName: 'regtest', operatorPubkeyCompressed: op, federationXOnly: fed
    }).address);
    assert.throws(() => buildPayjoinTaprootTemplate('nope', {}), /Unknown payjoin receive template/);
  });

  it('placeholder federation keys are random valid x-only points, never key 1', () => {
    const a = generatePlaceholderFederationXOnly();
    const b = generatePlaceholderFederationXOnly();
    assert.notStrictEqual(a, b);
    assert.ok(ecc.isXOnlyPoint(Buffer.from(a, 'hex')));
    const G = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    assert.notStrictEqual(a, G);
  });

  it('resolveBeaconFederationXOnly prefers explicit/config keys and uses the placeholder only off mainnet', () => {
    const placeholderHex = generatePlaceholderFederationXOnly();
    const configHex = generatePlaceholderFederationXOnly();
    assert.strictEqual(resolveBeaconFederationXOnly({ networkName: 'regtest', placeholderHex }).toString('hex'), placeholderHex);
    assert.strictEqual(resolveBeaconFederationXOnly({ networkName: 'regtest', configHex, placeholderHex }).toString('hex'), configHex);
    assert.throws(() => resolveBeaconFederationXOnly({ networkName: 'regtest' }), /placeholder/);
    assert.throws(
      () => resolveBeaconFederationXOnly({ networkName: 'mainnet', placeholderHex }),
      /Beacon federation x-only is required/
    );
  });

  it('PayjoinService generates one placeholder per Hub and saves it', async () => {
    const files = {};
    const fs = {
      readFile: (p) => (files[p] ? JSON.stringify(files[p]) : null),
      publish: async (p, v) => { files[p] = v; }
    };
    const key = { pubkey: op.toString('hex') };
    const a = new PayjoinService({ network: 'regtest', receiverContribution: false }).attach({ fs, key });
    await a.start();
    const s1 = await a.createDepositSession({ receiveTemplate: HUB_TAPROOT_TEMPLATE_ID, amountSats: 1000 });
    const saved = files['payjoin/federation-placeholder.json'];
    assert.ok(saved && /^[0-9a-f]{64}$/.test(saved.xOnlyHex));
    assert.strictEqual(s1.receiveContract.federationXOnlyHex, saved.xOnlyHex);
    assert.strictEqual(s1.receiveContract.placeholderFederationKey, true);
    assert.strictEqual(s1.receiveTemplate, HUB_TAPROOT_TEMPLATE_ID);

    const b = new PayjoinService({ network: 'regtest', receiverContribution: false }).attach({ fs, key });
    await b.start();
    const s2 = await b.createDepositSession({ receiveTemplate: TEMPLATE_ID, amountSats: 1000 });
    assert.strictEqual(s2.receiveContract.federationXOnlyHex, saved.xOnlyHex, 'reloaded, not regenerated');

    const main = new PayjoinService({ network: 'mainnet', receiverContribution: false }).attach({ fs: { readFile: () => null, publish: async () => {} }, key });
    await main.start();
    await assert.rejects(main.createDepositSession({ receiveTemplate: HUB_TAPROOT_TEMPLATE_ID }), /federation x-only is required/);
  });
});
