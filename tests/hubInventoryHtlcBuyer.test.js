'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoinjs = require('bitcoinjs-lib');
const Hub = require('../services/hub');
const Htlc = require('@fabric/core/types/htlc');
const documentContentKey = require('../functions/documentContentKey');

function memoryFs () {
  const files = new Map();
  return {
    files,
    readFile (p) { return files.has(p) ? JSON.stringify(files.get(p)) : null; },
    async publish (p, value) { files.set(p, JSON.parse(JSON.stringify(value))); }
  };
}

function bareHub (fs) {
  const hub = Object.create(Hub.prototype);
  hub.fs = fs;
  hub.setup = { verifyAdminToken: (t) => t === 'admin' };
  hub._inventoryHtlcById = new Map();
  return hub;
}

function boughtCopy (plaintext) {
  const sealed = documentContentKey.sealPlaintext(Buffer.from(plaintext));
  const doc = {
    id: 'doc1',
    name: 'paper.txt',
    mime: 'text/plain',
    contentBase64: sealed.ciphertext.toString('base64'),
    htlcFileV1: { v: 1, iv: sealed.encryption.iv, paymentHashHex: documentContentKey.paymentHashHexFromKey(sealed.key) }
  };
  return { doc, keyHex: sealed.key.toString('hex') };
}

