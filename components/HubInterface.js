'use strict';

// Constants
const {
  BRAND_NAME,
  BROWSER_DATABASE_NAME,
  BROWSER_DATABASE_TOKEN_TABLE
} = require('../constants');

// Dependencies
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { renderToString } = require('react-dom/server');
const {
  BrowserRouter,
  Routes,
  Route
} = require('react-router-dom');

// Fabric Types
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');

// Components
const Bridge = require('./Bridge');
const BitcoinHome = require('./BitcoinHome');
const Onboarding = require('./Onboarding');
const BitcoinBlockView = require('./BitcoinBlockView');
const BitcoinPaymentsHome = require('./BitcoinPaymentsHome');
const BitcoinTransactionView = require('./BitcoinTransactionView');
const BottomPanel = require('./BottomPanel');
const ContractList = require('./ContractList');
const ContractView = require('./ContractView');
const DocumentList = require('./DocumentList');
const DocumentView = require('./DocumentView');
const Home = require('./Home');
const IdentityManager = require('./IdentityManager');
const PeerList = require('./PeerList');
const PeerView = require('./PeerView');
const TopPanel = require('./TopPanel');
const {
  getWalletContextFromIdentity,
  fetchWalletSummaryWithCache,
  loadUpstreamSettings
} = require('../functions/bitcoinClient');

// Semantic UI
const {
  Modal,
  Button,
  Form,
  Header,
  Icon,
  Input,
  Loader,
  Message,
  Segment
} = require('semantic-ui-react');

/**
 * Login wall: shown when user tries to access a gated route without a local identity.
 */
function LoginGate (props) {
  const onLogin = props && typeof props.onLogin === 'function' ? props.onLogin : null;
  return (
    <Segment placeholder style={{ marginTop: '2em', textAlign: 'center' }}>
      <Header icon>
        <Icon name="lock" />
        Log in required
      </Header>
      <p style={{ color: '#666', marginBottom: '1em' }}>
        Create or restore a local identity to access this feature.
      </p>
      <Button primary onClick={() => onLogin && onLogin()}>
        <Icon name="user circle" />
        Log in
      </Button>
    </Segment>
  );
}

/**
 * The Hub UI.
 */
