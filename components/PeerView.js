'use strict';

// Dependencies
const React = require('react');
const {
  Link,
  useNavigate,
  useParams
} = require('react-router-dom');

const {
  Button,
  Card,
  Divider,
  Header,
  Icon,
  Label,
  List,
  Segment
} = require('semantic-ui-react');

function isNetworkStatus (obj) {
  return !!(obj && typeof obj === 'object' && (obj.network || Array.isArray(obj.peers)));
}

function formatMaybeDate (value) {
  try {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  } catch (e) {
    return String(value);
  }
}

function PeerDetail (props) {
  const navigate = useNavigate();
  const params = useParams();
  const encoded = params && params.address ? params.address : '';
  const address = encoded ? decodeURIComponent(encoded) : '';
  const [detail, setDetail] = React.useState(null);
  const [peerChats, setPeerChats] = React.useState([]);
  const [outgoingText, setOutgoingText] = React.useState('');

  const bridge = props.bridge;
  const current = bridge && bridge.current;
  const candidate = current && current.networkStatus;
  const fallback = current && current.lastNetworkStatus;
  const networkStatus = isNetworkStatus(candidate) ? candidate : (isNetworkStatus(fallback) ? fallback : null);
  const peers = Array.isArray(networkStatus && networkStatus.peers) ? networkStatus.peers : [];

  const peerFromStatus = peers.find((p) => p && (p.address === address || p.id === address)) || null;
  const peer = detail && detail.address ? detail : peerFromStatus;
  const status = peer && peer.status ? peer.status : 'unknown';
  const isConnected = status === 'connected';

  React.useEffect(() => {
    if (typeof props.onRefreshPeers === 'function') props.onRefreshPeers();
    if (typeof props.onGetPeer === 'function' && address) props.onGetPeer(address);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  React.useEffect(() => {
    const handler = (event) => {
      try {
        const globalState = event && event.detail && event.detail.globalState;
        if (!globalState) return;

        // Update peer detail from global state, if available
        if (globalState.peers) {
          const stored = globalState.peers[address];
          if (stored) setDetail(stored);
        }

        // Derive chats for this peer from global messages
        if (globalState.messages) {
          const messages = globalState.messages || {};
          const peersByAddress = globalState.peers || {};
          const storedPeer = peersByAddress[address];
          const peerId = (storedPeer && storedPeer.id) || (detail && detail.id) || address;

          const chats = Object.values(messages)
            .filter((m) => m && typeof m === 'object' && m.type === 'P2P_CHAT_MESSAGE')
            .filter((m) => {
              const actorId = m.actor && m.actor.id;
              const target = m.object && m.object.target;
              // Messages from this peer, or messages explicitly targeted to this peer address
              return (actorId && peerId && actorId === peerId) || (target && target === address);
            })
            .sort((a, b) => {
              const ta = (a.object && a.object.created) || 0;
              const tb = (b.object && b.object.created) || 0;
              return ta - tb;
            })
            .slice(-100);

          setPeerChats(chats);
        }
      } catch (e) {}
    };
    window.addEventListener('globalStateUpdate', handler);
    return () => window.removeEventListener('globalStateUpdate', handler);
  }, [address]);

  const title = (peer && (peer.nickname || peer.alias || peer.id || peer.address)) || address || 'Peer';

  const handleSendPeerChat = (event) => {
    event.preventDefault();
    const text = (outgoingText || '').trim();
    if (!text) return;
    if (address && typeof props.onSendPeerMessage === 'function') {
      props.onSendPeerMessage(address, text);
      setOutgoingText('');
    }
  };

  return (
    <fabric-peer-detail class='fade-in'>
      <Segment>
        <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
          <Button
            basic
            size='small'
            as={Link}
            to="/peers"
            title="Back to peers"
          >
            <Icon name="arrow left" />
            Back
          </Button>
          <span>{title}</span>
          <Label
            size='small'
            color={isConnected ? 'green' : 'grey'}
            title={status}
          >
            {isConnected ? (
              <><Icon name='check circle' /> Connected</>
            ) : (
              <><Icon name='minus circle' /> Disconnected</>
            )}
          </Label>
        </Header>

        <Divider />

        <Card fluid>
          <Card.Content>
            <Card.Header>Peer Details</Card.Header>
            <Card.Description>
              <List divided relaxed size="small">
                <List.Item>
                  <List.Content>
                    <List.Header>Address</List.Header>
                    <List.Description>{address || (peer && peer.address) || 'unknown'}</List.Description>
                  </List.Content>
                </List.Item>
                <List.Item>
                  <List.Content>
                    <List.Header>ID</List.Header>
                    <List.Description>{(peer && peer.id) || 'unknown'}</List.Description>
                  </List.Content>
                </List.Item>
                <List.Item>
                  <List.Content>
                    <List.Header>Nickname (node-local)</List.Header>
                    <List.Description>{(peer && peer.nickname) || ''}</List.Description>
                  </List.Content>
                </List.Item>
                <List.Item>
                  <List.Content>
                    <List.Header>Alias (peer-provided)</List.Header>
                    <List.Description>{(peer && peer.alias) || ''}</List.Description>
                  </List.Content>
                </List.Item>
                <List.Item>
                  <List.Content>
                    <List.Header>Score</List.Header>
                    <List.Description>{peer && peer.score != null ? String(peer.score) : ''}</List.Description>
                  </List.Content>
                </List.Item>
                <List.Item>
                  <List.Content>
                    <List.Header>First seen</List.Header>
                    <List.Description>{formatMaybeDate(peer && peer.firstSeen)}</List.Description>
                  </List.Content>
                </List.Item>
                <List.Item>
                  <List.Content>
                    <List.Header>Last seen</List.Header>
                    <List.Description>{formatMaybeDate(peer && (peer.lastSeen || peer.lastMessage))}</List.Description>
                  </List.Content>
                </List.Item>
                {peer && peer.connection && (
                  <List.Item>
                    <List.Content>
                      <List.Header>Connection</List.Header>
                      <List.Description>
                        {peer.connection.remoteAddress ? `${peer.connection.remoteAddress}:${peer.connection.remotePort || ''}` : 'connected'}
                        {peer.connection.lastMessage ? ` — last message: ${formatMaybeDate(peer.connection.lastMessage)}` : ''}
                        {peer.connection.failureCount != null ? ` — failures: ${peer.connection.failureCount}` : ''}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                )}
              </List>
            </Card.Description>
          </Card.Content>
          <Card.Content extra>
            <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button
                size="small"
                icon
                labelPosition="left"
                onClick={() => typeof props.onRefreshPeers === 'function' && props.onRefreshPeers()}
                title="Refresh peer info"
              >
                <Icon name="refresh" />
                Refresh
              </Button>

              {address && !isConnected && typeof props.onAddPeer === 'function' && (
                <Button
                  size="small"
                  onClick={() => props.onAddPeer({ address })}
                  title={`Reconnect to ${address}`}
                >
                  <Icon name="refresh" />
                  Reconnect
                </Button>
              )}

              {address && isConnected && typeof props.onDisconnectPeer === 'function' && (
                <Button
                  size="small"
                  color="red"
                  basic
                  onClick={() => props.onDisconnectPeer(address)}
                  title={`Disconnect ${address}`}
                >
                  <Icon name="remove" />
                  Disconnect
                </Button>
              )}

              {address && isConnected && typeof props.onSendPeerMessage === 'function' && (
                <Button
                  size="small"
                  onClick={() => {
                    const text = window.prompt('Message to send:', '');
                    if (text != null && text !== '') props.onSendPeerMessage(address, text);
                  }}
                  title={`Send message to ${address}`}
                >
                  <Icon name="send" />
                  Send message
                </Button>
              )}

              {address && typeof props.onSetPeerNickname === 'function' && (
                <Button
                  size="small"
                  basic
                  onClick={() => {
                    const currentNick = (peer && peer.nickname) || '';
                    const value = window.prompt(`Node-local nickname for ${address}:`, currentNick);
                    if (value == null) return;
                    props.onSetPeerNickname(address, value);
                  }}
                  title={`Set node-local nickname for ${address}`}
                >
                  <Icon name="tag" />
                  Set nickname
                </Button>
              )}

              <Button
                size="small"
                basic
                onClick={() => navigate('/peers')}
                title="Back to list"
              >
                <Icon name="list" />
                List
              </Button>
            </div>
          </Card.Content>
        </Card>

        {!peer && (
          <Segment secondary style={{ marginTop: '1em' }}>
            <Header as="h4">Peer not found</Header>
            <p>
              This peer isn’t in the current `knownPeers` list yet. Try refreshing, or add it by address.
            </p>
          </Segment>
        )}
        {peer && (
          <Segment style={{ marginTop: '1em' }}>
            <Header as="h3">Chat</Header>
            {peerChats.length > 0 ? (
              <List divided relaxed size="small">
                {peerChats.map((chat, index) => {
                  const created = (chat.object && chat.object.created) || Date.now();
                  const actor = (chat.actor && (chat.actor.username || chat.actor.id)) || 'unknown';
                  const content = (chat.object && (chat.object.content || chat.object.text)) || '';
                  const isPending = chat.status === 'pending';
                  const isQueued = chat.status === 'queued';
                  const style = {
                    opacity: (isPending || isQueued) ? 0.7 : 1,
                    color: isQueued ? '#888' : undefined
                  };
                  return (
                    <List.Item key={`${created}-${index}`}>
                      <List.Content>
                        <List.Header>
                          <span style={style}>
                            @{actor}
                            {isPending && ' (sending…)'}
                            {isQueued && (
                              <Icon
                                name="exclamation circle"
                                color="grey"
                                style={{ marginLeft: '0.35em' }}
                                title="This message will be sent when the peer is online."
                              />
                            )}
                          </span>
                        </List.Header>
                        <List.Description style={style}>
                          {content}
                        </List.Description>
                      </List.Content>
                    </List.Item>
                  );
                })}
              </List>
            ) : (
              <p style={{ color: '#666' }}>No chat messages yet for this peer.</p>
            )}
            {address && typeof props.onSendPeerMessage === 'function' && (
              <form
                onSubmit={handleSendPeerChat}
                style={{ marginTop: '0.75em', display: 'flex', gap: '0.5em', alignItems: 'center' }}
              >
                <input
                  type="text"
                  placeholder="Type a message…"
                  value={outgoingText}
                  onChange={(e) => setOutgoingText(e.target.value)}
                  style={{ flex: 1, padding: '0.4em 0.6em', borderRadius: '4px', border: '1px solid rgba(34,36,38,.15)' }}
                />
                <Button
                  size="small"
                  primary
                  type="submit"
                  disabled={!outgoingText || !outgoingText.trim()}
                  title={`Send message to ${address} (queued if offline)`}
                >
                  <Icon name="send" />
                  Send
                </Button>
              </form>
            )}
          </Segment>
        )}
      </Segment>
    </fabric-peer-detail>
  );
}

module.exports = PeerDetail;
