'use strict';

// Dependencies
const React = require('react');
const { useLocation, Link } = require('react-router-dom');

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

const ActivityStream = require('./ActivityStream');

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
      onRequireUnlock
    } = this.props;
    // Prefer the live Bridge ref; fall back to legacy `bridge` prop.
    const ref = bridgeRef || bridge;
    const current = ref && ref.current;
    const candidate = current && current.networkStatus;
    const fallback = current && current.lastNetworkStatus;
    const isNetworkStatus = (obj) => !!(obj && typeof obj === 'object' && (obj.network || Array.isArray(obj.peers)));
    const networkStatus = isNetworkStatus(candidate) ? candidate : (isNetworkStatus(fallback) ? fallback : null);
    const network = networkStatus && networkStatus.network;
    const peers = Array.isArray(networkStatus && networkStatus.peers) ? networkStatus.peers : [];
    const webrtcPeers = Array.isArray(networkStatus && networkStatus.webrtcPeers) ? networkStatus.webrtcPeers : [];
    const state = networkStatus && networkStatus.state;
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
                  {network && network.address ? (
                    <div style={{ marginBottom: '1em' }}>
                      <strong>Address:</strong> {network.address}
                    </div>
                  ) : null}
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
                      <strong>Bridge Peers:</strong> {peers.length}{' '}
                      <span style={{ color: '#777' }}>·</span>{' '}
                      <strong>WebRTC Peers:</strong> {webrtcPeers.length}{' '}
                      <span style={{ color: '#777' }}>·</span>{' '}
                      <strong>Documents:</strong> {published.length}
                    </div>
                  </div>
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
                </Card.Description>
              </>
            ) : (
              <Segment basic>
                <Segment
                  placeholder
                  style={{ minHeight: '30vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <div>
                    <Loader active inline="centered" size="large" />
                    <Header as='h4' style={{ marginTop: '1em', textAlign: 'center' }}>
                      Loading network status…
                      <Header.Subheader>
                        Connecting to hub and fetching peers.
                      </Header.Subheader>
                    </Header>
                  </div>
                </Segment>
              </Segment>
            )}
          </Card.Content>
        </Card>
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
          <Header as='h2'>Activity</Header>
          <ActivityStream
            bridge={ref}
            bridgeRef={ref}
            onRequireUnlock={onRequireUnlock}
          />
        </Segment>
      </fabric-hub-home>
    );
  }
}

function HomeWithLocation (props) {
  const location = useLocation();
  return <Home {...props} location={location} />;
}

module.exports = HomeWithLocation;
