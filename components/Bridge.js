'use strict';

// Dependencies
const React = require('react');
const WebSocket = require('isomorphic-ws');
const { applyPatch } = require('fast-json-patch');
const Actor = require('@fabric/core/types/actor');

// Native WebRTC (no PeerJS)
// Uses RTCPeerConnection + existing hub WebSocket as signaling channel.

// Semantic UI
const {
  Label
} = require('semantic-ui-react');

// Fabric Types
const Message = require('@fabric/core/types/message');
const Key = require('@fabric/core/types/key');
const { P2P_PEER_GOSSIP, P2P_PEERING_OFFER } = require('@fabric/core/constants');
const fabricBridgeEnvelope = require('../functions/fabricBridgeEnvelope');
const { pushUiNotification } = require('../functions/uiNotifications');
const { loadHubUiFeatureFlags } = require('../functions/hubUiFeatureFlags');
const { formatSatsDisplay } = require('../functions/formatSats');
const { toast } = require('../functions/toast');
const { DELEGATION_SIGNATURE_REQUEST, isDelegationSignatureRequestActivity, DOCUMENT_OFFER } = require('../functions/messageTypes');
const { parseFederationContractInvite, parseFederationContractInviteResponse } = require('../functions/federationContractInvite');
const { extractPeerXpub, shortenPublicId, normalizePeerAddressInput } = require('../functions/peerIdentity');
const { isLikelyBip32ExtendedKey } = require('../functions/isLikelyBip32ExtendedKey');
const { DELEGATION_STORAGE_KEY } = require('../functions/fabricDelegationLocal');
const { isHubNetworkStatusShape } = require('../functions/hubNetworkStatus');
const {
  needsCreateDocumentBeforePublish,
  mergePublishedDocumentsFromHubStatus
} = require('../functions/documentPublishSync');
const { safeIdentityErr, safeDebugStatePreview, safeUrlForLog } = require('../functions/fabricSafeLog');
const {
  fabricIdentityChatDisabledReasonPlain,
  fabricIdentityPeerDisabledReasonPlain
} = require('../functions/hubIdentityUiHints');
const { createFabricBrowserStore } = require('../functions/fabricBrowserStore');
const { readStorageJSON } = require('../functions/fabricBrowserState');
const BridgeMessageCollection = require('../types/bridgeMessageCollection');
const {
  HUB_FABRIC_SESSION_ID,
  SESSION_KIND_HUB,
  SESSION_KIND_WEBRTC,
  fabricWireBodyIntegrityOk,
  HEADER_SIZE: FABRIC_WIRE_HEADER_SIZE,
  BRIDGE_INBOUND_WIRE_MAX_BYTES,
  FabricTransportSession
} = require('../functions/fabricTransportSession');

/**
 * Describe inbound/outbound payloads for debug logs without printing raw bytes or bodies (privacy).
 * @param {*} data
 * @returns {object}
 */
function fabricDebugDescribePayload (data) {
  if (data == null) return { kind: 'null' };
  if (typeof data === 'string') return { kind: 'string', length: data.length };
  if (data instanceof ArrayBuffer) return { kind: 'ArrayBuffer', byteLength: data.byteLength };
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(data)) {
    return { kind: 'TypedArray', byteLength: data.byteLength };
  }
  try {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(data)) {
      return { kind: 'Buffer', length: data.length };
    }
  } catch (e) {}
  try {
    if (typeof Blob !== 'undefined' && data instanceof Blob) return { kind: 'Blob', size: data.size };
  } catch (e) {}
  if (typeof data === 'object') {
    const o = { kind: 'object' };
    if (Object.prototype.hasOwnProperty.call(data, 'type')) o.type = data.type;
    if (typeof data.data === 'string') o.dataStringLength = data.data.length;
    else if (data.data && typeof data.data.byteLength === 'number') o.dataByteLength = data.data.byteLength;
    return o;
  }
  return { kind: typeof data };
}

/**
 * Manages a WebSocket connection to a remote server.
 */
class Bridge extends React.Component {
  constructor (props) {
    super(props);

    // Settings
    this.settings = Object.assign({
      host: window.location.hostname,
      port: window.location.port || (window.location.protocol === 'https:' ? 443 : 80),
      secure: window.location.protocol === 'https:',
      debug: false,
      tickrate: 250,
      signingKey: props.auth ? new Key(props.auth) : null,
      maxWebrtcPeers: 5, // Maximum number of WebRTC peer connections to maintain
      webrtcPeerDiscoveryDelay: 2000, // Delay before discovering peers (ms)
      webrtcHeartbeatIntervalMs: 30000, // Re-register peer presence on heartbeat
      webrtcDiscoveryIntervalMs: 15000, // Periodically rediscover active peers
      webrtcGossipIntervalMs: 25000, // Gossip peer list to WebRTC neighbors for cross-cluster discovery
      webrtcPeeringOfferIntervalMs: 30000, // Publish peering offer when below max peers
      webrtcConnectTimeoutMs: 15000, // Abort stale outbound connect attempts
      webrtcCandidateMaxAgeMs: 120000 // Ignore stale peer registrations when discovering candidates
    }, props);

    // Optional override via a single hub address string.
    // Accepts: "host:port", "http(s)://host:port", "ws(s)://host:port"
    if (this.settings && typeof this.settings.hubAddress === 'string' && this.settings.hubAddress.trim()) {
      this._applyHubAddressString(this.settings.hubAddress);
    }

    this.state = {
      data: null,
      error: null,
      networkStatus: null,
      lastNetworkStatus: null,
      subscriptions: new Set(),
      isConnected: false,
      webrtcConnected: false,
      currentPath: window.location.pathname
    };

    // Global state for JSON-PATCH updates
    this.globalState = {
      conversations: {},
      messages: {},
      documents: {},
      distributeProposals: {},
      peerTopologyGossip: { byReporter: {} }
    };

    // Canonical browser-side Fabric state store (offline-first baseline).
    this._fabricStore = createFabricBrowserStore({
      storageKey: 'fabric:state',
      initialState: this.globalState
    });
    const restoredUnified = this._fabricStore.GET('/');
    if (restoredUnified && typeof restoredUnified === 'object') {
      this.globalState = {
        ...this.globalState,
        ...restoredUnified,
        conversations: {
          ...(this.globalState.conversations || {}),
          ...((restoredUnified && restoredUnified.conversations) || {})
        },
        messages: {
          ...(this.globalState.messages || {}),
          ...((restoredUnified && restoredUnified.messages) || {})
        },
        documents: {
          ...(this.globalState.documents || {}),
          ...((restoredUnified && restoredUnified.documents) || {})
        },
        distributeProposals: {
          ...(this.globalState.distributeProposals || {}),
          ...((restoredUnified && restoredUnified.distributeProposals) || {})
        },
        peerTopologyGossip: {
          ...(this.globalState.peerTopologyGossip || {}),
          ...((restoredUnified && restoredUnified.peerTopologyGossip) || {})
        }
      };
    }

    this.attempts = 1;
    this.messageQueue = [];
    this.webrtcMessageQueue = [];
    this.peerMessageQueue = [];
    this.chatSubmissionQueue = [];
    this.pendingHubChatQueue = []; // Chat messages sent while hub was offline; flush to bridge when reconnected
    this._pendingClaimCallbacks = new Map(); // documentId -> { resolve, reject }
    /** Hub file id (sha) passed to CreatePurchaseInvoice — correlates error responses to the UI modal. */
    this._pendingCreatePurchaseInvoiceBackendIds = new Set();
    /** Same for CreateDistributeInvoice (pay-to-distribute step 1). */
    this._pendingCreateDistributeInvoiceBackendIds = new Set();
    this.queue = [];
    this.ws = null;
    this._heartbeat = null;
    this._isConnected = false;  // Internal connection state

    // Chat routing controls
    this.disableFabricP2P = false;
    this.disableHubChat = false;
    this.preferWebRTCChat = false;

    // WebRTC properties (native RTCPeerConnection)
    this.peerId = null;
    this.webrtcPeers = new Map(); // Track all WebRTC peer connections (metadata)
    this._webrtcConnected = false;
    this._webrtcReady = false;
    this._peerDiscoveryTimer = null; // Timer for peer discovery after startup
    this._connectingPeers = new Set(); // Track peers we're currently connecting to
    this._pendingPeerCandidates = []; // Candidates received before WebRTC is ready
    this._lastWebRTCPublishAt = 0;
    this._lastWebRTCDiscoverAt = 0;
    this._lastWebRTCGossipAt = 0;
    this._lastPeeringOfferAt = 0;
    this._jsonRpcQueue = []; // JSON-RPC payloads to send once WebSocket is open
    this._rtcPeers = new Map(); // peerId -> { pc, dc, status, initiator, metadata }
    this._rtcPendingIce = new Map(); // peerId -> [RTCIceCandidateInit]
    this._webrtcConnectTimers = new Map(); // peerId -> timeout handle
    this._rtcSessionCounter = 0;
    this._lastWebRTCChatDeliveryCount = null;
    this._lastWebRTCChatSentAt = 0;
    this._lastWebRTCRecipientPeerIds = [];
    /** Throttle identity unlock UI opens when several guarded actions fire in one burst. */
    this._lastIdentityUnlockUiNotifyAt = 0;

    /** Per Fabric transport leg: hub WebSocket + each WebRTC peer — Tree, chain, reputation. */
    this._fabricTransportSessions = new Map();
    /** After hub wire misbehavior exhaustion, skip auto-reconnect (operator must refresh). */
    this._fabricHubReconnectSuspended = false;
    this._peerListUiRefreshTimer = null;

    this._walletBalanceBaseline = new Set();
    this._lastWalletBalanceTotal = Object.create(null);
    this._lastWalletConfirmedSats = Object.create(null);
    this._lastWalletUnconfirmedSats = Object.create(null);
    this._l1InvoiceActivityKeys = new Set();
    this._onClientBalanceUpdate = this._onClientBalanceUpdate.bind(this);

    // Track backing SHA ids that should be published once CreateDocument succeeds.
    /** Hub document file id (sha) when a PublishDocument JSONCall is in flight. */
    this._pendingPublishDocumentBackendIds = new Set();
    /** When publish first runs CreateDocument, correlate generic RPC errors to the document row. */
    this._lastPublishCreateContext = null; // { sha: string, actorId: string, sentAt: number }
    /** AcceptDistributeProposal in flight — correlate hub errors to hosting UI. */
    this._pendingAcceptDistributeContext = null; // { backendId: string, proposalId: string, sentAt: number }
    /** SendDistributeProposal in flight — correlate typed hub result to document detail UI. */
    this._pendingSendDistributeProposalContext = null; // { backendId: string, peerKey: string, sentAt: number }
    this._pendingPublishBySha = new Set();
    /** @type {Map<string, object>} Incomplete P2P_FILE_SEND transfers keyed by transferId */
    this._p2pFileReceivers = new Map();

    // Initialize key if provided
    if (props.key) {
      this.key = new Key(props.key);
    }

    // Restore local browser-backed state.
    const restoredPeerQueue = this._readJSONFromStorage('fabric:peerMessageQueue', []);
    if (Array.isArray(restoredPeerQueue)) this.peerMessageQueue = restoredPeerQueue;

    const restoredMessages = this._readJSONFromStorage('fabric:messages', null);
    this._messageCollection = new BridgeMessageCollection({
      data: (restoredMessages && typeof restoredMessages === 'object') ? restoredMessages : {}
    });
    this.globalState.messages = this._messageCollection.exportMap();

    // Restore documents (unified store: all docs with content; publish adds ref to hub index)
    const docs = {};
    const restoredDocs = this._readJSONFromStorage('fabric:documents', null);
    if (restoredDocs && typeof restoredDocs === 'object') Object.assign(docs, restoredDocs);

    // Migrate from legacy localDocuments into documents.
    const legacyDocs = this._readJSONFromStorage('fabric:localDocuments', null);
    if (legacyDocs && typeof legacyDocs === 'object') {
      Object.assign(docs, legacyDocs);
      this._removeStorageKey('fabric:localDocuments');
    }

    if (Object.keys(docs).length > 0) {
      this.globalState.documents = { ...(this.globalState.documents || {}), ...docs };
    }

    const restoredProposals = this._readJSONFromStorage('fabric:distributeProposals', null);
    if (restoredProposals && typeof restoredProposals === 'object') {
      this.globalState.distributeProposals = restoredProposals;
    }

    this._persistGlobalState();

    return this;
  }

  get authority () {
    if (this.settings && this.settings.authority) return this.settings.authority;
    return ((this.settings.secure) ? `wss` : `ws`) + `://${this.settings.host}:${this.settings.port}`;
  }

  get networkStatus () {
    return this.state.networkStatus || null;
  }

  get lastNetworkStatus () {
    return this.state.lastNetworkStatus || null;
  }

  /**
   * Get a list of WebRTC peers connected to this browser client.
   * @returns {Array} Array of WebRTC peer objects with id, status, direction, connectedAt
   */
  get localWebrtcPeers () {
    const peers = Array.from(this.webrtcPeers.values()).map((p) => {
      const id = p && p.id != null ? String(p.id) : '';
      const sess = id && this._fabricTransportSessions && this._fabricTransportSessions.get(id);
      return {
        id: p.id,
        status: p.status,
        direction: p.direction,
        connectedAt: p.connectedAt,
        error: p.error,
        lastSeen: p.lastSeen,
        score: sess && sess.score != null ? sess.score : 100,
        misbehavior: sess && sess.misbehavior != null ? sess.misbehavior : 0
      };
    });

    // Also include peers that are currently connecting
    for (const peerId of this._connectingPeers) {
      if (!peers.find(p => p.id === peerId)) {
        peers.push({
          id: peerId,
          status: 'connecting',
          direction: 'outbound',
          connectedAt: null
        });
      }
    }

    return peers;
  }

  /**
   * Get the WebRTC mesh status summary.
   * @returns {Object} Summary of WebRTC mesh state
   */
  get webrtcMeshStatus () {
    const connected = this.getWebRTCPeerCount();
    const connecting = this._connectingPeers ? this._connectingPeers.size : 0;
    const maxPeers = this.settings.maxWebrtcPeers || 5;
    return {
      peerId: this.peerId,
      ready: this._webrtcReady,
      connected,
      connecting,
      maxPeers,
      slotsAvailable: Math.max(0, maxPeers - connected - connecting)
    };
  }

  /**
   * Lightweight debug telemetry for browser-level WebRTC chat sends.
   * @returns {{lastDeliveredTo:number|null,lastSentAt:number}}
   */
  get webrtcChatDebugStatus () {
    const connectedPeerIds = Array.from(this.webrtcPeers.values())
      .filter((peer) => peer && peer.status === 'connected' && peer.id)
      .map((peer) => peer.id);

    return {
      lastDeliveredTo: Number.isFinite(this._lastWebRTCChatDeliveryCount)
        ? this._lastWebRTCChatDeliveryCount
        : null,
      lastSentAt: this._lastWebRTCChatSentAt || 0,
      peerId: this.peerId || null,
      connectedPeerIds,
      lastRecipientPeerIds: Array.isArray(this._lastWebRTCRecipientPeerIds)
        ? this._lastWebRTCRecipientPeerIds.slice()
        : []
    };
  }

  /**
   * Enable or disable WebRTC-only chat mode.
   * When enabled, chat messages are sent over the WebRTC mesh instead of the hub/Fabric P2P paths.
   * @param {boolean} enabled
   */
  setWebRTCChatOnly (enabled) {
    const flag = !!enabled;
    this.preferWebRTCChat = flag;
    this.disableFabricP2P = flag;
    this.disableHubChat = flag;
  }

  /**
   * Send a WebRTC signaling payload to another browser via the Hub RPC.
   */
  sendWebRTCSignal (toPeerId, signal) {
    if (!this.peerId) return;

    this._sendJSONRPC({
      method: 'SendWebRTCSignal',
      params: [{
        fromPeerId: this.peerId,
        toPeerId,
        signal
      }]
    });
  }

  _hubReportWebRTCPeerConnected (remotePeerId, direction) {
    if (!this.peerId || !remotePeerId) return;
    try {
      this._sendJSONRPC({
        method: 'WebRTCPeerConnected',
        params: [{
          selfPeerId: this.peerId,
          remotePeerId: String(remotePeerId),
          direction: direction || null
        }]
      });
    } catch (_) { /* ignore */ }
  }

  _hubReportWebRTCPeerDisconnected (remotePeerId) {
    if (!this.peerId || !remotePeerId) return;
    try {
      this._sendJSONRPC({
        method: 'WebRTCPeerDisconnected',
        params: [{
          selfPeerId: this.peerId,
          remotePeerId: String(remotePeerId)
        }]
      });
    } catch (_) { /* ignore */ }
  }

  _newRTCSessionId (peerId) {
    this._rtcSessionCounter += 1;
    return `${this.peerId || 'bridge'}:${peerId}:${Date.now().toString(36)}:${this._rtcSessionCounter.toString(36)}`;
  }

  _nextRTCSignalRevision (entry) {
    entry.localSignalRevision = (entry.localSignalRevision || 0) + 1;
    return entry.localSignalRevision;
  }

  _withRTCSignalMeta (entry, signal, overrides = {}) {
    const existing = (signal && signal._fabric && typeof signal._fabric === 'object') ? signal._fabric : {};
    const revision = this._nextRTCSignalRevision(entry);
    return {
      ...signal,
      _fabric: {
        protocol: 'fabric-webrtc-v2',
        sessionId: entry.localSessionId || null,
        targetSessionId: entry.remoteSessionId || null,
        revision,
        ...existing,
        ...overrides
      }
    };
  }

  _getRTCSignalMeta (signal) {
    if (!signal || typeof signal !== 'object') return null;
    const meta = signal._fabric;
    if (!meta || typeof meta !== 'object') return null;
    return {
      protocol: typeof meta.protocol === 'string' ? meta.protocol : null,
      sessionId: typeof meta.sessionId === 'string' ? meta.sessionId : null,
      targetSessionId: typeof meta.targetSessionId === 'string' ? meta.targetSessionId : null,
      revision: Number.isFinite(meta.revision) ? Number(meta.revision) : null
    };
  }

  /**
   * Create a native RTCPeerConnection wired to our signaling helpers.
   */
  _createRTCPeerConnection (peerId, entry) {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    };

