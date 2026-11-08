'use strict';

const assert = require('assert');
const fv = require('../functions/federationView');

const A = '02' + 'a'.repeat(64);
const B = '03' + 'b'.repeat(64);
const C = '02' + 'c'.repeat(64);

function view (extra) {
  return Object.assign({
    id: 'f'.repeat(64),
    name: 'Ops',
    network: 'regtest',
    threshold: 2,
    validators: [A, B, C],
    publisher: A,
    self: A,
    vaultAddress: 'bcrt1qvault',
    utxos: [{ txid: '1'.repeat(64), vout: 0, sats: 70000 }, { txid: '2'.repeat(64), vout: 1, sats: 30000 }],
    members: [{ pubkey: A, alias: 'hub', url: 'https://a.example', status: 'accepted' }, { pubkey: B, alias: 'bee', status: 'pending' }],
    withdrawals: []
  }, extra || {});
}

describe('federationView', function () {
  it('normalizes keys and labels', function () {
    assert.strictEqual(fv.xOnly(A), 'a'.repeat(64));
    assert.strictEqual(fv.xOnly('A'.repeat(64)), 'a'.repeat(64));
    assert.ok(fv.sameKey(B, 'b'.repeat(64)));
    assert.ok(!fv.sameKey('', ''));
    assert.strictEqual(fv.shortId('abcdef0123456789'), 'abcdef012345…');
    assert.strictEqual(fv.shortId(''), '—');
    assert.strictEqual(fv.shortKey(A), `${A.slice(0, 10)}…${A.slice(-6)}`);
    assert.strictEqual(fv.thresholdLabel(view()), '2 of 3');
    assert.strictEqual(fv.federationHref(view()), `/federations/${'f'.repeat(64)}`);
    assert.strictEqual(fv.federationHref('abc'), '/federations/abc');
  });

  it('reads signers from validators, the descriptor, or a proposed policy', function () {
    assert.deepStrictEqual(fv.signerList({ descriptor: { validators: [A] } }), [A]);
    assert.deepStrictEqual(fv.signerList({ proposedPolicy: { validators: [B] } }), [B]);
    assert.deepStrictEqual(fv.signerList(null), []);
    assert.ok(fv.isSignerKey(view(), 'c'.repeat(64)));
    assert.ok(!fv.isSignerKey(view(), '02' + 'd'.repeat(64)));
  });

  it('marks the publisher, the Hub, and the reader among signers', function () {
    const rows = fv.signerRows(view(), 'b'.repeat(64));
    assert.deepStrictEqual(rows.map((r) => [r.index, r.alias, r.publisher, r.hub, r.you]), [
      [0, 'hub', true, true, false],
      [1, 'bee', false, false, true],
      [2, null, false, false, false]
    ]);
    assert.strictEqual(rows[0].url, 'https://a.example');
  });

  it('lists the current vault, then earlier vaults with coins', function () {
    const rows = fv.vaultRows(view({
      previous: [{ id: 'e'.repeat(64), vaultAddress: 'bcrt1qold', threshold: 1, validators: [A, B], utxos: [{ sats: 5000 }] }]
    }));
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual([rows[0].current, rows[0].balanceSats, rows[0].coins.length, rows[0].threshold], [true, 100000, 2, '2 of 3']);
    assert.deepStrictEqual([rows[1].current, rows[1].address, rows[1].balanceSats, rows[1].threshold], [false, 'bcrt1qold', 5000, '1 of 2']);
    assert.strictEqual(fv.vaultRows(view({ balanceSats: 7, utxos: null }))[0].balanceSats, 7);
  });

  it('reads a GoonCitizen group wallet (address, keys, previous)', function () {
    const wallet = {
      groupId: 'g1',
      federationId: 'f'.repeat(64),
      address: 'bcrt1qgroup',
      threshold: 2,
      keys: [A, B, C],
      previous: [{ federationId: 'e'.repeat(64), address: 'bcrt1qold', threshold: 2, keys: [A, B] }]
    };
    const rows = fv.vaultRows(wallet);
    assert.deepStrictEqual(rows.map((r) => [r.address, r.current, r.threshold, r.signers, r.federationId]), [
      ['bcrt1qgroup', true, '2 of 3', 3, 'f'.repeat(64)],
      ['bcrt1qold', false, '2 of 2', 2, 'e'.repeat(64)]
    ]);
    assert.ok(fv.isSignerKey(wallet, 'c'.repeat(64)));
  });

  it('counts withdrawal signatures and who may still sign', function () {
    const v = view({
      withdrawals: [
        { requestId: 'r1', amountSats: 1000, feeSats: 100, signers: ['a'.repeat(64)], status: 'pending' },
        { requestId: 'r2', amountSats: 2000, feeSats: 100, signers: ['a'.repeat(64), 'b'.repeat(64)], status: 'broadcast', txid: '9'.repeat(64) },
        { requestId: 'r3', amountSats: 3000, feeSats: 100, signers: [], status: 'declined' }
      ]
    });
    const asB = fv.withdrawalRows(v, B);
    assert.deepStrictEqual(asB.map((w) => [w.requestId, w.progress, w.ready, w.signedByViewer, w.canSign]), [
      ['r1', '1 of 2', false, false, true],
      ['r2', '2 of 2', true, true, false],
      ['r3', '0 of 2', false, false, false]
    ]);
    assert.strictEqual(fv.withdrawalRows(v, A)[0].canSign, false, 'already signed');
    assert.strictEqual(fv.withdrawalRows(v, '02' + 'd'.repeat(64))[0].canSign, false, 'not a signer');
    assert.strictEqual(fv.withdrawalRows(v)[0].canSign, false, 'no key');
  });

  it('summarizes a federation for list rows', function () {
    const s = fv.federationSummary(view({ withdrawals: [{ status: 'pending' }, { status: 'broadcast', txid: 'x' }], viewer: { role: 'member' } }));
    assert.strictEqual(s.title, 'Ops');
    assert.strictEqual(s.threshold, '2 of 3');
    assert.strictEqual(s.signers, 3);
    assert.strictEqual(s.balanceSats, 100000);
    assert.strictEqual(s.openWithdrawals, 1);
    assert.strictEqual(s.href, `/federations/${'f'.repeat(64)}`);
    assert.deepStrictEqual(s.viewer, { role: 'member' });
    assert.strictEqual(fv.federationSummary({ id: 'abcdef0123456789' }).title, 'abcdef012345…');
  });
});
