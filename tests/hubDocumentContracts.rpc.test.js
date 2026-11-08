'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const {
  buildDocumentRevisionMessage,
  verifyDocumentProvenance
} = require('@fabric/core/functions/documentRevisions');
const Hub = require('../services/hub');
const documentContentKey = require('../functions/documentContentKey');

const TOKEN = 'operator-token';
const sha = (text) => crypto.createHash('sha256').update(Buffer.from(text)).digest('hex');
const b64 = (text) => Buffer.from(text).toString('base64');

describe('Hub editable documents (document contracts)', function () {
  this.timeout(60000);

  let hub;
  let methods;
  let fsStore;
  let relayed;
  let sentToPeer;

  before(async function () {
    hub = new Hub({
      debug: false,
      persistent: false,
      fs: { path: './stores/hub-test-doccontracts' },
      http: { hostname: 'localhost', interface: '127.0.0.1', port: 0 },
      bitcoin: { enable: false },
      payjoin: { enable: false }
    });
    methods = {};
    fsStore = new Map();
    relayed = [];
    sentToPeer = [];
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
      connections: { '127.0.0.1:9999': { _writeFabric: (buf) => sentToPeer.push(buf) } },
      _state: { peers: {} },
      knownPeers: [],
      _addressToId: {},
      relayFrom: (_origin, message) => { relayed.push(message); }
    };
    await hub.start();
    hub.setup.verifyAdminToken = (token) => token === TOKEN;
  });

  after(async function () {
    if (hub) await Promise.race([hub.stop(), new Promise((resolve) => setTimeout(resolve, 5000))]).catch(() => {});
  });

  async function create (text, name = 'note.txt') {
    const res = await methods.CreateDocument({ name, mime: 'text/plain', contentBase64: b64(text) });
    return res.document.id;
  }

  it('makes a document editable, keeping its earlier edits as revisions', async function () {
    const v1 = await create('draft one');
    await methods.PublishDocument(v1);
    const legacy = await methods.EditDocument({ id: v1, content: 'draft two' });
    assert.ok(legacy.document, JSON.stringify(legacy));
    const v2 = legacy.document.id;

    const refused = await methods.CreateDocumentContract({ id: v2 });
    assert.strictEqual(refused.status, 'error');

    const made = await methods.CreateDocumentContract({ id: v2, adminToken: TOKEN });
    assert.strictEqual(made.created, true, JSON.stringify(made));
    const contract = made.contract;
    assert.deepStrictEqual(contract.revisions.map((r) => r.documentIdentifier), [v1, v2]);
    assert.strictEqual(contract.editable, true);
    assert.ok(relayed.length >= 3, 'publish and revisions go to the mesh');

    const file = JSON.parse(fsStore.get(`documents/${v1}.json`));
    assert.strictEqual(file.contractId, contract.contractId);
    assert.strictEqual(file.revision, 1);
    const listed = hub._state.content.collections.documents[v2];
    assert.strictEqual(listed.contractId, contract.contractId);
    assert.strictEqual(listed.revision, 2);

    const same = await methods.CreateDocumentContract({ id: v1, adminToken: TOKEN });
    assert.strictEqual(same.created, false);
    assert.strictEqual(same.contract.contractId, contract.contractId);
  });

  it('records an edit as a signed revision and keeps the old version listed', async function () {
    const v1 = await create('chapter one');
    await methods.PublishDocument(v1);
    const { contract } = await methods.CreateDocumentContract({ id: v1, adminToken: TOKEN });

    const anonymous = await methods.EditDocument({ id: v1, content: 'chapter one, revised' });
    assert.strictEqual(anonymous.status, 'error');
    assert.match(anonymous.message, /Admin token/);

    const edited = await methods.EditDocument({ id: v1, content: 'chapter one, revised', note: 'tighter', adminToken: TOKEN });
    assert.strictEqual(edited.contractId, contract.contractId);
    assert.strictEqual(edited.contractRevision.revision, 2);
    assert.strictEqual(edited.contractRevision.note, 'tighter');
    const v2 = edited.document.id;
    const catalog = hub._state.content.collections.documents;
    assert.ok(catalog[v1] && catalog[v1].published, 'the old version stays listed');
    assert.ok(catalog[v2] && catalog[v2].published);

    const history = await methods.ListDocumentRevisions({ id: v1 });
    assert.strictEqual(history.contractId, contract.contractId);
    assert.deepStrictEqual(history.revisions.map((r) => r.documentIdentifier), [v1, v2]);
    assert.strictEqual(history.revision, 1);
    assert.strictEqual(history.head.documentIdentifier, v2);

    const view = await methods.GetDocumentContract({ id: v2, includeFrames: true });
    assert.strictEqual(view.contract.contractId, contract.contractId);
    assert.strictEqual(view.frames.length, 3);
    assert.ok(view.frames.every((f) => f.fabric.startsWith('fabric:')));
  });

  it('serves provenance of an old version that verifies offline and stops at that version', async function () {
    const v1 = await create('spec 1.0');
    await methods.PublishDocument(v1);
    await methods.CreateDocumentContract({ id: v1, adminToken: TOKEN });
    const e2 = await methods.EditDocument({ id: v1, content: 'spec 1.1', adminToken: TOKEN });
    await methods.EditDocument({ id: e2.document.id, content: 'spec 2.0', adminToken: TOKEN });

    const res = await methods.GetDocumentProvenance({ id: e2.document.id });
    assert.strictEqual(res.provenance.revision, 2);
    assert.strictEqual(res.provenance.collection.messages.length, 3);
    const checked = verifyDocumentProvenance(JSON.parse(JSON.stringify(res.provenance)), { documentIdentifier: sha('spec 1.1') });
    assert.strictEqual(checked.ok, true, checked.reason);

    const none = await methods.GetDocumentProvenance({ id: await create('no history') });
    assert.strictEqual(none.status, 'error');
  });

  it('keeps a priced version priced and sealed when it is edited', async function () {
    const v1 = await create('paid chapter');
    const priced = await methods.PublishDocument({ id: v1, purchasePriceSats: 2000, adminToken: TOKEN });
    assert.ok(!priced || priced.status !== 'error', JSON.stringify(priced));
    await methods.CreateDocumentContract({ id: v1, adminToken: TOKEN });
    const edited = await methods.EditDocument({ id: v1, content: 'paid chapter, second edition', adminToken: TOKEN });
    assert.ok(edited.document, JSON.stringify(edited));
    const v2 = edited.document.id;
    const listed = hub._state.content.collections.documents[v2];
    assert.strictEqual(listed.purchasePriceSats, 2000);
    assert.ok(documentContentKey.isSealedDocument(JSON.parse(fsStore.get(`documents/${v2}.json`))));
    assert.ok(edited.contractRevision.merkleRootHex, 'the revision commits to the sealed content');
    assert.strictEqual(hub._state.content.collections.documents[v1].purchasePriceSats, 2000, 'the old version keeps its price');
  });

  it('takes revision frames from another editor and refuses strangers', async function () {
    const coEditor = new Key();
    const v1 = await create('shared doc');
    await methods.PublishDocument(v1);
    const { contract } = await methods.CreateDocumentContract({ id: v1, adminToken: TOKEN, editors: [coEditor.pubkey] });
    const head = contract.head;

    const stranger = new Key();
    const forged = buildDocumentRevisionMessage({
      contract: contract.contractId,
      previous: head.frameId,
      document: { id: sha('stolen'), sha256: sha('stolen'), name: 'x', mime: 'text/plain' },
      revision: 2,
      previousDocumentIdentifier: v1,
      key: stranger
    });
    const refused = await methods.SubmitDocumentRevisionFrame({ fabric: `fabric:${forged.toBuffer().toString('hex')}` });
    assert.strictEqual(refused.status, 'error');

    const good = buildDocumentRevisionMessage({
      contract: contract.contractId,
      previous: head.frameId,
      document: { id: sha('shared doc v2'), sha256: sha('shared doc v2'), name: 'shared.txt', mime: 'text/plain' },
      revision: 2,
      previousDocumentIdentifier: v1,
      key: coEditor
    });
    const accepted = await methods.SubmitDocumentRevisionFrame({ fabric: good.toBuffer().toString('hex') });
    assert.strictEqual(accepted.accepted, true, JSON.stringify(accepted));
    const view = await methods.GetDocumentContract({ contractId: contract.contractId });
    assert.strictEqual(view.contract.head.documentIdentifier, sha('shared doc v2'));
    assert.strictEqual(view.contract.head.held, false, 'this Hub has the history, not the file');
  });

  it('sends a version with its provenance and lists its contract in inventory', async function () {
    const v1 = await create('handout');
    await methods.PublishDocument(v1);
    const { contract } = await methods.CreateDocumentContract({ id: v1, adminToken: TOKEN });
    const items = hub._collectLocalDocumentInventoryItems();
    const item = items.find((row) => row.id === v1);
    assert.strictEqual(item.contractId, contract.contractId);
    assert.strictEqual(item.revision, 1);

    sentToPeer.length = 0;
    const sent = hub._sendDocumentProvenanceToPeer('127.0.0.1:9999', v1);
    assert.strictEqual(sent, 2, 'publish + revision 1');
    assert.strictEqual(sentToPeer.length, 1);

    const buyer = { frames: [] };
    for (const m of hub.documentContracts.provenanceFor(v1).collection.messages) buyer.frames.push(m.hex);
    const kept = await hub._ingestDocumentProvenanceEnvelope({ object: { frames: buyer.frames } });
    assert.strictEqual(kept, 0, 'frames already held add nothing');
  });
});
