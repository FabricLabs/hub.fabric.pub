'use strict';

// Dependencies
const React = require('react');
const WebSocket = require('isomorphic-ws');
const { applyPatch } = require('fast-json-patch');

// WebRTC via PeerJS
let Peer = null;
if (typeof window !== 'undefined') {
  // Only import PeerJS on the client side
  try {
    Peer = require('peerjs').Peer;
  } catch (e) {
    console.warn('[BRIDGE]', 'PeerJS not available:', e.message);
  }
}

// Semantic
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
      signingKey: props.auth ? new Key(props.auth) : null
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
    this.queue = [];
    this.ws = null;
    this._heartbeat = null;
    this._isConnected = false;  // Internal connection state

    // WebRTC/PeerJS properties
    this.peer = null;
    this.webrtcConnection = null;
    this._webrtcConnected = false;
    this.peerId = null;

    // Initialize key if provided
    if (props.key) {
      this.key = new Key(props.key);
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

  resetGlobalState () {
    this.globalState = {
      conversations: {},
      messages: {},
      users: {},
      documents: {},
      tasks: {}
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

    // Fully restart to ensure WebRTC (PeerJS) uses the new host/port.
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
   * Initialize WebRTC connection using PeerJS
   */
  initializeWebRTC () {
    if (!Peer) {
      console.warn('[BRIDGE]', 'PeerJS not available, skipping WebRTC initialization');
      return;
    }

    try {
      // Generate a unique peer ID based on the current session
      const sessionId = this.key ? this.key.id.slice(-8) : Math.random().toString(36).substr(2, 8);
      this.peerId = `fabric-bridge-${sessionId}`;

      console.debug('[BRIDGE]', 'Initializing WebRTC peer with ID:', this.peerId);

      // Create PeerJS instance
      this.peer = new Peer(this.peerId, {
        host: this.settings.host,
        port: this.settings.port,
        path: '/services/peering',
        secure: this.settings.secure,
        debug: this.settings.debug ? 2 : 0
      });

      // Set up peer event handlers
      this.peer.on('open', (id) => {
        console.debug('[BRIDGE]', 'WebRTC peer opened with ID:', id);
        this.peerId = id;
        this.connectToServerWebRTC();
      });

      this.peer.on('connection', (conn) => {
        console.debug('[BRIDGE]', 'Incoming WebRTC connection:', conn.peer);
        this.handleIncomingWebRTCConnection(conn);
      });

      this.peer.on('error', (error) => {
        console.error('[BRIDGE]', 'WebRTC peer error:', error);
        this.setState(prevState => ({
          error: prevState.error || error,
          webrtcConnected: false
        }));
        this._webrtcConnected = false;
      });

      this.peer.on('close', () => {
        console.debug('[BRIDGE]', 'WebRTC peer closed');
        this.setState({ webrtcConnected: false });
        this._webrtcConnected = false;
      });

    } catch (error) {
      console.error('[BRIDGE]', 'Failed to initialize WebRTC:', error);
    }
  }

  /**
   * Connect to the server's WebRTC instance
   */
  connectToServerWebRTC () {
    if (!this.peer) {
      console.warn('[BRIDGE]', 'Cannot connect WebRTC: peer not initialized');
      return;
    }

    try {
      // Attempt to connect to the server's WebRTC instance
      // The server peer ID should follow a predictable pattern
      const serverPeerId = `fabric-server-${this.settings.host}`;

      console.debug('[BRIDGE]', 'Attempting WebRTC connection to server:', serverPeerId);

      this.webrtcConnection = this.peer.connect(serverPeerId, {
        label: this.peerId,
        reliable: true,
        metadata: {
          type: 'bridge-connection',
          timestamp: Date.now()
        }
      });

      this.setupWebRTCConnectionHandlers(this.webrtcConnection);

    } catch (error) {
      console.error('[BRIDGE]', 'Failed to connect WebRTC to server:', error);
    }
  }

  /**
   * Set up event handlers for a WebRTC connection
   */
  setupWebRTCConnectionHandlers (connection) {
    connection.on('open', () => {
      console.debug('[BRIDGE]', 'WebRTC connection opened to:', connection.peer);
      this._webrtcConnected = true;
      this.setState({ webrtcConnected: true }, () => {
        // Call onStateUpdate prop if provided for backward compatibility
        if (this.props.onStateUpdate && typeof this.props.onStateUpdate === 'function') {
          this.props.onStateUpdate(this.state);
        }
      });

      // Process any queued messages
      while (this.webrtcMessageQueue.length > 0) {
        const message = this.webrtcMessageQueue.shift();
        try {
          connection.send(message);
        } catch (error) {
          console.error('[BRIDGE]', 'Error sending queued WebRTC message:', error);
          this.webrtcMessageQueue.unshift(message);
          break;
        }
      }
    });

    connection.on('data', (data) => {
      console.debug('[BRIDGE]', 'WebRTC data received:', data);
      this.handleWebRTCMessage(data);
    });

    connection.on('error', (error) => {
      console.error('[BRIDGE]', 'WebRTC connection error:', error);
      this._webrtcConnected = false;
      this.setState({ webrtcConnected: false }, () => {
        // Call onStateUpdate prop if provided for backward compatibility
        if (this.props.onStateUpdate && typeof this.props.onStateUpdate === 'function') {
          this.props.onStateUpdate(this.state);
        }
      });
    });

    connection.on('close', () => {
      console.debug('[BRIDGE]', 'WebRTC connection closed');
      this._webrtcConnected = false;
      this.setState({ webrtcConnected: false }, () => {
        // Call onStateUpdate prop if provided for backward compatibility
        if (this.props.onStateUpdate && typeof this.props.onStateUpdate === 'function') {
          this.props.onStateUpdate(this.state);
        }
      });
    });
  }

  /**
   * Handle incoming WebRTC connections
   */
  handleIncomingWebRTCConnection (connection) {
    console.debug('[BRIDGE]', 'Setting up incoming WebRTC connection from:', connection.peer);
    this.setupWebRTCConnectionHandlers(connection);

    // Store the connection for potential use
    this.webrtcConnection = connection;
  }

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

    // Clean up WebRTC
    if (this.webrtcConnection) {
      try {
        this.webrtcConnection.close();
      } catch (e) {
        console.warn('[BRIDGE]', 'Error closing WebRTC connection:', e);
      }
      this.webrtcConnection = null;
    }

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {
        console.warn('[BRIDGE]', 'Error destroying WebRTC peer:', e);
      }
      this.peer = null;
    }

    this._webrtcConnected = false;
    this.setState({ webrtcConnected: false });
  }

  tick () {
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
    if (this.peer && !this._webrtcConnected) {
      console.debug('[BRIDGE]', 'Attempting to reconnect WebRTC...');
      this.connectToServerWebRTC();
    } else if (!this.peer) {
      console.debug('[BRIDGE]', 'Reinitializing WebRTC peer...');
      this.initializeWebRTC();
    }
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
        case 'JSONCall':
          console.debug('[BRIDGE]', 'Received JSONCall:', message.body);

          // Parse JSONCall and handle JSONCallResult responses
          try {
            const jsonCall = JSON.parse(message.body);
            if (jsonCall.method === 'JSONCallResult') {
              const result = Array.isArray(jsonCall.params) && jsonCall.params.length > 0
                ? jsonCall.params[jsonCall.params.length - 1]
                : (jsonCall.result || null);
              if (result && typeof result === 'object' && (result.peers || result.network)) {
                this.setState({ networkStatus: result });
              }
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
                  this.globalState.documents[doc.id] = { ...(this.globalState.documents[doc.id] || {}), ...doc };
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
                this.globalState.documents = this.globalState.documents || {};
                this.globalState.documents[id] = result.document;
                window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                  detail: {
                    operation: { op: 'add', path: `/documents/${id}`, value: result.document },
                    globalState: this.globalState
                  }
                }));
              }
              if (result && typeof result === 'object' && result.type === 'CreateDocumentResult' && result.document && result.document.id) {
                const id = result.document.id;
                this.globalState.documents = this.globalState.documents || {};
                this.globalState.documents[id] = { ...(this.globalState.documents[id] || {}), ...result.document };
                window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                  detail: {
                    operation: { op: 'add', path: `/documents/${id}`, value: this.globalState.documents[id] },
                    globalState: this.globalState
                  }
                }));
              }
              if (result && typeof result === 'object' && result.type === 'PublishDocumentResult' && result.document && result.document.id) {
                const id = result.document.id;
                this.globalState.documents = this.globalState.documents || {};
                this.globalState.documents[id] = { ...(this.globalState.documents[id] || {}), ...result.document, published: result.document.published || true };
                window.dispatchEvent(new CustomEvent('globalStateUpdate', {
                  detail: {
                    operation: { op: 'add', path: `/documents/${id}`, value: this.globalState.documents[id] },
                    globalState: this.globalState
                  }
                }));
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
          // Pass through GenericMessage as-is
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
            this.globalState.messages[id] = chat;

            // Notify UI of new chat message (re-use existing globalStateUpdate channel).
            window.dispatchEvent(new CustomEvent('globalStateUpdate', {
              detail: {
                operation: { op: 'add', path: `/messages/${id}`, value: chat },
                globalState: this.globalState
              }
            }));
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
  sendRemovePeerRequest (address) {
    const resolved = typeof address === 'object' && address && address.address ? address.address : address;
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
   * Send a chat message to a connected peer.
   * @param {string|{ address: string }} address - Peer address or object with address.
   * @param {string|{ text: string }} body - Message text or object with text.
   */
  sendPeerMessageRequest (address, body) {
    const resolvedAddress = typeof address === 'object' && address && address.address ? address.address : address;
    const resolvedText = typeof body === 'string' ? body : (body && body.text) || '';
    if (!resolvedAddress || !resolvedText) return;
    try {
      const payload = { method: 'SendPeerMessage', params: [resolvedAddress, { text: resolvedText }] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending SendPeerMessage request:', error);
    }
  }

  /**
   * Set a node-local nickname for a peer (stored server-side).
   * @param {string} address
   * @param {string} nickname
   */
  sendSetPeerNicknameRequest (address, nickname) {
    const resolvedAddress = typeof address === 'object' && address && address.address ? address.address : address;
    if (!resolvedAddress) return;
    const clean = nickname == null ? '' : String(nickname);
    try {
      const payload = { method: 'SetPeerNickname', params: [resolvedAddress, clean] };
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
   * Request rich peer details from the hub (used by `/peers/:address` page).
   * @param {string} address
   */
  sendGetPeerRequest (address) {
    const resolvedAddress = typeof address === 'object' && address && address.address ? address.address : address;
    if (!resolvedAddress) return;
    try {
      const payload = { method: 'GetPeer', params: [resolvedAddress] };
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
      const payload = { method: 'CreateDocument', params: [doc] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending CreateDocument request:', error);
    }
  }

  sendPublishDocumentRequest (id) {
    const resolved = typeof id === 'object' && id && id.id ? id.id : id;
    if (!resolved) return;
    try {
      const payload = { method: 'PublishDocument', params: [resolved] };
      const message = Message.fromVector(['JSONCall', JSON.stringify(payload)]);
      this.sendSignedMessage(message.toBuffer());
    } catch (error) {
      console.error('[BRIDGE]', 'Error sending PublishDocument request:', error);
    }
  }
}

module.exports = Bridge;
