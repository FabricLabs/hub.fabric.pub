'use strict';

const assert = require('assert');
const { P2P_PEER_GOSSIP } = require('@fabric/core/constants');
require('@babel/register');

describe('Bridge WebRTC signaling metadata', function () {
  this.timeout(180000);

  let Bridge;
  let previousWindow;
  let previousRTCSessionDescription;

  function createLocalStorageMock () {
    const store = new Map();
    return {
      getItem: (key) => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key)
    };
  }

  before(function () {
    previousWindow = global.window;
    previousRTCSessionDescription = global.RTCSessionDescription;

    global.window = {
      location: {
        hostname: 'localhost',
        port: '8080',
        protocol: 'http:',
        pathname: '/'
      },
      localStorage: createLocalStorageMock(),
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {}
    };

    global.RTCSessionDescription = function RTCSessionDescription (init) {
      return init;
    };

    Bridge = require('../components/Bridge');
  });

  after(function () {
    global.window = previousWindow;
    global.RTCSessionDescription = previousRTCSessionDescription;
  });

  it('attaches session metadata and increments revisions', function () {
    const bridge = new Bridge({});
    bridge.peerId = 'fabric-bridge-local';

    const entry = {
      localSessionId: 'local-session-1',
      remoteSessionId: 'remote-session-1',
      localSignalRevision: 0
    };

    const first = bridge._withRTCSignalMeta(entry, { type: 'offer' });
    const second = bridge._withRTCSignalMeta(entry, { type: 'ice-candidate' });

    assert.strictEqual(first._fabric.protocol, 'fabric-webrtc-v2');
    assert.strictEqual(first._fabric.sessionId, 'local-session-1');
    assert.strictEqual(first._fabric.targetSessionId, 'remote-session-1');
    assert.strictEqual(first._fabric.revision, 1);
    assert.strictEqual(second._fabric.revision, 2);
  });

  it('drops signals that target a different local session', async function () {
    const bridge = new Bridge({});
    bridge.peerId = 'fabric-bridge-local';

    let setRemoteDescriptionCalls = 0;
    const fakePc = {
      signalingState: 'stable',
      setRemoteDescription: async () => { setRemoteDescriptionCalls += 1; },
      setLocalDescription: async () => {},
      createAnswer: async () => ({ type: 'answer', sdp: 'x' }),
      addIceCandidate: async () => {}
    };

    bridge._rtcPeers.set('peer-a', {
      pc: fakePc,
      dc: null,
      localSessionId: 'expected-local-session',
      remoteSessionId: null,
      localSignalRevision: 0,
      remoteSignalRevision: 0,
      makingOffer: false,
      ignoreOffer: false,
      polite: true,
      signalQueue: Promise.resolve()
    });

    bridge.handleIncomingWebRTCSignal('peer-a', {
      type: 'offer',
      sdp: { type: 'offer', sdp: 'sdp-a' },
      _fabric: {
        protocol: 'fabric-webrtc-v2',
        sessionId: 'remote-session-a',
        targetSessionId: 'other-local-session',
        revision: 1
      }
    });

    const entry = bridge._rtcPeers.get('peer-a');
    await entry.signalQueue;
    assert.strictEqual(setRemoteDescriptionCalls, 0, 'signal should be filtered before touching RTCPeerConnection');
  });

  it('drops stale answer revisions and accepts newer revisions', async function () {
    const bridge = new Bridge({});
    bridge.peerId = 'fabric-bridge-local';

    let setRemoteDescriptionCalls = 0;
    const fakePc = {
      signalingState: 'have-local-offer',
      setRemoteDescription: async () => { setRemoteDescriptionCalls += 1; },
      setLocalDescription: async () => {},
      createAnswer: async () => ({ type: 'answer', sdp: 'x' }),
      addIceCandidate: async () => {}
    };

    bridge._rtcPeers.set('peer-b', {
      pc: fakePc,
      dc: null,
      localSessionId: 'local-session-b',
      remoteSessionId: 'remote-session-b',
      localSignalRevision: 0,
      remoteSignalRevision: 3,
      makingOffer: false,
      ignoreOffer: false,
      polite: true,
      signalQueue: Promise.resolve()
    });

    bridge.handleIncomingWebRTCSignal('peer-b', {
      type: 'answer',
      sdp: { type: 'answer', sdp: 'old-sdp' },
      _fabric: {
        protocol: 'fabric-webrtc-v2',
        sessionId: 'remote-session-b',
        targetSessionId: 'local-session-b',
        revision: 2
      }
    });

    let entry = bridge._rtcPeers.get('peer-b');
    await entry.signalQueue;
    assert.strictEqual(setRemoteDescriptionCalls, 0, 'stale answer revision should be ignored');

    bridge.handleIncomingWebRTCSignal('peer-b', {
      type: 'answer',
      sdp: { type: 'answer', sdp: 'new-sdp' },
      _fabric: {
        protocol: 'fabric-webrtc-v2',
        sessionId: 'remote-session-b',
        targetSessionId: 'local-session-b',
        revision: 4
      }
    });

    entry = bridge._rtcPeers.get('peer-b');
    await entry.signalQueue;
    assert.strictEqual(setRemoteDescriptionCalls, 1, 'newer answer revision should be accepted');
    assert.strictEqual(entry.remoteSignalRevision, 4);
  });

  it('ignores relayed signals not addressed to this peer', function () {
    const bridge = new Bridge({});
    bridge.peerId = 'fabric-bridge-local';

    let called = 0;
    bridge.handleIncomingWebRTCSignal = () => { called += 1; };

    const processed = bridge._handleWebRTCSignalResult({
      type: 'WebRTCSignal',
      fromPeerId: 'fabric-bridge-remote',
      toPeerId: 'fabric-bridge-someone-else',
      signal: { type: 'offer', sdp: { type: 'offer', sdp: 'v=0' } }
    });

    assert.strictEqual(processed, false);
    assert.strictEqual(called, 0);
  });

  it('processes relayed signals addressed to this peer', function () {
    const bridge = new Bridge({});
    bridge.peerId = 'fabric-bridge-local';

    let called = 0;
    bridge.handleIncomingWebRTCSignal = (fromPeerId, signal) => {
      called += 1;
      assert.strictEqual(fromPeerId, 'fabric-bridge-remote');
      assert.strictEqual(signal.type, 'answer');
    };

    const processed = bridge._handleWebRTCSignalResult({
      type: 'WebRTCSignal',
      fromPeerId: 'fabric-bridge-remote',
      toPeerId: 'fabric-bridge-local',
      signal: { type: 'answer', sdp: { type: 'answer', sdp: 'v=0' } }
    });

    assert.strictEqual(processed, true);
    assert.strictEqual(called, 1);
  });

  it('prioritizes freshest peer candidates when connecting', function () {
    const bridge = new Bridge({ maxWebrtcPeers: 1 });
    bridge.peerId = 'fabric-bridge-local';
    bridge._webrtcReady = true;
    bridge.webrtcPeers.clear();
    bridge._connectingPeers.clear();
    const now = Date.now();

    const attempted = [];
    bridge.connectToWebRTCPeer = (peerId) => {
      attempted.push(peerId);
      bridge._connectingPeers.add(peerId);
    };

    bridge.handlePeerCandidates([
      { id: 'older-peer', connectedAt: now - 2000 },
      { id: 'newer-peer', connectedAt: now - 1000 }
    ]);

    assert.deepStrictEqual(attempted, ['newer-peer']);
  });

  it('orders hub candidates by lastSeen when connectedAt ties', function () {
    const bridge = new Bridge({ maxWebrtcPeers: 1 });
    bridge.peerId = 'fabric-bridge-local';
    bridge._webrtcReady = true;
    bridge.webrtcPeers.clear();
    bridge._connectingPeers.clear();
    const t = Date.now();

    const attempted = [];
    bridge.connectToWebRTCPeer = (peerId) => {
      attempted.push(peerId);
      bridge._connectingPeers.add(peerId);
    };

    bridge.handlePeerCandidates([
      { id: 'stale-heartbeat', connectedAt: t - 60000, lastSeen: t - 5000, registeredAt: t - 60000 },
      { id: 'fresh-heartbeat', connectedAt: t - 60000, lastSeen: t - 100, registeredAt: t - 60000 }
    ]);

    assert.deepStrictEqual(attempted, ['fresh-heartbeat']);
  });

  it('builds gossip payload with self and connected peers for multi-node discovery', function () {
    const bridge = new Bridge({});
    bridge.peerId = 'node-self';
    bridge.webrtcPeers.set('mesh-neighbor', {
      id: 'mesh-neighbor',
      status: 'connected',
      connectedAt: Date.now() - 1000,
      lastSeen: Date.now()
    });

    const payload = bridge._buildWebRTCPeerGossipPayload();
    assert.strictEqual(payload.type, P2P_PEER_GOSSIP);
    assert.ok(Array.isArray(payload.object.peers));
    assert.ok(payload.object.peers.some((p) => p.id === 'node-self'));
    assert.ok(payload.object.peers.some((p) => p.id === 'mesh-neighbor'));
  });

  it('merges peer candidates from WebRTC gossip (cross-cluster relay)', function () {
    const bridge = new Bridge({ maxWebrtcPeers: 3 });
    bridge.peerId = 'node-a';
    bridge._webrtcReady = true;
    bridge.webrtcPeers.clear();
    bridge._connectingPeers.clear();

    const attempted = [];
    bridge.connectToWebRTCPeer = (peerId) => {
      attempted.push(peerId);
      bridge._connectingPeers.add(peerId);
    };

    bridge.handleWebRTCPeerMessage('node-b', JSON.stringify({
      type: 'webrtc-peer-gossip',
      object: {
        peers: [{ id: 'node-c', lastSeen: Date.now(), registeredAt: Date.now() }]
      }
    }));

    assert.ok(attempted.includes('node-c'), 'should attempt outbound connect to gossiped peer id');
  });

  it('accepts P2P_PEER_GOSSIP typed mesh relay same as webrtc-peer-gossip alias', function () {
    const bridge = new Bridge({ maxWebrtcPeers: 3 });
    bridge.peerId = 'node-a';
    bridge._webrtcReady = true;
    bridge.webrtcPeers.clear();
    bridge._connectingPeers.clear();

    const attempted = [];
    bridge.connectToWebRTCPeer = (peerId) => {
      attempted.push(peerId);
      bridge._connectingPeers.add(peerId);
    };

    bridge.handleWebRTCPeerMessage('node-b', JSON.stringify({
      type: P2P_PEER_GOSSIP,
      object: {
        peers: [{ id: 'node-d', lastSeen: Date.now() }]
      }
    }));

    assert.ok(attempted.includes('node-d'));
  });

  it('re-registers WebRTC presence on heartbeat ticks', function () {
    const bridge = new Bridge({ webrtcHeartbeatIntervalMs: 50, webrtcDiscoveryIntervalMs: 60000 });
    bridge.peerId = 'fabric-bridge-local';
    bridge._webrtcReady = true;
    bridge.ws = { readyState: 1 };
    bridge._lastWebRTCPublishAt = Date.now() - 1000;
    bridge._lastWebRTCDiscoverAt = Date.now();

    let published = 0;
    bridge.publishWebRTCOffer = () => { published += 1; };

    bridge.tick();
    assert.strictEqual(published, 1, 'tick should publish when heartbeat interval elapsed');
  });

  it('does not double-count connecting peers during candidate slot calculation', function () {
    const bridge = new Bridge({ maxWebrtcPeers: 2 });
    bridge.peerId = 'fabric-bridge-local';
    bridge._webrtcReady = true;
    const now = Date.now();

    bridge._connectingPeers.add('peer-connecting');
    bridge.webrtcPeers.set('peer-connecting', {
      id: 'peer-connecting',
      status: 'connecting'
    });

    const attempted = [];
    bridge.connectToWebRTCPeer = (peerId) => attempted.push(peerId);

    bridge.handlePeerCandidates([
      { id: 'peer-connecting', connectedAt: now - 2000 },
      { id: 'peer-fresh', connectedAt: now - 1000 }
    ]);

    assert.deepStrictEqual(attempted, ['peer-fresh'], 'one outbound slot should remain available');
  });

  it('tracks connected native data channels in peer map', function () {
    const bridge = new Bridge({});
    bridge.setState = () => {};
    bridge.peerId = 'fabric-bridge-local';
    bridge._webrtcReady = true;
    bridge._connectingPeers.add('peer-connected');

    let sent = 0;
    const fakeDc = {
      send: () => { sent += 1; },
      close: () => {},
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null
    };

    bridge._rtcPeers.set('peer-connected', {
      initiator: true,
      pc: { close: () => {} },
      dc: fakeDc
    });

    bridge._attachDataChannelHandlers('peer-connected', fakeDc);
    fakeDc.onopen();

    const tracked = bridge.webrtcPeers.get('peer-connected');
    assert.ok(tracked, 'peer should be tracked in webrtcPeers');
    assert.strictEqual(tracked.status, 'connected');
    assert.strictEqual(tracked.connection, fakeDc);
    assert.strictEqual(bridge._connectingPeers.has('peer-connected'), false, 'peer should leave connecting set on open');
    assert.strictEqual(bridge.sendToWebRTCPeer('peer-connected', { type: 'ping' }), true);
    assert.strictEqual(sent, 1, 'data should send over tracked data channel');
  });

  it('removes peer tracking when data channel closes', function () {
    const bridge = new Bridge({});
    bridge.setState = () => {};
    bridge.forceUpdate = () => {};
    bridge.peerId = 'fabric-bridge-local';
    bridge._webrtcReady = true;

    const fakeDc = {
      send: () => {},
      close: () => {},
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null
    };

    bridge._rtcPeers.set('peer-close', {
      initiator: false,
      pc: { close: () => {} },
      dc: fakeDc
    });

    bridge._attachDataChannelHandlers('peer-close', fakeDc);
    fakeDc.onopen();
    assert.ok(bridge.webrtcPeers.has('peer-close'));

    fakeDc.onclose();
    assert.strictEqual(bridge.webrtcPeers.has('peer-close'), false, 'peer should be removed from webrtcPeers');
    assert.strictEqual(bridge._rtcPeers.has('peer-close'), false, 'peer should be removed from rtc session map');
  });

  it('records WebRTC broadcast delivery metadata for submit chat', function () {
    const bridge = new Bridge({});
    bridge._hasUnlockedIdentity = () => true;
    bridge._getIdentityId = () => 'actor-local';
    bridge.preferWebRTCChat = true;
    let hubSubmitCount = 0;
    bridge.sendSignedMessage = () => { hubSubmitCount += 1; };
    bridge.globalState.messages = {
      'msg-1': {
        object: { clientId: 'msg-1', content: 'hello' },
        status: 'queued'
      }
    };

    bridge.broadcastToWebRTCPeersWithRecipients = () => [];
    bridge.sendSubmitChatMessageRequest({ text: 'hello', clientId: 'msg-1' });
    assert.strictEqual(bridge.globalState.messages['msg-1'].status, 'queued');
    assert.strictEqual(bridge.globalState.messages['msg-1'].transport, 'webrtc');
    assert.strictEqual(bridge.globalState.messages['msg-1'].delivery.deliveredTo, 0);
    assert.strictEqual(hubSubmitCount, 1, 'should also submit via hub path');

    bridge.broadcastToWebRTCPeersWithRecipients = () => ['peer-a', 'peer-b'];
    bridge.sendSubmitChatMessageRequest({ text: 'hello', clientId: 'msg-1' });
    assert.strictEqual(bridge.globalState.messages['msg-1'].status, 'queued');
    assert.strictEqual(bridge.globalState.messages['msg-1'].delivery.deliveredTo, 2);
    assert.strictEqual(hubSubmitCount, 2, 'should keep hub and mesh paths unified');
  });

  it('records WebRTC delivery count for direct peer chat', function () {
    const bridge = new Bridge({});
    bridge._hasUnlockedIdentity = () => true;
    bridge._getIdentityId = () => 'actor-local';
    bridge.preferWebRTCChat = true;
    bridge.broadcastToWebRTCPeersWithRecipients = () => ['peer-a'];

    bridge.sendPeerMessageRequest('peer-a', 'hello-peer');

    const entries = Object.values(bridge.globalState.messages || {});
    assert.ok(entries.length > 0, 'should create local message entry');
    const latest = entries[entries.length - 1];
    assert.strictEqual(latest.transport, 'webrtc');
    assert.strictEqual(latest.delivery.deliveredTo, 1);
    assert.strictEqual(latest.status, 'sent');
  });

  it('requires unlocked identity before sending direct peer chat', function () {
    const bridge = new Bridge({});
    bridge._hasUnlockedIdentity = () => false;

    let unlockPrompted = 0;
    let attemptedBroadcast = 0;
    bridge._notifyIdentityUnlockRequired = () => { unlockPrompted += 1; };
    bridge.broadcastToWebRTCPeersWithRecipients = () => {
      attemptedBroadcast += 1;
      return [];
    };

    bridge.sendPeerMessageRequest('peer-a', 'hello-peer');

    assert.strictEqual(unlockPrompted, 1, 'should prompt for unlock');
    assert.strictEqual(attemptedBroadcast, 0, 'should not attempt delivery while locked');
  });
});
