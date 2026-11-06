'use strict';

const assert = require('assert');
const Hub = require('../services/hub');

function bareHub (network, settingsNetwork) {
  const hub = Object.create(Hub.prototype);
  hub.bitcoin = network ? { network } : null;
  hub.settings = { bitcoin: settingsNetwork ? { network: settingsNetwork } : {} };
  hub.setup = { verifyAdminToken: (t) => t === 'admin' };
  return hub;
}

describe('Priced document sales on mainnet', function () {
  it('are refused on mainnet and allowed on test networks', function () {
    for (const net of ['mainnet', 'main', 'bitcoin', 'livenet']) {
      assert.match(bareHub(net)._documentSalesRefusal(), /not available on mainnet/);
    }
    assert.match(bareHub(null, 'mainnet')._documentSalesRefusal(), /not available on mainnet/);
    for (const net of ['regtest', 'signet', 'testnet', 'playnet']) {
      assert.strictEqual(bareHub(net)._documentSalesRefusal(), null);
    }
  });

  it('refuses to pay an inventory HTLC or build an offer escrow on mainnet', async function () {
    const hub = bareHub('mainnet');
    const paid = await hub._payInventoryHtlc({ adminToken: 'admin', settlementId: 's1' });
    assert.strictEqual(paid.status, 'error');
    assert.match(paid.message, /not available on mainnet/);

    const escrow = bareHub('regtest')._buildDocumentOfferEscrow({ networkName: 'mainnet' });
    assert.strictEqual(escrow.status, 'error');
    assert.match(escrow.message, /not available on mainnet/);
  });

  it('attaches no HTLC to inventory items on mainnet', async function () {
    const items = [{ id: 'doc1' }];
    const out = await bareHub('mainnet')._attachHtlcToInventoryItems(items, { object: { buyerRefundPublicKey: '02'.padEnd(66, '1') } });
    assert.strictEqual(out, items);
    assert.strictEqual(out[0].htlc, undefined);
  });
});