class HubInterface extends React.Component {
  constructor (props) {
    super(props);

    let initialHubAddress = '';
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        initialHubAddress = window.localStorage.getItem('fabric.hub.address') || '';
      }
    } catch (e) {}
    if (!initialHubAddress) {
      try {
        if (typeof window !== 'undefined' && window.location) {
          const host = window.location.hostname;
          const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
          initialHubAddress = `${host}:${port}`;
        }
      } catch (e) {}
    }

    let initialAdminToken = null;
    let initialAdminTokenExpiresAt = null;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        initialAdminToken = window.localStorage.getItem('fabric.hub.adminToken') || null;
        const raw = window.localStorage.getItem('fabric.hub.adminTokenExpiresAt');
        if (raw) initialAdminTokenExpiresAt = Number(raw) || null;
      }
    } catch (e) {}

    let initialLocalIdentity = null;
    let initialHasLockedIdentity = false;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        let unlockedSession = null;
        try {
          if (window.sessionStorage) {
            const rawSession = window.sessionStorage.getItem('fabric.identity.unlocked');
            if (rawSession) {
              const parsedSession = JSON.parse(rawSession);
              if (parsedSession && parsedSession.xprv) {
                const sessionIdentity = new Identity({ xprv: parsedSession.xprv });
                unlockedSession = {
                  id: sessionIdentity.id,
                  xpub: sessionIdentity.key.xpub,
                  xprv: parsedSession.xprv,
                  passwordProtected: !!parsedSession.passwordProtected
                };
              }
            }
          }
        } catch (e) {}

        const raw = window.localStorage.getItem('fabric.identity.local');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.xprv && !parsed.passwordProtected) {
            try {
              const ident = new Identity({ xprv: parsed.xprv });
              initialLocalIdentity = {
                id: ident.id,
                xpub: ident.key.xpub,
                xprv: parsed.xprv
              };
            } catch (e) {}
          } else if (parsed && parsed.passwordProtected && parsed.id && parsed.xpub) {
            const sessionMatches = !!(
              unlockedSession &&
              unlockedSession.xprv &&
              (String(unlockedSession.id) === String(parsed.id) || String(unlockedSession.xpub) === String(parsed.xpub))
            );

            if (sessionMatches) {
              initialLocalIdentity = {
                id: unlockedSession.id,
                xpub: unlockedSession.xpub,
                xprv: unlockedSession.xprv,
                passwordProtected: true
              };
            } else {
              initialLocalIdentity = {
                id: parsed.id,
                xpub: parsed.xpub
              };
              initialHasLockedIdentity = true;
            }
          } else if (parsed && parsed.xpub) {
            try {
              const key = new Key({ xpub: parsed.xpub });
              const ident = new Identity(key);
              initialLocalIdentity = {
                id: ident.id,
                xpub: key.xpub
              };
            } catch (e) {}
          }
        }
      }
    } catch (e) {}

    this.state = {
      debug: false,
      isAuthenticated: false,
      isLoading: true,
      needsSetup: false,
      setupChecked: false,
      adminToken: initialAdminToken,
      adminTokenExpiresAt: initialAdminTokenExpiresAt,
      modalLogOut: false,
      loggedOut: false,
      uiSettingsOpen: false,
      uiHubAddress: initialHubAddress,
      uiHubAddressDraft: initialHubAddress,
      uiHubAddressError: null,
      uiIdentityOpen: false,
      uiSignMessageOpen: false,
      uiSignMessageText: '',
      uiSignMessageResult: null,
      uiVerifyMessageText: '',
      uiVerifySignature: '',
      uiVerifyPublicKey: '',
      uiVerifyResult: null,
      uiDestroyIdentityConfirmOpen: false,
      clientBalance: null,
      uiLocalIdentity: initialLocalIdentity,
      uiHasLockedIdentity: initialHasLockedIdentity,
      webrtcChatOnly: false
    };

    this.handleBridgeStateUpdate = this.handleBridgeStateUpdate.bind(this);
    this.responseCapture = this.responseCapture.bind(this);
    this.requestLogin = this.requestLogin.bind(this);
    this.openIdentityManager = this.openIdentityManager.bind(this);

    // Instantiate Bridge once here
    this.bridgeRef = React.createRef();

    this._state = {
      actors: {},
      content: this.state
    };

    return this;
  }

  async _checkSetupStatus () {
    try {
      const base = typeof window !== 'undefined' && window.location
        ? `${window.location.protocol}//${window.location.host}`
        : 'http://localhost:8080';
      const res = await fetch(`${base}/settings`, {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const text = await res.text();
        if (text.trim().startsWith('<')) {
          this.setState({ setupChecked: true });
          return;
        }
        const data = JSON.parse(text);
        this.setState({
          needsSetup: !!data.needsSetup,
          setupChecked: true
        });
      } else {
        this.setState({ setupChecked: true });
      }
    } catch (e) {
      this.setState({ setupChecked: true });
    }
  }

  async _refreshAdminTokenIfNeeded () {
    const token = this.state.adminToken || (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('fabric.hub.adminToken'));
    if (!token) return;
    const expiresAt = this.state.adminTokenExpiresAt || (typeof window !== 'undefined' && window.localStorage && (() => {
      const raw = window.localStorage.getItem('fabric.hub.adminTokenExpiresAt');
      return raw ? Number(raw) : null;
    })());
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    if (expiresAt && Date.now() < expiresAt - thirtyDaysMs) return; // No refresh needed
    try {
      const base = typeof window !== 'undefined' && window.location
        ? `${window.location.protocol}//${window.location.host}`
        : 'http://localhost:8080';
      const res = await fetch(`${base}/settings/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ token })
      });
      if (!res.ok) return;
      const text = await res.text();
      if (text.trim().startsWith('<')) return;
      const result = JSON.parse(text);
      if (result && result.token) {
        this.setState({ adminToken: result.token, adminTokenExpiresAt: result.expiresAt });
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            window.localStorage.setItem('fabric.hub.adminToken', result.token);
            if (result.expiresAt != null) {
              window.localStorage.setItem('fabric.hub.adminTokenExpiresAt', String(result.expiresAt));
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  requestLogin () {
    // Prefer host-provided handler (browser extension or outer app).
    if (typeof this.props.onLogin === 'function') {
      this.props.onLogin();
      return;
    }

    // Fallback: try a generic identity manager open handler if provided.
    if (typeof this.props.onOpenIdentityManager === 'function') {
      this.props.onOpenIdentityManager();
      return;
    }

    // Fallback: open built-in IdentityManager modal.
    this.setState({ uiIdentityOpen: true });
  }

  openIdentityManager () {
    if (typeof this.props.onOpenIdentityManager === 'function') {
      this.props.onOpenIdentityManager();
      return;
    }

    this.setState({ uiIdentityOpen: true });
  }

  componentDidMount () {
    console.debug('[HUB]', 'Component mounted!');
    this._checkSetupStatus();
    this._refreshAdminTokenIfNeeded();
    this._refreshClientBalance();
    this._onGlobalStateUpdate = (e) => {
      const d = e && e.detail;
      if (d && d.operation && d.operation.path === '/bitcoin' && this.state.uiLocalIdentity && this.state.uiLocalIdentity.xpub) {
        this._refreshClientBalance();
      }
    };
    this._onClientBalanceUpdate = () => {
      if (this.state.uiLocalIdentity && this.state.uiLocalIdentity.xpub) this._refreshClientBalance();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('globalStateUpdate', this._onGlobalStateUpdate);
      window.addEventListener('clientBalanceUpdate', this._onClientBalanceUpdate);
      this._adminTokenRefreshInterval = setInterval(() => this._refreshAdminTokenIfNeeded(), 24 * 60 * 60 * 1000);
    }
  }

  componentWillUnmount () {
    console.debug('[HUB]', 'Cleaning up...');
    if (typeof window !== 'undefined') {
      if (this._onGlobalStateUpdate) window.removeEventListener('globalStateUpdate', this._onGlobalStateUpdate);
      if (this._onClientBalanceUpdate) window.removeEventListener('clientBalanceUpdate', this._onClientBalanceUpdate);
      if (this._adminTokenRefreshInterval) clearInterval(this._adminTokenRefreshInterval);
    }
  }

  componentDidUpdate (prevProps, prevState) {
    const prevXpub = (prevState.uiLocalIdentity || prevProps.auth || {}).xpub;
    const nextXpub = (this.state.uiLocalIdentity || this.props.auth || {}).xpub;
    if (prevXpub !== nextXpub) this._refreshClientBalance();
  }

  async _refreshClientBalance (forceRefresh = false) {
    const identity = this.state.uiLocalIdentity || this.props.auth || null;
    const wallet = getWalletContextFromIdentity(identity || {});
    if (!wallet.walletId || !wallet.xpub) {
      this.setState({ clientBalance: null });
      return;
    }
    const bridgeInstance = this.bridgeRef && this.bridgeRef.current;
    const networkStatus = bridgeInstance && (bridgeInstance.networkStatus || bridgeInstance.lastNetworkStatus);
    const bitcoin = networkStatus && networkStatus.state && networkStatus.state.services && networkStatus.state.services.bitcoin;
    const network = (bitcoin && bitcoin.network) ? String(bitcoin.network).toLowerCase() : 'regtest';
    try {
      const upstream = loadUpstreamSettings();
      const summary = await fetchWalletSummaryWithCache(upstream, wallet, { bypassCache: forceRefresh, network });
      const balanceSats = Number(summary.balanceSats ?? summary.balance ?? 0);
      if (Number.isFinite(balanceSats)) {
        this.setState({
          clientBalance: {
            balanceSats,
            confirmedSats: Number(summary.confirmedSats ?? balanceSats),
            unconfirmedSats: Number(summary.unconfirmedSats ?? 0),
            fromCache: !!summary._fromCache
          }
        });
      } else {
        this.setState({ clientBalance: null });
      }
    } catch (e) {
      this.setState((prev) => ({ clientBalance: prev.clientBalance }));
    }
  }

  _handleLockIdentity () {
    const local = this.state.uiLocalIdentity;
    if (!local || !local.xprv) return;
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem('fabric.identity.unlocked');
      }
      if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearDecryptedDocuments === 'function') {
        try { this.bridgeRef.current.clearDecryptedDocuments(); } catch (e) {}
      }
      this.setState({
        uiLocalIdentity: {
          id: local.id,
          xpub: local.xpub,
          passwordProtected: !!local.passwordProtected
        },
        uiHasLockedIdentity: true
      });
    } catch (e) {
      console.error('[HUB]', 'Error locking identity:', e);
    }
  }

  handleBridgeStateUpdate (newState) {
    if (!newState || typeof newState !== 'object') return;
    // Only merge Bridge-owned state; never overwrite identity/auth state from Bridge.
    const bridgeKeys = ['data', 'error', 'networkStatus', 'subscriptions', 'isConnected', 'webrtcConnected', 'currentPath'];
    const patch = {};
    for (const k of bridgeKeys) {
      if (Object.prototype.hasOwnProperty.call(newState, k)) patch[k] = newState[k];
    }
    if (Object.keys(patch).length > 0) {
      this.setState(patch);
    }
  }

  responseCapture (action) {
    try {
      if (!action || !action.content) return;

      const payload = JSON.parse(action.content);

      if (payload && payload.method === 'JSONCallResult') {
        let status = null;

        if (Array.isArray(payload.params) && payload.params.length > 0) {
          const candidate = payload.params[payload.params.length - 1];
          if (candidate && typeof candidate === 'object') {
            status = candidate;
          }
        } else if (payload.result && typeof payload.result === 'object') {
          status = payload.result;
        }

        // Only treat JSONCallResult as a network status update when it has the right shape.
        // Prevents overwriting `networkStatus` with `{ status: "success" }` from AddPeer/RemovePeer.
        const isNetworkStatus = status && typeof status === 'object' && (status.network || Array.isArray(status.peers));

        if (isNetworkStatus && status.setup && status.setup.needsSetup) {
          this.setState({ needsSetup: true });
        }

        if (isNetworkStatus && this.props.bridgeNetworkStatusUpdate) {
          this.props.bridgeNetworkStatusUpdate(status);
        }
      }
    } catch (error) {
      console.error('[HUB]', 'Error handling bridge response:', error);
    }
  }

  render () {
    // Prefer Bridge ref (live from WebSocket), then Redux, then local state
    const bridgeInstance = this.bridgeRef && this.bridgeRef.current;
    const nodePubkey = (bridgeInstance && typeof bridgeInstance.getNodePubkey === 'function' && bridgeInstance.getNodePubkey());
    const networkStatus = bridgeInstance && (bridgeInstance.networkStatus || bridgeInstance.lastNetworkStatus || null);
    const services = networkStatus && networkStatus.state && networkStatus.state.services;
    const bitcoin = services && services.bitcoin;

    // Auth: prefer in-session local identity (with id/xpub) so button shows identity after login
    const local = this.state.uiLocalIdentity;
    const hasLocal = local && (local.id || local.xpub);
    const effectiveAuth = hasLocal ? local : this.props.auth;
    // Never show "locked" when we have the key in memory
    const effectiveHasLockedIdentity = (local && local.xprv) ? false : this.state.uiHasLockedIdentity;

    return (
      <fabric-interface id={this.id} class="fabric-site">
        <style>
          {`
            fabric-react-component {
              margin: 1em;
            }

            .fade-in {
              animation: hub-fade-in 220ms ease-out;
            }

            @keyframes hub-fade-in {
              from {
                opacity: 0;
                transform: translateY(2px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
          `}
        </style>
        <fabric-container id="react-application">
          <fabric-react-component id='fabric-hub-application'>
            <Bridge
              ref={this.bridgeRef}
              auth={effectiveAuth}
              debug={this.state.debug}
              hubAddress={this.state.uiHubAddress}
              onRequireUnlock={() => this.setState({ uiIdentityOpen: true })}
              onStateUpdate={this.handleBridgeStateUpdate}
              responseCapture={this.responseCapture}
            />
            {(this.props.auth && this.props.auth.loading) ? (
              <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <Loader active inline="centered" size='huge' />
              </div>
            ) : !this.state.setupChecked ? (
              <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '1em' }}>
                <Loader active inline="centered" size='large' />
                <p style={{ color: '#666', margin: 0 }}>Connecting to Hub…</p>
              </div>
            ) : this.state.needsSetup ? (
              <Onboarding
                nodeName="Hub"
                onConfigurationComplete={(result) => {
                  if (result && result.token) {
                    this.setState({
                      adminToken: result.token,
                      adminTokenExpiresAt: result.expiresAt,
                      needsSetup: false
                    });
                    if (typeof window !== 'undefined' && window.localStorage) {
                      try {
                        window.localStorage.setItem('fabric.hub.adminToken', result.token);
                        if (result.expiresAt != null) {
                          window.localStorage.setItem('fabric.hub.adminTokenExpiresAt', String(result.expiresAt));
                        }
                      } catch (e) {}
                    }
                  }
                }}
              />
            ) : (
              <BrowserRouter style={{ marginTop: 0 }}>
                <TopPanel
                  hubAddress={this.state.uiHubAddress}
                  auth={effectiveAuth}
                  localIdentity={local}
                  hasLocalIdentity={!!hasLocal}
                  hasLockedIdentity={effectiveHasLockedIdentity}
                  bitcoin={bitcoin}
                  clientBalance={this.state.clientBalance}
                  onRefreshBalance={() => this._refreshClientBalance(true)}
                  onUnlockIdentity={() => {
                    this.setState({ uiIdentityOpen: true });
                  }}
                  onLockIdentity={() => this._handleLockIdentity()}
                  onLogin={this.requestLogin}
                  onManageIdentity={this.openIdentityManager}
                  onProfile={this.openIdentityManager}
                  onSignMessage={() => this.setState({ uiSignMessageOpen: true })}
                  onDestroyIdentity={() => this.setState({ uiDestroyIdentityConfirmOpen: true })}
                  onOpenSettings={() => {
                    this.setState({
                      uiSettingsOpen: true,
                      uiHubAddressDraft: this.state.uiHubAddress,
                      uiHubAddressError: null
                    });
                  }}
                />

                <Modal
                  size="large"
                  open={!!this.state.uiIdentityOpen}
                  onClose={() => this.setState({ uiIdentityOpen: false })}
                >
                  <Modal.Content scrolling>
                    <IdentityManager
                      key={this.state.uiIdentityOpen ? 'open' : 'closed'}
                      currentIdentity={this.state.uiLocalIdentity}
                      onLocalIdentityChange={(info) => {
                        this.setState((prev) => {
                          if (!info) {
                            return { uiLocalIdentity: null, uiHasLockedIdentity: false };
                          }
                          // Never replace an unlocked identity (have xprv) with a locked one from the modal
                          if (prev.uiLocalIdentity && prev.uiLocalIdentity.xprv && !info.xprv) {
                            return {};
                          }
                          return {
                            uiLocalIdentity: {
                              id: info.id,
                              xpub: info.xpub,
                              xprv: info.xprv || undefined,
                              passwordProtected: !!info.passwordProtected
                            }
                          };
                        });
                      }}
                      onLockStateChange={(locked) => {
                        this.setState((prev) => {
                          // Never mark locked if we still have the key in memory
                          if (prev.uiLocalIdentity && prev.uiLocalIdentity.xprv) return {};
                          return { uiHasLockedIdentity: !!locked };
                        });
                        // When locking identity, wipe any decrypted document content
                        // while preserving encrypted blobs, so re-unlocking is required
                        // to view protected documents again.
                        if (locked && this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearDecryptedDocuments === 'function') {
                          try {
                            this.bridgeRef.current.clearDecryptedDocuments();
                          } catch (e) {}
                        }
                      }}
                      onUnlockSuccess={(identityInfo) => {
                        if (identityInfo && typeof identityInfo === 'object' && (identityInfo.id || identityInfo.xpub)) {
                          const next = {
                            id: identityInfo.id,
                            xpub: identityInfo.xpub,
                            xprv: identityInfo.xprv || undefined,
                            passwordProtected: !!identityInfo.passwordProtected
                          };
                          this.setState({
                            uiLocalIdentity: next,
                            uiHasLockedIdentity: false,
                            uiIdentityOpen: false
                          });
                        } else {
                          this.setState({ uiIdentityOpen: false });
                        }
                      }}
                      onForgetIdentity={() => {
                        if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearAllDocuments === 'function') {
                          this.bridgeRef.current.clearAllDocuments();
                        }
                      }}
                    />
                  </Modal.Content>
                  <Modal.Actions>
                    <Button basic onClick={() => this.setState({ uiIdentityOpen: false })}>
                      Close
                    </Button>
                  </Modal.Actions>
                </Modal>

                <Modal
                  size="small"
                  open={!!this.state.uiSettingsOpen}
                  onClose={() => this.setState({ uiSettingsOpen: false, uiHubAddressError: null })}
                >
                  <Header icon>
                    <Icon name="cog" />
                    Settings
                  </Header>
                  <Modal.Content>
                    <Form>
                      <Form.Field>
                        <label>Hub address</label>
                        <Input
                          placeholder="host:port (e.g. localhost:7777) or https://host:port"
                          value={this.state.uiHubAddressDraft || ''}
                          onChange={(e) => this.setState({ uiHubAddressDraft: e.target.value, uiHubAddressError: null })}
                        />
                        <div style={{ marginTop: '0.5em', color: '#666' }}>
                          This updates the WebSocket endpoint used by the UI.
                        </div>
                        {this.state.uiHubAddressError ? (
                          <div style={{ marginTop: '0.5em', color: '#b00' }}>
                            {this.state.uiHubAddressError}
                          </div>
                        ) : null}
                      </Form.Field>
                    </Form>
                  </Modal.Content>
                  <Modal.Actions>
                    <Button basic onClick={() => this.setState({ uiSettingsOpen: false, uiHubAddressError: null })}>
                      Cancel
                    </Button>
                    <Button
                      primary
                      onClick={() => {
                        const raw = (this.state.uiHubAddressDraft || '').trim();
                        if (!raw) {
                          this.setState({ uiHubAddressError: 'Hub address is required.' });
                          return;
                        }

                        try {
                          if (typeof window !== 'undefined' && window.localStorage) {
                            window.localStorage.setItem('fabric.hub.address', raw);
                          }
                        } catch (e) {}

                        this.setState({ uiHubAddress: raw, uiSettingsOpen: false, uiHubAddressError: null }, () => {
                          try {
                            if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.setHubAddress === 'function') {
                              const ok = this.bridgeRef.current.setHubAddress(raw);
                              if (!ok) this.setState({ uiHubAddressError: 'Invalid hub address format.' });
                            }
                          } catch (e) {}
                        });
                      }}
                    >
                      Save
                    </Button>
                  </Modal.Actions>
                </Modal>

                <Modal
                  size="small"
                  open={!!this.state.uiSignMessageOpen}
                  onClose={() => this.setState({
                    uiSignMessageOpen: false,
                    uiSignMessageText: '',
                    uiSignMessageResult: null,
                    uiVerifyMessageText: '',
                    uiVerifySignature: '',
                    uiVerifyPublicKey: '',
                    uiVerifyResult: null
                  })}
                >
                  <Header icon>
                    <Icon name="pencil" />
                    Sign & verify message
                  </Header>
                  <Modal.Content>
                    <Form>
                      <Form.Field>
                        <label>Message to sign</label>
                        <Input
                          placeholder="Enter message to sign"
                          value={this.state.uiSignMessageText || ''}
                          onChange={(e) => this.setState({ uiSignMessageText: e.target.value, uiSignMessageResult: null })}
                        />
                      </Form.Field>
                      {this.state.uiSignMessageResult && (
                        <Message className="fade-in">
                          <Form.Field>
                            <label>Public key (hex)</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                              <span>{this.state.uiSignMessageResult.publicKey}</span>
                              <Icon
                                name="copy"
                                link
                                onClick={() => { try { navigator.clipboard.writeText(this.state.uiSignMessageResult.publicKey); } catch (e) {} }}
                                style={{ cursor: 'pointer' }}
                              />
                            </div>
                          </Form.Field>
                          <Form.Field>
                            <label>Signature</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                              <span>{this.state.uiSignMessageResult.signature}</span>
                              <Icon
                                name="copy"
                                link
                                onClick={() => { try { navigator.clipboard.writeText(this.state.uiSignMessageResult.signature); } catch (e) {} }}
                                style={{ cursor: 'pointer' }}
                              />
                            </div>
                          </Form.Field>
                        </Message>
                      )}

                      <Header as="h4" dividing style={{ marginTop: '1.5em' }}>
                        Verify signature
                      </Header>
                      <Form.Field>
                        <label>Message</label>
                        <Input
                          placeholder="Message that was signed"
                          value={this.state.uiVerifyMessageText || ''}
                          onChange={(e) => this.setState({ uiVerifyMessageText: e.target.value, uiVerifyResult: null })}
                        />
                      </Form.Field>
                      <Form.Field>
                        <label>Public key (hex)</label>
                        <Input
                          placeholder="Compressed public key (66 hex chars)"
                          value={this.state.uiVerifyPublicKey || ''}
                          onChange={(e) => this.setState({ uiVerifyPublicKey: e.target.value, uiVerifyResult: null })}
                        />
                      </Form.Field>
                      <Form.Field>
                        <label>Signature (hex)</label>
                        <Input
                          placeholder="Signature (128 hex chars)"
                          value={this.state.uiVerifySignature || ''}
                          onChange={(e) => this.setState({ uiVerifySignature: e.target.value, uiVerifyResult: null })}
                        />
                      </Form.Field>
                      {this.state.uiVerifyResult === true && (
                        <Message success className="fade-in">
                          <Icon name="check" color="green" size="large" />
                          Signature is valid
                        </Message>
                      )}
                      {this.state.uiVerifyResult === false && (
                        <Message negative className="fade-in">
                          <Icon name="close" color="red" size="large" />
                          Signature is invalid
                        </Message>
                      )}
                    </Form>
                  </Modal.Content>
                  <Modal.Actions>
                    <Button basic onClick={() => this.setState({
                      uiSignMessageOpen: false,
                      uiSignMessageText: '',
                      uiSignMessageResult: null,
                      uiVerifyMessageText: '',
                      uiVerifySignature: '',
                      uiVerifyPublicKey: '',
                      uiVerifyResult: null
                    })}>
                      Close
                    </Button>
                    <Button
                      primary
                      onClick={() => {
                        const text = (this.state.uiSignMessageText || '').trim();
                        if (!text) return;
                        const bridge = this.bridgeRef && this.bridgeRef.current;
                        const result = bridge && typeof bridge.signArbitraryText === 'function' ? bridge.signArbitraryText(text) : null;
                        this.setState({
                          uiSignMessageResult: result,
                          uiVerifyMessageText: result ? text : this.state.uiVerifyMessageText,
                          uiVerifyPublicKey: result ? result.publicKey : this.state.uiVerifyPublicKey,
                          uiVerifySignature: result ? result.signature : this.state.uiVerifySignature,
                          uiVerifyResult: null
                        });
                      }}
                      disabled={!((this.state.uiSignMessageText || '').trim())}
                    >
                      <Icon name="pencil" />
                      Sign
                    </Button>
                    <Button
                      onClick={() => {
                        const msg = (this.state.uiVerifyMessageText || '').trim();
                        const sig = (this.state.uiVerifySignature || '').trim();
                        const pub = (this.state.uiVerifyPublicKey || '').trim();
                        if (!msg || !sig || !pub) return;
                        const bridge = this.bridgeRef && this.bridgeRef.current;
                        const result = bridge && typeof bridge.verifyArbitraryText === 'function'
                          ? bridge.verifyArbitraryText(msg, sig, pub)
                          : null;
                        this.setState({ uiVerifyResult: result });
                      }}
                      disabled={!((this.state.uiVerifyMessageText || '').trim()) || !((this.state.uiVerifySignature || '').trim()) || !((this.state.uiVerifyPublicKey || '').trim())}
                    >
                      <Icon name="check" />
                      Verify
                    </Button>
                  </Modal.Actions>
                </Modal>

                <Modal
                  size="tiny"
                  open={!!this.state.uiDestroyIdentityConfirmOpen}
                  onClose={() => this.setState({ uiDestroyIdentityConfirmOpen: false })}
                >
                  <Header icon>
                    <Icon name="trash" color="red" />
                    Destroy identity
                  </Header>
                  <Modal.Content>
                    <p>This will remove your local identity and all documents from this browser. This cannot be undone. Make sure you have backed up your seed phrase.</p>
                  </Modal.Content>
                  <Modal.Actions>
                    <Button basic onClick={() => this.setState({ uiDestroyIdentityConfirmOpen: false })}>
                      Cancel
                    </Button>
                    <Button
                      negative
                      onClick={() => {
                        if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearAllDocuments === 'function') {
                          try { this.bridgeRef.current.clearAllDocuments(); } catch (e) {}
                        }
                        try {
                          if (typeof window !== 'undefined') {
                            if (window.localStorage) window.localStorage.removeItem('fabric.identity.local');
                            if (window.sessionStorage) window.sessionStorage.removeItem('fabric.identity.unlocked');
                            if (window.localStorage) window.localStorage.removeItem('fabric:documents');
                          }
                        } catch (e) {}
                        this.setState({
                          uiLocalIdentity: null,
                          uiHasLockedIdentity: false,
                          uiIdentityOpen: false,
                          uiDestroyIdentityConfirmOpen: false,
                          uiSignMessageOpen: false
                        });
                      }}
                    >
                      <Icon name="trash" />
                      Destroy
                    </Button>
                  </Modal.Actions>
                </Modal>

                <Routes>
                  <Route
                    path="/"
                    element={(
                      <Home
                        auth={effectiveAuth}
                        fetchContract={this.props.fetchContract}
                        contracts={this.props.contracts}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        onDiscoverWebRTCPeers={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.discoverAndConnectToPeers === 'function') {
                            bridgeInstance.discoverAndConnectToPeers();
                          }
                        }}
                        onRepublishWebRTCOffer={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.publishWebRTCOffer === 'function') {
                            bridgeInstance.publishWebRTCOffer();
                          }
                        }}
                        onConnectWebRTCPeer={(peerId) => {
                          const id = (peerId || '').trim();
                          if (!id || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.connectToWebRTCPeer === 'function') {
                            bridgeInstance.connectToWebRTCPeer(id);
                          }
                        }}
                        onDisconnectAllWebRTCPeers={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.disconnectAllWebRTCPeers === 'function') {
                            bridgeInstance.disconnectAllWebRTCPeers();
                          }
                        }}
                        onSendWebRTCTestPing={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.broadcastToWebRTCPeers === 'function') {
                            bridgeInstance.broadcastToWebRTCPeers({
                              type: 'ping',
                              timestamp: Date.now()
                            });
                          }
                        }}
                        onToggleWebRTCChatOnly={(enabled) => {
                          const flag = !!enabled;
                          this.setState({ webrtcChatOnly: flag });
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.setWebRTCChatOnly === 'function') {
                            bridgeInstance.setWebRTCChatOnly(flag);
                          }
                        }}
                        onRequireUnlock={() => {
                          this.setState({ uiIdentityOpen: true });
                        }}
                        webrtcChatOnly={this.state.webrtcChatOnly}
                        {...this.props}
                      />
                    )}
                  />
                  <Route
                    path="/services/bitcoin"
                    element={(
                      <BitcoinHome
                        auth={effectiveAuth}
                        identity={local || effectiveAuth}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        adminToken={this.state.adminToken}
                        {...this.props}
                      />
                    )}
                  />
                  <Route
                    path="/services/bitcoin/blocks/:blockhash"
                    element={(
                      <BitcoinBlockView
                        auth={effectiveAuth}
                        identity={local || effectiveAuth}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        {...this.props}
                      />
                    )}
                  />
                  <Route
                    path="/services/bitcoin/payments"
                    element={(
                      <BitcoinPaymentsHome
                        auth={effectiveAuth}
                        identity={local || effectiveAuth}
                        bitcoin={bitcoin}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        {...this.props}
                      />
                    )}
                  />
                  <Route
                    path="/services/bitcoin/transactions/:txhash"
                    element={(
                      <BitcoinTransactionView
                        auth={effectiveAuth}
                        identity={local || effectiveAuth}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        {...this.props}
                      />
                    )}
                  />
                  <Route
                    path="/peers"
                    element={(
                      <PeerList
                        auth={effectiveAuth}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        onAddPeer={(peer) => {
                          if (!peer || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendAddPeerRequest === 'function') {
                            bridgeInstance.sendAddPeerRequest(peer);
                          }
                        }}
                        onRefreshPeers={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendListPeersRequest === 'function') {
                            bridgeInstance.sendListPeersRequest();
                          }
                          if (typeof bridgeInstance.sendNetworkStatusRequest === 'function') {
                            bridgeInstance.sendNetworkStatusRequest();
                          }
                        }}
                        onDisconnectPeer={(address) => {
                          if (!address || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendRemovePeerRequest === 'function') {
                            bridgeInstance.sendRemovePeerRequest(address);
                          }
                        }}
                        onSendPeerMessage={(address, text) => {
                          if (!address || !text || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendPeerMessageRequest === 'function') {
                            bridgeInstance.sendPeerMessageRequest(address, text);
                          }
                        }}
                        onSetPeerNickname={(address, nickname) => {
                          if (!address || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendSetPeerNicknameRequest === 'function') {
                            bridgeInstance.sendSetPeerNicknameRequest(address, nickname);
                          }
                        }}
                        onDiscoverWebRTCPeers={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.discoverAndConnectToPeers === 'function') {
                            bridgeInstance.discoverAndConnectToPeers();
                          }
                        }}
                        onRepublishWebRTCOffer={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.publishWebRTCOffer === 'function') {
                            bridgeInstance.publishWebRTCOffer();
                          }
                        }}
                        onConnectWebRTCPeer={(peerId) => {
                          const id = (peerId || '').trim();
                          if (!id || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.connectToWebRTCPeer === 'function') {
                            bridgeInstance.connectToWebRTCPeer(id);
                          }
                        }}
                        onDisconnectWebRTCPeer={(peerId) => {
                          const id = (peerId || '').trim();
                          if (!id || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.disconnectWebRTCPeer === 'function') {
                            bridgeInstance.disconnectWebRTCPeer(id);
                          }
                        }}
                        onDisconnectAllWebRTCPeers={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.disconnectAllWebRTCPeers === 'function') {
                            bridgeInstance.disconnectAllWebRTCPeers();
                          }
                        }}
                        onSendWebRTCTestPing={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.broadcastToWebRTCPeers === 'function') {
                            bridgeInstance.broadcastToWebRTCPeers({
                              type: 'ping',
                              timestamp: Date.now()
                            });
                          }
                        }}
                        {...this.props}
                      />
                    )}
                  />
                  <Route
                    path="/peers/:id"
                    element={(
                      <PeerView
                        auth={effectiveAuth}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        onAddPeer={(peer) => {
                          if (!peer || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendAddPeerRequest === 'function') {
                            bridgeInstance.sendAddPeerRequest(peer);
                          }
                        }}
                        onRefreshPeers={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendListPeersRequest === 'function') {
                            bridgeInstance.sendListPeersRequest();
                          }
                          if (typeof bridgeInstance.sendNetworkStatusRequest === 'function') {
                            bridgeInstance.sendNetworkStatusRequest();
                          }
                        }}
                        onDisconnectPeer={(address) => {
                          if (!address || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendRemovePeerRequest === 'function') {
                            bridgeInstance.sendRemovePeerRequest(address);
                          }
                        }}
                        onSendPeerMessage={(address, text) => {
                          if (!address || !text || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendPeerMessageRequest === 'function') {
                            bridgeInstance.sendPeerMessageRequest(address, text);
                          }
                        }}
                        onSetPeerNickname={(address, nickname) => {
                          if (!address || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendSetPeerNicknameRequest === 'function') {
                            bridgeInstance.sendSetPeerNicknameRequest(address, nickname);
                          }
                        }}
                        onGetPeer={(address) => {
                          if (!address || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendGetPeerRequest === 'function') {
                            bridgeInstance.sendGetPeerRequest(address);
                          }
                        }}
                        {...this.props}
                      />
                    )}
                  />
                  <Route
                    path="/documents"
                    element={(
                      <DocumentList
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        onListDocuments={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendListDocumentsRequest === 'function') {
                            bridgeInstance.sendListDocumentsRequest();
                          }
                        }}
                        onAddLocalDocument={(doc) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.addLocalDocument === 'function') {
                            bridgeInstance.addLocalDocument(doc);
                          }
                        }}
                        onPublishLocalDocument={(doc) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendPublishDocumentRequest === 'function') {
                            bridgeInstance.sendPublishDocumentRequest(doc.id);
                          }
                        }}
                        onCreateDocument={(doc) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendCreateDocumentRequest === 'function') {
                            bridgeInstance.sendCreateDocumentRequest(doc);
                          }
                        }}
                        {...this.props}
                      />
                    )}
                  />
                  <Route
                    path="/documents/:id"
                    element={(
                      <DocumentView
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        hasDocumentKey={
                          !!(bridgeInstance &&
                            typeof bridgeInstance.hasDocumentEncryptionKey === 'function' &&
                            bridgeInstance.hasDocumentEncryptionKey())
                        }
                        onRequestUnlock={() => {
                          this.setState({ uiIdentityOpen: true });
                        }}
                        onGetDocument={(id) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendGetDocumentRequest === 'function') {
                            bridgeInstance.sendGetDocumentRequest(id);
                          }
                        }}
                        onGetDecryptedContent={(id) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return null;
                          const bridgeInstance = this.bridgeRef.current;
                          return typeof bridgeInstance.getDecryptedDocumentContent === 'function'
                            ? bridgeInstance.getDecryptedDocumentContent(id)
                            : null;
                        }}
                        onPublishDocument={(id) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendPublishDocumentRequest === 'function') {
                            bridgeInstance.sendPublishDocumentRequest(id);
                          }
                        }}
                        onRequestDistributeInvoice={(id, config) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendCreateDistributeInvoiceRequest === 'function') {
                            bridgeInstance.sendCreateDistributeInvoiceRequest(id, config);
                          }
                        }}
                        onDistributeDocument={(id, config) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return null;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendDistributeDocumentRequest === 'function') {
                            return bridgeInstance.sendDistributeDocumentRequest(id, config);
                          }
                          return null;
                        }}
                        {...this.props}
                      />
                    )}
                  />
                  <Route
                    path="/contracts"
                    element={(
                      <ContractList {...this.props} />
                    )}
                  />
                  <Route
                    path="/contracts/:id"
                    element={(
                      <ContractView {...this.props} />
                    )}
                  />
                </Routes>
                <BottomPanel pubkey={nodePubkey} />
              </BrowserRouter>
            )}
          </fabric-react-component>
        </fabric-container>
      </fabric-interface>
    )
  }

  _getHTML () {
    const component = this.render();
    return renderToString(component);
  }

  _toHTML () {
    return ReactDOMServer.renderToString(this.render());
  }

  toHTMLFragment () {
    return this._toHTML();
  }

  toHTML () {
    return this._toHTML();
  }
}

module.exports = HubInterface;
