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
      subscriptions: new Set(),
      isConnected: false,
      webrtcConnected: false,
      currentPath: window.location.pathname
    };

    // Global state for JSON-PATCH updates
    this.globalState = {
      conversations: {},
      messages: {},
      documents: {}
    };

    this.attempts = 1;
    this.messageQueue = [];
    this.webrtcMessageQueue = [];
    this.peerMessageQueue = [];
    this.chatSubmissionQueue = [];
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
    this._jsonRpcQueue = []; // JSON-RPC payloads to send once WebSocket is open
    this._rtcPeers = new Map(); // peerId -> { pc, dc, status, initiator, metadata }
    this._rtcPendingIce = new Map(); // peerId -> [RTCIceCandidateInit]
    this._webrtcConnectTimers = new Map(); // peerId -> timeout handle
    this._rtcSessionCounter = 0;
    this._lastWebRTCChatDeliveryCount = null;
    this._lastWebRTCChatSentAt = 0;
    this._lastWebRTCRecipientPeerIds = [];

    // Track backing SHA ids that should be published once CreateDocument succeeds.
    this._pendingPublishBySha = new Set();

    // Initialize key if provided
    if (props.key) {
      this.key = new Key(props.key);
    }

    // Restore local browser-backed state.
    const restoredPeerQueue = this._readJSONFromStorage('fabric:peerMessageQueue', []);
    if (Array.isArray(restoredPeerQueue)) this.peerMessageQueue = restoredPeerQueue;

    const restoredMessages = this._readJSONFromStorage('fabric:messages', null);
    if (restoredMessages && typeof restoredMessages === 'object') {
      this.globalState.messages = restoredMessages;
    }

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

    return this;
  }

  get authority () {
    if (this.settings && this.settings.authority) return this.settings.authority;
    return ((this.settings.secure) ? `wss` : `ws`) + `://${this.settings.host}:${this.settings.port}`;
  }

  get networkStatus () {
    return this.state.networkStatus || null;
  }

  /**
   * Get a list of WebRTC peers connected to this browser client.
   * @returns {Array} Array of WebRTC peer objects with id, status, direction, connectedAt
   */
  get localWebrtcPeers () {
    const peers = Array.from(this.webrtcPeers.values()).map(p => ({
      id: p.id,
      status: p.status,
      direction: p.direction,
      connectedAt: p.connectedAt,
      error: p.error,
      lastSeen: p.lastSeen
    }));

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
      console.debug('[BRIDGE]', 'RTCPeerConnection state for', peerId, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        this.disconnectWebRTCPeer(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.debug('[BRIDGE]', 'ICE state for', peerId, pc.iceConnectionState);
    };

    return pc;
  }

  _attachDataChannelHandlers (peerId, dc) {
    dc.onopen = () => {
      console.debug('[BRIDGE]', 'WebRTC data channel open to', peerId);
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
    };

    dc.onmessage = (ev) => {
      console.debug('[BRIDGE]', 'WebRTC data from', peerId, ev.data);
      this.handleWebRTCPeerMessage(peerId, ev.data);
    };

    dc.onclose = () => {
      console.debug('[BRIDGE]', 'WebRTC data channel closed for', peerId);
      this.disconnectWebRTCPeer(peerId);
    };

    dc.onerror = (err) => {
      console.error('[BRIDGE]', 'WebRTC data channel error for', peerId, err);
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
              console.error('[BRIDGE]', 'Error adding queued ICE candidate from', fromPeerId, err);
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
      const jsonPatch = [patchMessage];
      const result = applyPatch(this.globalState, jsonPatch, true, false);

      if (result.newDocument) {
        this.globalState = result.newDocument;

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
      } else {
        console.error('[BRIDGE]', 'Failed to apply JSON-Patch:', result);
      }

    } catch (error) {
      console.error('[BRIDGE]', 'Error updating global state:', error);
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
      console.warn('[BRIDGE]', `Could not read ${key} from storage:`, e);
      return fallback;
    }
  }

  _writeJSONToStorage (key, value) {
    if (!this._hasLocalStorage()) return false;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[BRIDGE]', `Could not persist ${key}:`, e);
      return false;
    }
  }

  _removeStorageKey (key) {
    if (!this._hasLocalStorage()) return false;
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.warn('[BRIDGE]', `Could not remove ${key} from storage:`, e);
      return false;
    }
  }

  _persistDocuments () {
    const docs = this.globalState.documents || {};
    this._writeJSONToStorage('fabric:documents', docs);
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
      console.warn('[BRIDGE]', 'Document encrypt failed:', e);
      return null;
    }
  }

  _decryptContent (contentEncrypted) {
    const key = this._getDocumentKey();
    if (!key || !contentEncrypted) return null;
    try {
      return key.decrypt(contentEncrypted);
    } catch (e) {
      console.warn('[BRIDGE]', 'Document decrypt failed:', e);
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

  _notifyIdentityUnlockRequired (message = 'Unlock identity to send chat messages.') {
    try {
      window.dispatchEvent(new CustomEvent('fabric:chatWarning', {
        detail: {
          reason: 'identity-locked',
          message
        }
      }));
    } catch (e) {}

    if (this.props && typeof this.props.onRequireUnlock === 'function') {
      try {
        this.props.onRequireUnlock();
      } catch (e) {}
    }
  }

  /**
   * Return document content (base64) for display or upload. Decrypts if stored encrypted.
   * @param {string} id - Document id
   * @returns {string|null} contentBase64 or null
   */
  getDecryptedDocumentContent (id) {
    if (!id || !this.globalState.documents) return null;
    const doc = this.globalState.documents[id];
    if (!doc) return null;
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

  _persistMessages () {
    const messages = this.globalState.messages || {};
    const keys = Object.keys(messages);
    // Cap at 500 messages to avoid localStorage bloat
    const toStore = keys.length > 500
      ? Object.fromEntries(keys.sort((a, b) => {
          const ta = (messages[a] && messages[a].object && messages[a].object.created) || 0;
          const tb = (messages[b] && messages[b].object && messages[b].object.created) || 0;
          return ta - tb;
        }).slice(-500).map((k) => [k, messages[k]]))
      : messages;
    this._writeJSONToStorage('fabric:messages', toStore);
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
      documents: {}
    };
  }

  componentDidMount () {
    this.start();

    // Subscribe to initial path
    this.subscribe(this.state.currentPath);

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
      console.warn('[BRIDGE]', 'Invalid hub address:', hubAddress);
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
        console.warn('[BRIDGE]', 'Error cleaning up previous WebSocket:', e);
      }
      this.ws = null;
    }

    console.debug('[BRIDGE]', 'Opening connection to:', `${this.authority}${path}`);
    this.ws = new WebSocket(`${this.authority}${path}`);
    this.ws.binaryType = 'arraybuffer';

    // Attach Event Handlers
    this.ws.onopen = () => {
      console.debug('[BRIDGE]', 'Connection established');
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
          console.error('[BRIDGE]', 'Error sending queued message:', error);
          // Re-queue the message if send fails
          this.messageQueue.unshift(message);
          break;
        }
      }

      // Flush any queued JSON-RPC payloads that were enqueued before the
      // WebSocket finished opening (for example, early WebRTC registration).
      if (Array.isArray(this._jsonRpcQueue) && this._jsonRpcQueue.length > 0) {
        console.debug('[BRIDGE]', 'Flushing queued JSON-RPC payloads:', this._jsonRpcQueue.length);
        const queue = this._jsonRpcQueue.slice();
        this._jsonRpcQueue = [];
        for (const payload of queue) {
          this._sendJSONRPCNow(payload);
        }
      }
    };

    this.ws.onmessage = this.onSocketMessage.bind(this);

    this.ws.onerror = (error) => {
      console.error('[BRIDGE]', 'WebSocket error:', error);
      this._isConnected = false;
      this.setState({ error, isConnected: false }, () => {
        // Call onStateUpdate prop if provided for backward compatibility
        if (this.props.onStateUpdate && typeof this.props.onStateUpdate === 'function') {
          this.props.onStateUpdate(this.state);
        }
      });
    };

    this.ws.onclose = (event) => {
      console.debug('[BRIDGE]', 'WebSocket closed:', event.code, event.reason);
      this._isConnected = false;
      this.setState({ isConnected: false }, () => {
        // Call onStateUpdate prop if provided for backward compatibility
        if (this.props.onStateUpdate && typeof this.props.onStateUpdate === 'function') {
          this.props.onStateUpdate(this.state);
        }
      });

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

    console.debug('[BRIDGE]', 'Initialized native WebRTC with peerId:', this.peerId);

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
  handleWebRTCMessage (data) {
    try {
      console.debug('[BRIDGE]', 'Processing WebRTC message:', data);

      // Handle our structured WebRTC messages
      if (data && typeof data === 'object' && data.type === 'fabric-message') {
        // Decode the base64 data back to Buffer
        const messageData = Buffer.from(data.data, 'base64');
        this.onSocketMessage({ data: messageData });
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
      this.onSocketMessage({ data: messageData });

    } catch (error) {
      console.error('[BRIDGE]', 'Error handling WebRTC message:', error);
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

    console.debug('[BRIDGE]', 'Publishing WebRTC offer with peer ID:', this.peerId);

    // Send our peer info to the server via WebSocket RPC
    const payload = {
      method: 'RegisterWebRTCPeer',
      params: [{
        peerId: this.peerId,
        timestamp: Date.now(),
        metadata: {
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
          capabilities: ['data-channel']
        }
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
      console.debug('[BRIDGE]', `Already at max WebRTC peers (${currentConnections}/${maxPeers})`);
      return;
    }

    console.debug('[BRIDGE]', 'Discovering WebRTC peer candidates...');

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
      console.debug('[BRIDGE]', 'Deferring WebRTC peer candidates until WebRTC is ready');
      if (!Array.isArray(this._pendingPeerCandidates)) this._pendingPeerCandidates = [];
      this._pendingPeerCandidates.push(...candidates);
      return;
    }

    if (!Array.isArray(candidates)) {
      console.warn('[BRIDGE]', 'Invalid peer candidates:', candidates);
      return;
    }

    const currentConnections = this.getWebRTCPeerCount() + this._connectingPeers.size;
    const maxPeers = this.settings.maxWebrtcPeers || 5;
    const slotsAvailable = Math.max(0, maxPeers - currentConnections);

    if (slotsAvailable === 0) {
      console.debug('[BRIDGE]', 'No slots available for new WebRTC peers');
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

    console.debug('[BRIDGE]', `Connecting to ${peersToConnect.length} WebRTC peers (${currentConnections}/${maxPeers} current)`);

    for (const candidate of peersToConnect) {
      const peerId = candidate.id || candidate.peerId;
      this.connectToWebRTCPeer(peerId, candidate);
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

    console.debug('[BRIDGE]', 'Initiating native WebRTC connection to peer:', peerId);

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
        console.error('[BRIDGE]', 'Error creating WebRTC offer to', peerId, err);
        this.disconnectWebRTCPeer(peerId);
      });

      const connectTimeoutMs = Number(this.settings.webrtcConnectTimeoutMs || 15000);
      const timer = setTimeout(() => {
        const info = this.webrtcPeers.get(peerId);
        if (info && info.status === 'connected') return;
        console.debug('[BRIDGE]', 'Timing out stale WebRTC connect attempt:', peerId);
        this.disconnectWebRTCPeer(peerId);
      }, connectTimeoutMs);
      this._webrtcConnectTimers.set(peerId, timer);
    } catch (error) {
      console.error('[BRIDGE]', 'Failed to initiate native WebRTC connection to peer:', peerId, error);
      this.disconnectWebRTCPeer(peerId);
    }
  }

  /**
   * Handle messages received from a WebRTC peer (not the server).
   * @param {string} peerId - The peer ID that sent the message
   * @param {*} data - The message data
   */
  handleWebRTCPeerMessage (peerId, data) {
    try {
      console.debug('[BRIDGE]', 'Processing message from WebRTC peer:', peerId);

      let payload = data;
      // RTCDataChannel text frames arrive as strings; normalize to object when possible.
      if (typeof payload === 'string') {
        const trimmed = payload.trim();
        if (trimmed) {
          try {
            payload = JSON.parse(trimmed);
          } catch (parseError) {
            // Keep raw payload for app-level listeners; typed handlers require objects.
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
            break;
          case 'pong': {
            // Update last seen for the peer
            const peerInfo = this.webrtcPeers.get(peerId);
            if (peerInfo) {
              peerInfo.lastSeen = Date.now();
              this.webrtcPeers.set(peerId, peerInfo);
            }
            break;
          }
          case 'webrtc-chat': {
            const text = (payload.text || payload.content || '').trim();
            if (!text) break;
            const created = payload.created || Date.now();
            const actorId = payload.actorId || peerId;
            const incomingClientId = payload.clientId || null;

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
                  content: text,
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
            } catch (e) {
              console.warn('[BRIDGE]', 'Could not create local WebRTC chat message:', e);
            }
            break;
          }
          default:
            // Pass through to the general WebRTC message handler
            this.handleWebRTCMessage(payload);
        }
      }
    } catch (error) {
      console.error('[BRIDGE]', 'Error handling WebRTC peer message:', error);
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
      const outbound = (data && typeof data === 'object')
        ? JSON.stringify(data)
        : data;
      peerInfo.connection.send(outbound);
      return true;
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending to WebRTC peer:', peerId, error);
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
   * Disconnect from a specific WebRTC peer by ID.
   * @param {string} peerId - The peer ID to disconnect
   */
  disconnectWebRTCPeer (peerId) {
    if (!peerId) return;

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
        console.warn('[BRIDGE]', 'Error closing WebRTC connection for peer:', peerId, error);
      }
    }

    if (rtcEntry && rtcEntry.dc && rtcEntry.dc !== (peerInfo && peerInfo.connection)) {
      try {
        rtcEntry.dc.close();
      } catch (error) {
        console.warn('[BRIDGE]', 'Error closing WebRTC data channel for peer:', peerId, error);
      }
    }

    if (rtcEntry && rtcEntry.pc) {
      try {
        rtcEntry.pc.close();
      } catch (error) {
        console.warn('[BRIDGE]', 'Error closing RTCPeerConnection for peer:', peerId, error);
      }
    }

    this.webrtcPeers.delete(peerId);
    this._rtcPeers.delete(peerId);
    this._rtcPendingIce.delete(peerId);
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
        if (peerInfo && peerInfo.connection) {
          try {
            peerInfo.connection.close();
          } catch (error) {
            console.warn('[BRIDGE]', 'Error closing WebRTC connection for peer:', peerId, error);
          }
        }
      }
    } catch (e) {}

    this.webrtcPeers.clear();
    this._rtcPeers.clear();
    this._rtcPendingIce.clear();
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
      console.error('[BRIDGE]', 'Error sending JSON-RPC:', error);
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
      return <div>Error: {error.message}</div>;
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
            <pre>{JSON.stringify(data, null, 2)}</pre>
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
        console.warn('[BRIDGE]', 'Error cleaning up WebSocket on stop:', e);
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
        console.warn('[BRIDGE]', 'Error closing WebRTC peer connection:', peerId, e);
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
        console.warn('[BRIDGE]', 'Error closing RTCPeerConnection:', peerId, e);
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

    this.takeJob();
  }

  /**
   * Signs a message with the component's signing key
   * @param {Buffer} message - The message to sign
   * @returns {Object} - The signed message object
   */
  signMessage (message) {
    if (!this.settings.signingKey) {
      console.warn('[BRIDGE]', 'No signing key configured, skipping signing');
      return message;
    }

    // Create a Fabric Message from the buffer
    const fabricMessage = Message.fromBuffer(message);
    if (!fabricMessage) {
      console.warn('[BRIDGE]', 'Could not create Fabric Message from buffer');
      return message;
    }

    // Sign the message with the key
    try {
      return fabricMessage.signWithKey(this.settings.signingKey);
    } catch (error) {
      console.error('[BRIDGE]', 'Error signing message:', error);
      return message;
    }
  }

  /**
   * Sends a signed message over WebSocket or WebRTC connection
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
        console.warn('[BRIDGE]', 'WebRTC send failed, falling back to WebSocket:', error);
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
      console.error('[BRIDGE]', 'Error sending message via WebSocket:', error);
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

      // Create Fabric Message from buffer
      const message = Message.fromBuffer(buffer);
      if (!message) {
        console.debug('[BRIDGE]', 'Failed to create message from buffer');
        return;
      }

      // Handle message based on type
      switch (message.type) {
        default:
          console.debug('[BRIDGE]', 'Unhandled message type:', message.type);
          break;
        case 'Pong':
          // Keepalive response from hub; no action needed beyond acknowledging receipt.
          break;
        case 'JSONCall':
          console.debug('[BRIDGE]', 'Received JSONCall:', message.body);

          // Parse JSONCall and handle JSONCallResult responses
          try {
            const jsonCall = JSON.parse(message.body);
            if (jsonCall.method === 'JSONCallResult') {
              const result = Array.isArray(jsonCall.params) && jsonCall.params.length > 0
                ? jsonCall.params[jsonCall.params.length - 1]
                : (jsonCall.result || null);

              // Treat only full network status results as networkStatus.
              if (result && typeof result === 'object' && result.network && !result.type) {
                this.setState({ networkStatus: result }, () => {
                  // When network status changes (especially peer connectivity),
                  // try to flush any queued peer messages.
                  this._flushPeerMessageQueue();
                });
              }

              // WebRTC peer discovery response (does not touch networkStatus)
              if (result && typeof result === 'object' && result.type === 'ListWebRTCPeersResult' && Array.isArray(result.peers)) {
                console.debug('[BRIDGE]', 'Received WebRTC peer candidates:', result.peers.length);
                this.handlePeerCandidates(result.peers);
              }
              // Native WebRTC signaling messages
              this._handleWebRTCSignalResult(result);
              // Handle non-network results used by routed pages / detail views
              if (result && typeof result === 'object' && result.type === 'GetPeerResult' && result.peer && result.peer.address) {
                const addr = result.peer.address;
                this.globalState.peers = this.globalState.peers || {};
                this.globalState.peers[addr] = result.peer;
                window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                  detail: {
                    operation: { op: 'add', path: `/peers/${addr}`, value: result.peer },
                    globalState: this.globalState
                  }
                }));
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
              if (result && typeof result === 'object' && result.type === 'GetDocumentResult' && result.document && result.document.id) {
                const id = result.document.id;
                this._storeDocument(id, result.document);
                window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                  detail: {
                    operation: { op: 'add', path: `/documents/${id}`, value: result.document },
                    globalState: this.globalState
                  }
                }));
              }
              if (result && typeof result === 'object' && result.type === 'CreateDocumentResult' && result.document && result.document.id) {
                const backendId = result.document.id; // sha-based id from hub
                const sha = result.document.sha256 || backendId;

                this._storeDocument(backendId, { ...(this.globalState.documents[backendId] || {}), ...result.document });

                // If user clicked Publish on this sha before create completed, now is the time to publish.
                if (sha && this._pendingPublishBySha && this._pendingPublishBySha.has(sha)) {
                  try {
                    this.sendPublishDocumentRequest(sha);
                  } finally {
                    this._pendingPublishBySha.delete(sha);
                  }
                }

                window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                  detail: {
                    operation: { op: 'add', path: `/documents/${backendId}`, value: this.globalState.documents[backendId] },
                    globalState: this.globalState
                  }
                }));
              }
              if (result && typeof result === 'object' && result.type === 'PublishDocumentResult' && result.document && result.document.id) {
                const backendId = result.document.id; // sha-based id from hub
                const sha = result.document.sha256 || backendId;

                this.globalState.documents = this.globalState.documents || {};

                // Prefer an existing local document whose sha256 matches, so we keep opaque Actor IDs stable.
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

                // Optionally clean up raw backend-only entry if different.
                if (targetId !== backendId && this.globalState.documents[backendId]) {
                  delete this.globalState.documents[backendId];
                }

                window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                  detail: {
                    operation: { op: 'add', path: `/documents/${targetId}`, value: this.globalState.documents[targetId] },
                    globalState: this.globalState
                  }
                }));
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
        case 'GenericMessage':
          // Check for FileMessage and Inventory responses (broadcast as GenericMessage when type unknown)
          try {
            const parsed = JSON.parse(message.body);
            if (parsed && parsed.type === 'P2P_FILE_SEND' && parsed.object) {
              const doc = parsed.object;
              if (doc.id && doc.contentBase64) {
                this._storeDocument(doc.id, { ...doc, receivedFromPeer: true });
                this._persistDocuments();
                window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                  detail: {
                    operation: { op: 'add', path: `/documents/${doc.id}`, value: this.globalState.documents[doc.id] },
                    globalState: this.globalState
                  }
                }));
              }
              break;
            }

            // Inventory responses from peers for documents, stored under globalState.peers[peerId].inventory.documents.
            if (parsed && parsed.type === 'INVENTORY_RESPONSE' && parsed.object && parsed.object.kind === 'documents') {
              const peerId = parsed.actor && parsed.actor.id;
              const items = Array.isArray(parsed.object.items) ? parsed.object.items : [];
              if (peerId) {
                this.globalState.peers = this.globalState.peers || {};
                const existing = this.globalState.peers[peerId] || {};
                const inventory = existing.inventory || {};
                const next = {
                  ...existing,
                  inventory: {
                    ...inventory,
                    documents: items
                  }
                };
                this.globalState.peers[peerId] = next;
                window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                  detail: {
                    operation: { op: 'add', path: `/peers/${peerId}`, value: next },
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
        case 'ChatMessage':
          try {
            const chat = JSON.parse(message.body);
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
                console.log('[BRIDGE:CHAT]', chat);
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
            console.error('[BRIDGE]', 'Could not parse ChatMessage body:', e);
          }
          break;
        case 'JSONPatch':
          // Handle JSONPatch messages (canonical path)
          try {
            const patchData = JSON.parse(message.body);

            // Update global state
            this.updateGlobalState(patchData);

            // Emit as PATCH format for components
            this.props.responseCapture({
              type: 'PATCH',
              path: patchData.path,
              value: patchData.value
            });
          } catch (parseError) {
            console.error('[BRIDGE]', 'Could not parse JSONPatch message body:', parseError);
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
      console.error('[BRIDGE]', 'Error processing message:', error);
      this.setState({ error }, () => {
        // Call onStateUpdate prop if provided for backward compatibility
        if (this.props.onStateUpdate && typeof this.props.onStateUpdate === 'function') {
          this.props.onStateUpdate(this.state);
        }
      });
    }
  }

  async onSocketOpen () {
    this.attempts = 1;
    const now = Date.now();

    this.sendNetworkStatusRequest();
    this._resubscribeAll();
    this._flushChatSubmissionQueue();
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
    console.debug('[BRIDGE]', 'JSONCall:', message);
    console.debug('[BRIDGE]', 'Sending network status request:', buffer);
    this.sendSignedMessage(buffer);
  }

  /**
   * Request an updated peer list from the hub.
   * This uses the ListPeers JSONCall method, which returns
   * the same status shape as GetNetworkStatus (including peers).
   */
  sendListPeersRequest () {
    const message = Message.fromVector(['JSONCall', JSON.stringify({ method: 'ListPeers', params: [] })]);
    const buffer = message.toBuffer();
    console.debug('[BRIDGE]', 'JSONCall:', message);
    console.debug('[BRIDGE]', 'Sending ListPeers request:', buffer);
    this.sendSignedMessage(buffer);
  }

  /**
   * Send a request to add a peer.
   * @param {Object} peer - Peer descriptor (e.g. { address }).
   */
  sendAddPeerRequest (peer = {}) {
    const resolved = typeof peer === 'string' ? peer : (peer && peer.address) || '';
    if (!resolved) {
      console.warn('[BRIDGE] sendAddPeerRequest: no address provided');
      return;
    }

    try {
      const payload = {
        method: 'AddPeer',
        params: [peer]
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
          console.error('[BRIDGE]', 'Error refreshing peer list after AddPeer:', refreshError);
        }
      }, 1000);
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending AddPeer request:', error);
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
          console.error('[BRIDGE]', 'Error refreshing peer list after RemovePeer:', e);
        }
      }, 500);
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending RemovePeer request:', error);
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
      this._notifyIdentityUnlockRequired('Unlock identity to send chat messages.');
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

    this.chatSubmissionQueue.push({ text: trimmed, clientId, actorId, created });
    this._flushChatSubmissionQueue();
    return true;
  }

  _flushChatSubmissionQueue () {
    if (!this._isConnected || !this.ws || this.ws.readyState !== 1) return;
    while (this.chatSubmissionQueue.length > 0) {
      const item = this.chatSubmissionQueue.shift();
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
   * Send SubmitChatMessage JSONCall to hub (broadcast to all clients + Fabric nodes).
   * @param {Object} body - { text, clientId?, actor? }
   */
  sendSubmitChatMessageRequest (body) {
    const text = typeof body === 'string' ? body : (body && body.text) || '';
    if (!text) return;
    if (!this._hasUnlockedIdentity()) {
      console.warn('[BRIDGE]', 'sendSubmitChatMessageRequest called without an unlocked identity; message will not be sent.');
      this._notifyIdentityUnlockRequired('Unlock identity to send chat messages.');
      return;
    }
    const created = body && body.created ? body.created : Date.now();
    const clientId = body && body.clientId;
    const actorId = this._getIdentityId() || null;

    // In WebRTC mode, also fan out over the mesh, but keep the hub RPC as
    // the canonical network propagation path.
    if (this.preferWebRTCChat) {
      const payload = {
        type: 'webrtc-chat',
        text,
        created,
        actorId,
        clientId
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
      console.error('[BRIDGE]', 'Error sending SubmitChatMessage:', error);
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
      console.warn('[BRIDGE]', 'Could not create local queued peer chat message:', e);
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
        console.error('[BRIDGE]', 'Error sending queued peer message:', error);
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
      this._notifyIdentityUnlockRequired('Unlock identity to send peer messages.');
      return;
    }
    const created = Date.now();
    // When WebRTC-only chat is enabled, send peer messages over the mesh
    // instead of via the Fabric P2P SendPeerMessage RPC.
    if (this.preferWebRTCChat) {
      const actorId = this._getIdentityId() || null;
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
        const clientId = clientActor.id;
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
        type: 'webrtc-chat',
        text: resolvedText,
        created,
        actorId,
        target: resolved
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
      console.error('[BRIDGE]', 'Error sending SetPeerNickname request:', error);
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
      console.error('[BRIDGE]', 'Error sending GetPeer request:', error);
    }
  }

  sendListDocumentsRequest () {
    try {
      const payload = { method: 'ListDocuments', params: [] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending ListDocuments request:', error);
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
      console.error('[BRIDGE]', 'Error sending GetDocument request:', error);
    }
  }

  sendCreateDocumentRequest (doc) {
    if (!doc || typeof doc !== 'object') return;
    try {
      const contentBase64 = doc.contentBase64 || (doc.id ? this.getDecryptedDocumentContent(doc.id) : null);
      const payloadDoc = contentBase64 ? { ...doc, contentBase64 } : doc;
      const payload = { method: 'CreateDocument', params: [payloadDoc] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending CreateDocument request:', error);
    }
  }

  sendPublishDocumentRequest (id) {
    const logical = typeof id === 'object' && id && id.id ? id.id : id;
    if (!logical) return;

    const doc = this.globalState && this.globalState.documents && this.globalState.documents[logical];

    // If this is a local-only document with a backing sha256 and not yet published,
    // first ensure the hub has the full content via CreateDocument, then publish.
    if (doc && doc.sha256 && !doc.published) {
      const sha = doc.sha256;
      const contentBase64 = this.getDecryptedDocumentContent(logical);
      if (!contentBase64) {
        console.warn('[BRIDGE]', 'Cannot publish document without decrypted content:', logical);
        return;
      }

      const createDoc = {
        id: sha,
        sha256: sha,
        name: doc.name,
        mime: doc.mime,
        size: doc.size,
        contentBase64
      };
      this.sendCreateDocumentRequest(createDoc);
      if (this._pendingPublishBySha) {
        this._pendingPublishBySha.add(sha);
      }
      return;
    }

    // Fallback: publish by whatever id we have (Actor id or sha).
    let resolved = logical;
    if (doc && doc.sha256) {
      resolved = doc.sha256;
    }

    try {
      const payload = { method: 'PublishDocument', params: [resolved] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending PublishDocument request:', error);
    }
  }

  /**
   * Request a long-term storage contract for a document, paid in Bitcoin.
   * This is a thin JSON-RPC wrapper; contract negotiation and settlement
   * are handled by the hub/Bitcoin services.
   *
   * @param {string} id - Document id (Actor ID).
   * @param {Object} config - Distribution configuration (amount, duration, cadence, deadline).
   */
  sendDistributeDocumentRequest (id, config = {}) {
    const logical = typeof id === 'object' && id && id.id ? id.id : id;
    if (!logical) return;

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
      const payload = { method: 'CreateStorageContract', params: [payloadConfig] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending DistributeDocument request:', error);
    }
  }

  /**
   * Request a peer's inventory (e.g., list of documents) via the hub JSON-RPC.
   * @param {string|{id,address}} idOrAddress - Peer id or address.
   * @param {string} kind - Inventory kind, defaults to 'documents'.
   */
  sendPeerInventoryRequest (idOrAddress, kind = 'documents') {
    try {
      const payload = { method: 'RequestPeerInventory', params: [idOrAddress, kind] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending RequestPeerInventory:', error);
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
      console.error('[BRIDGE]', 'Error sending SendPeerFile request:', error);
    }
  }
}

module.exports = Bridge;
