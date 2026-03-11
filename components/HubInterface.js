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

// Semantic UI
const {
  Modal,
  Button,
  Form,
  Header,
  Icon,
  Input,
  Loader,
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
      modalLogOut: false,
      loggedOut: false,
      uiSettingsOpen: false,
      uiHubAddress: initialHubAddress,
      uiHubAddressDraft: initialHubAddress,
      uiHubAddressError: null,
      uiIdentityOpen: false,
      uiLocalIdentity: initialLocalIdentity,
      uiHasLockedIdentity: initialHasLockedIdentity
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
  }

  componentWillUnmount () {
    console.debug('[HUB]', 'Cleaning up...');
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
              onStateUpdate={this.handleBridgeStateUpdate}
              responseCapture={this.responseCapture}
            />
            {(this.props.auth && this.props.auth.loading) ? (
              <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <Loader active inline="centered" size='huge' />
              </div>
            ) : (
              <BrowserRouter style={{ marginTop: 0 }}>
                <TopPanel
                  hubAddress={this.state.uiHubAddress}
                  auth={effectiveAuth}
                  hasLocalIdentity={!!hasLocal}
                  hasLockedIdentity={effectiveHasLockedIdentity}
                  bitcoin={bitcoin}
                  onUnlockIdentity={() => {
                    this.setState({ uiIdentityOpen: true });
                  }}
                  onLogin={this.requestLogin}
                  onManageIdentity={this.openIdentityManager}
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
                        onAddPeer={(peer) => {
                          if (!peer || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendAddPeerRequest === 'function') {
                            bridgeInstance.sendAddPeerRequest(peer);
                          }
                        }}
                        onRefreshPeers={() => {
                          if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.sendListPeersRequest === 'function') {
                            this.bridgeRef.current.sendListPeersRequest();
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
                          if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.sendListPeersRequest === 'function') {
                            this.bridgeRef.current.sendListPeersRequest();
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
                        onDistributeDocument={(id, config) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
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
