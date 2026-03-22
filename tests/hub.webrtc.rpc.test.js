'use strict';

const assert = require('assert');
const Hub = require('../services/hub');

describe('Hub WebRTC RPC methods', function () {
  this.timeout(120000);

  async function createStartedHubHarness () {
    const hub = new Hub({
      debug: false,
      persistent: false,
      fs: { path: './stores/hub-test' },
      http: { hostname: 'localhost', interface: '127.0.0.1', port: 0 },
      bitcoin: { enable: false },
      payjoin: { enable: false }
    });

    const methods = {};
    const broadcasts = [];
    const published = [];
    const chainUpdates = [];
    const agentHandlers = {};
    const fsStore = new Map();

    hub.alert = async () => {};
    hub.commit = () => {};
    hub.trust = () => {};
    hub._addAllRoutes = () => {};
    hub.recordActivity = () => {};

    hub.contract = {
      id: 'test-contract',
      state: {},
      deploy: () => {}
    };

    hub.fs = {
      start: async () => {},
      stop: async () => {},
      readFile: (name) => fsStore.has(name) ? fsStore.get(name) : null,
      publish: async (name, value) => {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        fsStore.set(name, serialized);
        published.push({ name, value });
      },
      addToChain: async (message) => {
        chainUpdates.push(message);
        return true;
      }
    };

    const webrtcPeers = new Map();
    const relayP2pCalls = [];

    hub.http = {
      on: () => {},
      removeListener: () => {},
      _registerMethod: (name, handler) => { methods[name] = handler; },
      _addRoute: () => {},
      _addAllRoutes: () => {},
      _handleCall: async () => ({}),
      broadcast: (msg) => { broadcasts.push(msg); },
      start: async () => {},
      stop: async () => {},
      agent: {
        listenAddress: '127.0.0.1:7777',
        listening: true
      },
      listenAddress: '127.0.0.1:8080',
      webrtcPeers
    };

    Object.defineProperty(hub.http, 'webrtcPeerList', {
      enumerable: true,
      get: () => Array.from(webrtcPeers.values())
    });

    hub.agent = {
      on: (event, handler) => { agentHandlers[event] = handler; },
      removeListener: () => {},
      start: async () => {},
      stop: async () => {},
      emit: () => {},
      identity: { id: 'agent-test-id' },
      key: hub._rootKey,
      listenAddress: '127.0.0.1:7777',
      connections: {},
      _state: { peers: {} },
      knownPeers: [],
      _addressToId: {},
      relayFrom: (tag, msg) => { relayP2pCalls.push({ tag, msg }); }
    };

    await hub.start();
    return { hub, methods, broadcasts, published, chainUpdates, agentHandlers, fsStore, relayP2pCalls };
  }

  let harness;

  before(async function () {
    harness = await createStartedHubHarness();
  });

  after(async function () {
    this.timeout(8000);
    if (harness && harness.hub) {
      await Promise.race([
        harness.hub.stop(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('hub.stop() timeout')), 7000))
      ]).catch(() => {});
    }
  });

  beforeEach(function () {
    harness.broadcasts.length = 0;
    harness.published.length = 0;
    harness.chainUpdates.length = 0;
    harness.relayP2pCalls.length = 0;
    if (harness.hub._webrtcRelayRate && typeof harness.hub._webrtcRelayRate.clear === 'function') {
      harness.hub._webrtcRelayRate.clear();
    }
    harness.hub.http.webrtcPeers.clear();
    harness.hub._state.documents = {};
    harness.hub._state.content.collections = harness.hub._state.content.collections || {};
    harness.hub._state.content.collections.documents = {};
    harness.hub._state.content.collections.messages = {};
    harness.hub._state.content.collections.contracts = {};
    harness.hub._state.content.counts = harness.hub._state.content.counts || {};
    harness.hub._state.content.counts.messages = 0;
  });

  it('RelayFromWebRTC fans out P2P_RELAY and respects hop limit', async function () {
    const { methods, broadcasts, relayP2pCalls } = harness;
    assert.ok(methods.RelayFromWebRTC, 'RelayFromWebRTC should be registered');

    const base = {
      fromPeerId: 'webrtc-peer-a',
      envelope: {
        original: JSON.stringify({ type: 'P2P_CHAT_MESSAGE', hello: 'world' }),
        originalType: 'P2P_CHAT_MESSAGE',
        hops: []
      }
    };

    const ok = methods.RelayFromWebRTC(base);
    assert.strictEqual(ok.status, 'success');
    assert.strictEqual(broadcasts.length, 1, 'should broadcast to WebSocket clients');
    assert.strictEqual(relayP2pCalls.length, 1, 'should relay to Fabric P2P');

    const tooManyHops = {
      fromPeerId: 'webrtc-peer-a',
      envelope: {
        original: '{}',
        originalType: 'P2P_CHAT_MESSAGE',
        hops: Array.from({ length: 40 }, (_, i) => ({ from: `p${i}`, at: 0 }))
      }
    };
    const denied = methods.RelayFromWebRTC(tooManyHops);
    assert.strictEqual(denied.status, 'error');
    assert.ok(/hop limit/i.test(denied.message));
  });

  it('RelayFromWebRTC rate-limits per fromPeerId', function () {
    const { methods } = harness;
    let errors = 0;
    for (let i = 0; i < 52; i++) {
      const r = methods.RelayFromWebRTC({
        fromPeerId: 'rate-test-peer',
        envelope: { original: `{"i":${i}}`, originalType: 'P2P_CHAT_MESSAGE', hops: [] }
      });
      if (r.status === 'error' && /rate limit/i.test(r.message)) errors++;
    }
    assert.ok(errors >= 1, 'should reject relay after burst over default per-second cap');
  });

  it('registers peers and lists candidates excluding self', async function () {
    const { methods } = harness;

    assert.ok(methods.RegisterWebRTCPeer, 'RegisterWebRTCPeer should be registered');
    assert.ok(methods.ListWebRTCPeers, 'ListWebRTCPeers should be registered');

    const r1 = methods.RegisterWebRTCPeer({
      peerId: 'fabric-bridge-a',
      metadata: { userAgent: 'UA-A' }
    });
    const r2 = methods.RegisterWebRTCPeer({
      peerId: 'fabric-bridge-b',
      metadata: { userAgent: 'UA-B' }
    });

    assert.strictEqual(r1.status, 'success');
    assert.strictEqual(r2.status, 'success');

    const listed = methods.ListWebRTCPeers({ excludeSelf: true, peerId: 'fabric-bridge-a' });
    assert.strictEqual(listed.type, 'ListWebRTCPeersResult');
    assert.ok(Array.isArray(listed.peers));
    assert.strictEqual(listed.peers.some((p) => p.id === 'fabric-bridge-a'), false);
    assert.strictEqual(listed.peers.some((p) => p.id === 'fabric-bridge-b'), true);

  });

  it('prunes stale peer registrations and returns freshest peers first', async function () {
    const { methods, hub } = harness;
    const now = Date.now();

    methods.RegisterWebRTCPeer({ peerId: 'fresh-a', metadata: { userAgent: 'UA-A' } });
    methods.RegisterWebRTCPeer({ peerId: 'fresh-b', metadata: { userAgent: 'UA-B' } });

    // Simulate one stale, disconnected browser registration.
    hub.http.webrtcPeers.set('stale-peer', {
      id: 'stale-peer',
      status: 'registered',
      connectedAt: now - (20 * 60 * 1000),
      registeredAt: now - (20 * 60 * 1000),
      lastSeen: now - (20 * 60 * 1000),
      metadata: {}
    });

    // Force deterministic recency order between fresh peers.
    const peerA = hub.http.webrtcPeers.get('fresh-a');
    const peerB = hub.http.webrtcPeers.get('fresh-b');
    peerA.lastSeen = now - 1000;
    peerB.lastSeen = now;
    hub.http.webrtcPeers.set('fresh-a', peerA);
    hub.http.webrtcPeers.set('fresh-b', peerB);

    const listed = methods.ListWebRTCPeers({ excludeSelf: true, peerId: 'fresh-a' });
    assert.strictEqual(listed.type, 'ListWebRTCPeersResult');
    assert.strictEqual(listed.peers.some((p) => p.id === 'stale-peer'), false, 'stale peers should be pruned');
    assert.ok(listed.peers.length >= 1, 'expected at least one candidate');
    assert.strictEqual(listed.peers[0].id, 'fresh-b', 'freshest peer should be returned first');
  });

  it('caps candidate list size to prevent oversized peer fanout', async function () {
    const { methods } = harness;

    methods.RegisterWebRTCPeer({ peerId: 'self-peer', metadata: {} });
    for (let i = 0; i < 30; i++) {
      methods.RegisterWebRTCPeer({ peerId: `candidate-${i}`, metadata: {} });
    }

    const listed = methods.ListWebRTCPeers({ excludeSelf: true, peerId: 'self-peer' });
    assert.strictEqual(listed.type, 'ListWebRTCPeersResult');
    assert.ok(Array.isArray(listed.peers));
    assert.ok(listed.peers.length <= 16, 'peer candidate list should be bounded');
  });

  it('includes lastSeen and registeredAt on candidates for cross-node relay ordering', function () {
    const { methods, hub } = harness;
    const now = Date.now();
    methods.RegisterWebRTCPeer({ peerId: 'relay-order-a', metadata: { tag: 'a' } });
    const entry = hub.http.webrtcPeers.get('relay-order-a');
    entry.lastSeen = now - 2000;
    entry.registeredAt = now - 5000;
    hub.http.webrtcPeers.set('relay-order-a', entry);

    const listed = methods.ListWebRTCPeers({ excludeSelf: true, peerId: 'other' });
    const row = listed.peers.find((p) => p.id === 'relay-order-a');
    assert.ok(row, 'peer should be listed');
    assert.strictEqual(row.lastSeen, now - 2000);
    assert.strictEqual(row.registeredAt, now - 5000);
  });

  it('RelayFromWebRTC accepts P2P_PEER_GOSSIP envelopes for mesh relay', function () {
    const { methods, broadcasts, relayP2pCalls } = harness;
    const r = methods.RelayFromWebRTC({
      fromPeerId: 'webrtc-mesh',
      envelope: {
        original: JSON.stringify({
          type: 'P2P_PEER_GOSSIP',
          object: { peers: [{ id: 'gossip-peer-1', lastSeen: Date.now() }] }
        }),
        originalType: 'P2P_PEER_GOSSIP',
        hops: []
      }
    });
    assert.strictEqual(r.status, 'success');
    assert.strictEqual(broadcasts.length, 1);
    assert.strictEqual(relayP2pCalls.length, 1);
  });

  it('requires document id for GetDocument', async function () {
    const { methods, hub, fsStore } = harness;

    hub._state.documents = hub._state.documents || {};
    hub._state.content.collections = hub._state.content.collections || {};
    hub._state.content.collections.documents = hub._state.content.collections.documents || {};

    const docId = 'doc-id-only';
    hub._state.documents[docId] = { id: docId, name: 'browser.min.js', created: '2026-01-02T00:00:00.000Z' };
    hub._state.content.collections.documents[docId] = { id: docId, name: 'browser.min.js' };
    fsStore.set(`documents/${docId}.json`, JSON.stringify({
      id: docId,
      name: 'browser.min.js',
      contentBase64: Buffer.from('latest').toString('base64')
    }));

    const byId = await methods.GetDocument(docId);
    assert.strictEqual(byId.type, 'GetDocumentResult');
    assert.strictEqual(byId.document.id, docId);

    const byName = await methods.GetDocument('browser.min.js');
    assert.strictEqual(byName.status, 'error');
    assert.ok(/not found/i.test(byName.message));
  });

  it('publishes document metadata only into documents collection', async function () {
    const { methods, hub } = harness;

    const first = await methods.CreateDocument({
      name: 'browser.min.js',
      mime: 'application/javascript',
      contentBase64: Buffer.from('v1').toString('base64')
    });
    const second = await methods.CreateDocument({
      name: 'browser.min.js',
      mime: 'application/javascript',
      contentBase64: Buffer.from('v2').toString('base64')
    });

    assert.strictEqual(first.type, 'CreateDocumentResult');
    assert.strictEqual(second.type, 'CreateDocumentResult');
    assert.notStrictEqual(first.document.id, second.document.id, 'different content should produce different ids');

    const published = await methods.PublishDocument(second.document.id);
    assert.strictEqual(published.type, 'PublishDocumentResult');
    const publishedDocs = hub._state.content.collections.documents || {};
    assert.ok(publishedDocs[second.document.id], 'published document should be indexed in documents resource');
    assert.strictEqual(publishedDocs[second.document.id].document, second.document.id);
  });

  it('creates document revisions through Chain-backed EditDocument flow', async function () {
    const { methods, chainUpdates } = harness;

    const created = await methods.CreateDocument({
      name: 'notes.txt',
      mime: 'text/plain',
      contentBase64: Buffer.from('v1').toString('base64')
    });
    assert.strictEqual(created.type, 'CreateDocumentResult');

    const beforePublishChain = chainUpdates.length;
    const published = await methods.PublishDocument(created.document.id);
    assert.strictEqual(published.type, 'PublishDocumentResult');
    assert.ok(chainUpdates.length > beforePublishChain, 'publish should add major update to chain');

    const beforeEditChain = chainUpdates.length;
    const edited = await methods.EditDocument({
      id: created.document.id,
      content: 'v2',
      publish: true
    });
    assert.strictEqual(edited.type, 'EditDocumentResult');
    assert.strictEqual(edited.document.revision, 2, 'first edit should increment revision');
    assert.strictEqual(edited.document.parent, created.document.id, 'revision should point to parent');
    assert.strictEqual(edited.document.lineage, created.document.id, 'lineage should remain stable');
    assert.ok(chainUpdates.length > beforeEditChain, 'edit should add major update to chain');

    const revisions = await methods.ListDocumentRevisions(created.document.id);
    assert.strictEqual(revisions.type, 'ListDocumentRevisionsResult');
    assert.strictEqual(revisions.revisions.length, 2, 'lineage should include both revisions');
    assert.strictEqual(revisions.revisions[0].revision, 1);
    assert.strictEqual(revisions.revisions[1].revision, 2);

    const latest = await methods.GetDocument(edited.document.id);
    assert.strictEqual(latest.type, 'GetDocumentResult');
    assert.strictEqual(latest.document.id, edited.document.id, 'revision id should fetch latest document');
  });

  it('exposes chain with tree, genesis, and messages array', async function () {
    const { methods, hub } = harness;
    const created = await methods.CreateDocument({
      name: 'chain-structure.txt',
      mime: 'text/plain',
      contentBase64: Buffer.from('chain-test').toString('base64')
    });
    await methods.PublishDocument(created.document.id);

    const status = await methods.GetNetworkStatus();
    assert.ok(status.chain, 'chain should exist');
    assert.ok(status.chain.tree, 'chain should have tree');
    assert.ok(status.chain.genesis, 'chain should have genesis');
    assert.ok(Array.isArray(status.chain.messages), 'chain.messages should be array of IDs');
    assert.ok(status.chain.roots, 'chain should have roots');
  });

  it('exposes chain (roots, tree) in network status and GetMerkleState RPC', async function () {
    const { methods, published, chainUpdates } = harness;
    assert.ok(methods.GetNetworkStatus, 'GetNetworkStatus should be registered');
    assert.ok(methods.GetMerkleState, 'GetMerkleState should be registered');
    assert.ok(methods.ListFabricMessages, 'ListFabricMessages should be registered');

    const created = await methods.CreateDocument({
      name: 'merkle.txt',
      mime: 'text/plain',
      contentBase64: Buffer.from('merkle-seed').toString('base64')
    });
    await methods.PublishDocument(created.document.id);

    const status = await methods.GetNetworkStatus();
    assert.ok(status.chain, 'network status should include chain');
    assert.ok(status.chain.roots, 'chain payload should include roots');
    assert.ok(status.chain.tree, 'chain should include tree');
    assert.ok(typeof status.chain.roots.documents === 'string' || status.chain.roots.documents === null);
    assert.ok(typeof status.chain.roots.fabricMessages === 'string' || status.chain.roots.fabricMessages === null);

    const chainResult = methods.GetMerkleState();
    assert.strictEqual(chainResult.type, 'GetMerkleStateResult');
    assert.ok(chainResult.current && chainResult.current.roots, 'GetMerkleState should include current roots');
    assert.ok(chainResult.current && chainResult.current.tree, 'GetMerkleState should include tree');
    assert.ok(chainResult.history && typeof chainResult.history === 'object', 'GetMerkleState should include history map');

    const messageList = methods.ListFabricMessages();
    assert.strictEqual(messageList.type, 'ListFabricMessagesResult');
    assert.ok(Array.isArray(messageList.messages), 'fabric message log should be an array');
    assert.ok(messageList.messages.length >= 1, 'fabric message log should contain mutation messages');
    assert.strictEqual(messageList.messages[0].seq, 1, 'fabric messages should be sequence-numbered');

    const persistedMessages = published.filter((entry) => String(entry.name || '').startsWith('messages/'));
    assert.ok(persistedMessages.length >= 1, 'fabric messages should be persisted via Filesystem.publish');
    assert.ok(chainUpdates.length >= 1, 'fabric messages should be added to filesystem chain');
  });

  it('validates SendWebRTCSignal required fields', async function () {
    const { methods } = harness;

    assert.ok(methods.SendWebRTCSignal, 'SendWebRTCSignal should be registered');

    const bad = methods.SendWebRTCSignal({ fromPeerId: 'a', toPeerId: 'b' });
    assert.strictEqual(bad.status, 'error');
    assert.ok(/required/i.test(bad.message));

  });

  it('broadcasts WebRTCSignal payload as JSONCallResult', async function () {
    const { methods, broadcasts } = harness;

    const signal = {
      type: 'offer',
      sdp: { type: 'offer', sdp: 'v=0\r\n...' },
      _fabric: {
        protocol: 'fabric-webrtc-v2',
        sessionId: 'session-a',
        targetSessionId: 'session-b',
        revision: 1
      }
    };

    const result = methods.SendWebRTCSignal({
      fromPeerId: 'fabric-bridge-a',
      toPeerId: 'fabric-bridge-b',
      signal
    });

    assert.strictEqual(result.status, 'success');
    assert.strictEqual(broadcasts.length, 1, 'signal should be broadcast to connected WS clients');
    const body = String(broadcasts[0].body || '');
    assert.ok(body.includes('WebRTCSignal'), 'broadcast body should include WebRTCSignal type');
    assert.ok(body.includes('fabric-bridge-a'), 'broadcast body should include source peer');
    assert.ok(body.includes('fabric-bridge-b'), 'broadcast body should include destination peer');
    assert.ok(body.includes('fabric-webrtc-v2'), 'broadcast body should preserve signal metadata');

  });

  it('splits SendPeerFile payload into 1MB chunks', async function () {
    const { methods, hub } = harness;
    assert.ok(methods.SendPeerFile, 'SendPeerFile should be registered');

    const address = '127.0.0.1:7999';
    hub.agent.connections[address] = { _writeFabric: () => {} };
    hub._resolvePeerAddress = () => address;

    const sentVectors = [];
    hub._sendVectorToPeer = (target, vector) => {
      sentVectors.push({ target, vector });
    };

    const oneMB = 1024 * 1024;
    const source = Buffer.alloc((2 * oneMB) + 123, 0x41);
    const result = await methods.SendPeerFile(
      address,
      {
        id: 'doc-chunk-test',
        name: 'chunk-test.bin',
        mime: 'application/octet-stream',
        size: source.length,
        sha256: 'doc-chunk-test',
        contentBase64: source.toString('base64')
      }
    );

    assert.strictEqual(result.status, 'success');
    assert.strictEqual(sentVectors.length, 3, 'expected two full 1MB chunks and one remainder');

    const parsed = sentVectors.map(({ target, vector }) => {
      assert.strictEqual(target, address);
      assert.strictEqual(vector[0], 'P2P_FILE_SEND');
      return JSON.parse(vector[1]);
    });

    const total = parsed[0].object.part.total;
    const transferId = parsed[0].object.part.transferId;
    assert.strictEqual(total, sentVectors.length, 'part.total should match emitted chunks');

    const indexes = parsed
      .map((entry) => entry.object.part.index)
      .sort((a, b) => a - b);

    for (let i = 0; i < indexes.length; i++) {
      assert.strictEqual(indexes[i], i, 'chunk indexes should be contiguous');
    }

    for (let i = 0; i < parsed.length; i++) {
      const entry = parsed[i];
      assert.strictEqual(entry.object.part.transferId, transferId, 'all chunks should share transferId');
      const chunkBytes = Buffer.from(entry.object.contentBase64, 'base64').length;
      if (i < parsed.length - 1) {
        assert.strictEqual(chunkBytes, oneMB, 'all non-final chunks should be exactly 1MB');
      } else {
        assert.strictEqual(chunkBytes, 123, 'final chunk should carry remainder bytes');
      }
    }
  });

  it('reassembles incoming chunked P2P files and persists once complete', async function () {
    const { agentHandlers, published } = harness;
    assert.ok(agentHandlers.file, 'file handler should be registered');

    const oneMB = 1024 * 1024;
    const original = Buffer.alloc((2 * oneMB) + 77, 0x5a);
    const transferId = `transfer-${Date.now()}`;
    const chunks = [
      original.subarray(0, oneMB),
      original.subarray(oneMB, 2 * oneMB),
      original.subarray(2 * oneMB)
    ];

    for (let i = 0; i < chunks.length; i++) {
      await agentHandlers.file({
        origin: { name: '127.0.0.1:7999' },
        message: {
          object: {
            id: 'doc-reassembly-test',
            name: 'reassembly.bin',
            mime: 'application/octet-stream',
            size: original.length,
            sha256: 'doc-reassembly-test',
            contentBase64: chunks[i].toString('base64'),
            created: '2026-01-01T00:00:00.000Z',
            part: {
              transferId,
              index: i,
              total: chunks.length
            }
          }
        }
      });
    }

    const documentPublishes = published.filter((item) => item.name === 'documents/doc-reassembly-test.json');
    assert.strictEqual(documentPublishes.length, 1, 'should persist once after final chunk arrives');
    const stored = documentPublishes[0].value;
    assert.ok(stored && stored.contentBase64, 'stored document should include content');
    assert.deepStrictEqual(Buffer.from(stored.contentBase64, 'base64'), original, 'reassembled content should match original bytes');
  });
});
