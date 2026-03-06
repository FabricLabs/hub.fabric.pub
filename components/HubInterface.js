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
const Home = require('./Home');
const BitcoinHome = require('./BitcoinHome');
const DocumentList = require('./DocumentList');
const DocumentView = require('./DocumentView');
const PeerList = require('./PeerList');
const PeerView = require('./PeerView');
const TopPanel = require('./TopPanel');
const BottomPanel = require('./BottomPanel');
const IdentityManager = require('./IdentityManager');

// Semantic UI
const {
  Modal,
  Button,
  Form,
  Header,
  Icon,
  Input,
  Loader
  } = require('semantic-ui-react');

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
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem('fabric.identity.local');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.xprv) {
            try {
              const ident = new Identity({ xprv: parsed.xprv });
              initialLocalIdentity = {
                id: ident.id,
                xpub: ident.key.xpub
              };
            } catch (e) {}
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
      uiHasLockedIdentity: false
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
    console.log('handleBridgeStateUpdate', newState);
    this.setState(newState);
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
    const networkStatus = this.state && this.state.networkStatus ? this.state.networkStatus : null;
    const network = networkStatus && networkStatus.network ? networkStatus.network : null;
    const nodePubkey = network
      ? (network.pubkey || network.id || network.address || '')
      : '';

    return (
      <fabric-interface id={this.id} class="fabric-site">
        <style>
          {`
            fabric-react-component {
              margin: 1em;
            }
          `}
        </style>
        <fabric-container id="react-application">
          <fabric-react-component id='fabric-hub-application'>
            <Bridge
              ref={this.bridgeRef}
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
                  auth={this.props.auth || this.state.uiLocalIdentity}
                  hasLocalIdentity={!!this.state.uiLocalIdentity}
                  hasLockedIdentity={this.state.uiHasLockedIdentity}
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
                      onLocalIdentityChange={(info) => {
                        this.setState({ uiLocalIdentity: info || null });
                        if (!info) {
                          this.setState({ uiHasLockedIdentity: false });
                        }
                      }}
                      onLockStateChange={(locked) => {
                        this.setState({ uiHasLockedIdentity: !!locked });
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
                        auth={this.props.auth}
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
                        auth={this.props.auth}
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
                        {...this.props}
                      />
                    )}
                  />
                  <Route
                    path="/peers/:address"
                    element={(
                      <PeerView
                        auth={this.props.auth}
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
                        onListDocuments={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendListDocumentsRequest === 'function') {
                            bridgeInstance.sendListDocumentsRequest();
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
                        onGetDocument={(id) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendGetDocumentRequest === 'function') {
                            bridgeInstance.sendGetDocumentRequest(id);
                          }
                        }}
                        onPublishDocument={(id) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendPublishDocumentRequest === 'function') {
                            bridgeInstance.sendPublishDocumentRequest(id);
                          }
                        }}
                        {...this.props}
                      />
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
