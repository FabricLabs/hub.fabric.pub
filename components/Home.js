'use strict';

// Dependencies
const React = require('react');
const { useLocation, Link } = require('react-router-dom');

function scrollToHashElement (hash) {
  const raw = hash || '';
  const h = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!h) return;
  const el = document.getElementById(h);
  if (el && typeof el.scrollIntoView === 'function') {
    window.requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }
}

const {
  Button,
  Card,
  Form,
  Header,
  Icon,
  Input,
  Label,
  Loader,
  Message,
  Modal,
  Segment
} = require('semantic-ui-react');

const ActivityStream = require('./ActivityStream');
const { isHubNetworkStatusShape, bridgeWebSocketLoadingHint } = require('../functions/hubNetworkStatus');
const { hydrateHubNetworkStatusViaHttp } = require('../functions/hydrateHubNetworkStatusViaHttp');
const { loadHubUiFeatureFlags } = require('../functions/hubUiFeatureFlags');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');

class Home extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      connectModalOpen: false,
      connectPeerIdDraft: '',
      /** Bumps when Bridge/network status updates over WS or HTTP so this page re-renders (Bridge is a sibling). */
      networkStatusRenderTick: 0,
      lastNetworkSnapshotAt: null,
      snapshotRefreshPending: false
    };
    this._snapshotRefreshSafetyTimer = null;
    this._onNetworkStatusEvent = () => {
      if (this._snapshotRefreshSafetyTimer) {
        clearTimeout(this._snapshotRefreshSafetyTimer);
        this._snapshotRefreshSafetyTimer = null;
      }
      this.setState((s) => ({
        networkStatusRenderTick: (s.networkStatusRenderTick || 0) + 1,
        lastNetworkSnapshotAt: Date.now(),
        snapshotRefreshPending: false
      }));
    };
    this._homeHttpFallbackTimer = null;
    /** Avoid re-arming HTTP hydrate on every parent re-render when the hub never returns a valid snapshot. */
    this._homeHttpHydrateAttempted = false;
  }

  componentDidMount () {
    if (typeof window !== 'undefined') {
      window.addEventListener('networkStatusUpdate', this._onNetworkStatusEvent);
    }
    this._scheduleHomeNetworkHttpFallback();
    this._touchSnapshotTimeIfReady();
    setTimeout(() => this._touchSnapshotTimeIfReady(), 0);
  }

  componentWillUnmount () {
    if (typeof window !== 'undefined') {
      window.removeEventListener('networkStatusUpdate', this._onNetworkStatusEvent);
    }
    if (this._homeHttpFallbackTimer) {
      clearTimeout(this._homeHttpFallbackTimer);
      this._homeHttpFallbackTimer = null;
    }
    if (this._snapshotRefreshSafetyTimer) {
      clearTimeout(this._snapshotRefreshSafetyTimer);
      this._snapshotRefreshSafetyTimer = null;
    }
  }

  componentDidUpdate () {
    this._scheduleHomeNetworkHttpFallback();
    this._touchSnapshotTimeIfReady();
  }

  /** Seed "last updated" when status is already on Bridge before any `networkStatusUpdate` fires. */
  _touchSnapshotTimeIfReady () {
    const ref = this.props.bridgeRef || this.props.bridge;
    const cur = ref && ref.current;
    const ns = cur && (cur.networkStatus || cur.lastNetworkStatus);
    if (!isHubNetworkStatusShape(ns)) return;
    if (this.state.lastNetworkSnapshotAt != null) return;
    this.setState({ lastNetworkSnapshotAt: Date.now() });
  }

  _scheduleHomeNetworkHttpFallback () {
    if (typeof window === 'undefined') return;
    if (this._homeHttpHydrateAttempted) return;
    const ref = this.props.bridgeRef || this.props.bridge;
    const current = ref && ref.current;
    if (!current) return;
    const ns = current.networkStatus || current.lastNetworkStatus;
    if (isHubNetworkStatusShape(ns)) {
      if (this._homeHttpFallbackTimer) {
        clearTimeout(this._homeHttpFallbackTimer);
        this._homeHttpFallbackTimer = null;
      }
      return;
    }
    if (this._homeHttpFallbackTimer) return;
    this._homeHttpFallbackTimer = setTimeout(async () => {
      this._homeHttpFallbackTimer = null;
      this._homeHttpHydrateAttempted = true;
      const r2 = this.props.bridgeRef || this.props.bridge;
      const cur = r2 && r2.current;
      if (!cur) return;
      const n2 = cur.networkStatus || cur.lastNetworkStatus;
      if (isHubNetworkStatusShape(n2)) return;
      const origin = window.location && window.location.origin ? window.location.origin : '';
      await hydrateHubNetworkStatusViaHttp(cur, origin);
    }, 2500);
  }

  _openConnectModal = () => {
    this.setState({ connectModalOpen: true, connectPeerIdDraft: '' });
  };

  _closeConnectModal = () => {
    this.setState({ connectModalOpen: false, connectPeerIdDraft: '' });
  };

  _submitConnectPeerId = () => {
    const { onConnectWebRTCPeer } = this.props;
    const value = String(this.state.connectPeerIdDraft || '').trim();
    if (!value || typeof onConnectWebRTCPeer !== 'function') return;
    onConnectWebRTCPeer(value);
    this.setState({ connectModalOpen: false, connectPeerIdDraft: '' });
  };

  render () {
    const {
      bridge,
      bridgeRef,
      networkStatusFromEvent,
      onDiscoverWebRTCPeers,
      onRepublishWebRTCOffer,
      onConnectWebRTCPeer,
      onRequireUnlock,
      adminToken,
      auth
    } = this.props;
    const publicHubVisitor = !!(this.props && this.props.publicHubVisitor);
    const showHomeOperatorLinks = !publicHubVisitor;
    const uf = loadHubUiFeatureFlags();
    const hasHubAdminForPeers = !!readHubAdminTokenFromBrowser(adminToken);
    const ref = bridgeRef || bridge;
    const current = ref && ref.current;
    const candidateFromEvent = networkStatusFromEvent;
    const candidateFromRef = current && current.networkStatus;
    const candidate = isHubNetworkStatusShape(candidateFromEvent)
      ? candidateFromEvent
      : (isHubNetworkStatusShape(candidateFromRef) ? candidateFromRef : null);
    const fallback = current && current.lastNetworkStatus;
    const networkStatus = isHubNetworkStatusShape(candidate)
      ? candidate
      : (isHubNetworkStatusShape(fallback) ? fallback : null);
    const network = networkStatus && networkStatus.network;
    const peers = Array.isArray(networkStatus && networkStatus.peers) ? networkStatus.peers : [];
    const webrtcPeers = Array.isArray(networkStatus && networkStatus.webrtcPeers) ? networkStatus.webrtcPeers : [];
    const state = networkStatus && networkStatus.state;
    const stateStatusUpper = (state && state.status != null)
      ? String(state.status).trim().toUpperCase()
      : '';
    const bridgeFabricPaused = stateStatusUpper === 'PAUSED';
    const fabricPeerId = networkStatus && networkStatus.fabricPeerId
      ? String(networkStatus.fabricPeerId)
      : null;
    const legacyUnstableId = !fabricPeerId && networkStatus && networkStatus.contract != null
      ? String(networkStatus.contract)
      : null;
    const shareNodeId = fabricPeerId || legacyUnstableId;
    const hostPort = network && network.address ? String(network.address) : null;
    const shareableString = [shareNodeId, hostPort].filter(Boolean).join('\n');
    const meshStatus = current && typeof current.webrtcMeshStatus !== 'undefined'
      ? current.webrtcMeshStatus
      : null;
    const isOnline = !!networkStatus;
    const publishedMap = networkStatus && networkStatus.publishedDocuments && typeof networkStatus.publishedDocuments === 'object'
      ? networkStatus.publishedDocuments
      : {};
    const publishedCount = Object.values(publishedMap).filter((d) => d && d.id).length;
    const transportHint = bridgeWebSocketLoadingHint(current);
    const dataStatusLine = (() => {
      if (!transportHint) return 'Preparing a connection to this hub.';
      if (/waiting for network status/i.test(transportHint)) {
        return 'Next: the hub sends your network snapshot (peers, documents, node id).';
      }
      if (/Opening WebSocket|Reconnecting/i.test(transportHint)) {
        return 'The browser bridge must connect before status can load.';
      }
      return null;
    })();
    const hubLoadingHeader = (() => {
      if (transportHint && /waiting for network status/i.test(transportHint)) {
        return 'Connected — waiting for hub data';
      }
      if (transportHint && /Opening WebSocket/i.test(transportHint)) {
        return 'Opening WebSocket…';
      }
      if (transportHint && /Reconnecting/i.test(transportHint)) {
        return 'Reconnecting…';
      }
      return 'Waiting for hub snapshot…';
    })();
    const hubLoadingLead = transportHint || 'Opening a connection to the hub…';
    const bitcoin = networkStatus && networkStatus.bitcoin && typeof networkStatus.bitcoin === 'object'
      ? networkStatus.bitcoin
      : null;
    const clockVal = networkStatus && networkStatus.clock;
    const clockLine = (() => {
      if (clockVal == null || clockVal === '') return null;
      if (typeof clockVal === 'number' && Number.isFinite(clockVal)) {
        return `Hub clock: ${clockVal}`;
      }
      if (typeof clockVal === 'string') return `Hub clock: ${clockVal}`;
      return null;
    })();
    const contractId = networkStatus && networkStatus.contract != null ? String(networkStatus.contract) : '';
    const contractShort = contractId.length > 18 ? `${contractId.slice(0, 10)}…${contractId.slice(-6)}` : contractId;
    const snapshotUpdated =
      this.state.lastNetworkSnapshotAt != null && typeof this.state.lastNetworkSnapshotAt === 'number'
        ? new Date(this.state.lastNetworkSnapshotAt).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
        : null;

    return (
      <fabric-hub-home class='fade-in'>
        {!networkStatus ? (
          <Card fluid data-home-network-tick={this.state.networkStatusRenderTick}>
            <Card.Content>
              <Segment basic>
                <Segment
                  placeholder
                  style={{ minHeight: '30vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <div style={{ textAlign: 'center', maxWidth: '28rem' }}>
                    <Loader active inline="centered" size="large" />
                    <Header as='h4' style={{ marginTop: '1em', textAlign: 'center' }}>
                      {hubLoadingHeader}
                      <Header.Subheader style={{ textAlign: 'center', lineHeight: 1.5 }}>
                        <span style={{ display: 'block' }}>{hubLoadingLead}</span>
                        {dataStatusLine && dataStatusLine !== hubLoadingLead ? (
                          <span style={{ display: 'block', color: '#888', fontSize: '0.92em', marginTop: '0.35em' }}>
                            {dataStatusLine}
                          </span>
                        ) : null}
                      </Header.Subheader>
                    </Header>
                    {typeof this.props.onRefreshNetworkStatus === 'function' && (
                      <div style={{ marginTop: '1.1em' }}>
                        <Button
                          type="button"
                          size="small"
                          basic
                          icon
                          labelPosition="left"
                          onClick={() => {
                            try {
                              this.props.onRefreshNetworkStatus();
                            } catch (e) {}
                          }}
                        >
                          <Icon name="refresh" />
                          Request status again
                        </Button>
                        <p style={{ color: '#888', fontSize: '0.85em', marginTop: '0.75em', marginBottom: 0, lineHeight: 1.45 }}>
                          If this stays here, confirm the hub is up and the WebSocket bridge is connected.
                        </p>
                      </div>
                    )}
                  </div>
                </Segment>
              </Segment>
            </Card.Content>
          </Card>
        ) : (
          <Card fluid data-home-network-tick={this.state.networkStatusRenderTick}>
            <Card.Content>
              <Card.Header>Hub &amp; network</Card.Header>
              <Card.Meta>
                Snapshot from <code style={{ fontSize: '0.92em' }}>GetNetworkStatus</code>
                {snapshotUpdated ? ` · last refresh ${snapshotUpdated}` : ''}
                {' · '}
                This browser’s bridge is not your Fabric identity (see top bar for signing / chat).
              </Card.Meta>
              {typeof this.props.onRefreshNetworkStatus === 'function' ? (
                <div style={{ marginTop: '0.35em', marginBottom: '0.15em' }}>
                  <Button
                    type="button"
                    size="mini"
                    basic
                    icon
                    labelPosition="left"
                    aria-label="Refresh hub network snapshot"
                    disabled={this.state.snapshotRefreshPending}
                    loading={this.state.snapshotRefreshPending}
                    onClick={() => {
                      try {
                        this.setState({ snapshotRefreshPending: true });
                        if (this._snapshotRefreshSafetyTimer) clearTimeout(this._snapshotRefreshSafetyTimer);
                        this._snapshotRefreshSafetyTimer = setTimeout(() => {
                          this._snapshotRefreshSafetyTimer = null;
                          this.setState({ snapshotRefreshPending: false });
                        }, 10000);
                        this.props.onRefreshNetworkStatus();
                      } catch (e) {
                        this.setState({ snapshotRefreshPending: false });
                      }
                    }}
                  >
                    <Icon name="refresh" />
                    Refresh snapshot
                  </Button>
                </div>
              ) : null}
              <Card.Description>
                <Message info icon size="small" style={{ marginBottom: '1em' }}>
                  <Icon name="info circle" />
                  <Message.Content>
                    <Message.Header style={{ fontWeight: 600 }}>Two different credentials</Message.Header>
                    <p style={{ margin: '0.35em 0 0 0', lineHeight: 1.45 }}>
                      <strong>Hub admin token</strong> (<Link to="/settings" id="home-settings-credentials-link">Settings</Link>) authorizes operator actions in this browser — peer details, share-this-hub, and some Bitcoin controls.
                      Your <strong>Fabric identity</strong> (top bar) unlocks chat, document crypto, and client-side signing; it does not replace the admin token.
                    </p>
                  </Message.Content>
                </Message>
                {!uf.peers ? (
                  <Message warning size="small" style={{ marginBottom: '1em' }}>
                    <Message.Header>Peers &amp; WebRTC hidden</Message.Header>
                    <p style={{ margin: '0.35em 0 0 0', lineHeight: 1.45 }}>
                      Turn on the <strong>peers</strong> UI flag under <Link to="/settings/admin">Admin</Link> (or clear the local override in this browser) to restore Peers routes and mesh tools.
                    </p>
                  </Message>
                ) : null}
                {uf.peers && !hasHubAdminForPeers ? (
                  <Message size="small" style={{ marginBottom: '1em' }}>
                    <Message.Header>Hub admin token not in this browser</Message.Header>
                    <p style={{ margin: '0.35em 0 0 0', lineHeight: 1.45 }}>
                      Paste your operator token in <strong>Settings</strong> (use the link in the blue <em>Two different credentials</em> box above) to show peer counts, share-this-hub fields, and WebRTC shortcuts here.
                    </p>
                  </Message>
                ) : null}

                <Header as="h5" dividing style={{ marginTop: 0 }}>At a glance</Header>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35em', fontSize: '0.95em' }}>
                  {clockLine ? <div>{clockLine}</div> : null}
                  {contractShort ? (
                    <div>
                      <strong>Contract:</strong>{' '}
                      <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }} title={contractId}>{contractShort}</code>
                    </div>
                  ) : null}
                  {uf.peers && hasHubAdminForPeers ? (
                    <div>
                      <strong>Peers:</strong> {peers.length}
                      <span style={{ color: '#777' }}> · </span>
                      <strong>WebRTC registry:</strong> {webrtcPeers.length}
                      <span style={{ color: '#777' }}> · </span>
                      <strong>Published documents:</strong> {publishedCount}
                    </div>
                  ) : (
                    <div>
                      <strong>Published documents:</strong> {publishedCount}
                    </div>
                  )}
                  {bitcoin ? (
                    <div>
                      <strong>Bitcoin:</strong>{' '}
                      {bitcoin.available
                        ? (
                          <>
                            {bitcoin.network != null ? String(bitcoin.network) : '—'}
                            {bitcoin.height != null ? ` · block ${bitcoin.height}` : ''}
                            {' '}
                            {showHomeOperatorLinks ? (
                              <Link to="/services/bitcoin" style={{ fontSize: '0.95em' }}>Open Bitcoin hub</Link>
                            ) : (
                              <span style={{ color: '#888', fontSize: '0.92em' }}>Log in to open the Bitcoin hub.</span>
                            )}
                          </>
                          )
                        : (
                          <span style={{ color: '#888' }}>Unavailable</span>
                          )}
                    </div>
                  ) : null}
                </div>

                <Header as="h5" dividing>Fabric &amp; P2P</Header>
                <div style={{ marginBottom: '0.75em', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5em' }}>
                  <Label size="small" color={bridgeFabricPaused ? 'yellow' : (isOnline ? 'green' : 'grey')}>
                    {isOnline ? (bridgeFabricPaused ? 'Paused' : 'Connected') : 'Offline'}
                  </Label>
                  <span>
                    <strong>Hub Fabric state:</strong> {(state && state.status) || 'unknown'}
                    {bridgeFabricPaused ? ' — Fabric services idle until started.' : ''}
                  </span>
                  {uf.peers && showHomeOperatorLinks ? (
                    <Button as={Link} to="/peers" size="small" basic icon labelPosition="left">
                      <Icon name="sitemap" />
                      Peers &amp; mesh
                    </Button>
                  ) : null}
                </div>
                {uf.peers && hasHubAdminForPeers && (shareNodeId || hostPort) && (
                  <div style={{ marginBottom: '1em', padding: '0.75em', background: 'rgba(0,0,0,0.03)', borderRadius: '4px' }}>
                    <Header as='h5' style={{ margin: '0 0 0.5em 0' }}>Share this hub (for peering)</Header>
                    {shareNodeId && (
                      <div style={{ marginBottom: '0.5em' }}>
                        <strong>{fabricPeerId ? 'Fabric node ID' : 'Node ID (legacy)'}</strong>{' '}
                        <code
                          style={{ wordBreak: 'break-all', fontSize: '0.9em' }}
                          title={fabricPeerId ? 'Stable P2P identity (public key).' : 'May change when hub contract state updates — prefer Fabric node ID when available.'}
                        >{shareNodeId}</code>
                      </div>
                    )}
                    {hostPort && (
                      <div style={{ marginBottom: '0.5em' }}>
                        <strong>Listen address:</strong>{' '}
                        <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{hostPort}</code>
                      </div>
                    )}
                    {shareableString && (
                      <Button
                        size='small'
                        basic
                        icon
                        labelPosition='left'
                        onClick={() => {
                          try {
                            if (navigator.clipboard && navigator.clipboard.writeText) {
                              navigator.clipboard.writeText(shareableString);
                            } else {
                              const ta = document.createElement('textarea');
                              ta.value = shareableString;
                              ta.style.position = 'fixed';
                              ta.style.opacity = '0';
                              document.body.appendChild(ta);
                              ta.select();
                              document.execCommand('copy');
                              document.body.removeChild(ta);
                            }
                          } catch (e) {}
                        }}
                        title="Copy Fabric node ID (or legacy id) and listen address"
                      >
                        <Icon name='copy' />
                        Copy to clipboard
                      </Button>
                    )}
                  </div>
                )}

                {showHomeOperatorLinks ? (
                  <>
                    <Header as="h5" dividing>Lightning</Header>
                    <div style={{ marginBottom: '0.75em', color: '#555', fontSize: '0.95em' }}>
                      {uf.bitcoinLightning ? (
                        <>
                          Channels, invoices, and CLN RPC live on the Lightning page.{' '}
                          <Link to="/services/bitcoin/lightning">Open Lightning</Link>
                          {' · '}
                          <Link to="/services/bitcoin">Bitcoin hub</Link>
                        </>
                      ) : (
                        <>
                          Lightning UI is off. Enable <strong>bitcoinLightning</strong> under <Link to="/settings/admin">Admin</Link> (feature flags) to manage channels here.
                        </>
                      )}
                    </div>
                  </>
                ) : null}

                {uf.sidechain && showHomeOperatorLinks ? (
                  <>
                    <Header as="h5" dividing>Shared treasury (multisig)</Header>
                    <div style={{ marginBottom: '0.75em', color: '#555', fontSize: '0.95em' }}>
                      Set up co-signers on <Link to="/federations">Federations</Link>, then use{' '}
                      <Link to="/services/bitcoin/transactions?scope=wallet#fabric-federation-wallet-panel">Wallet</Link>{' '}
                      for the vault address, withdrawal PSBTs, and optional federation notes on hub sends.
                    </div>
                  </>
                ) : null}

                {uf.peers && hasHubAdminForPeers && showHomeOperatorLinks ? (
                  <>
                    <Header as="h5" dividing>Browser mesh (WebRTC)</Header>
                    <p style={{ margin: '0 0 0.5em 0', color: '#666', fontSize: '0.9em' }}>
                      Register your offer, discover peers, or dial by signaling id.
                      {meshStatus && Number(meshStatus.connected) > 0
                        ? ` Connected: ${meshStatus.connected}.`
                        : ''}{' '}
                      Ping, disconnect-all, and chat-routing options are on <Link to="/peers">Peers</Link>.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em' }}>
                      {typeof onRepublishWebRTCOffer === 'function' && (
                        <Button
                          size='small'
                          primary
                          onClick={() => {
                            try {
                              onRepublishWebRTCOffer();
                            } catch (e) {}
                          }}
                          title='Publish or republish your WebRTC offer to the signaling server'
                        >
                          <Icon name='broadcast tower' />
                          Publish Offer
                        </Button>
                      )}
                      {typeof onDiscoverWebRTCPeers === 'function' && (
                        <Button
                          size='small'
                          basic
                          onClick={() => {
                            try {
                              onDiscoverWebRTCPeers();
                            } catch (e) {}
                          }}
                          title='Discover WebRTC mesh peers now'
                        >
                          <Icon name='search' />
                          Discover Peers
                        </Button>
                      )}
                      {typeof onConnectWebRTCPeer === 'function' && (
                        <Button
                          size='small'
                          basic
                          onClick={() => this._openConnectModal()}
                          title='Manually connect to a specific WebRTC peer by ID'
                        >
                          <Icon name='plug' />
                          Connect to ID…
                        </Button>
                      )}
                    </div>
                  </>
                ) : null}

                {bitcoin && bitcoin.available === false && bitcoin.message ? (
                  <Message warning size="small" style={{ marginTop: '1em' }}>
                    <Message.Header>Bitcoin</Message.Header>
                    <p style={{ margin: '0.35em 0 0 0' }}>{String(bitcoin.message)}</p>
                  </Message>
                ) : null}
              </Card.Description>
            </Card.Content>
          </Card>
        )}
        {networkStatus ? (
          <Segment
            role="region"
            style={{ marginTop: '1.25em' }}
            aria-labelledby="home-global-chat-heading"
          >
            <Header as="h2" id="home-global-chat-heading" style={{ marginTop: 0 }}>
              Global chat
            </Header>
            <p style={{ color: '#666', marginTop: '-0.25em', marginBottom: '0.75em' }}>
              {uf.activities ? (
                <>
                  <Link to="/notifications">Notifications</Link>
                  {' · '}
                  <Link to="/activities">Activity log</Link>
                </>
              ) : null}
              {uf.activities ? ' · ' : ''}
              <Link to="/settings/security">Delegation &amp; signing</Link>
            </p>
            <div style={{ minHeight: '12rem' }}>
              <ActivityStream
                bridge={ref}
                bridgeRef={ref}
                adminToken={adminToken}
                identity={auth}
                onRequireUnlock={onRequireUnlock}
                includeHeader={false}
                entryTypeFilter="chat"
              />
            </div>
          </Segment>
        ) : null}
        <Modal open={this.state.connectModalOpen} size="tiny" onClose={this._closeConnectModal} closeOnEscape closeOnDimmerClick>
          <Modal.Header>Connect to WebRTC peer</Modal.Header>
          <Modal.Content>
            <Form onSubmit={(e) => { e.preventDefault(); this._submitConnectPeerId(); }}>
              <Form.Field>
                <label htmlFor="home-webrtc-peer-id">Peer ID</label>
                <Input
                  id="home-webrtc-peer-id"
                  placeholder="fabric-bridge-…"
                  value={this.state.connectPeerIdDraft}
                  onChange={(e) => this.setState({ connectPeerIdDraft: e.target.value })}
                />
              </Form.Field>
            </Form>
          </Modal.Content>
          <Modal.Actions>
            <Button type="button" onClick={this._closeConnectModal}>Cancel</Button>
            <Button type="button" primary onClick={this._submitConnectPeerId}>
              <Icon name="plug" />
              Connect
            </Button>
          </Modal.Actions>
        </Modal>
      </fabric-hub-home>
    );
  }
}

function HomeWithLocation (props) {
  const location = useLocation();
  /** Same payload Bridge puts in state — avoids reading ref before React commits Bridge. */
  const [networkStatusFromEvent, setNetworkStatusFromEvent] = React.useState(null);

  React.useEffect(() => {
    const seed = () => {
      const inst = props.bridgeRef && props.bridgeRef.current;
      const n = inst && inst.networkStatus;
      if (isHubNetworkStatusShape(n)) setNetworkStatusFromEvent(n);
    };
    seed();
    const t = setTimeout(seed, 0);
    return () => clearTimeout(t);
  }, []);

  React.useEffect(() => {
    const onNs = (e) => {
      const n = e.detail && e.detail.networkStatus;
      setNetworkStatusFromEvent(n && typeof n === 'object' && isHubNetworkStatusShape(n) ? n : null);
    };
    window.addEventListener('networkStatusUpdate', onNs);
    return () => window.removeEventListener('networkStatusUpdate', onNs);
  }, []);

  React.useLayoutEffect(() => {
    scrollToHashElement(location.hash);
  }, [location.pathname, location.hash]);
  return <Home {...props} location={location} networkStatusFromEvent={networkStatusFromEvent} />;
}

module.exports = HomeWithLocation;
