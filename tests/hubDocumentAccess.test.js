'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Hub = require('../services/hub');
const documentContentKey = require('../functions/documentContentKey');

const TOKEN = 'operator-token';
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const b64 = (text) => Buffer.from(text).toString('base64');

describe('Hub document access', function () {
  this.timeout(60000);

  let hub;
  let methods;
  let fsStore;

  before(async function () {
    hub = new Hub({
      debug: false,
      persistent: false,
      fs: { path: './stores/hub-test-docaccess' },
      http: { hostname: 'localhost', interface: '127.0.0.1', port: 0 },
      bitcoin: { enable: false },
      payjoin: { enable: false }
    });
    methods = {};
    fsStore = new Map();
    hub.alert = async () => {};
    hub.commit = () => {};
    hub.trust = () => {};
    hub._addAllRoutes = () => {};
    hub.recordActivity = () => {};
    hub.contract = { id: 'test-contract', state: {}, deploy: () => {} };
    hub.fs = {
      start: async () => {},
      stop: async () => {},
      readFile: (name) => fsStore.has(name) ? fsStore.get(name) : null,
      writeFile: (name, value) => { fsStore.set(name, typeof value === 'string' ? value : JSON.stringify(value)); },
      publish: async (name, value) => { fsStore.set(name, typeof value === 'string' ? value : JSON.stringify(value)); },
      delete: (name) => { fsStore.delete(name); },
      addToChain: async () => true
    };
    hub.http = {
      on: () => {},
      removeListener: () => {},
      _registerMethod: (name, handler) => { methods[name] = handler; },
      _addRoute: () => {},
      _addAllRoutes: () => {},
      _handleCall: async () => ({}),
      broadcast: () => {},
      start: async () => {},
      stop: async () => {},
      agent: { listenAddress: '127.0.0.1:7777', listening: true },
      listenAddress: '127.0.0.1:8080',
      webrtcPeers: new Map()
    };
    hub.agent = {
      on: () => {},
      removeListener: () => {},
      start: async () => {},
      stop: async () => {},
      emit: () => {},
      identity: { id: 'agent-test-id' },
      key: hub._rootKey,
      listenAddress: '127.0.0.1:7777',
      connections: { '127.0.0.1:9999': {} },
      _state: { peers: {} },
      knownPeers: [],
      _addressToId: {},
      relayFrom: () => {}
    };
    await hub.start();
    hub.setup.verifyAdminToken = (token) => token === TOKEN;
  });

  after(async function () {
    if (hub) await Promise.race([hub.stop(), new Promise((resolve) => setTimeout(resolve, 5000))]).catch(() => {});
  });

  async function create (text) {
    const res = await methods.CreateDocument({ name: 'note.txt', mime: 'text/plain', contentBase64: b64(text) });
    return res.document.id;
  }

  async function sell (text, price = 2000) {
    const id = await create(text);
    const res = await methods.PublishDocument({ id, purchasePriceSats: price, adminToken: TOKEN });
    assert.ok(res.document && res.document.published, JSON.stringify(res));
    return id;
  }

  it('refuses document ids that would leave documents/', async function () {
    fsStore.set('bitcoin/inventory-htlc.json', JSON.stringify({ settlements: { s: { preimageHex: 'aa'.repeat(32) } } }));
    for (const id of ['../bitcoin/inventory-htlc', 'documents/../bitcoin/inventory-htlc', 'a/b', 'x.y']) {
      const res = await methods.GetDocument({ id });
      assert.strictEqual(res.document, null, id);
    }
  });

  it('names a created document by the hash of its content', async function () {
    const res = await methods.CreateDocument({ name: 'x', contentBase64: b64('forged'), sha256: '../bitcoin/inventory-htlc' });
    assert.strictEqual(res.status, 'error');
    const ok = await methods.CreateDocument({ name: 'x', contentBase64: b64('honest'), sha256: sha(Buffer.from('honest')) });
    assert.strictEqual(ok.document.id, sha(Buffer.from('honest')));
  });

  it('keeps a sealed listing when the same content is created again', async function () {
    const id = await sell('sealed once');
    const before = JSON.parse(fsStore.get(`documents/${id}.json`));
    assert.ok(documentContentKey.isSealedDocument(before));
    const again = await methods.CreateDocument({ name: 'again', contentBase64: b64('sealed once') });
    assert.strictEqual(again.existing, true);
    assert.strictEqual(again.document.contentBase64, undefined);
    assert.deepStrictEqual(JSON.parse(fsStore.get(`documents/${id}.json`)), before);
  });

  it('serves sealed ciphertext only to the operator', async function () {
    const id = await sell('ciphertext stays home');
    const visitor = await methods.GetDocument({ id });
    assert.strictEqual(visitor.document.contentBase64, undefined);
    assert.strictEqual(visitor.document.contentWithheld, true);
    const operator = await methods.GetDocument({ id, adminToken: TOKEN });
    assert.ok(operator.document.contentBase64);

    const freeId = await create('free for all');
    await methods.PublishDocument(freeId);
    const free = await methods.GetDocument({ id: freeId });
    assert.strictEqual(free.document.contentBase64, b64('free for all'));
  });

  it('leaves prices and existing listings to the operator', async function () {
    const id = await create('priced by whom');
    const priced = await methods.PublishDocument({ id, purchasePriceSats: 2000 });
    assert.strictEqual(priced.status, 'error');

    const freeId = await create('listed once');
    assert.ok((await methods.PublishDocument(freeId)).document);
    const relist = await methods.PublishDocument({ id: freeId, purchasePriceSats: 2000 });
    assert.strictEqual(relist.status, 'error');

    const sold = await sell('price cut attempt', 5000);
    const cut = await methods.SetDocumentPrice({ documentId: sold, purchasePriceSats: 800 });
    assert.strictEqual(cut.status, 'error');
    const operatorCut = await methods.SetDocumentPrice({ documentId: sold, purchasePriceSats: 800, adminToken: TOKEN });
    assert.strictEqual(operatorCut.purchasePriceSats, 800);
  });

  it('refuses prices too small to claim on chain', async function () {
    const id = await create('too cheap');
    const res = await methods.PublishDocument({ id, purchasePriceSats: 500, adminToken: TOKEN });
    assert.strictEqual(res.status, 'error');
    assert.match(res.message, /716/);
  });

  it('sends a sealed document to a peer only for the operator', async function () {
    const id = await sell('not for any peer');
    const res = await methods.SendPeerFile('127.0.0.1:9999', id);
    assert.strictEqual(res.status, 'error');
    assert.match(res.message, /Admin token/);
  });

  it('does not copy sealed ciphertext into a free revision', async function () {
    const id = await sell('no free revisions');
    const res = await methods.EditDocument({ id, name: 'renamed' });
    assert.strictEqual(res.status, 'error');
  });

  it('lets only the invoice holder claim a direct purchase, at the listed price or more', async function () {
    const id = (await methods.CreateDocument({ name: 'direct.txt', mime: 'text/plain', contentBase64: b64(`direct ${Date.now()}`) })).document.id;
    await methods.PublishDocument({ id, purchasePriceSats: 1200, adminToken: TOKEN });
    let n = 0;
    const paid = {};
    const getBitcoin = hub._getBitcoinService;
    const verify = hub._verifyL1Payment;
    hub._getBitcoinService = () => ({ network: 'regtest', getUnusedAddress: async () => `bcrt1qinvoice${n++}` });
    hub._verifyL1Payment = async (_b, txid, address, amountSats) => !!paid[txid] && paid[txid].address === address && paid[txid].sats >= amountSats;
    try {
      const cheap = await methods.CreatePurchaseInvoice({ documentId: id, amountSats: 1 });
      assert.strictEqual(cheap.amountSats, 1200, 'a buyer cannot name a lower price');
      const tip = await methods.CreatePurchaseInvoice({ documentId: id, amountSats: 1500 });
      assert.strictEqual(tip.amountSats, 1500);

      const first = await methods.CreatePurchaseInvoice({ documentId: id });
      const second = await methods.CreatePurchaseInvoice({ documentId: id });
      assert.notStrictEqual(first.address, second.address);
      paid.tx1 = { address: first.address, sats: 1200 };

      const stranger = await methods.ClaimPurchase({ documentId: id, txid: 'tx1' });
      assert.strictEqual(stranger.status, 'error', 'the public txid alone claims nothing');
      const wrong = await methods.ClaimPurchase({ documentId: id, txid: 'tx1', claimToken: second.claimToken });
      assert.strictEqual(wrong.status, 'error', 'another invoice\'s token does not cover this payment');

      const claimed = await methods.ClaimPurchase({ documentId: id, txid: 'tx1', claimToken: first.claimToken });
      assert.strictEqual(claimed.type, 'ClaimPurchaseResult', 'a later invoice does not orphan the first');
      const again = await methods.ClaimPurchase({ documentId: id, txid: 'tx1', claimToken: first.claimToken });
      assert.strictEqual(again.type, 'ClaimPurchaseResult', 'the buyer can open it again');

      const saved = JSON.parse(fsStore.get('bitcoin/purchase-invoices.json')).invoices;
      assert.ok(saved[first.invoiceId] && saved[first.invoiceId].claimedTxid === 'tx1');
      assert.ok(!JSON.stringify(saved).includes(first.claimToken), 'only a hash of the token is kept');
    } finally {
      hub._getBitcoinService = getBitcoin;
      hub._verifyL1Payment = verify;
    }
  });

  it('advertises only published documents to peers', async function () {
    const kept = (await methods.CreateDocument({ name: 'private.txt', mime: 'text/plain', contentBase64: b64('kept to myself') })).document.id;
    const listed = (await methods.CreateDocument({ name: 'public.txt', mime: 'text/plain', contentBase64: b64('for everyone') })).document.id;
    await methods.PublishDocument(listed);
    const hasBlob = hub._hasLocalDocumentBlob;
    hub._hasLocalDocumentBlob = () => true;
    const ids = hub._collectLocalDocumentInventoryItems().map((row) => row.id);
    hub._hasLocalDocumentBlob = hasBlob;
    assert.ok(ids.includes(listed));
    assert.ok(!ids.includes(kept));
  });

  it('keeps a quiet buyer\'s quote when another peer floods inventory requests', function () {
    hub._loadInventoryHtlcSettlements();
    const quotes = hub._inventoryHtlcById;
    quotes.clear();
    const now = Date.now();
    quotes.set('honest', { settlementId: 'honest', requesterConnection: '10.0.0.2:7777', requesterFabricId: 'id1buyer', createdAt: now - 60000 });
    quotes.set('paid', { settlementId: 'paid', requesterConnection: '10.0.0.9:7777', requesterFabricId: 'id1flood', fundedTxid: 'aa'.repeat(32), createdAt: now - 120000 });
    quotes.set('sold', { settlementId: 'sold', requesterConnection: '10.0.0.9:7777', requesterFabricId: 'id1flood', fundedTxid: 'bb'.repeat(32), claimTxid: 'cc'.repeat(32), createdAt: now - 180000 });
    for (let n = 0; n < 2100; n++) {
      quotes.set(`flood-${n}`, { settlementId: `flood-${n}`, requesterConnection: '10.0.0.9:7777', requesterFabricId: 'id1flood', createdAt: now + n });
    }
    for (let n = 0; n < 40; n++) {
      quotes.set(`relayed-${n}`, { settlementId: `relayed-${n}`, relayReturnHop: '10.0.0.5:7777', requesterFabricId: 'id1buyer', createdAt: now + n });
    }
    hub._pruneInventoryHtlcSettlements();
    assert.ok(quotes.has('honest'), 'the quiet buyer keeps its quote');
    assert.ok(quotes.has('paid'), 'a funded settlement is never evicted');
    assert.ok(quotes.has('sold'), 'a claimed sale outlives the unpaid quotes of the same peer');
    const flood = [...quotes.keys()].filter((k) => k.startsWith('flood-'));
    assert.strictEqual(flood.length, 512);
    assert.ok(quotes.has('flood-2099'), 'the newest quotes stay');
    assert.strictEqual([...quotes.keys()].filter((k) => k.startsWith('relayed-')).length, 40, 'a relayed claim of the same id is counted apart');
    quotes.clear();
  });

  it('claims delivered sales on its own and gives up on a spent coin', async function () {
    hub._loadInventoryHtlcSettlements();
    const quotes = hub._inventoryHtlcById;
    quotes.clear();
    quotes.set('delivered', { settlementId: 'delivered', status: 'COMPLETED', fundedTxid: 'aa'.repeat(32) });
    quotes.set('refunded', { settlementId: 'refunded', status: 'COMPLETED', fundedTxid: 'bb'.repeat(32) });
    quotes.set('undelivered', { settlementId: 'undelivered', status: 'FUNDED_PENDING_SEND', fundedTxid: 'cc'.repeat(32) });
    quotes.set('claimed', { settlementId: 'claimed', status: 'COMPLETED', fundedTxid: 'dd'.repeat(32), claimTxid: 'ee'.repeat(32) });
    const tried = [];
    const claim = hub._claimInventoryHtlcSettlement;
    hub._claimInventoryHtlcSettlement = async ({ settlementId }) => {
      tried.push(settlementId);
      if (settlementId === 'refunded') return { status: 'error', message: '[-25] bad-txns-inputs-missingorspent' };
      quotes.get(settlementId).claimTxid = 'ff'.repeat(32);
      return { status: 'success' };
    };
    try {
      await hub._claimDeliveredInventoryHtlcs();
      assert.deepStrictEqual(tried.sort(), ['delivered', 'refunded'], 'only delivered, unclaimed sales');
      assert.strictEqual(quotes.get('refunded').claimAbandoned, true);
      tried.length = 0;
      await hub._claimDeliveredInventoryHtlcs();
      assert.deepStrictEqual(tried, [], 'nothing left to claim');
    } finally {
      hub._claimInventoryHtlcSettlement = claim;
      quotes.clear();
    }
  });

  it('pages a catalog that outgrows one frame', async function () {
    const { MAX_FRAME_BYTES } = require('@fabric/core/constants');
    const items = Array.from({ length: 40 }, (_, n) => ({
      id: sha(Buffer.from(`listing-${n}`)),
      name: `listing-${n}.bin`,
      purchasePriceSats: 900,
      published: true,
      htlc: { paymentAddress: 'bcrt1p' + 'q'.repeat(58), scriptHex: 'ab'.repeat(500), amountSats: 900 }
    }));
    const payloads = hub._inventoryResponsePayloads('documents', items, 'buyer');
    assert.ok(payloads.length > 1);
    const inventoryId = payloads[0].object.inventoryId;
    assert.ok(inventoryId);
    payloads.forEach((p, i) => {
      assert.strictEqual(p.object.inventoryId, inventoryId);
      assert.strictEqual(p.object.page, i + 1);
      assert.strictEqual(p.object.pages, payloads.length);
      assert.ok(Buffer.byteLength(JSON.stringify(p)) < MAX_FRAME_BYTES);
    });
    const sent = payloads.flatMap((p) => p.object.items.map((item) => item.id));
    assert.deepStrictEqual(sent, items.map((item) => item.id));

    const sentFrames = [];
    const collect = hub._collectLocalDocumentInventoryItems;
    const send = hub._sendGenericFabricEnvelopeToPeer;
    const blocks = hub._getFabricMessages;
    hub._collectLocalDocumentInventoryItems = () => items;
    hub._sendGenericFabricEnvelopeToPeer = (_conn, payload) => { sentFrames.push(payload); };
    hub._getFabricMessages = () => [];
    try {
      await hub._fabricPeerResyncRespondToRequest('127.0.0.1:9', { requester: 'buyer' });
    } finally {
      hub._collectLocalDocumentInventoryItems = collect;
      hub._sendGenericFabricEnvelopeToPeer = send;
      hub._getFabricMessages = blocks;
    }
    const catalog = sentFrames.filter((p) => p.object && p.object.kind === 'documents' && p.object.items);
    assert.ok(catalog.length > 1, 'a resync of this catalog takes more than one frame');
    catalog.forEach((p) => {
      assert.strictEqual(p.object.fabricResync, true);
      assert.ok(Buffer.byteLength(JSON.stringify(p)) < MAX_FRAME_BYTES);
    });
    assert.deepStrictEqual(
      catalog.flatMap((p) => p.object.items.map((item) => item.id)),
      items.map((item) => item.id)
    );

    const small = hub._inventoryResponsePayloads('documents', items.slice(0, 2), 'buyer');
    assert.strictEqual(small.length, 1);
    assert.strictEqual(small[0].object.inventoryId, undefined);
    assert.strictEqual(hub._inventoryResponsePayloads('documents', [], 'buyer')[0].object.items.length, 0);

    const { LEGACY_MAX_FRAME_BYTES } = require('@fabric/core/constants');
    hub.agent.connections['10.0.0.7:7777'] = { _fabricRemoteMaxFrameBytes: LEGACY_MAX_FRAME_BYTES };
    try {
      const legacy = hub._inventoryResponsePayloads('documents', items.slice(0, 6), 'buyer', '10.0.0.7:7777');
      assert.ok(legacy.length >= 3, 'an older peer gets smaller pages');
      legacy.forEach((p) => assert.ok(Buffer.byteLength(JSON.stringify(p)) < LEGACY_MAX_FRAME_BYTES - 208));
    } finally {
      delete hub.agent.connections['10.0.0.7:7777'];
    }
  });

  it('never drops a paid direct-purchase invoice to make room', async function () {
    const invoices = hub._loadPurchaseInvoices();
    const saved = { ...invoices };
    for (const k of Object.keys(invoices)) delete invoices[k];
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    for (let n = 0; n < 5000; n++) {
      invoices[`inv${n}`] = { invoiceId: `inv${n}`, address: `addr${n}`, createdAt: n < 3 ? old : new Date().toISOString() };
    }
    const received = { addr0: 0.00001200 };
    const bitcoin = {
      walletName: 'w',
      _makeWalletRequest: async (method, params) => {
        assert.strictEqual(method, 'getreceivedbyaddress');
        return received[params[0]] || 0;
      }
    };
    hub._purchaseInvoiceTimes = [];
    try {
      assert.strictEqual(await hub._makeRoomForPurchaseInvoice(bitcoin), null);
      assert.ok(invoices.inv0, 'an invoice whose address received coins stays');
      assert.ok(!invoices.inv1, 'an old unpaid invoice makes room');
      assert.ok(invoices.inv3, 'a recent invoice stays');

      invoices.inv1 = { invoiceId: 'inv1', address: 'addr1', createdAt: new Date().toISOString() };
      invoices.inv2 = { invoiceId: 'inv2', address: 'addr2', createdAt: new Date().toISOString() };
      assert.match(await hub._makeRoomForPurchaseInvoice(bitcoin), /Too many open purchase invoices/);
      assert.ok(invoices.inv0);

      for (const k of Object.keys(invoices)) delete invoices[k];
      hub._purchaseInvoiceTimes = [];
      for (let n = 0; n < 60; n++) assert.strictEqual(await hub._makeRoomForPurchaseInvoice(bitcoin), null);
      assert.match(await hub._makeRoomForPurchaseInvoice(bitcoin), /this minute/);
    } finally {
      for (const k of Object.keys(invoices)) delete invoices[k];
      Object.assign(invoices, saved);
      hub._purchaseInvoiceTimes = [];
    }
  });

  it('keeps documents within the operator\'s disk allocation', async function () {
    const getSetting = hub.setup.getSetting;
    hub.setup.getSetting = (name) => name === 'DISK_ALLOCATION_MB' ? 1 : getSetting.call(hub.setup, name);
    hub._documentBytes = { at: Date.now(), used: 0 };
    try {
      const big = Buffer.alloc(600 * 1024, 7).toString('base64');
      const first = await methods.CreateDocument({ name: 'a.bin', contentBase64: big, size: 1 });
      assert.strictEqual(first.document.size, 600 * 1024, 'the size is the bytes received, not the size claimed');
      const second = await methods.CreateDocument({ name: 'b.bin', contentBase64: Buffer.alloc(600 * 1024, 8).toString('base64') });
      assert.strictEqual(second.status, 'error');
      assert.match(second.message, /DISK_ALLOCATION_MB/);
    } finally {
      hub.setup.getSetting = getSetting;
      hub._documentBytes = null;
    }
  });

  it('limits files peers push without being asked', function () {
    hub._incomingFileLog = [];
    hub._loadInventoryPurchases();
    hub._inventoryPurchases.set('bought', { documentId: 'wanted', status: 'PAID' });
    const MiB = 1024 * 1024;
    try {
      for (let n = 0; n < 8; n++) assert.ok(hub._admitIncomingFile(`junk${n}`, 8 * MiB, '10.0.0.66:7777'));
      assert.ok(!hub._admitIncomingFile('junk8', 8 * MiB, '10.0.0.66:40001'), 'a new port on the same host shares its budget');
      assert.ok(hub._admitIncomingFile('wanted', 8 * MiB, '10.0.0.66:7777'), 'a file this Hub paid for always gets in');
      assert.ok(hub._admitIncomingFile('other', 8 * MiB, '10.0.0.67:7777'), 'other hosts keep theirs');
      for (let n = 0; n < 23; n++) hub._admitIncomingFile(`more${n}`, 8 * MiB, `10.0.1.${n}:7777`);
      assert.ok(!hub._admitIncomingFile('last', 8 * MiB, '10.0.2.1:7777'), 'the total is capped too');
    } finally {
      hub._inventoryPurchases.delete('bought');
      hub._incomingFileLog = [];
    }
  });
});