describe('Inventory HTLC buyer and seller records', function () {
  it('keeps a revealed key only when it matches the delivered file, then opens the document', async function () {
    const fs = memoryFs();
    const hub = bareHub(fs);
    const { doc, keyHex } = boughtCopy('the secret paper');
    await fs.publish('documents/doc1.json', doc);

    assert.strictEqual(await hub._acceptHtlcKeyReveal({ documentId: 'doc1', preimageHex: crypto.randomBytes(32).toString('hex') }), false);
    assert.strictEqual((await hub._openPurchasedDocument({ id: 'doc1', adminToken: 'admin' })).status, 'error');

    assert.strictEqual(await hub._acceptHtlcKeyReveal({ documentId: 'doc1', preimageHex: keyHex }), true);
    assert.strictEqual(fs.files.get('documents/doc1.json').encryption.scheme, documentContentKey.SCHEME);
    assert.strictEqual((await hub._openPurchasedDocument({ id: 'doc1', adminToken: 'nope' })).status, 'error');
    const opened = await hub._openPurchasedDocument({ id: 'doc1', adminToken: 'admin' });
    assert.strictEqual(opened.status, 'success', opened.message);
    assert.strictEqual(Buffer.from(opened.document.contentBase64, 'base64').toString(), 'the secret paper');
  });

  it('holds a reveal that beats the file, and opens with a claim preimage when no reveal came', async function () {
    const fs = memoryFs();
    const hub = bareHub(fs);
    const { doc, keyHex } = boughtCopy('late file');
    assert.strictEqual(await hub._acceptHtlcKeyReveal({ documentId: 'doc1', preimageHex: keyHex }), false);
    assert.ok(hub._pendingHtlcReveals.has('doc1'));
    await fs.publish('documents/doc1.json', doc);
    assert.strictEqual(await hub._acceptHtlcKeyReveal(hub._pendingHtlcReveals.get('doc1').reveal), true);

    const fs2 = memoryFs();
    const hub2 = bareHub(fs2);
    const other = boughtCopy('from the claim');
    await fs2.publish('documents/doc1.json', other.doc);
    const opened = await hub2._openPurchasedDocument({ id: 'doc1', adminToken: 'admin', preimageHex: other.keyHex });
    assert.strictEqual(Buffer.from(opened.document.contentBase64, 'base64').toString(), 'from the claim');
  });

  it('saves seller settlements and never prunes a funded, unclaimed one', function () {
    const fs = memoryFs();
    const hub = bareHub(fs);
    const old = Date.now() - 1000 * 3600 * 24 * 30;
    hub._inventoryHtlcById.set('funded', { settlementId: 'funded', createdAt: old, fundedTxid: 'aa', fundedTxHex: '00' });
    hub._inventoryHtlcById.set('stale', { settlementId: 'stale', createdAt: old });
    hub._inventoryHtlcById.set('claimed', { settlementId: 'claimed', createdAt: old, fundedTxid: 'bb', claimTxid: 'cc' });
    hub._persistInventoryHtlcSettlements();

    const restarted = bareHub(fs);
    restarted._pruneInventoryHtlcSettlements();
    assert.deepStrictEqual([...restarted._inventoryHtlcById.keys()], ['funded']);
    assert.strictEqual(restarted._inventoryHtlcById.get('funded').fundedTxHex, '00');
  });

  it('refuses to deliver once too close to the refund lock to claim in time', async function () {
    const hub = bareHub(memoryFs());
    hub._loadInventoryHtlcSettlements = () => {};
    hub._inventoryHtlcById.set('s1', { settlementId: 's1', documentId: 'doc1', refundLockHeight: 200, paymentAddress: 'x', amountSats: 5000 });
    hub._getBitcoinService = () => ({ _makeRPCRequest: async () => 194 });
    hub._verifyL1Payment = async () => { throw new Error('must not verify'); };
    const r = await hub._confirmInventoryHtlcPayment({ settlementId: 's1', txid: 'aa' });
    assert.strictEqual(r.status, 'error');
    assert.match(r.message, /Too close to the refund lock/);
  });

  it('runs one claim per settlement at a time', async function () {
    const hub = bareHub(memoryFs());
    let calls = 0;
    hub._claimInventoryHtlcSettlementNow = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { status: 'success', claimTxid: 'cc' };
    };
    const [a, b] = await Promise.all([
      hub._claimInventoryHtlcSettlement({ settlementId: 's1' }),
      hub._claimInventoryHtlcSettlement({ settlementId: 's1' })
    ]);
    assert.strictEqual(calls, 1);
    assert.strictEqual(a, b);
    await hub._claimInventoryHtlcSettlement({ settlementId: 's1' });
    assert.strictEqual(calls, 2, 'a later claim runs again');
  });

  it('takes one payment for one sale when quotes share an address', async function () {
    const hub = bareHub(memoryFs());
    hub._loadInventoryHtlcSettlements = () => {};
    hub._inventoryHtlcById.set('s1', { settlementId: 's1', documentId: 'doc1', refundLockHeight: 300, paymentAddress: 'x', amountSats: 5000, status: 'FUNDED_PENDING_SEND', fundedTxid: 'aa' });
    hub._inventoryHtlcById.set('s2', { settlementId: 's2', documentId: 'doc1', refundLockHeight: 300, paymentAddress: 'x', amountSats: 5000 });
    hub._getBitcoinService = () => ({ _makeRPCRequest: async () => 194 });
    hub._l1PaymentVerificationDetail = async () => { throw new Error('must not verify'); };
    const r = await hub._confirmInventoryHtlcPayment({ settlementId: 's2', txid: 'aa' });
    assert.strictEqual(r.status, 'error');
    assert.match(r.message, /already paid for another settlement/);
    assert.ok(!hub._inventoryHtlcById.get('s2').fundedTxid);
  });

  it('sizes the claim fee from the fee estimate, within the sale', async function () {
    const hub = bareHub(memoryFs());
    let target = null;
    const node = (feerate, tip = 100) => ({
      _makeRPCRequest: async (method, params) => {
        if (method === 'getblockcount') return tip;
        if (method === 'estimatesmartfee') {
          target = params[0];
          return feerate == null ? { errors: ['Insufficient data or no feerate found'] } : { feerate, blocks: params[0] };
        }
        throw new Error(method);
      }
    });
    const s = { amountSats: 50000, refundLockHeight: 160 };
    assert.strictEqual(await hub._inventoryHtlcClaimFeeSats(node(null), s), 1000, 'no estimate: the old flat fee');
    assert.strictEqual(await hub._inventoryHtlcClaimFeeSats(node(0.0002), s), 3400, '20 sat/vB × 170 vB');
    assert.strictEqual(await hub._inventoryHtlcClaimFeeSats(node(0.00001), s), 170, 'never under 1 sat/vB');
    assert.strictEqual(await hub._inventoryHtlcClaimFeeSats(node(0.01), s), 50000 - 546, 'never more than the sale less dust');
    assert.strictEqual(await hub._inventoryHtlcClaimFeeSats(node(0.00001), s, { atLeast: 900 }), 900);
    assert.strictEqual(target, 20, 'a third of the 60 blocks left');
    await hub._inventoryHtlcClaimFeeSats(node(0.0001, 154), s);
    assert.strictEqual(target, 2, 'a shorter target as the lock nears');
  });

  describe('following a claim to its confirmation', function () {
    function claimHub ({ wallet = {}, mempool = true, tip = 100, broadcast = () => 'ok' } = {}) {
      const hub = bareHub(memoryFs());
      const calls = [];
      hub._getBitcoinService = () => ({
        walletName: 'w',
        _makeWalletRequest: async (method, params) => {
          if (method !== 'gettransaction') throw new Error(method);
          if (!(params[0] in wallet)) throw new Error('Invalid or non-wallet transaction id');
          return { confirmations: wallet[params[0]] };
        },
        _makeRPCRequest: async (method, params) => {
          calls.push(method);
          if (method === 'getmempoolentry') {
            if (!mempool) throw new Error('Transaction not in mempool');
            return {};
          }
          if (method === 'getblockcount') return tip;
          if (method === 'estimatesmartfee') return { errors: ['no data'] };
          if (method === 'sendrawtransaction') return broadcast(params[0]);
          throw new Error(method);
        }
      });
      const replaced = [];
      hub._claimInventoryHtlcSettlement = async (body) => {
        replaced.push(body);
        return { status: 'success' };
      };
      return { hub, calls, replaced };
    }
    const settlement = (extra = {}) => Object.assign({
      settlementId: 's1', amountSats: 20000, refundLockHeight: 200, fundedTxid: 'aa',
      claimTxid: 'c2', claimTxHex: '00', claimFeeSats: 1000, claimToWallet: true
    }, extra);

    it('marks a confirmed claim and stops following it', async function () {
      const { hub } = claimHub({ wallet: { c2: 3 } });
      const s = settlement();
      assert.strictEqual(await hub._recheckInventoryHtlcClaim(s), 'confirmed');
      assert.strictEqual(s.claimConfirmed, true);
      assert.strictEqual(hub._inventoryHtlcUnclaimed(s), false);
      assert.strictEqual(hub._inventoryHtlcUnclaimed(settlement()), true, 'kept from pruning until it confirms');
    });

    it('takes an earlier claim that confirmed over its replacement, and gives up after a refund', async function () {
      const raced = claimHub({ wallet: { c2: -1, c1: 2 } });
      const s = settlement({ claimTxidsEarlier: ['c1'] });
      assert.strictEqual(await raced.hub._recheckInventoryHtlcClaim(s), 'confirmed');
      assert.strictEqual(s.claimTxid, 'c1');
      const refunded = claimHub({ wallet: { c2: -1 } });
      const r = settlement();
      assert.strictEqual(await refunded.hub._recheckInventoryHtlcClaim(r), 'conflicted');
      assert.strictEqual(r.claimAbandoned, true);
    });

    it('rebroadcasts a dropped claim, and builds it again when that fails', async function () {
      const dropped = claimHub({ wallet: { c2: 0 }, mempool: false });
      assert.strictEqual(await dropped.hub._recheckInventoryHtlcClaim(settlement()), 'rebroadcast');
      assert.deepStrictEqual(dropped.replaced, []);
      const stale = claimHub({ wallet: { c2: 0 }, mempool: false, broadcast: () => { throw new Error('min relay fee not met'); } });
      assert.strictEqual(await stale.hub._recheckInventoryHtlcClaim(settlement()), 'reclaimed');
      assert.deepStrictEqual(stale.replaced, [{ settlementId: 's1', replace: true }]);
    });

    it('raises the fee near the refund lock, once a block', async function () {
      const far = claimHub({ wallet: { c2: 0 }, tip: 150 });
      assert.strictEqual(await far.hub._recheckInventoryHtlcClaim(settlement()), 'waiting');
      assert.deepStrictEqual(far.replaced, []);
      const near = claimHub({ wallet: { c2: 0 }, tip: 190 });
      const s = settlement();
      assert.strictEqual(await near.hub._recheckInventoryHtlcClaim(s), 'bumped');
      assert.deepStrictEqual(near.replaced, [{ settlementId: 's1', feeSats: 2170, replace: true }]);
      assert.strictEqual(await near.hub._recheckInventoryHtlcClaim(s), 'waiting', 'not again in the same block');
    });

    it('leaves alone a claim it cannot see', async function () {
      const { hub, replaced } = claimHub({ wallet: {}, mempool: false });
      assert.strictEqual(await hub._recheckInventoryHtlcClaim(settlement()), null);
      assert.deepStrictEqual(replaced, []);
    });
  });

  it('claims and refunds to a new Taproot address, else segwit, else the service default', async function () {
    const hub = bareHub(memoryFs());
    const asked = [];
    const wallet = (types) => ({
      walletName: 'w',
      _loadWallet: async () => {},
      _makeWalletRequest: async (method, params) => {
        asked.push(params[1]);
        if (!types.includes(params[1])) throw new Error('unsupported');
        return `${params[1]}-address`;
      },
      getUnusedAddress: async () => 'legacy-address'
    });
    assert.strictEqual(await hub._inventoryHtlcPayoutAddress(wallet(['bech32m', 'bech32'])), 'bech32m-address');
    assert.strictEqual(await hub._inventoryHtlcPayoutAddress(wallet(['bech32'])), 'bech32-address');
    assert.strictEqual(await hub._inventoryHtlcPayoutAddress(wallet([])), 'legacy-address');
    assert.deepStrictEqual(asked, ['bech32m', 'bech32m', 'bech32', 'bech32m', 'bech32']);
  });

  it('marks a paid purchase delivered when its key arrives', async function () {
    const fs = memoryFs();
    const hub = bareHub(fs);
    const { doc, keyHex } = boughtCopy('paid for');
    await fs.publish('documents/doc1.json', doc);
    hub._loadInventoryPurchases();
    hub._inventoryPurchases.set('s1', { settlementId: 's1', documentId: 'doc1', paymentHashHex: doc.htlcFileV1.paymentHashHex, status: 'PAID', paidAt: 1 });
    hub._inventoryPurchases.set('s0', { settlementId: 's0', documentId: 'doc1', paymentHashHex: 'ff', status: 'PAID', paidAt: 0 });
    hub._persistInventoryPurchases();
    assert.strictEqual(await hub._acceptHtlcKeyReveal({ documentId: 'doc1', preimageHex: keyHex }), true);
    const listed = bareHub(fs)._listInventoryPurchases({ adminToken: 'admin' }).purchases;
    assert.deepStrictEqual(listed.map((p) => [p.settlementId, p.status]), [['s1', 'DELIVERED'], ['s0', 'PAID']]);
  });

  describe('buyer payment and refund', function () {
    const sellerPub = Htlc.signerFromPriv32(crypto.randomBytes(32)).publicKey;
    const buyerPriv = crypto.randomBytes(32);
    const buyerPub = Htlc.signerFromPriv32(buyerPriv).publicKey;
    const paymentHash = crypto.randomBytes(32);

    function buyerHub (fs, chain) {
      const hub = bareHub(fs);
      hub.agent = {
        key: {
          public: { encodeCompressed: () => buyerPub.toString('hex') },
          keypair: { getPrivate: () => buyerPriv }
        }
      };
      const offers = {};
      hub._documentOffersMap = () => offers;
      hub._mergePersistedTxLabel = () => {};
      hub._hubWalletSend = async ({ address, amountSats }) => {
        const tx = new bitcoinjs.Transaction();
        tx.addInput(Buffer.alloc(32, 7), 0);
        tx.addOutput(bitcoinjs.address.toOutputScript(address, bitcoinjs.networks.regtest), BigInt(amountSats));
        chain.funding = tx.toHex();
        chain.paid.push({ address, amountSats });
        return tx.getId();
      };
      hub._getBitcoinService = () => ({
        network: 'regtest',
        _makeRPCRequest: async (method, args) => {
          if (method === 'getblockcount') return chain.tip;
          if (method === 'sendrawtransaction') {
            chain.sent.push(args[0]);
            return bitcoinjs.Transaction.fromHex(args[0]).getId();
          }
          throw new Error(`unexpected ${method}`);
        },
        _makeWalletRequest: async () => ({ hex: chain.funding }),
        getUnusedAddress: async () => 'bcrt1qglewuxkruds35a6xz0xj3egrykdugm3t0cp2mz'
      });
      return { hub, offers };
    }

    function quote (offers, { refundPubkey = buyerPub, lock = 200, amountSats = 5000, listed = 5000 } = {}) {
      const htlc = new Htlc({ network: 'regtest', claimPubkey: sellerPub, refundPubkey, paymentHash, refundLocktime: lock });
      offers.o1 = {
        id: 'o1',
        documentId: 'doc1',
        name: 'paper.txt',
        purchasePriceSats: listed,
        receivedAt: new Date().toISOString(),
        htlc: {
          settlementId: 's1',
          paymentAddress: htlc.address,
          paymentHashHex: paymentHash.toString('hex'),
          amountSats,
          refundLockHeight: lock,
          sellerPublicKeyHex: sellerPub.toString('hex')
        }
      };
    }

    it('pays only a quote refundable to this Hub, at the listed price, with time before the lock', async function () {
      const chain = { tip: 100, paid: [], sent: [] };
      const { hub, offers } = buyerHub(memoryFs(), chain);

      quote(offers, { refundPubkey: sellerPub });
      assert.match((await hub._payInventoryHtlc({ documentId: 'doc1', adminToken: 'admin' })).message, /not an HTLC this Hub can refund/);
      quote(offers, { amountSats: 9000 });
      assert.match((await hub._payInventoryHtlc({ documentId: 'doc1', adminToken: 'admin' })).message, /listing says 5000/);
      quote(offers, { lock: 105 });
      assert.match((await hub._payInventoryHtlc({ documentId: 'doc1', adminToken: 'admin' })).message, /too close/);
      quote(offers);
      assert.strictEqual((await hub._payInventoryHtlc({ documentId: 'doc1', adminToken: 'nope' })).status, 'error');
      assert.match((await hub._payInventoryHtlc({ documentId: 'doc1', adminToken: 'admin', maxSats: 4000 })).message, /over the 4000/);
      assert.strictEqual(chain.paid.length, 0);

      const paid = await hub._payInventoryHtlc({ documentId: 'doc1', adminToken: 'admin' });
      assert.strictEqual(paid.status, 'success', paid.message);
      assert.strictEqual(paid.purchase.status, 'PAID');
      assert.deepStrictEqual(chain.paid, [{ address: offers.o1.htlc.paymentAddress, amountSats: 5000 }]);
      const again = await hub._payInventoryHtlc({ settlementId: 's1', adminToken: 'admin' });
      assert.strictEqual(again.message, 'Already paid.');
      assert.strictEqual(chain.paid.length, 1);
    });

    it('refunds an undelivered purchase after the lock, from the record saved at payment', async function () {
      const chain = { tip: 100, paid: [], sent: [] };
      const fs = memoryFs();
      const { hub, offers } = buyerHub(fs, chain);
      quote(offers);
      await hub._payInventoryHtlc({ documentId: 'doc1', adminToken: 'admin' });

      const restarted = buyerHub(fs, chain).hub;
      const early = await restarted._refundInventoryHtlc({ settlementId: 's1', adminToken: 'admin' });
      assert.match(early.message, /opens at block 200; the tip is 100/);
      chain.tip = 200;
      const refunded = await restarted._refundInventoryHtlc({ settlementId: 's1', adminToken: 'admin' });
      assert.strictEqual(refunded.status, 'success', refunded.message);
      assert.strictEqual(chain.sent.length, 1);
      const tx = bitcoinjs.Transaction.fromHex(chain.sent[0]);
      assert.strictEqual(tx.locktime, 200);
      assert.strictEqual(tx.ins[0].witness.length, 3);
      assert.strictEqual(Buffer.from(tx.ins[0].hash).reverse().toString('hex'), bitcoinjs.Transaction.fromHex(chain.funding).getId());

      const listed = restarted._listInventoryPurchases({ adminToken: 'admin' });
      assert.strictEqual(listed.purchases[0].status, 'REFUNDED');
      assert.strictEqual(listed.purchases[0].fundedTxHex, undefined);
      assert.strictEqual((await restarted._refundInventoryHtlc({ settlementId: 's1', adminToken: 'admin' })).message, 'Already refunded.');
    });
  });
});
