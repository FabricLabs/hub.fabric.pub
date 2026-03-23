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
  Header,
  Icon,
  Label,
  List,
  Loader,
  Segment
} = require('semantic-ui-react');

const NotificationsStream = require('./NotificationsStream');
const { isHubNetworkStatusShape } = require('../functions/hubNetworkStatus');
const { loadHubUiFeatureFlags } = require('../functions/hubUiFeatureFlags');

class Home extends React.Component {
  render () {
    const {
      bridge,
      bridgeRef,
      onDiscoverWebRTCPeers,
      onRepublishWebRTCOffer,
      onConnectWebRTCPeer,
      onDisconnectAllWebRTCPeers,
      onSendWebRTCTestPing,
      onToggleWebRTCChatOnly,
      webrtcChatOnly,
      onRequireUnlock,
      adminToken
    } = this.props;
    const uf = loadHubUiFeatureFlags();
    // Prefer the live Bridge ref; fall back to legacy `bridge` prop.
    const ref = bridgeRef || bridge;
    const current = ref && ref.current;
    const candidate = current && current.networkStatus;
    const fallback = current && current.lastNetworkStatus;
    const networkStatus = isHubNetworkStatusShape(candidate)
      ? candidate
      : (isHubNetworkStatusShape(fallback) ? fallback : null);
    const network = networkStatus && networkStatus.network;
    const peers = Array.isArray(networkStatus && networkStatus.peers) ? networkStatus.peers : [];
    const webrtcPeers = Array.isArray(networkStatus && networkStatus.webrtcPeers) ? networkStatus.webrtcPeers : [];
    const state = networkStatus && networkStatus.state;
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
    const published = Object.values(publishedMap)
      .filter((d) => d && d.id)
      .sort((a, b) => {
        const ta = a.published ? new Date(a.published).getTime() : 0;
        const tb = b.published ? new Date(b.published).getTime() : 0;
        return tb - ta;
      });
    return (
      <fabric-hub-home class='fade-in'>
        <Card fluid>
          <Card.Content>
            {networkStatus ? (
              <>
                <Card.Header>
                  Bridge{' '}
                  <Label size='small' color={isOnline ? 'green' : 'grey'}>
                    {isOnline ? 'Online' : 'Offline'}
                  </Label>
                </Card.Header>
                <Card.Meta>
                  <span>
                    <strong>State:</strong> {(state && state.status) || 'unknown'}
                  </span>
                </Card.Meta>
                <Card.Description>
                  {uf.peers && (shareNodeId || hostPort) && (
                    <div style={{ marginBottom: '1em', padding: '0.75em', background: 'rgba(0,0,0,0.03)', borderRadius: '4px' }}>
                      <Header as='h5' style={{ margin: '0 0 0.5em 0' }}>Share with other peers</Header>
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
                          <strong>Address:</strong>{' '}
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
                  <div
                    style={{
                      marginBottom: '0.75em',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75em',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div>
                      {uf.peers ? (
                        <>
                          <strong>Bridge Peers:</strong> {peers.length}{' '}
                          <span style={{ color: '#777' }}>·</span>{' '}
                          <strong>WebRTC Peers:</strong> {webrtcPeers.length}{' '}
                          <span style={{ color: '#777' }}>·</span>{' '}
                        </>
                      ) : null}
                      <strong>Documents:</strong> {published.length}
                    </div>
                  </div>
                  {uf.peers ? (
                  <div
                    style={{
                      marginTop: '0.5em',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5em',
                      flexWrap: 'wrap'
                    }}
                  >
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
                        onClick={() => {
                          try {
                            const input = window.prompt('Enter WebRTC peer ID to connect:');
                            const value = (input || '').trim();
                            if (!value) return;
                            onConnectWebRTCPeer(value);
                          } catch (e) {}
                        }}
                        title='Manually connect to a specific WebRTC peer by ID'
                      >
                        <Icon name='plug' />
                        Connect to ID…
                      </Button>
                    )}
                    {meshStatus && meshStatus.connected > 0 && typeof onSendWebRTCTestPing === 'function' && (
                      <Button
                        size='small'
                        basic
                        onClick={() => {
                          try {
                            onSendWebRTCTestPing();
                          } catch (e) {}
                        }}
                        title='Broadcast a test ping message to all connected WebRTC peers'
                      >
                        <Icon name='signal' />
                        Ping Mesh
                      </Button>
                    )}
                    {meshStatus && meshStatus.connected > 0 && typeof onDisconnectAllWebRTCPeers === 'function' && (
                      <Button
                        size='small'
                        basic
                        color='red'
                        onClick={() => {
                          try {
                            onDisconnectAllWebRTCPeers();
                          } catch (e) {}
                        }}
                        title='Disconnect all local WebRTC mesh peers'
                      >
                        <Icon name='unlink' />
                        Disconnect All
                      </Button>
                    )}
                    {typeof onToggleWebRTCChatOnly === 'function' && (
                      <Button
                        size='small'
                        toggle
                        active={!!webrtcChatOnly}
                        onClick={() => {
                          try {
                            onToggleWebRTCChatOnly(!webrtcChatOnly);
                          } catch (e) {}
                        }}
                        title='Route chat messages over WebRTC only (disable hub + P2P chat)'
                      >
                        <Icon name='comments' />
                        WebRTC chat only
                      </Button>
                    )}
                  </div>
                  ) : null}
                </Card.Description>
              </>
            ) : (
              <Segment basic>
                <Segment
                  placeholder
                  style={{ minHeight: '30vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <div style={{ textAlign: 'center', maxWidth: '28rem' }}>
                    <Loader active inline="centered" size="large" />
                    <Header as='h4' style={{ marginTop: '1em', textAlign: 'center' }}>
                      Loading network status…
                      <Header.Subheader>
                        Connecting to hub and fetching peers.
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
            )}
          </Card.Content>
        </Card>
        <nav aria-label="Hub shortcuts" style={{ marginBottom: '0.5em' }}>
          <Segment basic style={{ marginTop: 0, marginBottom: 0, paddingTop: '0.35em', paddingBottom: '0.35em' }}>
            <span style={{ color: '#666', fontSize: '0.88em', marginRight: '0.35em', verticalAlign: 'middle' }}>Go to:</span>
            {uf.peers ? (
              <Button as={Link} to="/peers" size="tiny" basic style={{ margin: '0.15em' }}>Peers</Button>
            ) : null}
            <Button as={Link} to="/documents" size="tiny" basic style={{ margin: '0.15em' }}>Documents</Button>
            {uf.activities ? (
              <Button as={Link} to="/activities" size="tiny" basic style={{ margin: '0.15em' }}>Activities</Button>
            ) : null}
            <Button as={Link} to="/contracts" size="tiny" basic style={{ margin: '0.15em' }}>Contracts</Button>
            {uf.sidechain ? (
              <Button as={Link} to="/sidechains" size="tiny" basic style={{ margin: '0.15em' }}>Sidechain</Button>
            ) : null}
            {uf.sidechain ? (
              <Button
                as={Link}
                to="/settings/admin/beacon-federation"
                size="tiny"
                basic
                style={{ margin: '0.15em' }}
                title="L1-bound beacon epochs, manifest, federation witnesses"
              >
                Beacon Fed.
              </Button>
            ) : null}
            <Button as={Link} to="/services/bitcoin" size="tiny" basic style={{ margin: '0.15em' }}>Bitcoin</Button>
            <Button as={Link} to="/settings/admin" size="tiny" basic style={{ margin: '0.15em' }}>Admin</Button>
            <Button as={Link} to="/settings" size="tiny" basic style={{ margin: '0.15em' }}>Settings</Button>
            <Button as={Link} to="/settings/security" size="tiny" basic style={{ margin: '0.15em' }}>Security</Button>
            {uf.features ? (
              <Button as={Link} to="/features" size="tiny" basic style={{ margin: '0.15em' }}>Features</Button>
            ) : null}
          </Segment>
        </nav>
        <Segment>
          <Header as='h2'>Library</Header>
          <Card fluid>
            <Card.Content>
              <Card.Description>
                <List divided relaxed>
                  {published.map((doc) => (
                    <List.Item key={doc.id}>
                      <List.Content>
                        <List.Header>
                          <Link to={`/documents/${encodeURIComponent(doc.id)}`}>{doc.name || doc.id}</Link>
                        </List.Header>
                        <List.Description style={{ color: '#666' }}>
                          {doc.mime || 'application/octet-stream'}
                          {doc.size != null ? ` — ${doc.size} bytes` : ''}
                          {doc.published ? ` — published ${new Date(doc.published).toLocaleString()}` : ''}
                        </List.Description>
                      </List.Content>
                    </List.Item>
                  ))}
                  {published.length === 0 && (
                    <List.Item>
                      <List.Content>
                        <List.Description style={{ color: '#666' }}>
                          No published documents yet. Upload a file in <Link to="/documents">Documents</Link> and click Publish.
                        </List.Description>
                      </List.Content>
                    </List.Item>
                  )}
                </List>
              </Card.Description>
            </Card.Content>
            <Card.Content extra>
              <Button basic as={Link} to="/documents" title="View all documents">
                <Icon name="file outline" />
                View all documents
              </Button>
            </Card.Content>
          </Card>
        </Segment>
        <Segment>
          <Header as='h2'>Delegation &amp; signing</Header>
          <p style={{ color: '#666', marginTop: '-0.35em', marginBottom: '0.75em' }}>
            Pending Fabric hub signature requests.
            {uf.activities ? (
              <>
                {' '}Wallet, Payjoin, and other toasts live under{' '}
                <Link to="/activities">Activities</Link> (bell in the top bar).
              </>
            ) : (
              <> Use <Link to="/settings/security">Security</Link> for sessions and delegation.</>
            )}
          </p>
          <NotificationsStream
            bridge={ref}
            bridgeRef={ref}
            adminToken={adminToken}
            onRequireUnlock={onRequireUnlock}
          />
        </Segment>
        {uf.activities ? (
        <Segment>
          <section aria-labelledby="home-activities-heading">
            <Header as='h2' id="home-activities-heading">Activities</Header>
            <p id="home-activities-summary" style={{ color: '#666' }}>
              Full hub message log, chat, blocks, and in-app notifications — open here or use the bell in the top bar.
            </p>
            <Button
              basic
              as={Link}
              to="/activities"
              icon
              labelPosition="left"
              title="View activities"
              aria-describedby="home-activities-summary"
            >
              <Icon name="comments" aria-hidden="true" />
              Open activities
            </Button>
          </section>
        </Segment>
        ) : null}
      </fabric-hub-home>
    );
  }
}

function HomeWithLocation (props) {
  const location = useLocation();
  React.useLayoutEffect(() => {
    scrollToHashElement(location.hash);
  }, [location.pathname, location.hash]);
  return <Home {...props} location={location} />;
}

module.exports = HomeWithLocation;
