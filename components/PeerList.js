'use strict';

// Dependencies
const React = require('react');
const { useLocation, Link, useNavigate } = require('react-router-dom');

const {
  Button,
  Divider,
  Form,
  Grid,
  Header,
  Icon,
  Input,
  Label,
  List,
  Loader,
  Message,
  Modal,
  Segment,
  Statistic,
  Table
} = require('semantic-ui-react');
const GraphDocumentPreview = require('./GraphDocumentPreview');
const { peerTopologyToDot } = require('../functions/peerTopologyDot');
const { isHubNetworkStatusShape } = require('../functions/hubNetworkStatus');
const {
  normalizeFabricPeerAddress,
  normalizePeerAddressInput,
  dedupeFabricPeers,
  fabricPeerPrimaryLabel,
  fabricPeerBech32Id,
  peerConnectionPubkeyAtHostPort,
  fabricP2PIdentityConfirmed,
  consolidateUnifiedPeersByFabricId,
  buildWebrtcCombinedRows,
  webrtcCombinedToFabricPeerRows,
  mergeTcpAndWebrtcPeerRows,
  isWebrtcTransportPeerRow
} = require('../functions/peerIdentity');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const {
  readStorageString,
  writeStorageString
} = require('../functions/fabricBrowserState');
const { toast } = require('../functions/toast');
const HubPagination = require('./HubPagination');
const { useHubListPagination } = require('../functions/hubListPagination');

/** Default “primary authority” Fabric TCP peer — long-lived hub, high trust, Bitcoin head reference. */
const DEFAULT_PRIMARY_FABRIC_HUB = 'hub.fabric.pub:7777';
const PRIMARY_PEER_STORAGE_KEY = 'fabric.peers.primaryFabricAddress';

function readPrimaryPeerAddress () {
  try {
    if (typeof window !== 'undefined') {
      const s = String(readStorageString(PRIMARY_PEER_STORAGE_KEY) || '').trim();
      return s || DEFAULT_PRIMARY_FABRIC_HUB;
    }
  } catch (e) {}
  return DEFAULT_PRIMARY_FABRIC_HUB;
}

function writePrimaryPeerAddress (addr) {
  try {
    if (typeof window !== 'undefined') {
      writeStorageString(PRIMARY_PEER_STORAGE_KEY, String(addr || '').trim());
    }
  } catch (e) {}
}

function inventoryDocCountForFabricPeer (globalPeers, fabricId) {
  if (!globalPeers || typeof globalPeers !== 'object' || !fabricId) return null;
  const fid = String(fabricId).trim();
  const direct = globalPeers[fid];
  if (direct && direct.inventory && Array.isArray(direct.inventory.documents)) {
    return direct.inventory.documents.length;
  }
  for (const k of Object.keys(globalPeers)) {
    const ex = globalPeers[k];
    if (ex && String(ex.id || '') === fid && ex.inventory && Array.isArray(ex.inventory.documents)) {
      return ex.inventory.documents.length;
    }
  }
  return null;
}

