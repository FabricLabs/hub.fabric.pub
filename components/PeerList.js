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

class PeersPage extends React.Component {
  componentDidMount () {
    if (typeof this.props.onRefreshPeers === 'function') {
      this.props.onRefreshPeers();
    }

    // Keep peer status fresh while the page is open so the list does not
    // oscillate between stale/empty snapshots.
    this._refreshTimer = setInterval(() => {
      if (typeof this.props.onRefreshPeers === 'function') {
        this.props.onRefreshPeers();
      }
    }, 4000);
  }

  componentWillUnmount () {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  render () {
    const {
      auth,
      bridge,
      bridgeRef,
      onAddPeer,
      onRefreshPeers,
      onDisconnectPeer,
      onSendPeerMessage,
      onSetPeerNickname,
      onDiscoverWebRTCPeers,
      onRepublishWebRTCOffer,
      onConnectWebRTCPeer,
      onDisconnectWebRTCPeer,
      onDisconnectAllWebRTCPeers,
      onSendWebRTCTestPing
    } = this.props;
    const isLoggedIn = !!(auth && auth.id && auth.xpub);
    const activeBridgeRef = bridgeRef || bridge;
    const current = activeBridgeRef && activeBridgeRef.current;
    const candidate = current && current.networkStatus;
    const fallback = current && current.lastNetworkStatus;
    const isNetworkStatus = (obj) => !!(obj && typeof obj === 'object' && (obj.network || Array.isArray(obj.peers)));
    const networkStatus = isNetworkStatus(candidate) ? candidate : (isNetworkStatus(fallback) ? fallback : null);
    const network = networkStatus && networkStatus.network;
    const peers = Array.isArray(networkStatus && networkStatus.peers) ? networkStatus.peers : [];
    const state = networkStatus && networkStatus.state;
    const isOnline = !!networkStatus;
    const peerId = networkStatus && networkStatus.contract ? String(networkStatus.contract) : null;
    const hostPort = network && network.address ? String(network.address) : null;
    const shareableString = [peerId, hostPort].filter(Boolean).join('\n');

    // WebRTC peers currently registered with the hub signaling RPC
    const webrtcPeers = Array.isArray(networkStatus && networkStatus.webrtcPeers) ? networkStatus.webrtcPeers : [];

    // Defensive separation: keep Fabric network peers in the standard list even
    // if signaling peers accidentally appear in `networkStatus.peers`.
    const fabricPeers = peers.filter((peer) => {
      if (!peer || typeof peer !== 'object') return false;
      const id = String(peer.id || '');
      const address = String(peer.address || '');
      const hasWebRTCMetadata = !!(peer.metadata && Array.isArray(peer.metadata.capabilities));
      if (id.startsWith('fabric-bridge-') || address.startsWith('fabric-bridge-')) return false;
      if (hasWebRTCMetadata && peer.status === 'registered') return false;
      return true;
    });

    // Local browser WebRTC connections (browser-to-browser)
    const localWebrtcPeers = (current && typeof current.localWebrtcPeers !== 'undefined')
      ? current.localWebrtcPeers
      : [];

    // WebRTC mesh status
    const meshStatus = (current && typeof current.webrtcMeshStatus !== 'undefined')
      ? current.webrtcMeshStatus
      : null;

    return (
      <fabric-hub-peers class='fade-in'>
        <Segment style={{ clear: 'both' }}>
          <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
            <Button basic size='small' as={Link} to="/" title="Back">
              <Icon name="arrow left" />
              Back
            </Button>
            <code>Peers</code>
          </Header>
          <p>full peer list and controls</p>
        </Segment>

          {networkStatus ? (
            <Card fluid>
              <Card.Content>
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
                  {(peerId || hostPort) && (
                    <div style={{ marginBottom: '1em', padding: '0.75em', background: 'rgba(0,0,0,0.03)', borderRadius: '4px' }}>
                      <Header as='h5' style={{ margin: '0 0 0.5em 0' }}>Share with other peers</Header>
                      {peerId && (
                        <div style={{ marginBottom: '0.5em' }}>
                          <strong>Peer ID:</strong>{' '}
                          <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{peerId}</code>
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
                          title='Copy peer ID and address'
                        >
                          <Icon name='copy' />
                          Copy to clipboard
                        </Button>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75em', flexWrap: 'wrap' }}>
                    <div>
                      <Label size='tiny' basic color='green' style={{ marginRight: '0.5em' }}>
                        Fabric Network
                      </Label>
                      <strong>Peers:</strong> {fabricPeers.length}
                    </div>
                    {isLoggedIn && (
                      <Button.Group size='small'>
                        {typeof onRefreshPeers === 'function' && (
                          <Button icon labelPosition='left' onClick={onRefreshPeers} title='Refresh peer list'>
                            <Icon name='refresh' />
                            Refresh
                          </Button>
                        )}
                        <Button
                          primary
                          onClick={() => {
                            const address = window.prompt('Enter peer address (host:port or host):');
                            if (!address || typeof onAddPeer !== 'function') return;
                            const normalized = address.includes(':') ? address : `${address}:7777`;
                            onAddPeer({ address: normalized });
                          }}
                        >
                          <Icon name='add' />
                          Add Peer
                        </Button>
                      </Button.Group>
                    )}
                  </div>

                  {fabricPeers.length > 0 && (
                    <List size='small' divided relaxed>
                      {fabricPeers.map((peer, idx) => {
                        const id = peer && (peer.id || peer.address || peer.pubkey || `peer-${idx}`);
                        const address = peer && (peer.address || peer.host || peer.url);
                        const status = (peer && peer.status) || 'unknown';
                        const isConnected = status === 'connected';
                        const score = peer && (peer.score != null ? peer.score : null);
                        const alias = peer && peer.alias;
                        const nickname = peer && peer.nickname;
                        const lastSeen = peer && (peer.lastSeen || peer.lastMessage);
                        const primary = nickname || alias || id;
                        return (
                          <List.Item as={Link} to={`/peers/${encodeURIComponent(id)}`} key={id || idx}>
                            <List.Content>
                              <List.Header style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                                {primary}
                                {(nickname && (alias || id)) ? (
                                  <span style={{ fontSize: '0.85em', color: '#666' }}>
                                    {alias ? ` (${alias})` : ` (${id})`}
                                  </span>
                                ) : null}
                                <Label size='tiny' color={isConnected ? 'green' : 'grey'} horizontal title={status}>
                                  {isConnected ? (
                                    <><Icon name='check circle' /> Connected</>
                                  ) : (
                                    <><Icon name='minus circle' /> Disconnected</>
                                  )}
                                </Label>
                                {score != null && (
                                  <Label size='tiny' horizontal title='Ranking score'>
                                    <Icon name='star' /> {score}
                                  </Label>
                                )}
                              </List.Header>
                              {address && <List.Description>{address}</List.Description>}
                              {lastSeen && (
                                <List.Description style={{ fontSize: '0.85em', color: '#666' }}>
                                  Last seen: {new Date(lastSeen).toLocaleString()}
                                </List.Description>
                              )}
                            </List.Content>
                          </List.Item>
                        );
                      })}
                    </List>
                  )}
                  {fabricPeers.length === 0 && (
                    <p style={{ color: '#666', fontStyle: 'italic', marginTop: '0.75em' }}>
                      No Fabric network peers in the standard peer list.
                    </p>
                  )}
                </Card.Description>
              </Card.Content>
            </Card>
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

          {/* WebRTC Peers Section */}
          <Card fluid style={{ marginTop: '1em' }}>
            <Card.Content>
              <Card.Header>
                <Icon name='video' />
                WebRTC Peers{' '}
                <Label size='small' color={webrtcPeers.length > 0 ? 'blue' : 'grey'}>
                  {webrtcPeers.length} via signaling
                </Label>
                {localWebrtcPeers.length > 0 && (
                  <Label size='small' color='teal' style={{ marginLeft: '0.5em' }}>
                    {localWebrtcPeers.length} mesh
                  </Label>
                )}
              </Card.Header>
              <Card.Meta>
                {meshStatus ? (
                  <div style={{ display: 'flex', gap: '1em', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span>
                      <strong>Your ID:</strong> <code style={{ fontSize: '0.85em' }}>{meshStatus.peerId || 'initializing...'}</code>
                    </span>
                    <span>
                      <strong>Status:</strong> {meshStatus.ready ? 'Ready' : 'Initializing'}
                    </span>
                    <span>
                      <strong>Mesh:</strong> {meshStatus.connected}/{meshStatus.maxPeers} connected
                      {meshStatus.connecting > 0 && `, ${meshStatus.connecting} connecting`}
                    </span>
                  </div>
                ) : (
                  <span>Peers connected via native WebRTC signaling.</span>
                )}
              </Card.Meta>
              <Card.Description>
                <div style={{ marginBottom: '1em', display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                  {typeof onRepublishWebRTCOffer === 'function' && (
                    <Button
                      size='small'
                      basic
                      onClick={onRepublishWebRTCOffer}
                      title='Republish your peer offer to the signaling server'
                    >
                      <Icon name='refresh' />
                      Republish Offer
                    </Button>
                  )}
                  {meshStatus && meshStatus.slotsAvailable > 0 && typeof onDiscoverWebRTCPeers === 'function' && (
                    <>
                      <Button
                        size='small'
                        primary
                        onClick={onDiscoverWebRTCPeers}
                        title={`Discover and connect to WebRTC peers (${meshStatus.slotsAvailable} slots available)`}
                      >
                        <Icon name='search' />
                        Discover Peers
                      </Button>
                      <span style={{ color: '#666', fontSize: '0.9em' }}>
                        {meshStatus.slotsAvailable} slot{meshStatus.slotsAvailable !== 1 ? 's' : ''} available
                      </span>
                    </>
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
                  {localWebrtcPeers.length > 0 && typeof onDisconnectAllWebRTCPeers === 'function' && (
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
                </div>
                {webrtcPeers.length === 0 && localWebrtcPeers.length === 0 ? (
                  <p style={{ color: '#666', fontStyle: 'italic' }}>
                    No WebRTC peers connected yet. Peers will appear here when browsers register with hub signaling and establish mesh channels.
                  </p>
                ) : (
                  <>
                    {webrtcPeers.length > 0 && (
                      <>
                        <div style={{ marginBottom: '0.5em' }}>
                          <Label size='tiny' basic color='blue'>
                            Hub Signaling Peers
                          </Label>
                        </div>
                        <List size='small' divided relaxed>
                          {webrtcPeers.map((peer, idx) => {
                            const id = peer && (peer.id || `webrtc-${idx}`);
                            const status = (peer && peer.status) || 'connected';
                            const isConnected = status === 'connected';
                            const connectedAt = peer && peer.connectedAt;
                            return (
                              <List.Item as={Link} to={`/peers/${encodeURIComponent(id)}`} key={id}>
                                <List.Icon name='wifi' color={isConnected ? 'green' : 'grey'} verticalAlign='middle' />
                                <List.Content>
                                  <List.Header style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                                    <code style={{ fontSize: '0.9em' }}>{id}</code>
                                    <Label size='tiny' color={isConnected ? 'green' : 'grey'} horizontal>
                                      {isConnected ? (
                                        <><Icon name='check circle' /> Connected</>
                                      ) : (
                                        <><Icon name='minus circle' /> {status}</>
                                      )}
                                    </Label>
                                  </List.Header>
                                  {connectedAt && (
                                    <List.Description style={{ fontSize: '0.85em', color: '#666' }}>
                                      Connected: {new Date(connectedAt).toLocaleString()}
                                    </List.Description>
                                  )}
                                </List.Content>
                              </List.Item>
                            );
                          })}
                        </List>
                      </>
                    )}

                    {localWebrtcPeers.length > 0 && (
                      <>
                        <div style={{ marginTop: webrtcPeers.length > 0 ? '1em' : 0, marginBottom: '0.5em' }}>
                          <Label size='tiny' basic color='teal'>
                            Local Browser Connections
                          </Label>
                        </div>
                        <List size='small' divided relaxed>
                          {localWebrtcPeers.map((peer, idx) => {
                            const id = peer && (peer.id || `local-${idx}`);
                            const status = (peer && peer.status) || 'unknown';
                            const isConnected = status === 'connected';
                            const direction = peer && peer.direction;
                            const connectedAt = peer && peer.connectedAt;
                            return (
                              <List.Item as={Link} to={`/peers/${encodeURIComponent(id)}`} key={id}>
                                <List.Icon
                                  name={direction === 'inbound' ? 'arrow down' : 'arrow up'}
                                  color={isConnected ? 'teal' : 'grey'}
                                  verticalAlign='middle'
                                  title={direction === 'inbound' ? 'Inbound connection' : 'Outbound connection'}
                                />
                                <List.Content>
                                  <List.Header style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                                    <code style={{ fontSize: '0.9em' }}>{id}</code>
                                    <Label size='tiny' color={isConnected ? 'teal' : 'grey'} horizontal>
                                      {isConnected ? (
                                        <><Icon name='check circle' /> Connected</>
                                      ) : (
                                        <><Icon name='minus circle' /> {status}</>
                                      )}
                                    </Label>
                                    {direction && (
                                      <Label size='tiny' basic horizontal title={`${direction} connection`}>
                                        {direction === 'inbound' ? 'Inbound' : 'Outbound'}
                                      </Label>
                                    )}
                                    {typeof onDisconnectWebRTCPeer === 'function' && (
                                      <Button
                                        size='mini'
                                        basic
                                        color='red'
                                        icon
                                        title='Disconnect this WebRTC peer'
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          try {
                                            onDisconnectWebRTCPeer(id);
                                          } catch (e) {}
                                        }}
                                      >
                                        <Icon name='unlink' />
                                      </Button>
                                    )}
                                  </List.Header>
                                  {connectedAt && (
                                    <List.Description style={{ fontSize: '0.85em', color: '#666' }}>
                                      Connected: {new Date(connectedAt).toLocaleString()}
                                    </List.Description>
                                  )}
                                  {peer.error && (
                                    <List.Description style={{ fontSize: '0.85em', color: '#b00' }}>
                                      Error: {peer.error}
                                    </List.Description>
                                  )}
                                </List.Content>
                              </List.Item>
                            );
                          })}
                        </List>
                      </>
                    )}
                  </>
                )}
              </Card.Description>
            </Card.Content>
          </Card>
      </fabric-hub-peers>
    );
  }
}

function PeersPageWithLocation (props) {
  const location = useLocation();
  return <PeersPage {...props} location={location} />;
}

module.exports = PeersPageWithLocation;
