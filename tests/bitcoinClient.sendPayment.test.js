'use strict';

const assert = require('assert');
const { sendPayment } = require('../functions/bitcoinClient');

describe('bitcoinClient.sendPayment', function () {
  it('rejects when adminToken is missing (Hub wallet semantics)', async function () {
    await assert.rejects(
      async () => sendPayment(
        { paymentsBaseUrl: 'http://127.0.0.1:9' },
        { walletId: 'fabric-test' },
        { to: 'bcrt1qtest', amountSats: 1000, memo: '' }
      ),
      (err) => err instanceof Error && /Admin token is required/i.test(err.message)
    );
  });
});
