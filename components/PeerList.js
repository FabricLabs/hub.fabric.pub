'use strict';

// Dependencies
const React = require('react');
const { useLocation, Link } = require('react-router-dom');

const {
  Button,
  Card,
  Divider,
  Form,
  Header,
  Icon,
  Input,
  Label,
  List,
  Loader,
  Message,
  Modal,
  Segment,
  Statistic
} = require('semantic-ui-react');
const GraphDocumentPreview = require('./GraphDocumentPreview');
const { peerTopologyToDot } = require('../functions/peerTopologyDot');
const { isHubNetworkStatusShape } = require('../functions/hubNetworkStatus');
const {
  normalizeFabricPeerAddress,
  normalizePeerAddressInput,
  dedupeFabricPeers,
  fabricPeerPrimaryLabel,
  buildWebrtcCombinedRows,
  webrtcRowPrimaryLabel,
  extractPeerXpub,
  shortenPublicId
} = require('../functions/peerIdentity');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const { toast } = require('../functions/toast');

/** Default “primary authority” Fabric TCP peer — long-lived hub, high trust, Bitcoin head reference. */
const DEFAULT_PRIMARY_FABRIC_HUB = 'hub.fabric.pub:7777';
const PRIMARY_PEER_STORAGE_KEY = 'fabric.peers.primaryFabricAddress';

function readPrimaryPeerAddress () {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const s = String(window.localStorage.getItem(PRIMARY_PEER_STORAGE_KEY) || '').trim();
      return s || DEFAULT_PRIMARY_FABRIC_HUB;
    }
  } catch (e) {}
  return DEFAULT_PRIMARY_FABRIC_HUB;
}

function writePrimaryPeerAddress (addr) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PRIMARY_PEER_STORAGE_KEY, String(addr || '').trim());
    }
  } catch (e) {}
}

function sortFabricPeersForAuthority (peers, primaryNorm) {
  const arr = [...(peers || [])];
  const pn = String(primaryNorm || '').trim();
  arr.sort((a, b) => {
    const aa = normalizeFabricPeerAddress(a && a.address);
    const ba = normalizeFabricPeerAddress(b && b.address);
    const ap = pn && (aa === pn || String(a && a.address) === pn);
    const bp = pn && (ba === pn || String(b && b.address) === pn);
    if (ap !== bp) return ap ? -1 : 1;
    const sa = Number(a && a.score);
    const sb = Number(b && b.score);
    if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sb - sa;
    if (Number.isFinite(sa) && !Number.isFinite(sb)) return -1;
    if (!Number.isFinite(sa) && Number.isFinite(sb)) return 1;
    return String(aa).localeCompare(String(ba));
  });
  return arr;
}

