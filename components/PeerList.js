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
  Segment
} = require('semantic-ui-react');

class PeersPage extends React.Component {
  render () {
    const { bridge, onAddPeer, onRefreshPeers, onDisconnectPeer, onSendPeerMessage, onSetPeerNickname } = this.props;
    const current = bridge && bridge.current;
    const candidate = current && current.networkStatus;
    const fallback = current && current.lastNetworkStatus;
    const isNetworkStatus = (obj) => !!(obj && typeof obj === 'object' && (obj.network || Array.isArray(obj.peers)));
    const networkStatus = isNetworkStatus(candidate) ? candidate : (isNetworkStatus(fallback) ? fallback : null);
    const network = networkStatus && networkStatus.network;
    const peers = Array.isArray(networkStatus && networkStatus.peers) ? networkStatus.peers : [];
    const state = networkStatus && networkStatus.state;
    const isOnline = !!networkStatus;

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
                  Network{' '}
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75em', flexWrap: 'wrap' }}>
                    <div>
                      <strong>Peers:</strong> {peers.length}
                    </div>
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
                  </div>

                  {peers.length > 0 && (
                    <List size='small' divided relaxed>
                      {peers.map((peer, idx) => {
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
                </Card.Description>
              </Card.Content>
            </Card>
          ) : (
            <p>Loading network status...</p>
          )}
      </fabric-hub-peers>
    );
  }
}

function PeersPageWithLocation (props) {
  const location = useLocation();
  return <PeersPage {...props} location={location} />;
}

module.exports = PeersPageWithLocation;
