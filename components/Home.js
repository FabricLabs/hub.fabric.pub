'use strict';

// Dependencies
const React = require('react');
const { useLocation } = require('react-router-dom');

const {
  Card,
  Header,
  Segment,
  Label,
  List
} = require('semantic-ui-react');

const ActivityStream = require('./ActivityStream');

class Home extends React.Component {
  render () {
    const { bridge, onAddPeer } = this.props;
    const networkStatus = bridge && bridge.current && bridge.current.networkStatus;
    const network = networkStatus && networkStatus.network;
    const peers = Array.isArray(networkStatus && networkStatus.peers) ? networkStatus.peers : [];
    const state = networkStatus && networkStatus.state;
    const isOnline = !!networkStatus;
    return (
      <fabric-hub-home class='fade-in'>
        <Segment style={{ clear: 'both' }}>
          <Header as='h1'><code>hub.fabric.pub</code></Header>
          <p>all things fabric</p>
        </Segment>
        <Segment>
          <Header as='h2'>Network Overview</Header>
          {networkStatus ? (
            <Card fluid>
              <Card.Content>
                <Card.Header>
                  Network Overview{' '}
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
                      <strong>Peers:</strong> {peers.length}
                    </div>
                    <button
                      className='ui button primary'
                      type='button'
                      onClick={() => {
                        const address = window.prompt('Enter peer address (e.g. ws://host:port):');
                        if (!address || typeof onAddPeer !== 'function') return;
                        onAddPeer({ address });
                      }}
                    >
                      Add Peer
                    </button>
                  </div>
                  {peers.length > 0 && (
                    <List size='small' divided relaxed>
                      {peers.map((peer, idx) => {
                        const id = peer && (peer.id || peer.address || peer.pubkey || `peer-${idx}`);
                        const address = peer && (peer.address || peer.host || peer.url);
                        return (
                          <List.Item key={id || idx}>
                            <List.Content>
                              <List.Header>{id}</List.Header>
                              {address && <List.Description>{address}</List.Description>}
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
        </Segment>
        <Segment>
          <Header as='h2'>Activity</Header>
          <ActivityStream />
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