class PeersPage extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      addPeerModalOpen: false,
      addPeerDraft: '',
      connectPeerModalOpen: false,
      connectPeerIdDraft: ''
    };
  }

  _openAddPeerModal = () => {
    this.setState({ addPeerModalOpen: true, addPeerDraft: '' });
  };

  _closeAddPeerModal = () => {
    this.setState({ addPeerModalOpen: false, addPeerDraft: '' });
  };

  _submitAddPeer = () => {
    const { onAddPeer } = this.props;
    const normalized = normalizePeerAddressInput(this.state.addPeerDraft);
    if (!normalized) {
      toast.warning('Enter a host or host:port (e.g. hub.fabric.pub or 127.0.0.1:7777).', { header: 'Add peer' });
      return;
    }
    if (typeof onAddPeer === 'function') {
      onAddPeer({ address: normalized });
    }
    this.setState({ addPeerModalOpen: false, addPeerDraft: '' });
  };

  _openConnectPeerModal = () => {
    this.setState({ connectPeerModalOpen: true, connectPeerIdDraft: '' });
  };

  _closeConnectPeerModal = () => {
    this.setState({ connectPeerModalOpen: false, connectPeerIdDraft: '' });
  };

  _submitConnectPeerModal = () => {
    const { onConnectWebRTCPeer } = this.props;
    const value = String(this.state.connectPeerIdDraft || '').trim();
    if (!value || typeof onConnectWebRTCPeer !== 'function') return;
    onConnectWebRTCPeer(value);
    this.setState({ connectPeerModalOpen: false, connectPeerIdDraft: '' });
  };

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

    this._onPeerTopologyGossip = (ev) => {
      const path = ev && ev.detail && ev.detail.operation && ev.detail.operation.path;
      if (path === '/peerTopologyGossip') this.forceUpdate();
    };
    window.addEventListener('globalStateUpdate', this._onPeerTopologyGossip);

    this._onNetworkStatus = () => this.forceUpdate();
    window.addEventListener('networkStatusUpdate', this._onNetworkStatus);
  }

  componentWillUnmount () {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (this._onPeerTopologyGossip) {
      window.removeEventListener('globalStateUpdate', this._onPeerTopologyGossip);
      this._onPeerTopologyGossip = null;
    }
    if (this._onNetworkStatus) {
      window.removeEventListener('networkStatusUpdate', this._onNetworkStatus);
      this._onNetworkStatus = null;
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
      onSendWebRTCTestPing,
      onFabricPeerResync
    } = this.props;
    const uf = loadHubUiFeatureFlags();
    const isLoggedIn = !!(auth && auth.id && auth.xpub);
    const activeBridgeRef = bridgeRef || bridge;
    const current = activeBridgeRef && activeBridgeRef.current;
    const candidate = current && current.networkStatus;
    const fallback = current && current.lastNetworkStatus;
    const networkStatus = isHubNetworkStatusShape(candidate)
      ? candidate
      : (isHubNetworkStatusShape(fallback) ? fallback : null);
    const network = networkStatus && networkStatus.network;
    const peers = Array.isArray(networkStatus && networkStatus.peers) ? networkStatus.peers : [];
    const state = networkStatus && networkStatus.state;
    const isOnline = !!networkStatus;
    const fabricPeerId = networkStatus && networkStatus.fabricPeerId
      ? String(networkStatus.fabricPeerId)
      : null;
    const legacyUnstableId = !fabricPeerId && networkStatus && networkStatus.contract != null
      ? String(networkStatus.contract)
      : null;
    const shareNodeId = fabricPeerId || legacyUnstableId;
    const hostPort = network && network.address ? String(network.address) : null;
    const shareableString = [shareNodeId, hostPort].filter(Boolean).join('\n');

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

    const primaryPeerNorm = normalizeFabricPeerAddress(readPrimaryPeerAddress());
    const fabricPeersSorted = sortFabricPeersForAuthority(dedupeFabricPeers(fabricPeers), primaryPeerNorm);

    // Local browser WebRTC connections (browser-to-browser)
    const localWebrtcPeers = (current && typeof current.localWebrtcPeers !== 'undefined')
      ? current.localWebrtcPeers
      : [];

    // WebRTC mesh status
    const meshStatus = (current && typeof current.webrtcMeshStatus !== 'undefined')
      ? current.webrtcMeshStatus
      : null;

    const webrtcCombined = buildWebrtcCombinedRows(
      webrtcPeers,
      localWebrtcPeers,
      meshStatus && meshStatus.peerId ? String(meshStatus.peerId) : null
    );

    const bitcoin = networkStatus && networkStatus.bitcoin && typeof networkStatus.bitcoin === 'object'
      ? networkStatus.bitcoin
      : null;
    const chainHeight = bitcoin && typeof bitcoin.height === 'number' && Number.isFinite(bitcoin.height)
      ? bitcoin.height
      : null;
    const tipFull = bitcoin && typeof bitcoin.bestBlockHash === 'string' && /^[0-9a-fA-F]{64}$/.test(bitcoin.bestBlockHash)
      ? bitcoin.bestBlockHash
      : null;
    const tipShort = tipFull ? `${tipFull.slice(0, 10)}…${tipFull.slice(-6)}` : null;
    const btcNetwork = bitcoin && bitcoin.network != null ? String(bitcoin.network) : null;
    const mempoolN = bitcoin && bitcoin.mempoolTxCount != null && Number.isFinite(Number(bitcoin.mempoolTxCount))
      ? Number(bitcoin.mempoolTxCount)
      : null;

    return (
      <fabric-hub-peers class='fade-in'>
        <Segment style={{ clear: 'both' }}>
          <section aria-labelledby="peers-page-heading" aria-describedby="peers-page-summary">
          <div
            style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75em', flexWrap: 'wrap', marginBottom: '0.25em' }}
            role="banner"
          >
            <Button basic size="small" as={Link} to="/" aria-label="Back to home">
              <Icon name="arrow left" aria-hidden="true" />
              Home
            </Button>
            <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
              <Header as="h2" id="peers-page-heading" style={{ margin: 0 }}>
                <Header.Content>Peers</Header.Content>
              </Header>
              <p id="peers-page-summary" style={{ margin: '0.35em 0 0', color: '#666', maxWidth: '48rem', lineHeight: 1.45 }}>
                Fabric TCP peers, WebRTC mesh, and the hub&apos;s Bitcoin chain head (height / tip) for comparing regtest sync across linked nodes.
              </p>
            </div>
          </div>
          </section>
        </Segment>

        <Message info size="small">
          <p style={{ margin: 0, fontWeight: 600, color: '#333' }}>
            Primary authority &amp; Payjoin v2 (BIP 77)
          </p>
          <p style={{ margin: '0.35em 0 0', color: '#444' }}>
            Use a long-lived hub (e.g. <code>hub.fabric.pub</code>) as your <strong>primary authority</strong>: Fabric TCP carries <code>BitcoinBlock</code> gossip and accumulates peer trust scores. Async Payjoin v2 (directory + HPKE + OHTTP) is summarized at{' '}
            <a href="https://payjoin.org/docs/how-it-works/payjoin-v2-bip-77" target="_blank" rel="noreferrer">payjoin.org — BIP 77</a>.
            This build still uses BIP77 deposit sessions and BIP78-style <code>pj=</code> where enabled; full v2 directory flows are a future client integration.
          </p>
          {isLoggedIn && typeof onAddPeer === 'function' && (
            <div style={{ marginTop: '0.65em', display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
              <Button
                size="small"
                primary
                type="button"
                onClick={() => {
                  writePrimaryPeerAddress(DEFAULT_PRIMARY_FABRIC_HUB);
                  onAddPeer({ address: DEFAULT_PRIMARY_FABRIC_HUB });
                }}
                title="Remember as primary and call AddPeer for the public Fabric hub"
              >
                <Icon name="star" aria-hidden="true" />
                Add primary hub ({DEFAULT_PRIMARY_FABRIC_HUB})
              </Button>
              <span style={{ color: '#666', fontSize: '0.9em' }}>
                Primary (saved): <code>{readPrimaryPeerAddress()}</code> — sorted first when connected.
              </span>
            </div>
          )}
        </Message>

          {networkStatus ? (
            <>
            <Segment>
              <Statistic.Group size='small' widths='five' stackable>
                <Statistic>
                  <Statistic.Value>{chainHeight != null ? chainHeight : '—'}</Statistic.Value>
                  <Statistic.Label>Block height</Statistic.Label>
                </Statistic>
                <Statistic>
                  <Statistic.Value text style={{ fontSize: '1rem', fontFamily: 'monospace' }}>
                    {tipFull ? (
                      uf.bitcoinExplorer ? (
                        <Link to={`/services/bitcoin/blocks/${encodeURIComponent(tipFull)}`} title={tipFull}>
                          {tipShort}
                        </Link>
                      ) : (
                        <span title={`${tipFull} — enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility for a block link`}>{tipShort}</span>
                      )
                    ) : (
                      '—'
                    )}
                  </Statistic.Value>
                  <Statistic.Label>Chain tip</Statistic.Label>
                </Statistic>
                <Statistic>
                  <Statistic.Value>{btcNetwork || '—'}</Statistic.Value>
                  <Statistic.Label>Bitcoin network</Statistic.Label>
                </Statistic>
                <Statistic>
                  <Statistic.Value>{mempoolN != null ? mempoolN : '—'}</Statistic.Value>
                  <Statistic.Label>Mempool (tx)</Statistic.Label>
                </Statistic>
                <Statistic>
                  <Statistic.Value>{fabricPeersSorted.length}</Statistic.Value>
                  <Statistic.Label>Fabric peers</Statistic.Label>
                </Statistic>
              </Statistic.Group>
              {bitcoin && bitcoin.available === false && bitcoin.message && (
                <Message warning size='small' style={{ marginTop: '1em' }} content={bitcoin.message} />
              )}
              <Message info size='small' style={{ marginTop: '1em' }}>
                <p style={{ margin: 0, fontWeight: 600, color: '#333' }}>Block relay over Fabric</p>
                <p style={{ margin: '0.35em 0 0' }}>
                  When this hub&apos;s bitcoind advances the tip (ZMQ <code>hashblock</code>), it signs a <code>BitcoinBlock</code> P2P message and peers relay it (same wire bytes; duplicates are ignored). Use height and tip here to confirm your regtest head vs. peers after <code>addnode</code> / long chains.
                </p>
              </Message>
            </Segment>

            {(() => {
              const gs = activeBridgeRef && activeBridgeRef.current && typeof activeBridgeRef.current.getGlobalState === 'function'
                ? activeBridgeRef.current.getGlobalState()
                : null;
              const gossip = gs && gs.peerTopologyGossip;
              const topoDot = peerTopologyToDot({
                selfId: fabricPeerId,
                selfLabel: 'This Fabric node',
                directPeers: fabricPeersSorted,
                gossip
              });
              if (!topoDot) return null;
              return (
                <Segment>
                  <section aria-labelledby="peers-topology-h3" aria-describedby="peers-topology-desc">
                  <Header as="h3" id="peers-topology-h3">Peer topology</Header>
                  <p id="peers-topology-desc" style={{ color: '#666', marginBottom: '0.75em' }}>
                    <strong>Solid</strong> edges: TCP peers in this hub snapshot. <strong>Dotted</strong> edges: Fabric ids that peer reported in <code>P2P_PEER_GOSSIP</code> (second-hand view; client keeps ~20 minutes). Open a connected peer and use <strong>Docs</strong> to send <code>INVENTORY_REQUEST</code> toward a publisher; add TCP peers for ids you want to reach directly.
                  </p>
                  <GraphDocumentPreview dotSource={topoDot} skipIdentityGate />
                  <details style={{ marginTop: '0.75rem' }}>
                    <summary style={{ cursor: 'pointer', color: '#555' }}>DOT source</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', background: '#f7f7f7', padding: '0.5rem', borderRadius: 4 }}>{topoDot}</pre>
                  </details>
                  </section>
                </Segment>
              );
            })()}

            <Card fluid>
              <Card.Content>
                <Card.Header>
                  Fabric P2P{' '}
                  <Label size='small' color={isOnline ? 'green' : 'grey'}>
                    {isOnline ? 'Online' : 'Offline'}
                  </Label>
                </Card.Header>
                <Card.Meta>
                  <span>
                    <strong>Bridge state:</strong> {(state && state.status) || 'unknown'}
                  </span>
                </Card.Meta>
                <Card.Description>
                  {(shareNodeId || hostPort) && (
                    <div style={{ marginBottom: '1em' }}>
                      <Header as='h5' style={{ margin: '0 0 0.5em 0' }}>Share with other peers</Header>
                      <List relaxed size='small'>
                        {shareNodeId && (
                          <List.Item>
                            <List.Header>{fabricPeerId ? 'Fabric node ID' : 'Node ID (legacy)'}</List.Header>
                            <List.Description>
                              <code
                                style={{ wordBreak: 'break-all', fontSize: '0.9em', display: 'block', marginTop: '0.25em' }}
                                title={fabricPeerId ? 'Stable P2P identity (public key).' : 'May change when contract state updates — upgrade hub for fabricPeerId.'}
                              >{shareNodeId}</code>
                              {legacyUnstableId && (
                                <span style={{ fontSize: '0.85em', color: '#886', display: 'block', marginTop: '0.35em' }}>
                                  Can change when the hub processes messages. Prefer <code>fabricPeerId</code> when available.
                                </span>
                              )}
                            </List.Description>
                          </List.Item>
                        )}
                        {hostPort && (
                          <List.Item>
                            <List.Header>Listen address</List.Header>
                            <List.Description>
                              <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{hostPort}</code>
                            </List.Description>
                          </List.Item>
                        )}
                      </List>
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
                          title='Copy Fabric node ID and listen address'
                        >
                          <Icon name='copy' />
                          Copy node ID + address
                        </Button>
                      )}
                    </div>
                  )}
                  <Divider section />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75em', flexWrap: 'wrap' }}>
                    <div>
                      <Label size='tiny' basic color='green' style={{ marginRight: '0.5em' }}>
                        Fabric network
                      </Label>
                      <strong>Connected list:</strong> {fabricPeersSorted.length}
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
                          type="button"
                          onClick={() => {
                            if (typeof onAddPeer !== 'function') return;
                            this._openAddPeerModal();
                          }}
                        >
                          <Icon name='add' />
                          Add Peer
                        </Button>
                      </Button.Group>
                    )}
                  </div>

                  {fabricPeersSorted.length > 0 && (
                    <List size='small' divided relaxed>
                      {fabricPeersSorted.map((peer, idx) => {
                        const id = peer && (peer.id || peer.address || peer.pubkey || `peer-${idx}`);
                        const address = peer && (peer.address || peer.host || peer.url);
                        const routeTarget = String((address && address.trim()) || id || `peer-${idx}`);
                        const rowKey = routeTarget;
                        const status = (peer && peer.status) || 'unknown';
                        const isConnected = status === 'connected';
                        const score = peer && (peer.score != null ? peer.score : null);
                        const nickname = peer && peer.nickname;
                        const lastSeen = peer && (peer.lastSeen || peer.lastMessage);
                        const addrNorm = normalizeFabricPeerAddress(address);
                        const isPrimaryRow = primaryPeerNorm && (addrNorm === primaryPeerNorm || String(address) === primaryPeerNorm);
                        const headline = fabricPeerPrimaryLabel(peer);
                        const xpubFull = extractPeerXpub(peer);
                        return (
                          <List.Item as={Link} to={`/peers/${encodeURIComponent(routeTarget)}`} key={rowKey}>
                            <List.Content>
                              <List.Header style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                                {headline}
                                {isPrimaryRow && (
                                  <Label size="tiny" color="yellow" horizontal title="Node-local primary authority preference">
                                    <Icon name="star" /> Primary
                                  </Label>
                                )}
                                {nickname && headline !== nickname ? (
                                  <span style={{ fontSize: '0.85em', color: '#666' }} title="Nickname">
                                    ({nickname})
                                  </span>
                                ) : null}
                                {nickname && xpubFull ? (
                                  <span style={{ fontSize: '0.85em', color: '#666' }} title={xpubFull}>
                                    {shortenPublicId(xpubFull, 16, 12)}
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
                                {isConnected && typeof onFabricPeerResync === 'function' && (
                                  <Button
                                    size='mini'
                                    basic
                                    title='Request Fabric chain resync: ChainSyncRequest, inventory exchange, and replay of BitcoinBlock messages from this hub log'
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      try {
                                        onFabricPeerResync(routeTarget);
                                      } catch (e) {}
                                    }}
                                  >
                                    <Icon name='sync' />
                                    Resync
                                  </Button>
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
                  {fabricPeersSorted.length === 0 && (
                    <p style={{ color: '#666', fontStyle: 'italic', marginTop: '0.75em' }}>
                      No Fabric TCP peers yet. Add <code>{DEFAULT_PRIMARY_FABRIC_HUB}</code> above or use <strong>Add Peer</strong> with <code>host:port</code> (default Fabric port <code>7777</code>). After connect, chain height / tip reflect sync with that peer&apos;s view when gossip is flowing.
                    </p>
                  )}
                </Card.Description>
              </Card.Content>
            </Card>
            </>
          ) : (
            <Segment basic>
              <div
                role="status"
                aria-live="polite"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75em',
                  flexWrap: 'wrap',
                  padding: '0.75em 0',
                  color: '#555'
                }}
              >
                <Loader active inline size="small" />
                <span>Connecting to hub and loading Fabric network status (peers, Bitcoin height)…</span>
              </div>
            </Segment>
          )}

          {/* WebRTC Peers Section */}
          <Card fluid style={{ marginTop: '1em' }}>
            <Card.Content>
              <Card.Header>
                <Icon name='video' />
                WebRTC Peers{' '}
                <Label size='small' color={webrtcCombined.length > 0 ? 'blue' : 'grey'}>
                  {webrtcCombined.length} browser peer{webrtcCombined.length === 1 ? '' : 's'}
                </Label>
                {webrtcPeers.length > 0 && (
                  <Label size='small' basic color='blue' style={{ marginLeft: '0.35em' }} title="Registered with hub signaling (may overlap mesh)">
                    {webrtcPeers.length} signaling
                  </Label>
                )}
                {localWebrtcPeers.length > 0 && (
                  <Label size='small' basic color='teal' style={{ marginLeft: '0.35em' }}>
                    {localWebrtcPeers.length} mesh link{localWebrtcPeers.length === 1 ? '' : 's'}
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
                      onClick={this._openConnectPeerModal}
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
                {webrtcCombined.length === 0 ? (
                  <p style={{ color: '#666', fontStyle: 'italic' }}>
                    No WebRTC peers yet. Browsers register with hub signaling; mesh rows appear when data channels connect. Each logical browser is one row (xpub when shared).
                  </p>
                ) : (
                  <>
                    <div style={{ marginBottom: '0.5em' }}>
                      <Label size='tiny' basic color='grey'>
                        Combined view (signaling + mesh)
                      </Label>
                    </div>
                    <List size='small' divided relaxed>
                      {webrtcCombined.map((row) => {
                        const peerId = row.id;
                        const sig = row.signaling;
                        const loc = row.local;
                        const locStatus = loc && loc.status;
                        const meshConnected = locStatus === 'connected';
                        const headline = webrtcRowPrimaryLabel(sig, loc);
                        const meta = sig && sig.metadata && typeof sig.metadata === 'object' ? sig.metadata : {};
                        const fullXpub = meta.xpub && String(meta.xpub).trim();
                        const direction = loc && loc.direction;
                        const connectedAt = (loc && loc.connectedAt) || (sig && sig.connectedAt);
                        return (
                          <List.Item as={Link} to={`/peers/${encodeURIComponent(peerId)}`} key={peerId}>
                            <List.Icon
                              name={meshConnected ? 'exchange' : 'wifi'}
                              color={meshConnected ? 'teal' : 'grey'}
                              verticalAlign='middle'
                              title={meshConnected ? 'Mesh data channel' : 'Signaling only'}
                            />
                            <List.Content>
                              <List.Header style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                                <strong title={fullXpub || peerId}>{headline}</strong>
                                {sig ? (
                                  <Label size='tiny' basic color='blue' horizontal title="Seen on hub signaling">
                                    signaling
                                  </Label>
                                ) : null}
                                {loc ? (
                                  <Label size='tiny' basic color='teal' horizontal title="Local WebRTC mesh">
                                    mesh{meshConnected ? '' : ` (${locStatus || '—'})`}
                                  </Label>
                                ) : null}
                                {direction && loc ? (
                                  <Label size='tiny' basic horizontal title={`${direction} mesh connection`}>
                                    {direction === 'inbound' ? 'Inbound' : 'Outbound'}
                                  </Label>
                                ) : null}
                                {typeof onDisconnectWebRTCPeer === 'function' && loc ? (
                                  <Button
                                    size='mini'
                                    basic
                                    color='red'
                                    icon
                                    title='Disconnect this WebRTC mesh peer'
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      try {
                                        onDisconnectWebRTCPeer(peerId);
                                      } catch (e) {}
                                    }}
                                  >
                                    <Icon name='unlink' />
                                  </Button>
                                ) : null}
                              </List.Header>
                              <List.Description style={{ fontSize: '0.85em', color: '#555', wordBreak: 'break-all' }}>
                                <code title={peerId}>{peerId}</code>
                                {meta.fabricPeerId && String(meta.fabricPeerId) !== peerId ? (
                                  <span style={{ display: 'block', marginTop: '0.25em' }}>
                                    Fabric id:{' '}
                                    <code style={{ fontSize: '0.9em' }}>{shortenPublicId(String(meta.fabricPeerId), 18, 12)}</code>
                                  </span>
                                ) : null}
                              </List.Description>
                              {connectedAt ? (
                                <List.Description style={{ fontSize: '0.85em', color: '#666' }}>
                                  {meshConnected ? 'Mesh' : 'Signaling'}: {new Date(connectedAt).toLocaleString()}
                                </List.Description>
                              ) : null}
                              {loc && loc.error ? (
                                <List.Description style={{ fontSize: '0.85em', color: '#b00' }}>
                                  Error: {loc.error}
                                </List.Description>
                              ) : null}
                            </List.Content>
                          </List.Item>
                        );
                      })}
                    </List>
                  </>
                )}
              </Card.Description>
            </Card.Content>
          </Card>

        <Modal
          open={this.state.addPeerModalOpen}
          onClose={this._closeAddPeerModal}
          onOpen={() => {
            const el = typeof document !== 'undefined' && document.getElementById('fabric-add-peer-address');
            if (el && typeof el.focus === 'function') {
              window.requestAnimationFrame(() => el.focus());
            }
          }}
          size="small"
          closeOnDimmerClick
          closeOnEscape
        >
          <Modal.Header>Add Fabric peer</Modal.Header>
          <Modal.Content>
            <p style={{ marginTop: 0, color: '#555' }}>
              TCP address for Fabric P2P (default port <code>7777</code>). You can paste a full URL — it will be normalized.
            </p>
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                this._submitAddPeer();
              }}
            >
              <Form.Field>
                <label htmlFor="fabric-add-peer-address">Peer address</label>
                <Input
                  id="fabric-add-peer-address"
                  placeholder="host:port or host (e.g. hub.fabric.pub)"
                  value={this.state.addPeerDraft}
                  onChange={(e) => this.setState({ addPeerDraft: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      this._submitAddPeer();
                    }
                  }}
                />
              </Form.Field>
            </Form>
          </Modal.Content>
          <Modal.Actions>
            <Button type="button" onClick={this._closeAddPeerModal}>
              Cancel
            </Button>
            <Button type="button" primary onClick={this._submitAddPeer}>
              <Icon name="add" />
              Add peer
            </Button>
          </Modal.Actions>
        </Modal>
        <Modal
          open={this.state.connectPeerModalOpen}
          onClose={this._closeConnectPeerModal}
          size="tiny"
          closeOnDimmerClick
          closeOnEscape
        >
          <Modal.Header>Connect to WebRTC peer</Modal.Header>
          <Modal.Content>
            <Form onSubmit={(e) => { e.preventDefault(); this._submitConnectPeerModal(); }}>
              <Form.Field>
                <label htmlFor="peers-connect-peer-id">Peer ID</label>
                <Input
                  id="peers-connect-peer-id"
                  placeholder="fabric-bridge-…"
                  value={this.state.connectPeerIdDraft}
                  onChange={(e) => this.setState({ connectPeerIdDraft: e.target.value })}
                />
              </Form.Field>
            </Form>
          </Modal.Content>
          <Modal.Actions>
            <Button type="button" onClick={this._closeConnectPeerModal}>
              Cancel
            </Button>
            <Button type="button" primary onClick={this._submitConnectPeerModal}>
              <Icon name="plug" />
              Connect
            </Button>
          </Modal.Actions>
        </Modal>
      </fabric-hub-peers>
    );
  }
}

function PeersPageWithLocation (props) {
  const location = useLocation();
  return <PeersPage {...props} location={location} />;
}

module.exports = PeersPageWithLocation;
