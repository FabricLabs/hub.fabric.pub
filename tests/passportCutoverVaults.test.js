'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { knownFederations, kindOf, table } = require('../scripts/passport-cutover-vaults');

describe('scripts/passport-cutover-vaults', function () {
  let store;

  beforeEach(function () {
    store = fs.mkdtempSync(path.join(os.tmpdir(), 'cutover-vaults-'));
    const dir = path.join(store, 'named-federations');
    fs.mkdirSync(dir);
    const member = { name: 'Crowdfund', network: 'regtest', threshold: 2, validators: ['a', 'b', 'c'] };
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ ids: ['aa'] }));
    fs.writeFileSync(path.join(dir, 'aa.json'), JSON.stringify({ id: 'aa', descriptor: member }));
    fs.writeFileSync(path.join(dir, 'mailbox.json'), JSON.stringify({
      frames: [],
      descriptors: {
        aa: member,
        bb: { name: 'G00N SQUAD Market order 0123', network: 'regtest', threshold: 2, validators: ['x', 'y', 'z'] }
      }
    }));
  });

  afterEach(function () {
    fs.rmSync(store, { recursive: true, force: true });
  });

  it('lists member federations and mailbox invites once each', function () {
    const found = knownFederations(store);
    assert.deepStrictEqual([...found.keys()].sort(), ['aa', 'bb']);
    assert.strictEqual(found.get('aa').source, 'member');
    assert.strictEqual(found.get('bb').source, 'invite');
    assert.strictEqual(kindOf(found.get('bb').descriptor), 'Market order');
  });

  it('returns nothing for a store without federations', function () {
    assert.strictEqual(knownFederations(path.join(store, 'missing')).size, 0);
  });

  it('renders a markdown row per vault with errors in place of balances', function () {
    const out = table([
      { kind: 'Market order', id: 'bb'.repeat(32), signers: '2-of-3', network: 'regtest', address: 'bcrt1q…', balanceSats: 5000, utxos: 1, error: null },
      { kind: 'Beacon vault', id: null, signers: null, network: null, address: null, balanceSats: null, utxos: null, error: 'fetch failed' }
    ]);
    assert.match(out, /\| Market order \| bbbbbbbbbbbb \| 2-of-3 \| regtest \| bcrt1q… \| 5000 \| 1 \|/);
    assert.match(out, /\| Beacon vault \| — \| — \| — \| — \| error: fetch failed \| — \|/);
  });
});