    const pc = new RTCPeerConnection(config);

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const signal = this._withRTCSignalMeta(entry, {
          type: 'ice-candidate',
          candidate: ev.candidate.toJSON()
        });
        this.sendWebRTCSignal(peerId, signal);
      }
    };

    pc.onconnectionstatechange = () => {
      if (this.settings.debug) {
        console.debug('[BRIDGE]', 'RTCPeerConnection state for', peerId, pc.connectionState);
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        this.disconnectWebRTCPeer(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (this.settings.debug) {
        console.debug('[BRIDGE]', 'ICE state for', peerId, pc.iceConnectionState);
      }
    };

    return pc;
  }

  _attachDataChannelHandlers (peerId, dc) {
    dc.onopen = () => {
      if (this.settings.debug) {
        console.debug('[BRIDGE]', 'WebRTC data channel open to', peerId);
      }
      const entry = this._rtcPeers.get(peerId);
      if (entry) entry.dc = dc;
      const existing = this.webrtcPeers.get(peerId) || {};
      this.webrtcPeers.set(peerId, Object.assign({}, existing, {
        id: peerId,
        status: 'connected',
        direction: (entry && entry.initiator) ? 'outbound' : 'inbound',
        connectedAt: existing.connectedAt || Date.now(),
        lastSeen: Date.now(),
        connection: dc
      }));
      this._connectingPeers.delete(peerId);
      if (this._webrtcConnectTimers.has(peerId)) {
        clearTimeout(this._webrtcConnectTimers.get(peerId));
        this._webrtcConnectTimers.delete(peerId);
      }
      this._webrtcConnected = true;
      this.setState({ webrtcConnected: true });
      this._webrtcRewardPeer(peerId, 3, 'data-channel-open');
      this._hubReportWebRTCPeerConnected(peerId, (entry && entry.initiator) ? 'outbound' : 'inbound');
      // Gossip our peer list to the new peer so cross-cluster discovery can begin
      setTimeout(() => this._sendWebRTCPeerGossip(peerId), 500);
    };

    dc.onmessage = (ev) => {
      this.handleWebRTCPeerMessage(peerId, ev.data);
    };

    dc.onclose = () => {
      if (this.settings.debug) {
        console.debug('[BRIDGE]', 'WebRTC data channel closed for', peerId);
      }
      this.disconnectWebRTCPeer(peerId);
    };

    dc.onerror = (err) => {
      console.error('[BRIDGE]', 'WebRTC data channel error for', peerId, safeIdentityErr(err));
    };
  }

  /**
   * Handle an incoming native WebRTC signaling message from another browser.
   * @param {string} fromPeerId
   * @param {Object} signal
   */
  handleIncomingWebRTCSignal (fromPeerId, signal) {
    if (!signal || typeof signal !== 'object') return;

    let entry = this._rtcPeers.get(fromPeerId);

    if (!entry) {
      entry = {
        pc: null,
        dc: null,
        status: 'new',
        initiator: false,
        metadata: {},
        makingOffer: false,
        ignoreOffer: false,
        localSessionId: this._newRTCSessionId(fromPeerId),
        remoteSessionId: null,
        localSignalRevision: 0,
        remoteSignalRevision: 0,
        // Deterministic role assignment avoids symmetric "offer glare".
        // Lower peerId acts as polite peer and resolves collisions.
        polite: this.peerId ? this.peerId < fromPeerId : true
      };
      const pc = this._createRTCPeerConnection(fromPeerId, entry);
      entry.pc = pc;
      this._rtcPeers.set(fromPeerId, entry);

      pc.ondatachannel = (ev) => {
        const dc = ev.channel;
        this._attachDataChannelHandlers(fromPeerId, dc);
        entry.dc = dc;
      };
    }

    const { pc } = entry;
    if (!entry.signalQueue) entry.signalQueue = Promise.resolve();

    entry.signalQueue = entry.signalQueue.then(async () => {
      const meta = this._getRTCSignalMeta(signal);
      if (!meta || meta.protocol !== 'fabric-webrtc-v2' || !meta.sessionId) {
        console.debug('[BRIDGE]', 'Dropping unversioned/stale WebRTC signal from', fromPeerId);
        return;
      }

      if (meta.targetSessionId && meta.targetSessionId !== entry.localSessionId) {
        // Expected when other peers continue signaling stale sessions.
        return;
      }

      if (signal.type === 'offer' && signal.sdp) {
        if (
          entry.remoteSessionId &&
          meta.sessionId === entry.remoteSessionId &&
          Number.isFinite(meta.revision) &&
          meta.revision <= entry.remoteSignalRevision
        ) {
          console.debug('[BRIDGE]', 'Dropping stale WebRTC offer revision from', fromPeerId);
          return;
        }

        if (!entry.remoteSessionId || entry.remoteSessionId !== meta.sessionId) {
          entry.remoteSessionId = meta.sessionId;
          entry.remoteSignalRevision = 0;
          this._rtcPendingIce.delete(fromPeerId);
        }

        if (Number.isFinite(meta.revision)) {
          entry.remoteSignalRevision = Math.max(entry.remoteSignalRevision || 0, meta.revision);
        }

        const offerDescription = new RTCSessionDescription(signal.sdp);

        if (pc.currentRemoteDescription && pc.currentRemoteDescription.sdp === offerDescription.sdp) {
          console.debug('[BRIDGE]', 'Ignoring duplicate WebRTC offer from', fromPeerId);
          return;
        }

        const offerCollision = entry.makingOffer || pc.signalingState !== 'stable';

        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) {
          console.debug('[BRIDGE]', 'Ignoring colliding offer from impolite side:', fromPeerId);
          return;
        }

        if (offerCollision && pc.signalingState !== 'stable') {
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription(offerDescription)
          ]);
        } else {
          await pc.setRemoteDescription(offerDescription);
        }

        if (pc.signalingState !== 'have-remote-offer') {
          console.debug('[BRIDGE]', 'Skipping answer for', fromPeerId, 'in state', pc.signalingState);
          return;
        }

        const answer = await pc.createAnswer();
        if (pc.signalingState !== 'have-remote-offer') {
          console.debug('[BRIDGE]', 'Answer became stale for', fromPeerId, 'in state', pc.signalingState);
          return;
        }
        await pc.setLocalDescription(answer);

        const answerSignal = this._withRTCSignalMeta(entry, {
          type: 'answer',
          sdp: pc.localDescription
        }, {
          targetSessionId: entry.remoteSessionId
        });
        this.sendWebRTCSignal(fromPeerId, answerSignal);

        const queued = this._rtcPendingIce.get(fromPeerId);
        if (queued && queued.length) {
          for (const cand of queued) {
            pc.addIceCandidate(new RTCIceCandidate(cand)).catch(err => {
              console.error('[BRIDGE]', 'Error adding queued ICE candidate from', fromPeerId, safeIdentityErr(err));
            });
          }
          this._rtcPendingIce.delete(fromPeerId);
        }
      } else if (signal.type === 'answer' && signal.sdp) {
        if (
          entry.remoteSessionId &&
          meta.sessionId !== entry.remoteSessionId
        ) {
          console.debug('[BRIDGE]', 'Dropping answer from stale remote session for', fromPeerId);
          return;
        }

        if (!entry.remoteSessionId) {
          entry.remoteSessionId = meta.sessionId;
        }

        if (
          Number.isFinite(meta.revision) &&
          meta.revision <= (entry.remoteSignalRevision || 0)
        ) {
          console.debug('[BRIDGE]', 'Dropping stale WebRTC answer revision from', fromPeerId);
          return;
        }
        if (Number.isFinite(meta.revision)) {
          entry.remoteSignalRevision = Math.max(entry.remoteSignalRevision || 0, meta.revision);
        }

        if (pc.signalingState !== 'have-local-offer') {
          console.debug('[BRIDGE]', 'Ignoring unexpected WebRTC answer from', fromPeerId, 'in state', pc.signalingState);
          return;
        }

        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      } else if (signal.type === 'ice-candidate' && signal.candidate) {
        if (entry.remoteSessionId && meta.sessionId !== entry.remoteSessionId) {
          console.debug('[BRIDGE]', 'Dropping ICE from stale remote session for', fromPeerId);
          return;
        }
        if (!entry.remoteSessionId) entry.remoteSessionId = meta.sessionId;

        const candInit = signal.candidate;
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(candInit));
        } else {
          const queue = this._rtcPendingIce.get(fromPeerId) || [];
          queue.push(candInit);
          this._rtcPendingIce.set(fromPeerId, queue);
        }
      }
    }).catch(err => {
      const msg = err && err.message ? err.message : String(err);
      if (msg.includes('Called in wrong state') || msg.includes('wrong signalingState')) {
        console.debug('[BRIDGE]', 'Ignoring stale WebRTC signal from', fromPeerId, msg);
        return;
      }

      if (signal.type === 'offer') {
        console.error('[BRIDGE]', 'Error handling WebRTC offer from', fromPeerId, msg);
        return;
      }

      if (signal.type === 'answer') {
        console.error('[BRIDGE]', 'Error handling WebRTC answer from', fromPeerId, msg);
        return;
      }

      console.error('[BRIDGE]', 'Error handling WebRTC signal from', fromPeerId, msg);
    });
  }

  /**
   * Route server-relayed WebRTC signaling payloads.
   * Returns true when a payload is accepted for local processing.
   * @param {Object} result
   * @returns {boolean}
   */
  _handleWebRTCSignalResult (result) {
    if (!result || typeof result !== 'object') return false;
    if (result.type !== 'WebRTCSignal') return false;
    if (!result.signal || !result.fromPeerId) return false;

    // Hub relays signaling to all browser clients. Only the intended recipient
    // should process the payload.
    if (result.toPeerId && this.peerId && result.toPeerId !== this.peerId) {
      return false;
    }

    this.handleIncomingWebRTCSignal(result.fromPeerId, result.signal);
    return true;
  }

  /**
   * Return the display name for a peer (nickname if set, else actorId).
   * Used in chat to show user-friendly names.
   * @param {string} actorId - Peer id or address from chat.actor.id
   * @returns {string} Nickname if set, otherwise actorId
   */
  getPeerDisplayName (actorId) {
    if (!actorId || typeof actorId !== 'string') return actorId || 'unknown';
    const ns = this.state?.networkStatus || this.state?.lastNetworkStatus;
    const peers = Array.isArray(ns?.peers) ? ns.peers : [];
    const peer = peers.find((p) => p && (p.id === actorId || p.address === actorId));
    const nickname = peer && peer.nickname && String(peer.nickname).trim();
    if (nickname) return nickname;
    const xFromFabric = peer && extractPeerXpub(peer);
    if (xFromFabric) return shortenPublicId(xFromFabric, 12, 10);
    if (isLikelyBip32ExtendedKey(actorId)) return shortenPublicId(actorId, 12, 10);
    const wrtc = Array.isArray(ns?.webrtcPeers) ? ns.webrtcPeers : [];
    const w = wrtc.find((p) => {
      if (!p || typeof p !== 'object') return false;
      if (p.id === actorId) return true;
      const m = p.metadata && typeof p.metadata === 'object' ? p.metadata : {};
      return !!(m.fabricPeerId && String(m.fabricPeerId) === actorId);
    });
    const wx = w && w.metadata && typeof w.metadata === 'object' && w.metadata.xpub
      ? String(w.metadata.xpub).trim()
      : '';
    if (wx && isLikelyBip32ExtendedKey(wx)) return shortenPublicId(wx, 12, 10);
    return actorId;
  }

  /**
   * Return the hub node's pubkey for display (e.g. in footer).
   * Reads from networkStatus.network or top-level status fields.
   * @returns {string} pubkey, id, or address from network status, or empty string
   */
  getNodePubkey () {
    const ns = this.state?.networkStatus || this.state?.lastNetworkStatus;
    if (!ns || typeof ns !== 'object') return '';
    const network = ns.network;
    if (network && typeof network === 'object') {
      // Prefer extended public key as the primary node identifier.
      const v = network.xpub || network.pubkey || network.id || network.address;
      if (v) return String(v);
    }
    // Fall back to top-level fields commonly exposed by GetNetworkStatus,
    // including xpub for the node's long-lived identity.
    return ns.xpub || ns.pubkey || ns.id || ns.address || '';
  }

  // Global state management methods
  getGlobalState () {
    return this.globalState;
  }

  updateGlobalState (patchMessage) {
    try {
      let next = null;
      if (this._fabricStore && typeof this._fabricStore.PATCH === 'function') {
        next = this._fabricStore.PATCH(patchMessage);
      } else {
        const jsonPatch = [patchMessage];
        const result = applyPatch(this.globalState, jsonPatch, true, false);
        next = result && result.newDocument;
      }

      if (next) {
        this.globalState = next;

        // Persist messages when patch touches /messages
        const path = patchMessage && patchMessage.path;
        if (typeof path === 'string' && (path === '/messages' || path.startsWith('/messages/'))) {
          this._persistMessages();
        }
        if (typeof path === 'string' && (path === '/documents' || path.startsWith('/documents/'))) {
          this._persistDocuments();
        }

        // Emit a custom event to notify components of state changes
        const event = new CustomEvent('globalStateUpdate', {
          detail: {
            operation: patchMessage,
            globalState: this.globalState
          }
        });

        window.dispatchEvent(event);

        // Keep `networkStatus` in sync when the hub pushes wallet-safe Bitcoin fields (`/bitcoin`).
        if (typeof path === 'string' && path === '/bitcoin' && patchMessage.value && typeof patchMessage.value === 'object') {
          this.setState((prev) => {
            const merge = (ns) => {
              if (!ns || typeof ns !== 'object') return ns;
              const prevBtc = ns.bitcoin && typeof ns.bitcoin === 'object' ? ns.bitcoin : {};
              return { ...ns, bitcoin: { ...prevBtc, ...patchMessage.value } };
            };
            return {
              networkStatus: merge(prev.networkStatus),
              lastNetworkStatus: merge(prev.lastNetworkStatus)
            };
          });
        }
      } else {
        console.error('[BRIDGE]', 'Failed to apply JSON-Patch.');
      }

    } catch (error) {
      console.error('[BRIDGE]', 'Error updating global state:', safeIdentityErr(error));
    }
  }

  _hasLocalStorage () {
    try {
      // Accessing window.localStorage can throw under opaque origins (SSR/build contexts).
      return (typeof window !== 'undefined' && !!window.localStorage);
    } catch (e) {
      return false;
    }
  }

  _readJSONFromStorage (key, fallback = null) {
    if (!this._hasLocalStorage()) return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[BRIDGE]', `Could not read ${key} from storage:`, safeIdentityErr(e));
      return fallback;
    }
  }

  _writeJSONToStorage (key, value) {
    if (!this._hasLocalStorage()) return false;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[BRIDGE]', `Could not persist ${key}:`, safeIdentityErr(e));
      return false;
    }
  }

  _removeStorageKey (key) {
    if (!this._hasLocalStorage()) return false;
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.warn('[BRIDGE]', `Could not remove ${key} from storage:`, safeIdentityErr(e));
      return false;
    }
  }

  _persistGlobalState () {
    if (!this._fabricStore || typeof this._fabricStore.PUT !== 'function') return;
    try {
      this._fabricStore.PUT('/', this.globalState, { persist: true });
    } catch (e) {}
  }

  _persistDocuments () {
    const docs = this.globalState.documents || {};
    this._writeJSONToStorage('fabric:documents', docs);
    if (this._fabricStore && typeof this._fabricStore.PUT === 'function') {
      try {
        this._fabricStore.PUT('/documents', docs, { persist: true });
      } catch (e) {}
    }
  }

  /**
   * Parse chat content as a Distribute Proposal. Returns proposal object or null.
   * Proposals are sent as P2P_CHAT_MESSAGE with JSON content: { type: 'DistributeProposal', documentId, amountSats, config, ... }
   */
  _parseDistributeProposal (content, chatEnvelope) {
    if (!content || typeof content !== 'string') return null;
    try {
      const parsed = JSON.parse(content);
      if (!parsed || parsed.type !== 'DistributeProposal') return null;
      const documentId = parsed.documentId || parsed.document?.id || parsed.document?.sha256;
      const amountSats = Number(parsed.amountSats || 0);
      if (!documentId || !Number.isFinite(amountSats) || amountSats <= 0) return null;
      const senderAddress = (chatEnvelope && chatEnvelope.actor && chatEnvelope.actor.id) || null;
      const created = (chatEnvelope && chatEnvelope.object && chatEnvelope.object.created) || (chatEnvelope && chatEnvelope.created) || Date.now();
      return {
        id: `proposal:${created}:${senderAddress || 'unknown'}`,
        documentId,
        amountSats,
        config: parsed.config || {},
        document: parsed.document || null,
        documentName: parsed.documentName || (parsed.document && parsed.document.name) || documentId,
        senderAddress,
        receivedAt: created,
        status: 'pending'
      };
    } catch (e) {
      return null;
    }
  }

  _storeDistributeProposal (proposal) {
    if (!proposal || !proposal.id) return;
    this.globalState.distributeProposals = this.globalState.distributeProposals || {};
    this.globalState.distributeProposals[proposal.id] = proposal;
    this._writeJSONToStorage('fabric:distributeProposals', this.globalState.distributeProposals);
    if (this._fabricStore && typeof this._fabricStore.PUT === 'function') {
      try {
        this._fabricStore.PUT('/distributeProposals', this.globalState.distributeProposals, { persist: true });
      } catch (e) {}
    }
    window.dispatchEvent(new CustomEvent('distributeProposalReceived', { detail: { proposal } }));
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'add', path: `/distributeProposals/${proposal.id}`, value: proposal },
        globalState: this.globalState
      }
    }));
  }

  /**
   * Structured federation invite / response in P2P chat JSON (v1).
   * @param {string} content
   * @param {object|null} chatEnvelope
   * @returns {boolean} true when handled (do not also treat as plain chat)
   */
  _tryDispatchFederationContractInviteFromChat (content, chatEnvelope) {
    if (typeof window === 'undefined') return false;
    const inv = parseFederationContractInvite(content);
    if (inv) {
      const toPeerId = chatEnvelope && chatEnvelope.actor && chatEnvelope.actor.id
        ? String(chatEnvelope.actor.id)
        : '';
      window.dispatchEvent(new CustomEvent('fabric:federationContractInvite', {
        detail: Object.assign({}, inv, { toPeerId })
      }));
      return true;
    }
    const res = parseFederationContractInviteResponse(content);
    if (res) {
      const fromPeerId = chatEnvelope && chatEnvelope.actor && chatEnvelope.actor.id
        ? String(chatEnvelope.actor.id)
        : '';
      window.dispatchEvent(new CustomEvent('fabric:federationContractInviteResponse', {
        detail: Object.assign({}, res, { fromPeerId })
      }));
      return true;
    }
    return false;
  }

  /** @returns {import('@fabric/core/types/key')|null} Key with private for document encrypt/decrypt */
  _getDocumentKey () {
    const key = this.settings.signingKey || this.key;
    if (!key || typeof key.encrypt !== 'function' || typeof key.decrypt !== 'function') return null;
    if (key.private == null) return null;
    return key;
  }

  /** @returns {boolean} True if we have a key for document encryption (required for adding files). */
  hasDocumentEncryptionKey () {
    return !!this._getDocumentKey();
  }

  _encryptContent (contentBase64) {
    const key = this._getDocumentKey();
    if (!key) return null;
    try {
      return key.encrypt(contentBase64);
    } catch (e) {
      console.warn('[BRIDGE]', 'Document encrypt failed:', safeIdentityErr(e));
      return null;
    }
  }

  _decryptContent (contentEncrypted) {
    const key = this._getDocumentKey();
    if (!key || !contentEncrypted) return null;
    try {
      return key.decrypt(contentEncrypted);
    } catch (e) {
      console.warn('[BRIDGE]', 'Document decrypt failed:', safeIdentityErr(e));
      return null;
    }
  }

  /**
   * Resolve the current identity key for this Bridge instance.
   * Prefers the signing key (auth) and falls back to the legacy `this.key` when present.
   * @returns {import('@fabric/core/types/key')|null}
   */
  _getIdentityKey () {
    const key = this.settings.signingKey || this.key;
    if (!key || !key.id) return null;
    return key;
  }

  /**
   * Resolve the stable identity id for this Bridge instance.
   * @returns {string|null}
   */
  _getIdentityId () {
    // Prefer an extended public key (xpub) as the stable public identifier,
    // falling back to shorter ids only when necessary.
    const auth = this.props && this.props.auth;
    if (auth) {
      if (auth.xpub) return auth.xpub;
      if (auth.id) return auth.id;
    }

    const key = this._getIdentityKey();
    if (!key) return null;
    if (key.xpub) return key.xpub;
    return key.id || null;
  }

  /**
   * True when a private signing identity is available in-memory.
   * @returns {boolean}
   */
  _hasUnlockedIdentity () {
    const auth = this.props && this.props.auth;
    if (auth && auth.xprv) return true;
    const key = this._getIdentityKey();
    if (key && key.xprv) return true;
    return false;
  }

  /**
   * Whether chat-capable identity material is currently available.
   * @returns {boolean}
   */
  hasUnlockedIdentity () {
    return this._hasUnlockedIdentity();
  }

  _notifyIdentityUnlockRequired (message) {
    const auth = this.props && this.props.auth;
    const resolved = typeof message === 'string' && message.trim()
      ? message
      : fabricIdentityChatDisabledReasonPlain(auth);
    try {
      window.dispatchEvent(new CustomEvent('fabric:chatWarning', {
        detail: {
          reason: 'identity-locked',
          message: resolved
        }
      }));
    } catch (e) {}

    if (this.props && typeof this.props.onRequireUnlock === 'function') {
      const now = Date.now();
      if (this._lastIdentityUnlockUiNotifyAt && now - this._lastIdentityUnlockUiNotifyAt < 2500) {
        return;
      }
      this._lastIdentityUnlockUiNotifyAt = now;
      try {
        this.props.onRequireUnlock();
      } catch (e) {}
    }
  }

  /**
   * Find a document row when the route id may differ from the map key (opaque id vs content hash).
   * @param {string} logicalId
   * @returns {{ key: string, doc: object }|null}
   */
  _resolveDocumentRow (logicalId) {
    if (!logicalId || !this.globalState || !this.globalState.documents) return null;
    const id = String(logicalId).trim();
    if (!id) return null;
    const map = this.globalState.documents;
    if (map[id]) return { key: id, doc: map[id] };
    const lower = id.toLowerCase();
    if (map[lower]) return { key: lower, doc: map[lower] };
    for (const [k, d] of Object.entries(map)) {
      if (!d || typeof d !== 'object') continue;
      const did = d.id != null ? String(d.id) : '';
      const sha = d.sha256 != null ? String(d.sha256) : (d.sha != null ? String(d.sha) : '');
      if (did === id || sha === id || did.toLowerCase() === lower || sha.toLowerCase() === lower) {
        return { key: k, doc: d };
      }
    }
    return null;
  }

  /**
   * Return document content (base64) for display or upload. Decrypts if stored encrypted.
   * @param {string} id - Document id
   * @returns {string|null} contentBase64 or null
   */
  getDecryptedDocumentContent (id) {
    if (!id) return null;
    const row = this._resolveDocumentRow(id);
    if (!row || !row.doc) return null;
    const doc = row.doc;
    // For encrypted documents, only ever return plaintext when we have a live document key.
    if (doc.contentEncrypted) {
      const decrypted = this._decryptContent(doc.contentEncrypted);
      return decrypted || null;
    }
    // For unencrypted documents, stored as plain contentBase64.
    if (doc.contentBase64) return doc.contentBase64;
    return null;
  }

  /** Normalize incoming doc for storage: encrypt content if we have a key, store only encrypted or plain.
   * If we already have a local alias for this document (by sha256), prefer that id over a backend sha id.
   */
  _storeDocument (id, doc) {
    if (!doc || !id) return;
    this.globalState.documents = this.globalState.documents || {};

    let targetId = id;
    const sha = doc.sha256 || doc.sha || null;

    // If hub sends us a sha-based id but we previously created a local Actor id with the same sha,
    // re-use the local Actor id so URLs remain opaque.
    if (sha && id === sha) {
      for (const [localId, existingDoc] of Object.entries(this.globalState.documents)) {
        if (existingDoc && (existingDoc.sha256 === sha || existingDoc.sha === sha) && localId !== id) {
          targetId = localId;
          break;
        }
      }
    }

    const existing = this.globalState.documents[targetId] || {};
    const merged = { ...existing, ...doc, id: targetId };
    const hasContent = merged.contentBase64 != null;
    const encrypted = hasContent ? this._encryptContent(merged.contentBase64) : null;
    const toStore = { ...merged };
    if (encrypted != null) {
      toStore.contentEncrypted = encrypted;
      delete toStore.contentBase64;
    } else if (!hasContent && merged.contentEncrypted != null) {
      toStore.contentEncrypted = merged.contentEncrypted;
      delete toStore.contentBase64;
    }
    this.globalState.documents[targetId] = toStore;

    // Clean up any old sha-only entry if we moved to a local alias id.
    if (targetId !== id && this.globalState.documents[id]) {
      delete this.globalState.documents[id];
    }
  }

  _pruneP2pFileReceivers () {
    const TTL = 10 * 60 * 1000;
    const now = Date.now();
    for (const [k, v] of this._p2pFileReceivers) {
      if (!v || now - (v.startedAt || 0) > TTL) this._p2pFileReceivers.delete(k);
    }
  }

  _resolveDocumentTargetId (rawId, meta) {
    let targetId = rawId;
    const sha = meta && (meta.sha256 || meta.sha);
    this.globalState.documents = this.globalState.documents || {};
    if (sha && rawId === sha) {
      for (const [localId, existingDoc] of Object.entries(this.globalState.documents)) {
        if (existingDoc && (existingDoc.sha256 === sha || existingDoc.sha === sha) && localId !== rawId) {
          targetId = localId;
          break;
        }
      }
    }
    return targetId;
  }

  _decodeBase64ToUint8 (b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  _uint8ToBase64 (u8) {
    let bin = '';
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }

  _bytesToHex (buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u8.length; i++) {
      const h = u8[i].toString(16);
      s += h.length === 1 ? `0${h}` : h;
    }
    return s;
  }

  _hexToUint8 (hex) {
    const s = String(hex).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(s)) return null;
    const u = new Uint8Array(32);
    for (let i = 0; i < 32; i++) u[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return u;
  }

  _handleP2pFileChunk (doc, part) {
    const transferId = String(part.transferId || '');
    const index = Number(part.index);
    const total = Number(part.total);
    if (!transferId || !Number.isFinite(index) || !Number.isFinite(total) || total < 1 || index < 0 || index >= total) {
      console.warn('[BRIDGE] Invalid P2P file part metadata');
      return;
    }
    this._pruneP2pFileReceivers();
    let state = this._p2pFileReceivers.get(transferId);
    if (!state) {
      state = {
        transferId,
        total,
        chunks: new Array(total),
        received: 0,
        startedAt: Date.now(),
        meta: null,
        htlcFileV1: null
      };
      this._p2pFileReceivers.set(transferId, state);
    }
    if (state.total !== total) {
      console.warn('[BRIDGE] P2P file part total mismatch');
      return;
    }
    if (state.chunks[index]) return;
    if (index === 0) {
      state.meta = {
        id: doc.id,
        name: doc.name,
        mime: doc.mime,
        size: doc.size,
        sha256: doc.sha256,
        created: doc.created,
        target: doc.target,
        htlcSettlement: doc.htlcSettlement,
        deliveryFabricId: doc.deliveryFabricId,
        fileRelayTtl: doc.fileRelayTtl
      };
      if (doc.htlcFileV1 && Number(doc.htlcFileV1.v) === 1 && doc.htlcFileV1.iv && doc.htlcFileV1.paymentHashHex) {
        state.htlcFileV1 = doc.htlcFileV1;
      }
    }
    state.chunks[index] = doc.contentBase64;
    state.received++;
    if (state.received < state.total) return;

    this._p2pFileReceivers.delete(transferId);
    const pieces = state.chunks.map((b64) => this._decodeBase64ToUint8(b64));
    const len = pieces.reduce((a, u) => a + u.length, 0);
    const merged = new Uint8Array(len);
    let o = 0;
    for (const u of pieces) {
      merged.set(u, o);
      o += u.length;
    }

    const rawId = state.meta.id;
    const targetId = this._resolveDocumentTargetId(rawId, state.meta);

    if (state.htlcFileV1) {
      const h = state.htlcFileV1;
      this.globalState.documents = this.globalState.documents || {};
      const existing = this.globalState.documents[targetId] || {};
      this.globalState.documents[targetId] = {
        ...existing,
        ...state.meta,
        id: targetId,
        htlcPendingDecrypt: true,
        htlcPaymentHashHex: String(h.paymentHashHex).toLowerCase(),
        htlcIvBase64: h.iv,
        htlcCiphertextBase64: this._uint8ToBase64(merged),
        receivedFromPeer: true
      };
      delete this.globalState.documents[targetId].contentBase64;
      if (targetId !== rawId && this.globalState.documents[rawId]) delete this.globalState.documents[rawId];
      this._persistDocuments();
      window.dispatchEvent(new CustomEvent('globalStateUpdate', {
        detail: {
          operation: { op: 'add', path: `/documents/${targetId}`, value: this.globalState.documents[targetId] },
          globalState: this.globalState
        }
      }));
      return;
    }

    const contentBase64 = this._uint8ToBase64(merged);
    this._storeDocument(targetId, { ...state.meta, id: rawId, contentBase64, receivedFromPeer: true });
    this._persistDocuments();
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'add', path: `/documents/${targetId}`, value: this.globalState.documents[targetId] },
        globalState: this.globalState
      }
    }));
  }

  /**
   * After inventory HTLC phase 2, ciphertext is stored locally until the buyer supplies the
   * same 32-byte preimage used for the on-chain hashlock (sha256(document bytes)).
   * @param {string} documentId
   * @param {string} preimageHex - 64 hex chars
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async unlockHtlcEncryptedDocument (documentId, preimageHex) {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      return { ok: false, error: 'Web Crypto API not available in this context.' };
    }
    const id = documentId;
    const doc = this.globalState.documents && this.globalState.documents[id];
    if (!doc || !doc.htlcPendingDecrypt) {
      return { ok: false, error: 'Document is not waiting for an HTLC preimage.' };
    }
    const preimageU8 = this._hexToUint8(preimageHex);
    if (!preimageU8) {
      return { ok: false, error: 'Preimage must be 64 hex characters (32 bytes).' };
    }
    const hashBuf = await crypto.subtle.digest('SHA-256', preimageU8);
    const hashHex = this._bytesToHex(new Uint8Array(hashBuf)).toLowerCase();
    const expected = String(doc.htlcPaymentHashHex || '').toLowerCase();
    if (!expected || hashHex !== expected) {
      return { ok: false, error: 'Preimage does not match the HTLC payment hash for this transfer.' };
    }
    let iv;
    let ct;
    try {
      iv = this._decodeBase64ToUint8(doc.htlcIvBase64);
      ct = this._decodeBase64ToUint8(doc.htlcCiphertextBase64);
    } catch (e) {
      return { ok: false, error: 'Stored ciphertext or IV is invalid.' };
    }
    const key = await crypto.subtle.importKey('raw', preimageU8, { name: 'AES-GCM' }, false, ['decrypt']);
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, ct);
    } catch (e) {
      return { ok: false, error: 'Decryption failed (wrong key or corrupted ciphertext).' };
    }
    const contentBase64 = this._uint8ToBase64(new Uint8Array(plain));
    const cleaned = { ...doc };
    delete cleaned.htlcPendingDecrypt;
    delete cleaned.htlcPaymentHashHex;
    delete cleaned.htlcIvBase64;
    delete cleaned.htlcCiphertextBase64;
    this._storeDocument(id, { ...cleaned, contentBase64, receivedFromPeer: true });
    this._persistDocuments();
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'add', path: `/documents/${id}`, value: this.globalState.documents[id] },
        globalState: this.globalState
      }
    }));
    return { ok: true };
  }

  _persistMessages () {
    const messages = this.globalState.messages || {};
    const keys = Object.keys(messages).filter((k) => {
      const m = messages[k];
      return !(m && isDelegationSignatureRequestActivity(m));
    });
    const filtered = {};
    for (const k of keys) filtered[k] = messages[k];
    // Cap at 500 messages to avoid localStorage bloat
    const toStore = keys.length > 500
      ? Object.fromEntries(keys.sort((a, b) => {
          const ta = (filtered[a] && filtered[a].object && filtered[a].object.created) || 0;
          const tb = (filtered[b] && filtered[b].object && filtered[b].object.created) || 0;
          return ta - tb;
        }).slice(-500).map((k) => [k, filtered[k]]))
      : filtered;
    if (!this._messageCollection) this._messageCollection = new BridgeMessageCollection();
    this._messageCollection.loadMap(toStore);
    this.globalState.messages = this._messageCollection.exportMap();
    this._writeJSONToStorage('fabric:messages', this.globalState.messages);
    if (this._fabricStore && typeof this._fabricStore.PUT === 'function') {
      try {
        this._fabricStore.PUT('/messages', this.globalState.messages, { persist: true });
      } catch (e) {}
    }
  }

  _onClientBalanceUpdate (ev) {
    try {
      const d = ev && ev.detail;
      if (!d) return;
      const walletId = String(d.walletId || 'default');
      const balanceSats = Math.round(Number(d.balanceSats));
      if (!Number.isFinite(balanceSats)) return;
      const confirmedRaw = d.confirmedSats;
      const unconfirmedRaw = d.unconfirmedSats;
      const hasSplit = confirmedRaw != null && unconfirmedRaw != null;
      const conf = hasSplit
        ? Math.round(Number(confirmedRaw))
        : balanceSats;
      const unconf = hasSplit ? Math.round(Number(unconfirmedRaw)) : 0;
      const confSafe = Number.isFinite(conf) ? conf : balanceSats;
      const unconfSafe = Number.isFinite(unconf) ? unconf : 0;
      const hint = d.hintTxid ? String(d.hintTxid).trim() : '';

      if (!this._walletBalanceBaseline.has(walletId)) {
        this._walletBalanceBaseline.add(walletId);
        this._lastWalletBalanceTotal[walletId] = balanceSats;
        this._lastWalletConfirmedSats[walletId] = confSafe;
        this._lastWalletUnconfirmedSats[walletId] = unconfSafe;
        return;
      }
      const prevTotal = this._lastWalletBalanceTotal[walletId];
      const prevC = this._lastWalletConfirmedSats[walletId];
      const prevU = this._lastWalletUnconfirmedSats[walletId];
      if (!Number.isFinite(prevTotal)) {
        this._lastWalletBalanceTotal[walletId] = balanceSats;
        this._lastWalletConfirmedSats[walletId] = confSafe;
        this._lastWalletUnconfirmedSats[walletId] = unconfSafe;
        return;
      }

      let dUnconf = 0;
      let dConf = 0;
      if (hasSplit) {
        dUnconf = unconfSafe - (Number.isFinite(prevU) ? prevU : 0);
        dConf = confSafe - (Number.isFinite(prevC) ? prevC : 0);
      }

      if (hasSplit && dUnconf > 0) {
        this._appendPrivateWalletReceiveNotice({
          phase: 'mempool',
          deltaSats: dUnconf,
          balanceSats,
          confirmedSats: confSafe,
          unconfirmedSats: unconfSafe,
          walletId,
          txid: hint
        });
      }
      if (hasSplit && dConf > 0) {
        this._appendPrivateWalletReceiveNotice({
          phase: 'confirmed',
          deltaSats: dConf,
          balanceSats,
          confirmedSats: confSafe,
          unconfirmedSats: unconfSafe,
          walletId,
          txid: hint
        });
      }

      const totalIncreased = balanceSats > prevTotal;
      if (totalIncreased && (!hasSplit || (dUnconf <= 0 && dConf <= 0))) {
        this._appendPrivateWalletReceiveNotice({
          phase: 'aggregate',
          deltaSats: balanceSats - prevTotal,
          balanceSats,
          confirmedSats: confSafe,
          unconfirmedSats: unconfSafe,
          walletId,
          txid: hint
        });
      }

      this._lastWalletBalanceTotal[walletId] = balanceSats;
      this._lastWalletConfirmedSats[walletId] = confSafe;
      this._lastWalletUnconfirmedSats[walletId] = unconfSafe;
    } catch (e) { /* ignore */ }
  }

  /**
   * Local-only activity + toast + in-app notification list on Activities (bell, top bar).
   * @param {object} p
   * @param {'mempool'|'confirmed'|'aggregate'} p.phase
   */
  _appendPrivateWalletReceiveNotice (p) {
    if (typeof window === 'undefined' || !p) return;
    const {
      phase = 'aggregate',
      deltaSats,
      balanceSats,
      confirmedSats,
      unconfirmedSats,
      walletId,
      txid
    } = p;
    const d = Math.round(Number(deltaSats));
    if (!Number.isFinite(d) || d <= 0) return;

    const id = `client-wallet-${phase}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const created = new Date().toISOString();
    const totalLabel = formatSatsDisplay(balanceSats);
    const confU = `${formatSatsDisplay(confirmedSats)} conf · ${formatSatsDisplay(unconfirmedSats)} unconf`;
    let content;
    let title;
    let subtitle;
    let toastHeader;
    let toastMsg;
    let kind;
    if (phase === 'mempool') {
      content = `Unconfirmed +${formatSatsDisplay(d)} sats to your wallet (mempool). ${confU}. Total ~${totalLabel}.`;
      title = 'Incoming (mempool)';
      subtitle = `+${formatSatsDisplay(d)} unconfirmed · ${totalLabel} total`;
      toastHeader = 'Wallet';
      toastMsg = `+${formatSatsDisplay(d)} unconfirmed (mempool)`;
      kind = 'wallet_receive_mempool';
    } else if (phase === 'confirmed') {
      content = `Confirmed +${formatSatsDisplay(d)} sats. ${confU}. Total ${totalLabel}.`;
      title = 'Incoming confirmed';
      subtitle = `+${formatSatsDisplay(d)} confirmed · ${formatSatsDisplay(confirmedSats)} conf`;
      toastHeader = 'Wallet';
      toastMsg = `+${formatSatsDisplay(d)} confirmed on-chain`;
      kind = 'wallet_receive_confirmed';
    } else {
      content = `Your wallet balance increased by +${formatSatsDisplay(d)} (${totalLabel} total).`;
      title = 'Incoming payment';
      subtitle = `+${formatSatsDisplay(d)} · ${totalLabel} balance`;
      toastHeader = 'Wallet';
      toastMsg = `+${formatSatsDisplay(d)} received`;
      kind = 'wallet_receive';
    }

    this.globalState.messages = this.globalState.messages || {};
    this.globalState.messages[id] = {
      type: 'CLIENT_NOTICE',
      object: {
        content,
        created,
        txid: txid || undefined,
        kind,
        phase,
        localOnly: true
      }
    };
    this._persistMessages();
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'add', path: `/messages/${id}`, value: this.globalState.messages[id] },
        globalState: this.globalState
      }
    }));
    try {
      toast.success(toastMsg, {
        header: toastHeader,
        duration: 5500
      });
    } catch (e) { /* ignore */ }
    try {
      const uf = loadHubUiFeatureFlags();
      pushUiNotification({
        id: `wallet-${phase}-${walletId}-${Date.now()}`,
        kind,
        title,
        subtitle,
        href: uf.bitcoinPayments ? '/payments' : undefined,
        copyText: txid || undefined
      });
    } catch (e) { /* ignore */ }
  }

  /**
   * Invoice L1 verify flow (see Invoice.js) — private CLIENT_NOTICE + toast + Activities in-app list.
   */
  applyL1InvoicePaymentActivity (detail) {
    if (typeof window === 'undefined' || !detail || typeof detail !== 'object') return;
    const txid = String(detail.txid || '').trim();
    if (!txid) return;
    const kind = detail.kind === 'confirmed' ? 'confirmed' : 'unconfirmed';
    const dedupeKey = `${kind}:${txid}`;
    if (this._l1InvoiceActivityKeys.has(dedupeKey)) return;
    this._l1InvoiceActivityKeys.add(dedupeKey);
    const label = detail.label ? String(detail.label) : 'Invoice';
    const created = new Date().toISOString();
    const content = kind === 'confirmed'
      ? `L1 invoice payment confirmed${detail.confirmations ? ` (${detail.confirmations} confirmations)` : ''}: ${label}`
      : `L1 invoice payment seen (mempool): ${label}`;
    const id = `client-l1-inv-${kind}-${txid.slice(0, 18)}`;
    this.globalState.messages = this.globalState.messages || {};
    this.globalState.messages[id] = {
      type: 'CLIENT_NOTICE',
      object: {
        content,
        created,
        txid,
        kind: 'l1_invoice',
        localOnly: true
      }
    };
    this._persistMessages();
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'add', path: `/messages/${id}`, value: this.globalState.messages[id] },
        globalState: this.globalState
      }
    }));
    try {
      toast.success(kind === 'confirmed' ? 'Invoice paid on-chain' : 'Invoice payment detected', {
        duration: 5000,
        header: label.length > 36 ? `${label.slice(0, 36)}…` : label
      });
    } catch (e) { /* ignore */ }
    try {
      const uf = loadHubUiFeatureFlags();
      pushUiNotification({
        id: `l1-inv-${dedupeKey}`,
        kind: 'l1_invoice',
        title: kind === 'confirmed' ? 'Invoice confirmed' : 'Invoice in mempool',
        subtitle: `${label} · ${txid.slice(0, 14)}…`,
        href: uf.bitcoinExplorer ? `/services/bitcoin/transactions/${encodeURIComponent(txid)}` : undefined,
        copyText: txid
      });
    } catch (e) { /* ignore */ }
  }

  /**
   * Activity stream row for Hub delegation signing (same panel as public chat; channel #delegation).
   */
  _emitDelegationSignRequestActivity ({ messageId, preview, purpose }) {
    if (!messageId) return;
    const id = `delegation-${messageId}`;
    const actorId = this._getIdentityId() || 'local';
    const created = Date.now();
    this.globalState.messages = this.globalState.messages || {};
    this.globalState.messages[id] = {
      type: DELEGATION_SIGNATURE_REQUEST,
      actor: { id: actorId },
      object: {
        content: typeof preview === 'string' ? preview : '',
        purpose: typeof purpose === 'string' ? purpose : 'sign',
        messageId,
        created,
        channel: 'delegation',
        status: 'pending'
      },
      status: 'pending'
    };
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'add', path: `/messages/${id}`, value: this.globalState.messages[id] },
        globalState: this.globalState
      }
    }));
    try {
      const pv = typeof preview === 'string' ? preview : '';
      pushUiNotification({
        id: `delegation-req-${messageId}`,
        kind: 'delegation',
        title: 'Signature request',
        subtitle: (pv && pv.slice(0, 120)) || 'Open Security & delegation to respond.',
        href: '/settings/security',
        copyText: String(messageId)
      });
    } catch (e) { /* ignore */ }
  }

  _resolveDelegationSignRequestActivity (messageId, resolution) {
    if (!messageId) return;
    const id = `delegation-${messageId}`;
    const cur = this.globalState.messages && this.globalState.messages[id];
    if (!cur || !isDelegationSignatureRequestActivity(cur)) return;
    const status = resolution === 'approved'
      ? 'approved'
      : resolution === 'timeout'
        ? 'timeout'
        : 'rejected';
    this.globalState.messages[id] = Object.assign({}, cur, {
      status: 'resolved',
      object: Object.assign({}, cur.object, {
        status,
        resolvedAt: Date.now()
      })
    });
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'replace', path: `/messages/${id}`, value: this.globalState.messages[id] },
        globalState: this.globalState
      }
    }));
    try {
      const label = status === 'approved'
        ? 'Signature approved'
        : status === 'timeout'
          ? 'Signature request timed out'
          : 'Signature request rejected';
      pushUiNotification({
        id: `delegation-done-${messageId}`,
        kind: 'delegation_resolved',
        title: label,
        subtitle: String(messageId),
        href: '/settings/security'
      });
    } catch (e) { /* ignore */ }
  }

  /**
   * Add a document to the unified store. Content is encrypted with the user's keypair when available.
   * @param {Object} doc - { id, name, mime, size, sha256, contentBase64, created? }
   */
  addLocalDocument (doc) {
    if (!doc || !doc.id || !doc.contentBase64) return;
    // Require an encryption key for adding documents: keep local storage encrypted-only.
    if (!this._getDocumentKey()) {
      console.warn('[BRIDGE]', 'Rejecting addLocalDocument: no document encryption key available.');
      return;
    }
    const created = doc.created || new Date().toISOString();
    const encrypted = this._encryptContent(doc.contentBase64);
    this.globalState.documents = this.globalState.documents || {};
    const toStore = {
      ...doc,
      created,
      contentBase64: undefined
    };
    if (encrypted != null) {
      toStore.contentEncrypted = encrypted;
    }
    this.globalState.documents[doc.id] = toStore;
    this._persistDocuments();
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'add', path: `/documents/${doc.id}`, value: this.globalState.documents[doc.id] },
        globalState: this.globalState
      }
    }));
  }

  /**
   * Remove a document from local state (e.g. after publishing).
   * @param {string} id - Document id
   */
  removeLocalDocument (id) {
    if (!id || !this.globalState.documents) return;
    delete this.globalState.documents[id];
    this._persistDocuments();
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'remove', path: `/documents/${id}` },
        globalState: this.globalState
      }
    }));
  }

  /**
   * Clear all local documents (e.g. on logout / destroy identity). Persists empty store.
   */
  clearAllDocuments () {
    this.globalState.documents = {};
    this._persistDocuments();
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'replace', path: '/documents', value: {} },
        globalState: this.globalState
      }
    }));
  }

  /**
   * Clear any decrypted content from documents while preserving encrypted blobs.
   * Used when locking the identity so that previously viewed plaintext is not retained in memory/localStorage.
   */
  clearDecryptedDocuments () {
    if (!this.globalState.documents) return;
    let changed = false;
    const docs = this.globalState.documents;
    for (const id of Object.keys(docs)) {
      const doc = docs[id];
      if (!doc || !doc.contentEncrypted) continue;
      if (doc.contentBase64 != null) {
        delete doc.contentBase64;
        changed = true;
      }
    }
    if (!changed) return;
    this._persistDocuments();
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'replace', path: '/documents', value: this.globalState.documents },
        globalState: this.globalState
      }
    }));
  }

  resetGlobalState () {
    this.globalState = {
      conversations: {},
      messages: {},
      users: {},
      documents: {},
      peerTopologyGossip: { byReporter: {} }
    };
  }

  componentDidMount () {
    this.start();

    // Subscribe to initial path
    this.subscribe(this.state.currentPath);

    window.addEventListener('clientBalanceUpdate', this._onClientBalanceUpdate);

    // Listen for path changes
    window.addEventListener('popstate', this.handlePathChange);

    // Call onStateUpdate prop if provided for backward compatibility
    if (this.props.onStateUpdate && typeof this.props.onStateUpdate === 'function') {
      this.props.onStateUpdate(this.state);
    }
  }

  componentDidUpdate (prevProps) {
    // Update signing key when auth changes (e.g. user unlocks identity)
    if (prevProps.auth !== this.props.auth) {
      this.settings.signingKey = this.props.auth ? new Key(this.props.auth) : null;
    }
  }

  componentWillUnmount () {
    this.stop();
    window.removeEventListener('clientBalanceUpdate', this._onClientBalanceUpdate);
    window.removeEventListener('popstate', this.handlePathChange);
  }

  _parseHubAddressString (input) {
    try {
      const raw = input == null ? '' : String(input).trim();
      if (!raw) return null;

      const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
      const baseScheme = this.settings && this.settings.secure ? 'https://' : 'http://';
      const url = new URL(hasScheme ? raw : (baseScheme + raw));

      const proto = (url.protocol || '').replace(':', '');
      const secure = proto === 'https' || proto === 'wss';
      const host = url.hostname;
      const port = url.port ? Number(url.port) : (secure ? 443 : 80);
      if (!host || !port || Number.isNaN(port)) return null;

      const authority = (secure ? 'wss' : 'ws') + `://${host}:${port}`;
      return { host, port, secure, authority, raw: raw };
    } catch (e) {
      return null;
    }
  }

  /**
   * Append optional WS token for hub `settings.websocket` auth (MESSAGE_TRANSPORT.md).
   * Set `window.FABRIC_WS_CLIENT_TOKEN` before Bridge connects when FABRIC_WS_REQUIRE_TOKEN is on.
   */
  _websocketUrlWithAuth (path) {
    const base = `${this.authority}${path}`;
    let token = '';
    try {
      token = (typeof window !== 'undefined' && window.FABRIC_WS_CLIENT_TOKEN)
        ? String(window.FABRIC_WS_CLIENT_TOKEN).trim()
        : '';
    } catch (e) {}
    if (!token) return base;
    const sep = base.indexOf('?') >= 0 ? '&' : '?';
    return `${base}${sep}token=${encodeURIComponent(token)}`;
  }

  _applyHubAddressString (input) {
    const parsed = this._parseHubAddressString(input);
    if (!parsed) return false;
    this.settings.host = parsed.host;
    this.settings.port = parsed.port;
    this.settings.secure = parsed.secure;
    this.settings.authority = parsed.authority;
    this.settings.hubAddress = parsed.raw;
    return true;
  }

  _sendSubscribe (path) {
    if (!path) return;
    const message = Message.fromVector(['SUBSCRIBE', path]);
    const messageBuffer = message.toBuffer();
    this.sendSignedMessage(messageBuffer);
  }

  _resubscribeAll () {
    try {
      const subs = this.state && this.state.subscriptions ? Array.from(this.state.subscriptions) : [];
      subs.forEach((p) => this._sendSubscribe(p));
    } catch (e) {}
  }

  setHubAddress (hubAddress) {
    const ok = this._applyHubAddressString(hubAddress);
    if (!ok) {
      console.warn('[BRIDGE]', 'Invalid hub address:', safeUrlForLog(hubAddress));
      return false;
    }

    // Fully restart so WebSocket + WebRTC signaling use the new host/port.
    try { this.stop(); } catch (e) {}
    try { this.start(); } catch (e) {}
    return true;
  }

  handlePathChange = () => {
    const newPath = window.location.pathname;
    if (newPath !== this.state.currentPath) {
      // Unsubscribe from old path
      this.unsubscribe(this.state.currentPath);
      // Update current path
      this.setState({ currentPath: newPath });
      // Subscribe to new path
      this.subscribe(newPath);
    }
  };

  connect (path) {
    // Clean up any existing WebSocket before creating a new one
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch (e) {
        console.warn('[BRIDGE]', 'Error cleaning up previous WebSocket:', safeIdentityErr(e));
      }
      this.ws = null;
    }

    const wsUrl = this._websocketUrlWithAuth(path);
    if (this.settings.debug) {
      console.debug('[BRIDGE]', 'Opening connection to:', wsUrl);
    }
    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    // Attach Event Handlers
    this.ws.onopen = () => {
      if (this.settings.debug) {
        console.debug('[BRIDGE]', 'Connection established');
      }
      this._isConnected = true;  // Set internal state immediately
      this.setState({ isConnected: true }, () => {
        // Call onStateUpdate prop if provided for backward compatibility
        if (this.props.onStateUpdate && typeof this.props.onStateUpdate === 'function') {
          this.props.onStateUpdate(this.state);
        }
      });
      this.onSocketOpen();

      // Process any queued messages
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        try {
          this.ws.send(message);
        } catch (error) {
          console.error('[BRIDGE]', 'Error sending queued message:', safeIdentityErr(error));
          // Re-queue the message if send fails
          this.messageQueue.unshift(message);
          break;
        }
      }

      // Flush any queued JSON-RPC payloads that were enqueued before the
      // WebSocket finished opening (for example, early WebRTC registration).
      if (Array.isArray(this._jsonRpcQueue) && this._jsonRpcQueue.length > 0) {
        if (this.settings.debug) {
          console.debug('[BRIDGE]', 'Flushing queued JSON-RPC payloads:', this._jsonRpcQueue.length);
        }
        const queue = this._jsonRpcQueue.slice();
        this._jsonRpcQueue = [];
        for (const payload of queue) {
          this._sendJSONRPCNow(payload);
        }
      }
    };

    this.ws.onmessage = this.onSocketMessage.bind(this);

    this.ws.onerror = (error) => {
      const url = this.ws && this.ws.url ? this.ws.url : '(no url)';
      const kind = error && typeof error === 'object' && error.type
        ? error.type
        : (error && error.message) || error;
      console.error('[BRIDGE]', 'WebSocket error:', url, kind, safeIdentityErr(error));
      this._isConnected = false;
      this.setState({ error: safeIdentityErr(error), isConnected: false }, () => {
        // Call onStateUpdate prop if provided for backward compatibility
        if (this.props.onStateUpdate && typeof this.props.onStateUpdate === 'function') {
          this.props.onStateUpdate(this.state);
        }
      });
    };

    this.ws.onclose = (event) => {
      if (this.settings.debug) {
        console.debug('[BRIDGE]', 'WebSocket closed:', event.code, event.reason);
      }
      this._isConnected = false;
      this.setState({ isConnected: false }, () => {
        // Call onStateUpdate prop if provided for backward compatibility
        if (this.props.onStateUpdate && typeof this.props.onStateUpdate === 'function') {
          this.props.onStateUpdate(this.state);
        }
      });

      if (this._fabricHubReconnectSuspended) {
        if (this.settings.debug) {
          console.debug('[BRIDGE]', 'Hub reconnect suspended (fabric transport penalty); clear in UI or reload.');
        }
        return;
      }

      // Attempt to reconnect after a delay
      if (this.attempts < 5) {
        const delay = this.generateInterval(this.attempts);
        console.debug('[BRIDGE]', `Reconnecting in ${delay}ms (attempt ${this.attempts})`);
        setTimeout(() => {
          this.attempts++;
          this.connect(path);
        }, delay);
      } else {
        console.error('[BRIDGE]', 'Max reconnection attempts reached');
      }
    };
  }

  generateInterval (attempts) {
    return Math.min(30, (Math.pow(2, attempts) - 1)) * 1000;
  }

  /**
   * Initialize WebRTC identity (native WebRTC).
   * Generates a stable peerId for this browser session and marks WebRTC ready.
   */
  initializeWebRTC () {
    if (this.peerId) return;

    const sessionId = this.key ? this.key.id.slice(-8) : Math.random().toString(36).substr(2, 8);
    this.peerId = `fabric-bridge-${sessionId}`;
    this._webrtcReady = true;

    if (this.settings.debug) {
      console.debug('[BRIDGE]', 'Initialized native WebRTC with peerId:', this.peerId);
    }

    // Publish our presence to the Hub so other peers can discover us.
    this.publishWebRTCOffer();

    // Schedule initial peer discovery.
    if (this._peerDiscoveryTimer) clearTimeout(this._peerDiscoveryTimer);
    this._peerDiscoveryTimer = setTimeout(() => {
      this.discoverAndConnectToPeers();
    }, this.settings.webrtcPeerDiscoveryDelay);
  }

  // PeerJS-specific WebRTC helpers removed; native WebRTC helpers are defined below.

  /**
   * Handle messages received via WebRTC
   */
  handleWebRTCMessage (data, sourcePeerId = null) {
    try {
      console.debug('[BRIDGE]', 'Processing WebRTC message:', fabricDebugDescribePayload(data));

      const transport = sourcePeerId != null && String(sourcePeerId)
        ? { sessionId: String(sourcePeerId), kind: SESSION_KIND_WEBRTC }
        : { sessionId: HUB_FABRIC_SESSION_ID, kind: SESSION_KIND_HUB };

      // Handle our structured WebRTC messages
      if (data && typeof data === 'object' && data.type === 'fabric-message') {
        // Decode the base64 data back to Buffer
        const messageData = Buffer.from(data.data, 'base64');
        this.onSocketMessage({ data: messageData, _fabricTransport: transport });
        return;
      }

      // Handle other data formats for compatibility
      let messageData;

      if (typeof data === 'string') {
        messageData = Buffer.from(data, 'utf8');
      } else if (data instanceof ArrayBuffer) {
        messageData = Buffer.from(data);
      } else {
        messageData = Buffer.from(JSON.stringify(data));
      }

      // Process the message using the existing WebSocket message handler
      this.onSocketMessage({ data: messageData, _fabricTransport: transport });

    } catch (error) {
      console.error('[BRIDGE]', 'Error handling WebRTC message:', safeIdentityErr(error));
    }
  }

  /**
   * Publish our WebRTC presence/offer to the Bridge.
   * This notifies the server that we're available for peer connections.
   */
  publishWebRTCOffer () {
    if (!this.peerId) {
      console.warn('[BRIDGE]', 'Cannot publish WebRTC offer: no peer ID');
      return;
    }

    if (this.settings.debug) {
      console.debug('[BRIDGE]', 'Publishing WebRTC offer with peer ID:', this.peerId);
    }

    // Send our peer info to the server via WebSocket RPC
    const meta = {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      capabilities: ['data-channel']
    };
    const key = this._getIdentityKey();
    if (key && key.xpub && isLikelyBip32ExtendedKey(String(key.xpub))) {
      meta.xpub = String(key.xpub).trim();
    }
    const ns = this.state && (this.state.networkStatus || this.state.lastNetworkStatus);
    const fp = ns && ns.fabricPeerId != null ? String(ns.fabricPeerId).trim() : '';
    if (fp) meta.fabricPeerId = fp;

    const payload = {
      method: 'RegisterWebRTCPeer',
      params: [{
        peerId: this.peerId,
        timestamp: Date.now(),
        metadata: meta
      }]
    };

    this._sendJSONRPC(payload);
    this._lastWebRTCPublishAt = Date.now();
  }

  /**
   * Request peer candidates from the Bridge and connect to available peers.
   * Respects the maxWebrtcPeers setting.
   */
  discoverAndConnectToPeers () {
    // Discovery only needs our logical peerId registered with the hub; it
    // does not require that a specific WebRTC connection is already open.
    if (!this.peerId) {
      console.warn('[BRIDGE]', 'Cannot discover peers: no WebRTC peerId');
      return;
    }

    const currentConnections = this.webrtcPeers.size;
    const maxPeers = this.settings.maxWebrtcPeers || 5;

    if (currentConnections >= maxPeers) {
      if (this.settings.debug) {
        console.debug('[BRIDGE]', `Already at max WebRTC peers (${currentConnections}/${maxPeers})`);
      }
      return;
    }

    // Request peer list from the server
    const payload = {
      method: 'ListWebRTCPeers',
      params: [{ excludeSelf: true, peerId: this.peerId }]
    };

    // Store callback for when we receive the response
    this._pendingPeerDiscovery = true;
    this._lastWebRTCDiscoverAt = Date.now();
    this._sendJSONRPC(payload);
  }

  /**
   * Handle the response from ListWebRTCPeers and initiate connections.
   * @param {Array} candidates - Array of peer candidate objects
   */
  handlePeerCandidates (candidates) {
    // If WebRTC identity isn't ready yet, stash candidates and process them once
    // initialization completes.
    if (!this.peerId || !this._webrtcReady) {
      if (this.settings.debug) {
        console.debug('[BRIDGE]', 'Deferring WebRTC peer candidates until WebRTC is ready');
      }
      if (!Array.isArray(this._pendingPeerCandidates)) this._pendingPeerCandidates = [];
      this._pendingPeerCandidates.push(...candidates);
      return;
    }

    if (!Array.isArray(candidates)) {
      console.warn('[BRIDGE]', 'Invalid peer candidates:', typeof candidates);
      return;
    }

    const currentConnections = this.getWebRTCPeerCount() + this._connectingPeers.size;
    const maxPeers = this.settings.maxWebrtcPeers || 5;
    const slotsAvailable = Math.max(0, maxPeers - currentConnections);

    if (slotsAvailable === 0) {
      if (this.settings.debug) {
        console.debug('[BRIDGE]', 'No slots available for new WebRTC peers');
      }
      return;
    }

    const now = Date.now();
    const maxCandidateAgeMs = Number(this.settings.webrtcCandidateMaxAgeMs || 120000);
    let staleCandidateCount = 0;

    // Filter out ourselves, stale registrations, and already connected/connecting peers.
    const eligiblePeers = candidates.filter(candidate => {
      const peerId = candidate.id || candidate.peerId;
      if (!peerId) return false;
      if (peerId === this.peerId) return false;
      if (this.webrtcPeers.has(peerId)) return false;
      if (this._connectingPeers.has(peerId)) return false;
      const seenAt = Number(candidate.lastSeen || candidate.registeredAt || candidate.connectedAt || 0);
      if (maxCandidateAgeMs > 0 && Number.isFinite(seenAt) && seenAt > 0) {
        if ((now - seenAt) > maxCandidateAgeMs) {
          staleCandidateCount++;
          return false;
        }
      }
      return true;
    });

    if (staleCandidateCount > 0) {
      console.debug('[BRIDGE]', 'Ignoring stale WebRTC candidates:', staleCandidateCount);
    }

    // Prefer freshest candidates first so stale hub registrations do not
    // consume all available connection slots.
    eligiblePeers.sort((a, b) => {
      const bSeen = Number(b.lastSeen || b.registeredAt || b.connectedAt || 0);
      const aSeen = Number(a.lastSeen || a.registeredAt || a.connectedAt || 0);
      return bSeen - aSeen;
    });

    // Connect to peers up to available slots.
    const peersToConnect = eligiblePeers.slice(0, slotsAvailable);

    for (const candidate of peersToConnect) {
      const peerId = candidate.id || candidate.peerId;
      this.connectToWebRTCPeer(peerId, candidate);
    }
  }

  /**
   * Merge P2P_PEER_GOSSIP into client global state for Peers topology UI (second-hop view).
   * @param {object} parsed - payload with actor.id and object.peers[]
   * @param {string} [fallbackReporterId] - WebRTC channel peer id when actor is missing
   */
  _recordPeerGossipTopology (parsed, fallbackReporterId) {
    try {
      const reporter = (parsed && parsed.actor && parsed.actor.id)
        ? String(parsed.actor.id)
        : (fallbackReporterId ? String(fallbackReporterId) : '');
      const peers = Array.isArray(parsed && parsed.object && parsed.object.peers)
        ? parsed.object.peers
        : [];
      if (!reporter || peers.length === 0) return;
      const neighborIds = [...new Set(peers.map((p) => {
        if (!p || typeof p !== 'object') return '';
        return String(p.id != null ? p.id : (p.peerId != null ? p.peerId : '')).trim();
      }).filter(Boolean))];
      if (neighborIds.length === 0) return;
      this.globalState.peerTopologyGossip = this.globalState.peerTopologyGossip || { byReporter: {} };
      this.globalState.peerTopologyGossip.byReporter[reporter] = {
        at: Date.now(),
        neighbors: neighborIds
      };
      const cutoff = Date.now() - 20 * 60 * 1000;
      const br = this.globalState.peerTopologyGossip.byReporter;
      for (const k of Object.keys(br)) {
        if (br[k] && typeof br[k].at === 'number' && br[k].at < cutoff) delete br[k];
      }
      window.dispatchEvent(new CustomEvent('globalStateUpdate', {
        detail: {
          operation: { op: 'replace', path: '/peerTopologyGossip', value: this.globalState.peerTopologyGossip },
          globalState: this.globalState
        }
      }));
    } catch (e) {
      console.debug('[BRIDGE] _recordPeerGossipTopology:', safeIdentityErr(e));
    }
  }

  /**
   * Initiate a WebRTC connection to a specific peer.
   * @param {string} peerId - The remote browser peer ID to connect to
   * @param {Object} metadata - Optional metadata about the peer
   */
  connectToWebRTCPeer (peerId, metadata = {}) {
    if (!this.peerId || !this._webrtcReady) {
      console.debug('[BRIDGE]', 'Cannot connect to peer yet: WebRTC identity not ready');
      return;
    }

    if (this.webrtcPeers.has(peerId) || this._connectingPeers.has(peerId)) {
      console.debug('[BRIDGE]', 'Already connected/connecting to peer:', peerId);
      return;
    }

    if (this.settings.debug) {
      console.debug('[BRIDGE]', 'Initiating native WebRTC connection to peer:', peerId);
    }

    this._connectingPeers.add(peerId);

    try {
      const entry = {
        pc: null,
        dc: null,
        status: 'connecting',
        initiator: true,
        metadata,
        makingOffer: false,
        ignoreOffer: false,
        localSessionId: this._newRTCSessionId(peerId),
        remoteSessionId: null,
        localSignalRevision: 0,
        remoteSignalRevision: 0,
        polite: this.peerId ? this.peerId < peerId : true
      };
      const pc = this._createRTCPeerConnection(peerId, entry);
      const dc = pc.createDataChannel('fabric-peer', { ordered: true });
      this._attachDataChannelHandlers(peerId, dc);
      entry.pc = pc;
      entry.dc = dc;
      this._rtcPeers.set(peerId, entry);
      this.webrtcPeers.set(peerId, {
        id: peerId,
        status: 'connecting',
        direction: 'outbound',
        connectedAt: null,
        lastSeen: Date.now(),
        connection: dc,
        metadata
      });

      entry.makingOffer = true;
      pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
        entry.makingOffer = false;
        if (pc.signalingState === 'closed') return;
        const offerSignal = this._withRTCSignalMeta(entry, {
          type: 'offer',
          sdp: pc.localDescription
        }, {
          targetSessionId: null
        });
        this.sendWebRTCSignal(peerId, offerSignal);
      }).catch(err => {
        entry.makingOffer = false;
        console.error('[BRIDGE]', 'Error creating WebRTC offer to', peerId, safeIdentityErr(err));
        this.disconnectWebRTCPeer(peerId);
      });

      const connectTimeoutMs = Number(this.settings.webrtcConnectTimeoutMs || 15000);
      const timer = setTimeout(() => {
        const info = this.webrtcPeers.get(peerId);
        if (info && info.status === 'connected') return;
        if (this.settings.debug) {
          console.debug('[BRIDGE]', 'Timing out stale WebRTC connect attempt:', peerId);
        }
        this.disconnectWebRTCPeer(peerId);
      }, connectTimeoutMs);
      this._webrtcConnectTimers.set(peerId, timer);
    } catch (error) {
      console.error('[BRIDGE]', 'Failed to initiate native WebRTC connection to peer:', peerId, safeIdentityErr(error));
      this.disconnectWebRTCPeer(peerId);
    }
  }

  _resetHubFabricTransportSession () {
    this._fabricTransportSessions.set(
      HUB_FABRIC_SESSION_ID,
      new FabricTransportSession(HUB_FABRIC_SESSION_ID, SESSION_KIND_HUB)
    );
  }

  /**
   * @param {string} sessionId
   * @param {'hub_websocket'|'webrtc_mesh'} kind
   * @returns {FabricTransportSession|null}
   */
  _getFabricTransportSession (sessionId, kind) {
    const id = sessionId != null ? String(sessionId) : '';
    if (!id) return null;
    let s = this._fabricTransportSessions.get(id);
    if (!s) {
      s = new FabricTransportSession(id, kind);
      this._fabricTransportSessions.set(id, s);
    }
    return s;
  }

  _fabricRewardTransport (sessionId, kind, delta, _reason) {
    const s = this._getFabricTransportSession(sessionId, kind);
    if (!s) return;
    s.reward(delta);
    this._notifyPeerListUiRefresh();
  }

  _fabricPenalizeTransport (sessionId, kind, penalty, reason) {
    const s = this._getFabricTransportSession(sessionId, kind);
    if (!s) return;
    const { disconnect } = s.penalize(penalty);
    if (this.settings.debug) {
      console.debug('[BRIDGE]', 'Fabric transport penalized:', sessionId, kind, reason, 'score', s.score, 'misbehavior', s.misbehavior);
    }
    if (disconnect) {
      if (kind === SESSION_KIND_HUB && sessionId === HUB_FABRIC_SESSION_ID) {
        try {
          toast.warning(
            `Disconnected from hub${reason ? ` (${reason})` : ''}. Fabric transport reputation exhausted (score ${s.score}).`,
            { header: 'Hub' }
          );
        } catch (_) { /* ignore */ }
        this._fabricDisconnectHubTransport(reason || 'transport-reputation');
      } else {
        try {
          toast.warning(
            `Disconnected browser mesh peer${reason ? ` (${reason})` : ''}. Reputation exhausted (score ${s.score}, misbehavior ${s.misbehavior}).`,
            { header: 'Mesh peer' }
          );
        } catch (_) { /* ignore */ }
        this.disconnectWebRTCPeer(sessionId);
      }
      return;
    }
    this._notifyPeerListUiRefresh();
  }

  _fabricDisconnectHubTransport (reason) {
    this._fabricHubReconnectSuspended = true;
    if (!this.ws) return;
    try {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(4002, String(reason || 'fabric-transport').slice(0, 120));
      }
    } catch (e) {
      console.warn('[BRIDGE]', 'Error closing WebSocket after transport penalty:', safeIdentityErr(e));
    }
  }

  /**
   * @param {string} peerId
   * @returns {{ score: number, misbehavior: number }}
   */
  getWebRTCPeerReputation (peerId) {
    const id = peerId != null ? String(peerId) : '';
    const s = id ? this._fabricTransportSessions.get(id) : null;
    if (!s) return { score: 100, misbehavior: 0 };
    return { score: Number(s.score) || 0, misbehavior: Number(s.misbehavior) || 0 };
  }

  _notifyPeerListUiRefresh () {
    if (typeof window === 'undefined') return;
    if (this._peerListUiRefreshTimer) return;
    this._peerListUiRefreshTimer = setTimeout(() => {
      this._peerListUiRefreshTimer = null;
      try {
        const ns = this.state.networkStatus || this.state.lastNetworkStatus;
        window.dispatchEvent(new CustomEvent('networkStatusUpdate', { detail: { networkStatus: ns } }));
      } catch (_) { /* ignore */ }
    }, 200);
  }

  _webrtcRewardPeer (peerId, delta, reason) {
    this._fabricRewardTransport(peerId, SESSION_KIND_WEBRTC, delta, reason);
  }

  _webrtcPenalizePeer (peerId, penalty, reason) {
    this._fabricPenalizeTransport(peerId, SESSION_KIND_WEBRTC, penalty, reason);
  }

  /**
   * Handle messages received from a WebRTC peer (not the server).
   * @param {string} peerId - The peer ID that sent the message
   * @param {*} data - The message data
   */
  handleWebRTCPeerMessage (peerId, data) {
    try {
      const WEBRTC_MAX_TEXT = 256 * 1024;
      const WEBRTC_MAX_BINARY = 8 * 1024 * 1024;

      if (typeof data === 'string' && data.length > WEBRTC_MAX_TEXT) {
        this._webrtcPenalizePeer(peerId, 50, 'oversized-text-frame');
        return;
      }

      if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
        if (data.byteLength > WEBRTC_MAX_BINARY) {
          this._webrtcPenalizePeer(peerId, 50, 'oversized-binary-frame');
          return;
        }
        this.onSocketMessage({
          data,
          _fabricTransport: { sessionId: peerId, kind: SESSION_KIND_WEBRTC }
        });
        return;
      }
      if (typeof Uint8Array !== 'undefined' && data instanceof Uint8Array) {
        const u8 = data;
        if (u8.byteLength > WEBRTC_MAX_BINARY) {
          this._webrtcPenalizePeer(peerId, 50, 'oversized-binary-frame');
          return;
        }
        this.onSocketMessage({
          data: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
          _fabricTransport: { sessionId: peerId, kind: SESSION_KIND_WEBRTC }
        });
        return;
      }
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        if (typeof data.size === 'number' && data.size > WEBRTC_MAX_BINARY) {
          this._webrtcPenalizePeer(peerId, 50, 'oversized-binary-frame');
          return;
        }
        data.arrayBuffer().then((ab) => {
          if (ab.byteLength > WEBRTC_MAX_BINARY) {
            this._webrtcPenalizePeer(peerId, 50, 'oversized-binary-frame');
            return;
          }
          this.onSocketMessage({
            data: ab,
            _fabricTransport: { sessionId: peerId, kind: SESSION_KIND_WEBRTC }
          });
        }).catch((err) => console.error('[BRIDGE]', 'WebRTC Blob read failed:', safeIdentityErr(err)));
        return;
      }

      let payload = data;
      // RTCDataChannel text frames arrive as strings; normalize to object when possible.
      if (typeof payload === 'string') {
        const trimmed = payload.trim();
        if (trimmed) {
          try {
            payload = JSON.parse(trimmed);
          } catch (parseError) {
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
              this._webrtcPenalizePeer(peerId, 12, 'invalid-json');
              return;
            }
            payload = data;
          }
        }
      }

      // Emit event for application-level handling
      const event = new CustomEvent('webrtcPeerMessage', {
        detail: { peerId, data: payload }
      });
      window.dispatchEvent(event);

      // Handle specific message types
      if (payload && typeof payload === 'object') {
        switch (payload.type) {
          case 'ping':
            this.sendToWebRTCPeer(peerId, { type: 'pong', timestamp: Date.now() });
            this._webrtcRewardPeer(peerId, 1, 'answered-ping');
            break;
          case 'P2P_PEER_GOSSIP':
          case 'webrtc-peer-gossip': {
            const peers = Array.isArray(payload.object && payload.object.peers)
              ? payload.object.peers
              : (Array.isArray(payload.peers) ? payload.peers : []);
            if (peers.length > 128) {
              this._webrtcPenalizePeer(peerId, 30, 'gossip-list-oversized');
              break;
            }
            if (peers.some((p) => !p || (p.id == null && p.peerId == null))) {
              this._webrtcPenalizePeer(peerId, 25, 'gossip-malformed-entry');
              break;
            }
            if (peers.length > 0) {
              this._recordPeerGossipTopology(
                { actor: payload.actor || { id: peerId }, object: { peers } },
                peerId
              );
              const candidates = peers.map((p) => ({
                id: p.id || p.peerId,
                peerId: p.id || p.peerId,
                lastSeen: p.lastSeen || p.registeredAt || Date.now(),
                registeredAt: p.registeredAt || p.lastSeen || Date.now(),
                source: 'gossip'
              })).filter((c) => c.id && c.id !== this.peerId);
              if (candidates.length > 0) {
                this.handlePeerCandidates(candidates);
              }
              this._webrtcRewardPeer(peerId, 1, 'valid-gossip');
            }
            break;
          }
          case 'P2P_PEERING_OFFER': {
            const obj = payload.object || payload;
            const slots = Number(obj.slots || obj.needed || 1);
            const transport = obj.transport || 'webrtc';
            if (transport === 'webrtc' && slots > 0 && this.peerId) {
              const offererId = (payload.actor && payload.actor.id) || peerId;
              if (offererId !== this.peerId && !this.webrtcPeers.has(offererId) && !this._connectingPeers.has(offererId)) {
                console.debug('[BRIDGE]', 'Received', P2P_PEERING_OFFER, 'from', peerId, '- attempting connect');
                this.handlePeerCandidates([{ id: offererId, peerId: offererId, lastSeen: Date.now(), source: 'peeringOffer' }]);
              }
              this._webrtcRewardPeer(peerId, 1, 'peering-offer');
            }
            break;
          }
          case 'pong': {
            // Update last seen for the peer
            const peerInfo = this.webrtcPeers.get(peerId);
            if (peerInfo) {
              peerInfo.lastSeen = Date.now();
              this.webrtcPeers.set(peerId, peerInfo);
            }
            this._webrtcRewardPeer(peerId, 1, 'pong');
            break;
          }
          case 'fabric-message': {
            // Signed Fabric Message (base64); relay with original preserved for onion routing.
            const base64 = payload.data;
            if (typeof base64 !== 'string' || !base64.length) {
              this._webrtcPenalizePeer(peerId, 20, 'fabric-message-empty');
              break;
            }
            if (base64.length > Math.floor(1.5 * 1024 * 1024)) {
              this._webrtcPenalizePeer(peerId, 40, 'fabric-message-oversized');
              break;
            }
            if (base64 && this._isConnected && this.ws && this.ws.readyState === 1) {
              const envelope = {
                original: base64,
                originalType: 'fabric-message',
                hops: [{ from: peerId, at: Date.now() }]
              };
              this._sendJSONRPC({
                method: 'RelayFromWebRTC',
                params: [{ fromPeerId: peerId, envelope }]
              });
            }
            this.handleWebRTCMessage(payload, peerId);
            this._webrtcRewardPeer(peerId, 1, 'fabric-message');
            break;
          }
          case 'P2P_DISTRIBUTE_PROPOSAL': {
            const obj = payload.object || payload;
            let proposal = null;
            if (obj.documentId && Number.isFinite(Number(obj.amountSats))) {
              const senderAddress = (payload.actor && payload.actor.id) || null;
              const created = (obj.created || payload.created) || Date.now();
              proposal = {
                id: `proposal:${created}:${senderAddress || 'unknown'}`,
                documentId: obj.documentId,
                amountSats: Number(obj.amountSats),
                config: obj.config || {},
                document: obj.document || null,
                documentName: obj.documentName || (obj.document && obj.document.name) || obj.documentId,
                senderAddress,
                receivedAt: created,
                status: 'pending'
              };
            } else {
              proposal = this._parseDistributeProposal(
                typeof obj.content === 'string' ? obj.content : JSON.stringify(obj),
                payload
              );
            }
            if (proposal) {
              this._storeDistributeProposal(proposal);
            }
            break;
          }
          case 'P2P_CHAT_MESSAGE': {
            const text = (payload.object && payload.object.content) || payload.text || payload.content || '';
            const trimmed = typeof text === 'string' ? text.trim() : '';
            const proposal = this._parseDistributeProposal(trimmed, payload);
            if (proposal) {
              this._storeDistributeProposal(proposal);
              break;
            }
            if (!trimmed) break;
            const created = (payload.object && payload.object.created) || payload.created || Date.now();
            const actorId = (payload.actor && payload.actor.id) || payload.actorId || peerId;
            const incomingClientId = (payload.object && payload.object.clientId) || payload.clientId || null;

            // Create a local chat representation for the UI
            try {
              const clientId = incomingClientId || (() => {
                const clientActor = new Actor({
                  content: {
                    type: 'P2P_CHAT_MESSAGE',
                    address: peerId,
                    text,
                    created
                  }
                });
                return clientActor.id;
              })();

              if (clientId && this.globalState && this.globalState.messages && this.globalState.messages[clientId]) {
                break;
              }

              const chat = {
                type: 'P2P_CHAT_MESSAGE',
                actor: { id: actorId },
                object: {
                  content: trimmed,
                  created,
                  clientId
                },
                target: peerId,
                status: 'received',
                transport: 'webrtc',
                delivery: {
                  via: 'mesh',
                  fromPeerId: peerId
                }
              };

              this.globalState.messages = this.globalState.messages || {};
              this.globalState.messages[clientId] = chat;

              window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                detail: {
                  operation: { op: 'add', path: `/messages/${clientId}`, value: chat },
                  globalState: this.globalState
                }
              }));
              this._persistMessages();

              // Relay to WebSocket bridge: wrap in P2P_RELAY envelope to preserve original + signature for onion routing.
              if (this._isConnected && this.ws && this.ws.readyState === 1) {
                const envelope = {
                  original: JSON.stringify(chat),
                  originalType: 'P2P_CHAT_MESSAGE',
                  hops: [{ from: peerId, at: Date.now() }]
                };
                this._sendJSONRPC({
                  method: 'RelayFromWebRTC',
                  params: [{ fromPeerId: peerId, envelope }]
                });
              }
              this._webrtcRewardPeer(peerId, 1, 'chat');
            } catch (e) {
              console.warn('[BRIDGE]', 'Could not create local WebRTC chat message:', safeIdentityErr(e));
            }
            break;
          }
          default:
            // Pass through to the general WebRTC message handler
            this.handleWebRTCMessage(payload, peerId);
        }
      }
    } catch (error) {
      console.error('[BRIDGE]', 'Error handling WebRTC peer message:', safeIdentityErr(error));
    }
  }

  /**
   * Send a message to a specific WebRTC peer.
   * @param {string} peerId - The peer ID to send to
   * @param {*} data - The data to send
   * @returns {boolean} True if sent successfully
   */
  sendToWebRTCPeer (peerId, data) {
    const peerInfo = this.webrtcPeers.get(peerId);
    if (!peerInfo || !peerInfo.connection || peerInfo.status !== 'connected') {
      console.warn('[BRIDGE]', 'Cannot send to WebRTC peer:', peerId, '- not connected');
      return false;
    }

    try {
      if (data && typeof data.toBuffer === 'function') {
        const buf = data.toBuffer();
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        peerInfo.connection.send(ab);
        return true;
      }
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(data)) {
        const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        peerInfo.connection.send(ab);
        return true;
      }
      if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
        peerInfo.connection.send(data);
        return true;
      }
      const outbound = (data && typeof data === 'object')
        ? JSON.stringify(data)
        : data;
      peerInfo.connection.send(outbound);
      return true;
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending to WebRTC peer:', peerId, safeIdentityErr(error));
      return false;
    }
  }

  /**
   * Broadcast a message to all connected WebRTC peers.
   * @param {*} data - The data to broadcast
   * @returns {number} Number of peers the message was sent to
   */
  broadcastToWebRTCPeers (data) {
    const recipients = this.broadcastToWebRTCPeersWithRecipients(data);
    return recipients.length;
  }

  /**
   * Broadcast a message to all connected WebRTC peers and return recipient IDs.
   * @param {*} data - The data to broadcast
   * @returns {string[]} Peer IDs that accepted the send
   */
  broadcastToWebRTCPeersWithRecipients (data) {
    const recipients = [];
    for (const [peerId, peerInfo] of this.webrtcPeers) {
      if (peerInfo.status === 'connected' && this.sendToWebRTCPeer(peerId, data)) {
        recipients.push(peerId);
      }
    }
    return recipients;
  }

  /**
   * Build the peer list for gossip (self + connected peers).
   * Used so clusters connected to different bridge instances can discover one another.
   */
  _buildWebRTCPeerGossipPayload () {
    const now = Date.now();
    const peers = [];
    if (this.peerId) {
      peers.push({ id: this.peerId, lastSeen: now, registeredAt: now });
    }
    for (const [id, info] of this.webrtcPeers) {
      if (info && info.status === 'connected' && id && id !== this.peerId) {
        peers.push({
          id,
          lastSeen: info.lastSeen || info.connectedAt || now,
          registeredAt: info.registeredAt || info.connectedAt || now
        });
      }
    }
    return {
      type: P2P_PEER_GOSSIP,
      actor: { id: this.peerId },
      object: { peers, timestamp: now, relayTtl: 8 },
      timestamp: now
    };
  }

  /**
   * Build a peering offer payload (peer needs more connections).
   * Gossiped until fulfilled.
   */
  _buildPeeringOfferPayload (slots = 1) {
    return {
      type: P2P_PEERING_OFFER,
      actor: { id: this.peerId },
      object: { slots, transport: 'webrtc', timestamp: Date.now(), relayTtl: 8 },
      timestamp: Date.now()
    };
  }

  /**
   * Send our known peer list to a specific WebRTC peer (gossip for cross-cluster discovery).
   */
  _sendWebRTCPeerGossip (toPeerId) {
    if (!toPeerId || !this.peerId) return false;
    const payload = this._buildWebRTCPeerGossipPayload();
    return this.sendToWebRTCPeer(toPeerId, payload);
  }

  /**
   * Broadcast our peer list to all connected WebRTC peers.
   * Enables clusters on different Hubs to discover each other when at least one cross-cluster link exists.
   */
  _broadcastWebRTCPeerGossip () {
    const count = this.broadcastToWebRTCPeersWithRecipients(this._buildWebRTCPeerGossipPayload()).length;
    if (count > 0) {
      this._lastWebRTCGossipAt = Date.now();
    }
  }

  /**
   * Broadcast a peering offer to all connected WebRTC peers.
   * Gossiped until fulfilled; recipients may connect if they have capacity.
   */
  _broadcastPeeringOffer (slots = 1) {
    const count = this.broadcastToWebRTCPeersWithRecipients(this._buildPeeringOfferPayload(slots)).length;
    if (count > 0) {
      this._lastPeeringOfferAt = Date.now();
    }
  }

  /**
   * Disconnect from a specific WebRTC peer by ID.
   * @param {string} peerId - The peer ID to disconnect
   */
  disconnectWebRTCPeer (peerId) {
    if (!peerId) return;

    const existingInfo = this.webrtcPeers.get(peerId);
    if (existingInfo && existingInfo.status === 'connected') {
      this._hubReportWebRTCPeerDisconnected(peerId);
    }

    if (this._webrtcConnectTimers && this._webrtcConnectTimers.has(peerId)) {
      clearTimeout(this._webrtcConnectTimers.get(peerId));
      this._webrtcConnectTimers.delete(peerId);
    }

    const peerInfo = this.webrtcPeers.get(peerId);
    const rtcEntry = this._rtcPeers.get(peerId);

    if (peerInfo && peerInfo.connection) {
      try {
        peerInfo.connection.close();
      } catch (error) {
        console.warn('[BRIDGE]', 'Error closing WebRTC connection for peer:', peerId, safeIdentityErr(error));
      }
    }

    if (rtcEntry && rtcEntry.dc && rtcEntry.dc !== (peerInfo && peerInfo.connection)) {
      try {
        rtcEntry.dc.close();
      } catch (error) {
        console.warn('[BRIDGE]', 'Error closing WebRTC data channel for peer:', peerId, safeIdentityErr(error));
      }
    }

    if (rtcEntry && rtcEntry.pc) {
      try {
        rtcEntry.pc.close();
      } catch (error) {
        console.warn('[BRIDGE]', 'Error closing RTCPeerConnection for peer:', peerId, safeIdentityErr(error));
      }
    }

    this.webrtcPeers.delete(peerId);
    this._rtcPeers.delete(peerId);
    this._rtcPendingIce.delete(peerId);
    if (this._fabricTransportSessions && this._fabricTransportSessions.has(peerId)) {
      this._fabricTransportSessions.delete(peerId);
    }
    if (this._connectingPeers && this._connectingPeers.has(peerId)) {
      this._connectingPeers.delete(peerId);
    }

    this._webrtcConnected = this.getWebRTCPeerCount() > 0;
    this.setState({ webrtcConnected: this._webrtcConnected });

    // No JSON-RPC notification here; normal close handlers will emit if needed.
    try {
      this.forceUpdate();
    } catch (e) {}
  }

  /**
   * Disconnect from all tracked WebRTC peers.
   */
  disconnectAllWebRTCPeers () {
    try {
      for (const [peerId, peerInfo] of this.webrtcPeers) {
        if (peerInfo && peerInfo.status === 'connected') {
          this._hubReportWebRTCPeerDisconnected(peerId);
        }
      }
    } catch (e) {}

    try {
      for (const [peerId, peerInfo] of this.webrtcPeers) {
        if (peerInfo && peerInfo.connection) {
          try {
            peerInfo.connection.close();
          } catch (error) {
            console.warn('[BRIDGE]', 'Error closing WebRTC connection for peer:', peerId, safeIdentityErr(error));
          }
        }
      }
    } catch (e) {}

    this.webrtcPeers.clear();
    this._rtcPeers.clear();
    this._rtcPendingIce.clear();
    if (this._fabricTransportSessions) {
      const hub = this._fabricTransportSessions.get(HUB_FABRIC_SESSION_ID);
      this._fabricTransportSessions.clear();
      if (hub) this._fabricTransportSessions.set(HUB_FABRIC_SESSION_ID, hub);
    }
    if (this._connectingPeers && this._connectingPeers.size) {
      this._connectingPeers.clear();
    }
    if (this._webrtcConnectTimers && this._webrtcConnectTimers.size) {
      for (const timer of this._webrtcConnectTimers.values()) {
        clearTimeout(timer);
      }
      this._webrtcConnectTimers.clear();
    }

    this._webrtcConnected = false;
    this.setState({ webrtcConnected: false });

    try {
      this.forceUpdate();
    } catch (e) {}
    this._notifyPeerListUiRefresh();
  }

  /**
   * Get the count of active WebRTC peer connections.
   * @returns {number} Number of connected peers
   */
  getWebRTCPeerCount () {
    let count = 0;
    for (const peerInfo of this.webrtcPeers.values()) {
      if (peerInfo.status === 'connected') count++;
    }
    return count;
  }

  /**
   * Low-level helper to encode and send a JSON-RPC payload on an open WebSocket.
   * Caller MUST ensure the socket is open.
   * @param {Object} payload - The JSON-RPC payload
   */
  _sendJSONRPCNow (payload) {
    try {
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.ws.send(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending JSON-RPC:', safeIdentityErr(error));
    }
  }

  /**
   * Send a JSON-RPC message via WebSocket.
   * If the WebSocket is not yet connected, queue the payload to be sent on open.
   * @param {Object} payload - The JSON-RPC payload
   */
  _sendJSONRPC (payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.debug('[BRIDGE]', 'Queueing JSON-RPC (WebSocket not connected yet)');
      this._jsonRpcQueue.push(payload);
      return;
    }

    this._sendJSONRPCNow(payload);
  }

  addJob (type, data) {
    this.queue.push({ type, data });
  }

  takeJob () {
    if (!this.queue.length) return;
    const job = this.queue.shift();
    if (!job) return;

    switch (job.type) {
      default:
        console.warn('[BRIDGE]', 'Unhandled Bridge job type:', job.type);
        break;
      case 'MessageChunk':
        // console.debug('[BRIDGE]', 'MessageChunk:', job.data);
        break;
      case 'MessageEnd':
        // console.debug('[BRIDGE]', 'MessageEnd:', job.data);
        break;
      case 'MessageStart':
        // console.debug('[BRIDGE]', 'MessageStart:', job.data);
        break;
    }
  }

  render () {
    const { data, error, isConnected, webrtcConnected } = this.state;

    if (error && this.settings.debug) {
      return <div>Error: {error}</div>;
    }

    if (!data && this.settings.debug) {
      return <div>Loading...</div>;
    }

    return (
      <fabric-bridge>
        {this.settings.debug ? (
          <div>
            <h1>Connection Status:</h1>
            <div>
              <strong>WebSocket:</strong> {isConnected ? '✅ Connected' : '❌ Disconnected'}
            </div>
            <div>
              <strong>WebRTC:</strong> {webrtcConnected ? '✅ Connected' : '❌ Disconnected'}
              {this.peerId && ` (${this.peerId})`}
            </div>
            <h1>Data Received:</h1>
            <pre>{safeDebugStatePreview(data)}</pre>
          </div>
        ) : null}
      </fabric-bridge>
    );
  }

  start () {
    this.connect('/');
    // Initialize WebRTC connection
    this.initializeWebRTC();
    // Start heartbeat interval
    if (this._heartbeat) clearInterval(this._heartbeat);
    this._heartbeat = setInterval(this.tick.bind(this), this.settings.tickrate);
  }

  stop () {
    if (this._heartbeat) {
      clearInterval(this._heartbeat);
      this._heartbeat = null;
    }

    // Clean up peer discovery timer
    if (this._peerDiscoveryTimer) {
      clearTimeout(this._peerDiscoveryTimer);
      this._peerDiscoveryTimer = null;
    }
    if (this._peerListUiRefreshTimer) {
      clearTimeout(this._peerListUiRefreshTimer);
      this._peerListUiRefreshTimer = null;
    }

    // Clean up WebSocket
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch (e) {
        console.warn('[BRIDGE]', 'Error cleaning up WebSocket on stop:', safeIdentityErr(e));
      }
      this.ws = null;
    }

    // Clean up all WebRTC peer connections
    for (const [peerId, peerInfo] of this.webrtcPeers) {
      try {
        if (peerInfo.connection) {
          peerInfo.connection.close();
        }
      } catch (e) {
        console.warn('[BRIDGE]', 'Error closing WebRTC peer connection:', peerId, safeIdentityErr(e));
      }
    }
    this.webrtcPeers.clear();
    this._connectingPeers.clear();

    // Clean up native RTCPeerConnection instances.
    for (const [peerId, entry] of this._rtcPeers.entries()) {
      try {
        if (entry && entry.dc && typeof entry.dc.close === 'function') entry.dc.close();
      } catch (e) {}
      try {
        if (entry && entry.pc && typeof entry.pc.close === 'function') entry.pc.close();
      } catch (e) {
        console.warn('[BRIDGE]', 'Error closing RTCPeerConnection:', peerId, safeIdentityErr(e));
      }
    }
    this._rtcPeers.clear();
    this._rtcPendingIce.clear();

    this._webrtcConnected = false;
    this._webrtcReady = false;
    this.setState({ webrtcConnected: false });
  }

  tick () {
    const now = Date.now();
    const heartbeatMs = Number(this.settings.webrtcHeartbeatIntervalMs || 30000);
    const discoveryMs = Number(this.settings.webrtcDiscoveryIntervalMs || 15000);

    if (
      this.peerId &&
      this._webrtcReady &&
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      (!this._lastWebRTCPublishAt || ((now - this._lastWebRTCPublishAt) >= heartbeatMs))
    ) {
      this.publishWebRTCOffer();
    }

    if (
      this.peerId &&
      this._webrtcReady &&
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      (!this._lastWebRTCDiscoverAt || ((now - this._lastWebRTCDiscoverAt) >= discoveryMs))
    ) {
      this.discoverAndConnectToPeers();
    }

    const gossipMs = Number(this.settings.webrtcGossipIntervalMs || 25000);
    const connectedCount = this.getWebRTCPeerCount();
    if (
      this.peerId &&
      connectedCount > 0 &&
      (!this._lastWebRTCGossipAt || ((now - this._lastWebRTCGossipAt) >= gossipMs))
    ) {
      this._broadcastWebRTCPeerGossip();
    }

    const offerMs = Number(this.settings.webrtcPeeringOfferIntervalMs || 30000);
    const maxPeers = Number(this.settings.maxWebrtcPeers || 5);
    const slotsNeeded = maxPeers - connectedCount - this._connectingPeers.size;
    if (
      this.peerId &&
      this._webrtcReady &&
      slotsNeeded > 0 &&
      connectedCount > 0 &&
      (!this._lastPeeringOfferAt || ((now - this._lastPeeringOfferAt) >= offerMs))
    ) {
      this._broadcastPeeringOffer(Math.max(1, slotsNeeded));
    }

    this.takeJob();
  }

  /**
   * Signs arbitrary text with the component's signing key (BIP340 Schnorr).
   * @param {string} text - The text to sign
   * @returns {{ signature: string, publicKey: string }|null} - Signature hex and public key hex, or null if not configured
   */
  signArbitraryText (text) {
    if (!this.settings.signingKey || !this.settings.signingKey.private) {
      console.warn('[BRIDGE]', 'No signing key with private key configured');
      return null;
    }
    try {
      const textStr = String(text);
      const sig = this.settings.signingKey.sign(textStr);
      let pubHex = '';
      try {
        pubHex = this.settings.signingKey.pubkey || this.settings.signingKey.xpub || '';
      } catch (e) {}
      return {
        signature: Buffer.isBuffer(sig) ? sig.toString('hex') : String(sig),
        publicKey: pubHex
      };
    } catch (error) {
      console.error('[BRIDGE]', 'Error signing text:', safeIdentityErr(error));
      return null;
    }
  }

  /**
   * External signing: post a `DELEGATION_SIGNATURE_REQUEST` Fabric message (JSON-RPC) and poll until the desktop resolves it.
   * Requires delegation JSON in localStorage (`fabricDelegationLocal` key; set after desktop browser login).
   * @param {string} text
   * @returns {Promise<{ signature: string, publicKey: string }|null>}
   */
  async signArbitraryTextDelegated (text) {
    if (typeof window === 'undefined') return null;
    const d = readStorageJSON(DELEGATION_STORAGE_KEY, null);
    if (!d) return null;
    const token = d && d.token;
    if (!token && d && d.externalSigning === false) return null;
    if (!token) return null;
    const origin = window.location.origin;
    let jsonRpcSeq = 0;
    const rpc = async (method, params) => {
      jsonRpcSeq += 1;
      const res = await fetch(`${origin}/services/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: jsonRpcSeq,
          method,
          params: [params]
        }),
        cache: 'no-store'
      });
      const body = await res.json().catch(() => ({}));
      if (body && body.error) return { rpcError: body.error.message || 'RPC error' };
      return body && body.result != null ? body.result : null;
    };
    const postResult = await rpc('PostDelegationSignatureMessage', {
      sessionToken: token,
      message: String(text),
      purpose: 'arbitrary'
    });
    if (!postResult || postResult.rpcError || !postResult.ok || !postResult.messageId) return null;
    const messageId = postResult.messageId;
    this._emitDelegationSignRequestActivity({
      messageId,
      preview: postResult.preview || String(text).slice(0, 400),
      purpose: postResult.purpose || 'arbitrary'
    });
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 500));
      const pj = await rpc('GetDelegationSignatureMessage', {
        sessionToken: token,
        messageId
      });
      if (!pj || pj.rpcError) continue;
      if (pj.ok === false) continue;
      if (pj.status === 'pending') continue;
      if (pj.status === 'rejected') {
        this._resolveDelegationSignRequestActivity(messageId, 'rejected');
        return null;
      }
      if (pj.status === 'approved' && pj.signature) {
        this._resolveDelegationSignRequestActivity(messageId, 'approved');
        return { signature: pj.signature, publicKey: pj.pubkeyHex };
      }
    }
    this._resolveDelegationSignRequestActivity(messageId, 'timeout');
    return null;
  }

  /**
   * Verifies a Schnorr signature for arbitrary text.
   * @param {string} text - The original message
   * @param {string} signatureHex - The signature (64-byte hex)
   * @param {string} publicKeyHex - The compressed public key (33-byte hex)
   * @returns {boolean|null} - True if valid, false if invalid, null on error
   */
  /**
   * Compressed secp256k1 public key (hex) for the local identity — used as buyer refund key in inventory P2TR HTLCs.
   * @returns {string|null}
   */
  getHtlcRefundPublicKeyHex () {
    const k = this.settings.signingKey;
    if (!k || !k.public || typeof k.public.encodeCompressed !== 'function') return null;
    try {
      return k.public.encodeCompressed('hex');
    } catch (e) {
      return null;
    }
  }

  verifyArbitraryText (text, signatureHex, publicKeyHex) {
    if (!text || !signatureHex || !publicKeyHex) return null;
    try {
      const key = new Key({ public: publicKeyHex.trim() });
      const sig = Buffer.from(signatureHex.trim(), 'hex');
      if (sig.length !== 64) return false;
      return key.verifySchnorr(text, sig);
    } catch (error) {
      console.error('[BRIDGE]', 'Error verifying text:', safeIdentityErr(error));
      return null;
    }
  }

  /**
   * True when the Bridge has a key that can produce Schnorr signatures (xprv / private material).
   * Watch-only and desktop-delegated identities use xpub-only {@link Key} — JSONCall may be sent unsigned.
   */
  _canSignOutgoing () {
    const k = this.settings.signingKey || this.key;
    return !!(k && k.private);
  }

  /** True when Fabric wire `JSONCall` envelopes can be Schnorr-signed in this browser (has private key). */
  hasLocalWireSigningKey () {
    return this._canSignOutgoing();
  }

  /**
   * Signs a message with the component's signing key when a private key is available.
   * Without a private key, returns the buffer unchanged (Hub accepts unsigned JSONCall for many read paths).
   * @param {Buffer} message - The message to sign
   * @returns {Buffer|Message} - Signed Fabric Message, or original buffer when unsigned
   */
  signMessage (message) {
    const signingKey = this.settings.signingKey || this.key;
    if (!signingKey) {
      if (this.settings.debug) console.debug('[BRIDGE]', 'No signing key — sending unsigned');
      return message;
    }

    if (!this._canSignOutgoing()) {
      if (this.settings.debug) {
        console.debug('[BRIDGE]', 'Watch-only or delegated identity (public key only) — sending unsigned');
      }
      return message;
    }

    const fabricMessage = Message.fromBuffer(message);
    if (!fabricMessage) {
      console.warn('[BRIDGE]', 'Could not create Fabric Message from buffer');
      return message;
    }

    try {
      return fabricMessage.signWithKey(signingKey);
    } catch (error) {
      console.warn('[BRIDGE]', 'Signing failed, sending unsigned:', safeIdentityErr(error));
      return message;
    }
  }

  /**
   * Sends a Fabric wire message over WebSocket (or WebRTC). Signs via `signMessage` when
   * `_canSignOutgoing()`; otherwise sends the same buffer unsigned (watch-only / delegated clients).
   * @param {Buffer} message - The message to send
   * @param {Boolean} preferWebRTC - Whether to prefer WebRTC over WebSocket
   */
  sendSignedMessage (message, preferWebRTC = false) {
    const signedMessage = this.signMessage(message);
    const signedBuffer = signedMessage.toBuffer ? signedMessage.toBuffer() : signedMessage;

    this.sendMessage(signedBuffer, preferWebRTC);
  }

  sendMessage (message, preferWebRTC = false) {
    // Try WebRTC first if preferred and available
    if (preferWebRTC && this._webrtcConnected && this.webrtcConnection) {
      try {
        // Convert Buffer to appropriate format for WebRTC
        const data = Buffer.isBuffer(message) ? message.toString('base64') : message;
        this.webrtcConnection.send({
          type: 'fabric-message',
          data: data,
          timestamp: Date.now()
        });
        console.debug('[BRIDGE]', 'Message sent via WebRTC');
        return;
      } catch (error) {
        console.warn('[BRIDGE]', 'WebRTC send failed, falling back to WebSocket:', safeIdentityErr(error));
      }
    }

    // Fallback to WebSocket
    if (!this._isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.messageQueue.push(message);
      return;
    }

    try {
      this.ws.send(message);
      console.debug('[BRIDGE]', 'Message sent via WebSocket');
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending message via WebSocket:', safeIdentityErr(error));
      // Queue the message if send fails
      this.messageQueue.push(message);
    }
  }

  /**
   * Subscribe to state changes at a specific path
   * @param {String} path - The path to subscribe to (e.g. '/services/bitcoin')
   */
  subscribe (path) {
    if (this.state.subscriptions.has(path)) {
      if (this.settings.debug) console.debug('[BRIDGE]', 'Already subscribed to:', path);
      return;
    }

    this._sendSubscribe(path);

    this.state.subscriptions.add(path);
    console.debug('[BRIDGE]', 'Subscribed to:', path);
  }

  /**
   * Unsubscribe from state changes at a specific path
   * @param {String} path - The path to unsubscribe from
   */
  unsubscribe (path) {
    if (!this.state.subscriptions.has(path)) {
      console.debug('[BRIDGE]', 'Not subscribed to:', path);
      return;
    }

    const message = Message.fromVector(['UNSUBSCRIBE', path]);
    const messageBuffer = message.toBuffer();
    this.sendSignedMessage(messageBuffer);

    this.state.subscriptions.delete(path);
    console.debug('[BRIDGE]', 'Unsubscribed from:', path);
  }

  /**
   * Get the current connection status for both WebSocket and WebRTC
   * @returns {Object} Connection status object
   */
  getConnectionStatus () {
    return {
      websocket: {
        connected: this._isConnected,
        readyState: this.ws ? this.ws.readyState : null
      },
      webrtc: {
        connected: this._webrtcConnected,
        peerId: this.peerId,
        serverConnection: this.webrtcConnection ? this.webrtcConnection.peer : null
      },
      preferredProtocol: this._webrtcConnected ? 'webrtc' : 'websocket'
    };
  }

  /**
   * Send a message preferring WebRTC if available
   * @param {Buffer|String} message - The message to send
   */
  sendViaWebRTC (message) {
    this.sendMessage(message, true);
  }

  /**
   * Send a message preferring WebSocket
   * @param {Buffer|String} message - The message to send
   */
  sendViaWebSocket (message) {
    this.sendMessage(message, false);
  }

  /**
   * Reconnect WebRTC if connection is lost
   */
  reconnectWebRTC () {
    if (!this.peerId || !this._webrtcReady) {
      console.debug('[BRIDGE]', 'Reinitializing WebRTC identity...');
      this.initializeWebRTC();
      return;
    }

    console.debug('[BRIDGE]', 'Rediscovering WebRTC peers...');
    this.discoverAndConnectToPeers();
  }

  async onSocketMessage (msg) {
    try {
      // Validate message data
      if (!msg || !msg.data) {
        console.debug('[BRIDGE]', 'Invalid message format:', msg);
        return;
      }

      // Handle different message data types
      let buffer;
      if (msg.data instanceof ArrayBuffer) {
        buffer = Buffer.from(msg.data);
      } else if (msg.data instanceof Blob) {
        const arrayBuffer = await msg.data.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      } else if (typeof msg.data === 'string') {
        buffer = Buffer.from(msg.data);
      } else {
        console.debug('[BRIDGE]', 'Unsupported message data type:', typeof msg.data);
        return;
      }

      // Validate buffer
      if (!Buffer.isBuffer(buffer)) {
        console.debug('[BRIDGE]', 'Failed to create valid buffer from message data');
        return;
      }

      const transportMeta = (msg && msg._fabricTransport) || {
        sessionId: HUB_FABRIC_SESSION_ID,
        kind: SESSION_KIND_HUB
      };
      const tSessionId = transportMeta.sessionId;
      const tKind = transportMeta.kind;

      if (buffer.length > BRIDGE_INBOUND_WIRE_MAX_BYTES) {
        this._fabricPenalizeTransport(tSessionId, tKind, 50, 'oversized-wire-frame');
        return;
      }
      if (buffer.length < FABRIC_WIRE_HEADER_SIZE) {
        this._fabricPenalizeTransport(tSessionId, tKind, 35, 'truncated-wire-header');
        return;
      }

      let message;
      try {
        message = Message.fromBuffer(buffer);
      } catch (parseErr) {
        if (this.settings.debug) {
          console.debug('[BRIDGE]', 'Message.fromBuffer failed:', safeIdentityErr(parseErr));
        }
        this._fabricPenalizeTransport(tSessionId, tKind, 40, 'wire-parse-error');
        return;
      }
      if (!message) {
        this._fabricPenalizeTransport(tSessionId, tKind, 35, 'wire-null-message');
        return;
      }
      if (!fabricWireBodyIntegrityOk(message)) {
        this._fabricPenalizeTransport(tSessionId, tKind, 45, 'body-hash-mismatch');
        return;
      }

      const sess = this._getFabricTransportSession(tSessionId, tKind);
      if (sess) sess.commitWireMessage(message);

      // Handle message based on type
      switch (message.type) {
        default:
          console.debug('[BRIDGE]', 'Unhandled message type:', message.type);
          break;
        case 'P2P_MESSAGE_RECEIPT':
          // Server ack for a delivered inbound message; JSONCall path does not require client handling.
          break;
        case 'Pong':
          // Keepalive response from hub; no action needed beyond acknowledging receipt.
          break;
        case 'P2P_PING':
        case 'P2P_PONG':
          // Peer heartbeat frames are handled by the transport/session layer; no UI action required.
          break;
        // Wire opcode decodes to JSON_CALL; Message.fromVector(['JSONCall', …]) uses friendly alias.
        case 'JSONCall':
        case 'JSON_CALL':
          // Parse JSONCall and handle JSONCallResult responses
          try {
            const jsonCall = JSON.parse(message.body);
            if (jsonCall.method === 'JSONCallResult') {
              const result = Array.isArray(jsonCall.params) && jsonCall.params.length > 0
                ? jsonCall.params[jsonCall.params.length - 1]
                : (jsonCall.result || null);

              if (result && typeof result === 'object' && result.status === 'error' && typeof result.message === 'string' && result.message &&
                !result.type && result.documentId == null && result.contractId == null) {
                toast.error(String(result.message), { header: 'Hub', duration: 6000 });
              }

              // Full GetNetworkStatus / ListPeers payloads (and hub pushes). Match {@link isHubNetworkStatusShape}
              // so we do not drop valid status when `network` is absent or the hub shape drifts slightly.
              if (result && typeof result === 'object' && !result.type && isHubNetworkStatusShape(result)) {
                this.applyHubNetworkStatusPayload(result);
              }

              // WebRTC peer discovery response (does not touch networkStatus)
              if (result && typeof result === 'object' && result.type === 'ListWebRTCPeersResult' && Array.isArray(result.peers)) {
                if (this.settings.debug) {
                  console.debug('[BRIDGE]', 'Received WebRTC peer candidates:', result.peers.length);
                }
                this.handlePeerCandidates(result.peers);
              }
              // Native WebRTC signaling messages
              this._handleWebRTCSignalResult(result);
              // Handle non-network results used by routed pages / detail views
              if (result && typeof result === 'object' && result.type === 'GetPeerResult' && result.peer) {
                const p = result.peer;
                const addr = p.address;
                const fabricId = p.id;
                if (addr || fabricId) {
                  this.globalState.peers = this.globalState.peers || {};
                  const keys = [...new Set([addr, fabricId].filter(Boolean))];
                  for (const k of keys) {
                    this.globalState.peers[k] = { ...(this.globalState.peers[k] || {}), ...p };
                  }
                  window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                    detail: {
                      operation: { op: 'add', path: `/peers/${keys[0]}`, value: this.globalState.peers[keys[0]] },
                      globalState: this.globalState
                    }
                  }));
                }
              }
              // Documents RPC results
              if (result && typeof result === 'object' && result.type === 'ListDocumentsResult' && Array.isArray(result.documents)) {
                this.globalState.documents = this.globalState.documents || {};
                for (const doc of result.documents) {
                  if (!doc || !doc.id) continue;
                  this._storeDocument(doc.id, { ...(this.globalState.documents[doc.id] || {}), ...doc });
                }
                window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                  detail: {
                    operation: { op: 'replace', path: `/documents`, value: this.globalState.documents },
                    globalState: this.globalState
                  }
                }));
              }
              if (result && typeof result === 'object' && result.type === 'GetDocumentResult') {
                if (result.document && result.document.id) {
                  const id = result.document.id;
                  this._storeDocument(id, result.document);
                  window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                    detail: {
                      operation: { op: 'add', path: `/documents/${id}`, value: result.document },
                      globalState: this.globalState
                    }
                  }));
                } else if (result.documentId) {
                  window.dispatchEvent(new CustomEvent('documentLoadFailed', {
                    detail: {
                      documentId: String(result.documentId),
                      message: (result.message && String(result.message)) || 'Document not found.'
                    }
                  }));
                }
              }
              if (result && typeof result === 'object' && result.type === 'ConfirmInventoryHtlcPaymentResult') {
                window.dispatchEvent(new CustomEvent('inventoryHtlcConfirmResult', { detail: result }));
              }
              this.mergeCreateDocumentRpcResult(result);
              if (result && typeof result === 'object' && (result.type === 'ClaimPurchaseResult' || (result.status === 'error' && result.documentId))) {
                const docId = result.documentId;
                const pending = this._pendingClaimCallbacks && docId && this._pendingClaimCallbacks.get(docId);
                if (pending) {
                  this._pendingClaimCallbacks.delete(docId);
                  if (result.document) {
                    pending.resolve({ document: result.document });
                  } else {
                    pending.resolve({ error: (result && result.message) || 'Claim failed' });
                  }
                }
              }
              if (result && typeof result === 'object' && result.type === 'CreatePurchaseInvoiceResult' && result.documentId) {
                const purchaseDid = String(result.documentId);
                if (this._pendingCreatePurchaseInvoiceBackendIds) {
                  this._pendingCreatePurchaseInvoiceBackendIds.delete(purchaseDid);
                }
                window.dispatchEvent(new CustomEvent('purchaseInvoiceReady', {
                  detail: {
                    documentId: purchaseDid,
                    address: result.address,
                    amountSats: result.amountSats,
                    contentHash: result.contentHash,
                    network: result.network
                  }
                }));
              } else if (
                result && typeof result === 'object' &&
                result.status === 'error' &&
                result.documentId != null && String(result.documentId) !== '' &&
                this._pendingCreatePurchaseInvoiceBackendIds &&
                this._pendingCreatePurchaseInvoiceBackendIds.has(String(result.documentId))
              ) {
                const purchaseErrDid = String(result.documentId);
                this._pendingCreatePurchaseInvoiceBackendIds.delete(purchaseErrDid);
                window.dispatchEvent(new CustomEvent('purchaseInvoiceFailed', {
                  detail: {
                    documentId: purchaseErrDid,
                    message: String(result.message || 'Could not create purchase invoice')
                  }
                }));
              }
              if (result && typeof result === 'object' && result.type === 'CreateDistributeInvoiceResult' && result.documentId) {
                const distDid = String(result.documentId);
                if (this._pendingCreateDistributeInvoiceBackendIds) {
                  this._pendingCreateDistributeInvoiceBackendIds.delete(distDid);
                }
                window.dispatchEvent(new CustomEvent('distributeInvoiceReady', {
                  detail: {
                    documentId: distDid,
                    address: result.address,
                    amountSats: result.amountSats,
                    config: result.config,
                    network: result.network
                  }
                }));
              } else if (
                result && typeof result === 'object' &&
                result.status === 'error' &&
                result.documentId != null && String(result.documentId) !== '' &&
                this._pendingCreateDistributeInvoiceBackendIds &&
                this._pendingCreateDistributeInvoiceBackendIds.has(String(result.documentId))
              ) {
                const distErrDid = String(result.documentId);
                this._pendingCreateDistributeInvoiceBackendIds.delete(distErrDid);
                window.dispatchEvent(new CustomEvent('distributeInvoiceFailed', {
                  detail: {
                    documentId: distErrDid,
                    message: String(result.message || 'Could not create distribute invoice')
                  }
                }));
              }
              if (result && typeof result === 'object' && result.type === 'AcceptDistributeProposalResult' && result.documentId) {
                const accDid = String(result.documentId);
                if (
                  this._pendingAcceptDistributeContext &&
                  this._pendingAcceptDistributeContext.backendId === accDid
                ) {
                  this._pendingAcceptDistributeContext = null;
                }
                window.dispatchEvent(new CustomEvent('distributeInvoiceReady', {
                  detail: {
                    documentId: accDid,
                    address: result.address,
                    amountSats: result.amountSats,
                    config: result.config,
                    network: result.network,
                    fromProposal: true
                  }
                }));
              } else if (
                result && typeof result === 'object' &&
                result.status === 'error' &&
                result.documentId != null && String(result.documentId) !== '' &&
                this._pendingAcceptDistributeContext &&
                String(result.documentId) === this._pendingAcceptDistributeContext.backendId
              ) {
                const ctx = this._pendingAcceptDistributeContext;
                this._pendingAcceptDistributeContext = null;
                const failDid = String(result.documentId);
                try {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('acceptDistributeProposalFailed', {
                      detail: {
                        documentId: failDid,
                        proposalId: ctx.proposalId,
                        message: String(result.message || 'Could not accept proposal')
                      }
                    }));
                  }
                } catch (_) {}
              }
              if (result && typeof result === 'object' && result.type === 'SendDistributeProposalResult') {
                const ctx = this._pendingSendDistributeProposalContext;
                if (ctx) {
                  this._pendingSendDistributeProposalContext = null;
                  const did = String(
                    (result.documentId != null && String(result.documentId) !== '')
                      ? result.documentId
                      : ctx.backendId
                  );
                  if (result.status === 'success') {
                    try {
                      if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('distributeProposalSent', {
                          detail: {
                            documentId: did,
                            proposalId: result.proposalId != null ? String(result.proposalId) : '',
                            peerKey: ctx.peerKey
                          }
                        }));
                      }
                    } catch (_) {}
                  } else {
                    try {
                      if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('distributeProposalFailed', {
                          detail: {
                            documentId: did,
                            message: String(result.message || 'Could not send hosting offer')
                          }
                        }));
                      }
                    } catch (_) {}
                  }
                }
              }
              this.mergePublishDocumentRpcResult(result);
              if (result && typeof result === 'object' && result.type === 'CreateExecutionContractResult' && result.contract) {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('executionContractCreated', {
                    detail: { contract: result.contract, id: result.id || result.contract.id }
                  }));
                }
              }
              if (result && typeof result === 'object' && result.type === 'CreateStorageContractResult' && result.contract && result.contract.document) {
                const backendDocId = result.contract.document; // sha-based id
                const contractId = result.id || result.contract.id;
                if (backendDocId && contractId) {
                  this.globalState.documents = this.globalState.documents || {};

                  let targetId = backendDocId;
                  // Prefer local alias by sha256 when present.
                  for (const [localId, existingDoc] of Object.entries(this.globalState.documents)) {
                    if (existingDoc && (existingDoc.sha256 === backendDocId || existingDoc.sha === backendDocId)) {
                      targetId = localId;
                      break;
                    }
                  }

                  const existing = this.globalState.documents[targetId] || {};
                  this.globalState.documents[targetId] = {
                    ...existing,
                    storageContractId: contractId
                  };

                  if (targetId !== backendDocId && this.globalState.documents[backendDocId]) {
                    delete this.globalState.documents[backendDocId];
                  }

                  window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                    detail: {
                      operation: { op: 'add', path: `/documents/${targetId}`, value: this.globalState.documents[targetId] },
                      globalState: this.globalState
                    }
                  }));

                  // Notify that payment is bonded; proposals can update to show the contract.
                  window.dispatchEvent(new CustomEvent('storageContractBonded', {
                    detail: { documentId: backendDocId, contractId, targetId }
                  }));
                }
              }
              if (result && typeof result === 'object' && result.type === 'CreateStorageContractFailed') {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('storageContractBondFailed', {
                    detail: {
                      documentId: result.documentId,
                      message: (result.message && String(result.message)) || 'Create storage contract failed.'
                    }
                  }));
                }
              }
              if (typeof this.props.responseCapture === 'function') {
                this.props.responseCapture({
                  type: 'GenericMessage',
                  content: message.body
                });
              }
            }
          } catch (parseError) {
            console.debug('[BRIDGE]', 'JSONCall body is not valid JSON, skipping parse');
          }
          break;
        case 'GENERIC_MESSAGE':
        case 'GenericMessage':
          // Check for FileMessage and Inventory responses (broadcast as GenericMessage when type unknown)
          try {
            const parsed = JSON.parse(message.body);
            const bridgeEnv = fabricBridgeEnvelope.tryParse(parsed);
            if (bridgeEnv && typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('fabricBridgeEnvelope', { detail: bridgeEnv }));
            }
            if (parsed && parsed.type === 'Tombstone' && parsed.object && typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('fabric:tombstone', {
                detail: {
                  messageId: parsed.object.activityMessageId || null,
                  documentId: parsed.object.documentId || null
                }
              }));
              break;
            }
            if (parsed && parsed.type === DOCUMENT_OFFER && typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('fabric:documentOffer', { detail: parsed }));
              break;
            }
            if (parsed && parsed.type === 'P2P_FILE_SEND' && parsed.object) {
              const doc = parsed.object;
              if (doc.id && doc.contentBase64) {
                if (doc.part && doc.part.transferId != null && doc.part.total != null) {
                  this._handleP2pFileChunk(doc, doc.part);
                } else {
                  const targetId = this._resolveDocumentTargetId(doc.id, doc);
                  this._storeDocument(targetId, { ...doc, receivedFromPeer: true });
                  this._persistDocuments();
                  window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                    detail: {
                      operation: { op: 'add', path: `/documents/${targetId}`, value: this.globalState.documents[targetId] },
                      globalState: this.globalState
                    }
                  }));
                }
              }
              break;
            }

            // P2P_PEER_GOSSIP from Fabric P2P (broadcast by Hub)
            if (parsed && parsed.type === P2P_PEER_GOSSIP && Array.isArray(parsed.object && parsed.object.peers)) {
              this._recordPeerGossipTopology(parsed, null);
              const peers = parsed.object.peers;
              const candidates = peers.map((p) => ({
                id: p.id || p.peerId,
                peerId: p.id || p.peerId,
                lastSeen: p.lastSeen || p.registeredAt || Date.now(),
                registeredAt: p.registeredAt || p.lastSeen || Date.now(),
                source: 'gossip'
              })).filter((c) => c.id && c.id !== this.peerId);
              if (candidates.length > 0) this.handlePeerCandidates(candidates);
              break;
            }

            // P2P_PEERING_OFFER from Fabric P2P (broadcast by Hub)
            if (parsed && parsed.type === P2P_PEERING_OFFER && parsed.object) {
              const obj = parsed.object;
              const slots = Number(obj.slots || obj.needed || 1);
              const transport = obj.transport || 'webrtc';
              if (transport === 'webrtc' && slots > 0 && this.peerId) {
                const offererId = parsed.actor && parsed.actor.id;
                if (offererId && offererId !== this.peerId && !this.webrtcPeers.has(offererId) && !this._connectingPeers.has(offererId)) {
                  this.handlePeerCandidates([{ id: offererId, peerId: offererId, lastSeen: Date.now(), source: 'peeringOffer' }]);
                }
              }
              break;
            }

            // Inventory responses from peers for documents, stored under globalState.peers[peerId].inventory.documents.
            if (parsed && parsed.type === 'INVENTORY_RESPONSE' && parsed.object && parsed.object.kind === 'documents') {
              const peerId = parsed.actor && parsed.actor.id;
              const items = Array.isArray(parsed.object.items) ? parsed.object.items : [];
              if (peerId) {
                this.globalState.peers = this.globalState.peers || {};
                const keysToTouch = new Set([peerId]);
                for (const k of Object.keys(this.globalState.peers)) {
                  const ex = this.globalState.peers[k];
                  if (ex && ex.id === peerId) keysToTouch.add(k);
                }
                for (const k of keysToTouch) {
                  const existing = this.globalState.peers[k] || {};
                  const inventory = existing.inventory || {};
                  const next = {
                    ...existing,
                    inventory: {
                      ...inventory,
                      documents: items
                    }
                  };
                  this.globalState.peers[k] = next;
                }
                window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                  detail: {
                    operation: { op: 'add', path: `/peers/${peerId}`, value: this.globalState.peers[peerId] },
                    globalState: this.globalState
                  }
                }));
              }
              break;
            }
          } catch (e) { /* not JSON or not file message */ }
          this.props.responseCapture({
            type: 'GenericMessage',
            content: message.body
          });
          break;
        case 'P2P_RELAY':
          try {
            const envelope = JSON.parse(message.body);
            const original = envelope && envelope.original;
            const originalType = envelope && envelope.originalType;
            if (!original || !originalType) break;
            if (originalType === 'fabric-message') {
              const buf = Buffer.from(original, 'base64');
              const firstHop = envelope && Array.isArray(envelope.hops) && envelope.hops[0] && envelope.hops[0].from;
              const relId = firstHop != null ? String(firstHop) : HUB_FABRIC_SESSION_ID;
              const relKind = firstHop != null ? SESSION_KIND_WEBRTC : SESSION_KIND_HUB;
              this.onSocketMessage({
                data: buf,
                _fabricTransport: { sessionId: relId, kind: relKind }
              });
              break;
            }
            if (originalType === P2P_PEER_GOSSIP) {
              const parsed = typeof original === 'string' ? JSON.parse(original) : original;
              this._recordPeerGossipTopology(parsed, null);
              const peers = Array.isArray(parsed && parsed.object && parsed.object.peers) ? parsed.object.peers : [];
              const candidates = peers.map((p) => ({
                id: p.id || p.peerId,
                peerId: p.id || p.peerId,
                lastSeen: p.lastSeen || p.registeredAt || Date.now(),
                registeredAt: p.registeredAt || p.lastSeen || Date.now(),
                source: 'gossip'
              })).filter((c) => c.id && c.id !== this.peerId);
              if (candidates.length > 0) this.handlePeerCandidates(candidates);
              break;
            }
            if (originalType === P2P_PEERING_OFFER) {
              const parsed = typeof original === 'string' ? JSON.parse(original) : original;
              const obj = (parsed && parsed.object) || {};
              const transport = obj.transport || 'webrtc';
              const slots = Number(obj.slots || obj.needed || 1);
              if (transport === 'webrtc' && slots > 0 && this.peerId) {
                const offererId = parsed && parsed.actor && parsed.actor.id;
                if (offererId && offererId !== this.peerId && !this.webrtcPeers.has(offererId) && !this._connectingPeers.has(offererId)) {
                  this.handlePeerCandidates([{ id: offererId, peerId: offererId, lastSeen: Date.now(), source: 'peeringOffer' }]);
                }
              }
              break;
            }
            if (originalType === 'INVENTORY_RESPONSE') {
              const parsed = typeof original === 'string' ? JSON.parse(original) : original;
              if (parsed && parsed.type === 'INVENTORY_RESPONSE' && parsed.object && parsed.object.kind === 'documents') {
                const peerId = parsed.actor && parsed.actor.id;
                const items = Array.isArray(parsed.object.items) ? parsed.object.items : [];
                if (peerId) {
                  this.globalState.peers = this.globalState.peers || {};
                  const keysToTouch = new Set([peerId]);
                  for (const k of Object.keys(this.globalState.peers)) {
                    const ex = this.globalState.peers[k];
                    if (ex && ex.id === peerId) keysToTouch.add(k);
                  }
                  for (const k of keysToTouch) {
                    const existing = this.globalState.peers[k] || {};
                    const inventory = existing.inventory || {};
                    this.globalState.peers[k] = {
                      ...existing,
                      inventory: { ...inventory, documents: items }
                    };
                  }
                  window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                    detail: {
                      operation: { op: 'add', path: `/peers/${peerId}`, value: this.globalState.peers[peerId] },
                      globalState: this.globalState
                    }
                  }));
                }
              }
              break;
            }
            let chat = null;
            if (originalType === 'P2P_CHAT_MESSAGE') {
              chat = typeof original === 'string' ? JSON.parse(original) : original;
            }
            if (!chat || chat.type !== 'P2P_CHAT_MESSAGE') break;
            const content = (chat.object && chat.object.content) || '';
            const proposal = this._parseDistributeProposal(content, chat);
            if (proposal) {
              this._storeDistributeProposal(proposal);
              break;
            }
            if (this._tryDispatchFederationContractInviteFromChat(content, chat)) {
              break;
            }
            const relayOfferPrefix = `[${DOCUMENT_OFFER}] `;
            if (typeof content === 'string' && content.startsWith(relayOfferPrefix) && typeof window !== 'undefined') {
              try {
                const env = JSON.parse(content.slice(relayOfferPrefix.length));
                if (env && env.type === DOCUMENT_OFFER) {
                  window.dispatchEvent(new CustomEvent('fabric:documentOffer', { detail: env }));
                }
              } catch (_) { /* ignore */ }
            }
            const created = (chat.object && chat.object.created) || chat.created || Date.now();
            const id = `chat:${created}:${(chat.actor && chat.actor.id) || 'unknown'}`;
            this.globalState.messages = this.globalState.messages || {};
            const clientId = chat.object && chat.object.clientId;
            if (clientId && this.globalState.messages[clientId]) {
              delete this.globalState.messages[clientId];
            }
            this.globalState.messages[id] = Object.assign({}, chat, {
              transport: 'relay',
              delivery: { via: 'bridge', hops: envelope.hops || [] }
            });
            window.dispatchEvent(new CustomEvent('globalStateUpdate', {
              detail: {
                operation: { op: 'add', path: `/messages/${id}`, value: this.globalState.messages[id] },
                globalState: this.globalState
              }
            }));
            this._persistMessages();
          } catch (e) {
            console.error('[BRIDGE]', 'Could not parse P2P_RELAY envelope:', safeIdentityErr(e));
          }
          break;
        case 'CHAT_MESSAGE':
        case 'ChatMessage':
          try {
            const chat = JSON.parse(message.body);
            const content = (chat && chat.object && chat.object.content) || '';
            // Check for Distribute Proposal (structured JSON in chat content)
            const proposal = this._parseDistributeProposal(content, chat);
            if (proposal) {
              this._storeDistributeProposal(proposal);
              break;
            }
            if (this._tryDispatchFederationContractInviteFromChat(content, chat)) {
              break;
            }

            const offerPrefix = `[${DOCUMENT_OFFER}] `;
            if (typeof content === 'string' && content.startsWith(offerPrefix) && typeof window !== 'undefined') {
              try {
                const env = JSON.parse(content.slice(offerPrefix.length));
                if (env && env.type === DOCUMENT_OFFER) {
                  window.dispatchEvent(new CustomEvent('fabric:documentOffer', { detail: env }));
                }
              } catch (_) { /* ignore malformed demo line */ }
            }

            const created = (chat && chat.object && chat.object.created) || (chat && chat.created) || Date.now();
            const id = `chat:${created}:${(chat && chat.actor && chat.actor.id) || 'unknown'}`;
            this.globalState.messages = this.globalState.messages || {};

            if (this.settings && this.settings.debug) {
              try {
                // Lightweight audit log so we can see exactly how chat identities
                // are flowing into the browser.
                console.log('[BRIDGE:CHAT]', JSON.stringify({
                  actorId: chat && chat.actor && chat.actor.id,
                  clientId: chat && chat.object && chat.object.clientId,
                  created
                }));
              } catch (e) {
                console.log('[BRIDGE:CHAT]', 'parse failed', safeIdentityErr(e));
              }
            }

            // If this message has a clientId, remove the pending optimistic entry we stored earlier
            const clientId = chat && chat.object && chat.object.clientId;
            if (clientId && this.globalState.messages[clientId]) {
              delete this.globalState.messages[clientId];
            }

            this.globalState.messages[id] = chat;

            // Notify UI of new chat message (re-use existing globalStateUpdate channel).
            window.dispatchEvent(new CustomEvent('globalStateUpdate', {
              detail: {
                operation: { op: 'add', path: `/messages/${id}`, value: chat },
                globalState: this.globalState
              }
            }));
            this._persistMessages();
          } catch (e) {
            console.error('[BRIDGE]', 'Could not parse ChatMessage body:', safeIdentityErr(e));
          }
          break;
        case 'JSONPatch':
          // Handle JSONPatch messages (canonical path). Body may be message.body or message.data (Fabric Message.fromRaw sets data; body getter uses raw.data).
          try {
            const bodyRaw = message.body != null ? message.body : (message.data != null && typeof message.data === 'string' ? message.data : (message.data != null && (Buffer.isBuffer(message.data) || (typeof Uint8Array !== 'undefined' && message.data instanceof Uint8Array)) ? Buffer.from(message.data).toString('utf8') : null));
            if (bodyRaw == null) {
              console.error('[BRIDGE]', 'JSONPatch message has no body/data');
              break;
            }
            const patchData = JSON.parse(bodyRaw);

            // Update global state
            this.updateGlobalState(patchData);

            // Emit as PATCH format for components
            this.props.responseCapture({
              type: 'PATCH',
              path: patchData.path,
              value: patchData.value
            });
          } catch (parseError) {
            console.error('[BRIDGE]', 'Could not parse JSONPatch message body:', safeIdentityErr(parseError));
          }
          break;
        case 'MessageStart':
        case 'MessageChunk':
        case 'HelpMsgUser':
        case 'HelpMsgAdmin':
        case 'IngestFile':
        case 'IngestDocument':
        case 'takenJob':
        case 'completedJob':
          this.props.responseCapture(message.toObject());
          break;
      }

      // Update component state with message data
      this.setState({ data: message.toObject() }, () => {
        // Call onStateUpdate prop if provided for backward compatibility
        if (this.props.onStateUpdate && typeof this.props.onStateUpdate === 'function') {
          this.props.onStateUpdate(this.state);
        }
      });
    } catch (error) {
      console.error('[BRIDGE]', 'Error processing message:', safeIdentityErr(error));
      this.setState({ error: safeIdentityErr(error) }, () => {
        // Call onStateUpdate prop if provided for backward compatibility
        if (this.props.onStateUpdate && typeof this.props.onStateUpdate === 'function') {
          this.props.onStateUpdate(this.state);
        }
      });
    }
  }

  async onSocketOpen () {
    this._fabricHubReconnectSuspended = false;
    this._resetHubFabricTransportSession();
    this.attempts = 1;
    const now = Date.now();

    this.sendNetworkStatusRequest();
    this._resubscribeAll();
    this._flushChatSubmissionQueue();
    this._flushPendingHubChatQueue();
    this._flushPeerMessageQueue();

    const message = Message.fromVector(['Ping', now.toString()]);
    const messageBuffer = message.toBuffer();
    this.sendSignedMessage(messageBuffer);
  }

  /**
   * Send network status request (backward compatibility)
   */
  sendNetworkStatusRequest () {
    const message = Message.fromVector(['JSONCall', JSON.stringify({ method: 'GetNetworkStatus', params: [] })]);
    const buffer = message.toBuffer();
    if (this.settings.debug) {
      console.debug('[BRIDGE]', 'Sending network status request, bytes:', buffer && buffer.length);
    }
    this.sendSignedMessage(buffer);
  }

  /**
   * Apply a {@link GetNetworkStatus} / push payload (same as WebSocket JSONCallResult path).
   * Used by HTTP `/services/rpc` fallbacks when the UI needs catalog + peers without waiting on WS.
   * @param {object} result
   * @returns {boolean} true when applied
   */
  applyHubNetworkStatusPayload (result) {
    if (!result || typeof result !== 'object' || result.type || !isHubNetworkStatusShape(result)) {
      return false;
    }
    this.setState({ networkStatus: result, lastNetworkStatus: result }, () => {
      try {
        this._flushPeerMessageQueue();
      } catch (_) {}
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('networkStatusUpdate', { detail: { networkStatus: result } }));
        }
      } catch (_) {}
    });
    const published = result.publishedDocuments;
    if (published && typeof published === 'object' && this.globalState && this.globalState.documents) {
      const changed = mergePublishedDocumentsFromHubStatus(this.globalState.documents, published);
      if (changed) {
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('globalStateUpdate', {
              detail: { operation: { op: 'replace', path: '/documents', value: this.globalState.documents }, globalState: this.globalState }
            }));
          }
        } catch (_) {}
      }
    }
    const hubMessages = result.messages;
    if (hubMessages && typeof hubMessages === 'object' && this.globalState) {
      const current = this.globalState.messages && typeof this.globalState.messages === 'object'
        ? this.globalState.messages
        : {};
      const merged = { ...current, ...hubMessages };
      this.globalState.messages = merged;
      this._persistMessages();
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('globalStateUpdate', {
            detail: { operation: { op: 'replace', path: '/messages', value: this.globalState.messages }, globalState: this.globalState }
          }));
        }
      } catch (_) {}
    }
    return true;
  }

  /**
   * Merge `ListDocuments` JSON-RPC result into {@link globalState.documents} (same as WebSocket path).
   * @param {object} result
   * @returns {boolean} true when merged
   */
  mergeListDocumentsRpcResult (result) {
    if (!result || typeof result !== 'object' || result.type !== 'ListDocumentsResult' || !Array.isArray(result.documents)) {
      return false;
    }
    this.globalState.documents = this.globalState.documents || {};
    for (const doc of result.documents) {
      if (!doc || !doc.id) continue;
      this._storeDocument(doc.id, { ...(this.globalState.documents[doc.id] || {}), ...doc });
    }
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('globalStateUpdate', {
          detail: {
            operation: { op: 'replace', path: `/documents`, value: this.globalState.documents },
            globalState: this.globalState
          }
        }));
      }
    } catch (_) {}
    return true;
  }

  /**
   * Request an updated peer list from the hub.
   * This uses the ListPeers JSONCall method, which returns
   * the same status shape as GetNetworkStatus (including peers).
   */
  sendListPeersRequest () {
    const message = Message.fromVector(['JSONCall', JSON.stringify({ method: 'ListPeers', params: [] })]);
    const buffer = message.toBuffer();
    if (this.settings.debug) {
      console.debug('[BRIDGE]', 'Sending ListPeers request, bytes:', buffer && buffer.length);
    }
    this.sendSignedMessage(buffer);
  }

  /**
   * Send a request to add a peer.
   * @param {Object} peer - Peer descriptor (e.g. { address }).
   */
  sendAddPeerRequest (peer = {}) {
    const raw = typeof peer === 'string' ? peer : (peer && peer.address) || '';
    const normalizedAddr = normalizePeerAddressInput(raw);
    if (!normalizedAddr) {
      console.warn('[BRIDGE] sendAddPeerRequest: no address provided');
      return;
    }

    try {
      const payload = {
        method: 'AddPeer',
        params: [{ address: normalizedAddr }]
      };

      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      const buffer = message.toBuffer();
      this.sendSignedMessage(buffer);

      // After requesting a new peer, refresh the peer list so
      // the UI reflects the updated peer set.
      setTimeout(() => {
        try {
          this.sendListPeersRequest();
        } catch (refreshError) {
          console.error('[BRIDGE]', 'Error refreshing peer list after AddPeer:', safeIdentityErr(refreshError));
        }
      }, 1000);
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending AddPeer request:', safeIdentityErr(error));
    }
  }

  /**
   * Request to disconnect a peer by address.
   * @param {string|{ address: string }} address - Peer address or object with address.
   */
  sendRemovePeerRequest (idOrAddress) {
    const resolved = typeof idOrAddress === 'object' && idOrAddress ? (idOrAddress.id || idOrAddress.address) : idOrAddress;
    if (!resolved) return;
    try {
      const payload = { method: 'RemovePeer', params: [resolved] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
      setTimeout(() => {
        try {
          this.sendListPeersRequest();
        } catch (e) {
          console.error('[BRIDGE]', 'Error refreshing peer list after RemovePeer:', safeIdentityErr(e));
        }
      }, 500);
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending RemovePeer request:', safeIdentityErr(error));
    }
  }

  /**
   * Submit a chat message for broadcast: store locally first, queue for hub, then relay to all clients and Fabric nodes.
   * @param {string} text - Message text.
   */
  submitChatMessage (text) {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return false;

    if (!this._hasUnlockedIdentity()) {
      console.warn('[BRIDGE]', 'submitChatMessage called without an unlocked identity; message will not be sent.');
      this._notifyIdentityUnlockRequired();
      return false;
    }
    const identityId = this._getIdentityId();

    const clientId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const created = Date.now();
    const actorId = identityId;
    const chat = {
      type: 'P2P_CHAT_MESSAGE',
      actor: { id: actorId },
      object: { content: trimmed, created, clientId },
      // Unified flow: optimistic entry remains pending until canonical hub echo.
      status: 'pending'
    };

    this.globalState.messages = this.globalState.messages || {};
    this.globalState.messages[clientId] = chat;
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'add', path: `/messages/${clientId}`, value: chat },
        globalState: this.globalState
      }
    }));
    this._persistMessages();

    // In WebRTC-only mode, do not depend on WebSocket queue state.
    // Send immediately over mesh (and skip hub RPC in sendSubmitChatMessageRequest).
    if (this.preferWebRTCChat) {
      this.sendSubmitChatMessageRequest({
        text: trimmed,
        created,
        clientId,
        actor: actorId ? { id: actorId } : undefined
      });
      return true;
    }

    this.chatSubmissionQueue.push({ text: trimmed, clientId, actorId, created });
    this._flushChatSubmissionQueue();
    return true;
  }

  _flushChatSubmissionQueue () {
    const hubConnected = this._isConnected && this.ws && this.ws.readyState === 1;
    while (this.chatSubmissionQueue.length > 0) {
      const item = this.chatSubmissionQueue.shift();
      if (!item) continue;
      if (hubConnected) {
        this.sendSubmitChatMessageRequest({
          text: item.text,
          created: item.created,
          clientId: item.clientId,
          actor: item.actorId ? { id: item.actorId } : undefined
        });
      } else {
        // Hub down: deliver to WebRTC-connected peers now, and queue for bridge when it reconnects
        this._broadcastChatToWebRTCPeersOnly({
          text: item.text,
          created: item.created,
          clientId: item.clientId,
          actor: item.actorId ? { id: item.actorId } : undefined
        });
        this.pendingHubChatQueue.push({
          text: item.text,
          created: item.created,
          clientId: item.clientId,
          actorId: item.actorId
        });
      }
    }
  }

  /**
   * When the Hub reconnects, send any chat messages that were queued while it was offline.
   */
  _flushPendingHubChatQueue () {
    if (!this._isConnected || !this.ws || this.ws.readyState !== 1) return;
    while (this.pendingHubChatQueue.length > 0) {
      const item = this.pendingHubChatQueue.shift();
      if (!item) continue;
      this.sendSubmitChatMessageRequest({
        text: item.text,
        created: item.created,
        clientId: item.clientId,
        actor: item.actorId ? { id: item.actorId } : undefined
      });
    }
  }

  /**
   * Broadcast a chat message to connected WebRTC peers only (no Hub).
   * Used when the Hub is disconnected so messages still reach other browser peers.
   */
  _broadcastChatToWebRTCPeersOnly (body) {
    const text = typeof body === 'string' ? body : (body && body.text) || '';
    if (!text) return;
    const created = body && body.created ? body.created : Date.now();
    const clientId = body && body.clientId;
    const actorId = this._getIdentityId() || (body && body.actor && body.actor.id) || null;
    const payload = {
      type: 'P2P_CHAT_MESSAGE',
      actor: actorId ? { id: actorId } : { id: null },
      object: { content: text, created, clientId }
    };
    const recipients = this.broadcastToWebRTCPeersWithRecipients(payload);
    const deliveredTo = recipients.length;
    this._lastWebRTCChatDeliveryCount = deliveredTo;
    this._lastWebRTCChatSentAt = Date.now();
    this._lastWebRTCRecipientPeerIds = recipients;
    if (deliveredTo > 0) {
      console.debug('[BRIDGE]', 'Chat delivered to WebRTC peers (hub offline):', deliveredTo, recipients);
    }
    if (clientId && this.globalState && this.globalState.messages && this.globalState.messages[clientId]) {
      try {
        const msg = this.globalState.messages[clientId];
        msg.transport = msg.transport || 'webrtc';
        msg.delivery = Object.assign({}, msg.delivery || {}, { via: 'mesh', deliveredTo });
        this.globalState.messages[clientId] = msg;
        window.dispatchEvent(new CustomEvent('globalStateUpdate', {
          detail: {
            operation: { op: 'replace', path: `/messages/${clientId}`, value: msg },
            globalState: this.globalState
          }
        }));
        this._persistMessages();
      } catch (e) {}
    }
  }

  /**
   * Send SubmitChatMessage JSONCall to hub (broadcast to all clients + Fabric nodes).
   * @param {Object} body - { text, clientId?, actor? }
   */
  sendSubmitChatMessageRequest (body) {
    const text = typeof body === 'string' ? body : (body && body.text) || '';
    if (!text) return;
    if (!this._hasUnlockedIdentity()) {
      console.warn('[BRIDGE]', 'sendSubmitChatMessageRequest called without an unlocked identity; message will not be sent.');
      this._notifyIdentityUnlockRequired();
      return;
    }
    const created = body && body.created ? body.created : Date.now();
    const clientId = body && body.clientId;
    const actorId = this._getIdentityId() || null;

    // In WebRTC mode, also fan out over the mesh, but keep the hub RPC as
    // the canonical network propagation path.
    if (this.preferWebRTCChat) {
      const payload = {
        type: 'P2P_CHAT_MESSAGE',
        actor: actorId ? { id: actorId } : { id: null },
        object: { content: text, created, clientId }
      };
      const recipients = this.broadcastToWebRTCPeersWithRecipients(payload);
      const deliveredTo = recipients.length;
      this._lastWebRTCChatDeliveryCount = deliveredTo;
      this._lastWebRTCChatSentAt = Date.now();
      this._lastWebRTCRecipientPeerIds = recipients;

      // Mark the locally-pending message with explicit WebRTC delivery details.
      if (clientId && this.globalState && this.globalState.messages && this.globalState.messages[clientId]) {
        try {
          const msg = this.globalState.messages[clientId];
          msg.transport = 'webrtc';
          msg.delivery = Object.assign({}, msg.delivery || {}, {
            via: 'mesh',
            deliveredTo
          });
          this.globalState.messages[clientId] = msg;
          window.dispatchEvent(new CustomEvent('globalStateUpdate', {
            detail: {
              operation: { op: 'replace', path: `/messages/${clientId}`, value: msg },
              globalState: this.globalState
            }
          }));
          this._persistMessages();
        } catch (e) {}
      }
      console.debug('[BRIDGE]', 'WebRTC chat broadcast delivery count:', deliveredTo);
    }

    // Always also submit via hub so the message is on the canonical broadcast path.
    try {
      const rpcBody = typeof body === 'object'
        ? Object.assign({}, body, {
            created,
            clientId,
            actor: (body.actor || (actorId ? { id: actorId } : undefined))
          })
        : {
            text,
            created,
            clientId,
            actor: actorId ? { id: actorId } : undefined
          };
      const payload = {
        method: 'SubmitChatMessage',
        params: [rpcBody]
      };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending SubmitChatMessage:', safeIdentityErr(error));
    }
  }

  /**
   * Ask the hub to remove an activity row and/or unpublish a document (admin token required server-side).
   * Uses HTTP POST `/services/rpc` so the caller can await success or surface `status: 'error'` from the hub
   * (WebSocket JSONCall alone does not return a result to the client).
   * @param {string} [messageId] - Hub `globalState.messages` key (omit for unpublish-only).
   * @param {string} [adminToken] - Hub admin token (from setup / localStorage).
   * @param {string} [documentId] - optional published document id to remove from the hub catalog.
   * @returns {Promise<{ ok: boolean, message?: string, result?: object }>}
   */
  async emitTombstone (messageId, adminToken, documentId) {
    let mid, token, docId;
    const isOpts = messageId !== null && typeof messageId === 'object' && !Array.isArray(messageId) &&
      (Object.prototype.hasOwnProperty.call(messageId, 'messageId') ||
        Object.prototype.hasOwnProperty.call(messageId, 'documentId') ||
        Object.prototype.hasOwnProperty.call(messageId, 'adminToken'));
    if (isOpts) {
      mid = messageId.messageId;
      token = messageId.adminToken;
      docId = messageId.documentId;
    } else {
      mid = messageId;
      token = adminToken;
      docId = documentId;
    }
    const id = typeof mid === 'string' ? mid.trim() : '';
    const d = typeof docId === 'string' ? docId.trim() : '';
    if (!id && !d) return { ok: false, message: 'messageId or documentId required' };

    const rpcParams = {
      messageId: id || undefined,
      documentId: d || undefined,
      adminToken: token || null
    };

    try {
      const rpcOrigin = typeof window !== 'undefined' && window.location && window.location.origin
        ? window.location.origin
        : '';
      const res = await fetch(`${rpcOrigin}/services/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'EmitTombstone',
          params: [rpcParams]
        })
      });
      let body = {};
      try {
        body = await res.json();
      } catch (_) {}
      if (!res.ok) {
        const msg = (body && body.error && body.error.message) || res.statusText || `HTTP ${res.status}`;
        return { ok: false, message: msg };
      }
      if (body && body.error) {
        return { ok: false, message: body.error.message || 'RPC error' };
      }
      const result = body && body.result != null ? body.result : null;
      if (result && result.status === 'error') {
        return { ok: false, message: result.message || 'Operation failed' };
      }
      if (result && result.status === 'success') {
        return { ok: true, result };
      }
      return { ok: false, message: (result && result.message) || 'Unexpected response from hub' };
    } catch (error) {
      console.error('[BRIDGE]', 'emitTombstone error:', safeIdentityErr(error));
      return { ok: false, message: error && error.message ? error.message : String(error) };
    }
  }

  /**
   * Enqueue a peer-to-peer chat message for the given address.
   * Messages are persisted and retried when the peer is connected.
   * @param {Object} job - { address, text, created, clientId? }
   */
  _enqueuePeerMessage (job) {
    if (!job || !job.address || !job.text) return;

    // Ensure a created timestamp and a stable clientId for local tracking.
    const created = job.created || Date.now();
    // Use a Fabric Actor ID as the clientId, so queued messages have
    // a stable, content-derived identifier.
    const clientActor = new Actor({
      content: {
        type: 'P2P_CHAT_MESSAGE',
        address: job.address,
        text: job.text,
        created
      }
    });
    const clientId = job.clientId || clientActor.id;
    job.created = created;
    job.clientId = clientId;

    // Create a local chat representation so queued messages are visible in the UI.
    try {
      const identityId = this._getIdentityId();
      if (!identityId) {
        console.warn('[BRIDGE]', 'enqueuePeerMessage called without an unlocked identity; job will not be queued.');
        return;
      }
      const actorId = identityId;
      job.actorId = actorId;
      const chat = {
        type: 'P2P_CHAT_MESSAGE',
        actor: { id: actorId },
        object: {
          content: job.text,
          created,
          clientId
        },
        // Top-level target for ActivityStreams-style compatibility.
        target: job.address,
        status: 'queued'
      };

      this.globalState.messages = this.globalState.messages || {};
      this.globalState.messages[clientId] = chat;

      window.dispatchEvent(new CustomEvent('globalStateUpdate', {
        detail: {
          operation: { op: 'add', path: `/messages/${clientId}`, value: chat },
          globalState: this.globalState
        }
      }));
      this._persistMessages();
    } catch (e) {
      console.warn('[BRIDGE]', 'Could not create local queued peer chat message:', safeIdentityErr(e));
    }

    // Add to in-memory queue and persist.
    this.peerMessageQueue = this.peerMessageQueue || [];
    this.peerMessageQueue.push(job);
    this._writeJSONToStorage('fabric:peerMessageQueue', this.peerMessageQueue);
  }

  /**
   * Attempt to send any queued messages for peers that are currently connected.
   * Uses the latest networkStatus.peers from the hub.
   */
  _flushPeerMessageQueue () {
    if (!this._isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const networkStatus = this.state && this.state.networkStatus;
    const peers = Array.isArray(networkStatus && networkStatus.peers) ? networkStatus.peers : [];
    if (!this.peerMessageQueue || !this.peerMessageQueue.length) return;

    const remaining = [];

    for (const job of this.peerMessageQueue) {
      if (!job || !job.address || !job.text) continue;
      const isConnected = peers.some((p) => p && p.status === 'connected' && (p.id === job.address || p.address === job.address));

      if (!isConnected) {
        remaining.push(job);
        continue;
      }

      try {
        const body = {
          text: job.text,
          clientId: job.clientId
        };
        if (job.actorId) {
          body.actor = { id: job.actorId };
        }
        const payload = { method: 'SendPeerMessage', params: [job.address, body] };
        const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
        this.sendSignedMessage(message.toBuffer());
      } catch (error) {
        console.error('[BRIDGE]', 'Error sending queued peer message:', safeIdentityErr(error));
        remaining.push(job);
      }
    }

    this.peerMessageQueue = remaining;
    if (this.peerMessageQueue.length) {
      this._writeJSONToStorage('fabric:peerMessageQueue', this.peerMessageQueue);
    } else {
      this._removeStorageKey('fabric:peerMessageQueue');
    }
  }

  /**
   * Send a chat message to a peer (queued if the peer is not currently connected).
   * @param {string|{ address: string }} address - Peer address or object with address.
   * @param {string|{ text: string }} body - Message text or object with text.
   */
  sendPeerMessageRequest (idOrAddress, body) {
    const resolved = typeof idOrAddress === 'object' && idOrAddress ? (idOrAddress.id || idOrAddress.address) : idOrAddress;
    const resolvedText = typeof body === 'string' ? body : (body && body.text) || '';
    if (!resolved || !resolvedText) return;
    if (!this._hasUnlockedIdentity()) {
      console.warn('[BRIDGE]', 'sendPeerMessageRequest called without an unlocked identity; message will not be sent.');
      this._notifyIdentityUnlockRequired(fabricIdentityPeerDisabledReasonPlain(this.props && this.props.auth));
      return;
    }
    const created = Date.now();
    // When WebRTC-only chat is enabled, send peer messages over the mesh
    // instead of via the Fabric P2P SendPeerMessage RPC.
    if (this.preferWebRTCChat) {
      const actorId = this._getIdentityId() || null;
      let clientId = null;
      // Create a local "sent" chat message for this peer.
      try {
        const clientActor = new Actor({
          content: {
            type: 'P2P_CHAT_MESSAGE',
            address: resolved,
            text: resolvedText,
            created
          }
        });
        clientId = clientActor.id;
        const chat = {
          type: 'P2P_CHAT_MESSAGE',
          actor: { id: actorId || resolved },
          object: {
            content: resolvedText,
            created,
            clientId
          },
          target: resolved,
          status: 'pending',
          transport: 'webrtc',
          delivery: {
            via: 'mesh',
            deliveredTo: 0
          }
        };

        this.globalState.messages = this.globalState.messages || {};
        this.globalState.messages[clientId] = chat;

        window.dispatchEvent(new CustomEvent('globalStateUpdate', {
          detail: {
            operation: { op: 'add', path: `/messages/${clientId}`, value: chat },
            globalState: this.globalState
          }
        }));
        this._persistMessages();
      } catch (e) {}

      const payload = {
        type: 'P2P_CHAT_MESSAGE',
        actor: actorId ? { id: actorId } : { id: null },
        object: { content: resolvedText, created, clientId: clientId || null }
      };
      // For now, broadcast to all WebRTC peers; peers can choose how to display.
      const recipients = this.broadcastToWebRTCPeersWithRecipients(payload);
      const deliveredTo = recipients.length;
      this._lastWebRTCRecipientPeerIds = recipients;
      this._lastWebRTCChatDeliveryCount = deliveredTo;
      this._lastWebRTCChatSentAt = Date.now();
      try {
        const messages = this.globalState && this.globalState.messages;
        if (messages) {
          const candidate = Object.values(messages).find((m) => {
            const obj = m && m.object;
            return obj && obj.content === resolvedText && obj.created === created;
          });
          if (candidate) {
            candidate.status = deliveredTo > 0 ? 'sent' : 'pending';
            candidate.delivery = Object.assign({}, candidate.delivery || {}, {
              via: 'mesh',
              deliveredTo
            });
            window.dispatchEvent(new CustomEvent('globalStateUpdate', {
              detail: {
                operation: { op: 'replace', path: `/messages/${candidate.object.clientId}`, value: candidate },
                globalState: this.globalState
              }
            }));
            this._persistMessages();
          }
        }
      } catch (e) {}
      console.debug('[BRIDGE]', 'WebRTC peer chat delivery count:', deliveredTo);
      return;
    }
    this._enqueuePeerMessage({ address: resolved, text: resolvedText, created });
    this._flushPeerMessageQueue();
  }

  /**
   * Set a node-local nickname for a peer (stored server-side).
   * @param {string} address
   * @param {string} nickname
   */
  sendSetPeerNicknameRequest (idOrAddress, nickname) {
    const resolved = typeof idOrAddress === 'object' && idOrAddress ? (idOrAddress.id || idOrAddress.address) : idOrAddress;
    if (!resolved) return;
    const clean = nickname == null ? '' : String(nickname);
    try {
      const payload = { method: 'SetPeerNickname', params: [resolved, clean] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
      // Ensure UI updates even if push misses for some reason
      setTimeout(() => {
        try { this.sendListPeersRequest(); } catch (e) {}
      }, 250);
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending SetPeerNickname request:', safeIdentityErr(error));
    }
  }

  /**
   * Request rich peer details from the hub (used by `/peers/:id` page).
   * @param {string|{id,address}} idOrAddress - Peer id (public key) or address
   */
  sendGetPeerRequest (idOrAddress) {
    const resolved = typeof idOrAddress === 'object' && idOrAddress ? (idOrAddress.id || idOrAddress.address) : idOrAddress;
    if (!resolved) return;
    try {
      const payload = { method: 'GetPeer', params: [resolved] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending GetPeer request:', safeIdentityErr(error));
    }
  }

  /**
   * Ask a connected Fabric TCP peer to run a ChainSyncRequest handshake (inventory + BitcoinBlock replay).
   * @param {string|{id?:string,address?:string}} idOrAddress
   */
  sendFabricPeerResyncRequest (idOrAddress) {
    const resolved = typeof idOrAddress === 'object' && idOrAddress
      ? (idOrAddress.address || idOrAddress.id)
      : idOrAddress;
    if (!resolved) return;
    try {
      const payload = {
        method: 'RequestFabricPeerResync',
        params: [{ address: resolved, id: resolved }]
      };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
      setTimeout(() => {
        try {
          if (typeof this.sendNetworkStatusRequest === 'function') this.sendNetworkStatusRequest();
        } catch (e) {}
      }, 400);
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending RequestFabricPeerResync:', safeIdentityErr(error));
    }
  }

  /**
   * Operator: send `P2P_FLUSH_CHAIN` to connected peers above the hub's trusted registry score.
   * @param {{ snapshotBlockHash: string, network?: string, label?: string }} object
   * @param {string} adminToken - hub admin token (required by JSON-RPC)
   */
  sendFlushChainToTrustedPeersRequest (object, adminToken) {
    const snap = object && object.snapshotBlockHash ? String(object.snapshotBlockHash).trim() : '';
    if (!/^[0-9a-fA-F]{64}$/.test(snap)) {
      console.warn('[BRIDGE] sendFlushChainToTrustedPeersRequest: snapshotBlockHash must be 64 hex');
      return;
    }
    const token = adminToken != null ? String(adminToken).trim() : '';
    if (!token) {
      console.warn('[BRIDGE] sendFlushChainToTrustedPeersRequest: adminToken required');
      return;
    }
    try {
      const param = {
        snapshotBlockHash: snap.toLowerCase(),
        adminToken: token
      };
      if (object.network != null && String(object.network).trim()) param.network = String(object.network).trim();
      if (object.label != null && String(object.label).trim()) param.label = String(object.label).trim();
      const payload = {
        method: 'SendFlushChainToTrustedPeers',
        params: [param]
      };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
      setTimeout(() => {
        try {
          if (typeof this.sendNetworkStatusRequest === 'function') this.sendNetworkStatusRequest();
        } catch (e) {}
      }, 400);
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending SendFlushChainToTrustedPeers:', safeIdentityErr(error));
    }
  }

  sendListDocumentsRequest () {
    try {
      const payload = { method: 'ListDocuments', params: [] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending ListDocuments request:', safeIdentityErr(error));
      try {
        pushUiNotification({
          id: `list-documents-${Date.now()}`,
          kind: 'error',
          title: 'Could not refresh document list',
          subtitle: error && error.message ? error.message : String(error),
          href: '/documents'
        });
      } catch (_) {}
    }
  }

  sendGetDocumentRequest (id) {
    const resolved = typeof id === 'object' && id && id.id ? id.id : id;
    if (!resolved) return;
    try {
      const payload = { method: 'GetDocument', params: [resolved] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending GetDocument request:', safeIdentityErr(error));
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('documentLoadFailed', {
            detail: {
              documentId: String(resolved),
              message: error && error.message ? error.message : 'Could not request document from hub.'
            }
          }));
        }
      } catch (_) {}
    }
  }

  /**
   * Apply a hub `GetDocument` JSON-RPC / JSONCallResult payload into local document state.
   * Used when the document detail view falls back to HTTP `/services/rpc` (e.g. WS path delayed).
   * @param {object} result - `{ type: 'GetDocumentResult', document?, documentId?, message? }`
   * @returns {boolean} true when handled (success or not-found)
   */
  mergeGetDocumentRpcResult (result) {
    if (!result || typeof result !== 'object' || result.type !== 'GetDocumentResult') return false;
    if (result.document && result.document.id) {
      const did = result.document.id;
      this._storeDocument(did, result.document);
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('globalStateUpdate', {
            detail: {
              operation: { op: 'add', path: `/documents/${did}`, value: this.globalState.documents[did] },
              globalState: this.globalState
            }
          }));
        }
      } catch (_) {}
      return true;
    }
    if (result.documentId != null && String(result.documentId) !== '') {
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('documentLoadFailed', {
            detail: {
              documentId: String(result.documentId),
              message: (result.message && String(result.message)) || 'Document not found.'
            }
          }));
        }
      } catch (_) {}
      return true;
    }
    return false;
  }

  /**
   * Apply hub `PublishDocument` result (WebSocket JSONCallResult or HTTP /services/rpc fallback).
   * @param {object} result
   * @returns {boolean} true when recognized
   */
  mergePublishDocumentRpcResult (result) {
    if (!result || typeof result !== 'object') return false;
    if (result.type === 'PublishDocumentResult' && result.document && result.document.id) {
      const backendId = result.document.id;
      const sha = result.document.sha256 || backendId;
      if (this._pendingPublishDocumentBackendIds) {
        this._pendingPublishDocumentBackendIds.delete(String(backendId));
      }
      this.globalState.documents = this.globalState.documents || {};
      let targetId = backendId;
      if (sha) {
        for (const [localId, existingDoc] of Object.entries(this.globalState.documents)) {
          if (existingDoc && (existingDoc.sha256 === sha || existingDoc.sha === sha)) {
            targetId = localId;
            break;
          }
        }
      }
      const existing = this.globalState.documents[targetId] || {};
      this.globalState.documents[targetId] = {
        ...existing,
        ...result.document,
        id: targetId,
        published: result.document.published || existing.published || true
      };
      if (targetId !== backendId && this.globalState.documents[backendId]) {
        delete this.globalState.documents[backendId];
      }
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('globalStateUpdate', {
            detail: {
              operation: { op: 'add', path: `/documents/${targetId}`, value: this.globalState.documents[targetId] },
              globalState: this.globalState
            }
          }));
        }
      } catch (_) {}
      return true;
    }
    if (
      result.status === 'error' &&
      result.documentId != null &&
      String(result.documentId) !== '' &&
      this._pendingPublishDocumentBackendIds &&
      this._pendingPublishDocumentBackendIds.has(String(result.documentId))
    ) {
      const pubErrDid = String(result.documentId);
      this._pendingPublishDocumentBackendIds.delete(pubErrDid);
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('publishDocumentFailed', {
            detail: { documentId: pubErrDid, message: String(result.message || 'Publish failed') }
          }));
        }
      } catch (_) {}
      return true;
    }
    if (
      result.status === 'error' &&
      result.message &&
      !result.type &&
      !(Object.prototype.hasOwnProperty.call(result, 'documentId') && result.documentId != null && String(result.documentId) !== '')
    ) {
      const ctx = this._lastPublishCreateContext;
      if (ctx && (Date.now() - ctx.sentAt) < 25000) {
        this._lastPublishCreateContext = null;
        if (this._pendingPublishBySha) this._pendingPublishBySha.delete(ctx.sha);
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('publishDocumentFailed', {
              detail: { documentId: ctx.actorId, message: String(result.message) }
            }));
          }
        } catch (_) {}
      }
      return true;
    }
    return false;
  }

  /**
   * Apply hub `CreateDocument` result (WebSocket JSONCallResult or HTTP /services/rpc fallback).
   * @param {object} result
   * @returns {boolean} true when recognized
   */
  mergeCreateDocumentRpcResult (result) {
    if (!result || typeof result !== 'object' || result.type !== 'CreateDocumentResult' || !result.document || !result.document.id) {
      return false;
    }
    const backendId = result.document.id;
    const sha = result.document.sha256 || backendId;
    if (this._lastPublishCreateContext && sha && this._lastPublishCreateContext.sha === sha) {
      this._lastPublishCreateContext = null;
    }
    this._storeDocument(backendId, { ...(this.globalState.documents[backendId] || {}), ...result.document });
    if (sha && this._pendingPublishBySha && this._pendingPublishBySha.has(sha)) {
      try {
        this.sendPublishDocumentRequest(sha);
      } finally {
        this._pendingPublishBySha.delete(sha);
      }
    }
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('globalStateUpdate', {
          detail: {
            operation: { op: 'add', path: `/documents/${backendId}`, value: this.globalState.documents[backendId] },
            globalState: this.globalState
          }
        }));
      }
    } catch (_) {}
    return true;
  }

  /**
   * Apply hub `CreateDistributeInvoice` JSON-RPC result (same events as WebSocket path).
   * @param {object} result
   * @returns {boolean} true when recognized
   */
  mergeCreateDistributeInvoiceRpcResult (result) {
    if (!result || typeof result !== 'object') return false;
    if (result.type === 'CreateDistributeInvoiceResult' && result.documentId) {
      const distDid = String(result.documentId);
      if (this._pendingCreateDistributeInvoiceBackendIds) {
        this._pendingCreateDistributeInvoiceBackendIds.delete(distDid);
      }
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('distributeInvoiceReady', {
            detail: {
              documentId: distDid,
              address: result.address,
              amountSats: result.amountSats,
              config: result.config,
              network: result.network
            }
          }));
        }
      } catch (_) {}
      return true;
    }
    if (
      result.status === 'error' &&
      result.documentId != null &&
      String(result.documentId) !== ''
    ) {
      const distErrDid = String(result.documentId);
      if (this._pendingCreateDistributeInvoiceBackendIds) {
        this._pendingCreateDistributeInvoiceBackendIds.delete(distErrDid);
      }
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('distributeInvoiceFailed', {
            detail: {
              documentId: distErrDid,
              message: String(result.message || 'Could not create distribute invoice')
            }
          }));
        }
      } catch (_) {}
      return true;
    }
    return false;
  }

  sendCreateDocumentRequest (doc) {
    if (!doc || typeof doc !== 'object') return;
    if (!this._canSignOutgoing()) {
      const sha = doc.sha256 ? String(doc.sha256) : (doc.id ? String(doc.id) : '');
      if (sha && this._pendingPublishBySha) this._pendingPublishBySha.delete(sha);
      if (
        this._lastPublishCreateContext &&
        sha &&
        this._lastPublishCreateContext.sha === sha
      ) {
        const actorId = this._lastPublishCreateContext.actorId;
        this._lastPublishCreateContext = null;
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('publishDocumentFailed', {
              detail: {
                documentId: String(actorId || sha),
                message: 'Unlock your Fabric identity — CreateDocument must be Schnorr-signed on the wire.'
              }
            }));
          }
        } catch (_) {}
      }
      try {
        pushUiNotification({
          id: `create-document-${Date.now()}`,
          kind: 'error',
          title: 'Create document blocked',
          subtitle: 'Unlock your Fabric identity to upload or publish.',
          href: '/documents'
        });
      } catch (_) {}
      return;
    }
    try {
      const contentBase64 = doc.contentBase64 || (doc.id ? this.getDecryptedDocumentContent(doc.id) : null);
      const payloadDoc = contentBase64 ? { ...doc, contentBase64 } : doc;
      const payload = { method: 'CreateDocument', params: [payloadDoc] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
      // Fallback for delayed/lost WS responses: perform same-origin HTTP JSON-RPC CreateDocument.
      setTimeout(() => {
        try {
          const origin = typeof window !== 'undefined' && window.location && window.location.origin
            ? window.location.origin
            : '';
          if (!origin) return;
          fetch(`${origin}/services/rpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'CreateDocument', params: [payloadDoc] })
          })
            .then((r) => r.json().catch(() => null))
            .then((body) => {
              if (!body || body.result == null) return;
              this.mergeCreateDocumentRpcResult(body.result);
            })
            .catch(() => {});
        } catch (_) {}
      }, 2500);
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending CreateDocument request:', safeIdentityErr(error));
      const sha = doc.sha256 ? String(doc.sha256) : (doc.id ? String(doc.id) : '');
      if (sha && this._pendingPublishBySha) {
        this._pendingPublishBySha.delete(sha);
      }
      if (
        this._lastPublishCreateContext &&
        sha &&
        this._lastPublishCreateContext.sha === sha
      ) {
        const actorId = this._lastPublishCreateContext.actorId;
        this._lastPublishCreateContext = null;
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('publishDocumentFailed', {
              detail: {
                documentId: String(actorId || sha),
                message: error && error.message ? error.message : String(error)
              }
            }));
          }
        } catch (_) {}
      }
      try {
        pushUiNotification({
          id: `create-document-${Date.now()}`,
          kind: 'error',
          title: 'Create document failed',
          subtitle: error && error.message ? error.message : String(error),
          href: '/documents'
        });
      } catch (_) {}
    }
  }

  /**
   * Publish a document. When doc needs CreateDocument first, queues publish for after.
   * @param {string} id - Document id
   * @param {Object} [opts] - Optional { purchasePriceSats } for HTLC purchase price
   */
  sendPublishDocumentRequest (id, opts = {}) {
    const logical = typeof id === 'object' && id && id.id ? id.id : id;
    if (!logical) return;

    if (!this._canSignOutgoing()) {
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('publishDocumentFailed', {
            detail: {
              documentId: String(logical),
              message: 'Unlock your Fabric identity — PublishDocument must be Schnorr-signed on the wire.'
            }
          }));
        }
      } catch (_) {}
      return;
    }

    const row = this._resolveDocumentRow(logical);
    const doc = row && row.doc;

    // If this is a local-only document (opaque id) with a backing sha256 and not yet published,
    // first ensure the hub has the full content via CreateDocument, then publish.
    // When `logical` is already the content hash (second hop after CreateDocument), skip re-upload.
    if (needsCreateDocumentBeforePublish(logical, doc)) {
      const sha = doc.sha256;
      const contentBase64 = this.getDecryptedDocumentContent(logical);
      if (!contentBase64) {
        // Fallback: after reload we may have metadata-only local rows while hub already has documents/<sha>.json.
        // Try direct publish by sha instead of failing early on missing local plaintext bytes.
        console.warn('[BRIDGE]', 'Missing local content for create-before-publish; trying direct publish by sha:', logical);
      } else {
        const createDoc = {
          id: sha,
          sha256: sha,
          name: doc.name,
          mime: doc.mime,
          size: doc.size,
          contentBase64
        };
        this._lastPublishCreateContext = { sha: String(sha), actorId: String(logical), sentAt: Date.now() };
        this.sendCreateDocumentRequest(createDoc);
        if (this._pendingPublishBySha) {
          this._pendingPublishBySha.add(sha);
        }
        return;
      }
    }

    let resolved = logical;
    if (doc && doc.sha256) {
      resolved = doc.sha256;
    }

    try {
      const params = typeof opts === 'object' && opts && Number.isFinite(Number(opts.purchasePriceSats))
        ? [{ id: resolved, purchasePriceSats: Number(opts.purchasePriceSats) }]
        : [resolved];
      const backendKey = String(resolved);
      if (this._pendingPublishDocumentBackendIds) {
        this._pendingPublishDocumentBackendIds.add(backendKey);
      }
      const payload = { method: 'PublishDocument', params };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
      // WebSocket delivery can be delayed/lost; fallback to same-origin HTTP JSON-RPC while pending.
      setTimeout(() => {
        try {
          if (
            !this._pendingPublishDocumentBackendIds ||
            !this._pendingPublishDocumentBackendIds.has(backendKey)
          ) return;
          const origin = typeof window !== 'undefined' && window.location && window.location.origin
            ? window.location.origin
            : '';
          if (!origin) return;
          fetch(`${origin}/services/rpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'PublishDocument', params })
          })
            .then((r) => r.json().catch(() => null))
            .then((body) => {
              if (!body || body.result == null) return;
              this.mergePublishDocumentRpcResult(body.result);
            })
            .catch(() => {});
        } catch (_) {}
      }, 3500);
    } catch (error) {
      if (this._pendingPublishDocumentBackendIds) {
        this._pendingPublishDocumentBackendIds.delete(String(resolved));
      }
      console.error('[BRIDGE]', 'Error sending PublishDocument request:', safeIdentityErr(error));
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('publishDocumentFailed', {
            detail: {
              documentId: String(logical),
              message: error && error.message ? error.message : String(error)
            }
          }));
        }
      } catch (_) {}
    }
  }

  /**
   * Request an HTLC purchase invoice for a published document.
   * When result arrives, Bridge dispatches 'purchaseInvoiceReady' event.
   * @param {string} id - Document id
   */
  sendCreatePurchaseInvoiceRequest (id) {
    const logical = typeof id === 'object' && id && id.id ? id.id : id;
    if (!logical) return;
    const doc = this.globalState && this.globalState.documents && this.globalState.documents[logical];
    const backendId = (doc && doc.sha256) ? doc.sha256 : logical;
    const backendKey = String(backendId);
    if (!this._canSignOutgoing()) {
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('purchaseInvoiceFailed', {
            detail: {
              documentId: backendKey,
              message: 'Unlock your Fabric identity — CreatePurchaseInvoice must be Schnorr-signed on the wire.'
            }
          }));
        }
      } catch (_) {}
      return;
    }
    if (this._pendingCreatePurchaseInvoiceBackendIds) {
      this._pendingCreatePurchaseInvoiceBackendIds.add(backendKey);
    }
    try {
      const payload = { method: 'CreatePurchaseInvoice', params: [{ documentId: backendId }] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      if (this._pendingCreatePurchaseInvoiceBackendIds) {
        this._pendingCreatePurchaseInvoiceBackendIds.delete(backendKey);
      }
      console.error('[BRIDGE]', 'Error sending CreatePurchaseInvoice request:', safeIdentityErr(error));
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('purchaseInvoiceFailed', {
            detail: { documentId: backendKey, message: error && error.message ? error.message : String(error) }
          }));
        }
      } catch (_) {}
    }
  }

  /**
   * Claim an HTLC purchase after payment. Returns document with content on success.
   * @param {string} id - Document id
   * @param {string} txid - Payment transaction id
   * @returns {Promise<{document?: Object, error?: string}>}
   */
  async sendClaimPurchaseRequest (id, txid) {
    const logical = typeof id === 'object' && id && id.id ? id.id : id;
    if (!logical || !txid) return { error: 'documentId and txid required' };
    if (!this._canSignOutgoing()) {
      return { error: 'Unlock your Fabric identity — ClaimPurchase must be Schnorr-signed on the wire.' };
    }
    const doc = this.globalState && this.globalState.documents && this.globalState.documents[logical];
    const backendId = (doc && doc.sha256) ? doc.sha256 : logical;
    return new Promise((resolve) => {
      this._pendingClaimCallbacks.set(backendId, { resolve });
      try {
        const payload = { method: 'ClaimPurchase', params: [{ documentId: backendId, txid }] };
        const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
        this.sendSignedMessage(message.toBuffer());
      } catch (error) {
        this._pendingClaimCallbacks.delete(backendId);
        resolve({ error: error && error.message ? error.message : String(error) });
      }
    });
  }

  /**
   * Request a pay-to-distribute invoice (step 1 of distribute flow).
   * When result arrives, Bridge dispatches 'distributeInvoiceReady' event.
   * @param {string} id - Document id
   * @param {Object} config - { amountSats, durationYears?, challengeCadence?, responseDeadline? }
   */
  sendCreateDistributeInvoiceRequest (id, config = {}) {
    const logical = typeof id === 'object' && id && id.id ? id.id : id;
    if (!logical) return;
    const doc = this.globalState && this.globalState.documents && this.globalState.documents[logical];
    let backendId = logical;
    if (doc && doc.sha256) backendId = doc.sha256;
    const backendKey = String(backendId);
    if (!this._canSignOutgoing()) {
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('distributeInvoiceFailed', {
            detail: {
              documentId: backendKey,
              message: 'Unlock your Fabric identity — CreateDistributeInvoice must be Schnorr-signed on the wire.'
            }
          }));
        }
      } catch (_) {}
      return;
    }
    if (this._pendingCreateDistributeInvoiceBackendIds) {
      this._pendingCreateDistributeInvoiceBackendIds.add(backendKey);
    }
    try {
      const payload = { method: 'CreateDistributeInvoice', params: [{ documentId: backendId, ...config }] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      if (this._pendingCreateDistributeInvoiceBackendIds) {
        this._pendingCreateDistributeInvoiceBackendIds.delete(backendKey);
      }
      console.error('[BRIDGE]', 'Error sending CreateDistributeInvoice request:', safeIdentityErr(error));
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('distributeInvoiceFailed', {
            detail: { documentId: backendKey, message: error && error.message ? error.message : String(error) }
          }));
        }
      } catch (_) {}
    }
  }

  /**
   * Send a distribute proposal to a peer (offer to pay them to host a file).
   * @param {string} peerAddress - Peer id or address
   * @param {Object} proposal - { documentId, amountSats, config?, document?, documentName? }
   */
  sendSendDistributeProposalRequest (peerAddress, proposal) {
    if (!peerAddress || !proposal || typeof proposal !== 'object') return;
    const documentId = proposal.documentId;
    const amountSats = Number(proposal.amountSats);
    if (!documentId || !Number.isFinite(amountSats) || amountSats <= 0) return;
    if (!this._canSignOutgoing()) {
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('distributeProposalFailed', {
            detail: {
              documentId: String(documentId),
              message: 'Unlock your Fabric identity — hosting offers must be Schnorr-signed on the wire.'
            }
          }));
        }
      } catch (_) {}
      return;
    }
    const peerKey = typeof peerAddress === 'object' && peerAddress
      ? String(peerAddress.id || peerAddress.address || peerAddress)
      : String(peerAddress);
    if (!peerKey) return;
    this._pendingSendDistributeProposalContext = {
      backendId: String(documentId),
      peerKey,
      sentAt: Date.now()
    };
    try {
      const payload = { method: 'SendDistributeProposal', params: [peerKey, proposal] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      this._pendingSendDistributeProposalContext = null;
      console.error('[BRIDGE]', 'Error sending SendDistributeProposal request:', safeIdentityErr(error));
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('distributeProposalFailed', {
            detail: {
              documentId: String(documentId),
              message: error && error.message ? error.message : String(error)
            }
          }));
        }
      } catch (_) {}
      try {
        pushUiNotification({
          id: `distribute-proposal-${Date.now()}`,
          kind: 'error',
          title: 'Hosting offer not sent',
          subtitle: error && error.message ? error.message : String(error),
          href: '/documents'
        });
      } catch (_) {}
    }
  }

  /**
   * Accept a distribute proposal (host flow): create invoice and send to proposer.
   * @param {Object} proposal - { id, documentId, amountSats, config, senderAddress }
   */
  sendAcceptDistributeProposalRequest (proposal) {
    if (!proposal || !proposal.documentId || !proposal.senderAddress) return;
    const doc = this.globalState && this.globalState.documents && this.globalState.documents[proposal.documentId];
    let backendId = proposal.documentId;
    if (doc && doc.sha256) backendId = doc.sha256;
    const backendKey = String(backendId);
    const proposalId = proposal.id != null ? String(proposal.id) : '';
    this._pendingAcceptDistributeContext = {
      backendId: backendKey,
      proposalId,
      sentAt: Date.now()
    };
    try {
      const payload = {
        method: 'AcceptDistributeProposal',
        params: [{
          proposalId: proposal.id,
          documentId: backendId,
          amountSats: proposal.amountSats,
          config: proposal.config,
          senderAddress: proposal.senderAddress
        }]
      };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      this._pendingAcceptDistributeContext = null;
      console.error('[BRIDGE]', 'Error sending AcceptDistributeProposal request:', safeIdentityErr(error));
      try {
        if (typeof window !== 'undefined' && proposalId) {
          window.dispatchEvent(new CustomEvent('acceptDistributeProposalFailed', {
            detail: {
              documentId: backendKey,
              proposalId,
              message: error && error.message ? error.message : String(error)
            }
          }));
        }
      } catch (_) {}
    }
  }

  /**
   * Create an Execution contract (sandboxed opcode program stored on the hub).
   * Uses the same signing rules as other JSONCalls: unsigned when identity is public-key only
   * (e.g. desktop delegation); Hub policy applies.
   * @param {Object} config - `{ name?: string, program: { steps: [...] } }`
   */
  sendCreateExecutionContractRequest (config = {}) {
    if (!config.program || typeof config.program !== 'object') return;
    try {
      const actorId = this._getIdentityId();
      const payloadConfig = {
        name: config.name,
        program: config.program,
        actorId
      };
      const payload = { method: 'CreateExecutionContract', params: [payloadConfig] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending CreateExecutionContract:', safeIdentityErr(error));
    }
  }

  /**
   * Run a persisted Execution contract on the hub (returns trace/stack in JSONCallResult).
   * Read-heavy path: safe to send unsigned for watch-only clients if the Hub allows it.
   * @param {string} contractId
   */
  sendRunExecutionContractRequest (contractId) {
    const id = String(contractId || '').trim();
    if (!id) return;
    try {
      const payload = { method: 'RunExecutionContract', params: [{ contractId: id }] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending RunExecutionContract:', safeIdentityErr(error));
    }
  }

  /**
   * Request a long-term storage contract for a document, paid in Bitcoin (L1).
   * When txid is provided, completes the pay-to-distribute flow (step 2).
   *
   * @param {string} id - Document id (Actor ID).
   * @param {Object} config - Distribution configuration (amount, duration, cadence, deadline, txid?).
   */
  sendDistributeDocumentRequest (id, config = {}) {
    const logical = typeof id === 'object' && id && id.id ? id.id : id;
    if (!logical) return;

    if (!this._canSignOutgoing()) {
      const docEarly = this.globalState && this.globalState.documents && this.globalState.documents[logical];
      const bid = (docEarly && docEarly.sha256) ? String(docEarly.sha256) : String(logical);
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('storageContractBondFailed', {
            detail: {
              documentId: bid,
              message: 'Unlock your Fabric identity — CreateStorageContract must be Schnorr-signed on the wire.'
            }
          }));
        }
      } catch (_) {}
      return;
    }

    let backendId = logical;
    const doc = this.globalState && this.globalState.documents && this.globalState.documents[logical];
    if (doc && doc.sha256) {
      backendId = doc.sha256;
    }

    try {
      const actorId = this._getIdentityId();
      const payloadConfig = {
        documentId: backendId,
        amountSats: config.amountSats,
        durationYears: config.durationYears,
        challengeCadence: config.challengeCadence,
        responseDeadline: config.responseDeadline,
        actorId
      };
      if (config.desiredCopies != null) {
        const dc = Math.max(1, Math.round(Number(config.desiredCopies)));
        if (Number.isFinite(dc)) payloadConfig.desiredCopies = dc;
      }
      if (config.txid) payloadConfig.txid = String(config.txid).trim();
      const payload = { method: 'CreateStorageContract', params: [payloadConfig] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending DistributeDocument request:', safeIdentityErr(error));
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('storageContractBondFailed', {
            detail: {
              documentId: String(backendId),
              message: error && error.message ? error.message : String(error)
            }
          }));
        }
      } catch (_) {}
    }
  }

  /**
   * Request a peer's inventory (e.g., list of documents) via the hub JSON-RPC.
   * @param {string|{id,address}} idOrAddress - Direct Fabric connection (next hop); use with `options.inventoryTarget` when that hop is a relay.
   * @param {string} kind - Inventory kind, defaults to 'documents'.
   * @param {Object} [options] - Optional `{ buyerRefundPublicKey, htlcLocktimeBlocks?, htlcAmountSats?, inventoryTarget?, inventoryRelayTtl? }`.
   *   `inventoryTarget` = seller’s Fabric id when `idOrAddress` is only the relay. `inventoryRelayTtl` caps relay hops (default 6, max 16).
   */
  sendPeerInventoryRequest (idOrAddress, kind = 'documents', options = {}) {
    try {
      const params = (options && typeof options === 'object' && Object.keys(options).length > 0)
        ? [idOrAddress, kind, options]
        : [idOrAddress, kind];
      const payload = { method: 'RequestPeerInventory', params };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending RequestPeerInventory:', safeIdentityErr(error));
    }
  }

  /**
   * After funding an inventory HTLC P2TR output, confirm with the seller hub to start phase 2 (document transfer).
   * @param {string} settlementId
   * @param {string} txid
   */
  sendConfirmInventoryHtlcPayment (settlementId, txid) {
    const sid = String(settlementId || '').trim();
    const tx = String(txid || '').trim();
    if (!sid || !tx) return;
    try {
      const payload = { method: 'ConfirmInventoryHtlcPayment', params: [{ settlementId: sid, txid: tx }] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending ConfirmInventoryHtlcPayment:', safeIdentityErr(error));
    }
  }

  /**
   * Send a file to a peer. Document must have contentBase64 (from local or fetched).
   * @param {string|{id,address}} idOrAddress - Peer id or address
   * @param {Object} doc - { id, name, mime, size, sha256?, contentBase64 }
   */
  sendSendPeerFileRequest (idOrAddress, doc) {
    const resolved = typeof idOrAddress === 'object' && idOrAddress ? (idOrAddress.id || idOrAddress.address) : idOrAddress;
    if (!resolved || !doc || typeof doc !== 'object') return;
    const contentBase64 = doc.contentBase64 || (doc.id ? this.getDecryptedDocumentContent(doc.id) : null);
    if (!contentBase64) return;
    try {
      const payloadDoc = { ...doc, contentBase64 };
      const payload = { method: 'SendPeerFile', params: [resolved, payloadDoc] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending SendPeerFile request:', safeIdentityErr(error));
    }
  }
}

module.exports = Bridge;
