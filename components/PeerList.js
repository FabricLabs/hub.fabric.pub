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
  peerNativePeeringString,
  fabricP2PIdentityConfirmed,
  consolidateUnifiedPeersByFabricId,
  buildWebrtcCombinedRows,
  webrtcCombinedToFabricPeerRows,
  mergeTcpAndWebrtcPeerRows,
  isWebrtcTransportPeerRow,
  sortFabricPeersMostRecentFirst,
  sortFabricPeersByColumn,
  fabricPeerWindowBytes
} = require('../functions/peerIdentity');
const {
  formatPeerBytes,
  inventoryDocCountForFabricPeer
} = require('../functions/peerListFormat');
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
const strings = require('../locales/en');

const common = strings.common;
const net = strings.network;
const pl = net.peerList;
const plt = pl.table;

const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0
};

/** Default “primary authority” Fabric TCP peer — long-lived hub, high trust, Bitcoin head reference. */
const DEFAULT_PRIMARY_FABRIC_HUB = 'hub.fabric.pub:7777';
const DEFAULT_RELAY_PEER = 'relay.goon.vc:7777';
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

function UnifiedPeersPaginatedList ({
  unifiedPeers,
  primaryPeerNorm,
  signalingHostPort,
  globalPeers,
  onDisconnectWebRTCPeer,
  onFabricPeerResync
}) {
  const navigate = useNavigate();
  const [sortColumn, setSortColumn] = React.useState('seen');
  const [sortDirection, setSortDirection] = React.useState('descending');
  const sortedPeers = sortFabricPeersByColumn(unifiedPeers, sortColumn, sortDirection);
  const first = sortedPeers.at(0);
  const last = sortedPeers.length ? sortedPeers.at(-1) : null;
  const resetKey = `${sortedPeers.length}:${sortColumn}:${sortDirection}:${first && (first.id || first.address)}:${last && (last.id || last.address)}`;
  const {
    slice,
    page,
    totalPages,
    rangeFrom,
    rangeTo,
    total,
    setPage
  } = useHubListPagination(sortedPeers, resetKey);

  const sigHp = String(signalingHostPort || '').trim();
  const gp = globalPeers && typeof globalPeers === 'object' ? globalPeers : null;

  const handleSort = (col) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === 'ascending' ? 'descending' : 'ascending'));
      return;
    }
    const numeric = col === 'bytes' || col === 'window' || col === 'status' || col === 'seen';
    setSortColumn(col);
    setSortDirection(numeric ? 'descending' : 'ascending');
  };

  const headerSorted = (col) => (sortColumn === col ? sortDirection : null);

  return (
    <>
      <Table
        compact
        celled
        striped
        selectable
        sortable
        size="small"
        unstackable
        style={{ marginTop: '0.75em', tableLayout: 'fixed' }}
      >
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell
              sorted={headerSorted('id')}
              onClick={() => handleSort('id')}
              style={{ width: '22%' }}
            >
              {plt.columns.id}
            </Table.HeaderCell>
            <Table.HeaderCell
              sorted={headerSorted('connection')}
              onClick={() => handleSort('connection')}
              style={{ width: '22%' }}
            >
              {plt.columns.address}
            </Table.HeaderCell>
            <Table.HeaderCell
              sorted={headerSorted('status')}
              onClick={() => handleSort('status')}
              style={{ width: '12%' }}
              textAlign="center"
            >
              {plt.columns.status}
            </Table.HeaderCell>
            <Table.HeaderCell
              sorted={headerSorted('bytes')}
              onClick={() => handleSort('bytes')}
              style={{ width: '14%' }}
              textAlign="right"
            >
              {plt.columns.bytes}
            </Table.HeaderCell>
            <Table.HeaderCell
              sorted={headerSorted('window')}
              onClick={() => handleSort('window')}
              style={{ width: '16%' }}
              textAlign="right"
              title={plt.columns.windowTitle}
            >
              {plt.columns.window}
            </Table.HeaderCell>
            <Table.HeaderCell
              sorted={headerSorted('seen')}
              onClick={() => handleSort('seen')}
              style={{ width: '10%' }}
            >
              {plt.columns.seen}
            </Table.HeaderCell>
            <Table.HeaderCell collapsing textAlign="right" disabled>
              <span style={VISUALLY_HIDDEN}>{plt.columns.actions}</span>
            </Table.HeaderCell>
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
            const meshAlias = peer && peer.alias && String(peer.alias).trim();
            const nickname = peer && peer.nickname && String(peer.nickname).trim();
            const humanLabel = meshAlias || nickname;
            const lastSeen = peer && (peer.lastSeen || peer.lastMessage);
            const addrNorm = normalizeFabricPeerAddress(address);
            const isPrimaryRow = !meshRow && primaryPeerNorm && (addrNorm === primaryPeerNorm || String(address) === primaryPeerNorm);
            const connectionStr = peerNativePeeringString(peer, sigHp) || common.none;
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
              meshRow ? plt.tags.browser : null,
              isPrimaryRow ? plt.tags.primary : null,
              p2pConfirmed ? plt.tags.verified : null,
              (!p2pConfirmed && bech32Id && meshRow) ? plt.tags.unverified : null,
              invN != null && invN > 0 ? plt.tags.documents(invN) : null,
              score != null ? plt.tags.trust(score) : null,
              meshRow && misbehavior != null && misbehavior > 0 ? plt.tags.warnings(misbehavior) : null
            ].filter(Boolean).join(' · ');
            const seenShort = lastSeen
              ? new Date(lastSeen).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              : common.none;
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
                  {humanLabel ? (
                    <div style={{ fontSize: '0.78rem', color: '#767676', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={
                      meshAlias && nickname && meshAlias !== nickname
                        ? plt.nicknameTitle(meshAlias, nickname)
                        : humanLabel
                    }>
                      {humanLabel}
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
                    {meshRow ? <Icon name="exchange" color="teal" title={plt.icons.browser} /> : null}
                    {isPrimaryRow ? <Icon name="star" color="yellow" title={plt.icons.primary} /> : null}
                    {p2pConfirmed ? <Icon name="shield" color="blue" title={plt.icons.verified} /> : null}
                    {invN != null && invN > 0 ? (
                      <Icon name="book" color="violet" title={plt.icons.documents(invN)} />
                    ) : null}
                    <Icon
                      name={isConnected ? 'check circle' : 'minus circle'}
                      color={isConnected ? 'green' : 'grey'}
                      title={status}
                    />
                    <span style={{ marginLeft: '0.25em', color: isConnected ? '#21ba45' : '#767676' }}>
                      {isConnected
                        ? plt.status.online
                        : (meshRow && status === 'signaling' ? plt.status.connecting : plt.status.offline)}
                    </span>
                  </span>
                </Table.Cell>
                <Table.Cell textAlign="right" style={{ verticalAlign: 'middle', fontSize: '0.8rem', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {(() => {
                    const inn = peer && peer.bytesIn;
                    const out = peer && peer.bytesOut;
                    if (inn == null && out == null) return common.none;
                    return `${formatPeerBytes(inn)} / ${formatPeerBytes(out)}`;
                  })()}
                </Table.Cell>
                <Table.Cell
                  textAlign="right"
                  style={{
                    verticalAlign: 'middle',
                    fontSize: '0.8rem',
                    whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                    color: peer && peer.overBudget ? '#9f3a38' : '#666'
                  }}
                  title={peer && peer.budgetBytes
                    ? plt.windowCellTitle(formatPeerBytes(peer.budgetBytes))
                    : plt.windowCellTitleDefault}
                >
                  {(() => {
                    const used = fabricPeerWindowBytes(peer);
                    const budget = peer && Number(peer.budgetBytes);
                    if (!used && !(Number.isFinite(budget) && budget > 0) && !(peer && peer.bytesIn) && !(peer && peer.bytesOut)) {
                      return common.none;
                    }
                    const budgetLabel = Number.isFinite(budget) && budget > 0 ? formatPeerBytes(budget) : '32 KiB';
                    return `${formatPeerBytes(used)} / ${budgetLabel}`;
                  })()}
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
                      title={plt.disconnectBrowser}
                      aria-label={plt.disconnectBrowser}
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
                      title={plt.resync}
                      aria-label={plt.resync}
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
            {net.range(rangeFrom, rangeTo, total)}
          </span>
          <HubPagination
            activePage={page}
            totalPages={totalPages}
            onPageChange={(e, d) => setPage(d.activePage)}
            style={{ marginTop: 0, flex: '1 1 auto', minWidth: 0 }}
          />
        </div>
      )}
      <p style={{ color: '#767676', fontSize: '0.82em', marginTop: '0.65em', lineHeight: 1.45 }}>
        {plt.note}
      </p>
    </>
  );
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
      toast.warning(pl.addModal.invalid, { header: pl.addModal.title });
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
    const isLoggedIn = !!(auth && auth.id);
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
    // Single dial pin for operators / peers: pubkey@host:port (matches Peer#_connect).
    const shareableString = (shareNodeId && hostPort)
      ? `${shareNodeId}@${hostPort}`
      : (shareNodeId || hostPort || '');

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
    const fabricPeersSorted = sortFabricPeersMostRecentFirst(dedupeFabricPeers(fabricPeers));

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

    const unifiedPeers = sortFabricPeersMostRecentFirst(
      consolidateUnifiedPeersByFabricId(
        mergeTcpAndWebrtcPeerRows(fabricPeersWithRep, webrtcExtraRows, primaryPeerNorm)
      )
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
        selfLabel: pl.selfLabel,
        directPeers: fabricPeersSorted,
        gossip: topologyGossip
      })
      : null;

    return (
      <fabric-hub-peers class='fade-in' data-testid="hub-peers-page">
        <Segment style={{ clear: 'both', borderRadius: 4, boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
          <section aria-labelledby="peers-page-heading" aria-describedby="peers-page-summary">
            <div
              style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75em', flexWrap: 'wrap', marginBottom: '0.5em' }}
              role="banner"
            >
              <Button basic size="small" as={Link} to="/">
                <Icon name="arrow left" aria-hidden="true" />
                {pl.home}
              </Button>
              <div style={{ flex: '1 1 14rem', minWidth: 0 }}>
                <Header as="h2" id="peers-page-heading" style={{ margin: 0 }}>
                  <Header.Content>{pl.title}</Header.Content>
                </Header>
                <p id="peers-page-summary" style={{ margin: '0.4em 0 0', color: '#555', maxWidth: '52rem', lineHeight: 1.55 }}>
                  {pl.intro}
                </p>
                <details className="hub-developer-details" style={{ marginTop: '0.4em', maxWidth: '52rem' }}>
                  <summary style={{ cursor: 'pointer', color: '#555' }}>{common.developerDetails}</summary>
                  <p style={{ margin: '0.35em 0 0', color: '#666', fontSize: '0.9em', lineHeight: 1.5 }}>{pl.introDeveloper}</p>
                </details>
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
              <span>{pl.loading}</span>
            </div>
          ) : (
            <>
              <Divider section />
              <Grid stackable>
                <Grid.Row verticalAlign="middle">
                  <Grid.Column computer={10} tablet={16}>
                    <Header as="h3" size="small" style={{ marginTop: 0 }}>
                      <Header.Content>
                        {pl.self.heading}
                        <Label
                          size="small"
                          style={{ marginLeft: '0.5em', verticalAlign: 'middle' }}
                          color={bridgeFabricPaused ? 'yellow' : (isOnline ? 'green' : 'grey')}
                        >
                          {isOnline ? (bridgeFabricPaused ? pl.self.paused : pl.self.online) : pl.self.offline}
                        </Label>
                      </Header.Content>
                    </Header>
                    <p style={{ margin: '0.25em 0 0.5em', color: '#666', fontSize: '0.92em' }}>
                      <strong>{pl.self.state}</strong> {(state && state.status) || pl.self.stateUnknown}
                      {bridgeFabricPaused ? <> {pl.self.pausedHint}</> : null}
                    </p>
                    {(shareNodeId || hostPort) ? (
                      <List relaxed size="small" style={{ marginBottom: '0.5em' }}>
                        {shareNodeId ? (
                          <List.Item>
                            <List.Header>{fabricPeerId ? pl.self.peerId : pl.self.legacyId}</List.Header>
                            <List.Description>
                              <code
                                style={{ wordBreak: 'break-all', fontSize: '0.88em', display: 'block', marginTop: '0.25em' }}
                                title={fabricPeerId ? pl.self.peerIdTitle : pl.self.legacyIdTitle}
                              >{shareNodeId}</code>
                              {legacyUnstableId ? (
                                <span style={{ fontSize: '0.82em', color: '#886', display: 'block', marginTop: '0.35em' }}>
                                  {pl.self.legacyIdNote}
                                </span>
                              ) : null}
                            </List.Description>
                          </List.Item>
                        ) : null}
                        {hostPort ? (
                          <List.Item>
                            <List.Header>{pl.self.listen}</List.Header>
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
                            toast.success(pl.self.copied);
                          } catch (e) {}
                        }}
                        title={pl.self.copyAddressTitle}
                      >
                        <Icon name="copy" />
                        {pl.self.copyAddress}
                      </Button>
                    ) : null}
                  </Grid.Column>
                  <Grid.Column computer={6} tablet={16}>
                    <Header as="h3" size="small" style={{ marginTop: 0 }}>{pl.chain.heading}</Header>
                    <Statistic.Group size="mini" widths={2}>
                      <Statistic>
                        <Statistic.Value>{chainHeight != null ? chainHeight : common.none}</Statistic.Value>
                        <Statistic.Label>{pl.chain.height}</Statistic.Label>
                      </Statistic>
                      <Statistic>
                        <Statistic.Value text style={{ fontSize: '0.95rem', fontFamily: 'monospace' }}>
                          {tipFull ? (
                            uf.bitcoinExplorer ? (
                              <Link to={`/services/bitcoin/blocks/${encodeURIComponent(tipFull)}`} title={tipFull}>
                                {tipShort}
                              </Link>
                            ) : (
                              <span title={pl.chain.tipExplorerOff(tipFull)}>{tipShort}</span>
                            )
                          ) : (
                            common.none
                          )}
                        </Statistic.Value>
                        <Statistic.Label>{pl.chain.tip}</Statistic.Label>
                      </Statistic>
                    </Statistic.Group>
                    <p style={{ margin: '0.35em 0 0', fontSize: '0.88em', color: '#666' }}>
                      <strong>{pl.chain.network}</strong> {btcNetwork || common.none}
                      {mempoolN != null ? (
                        <span>
                          {' · '}
                          <strong>{pl.chain.mempool}</strong> {pl.chain.mempoolCount(mempoolN)}
                        </span>
                      ) : null}
                      {' · '}
                      <strong>{pl.chain.inView}</strong> {pl.chain.inViewCount(unifiedPeers.length)}
                    </p>
                    {bitcoin && bitcoin.available === false && bitcoin.message ? (
                      <Message warning size="small" style={{ marginTop: '0.65em' }} content={bitcoin.message} />
                    ) : null}
                    <Message info size="small" style={{ marginTop: '0.65em' }}>
                      <p style={{ margin: 0, fontWeight: 600, color: '#333' }}>{pl.chain.relayHeading}</p>
                      <p style={{ margin: '0.35em 0 0', fontSize: '0.92em', lineHeight: 1.45 }}>
                        {pl.chain.relayBody}
                      </p>
                      <details className="hub-developer-details" style={{ marginTop: '0.35em' }}>
                        <summary style={{ cursor: 'pointer' }}>{common.developerDetails}</summary>
                        <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', lineHeight: 1.45 }}>{pl.chain.relayDeveloper}</p>
                      </details>
                    </Message>
                    {!(adminPeerToolsToken && String(adminPeerToolsToken).trim()) ? (
                      <p style={{ margin: '0.65em 0 0', fontSize: '0.82em', color: '#777' }}>
                        {pl.chain.operatorHint}
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
                        {pl.flush.heading}
                      </Header>
                      <Message warning size="small">
                        <p style={{ margin: 0, lineHeight: 1.45 }}>
                          {pl.flush.warning}
                        </p>
                        <details className="hub-developer-details" style={{ marginTop: '0.35em' }}>
                          <summary style={{ cursor: 'pointer' }}>{common.developerDetails}</summary>
                          <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', lineHeight: 1.45 }}>{pl.flush.developer}</p>
                        </details>
                      </Message>
                      <Form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const h = String(this.state.flushChainSnapshot || '').trim();
                          if (!/^[0-9a-fA-F]{64}$/.test(h)) {
                            toast.error(pl.flush.invalidHash, { header: pl.flush.toastHeader });
                            return;
                          }
                          onSendFlushChainToTrustedPeers({
                            snapshotBlockHash: h.toLowerCase(),
                            network: String(this.state.flushChainNetwork || '').trim() || undefined,
                            label: String(this.state.flushChainLabel || '').trim() || undefined
                          });
                          toast.info(pl.flush.sent, { header: pl.flush.toastHeader, autoClose: 6000 });
                        }}
                        style={{ maxWidth: '40rem', marginTop: '0.5em' }}
                      >
                        <Form.Field>
                          <label htmlFor="flush-chain-snapshot">{pl.flush.hashLabel}</label>
                          <Input
                            id="flush-chain-snapshot"
                            placeholder={pl.flush.hashPlaceholder}
                            value={this.state.flushChainSnapshot}
                            onChange={(e) => this.setState({ flushChainSnapshot: e.target.value })}
                            autoComplete="off"
                          />
                        </Form.Field>
                        <Form.Field>
                          <label htmlFor="flush-chain-network">{pl.flush.networkLabel}</label>
                          <Input
                            id="flush-chain-network"
                            placeholder="playnet"
                            value={this.state.flushChainNetwork}
                            onChange={(e) => this.setState({ flushChainNetwork: e.target.value })}
                          />
                        </Form.Field>
                        <Form.Field>
                          <label htmlFor="flush-chain-label">{pl.flush.labelLabel}</label>
                          <Input
                            id="flush-chain-label"
                            placeholder={pl.flush.labelPlaceholder}
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
                            title={tipFull ? pl.flush.useTipTitle : pl.flush.noTipTitle}
                          >
                            {pl.flush.useTip}
                          </Button>
                          <Button type="submit" size="small" color="red">
                            <Icon name="send" />
                            {pl.flush.send}
                          </Button>
                        </div>
                      </Form>
                    </Grid.Column>
                  </Grid.Row>
                ) : null}

                <Grid.Row>
                  <Grid.Column width={16}>
                    <Divider />
                    <Header as="h3" size="small">{pl.primary.heading}</Header>
                    <p style={{ margin: '0.35em 0 0', color: '#444', lineHeight: 1.5, maxWidth: '52rem' }}>
                      {pl.primary.body}
                    </p>
                    <p style={{ margin: '0.35em 0 0', color: '#444', lineHeight: 1.5, maxWidth: '52rem' }}>
                      {pl.primary.payjoin}{' '}
                      <a href="https://payjoin.org/docs/how-it-works/payjoin-v2-bip-77" target="_blank" rel="noreferrer">{pl.primary.payjoinLink}</a>
                    </p>
                    <details className="hub-developer-details" style={{ marginTop: '0.35em', maxWidth: '52rem' }}>
                      <summary style={{ cursor: 'pointer', color: '#555' }}>{common.developerDetails}</summary>
                      <p style={{ margin: '0.35em 0 0', color: '#666', fontSize: '0.9em', lineHeight: 1.45 }}>{pl.primary.payjoinDeveloper}</p>
                    </details>
                    <Message info size="small" style={{ marginTop: '0.65em', maxWidth: '52rem' }}>
                      <Message.Header>{pl.primary.coinsHeading}</Message.Header>
                      <p style={{ margin: '0.35em 0 0', lineHeight: 1.45, fontSize: '0.95em' }}>
                        {pl.primary.coinsBefore} <Link to="/services/bitcoin/faucet">{pl.primary.coinsFaucet}</Link>{' '}
                        {pl.primary.coinsMiddle} <Link to="/services/bitcoin">{pl.primary.coinsBitcoin}</Link>{' '}
                        {pl.primary.coinsAfterBitcoin}{' '}
                        <a href="https://hub.fabric.pub/services/bitcoin/faucet" target="_blank" rel="noopener noreferrer">hub.fabric.pub/services/bitcoin/faucet</a>.
                        {' '}{pl.primary.coinsAfter}
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
                          title={pl.primary.addPrimaryTitle}
                        >
                          <Icon name="star" aria-hidden="true" />
                          {pl.primary.addPrimary(DEFAULT_PRIMARY_FABRIC_HUB)}
                        </Button>
                        <Button
                          size="small"
                          type="button"
                          onClick={() => {
                            onAddPeer({ address: DEFAULT_RELAY_PEER });
                          }}
                          title={pl.primary.addRelayTitle}
                        >
                          <Icon name="add" aria-hidden="true" />
                          {pl.primary.addRelay(DEFAULT_RELAY_PEER)}
                        </Button>
                        <span style={{ color: '#666', fontSize: '0.88em' }}>
                          {pl.primary.saved} <code>{readPrimaryPeerAddress()}</code>. {pl.primary.savedNote}
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
                      {pl.mesh.heading}
                      <Label size="small" color={webrtcCombined.length > 0 ? 'blue' : 'grey'} style={{ marginLeft: '0.5em' }}>
                        {pl.mesh.registered(webrtcCombined.length)}
                      </Label>
                      {webrtcPeers.length > 0 ? (
                        <Label size="small" basic color="blue" style={{ marginLeft: '0.35em' }} title={pl.mesh.onHubTitle}>
                          {pl.mesh.onHub(webrtcPeers.length)}
                        </Label>
                      ) : null}
                      {localWebrtcPeers.length > 0 ? (
                        <Label size="small" basic color="teal" style={{ marginLeft: '0.35em' }}>
                          {pl.mesh.local(localWebrtcPeers.length)}
                        </Label>
                      ) : null}
                    </Header>
                    {meshStatus ? (
                      <p style={{ margin: '0.35em 0 0.65em', color: '#555', fontSize: '0.92em' }}>
                        <strong>{pl.mesh.yourId}</strong>{' '}
                        <code style={{ fontSize: '0.85em' }}>{meshStatus.peerId || pl.mesh.starting}</code>
                        {' · '}
                        <strong>{pl.mesh.connected}</strong> {pl.mesh.connectedCount(meshStatus.connected, meshStatus.maxPeers)}
                        {meshStatus.connecting > 0 ? pl.mesh.connecting(meshStatus.connecting) : ''}
                        {' · '}
                        <strong>{pl.mesh.ready}</strong> {meshStatus.ready ? common.states.yes : common.states.no}
                      </p>
                    ) : (
                      <p style={{ margin: '0.35em 0 0.65em', color: '#666', fontSize: '0.92em' }}>
                        {pl.mesh.intro}
                      </p>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap', marginBottom: '0.5em' }}>
                      {typeof onRepublishWebRTCOffer === 'function' ? (
                        <Button size="small" basic onClick={onRepublishWebRTCOffer} title={pl.mesh.republishTitle}>
                          <Icon name="refresh" />
                          {pl.mesh.republish}
                        </Button>
                      ) : null}
                      {meshStatus && meshStatus.slotsAvailable > 0 && typeof onDiscoverWebRTCPeers === 'function' ? (
                        <>
                          <Button
                            size="small"
                            primary
                            onClick={onDiscoverWebRTCPeers}
                            title={pl.mesh.discoverTitle(meshStatus.slotsAvailable)}
                          >
                            <Icon name="search" />
                            {pl.mesh.discover}
                          </Button>
                          <span style={{ color: '#666', fontSize: '0.88em' }}>
                            {pl.mesh.slotsFree(meshStatus.slotsAvailable)}
                          </span>
                        </>
                      ) : null}
                      {typeof onConnectWebRTCPeer === 'function' ? (
                        <Button size="small" basic onClick={this._openConnectPeerModal} title={pl.mesh.connectByIdTitle}>
                          <Icon name="plug" />
                          {pl.mesh.connectById}
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
                          title={pl.mesh.pingTitle}
                        >
                          <Icon name="signal" />
                          {pl.mesh.ping}
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
                          title={pl.mesh.disconnectAllTitle}
                        >
                          <Icon name="unlink" />
                          {pl.mesh.disconnectAll}
                        </Button>
                      ) : null}
                    </div>
                    <p style={{ color: '#666', fontStyle: 'italic', margin: 0, lineHeight: 1.45, fontSize: '0.9em' }}>
                      {pl.mesh.note}
                    </p>
                  </Grid.Column>
                </Grid.Row>

                {topologyDot ? (
                  <Grid.Row>
                    <Grid.Column width={16}>
                      <Divider />
                      <section aria-labelledby="peers-topology-h3" aria-describedby="peers-topology-desc">
                        <Header as="h3" size="small" id="peers-topology-h3">{pl.topology.heading}</Header>
                        <p id="peers-topology-desc" style={{ color: '#666', marginBottom: '0.65em', lineHeight: 1.45 }}>
                          {pl.topology.description}
                        </p>
                        <GraphDocumentPreview dotSource={topologyDot} skipIdentityGate />
                        <details className="hub-developer-details" style={{ marginTop: '0.65rem' }}>
                          <summary style={{ cursor: 'pointer', color: '#555' }}>{net.dotSource}</summary>
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
                  {plt.heading}
                  <Label size="small" basic color="green" style={{ marginLeft: '0.5em', verticalAlign: 'middle' }}>
                    {plt.inView(unifiedPeers.length)}
                  </Label>
                </Header>
                <p style={{ margin: '0.35em 0 0', color: '#666', fontSize: '0.9em' }}>
                  {plt.counts(
                    fabricPeersSorted.filter((p) => !isWebrtcTransportPeerRow(p)).length,
                    fabricPeersSorted.filter((p) => isWebrtcTransportPeerRow(p)).length
                  )}
                  {webrtcExtraRows.length > 0 ? plt.localOnly(webrtcExtraRows.length) : ''}
                </p>
              </div>
              {isLoggedIn ? (
                <Button.Group size="small">
                  {typeof onRefreshPeers === 'function' ? (
                    <Button icon labelPosition="left" onClick={onRefreshPeers} title={plt.refreshTitle}>
                      <Icon name="refresh" />
                      {common.actions.refresh}
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
                    {plt.add}
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
                {plt.emptyBefore} <code>{DEFAULT_PRIMARY_FABRIC_HUB}</code> {plt.emptyAnd} <code>{DEFAULT_RELAY_PEER}</code>{plt.emptyAfter}
              </p>
            )}
          </Segment>
        ) : null}

        <Segment basic style={{ marginTop: '1rem', paddingTop: 0 }} id="peers-page-footer">
          <Divider />
          <p style={{ margin: 0, color: '#777', fontSize: '0.88em', lineHeight: 1.5, maxWidth: '52rem' }}>
            <strong>{pl.footer.heading}</strong> {pl.footer.body}
          </p>
          <details className="hub-developer-details" style={{ marginTop: '0.35em', maxWidth: '52rem' }}>
            <summary style={{ cursor: 'pointer', color: '#777', fontSize: '0.88em' }}>{common.developerDetails}</summary>
            <p style={{ margin: '0.35em 0 0', color: '#777', fontSize: '0.85em', lineHeight: 1.5 }}>{pl.footer.developer}</p>
          </details>
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
          <Modal.Header>{pl.addModal.title}</Modal.Header>
          <Modal.Content>
            <p style={{ marginTop: 0, color: '#555' }}>
              {pl.addModal.intro}
            </p>
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                this._submitAddPeer();
              }}
            >
              <Form.Field>
                <label htmlFor="fabric-add-peer-address">{pl.addModal.label}</label>
                <Input
                  id="fabric-add-peer-address"
                  placeholder={pl.addModal.placeholder}
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
              {common.actions.cancel}
            </Button>
            <Button type="button" primary onClick={this._submitAddPeer}>
              <Icon name="add" />
              {pl.addModal.submit}
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
          <Modal.Header>{pl.connectModal.title}</Modal.Header>
          <Modal.Content>
            <p style={{ marginTop: 0, color: '#555', fontSize: '0.92em', lineHeight: 1.45 }}>
              {pl.connectModal.intro}
            </p>
            <Form onSubmit={(e) => { e.preventDefault(); this._submitConnectPeerModal(); }}>
              <Form.Field>
                <label htmlFor="peers-connect-peer-id">{pl.connectModal.label}</label>
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
              {common.actions.cancel}
            </Button>
            <Button type="button" primary onClick={this._submitConnectPeerModal}>
              <Icon name="plug" />
              {pl.connectModal.submit}
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