function UnifiedPeersPaginatedList ({
  unifiedPeers,
  primaryPeerNorm,
  signalingHostPort,
  globalPeers,
  onDisconnectWebRTCPeer,
  onFabricPeerResync
}) {
  const navigate = useNavigate();
  const first = unifiedPeers[0];
  const last = unifiedPeers.length ? unifiedPeers[unifiedPeers.length - 1] : null;
  const resetKey = `${unifiedPeers.length}:${first && (first.id || first.address)}:${last && (last.id || last.address)}`;
  const {
    slice,
    page,
    totalPages,
    rangeFrom,
    rangeTo,
    total,
    setPage
  } = useHubListPagination(unifiedPeers, resetKey);

  const sigHp = String(signalingHostPort || '').trim();
  const gp = globalPeers && typeof globalPeers === 'object' ? globalPeers : null;

  return (
    <>
      <Table
        compact
        celled
        striped
        selectable
        size="small"
        unstackable
        style={{ marginTop: '0.75em', tableLayout: 'fixed' }}
      >
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell style={{ width: '28%' }}>Fabric Peer ID</Table.HeaderCell>
            <Table.HeaderCell style={{ width: '32%' }}>Connection</Table.HeaderCell>
            <Table.HeaderCell style={{ width: '18%' }} textAlign="center">Status</Table.HeaderCell>
            <Table.HeaderCell style={{ width: '14%' }}>Seen</Table.HeaderCell>
            <Table.HeaderCell collapsing textAlign="right"> </Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {slice.map((peer, idx) => {
            const meshRow = isWebrtcTransportPeerRow(peer);
            const id = peer && (peer.id || peer.address || peer.pubkey || `peer-${idx}`);
            const address = peer && (peer.address || peer.host || peer.url);
            const bech32Id = fabricPeerBech32Id(peer);
            const routeTarget = bech32Id
              ? bech32Id
              : (meshRow
                ? String(peer.id || id || `peer-${idx}`)
                : String((address && address.trim()) || id || `peer-${idx}`));
            const rowKey = bech32Id ? `id:${bech32Id}` : (meshRow ? `mesh:${routeTarget}` : routeTarget);
            const status = (peer && peer.status) || 'unknown';
            const isConnected = status === 'connected';
            const score = peer && (peer.score != null ? peer.score : null);
            const misbehavior = peer && peer.misbehavior != null ? Number(peer.misbehavior) : null;
            const nickname = peer && peer.nickname;
            const lastSeen = peer && (peer.lastSeen || peer.lastMessage);
            const addrNorm = normalizeFabricPeerAddress(address);
            const isPrimaryRow = !meshRow && primaryPeerNorm && (addrNorm === primaryPeerNorm || String(address) === primaryPeerNorm);
            const connectionStr = peerConnectionPubkeyAtHostPort(peer, sigHp) || '—';
            const p2pConfirmed = fabricP2PIdentityConfirmed(peer);
            const invN = gp ? inventoryDocCountForFabricPeer(gp, bech32Id || routeTarget) : null;
            const tcpForResync = address && !String(address).startsWith('webrtc:')
              ? normalizeFabricPeerAddress(address)
              : '';
            const meshDisconnectId = peer && peer.metadata && peer.metadata.webrtcSignalingId != null
              ? String(peer.metadata.webrtcSignalingId)
              : String(peer.id || routeTarget);
            const headlineId = bech32Id || fabricPeerPrimaryLabel(peer);
            const tagSummary = [
              meshRow ? 'Mesh' : null,
              isPrimaryRow ? 'Primary' : null,
              p2pConfirmed ? 'P2P id' : null,
              (!p2pConfirmed && bech32Id && meshRow) ? 'Signaled' : null,
              invN != null && invN > 0 ? `Docs ${invN}` : null,
              score != null ? `★${score}` : null,
              meshRow && misbehavior != null && misbehavior > 0 ? `warn ${misbehavior}` : null
            ].filter(Boolean).join(' · ');
            const seenShort = lastSeen
              ? new Date(lastSeen).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              : '—';
            return (
              <Table.Row
                key={rowKey}
                style={{ cursor: 'pointer' }}
                title={tagSummary || undefined}
                onClick={() => navigate(`/peers/${encodeURIComponent(routeTarget)}`)}
              >
                <Table.Cell style={{ verticalAlign: 'middle', overflow: 'hidden' }}>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '0.88rem',
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={headlineId}
                  >
                    {headlineId}
                  </div>
                  {nickname ? (
                    <div style={{ fontSize: '0.78rem', color: '#767676', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nickname}>
                      {nickname}
                    </div>
                  ) : null}
                </Table.Cell>
                <Table.Cell style={{ verticalAlign: 'middle', overflow: 'hidden' }}>
                  <code
                    style={{
                      fontSize: '0.78rem',
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={connectionStr}
                  >
                    {connectionStr}
                  </code>
                </Table.Cell>
                <Table.Cell textAlign="center" style={{ verticalAlign: 'middle' }}>
                  <span style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                    {meshRow ? <Icon name="exchange" color="teal" title="WebRTC mesh" /> : null}
                    {isPrimaryRow ? <Icon name="star" color="yellow" title="Primary peer" /> : null}
                    {p2pConfirmed ? <Icon name="shield" color="blue" title="P2P identity confirmed" /> : null}
                    {invN != null && invN > 0 ? (
                      <Icon name="book" color="violet" title={`${invN} inventory docs`} />
                    ) : null}
                    <Icon
                      name={isConnected ? 'check circle' : 'minus circle'}
                      color={isConnected ? 'green' : 'grey'}
                      title={status}
                    />
                    <span style={{ marginLeft: '0.25em', color: isConnected ? '#21ba45' : '#767676' }}>
                      {isConnected ? 'On' : (meshRow ? (status === 'signaling' ? 'Sig' : 'Off') : 'Off')}
                    </span>
                  </span>
                </Table.Cell>
                <Table.Cell style={{ verticalAlign: 'middle', fontSize: '0.8rem', color: '#666', whiteSpace: 'nowrap' }} title={lastSeen ? new Date(lastSeen).toLocaleString() : ''}>
                  {seenShort}
                </Table.Cell>
                <Table.Cell collapsing textAlign="right" style={{ verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                  {meshRow && typeof onDisconnectWebRTCPeer === 'function' && (isConnected || status === 'connecting') ? (
                    <Button
                      size="mini"
                      basic
                      color="red"
                      icon
                      title="Drop mesh peer"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        try {
                          onDisconnectWebRTCPeer(meshDisconnectId);
                        } catch (e) {}
                      }}
                    >
                      <Icon name="unlink" />
                    </Button>
                  ) : null}
                  {!meshRow && isConnected && typeof onFabricPeerResync === 'function' && tcpForResync ? (
                    <Button
                      size="mini"
                      basic
                      icon
                      title="Fabric resync"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        try {
                          onFabricPeerResync(tcpForResync);
                        } catch (e) {}
                      }}
                    >
                      <Icon name="sync" />
                    </Button>
                  ) : null}
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>
      {total > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.5em',
            marginTop: '0.75em'
          }}
        >
          <span style={{ color: '#666', fontSize: '0.88em' }}>
            Showing {rangeFrom}–{rangeTo} of {total}
          </span>
          <HubPagination
            activePage={page}
            totalPages={totalPages}
            onPageChange={(e, d) => setPage(d.activePage)}
            style={{ marginTop: 0, flex: '1 1 auto', minWidth: 0 }}
          />
        </div>
      )}
    </>
  );
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
      connectPeerIdDraft: '',
      flushChainSnapshot: '',
      flushChainNetwork: 'playnet',
      flushChainLabel: ''
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
      onFabricPeerResync,
      adminPeerToolsToken,
      onSendFlushChainToTrustedPeers
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
    const stateStatusUpper = (state && state.status != null)
      ? String(state.status).trim().toUpperCase()
      : '';
    const bridgeFabricPaused = stateStatusUpper === 'PAUSED';
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
      if (peer.metadata && peer.metadata.transport === 'webrtc') return true;
      const id = String(peer.id || '');
      const address = String(peer.address || '');
      const hasWebRTCMetadata = !!(peer.metadata && Array.isArray(peer.metadata.capabilities));
      if (id.startsWith('fabric-bridge-') || address.startsWith('fabric-bridge-')) return false;
      if (hasWebRTCMetadata && peer.status === 'registered') return false;
      return true;
    });

    const primaryPeerNorm = normalizeFabricPeerAddress(readPrimaryPeerAddress());
    const fabricPeersSorted = sortFabricPeersForAuthority(dedupeFabricPeers(fabricPeers), primaryPeerNorm);

    const localWebrtcPeers = (current && typeof current.localWebrtcPeers !== 'undefined')
      ? current.localWebrtcPeers
      : [];

    const meshStatus = (current && typeof current.webrtcMeshStatus !== 'undefined')
      ? current.webrtcMeshStatus
      : null;

    const webrtcCombined = buildWebrtcCombinedRows(
      webrtcPeers,
      localWebrtcPeers,
      meshStatus && meshStatus.peerId ? String(meshStatus.peerId) : null
    );

    const repLookup = (pid) => (
      current && typeof current.getWebRTCPeerReputation === 'function'
        ? current.getWebRTCPeerReputation(pid)
        : null
    );

    const fabricPeersWithRep = fabricPeersSorted.map((p) => {
      if (!p || !p.metadata || p.metadata.transport !== 'webrtc') return p;
      const sid = p.metadata.webrtcSignalingId;
      if (!sid) return p;
      const r = repLookup(sid);
      if (!r) return p;
      return { ...p, score: r.score, misbehavior: r.misbehavior };
    });

    const idsFromStatusPeers = new Set();
    for (const p of fabricPeersWithRep) {
      if (p && p.id) idsFromStatusPeers.add(String(p.id));
      const bf = fabricPeerBech32Id(p);
      if (bf) idsFromStatusPeers.add(bf);
      if (p && p.metadata && p.metadata.webrtcSignalingId) {
        idsFromStatusPeers.add(String(p.metadata.webrtcSignalingId));
      }
      const addr = String((p && p.address) || '');
      if (addr.startsWith('webrtc:')) {
        idsFromStatusPeers.add(addr.slice('webrtc:'.length));
      }
    }

    const localOnlyForMesh = localWebrtcPeers.filter((lp) => {
      if (!lp || !lp.id) return false;
      if (idsFromStatusPeers.has(String(lp.id))) return false;
      const meta = lp.metadata && typeof lp.metadata === 'object' ? lp.metadata : {};
      const lFab = meta.fabricPeerId != null ? String(meta.fabricPeerId).trim() : '';
      if (lFab && idsFromStatusPeers.has(lFab)) return false;
      return true;
    });
    const webrtcExtraRows = webrtcCombinedToFabricPeerRows(
      localOnlyForMesh.map((lp) => ({ id: lp.id, signaling: null, local: lp })),
      repLookup
    );

    const unifiedPeers = consolidateUnifiedPeersByFabricId(
      mergeTcpAndWebrtcPeerRows(fabricPeersWithRep, webrtcExtraRows, primaryPeerNorm)
    );

    const signalingHostPort = typeof window !== 'undefined' ? window.location.host : '';
    const globalPeers = current && typeof current.getGlobalState === 'function'
      ? (current.getGlobalState().peers || null)
      : null;

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

    const gsTopo = activeBridgeRef && activeBridgeRef.current && typeof activeBridgeRef.current.getGlobalState === 'function'
      ? activeBridgeRef.current.getGlobalState()
      : null;
    const topologyGossip = gsTopo && gsTopo.peerTopologyGossip;
    const topologyDot = networkStatus
      ? peerTopologyToDot({
        selfId: fabricPeerId,
        selfLabel: 'This Fabric node',
        directPeers: fabricPeersSorted,
        gossip: topologyGossip
      })
      : null;

    return (
      <fabric-hub-peers class='fade-in'>
        <Segment style={{ clear: 'both', borderRadius: 4, boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
          <section aria-labelledby="peers-page-heading" aria-describedby="peers-page-summary">
            <div
              style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75em', flexWrap: 'wrap', marginBottom: '0.5em' }}
              role="banner"
            >
              <Button basic size="small" as={Link} to="/" aria-label="Back to home">
                <Icon name="arrow left" aria-hidden="true" />
                Home
              </Button>
              <div style={{ flex: '1 1 14rem', minWidth: 0 }}>
                <Header as="h2" id="peers-page-heading" style={{ margin: 0 }}>
                  <Header.Content>Peers</Header.Content>
                </Header>
                <p id="peers-page-summary" style={{ margin: '0.4em 0 0', color: '#555', maxWidth: '52rem', lineHeight: 1.55 }}>
                  <strong>Fabric Peer ID</strong> is the canonical identity for this network: compressed secp256k1 (often shown as bech32m <code>id1…</code>). Signed P2P <code>Message</code> frames bind to that key so recipients can verify authenticity; TCP sessions and inventory relay line up with the same id once <strong>P2P id</strong> is confirmed. Mesh rows show the hub signaling id until the peer is proven on the Fabric wire (<strong>Signaled</strong>). Connection cells use <code>identity@host:port</code> (TCP listen or WebRTC signaling reachability).
                </p>
              </div>
            </div>
          </section>

          {!networkStatus ? (
            <div
              role="status"
              aria-live="polite"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75em',
                flexWrap: 'wrap',
                padding: '1rem 0 0.25rem',
                color: '#555'
              }}
            >
              <Loader active inline size="small" />
              <span>Connecting to hub and loading Fabric network status (Fabric Peer ID, Bitcoin height)…</span>
            </div>
          ) : (
            <>
              <Divider section />
              <Grid stackable>
                <Grid.Row verticalAlign="middle">
                  <Grid.Column computer={10} tablet={16}>
                    <Header as="h3" size="small" style={{ marginTop: 0 }}>
                      <Header.Content>
                        This hub
                        <Label
                          size="small"
                          style={{ marginLeft: '0.5em', verticalAlign: 'middle' }}
                          color={bridgeFabricPaused ? 'yellow' : (isOnline ? 'green' : 'grey')}
                        >
                          {isOnline ? (bridgeFabricPaused ? 'Fabric paused' : 'Fabric online') : 'Offline'}
                        </Label>
                      </Header.Content>
                    </Header>
                    <p style={{ margin: '0.25em 0 0.5em', color: '#666', fontSize: '0.92em' }}>
                      <strong>Fabric state:</strong> {(state && state.status) || 'unknown'}
                      {bridgeFabricPaused ? ' — hub reachable; Fabric P2P idle until started.' : ''}
                    </p>
                    {(shareNodeId || hostPort) ? (
                      <List relaxed size="small" style={{ marginBottom: '0.5em' }}>
                        {shareNodeId ? (
                          <List.Item>
                            <List.Header>{fabricPeerId ? 'Fabric Peer ID' : 'Node ID (legacy)'}</List.Header>
                            <List.Description>
                              <code
                                style={{ wordBreak: 'break-all', fontSize: '0.88em', display: 'block', marginTop: '0.25em' }}
                                title={fabricPeerId ? 'Canonical secp256k1 identity for signed P2P messages and peer rows.' : 'Unstable — upgrade hub for fabricPeerId.'}
                              >{shareNodeId}</code>
                              {legacyUnstableId ? (
                                <span style={{ fontSize: '0.82em', color: '#886', display: 'block', marginTop: '0.35em' }}>
                                  Prefer <code>fabricPeerId</code> from the hub for sharing; legacy ids can change with contract state.
                                </span>
                              ) : null}
                            </List.Description>
                          </List.Item>
                        ) : null}
                        {hostPort ? (
                          <List.Item>
                            <List.Header>TCP listen</List.Header>
                            <List.Description>
                              <code style={{ wordBreak: 'break-all', fontSize: '0.88em' }}>{hostPort}</code>
                            </List.Description>
                          </List.Item>
                        ) : null}
                      </List>
                    ) : null}
                    {shareableString ? (
                      <Button
                        size="small"
                        basic
                        icon
                        labelPosition="left"
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
                        title="Copy Fabric Peer ID and listen address"
                      >
                        <Icon name="copy" />
                        Copy Fabric Peer ID + listen
                      </Button>
                    ) : null}
                  </Grid.Column>
                  <Grid.Column computer={6} tablet={16}>
                    <Header as="h3" size="small" style={{ marginTop: 0 }}>Chain &amp; mempool</Header>
                    <Statistic.Group size="mini" widths={2}>
                      <Statistic>
                        <Statistic.Value>{chainHeight != null ? chainHeight : '—'}</Statistic.Value>
                        <Statistic.Label>Height</Statistic.Label>
                      </Statistic>
                      <Statistic>
                        <Statistic.Value text style={{ fontSize: '0.95rem', fontFamily: 'monospace' }}>
                          {tipFull ? (
                            uf.bitcoinExplorer ? (
                              <Link to={`/services/bitcoin/blocks/${encodeURIComponent(tipFull)}`} title={tipFull}>
                                {tipShort}
                              </Link>
                            ) : (
                              <span title={`${tipFull} — enable Bitcoin explorer routes in Admin → Feature visibility`}>{tipShort}</span>
                            )
                          ) : (
                            '—'
                          )}
                        </Statistic.Value>
                        <Statistic.Label>Tip</Statistic.Label>
                      </Statistic>
                    </Statistic.Group>
                    <p style={{ margin: '0.35em 0 0', fontSize: '0.88em', color: '#666' }}>
                      <strong>Network:</strong> {btcNetwork || '—'}
                      {mempoolN != null ? (
                        <span>
                          {' · '}
                          <strong>Mempool:</strong> {mempoolN} tx
                        </span>
                      ) : null}
                      {' · '}
                      <strong>Peers in view:</strong> {unifiedPeers.length} (TCP + mesh)
                    </p>
                    {bitcoin && bitcoin.available === false && bitcoin.message ? (
                      <Message warning size="small" style={{ marginTop: '0.65em' }} content={bitcoin.message} />
                    ) : null}
                    <Message info size="small" style={{ marginTop: '0.65em' }}>
                      <p style={{ margin: 0, fontWeight: 600, color: '#333' }}>Block relay</p>
                      <p style={{ margin: '0.35em 0 0', fontSize: '0.92em', lineHeight: 1.45 }}>
                        On new tip (ZMQ <code>hashblock</code>), this hub signs <code>BitcoinBlock</code> P2P messages; peers relay the same wire bytes (duplicates dropped). Compare height and tip with peers after <code>addnode</code> or long regtest chains.
                      </p>
                    </Message>
                    {!(adminPeerToolsToken && String(adminPeerToolsToken).trim()) ? (
                      <p style={{ margin: '0.65em 0 0', fontSize: '0.82em', color: '#777' }}>
                        <strong>Operator tools:</strong> sign in under Settings → Admin (hub admin token) to send <code>P2P_FLUSH_CHAIN</code> to highly trusted peers from this page.
                      </p>
                    ) : null}
                  </Grid.Column>
                </Grid.Row>

                {adminPeerToolsToken && String(adminPeerToolsToken).trim() && typeof onSendFlushChainToTrustedPeers === 'function' ? (
                  <Grid.Row>
                    <Grid.Column width={16}>
                      <Divider />
                      <Header as="h3" size="small" color="red">
                        <Icon name="warning sign" />
                        Operator — chain flush (trusted peers)
                      </Header>
                      <Message warning size="small">
                        <p style={{ margin: 0, lineHeight: 1.45 }}>
                          Sends signed <code>P2P_FLUSH_CHAIN</code> to every <strong>connected</strong> peer whose registry score is above the hub threshold (default 800). Peers that accept it may rewind toward <code>snapshotBlockHash</code> via <code>invalidateblock</code>. Use only with coordinated operators on regtest / playnet / signet / testnet.
                        </p>
                      </Message>
                      <Form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const h = String(this.state.flushChainSnapshot || '').trim();
                          if (!/^[0-9a-fA-F]{64}$/.test(h)) {
                            toast.error('Snapshot must be 64 hex characters (known-good tip after reset).', { header: 'Chain flush' });
                            return;
                          }
                          onSendFlushChainToTrustedPeers({
                            snapshotBlockHash: h.toLowerCase(),
                            network: String(this.state.flushChainNetwork || '').trim() || undefined,
                            label: String(this.state.flushChainLabel || '').trim() || undefined
                          });
                          toast.info('Flush chain request sent — check hub logs and peer bitcoinds.', { header: 'P2P_FLUSH_CHAIN', autoClose: 6000 });
                        }}
                        style={{ maxWidth: '40rem', marginTop: '0.5em' }}
                      >
                        <Form.Field>
                          <label htmlFor="flush-chain-snapshot">Known-good tip (<code>getbestblockhash</code>)</label>
                          <Input
                            id="flush-chain-snapshot"
                            placeholder="64-character hex block hash"
                            value={this.state.flushChainSnapshot}
                            onChange={(e) => this.setState({ flushChainSnapshot: e.target.value })}
                            autoComplete="off"
                          />
                        </Form.Field>
                        <Form.Field>
                          <label htmlFor="flush-chain-network">Network</label>
                          <Input
                            id="flush-chain-network"
                            placeholder="playnet"
                            value={this.state.flushChainNetwork}
                            onChange={(e) => this.setState({ flushChainNetwork: e.target.value })}
                          />
                        </Form.Field>
                        <Form.Field>
                          <label htmlFor="flush-chain-label">Label (logs)</label>
                          <Input
                            id="flush-chain-label"
                            placeholder="e.g. federation-round-3-baseline"
                            value={this.state.flushChainLabel}
                            onChange={(e) => this.setState({ flushChainLabel: e.target.value })}
                          />
                        </Form.Field>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
                          <Button
                            type="button"
                            size="small"
                            basic
                            disabled={!tipFull}
                            onClick={() => this.setState({ flushChainSnapshot: tipFull || '' })}
                            title={tipFull ? 'Fill from hub Bitcoin tip in network status' : 'No tip in status'}
                          >
                            Use current tip from status
                          </Button>
                          <Button type="submit" size="small" color="red">
                            <Icon name="send" />
                            Send P2P_FLUSH_CHAIN
                          </Button>
                        </div>
                      </Form>
                    </Grid.Column>
                  </Grid.Row>
                ) : null}

                <Grid.Row>
                  <Grid.Column width={16}>
                    <Divider />
                    <Header as="h3" size="small">Primary authority &amp; Payjoin (BIP 77)</Header>
                    <p style={{ margin: '0.35em 0 0', color: '#444', lineHeight: 1.5, maxWidth: '52rem' }}>
                      Use a long-lived hub (e.g. <code>hub.fabric.pub</code>) as <strong>primary authority</strong>: Fabric TCP carries <code>BitcoinBlock</code> gossip and trust scores. Payjoin v2 (directory + HPKE + OHTTP):{' '}
                      <a href="https://payjoin.org/docs/how-it-works/payjoin-v2-bip-77" target="_blank" rel="noreferrer">payjoin.org — BIP 77</a>.
                      {' '}This build uses BIP77 deposit sessions and BIP78 <code>pj=</code> where enabled; full v2 directory flows are a future integration.
                    </p>
                    <Message info size="small" style={{ marginTop: '0.65em', maxWidth: '52rem' }}>
                      <Message.Header>Regtest coins from another hub</Message.Header>
                      <p style={{ margin: '0.35em 0 0', lineHeight: 1.45, fontSize: '0.95em' }}>
                        Fabric peers do not move on-chain value. For playnet L1 when your local <Link to="/services/bitcoin/faucet">faucet</Link> is dry,
                        sync Bitcoin P2P (see <Link to="/services/bitcoin">Bitcoin</Link> → Network), then request sats from a hub that still has wallet balance — e.g.{' '}
                        <a href="https://hub.fabric.pub/services/bitcoin/faucet" target="_blank" rel="noopener noreferrer">hub.fabric.pub/services/bitcoin/faucet</a>
                        {' '}(same <code>bcrt1…</code> receive address as on your Faucet page).
                      </p>
                    </Message>
                    {isLoggedIn && typeof onAddPeer === 'function' ? (
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
                        <span style={{ color: '#666', fontSize: '0.88em' }}>
                          Saved primary: <code>{readPrimaryPeerAddress()}</code> — sorted first when connected.
                        </span>
                      </div>
                    ) : null}
                  </Grid.Column>
                </Grid.Row>

                <Grid.Row>
                  <Grid.Column width={16}>
                    <Divider />
                    <Header as="h3" size="small">
                      <Icon name="video" />
                      {' '}
                      Browser mesh (WebRTC signaling)
                      <Label size="small" color={webrtcCombined.length > 0 ? 'blue' : 'grey'} style={{ marginLeft: '0.5em' }}>
                        {webrtcCombined.length} registered
                      </Label>
                      {webrtcPeers.length > 0 ? (
                        <Label size="small" basic color="blue" style={{ marginLeft: '0.35em' }} title="Hub signaling registry (may overlap mesh)">
                          {webrtcPeers.length} signaling
                        </Label>
                      ) : null}
                      {localWebrtcPeers.length > 0 ? (
                        <Label size="small" basic color="teal" style={{ marginLeft: '0.35em' }}>
                          {localWebrtcPeers.length} local mesh
                        </Label>
                      ) : null}
                    </Header>
                    {meshStatus ? (
                      <p style={{ margin: '0.35em 0 0.65em', color: '#555', fontSize: '0.92em' }}>
                        <strong>Your signaling id:</strong>{' '}
                        <code style={{ fontSize: '0.85em' }}>{meshStatus.peerId || 'initializing…'}</code>
                        {' · '}
                        <strong>Mesh:</strong> {meshStatus.connected}/{meshStatus.maxPeers} connected
                        {meshStatus.connecting > 0 ? `, ${meshStatus.connecting} connecting` : ''}
                        {' · '}
                        <strong>Ready:</strong> {meshStatus.ready ? 'yes' : 'no'}
                      </p>
                    ) : (
                      <p style={{ margin: '0.35em 0 0.65em', color: '#666', fontSize: '0.92em' }}>
                        Native WebRTC through this hub; rows below correlate to <strong>Fabric Peer ID</strong> when P2P identity is confirmed.
                      </p>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap', marginBottom: '0.5em' }}>
                      {typeof onRepublishWebRTCOffer === 'function' ? (
                        <Button size="small" basic onClick={onRepublishWebRTCOffer} title="Republish your offer to hub signaling">
                          <Icon name="refresh" />
                          Republish offer
                        </Button>
                      ) : null}
                      {meshStatus && meshStatus.slotsAvailable > 0 && typeof onDiscoverWebRTCPeers === 'function' ? (
                        <>
                          <Button
                            size="small"
                            primary
                            onClick={onDiscoverWebRTCPeers}
                            title={`Discover peers (${meshStatus.slotsAvailable} slots)`}
                          >
                            <Icon name="search" />
                            Discover peers
                          </Button>
                          <span style={{ color: '#666', fontSize: '0.88em' }}>
                            {meshStatus.slotsAvailable} slot{meshStatus.slotsAvailable !== 1 ? 's' : ''} free
                          </span>
                        </>
                      ) : null}
                      {typeof onConnectWebRTCPeer === 'function' ? (
                        <Button size="small" basic onClick={this._openConnectPeerModal} title="Connect by hub signaling id">
                          <Icon name="plug" />
                          Connect to signaling id…
                        </Button>
                      ) : null}
                      {meshStatus && meshStatus.connected > 0 && typeof onSendWebRTCTestPing === 'function' ? (
                        <Button
                          size="small"
                          basic
                          onClick={() => {
                            try {
                              onSendWebRTCTestPing();
                            } catch (e) {}
                          }}
                          title="Test ping to all mesh peers"
                        >
                          <Icon name="signal" />
                          Ping mesh
                        </Button>
                      ) : null}
                      {localWebrtcPeers.length > 0 && typeof onDisconnectAllWebRTCPeers === 'function' ? (
                        <Button
                          size="small"
                          basic
                          color="red"
                          onClick={() => {
                            try {
                              onDisconnectAllWebRTCPeers();
                            } catch (e) {}
                          }}
                          title="Disconnect all local mesh links"
                        >
                          <Icon name="unlink" />
                          Disconnect all
                        </Button>
                      ) : null}
                    </div>
                    <p style={{ color: '#666', fontStyle: 'italic', margin: 0, lineHeight: 1.45, fontSize: '0.9em' }}>
                      Mesh peers appear in <strong>Fabric peers</strong> below with a <strong>Mesh</strong> tag, reputation <strong>score</strong> / <strong>misbehavior</strong>, and detail route <code>/peers/&lt;Fabric Peer ID&gt;</code>. Oversized frames, bad gossip, or invalid JSON can trigger disconnects.
                    </p>
                  </Grid.Column>
                </Grid.Row>

                {topologyDot ? (
                  <Grid.Row>
                    <Grid.Column width={16}>
                      <Divider />
                      <section aria-labelledby="peers-topology-h3" aria-describedby="peers-topology-desc">
                        <Header as="h3" size="small" id="peers-topology-h3">Peer topology</Header>
                        <p id="peers-topology-desc" style={{ color: '#666', marginBottom: '0.65em', lineHeight: 1.45 }}>
                          <strong>Solid</strong> edges: TCP peers in this snapshot. <strong>Dotted</strong>: ids from <code>P2P_PEER_GOSSIP</code> (~20 min client cache). Use peer detail <strong>Docs</strong> for <code>INVENTORY_REQUEST</code>; add TCP peers for ids you need directly.
                        </p>
                        <GraphDocumentPreview dotSource={topologyDot} skipIdentityGate />
                        <details style={{ marginTop: '0.65rem' }}>
                          <summary style={{ cursor: 'pointer', color: '#555' }}>DOT source</summary>
                          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', background: '#f7f7f7', padding: '0.5rem', borderRadius: 4 }}>{topologyDot}</pre>
                        </details>
                      </section>
                    </Grid.Column>
                  </Grid.Row>
                ) : null}
              </Grid>
            </>
          )}
        </Segment>

        {networkStatus ? (
          <Segment style={{ borderRadius: 4, marginTop: '1rem', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75em', flexWrap: 'wrap', marginBottom: '0.35em' }}>
              <div>
                <Header as="h3" style={{ margin: 0 }}>
                  Fabric peers
                  <Label size="small" basic color="green" style={{ marginLeft: '0.5em', verticalAlign: 'middle' }}>
                    {unifiedPeers.length} in view
                  </Label>
                </Header>
                <p style={{ margin: '0.35em 0 0', color: '#666', fontSize: '0.9em' }}>
                  {fabricPeersSorted.filter((p) => !isWebrtcTransportPeerRow(p)).length} TCP ·{' '}
                  {fabricPeersSorted.filter((p) => isWebrtcTransportPeerRow(p)).length} mesh (hub status)
                  {webrtcExtraRows.length > 0 ? ` · ${webrtcExtraRows.length} mesh (local only)` : ''}
                </p>
              </div>
              {isLoggedIn ? (
                <Button.Group size="small">
                  {typeof onRefreshPeers === 'function' ? (
                    <Button icon labelPosition="left" onClick={onRefreshPeers} title="Refresh peer list">
                      <Icon name="refresh" />
                      Refresh
                    </Button>
                  ) : null}
                  <Button
                    primary
                    type="button"
                    onClick={() => {
                      if (typeof onAddPeer !== 'function') return;
                      this._openAddPeerModal();
                    }}
                  >
                    <Icon name="add" />
                    Add peer
                  </Button>
                </Button.Group>
              ) : null}
            </div>
            {unifiedPeers.length > 0 ? (
              <UnifiedPeersPaginatedList
                unifiedPeers={unifiedPeers}
                primaryPeerNorm={primaryPeerNorm}
                signalingHostPort={signalingHostPort}
                globalPeers={globalPeers}
                onDisconnectWebRTCPeer={onDisconnectWebRTCPeer}
                onFabricPeerResync={onFabricPeerResync}
              />
            ) : (
              <p style={{ color: '#666', fontStyle: 'italic', marginTop: '0.5em', lineHeight: 1.45 }}>
                No TCP or mesh peers yet. Add <code>{DEFAULT_PRIMARY_FABRIC_HUB}</code> or <strong>Add peer</strong> for Fabric <code>host:port</code> (<code>7777</code>). Browsers register for WebRTC; connected mesh rows show <strong>Mesh</strong> and reputation.
              </p>
            )}
          </Segment>
        ) : null}

        <Segment basic style={{ marginTop: '1rem', paddingTop: 0 }} id="peers-page-footer">
          <Divider />
          <p style={{ margin: 0, color: '#777', fontSize: '0.88em', lineHeight: 1.5, maxWidth: '52rem' }}>
            <strong>Protocol:</strong> Fabric P2P uses secp256k1-signed <code>Message</code> envelopes; the header <code>hash</code> is double-SHA256 of the body so tampering is detected. Sessions and inventory are attributed to the same <strong>Fabric Peer ID</strong> once the TCP path confirms identity. For field semantics see <code>fabric/docs/MESSAGE_SECURITY.md</code> in the Fabric repo.
          </p>
        </Segment>

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
          <Modal.Header>Connect to WebRTC signaling id</Modal.Header>
          <Modal.Content>
            <p style={{ marginTop: 0, color: '#555', fontSize: '0.92em', lineHeight: 1.45 }}>
              Hub-registered signaling id (e.g. <code>fabric-bridge-…</code>). After the mesh links, traffic is still attributed to <strong>Fabric Peer ID</strong> when the bridge confirms P2P identity.
            </p>
            <Form onSubmit={(e) => { e.preventDefault(); this._submitConnectPeerModal(); }}>
              <Form.Field>
                <label htmlFor="peers-connect-peer-id">WebRTC signaling id</label>
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
