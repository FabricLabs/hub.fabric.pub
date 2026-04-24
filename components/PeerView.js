'use strict';

// Dependencies
const React = require('react');
const QRCode = require('qrcode');
const {
  Link,
  useNavigate,
  useParams
} = require('react-router-dom');

const {
  Accordion,
  Button,
  Checkbox,
  Divider,
  Form,
  Header,
  Icon,
  Input,
  Label,
  List,
  Message,
  Modal,
  Segment,
  Loader,
  Menu,
  Table
} = require('semantic-ui-react');

const ChatInput = require('./ChatInput');
const { formatSatsDisplay } = require('../functions/formatSats');
const { loadUpstreamSettings, sendBridgePayment } = require('../functions/bitcoinClient');
const { peerNeighborhoodToDot } = require('../functions/peerTopologyDot');
const GraphDocumentPreview = require('./GraphDocumentPreview');
const { isHubNetworkStatusShape } = require('../functions/hubNetworkStatus');
const { isLikelyBip32ExtendedKey } = require('../functions/isLikelyBip32ExtendedKey');
const { shortenPublicId, fabricPeerBech32Id, peerConnectionPubkeyAtHostPort } = require('../functions/peerIdentity');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');

/** Hub admin token for operator-only controls; only passed from `/settings/admin/peers/:id`. */
function getAdminPeerToolsTokenFromProps (props) {
  const t = props && props.adminPeerToolsToken;
  return t && String(t).trim() ? String(t).trim() : '';
}

async function hubJsonRpc (method, params) {
  const res = await fetch(`${typeof window !== 'undefined' ? window.location.origin : ''}/services/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  let body = {};
  try {
    body = await res.json();
  } catch (_) {
    throw new Error('Hub returned non-JSON');
  }
  if (!res.ok || body.error) {
    throw new Error((body.error && body.error.message) || `HTTP ${res.status}`);
  }
  return body.result;
}

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

/** Resolve peer row from globalState whether the route id is Fabric pubkey or TCP address. */
function findPeerInGlobalPeers (peersMap, routeId) {
  if (!routeId || !peersMap || typeof peersMap !== 'object') return null;
  if (peersMap[routeId]) return peersMap[routeId];
  for (const k of Object.keys(peersMap)) {
    const p = peersMap[k];
    if (p && (p.id === routeId || p.address === routeId)) return p;
  }
  return null;
}

/** Merge accumulated globalState peer with React detail; ListPeers row wins for live connection fields. */
function mergePeerSources (gsPeer, detailPeer, listPeer) {
  const a = gsPeer && typeof gsPeer === 'object' ? gsPeer : {};
  const b = detailPeer && typeof detailPeer === 'object' ? detailPeer : {};
  const c = listPeer && typeof listPeer === 'object' ? listPeer : {};
  const merged = { ...a, ...b, ...c };
  if (!(merged.id || merged.address)) return null;
  return merged;
}

function PeerDetail (props) {
  const navigate = useNavigate();
  const params = useParams();
  const encoded = params && params.id ? params.id : '';
  const id = encoded ? decodeURIComponent(encoded) : '';
  const [detail, setDetail] = React.useState(null);
  const [peerChats, setPeerChats] = React.useState([]);
  const [outgoingText, setOutgoingText] = React.useState('');
  const [inventoryDocs, setInventoryDocs] = React.useState([]);
  const [htlcTxids, setHtlcTxids] = React.useState({});
  const [htlcConfirmFeedback, setHtlcConfirmFeedback] = React.useState(null);
  const [htlcFundingQrBySettlement, setHtlcFundingQrBySettlement] = React.useState({});
  const [htlcFundingCopied, setHtlcFundingCopied] = React.useState(null);
  const [inventoryRelayTarget, setInventoryRelayTarget] = React.useState('');
  const [bridgePaySettlementId, setBridgePaySettlementId] = React.useState(null);
  const [inventoryDebugOpen, setInventoryDebugOpen] = React.useState(false);
  const [inventoryRequestMeta, setInventoryRequestMeta] = React.useState(null);
  const [peerTopologyTick, setPeerTopologyTick] = React.useState(0);
  const [federationContractId, setFederationContractId] = React.useState('');
  const [inviteBusy, setInviteBusy] = React.useState(false);
  const [inviteError, setInviteError] = React.useState(null);
  const [inviteOk, setInviteOk] = React.useState(null);
  const [nickModalOpen, setNickModalOpen] = React.useState(false);
  const [nickDraft, setNickDraft] = React.useState('');
  const [inviteNoteModalOpen, setInviteNoteModalOpen] = React.useState(false);
  const [inviteNoteDraft, setInviteNoteDraft] = React.useState('');
  const [peerOpsAccordionOpen, setPeerOpsAccordionOpen] = React.useState(false);
  const [peerWorkspaceTab, setPeerWorkspaceTab] = React.useState(0);
  const [contactAddBusy, setContactAddBusy] = React.useState(false);
  const [contactAddErr, setContactAddErr] = React.useState(null);
  const [contactAddOk, setContactAddOk] = React.useState(null);

  const [hubUiTick, setHubUiTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((t) => t + 1)), []);
  void hubUiTick;
  const [networkStatusTick, setNetworkStatusTick] = React.useState(0);
  React.useEffect(() => {
    const onNs = () => setNetworkStatusTick((t) => t + 1);
    window.addEventListener('networkStatusUpdate', onNs);
    return () => window.removeEventListener('networkStatusUpdate', onNs);
  }, []);
  void networkStatusTick;
  const uf = loadHubUiFeatureFlags();

  const bridge = props.bridge;
  const bridgeRef = props.bridgeRef;
  const current = (bridgeRef && bridgeRef.current) || (bridge && bridge.current);
  const candidate = current && current.networkStatus;
  const fallback = current && current.lastNetworkStatus;
  const networkStatus = isHubNetworkStatusShape(candidate)
    ? candidate
    : (isHubNetworkStatusShape(fallback) ? fallback : null);
  const peers = Array.isArray(networkStatus && networkStatus.peers) ? networkStatus.peers : [];
  const webrtcFromHub = Array.isArray(networkStatus && networkStatus.webrtcPeers)
    ? networkStatus.webrtcPeers
    : [];
  const webrtcRegistration = webrtcFromHub.find((p) => p && p.id === id) || null;
  const webrtcMeta = webrtcRegistration && webrtcRegistration.metadata && typeof webrtcRegistration.metadata === 'object'
    ? webrtcRegistration.metadata
    : null;

  const peerFromStatus = peers.find((p) => p && (p.address === id || p.id === id)) || null;
  const mergedFromGs = (() => {
    const gs = current && typeof current.getGlobalState === 'function' ? current.getGlobalState() : null;
    return gs ? findPeerInGlobalPeers(gs.peers || {}, id) : null;
  })();
  const peer = mergePeerSources(mergedFromGs, detail, peerFromStatus);
  const hasPeerRow = !!peer;
  const status = peer && peer.status ? peer.status : 'unknown';
  const isConnected = status === 'connected';
  const adminTokenPresent = !!getAdminPeerToolsTokenFromProps(props);

  React.useEffect(() => {
    const bi = props.bridgeRef && props.bridgeRef.current;
    const gs = bi && typeof bi.getGlobalState === 'function' ? bi.getGlobalState() : null;
    const seed = gs && gs.peers ? findPeerInGlobalPeers(gs.peers, id) : null;
    setDetail(seed || null);
    setPeerChats([]);
    setInventoryDocs([]);
    if (typeof props.onRefreshPeers === 'function') props.onRefreshPeers();
    if (typeof props.onGetPeer === 'function' && id) props.onGetPeer(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  React.useEffect(() => {
    const onGs = (ev) => {
      const p = ev && ev.detail && ev.detail.operation && ev.detail.operation.path;
      if (p === '/peerTopologyGossip') setPeerTopologyTick((t) => t + 1);
    };
    window.addEventListener('globalStateUpdate', onGs);
    return () => window.removeEventListener('globalStateUpdate', onGs);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const pairs = [];
    for (let i = 0; i < inventoryDocs.length; i++) {
      const doc = inventoryDocs[i];
      const h = doc && doc.htlc;
      const sid = h && h.settlementId;
      const uri = h && h.bitcoinUri && String(h.bitcoinUri).trim();
      if (sid && uri) pairs.push({ sid, uri });
    }
    if (pairs.length === 0) {
      setHtlcFundingQrBySettlement({});
      return;
    }
    Promise.all(pairs.map(({ sid, uri }) =>
      QRCode.toDataURL(uri, {
        width: 140,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      })
        .then((dataUrl) => ({ sid, dataUrl }))
        .catch(() => ({ sid, dataUrl: null }))
    )).then((rows) => {
      if (cancelled) return;
      const next = {};
      for (let j = 0; j < rows.length; j++) {
        const r = rows[j];
        if (r.dataUrl) next[r.sid] = r.dataUrl;
      }
      setHtlcFundingQrBySettlement(next);
    });
    return () => { cancelled = true; };
  }, [inventoryDocs]);

  const copyHtlcFunding = React.useCallback((text, flashKey) => {
    try {
      if (text && typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(text);
        setHtlcFundingCopied(flashKey);
        setTimeout(() => setHtlcFundingCopied((k) => (k === flashKey ? null : k)), 1500);
      }
    } catch (e) {}
  }, []);

  React.useEffect(() => {
    const deriveChatsAndInventory = (globalState, currentDetail) => {
      if (!globalState || !globalState.messages) return;
      const messages = globalState.messages || {};
      const peersById = globalState.peers || {};
      const storedPeer = findPeerInGlobalPeers(peersById, id);
      const peerId = (storedPeer && storedPeer.id) || (currentDetail && currentDetail.id) || id;

      const chats = Object.values(messages)
        .filter((m) => m && typeof m === 'object' && m.type === 'P2P_CHAT_MESSAGE')
        .filter((m) => {
          const actorId = m.actor && m.actor.id;
          // Prefer top-level target (ActivityStreams-style), but support legacy
          // object.target / object.address / object.id for backward compatibility.
          const target = m.target || (m.object && (m.object.target || m.object.address || m.object.id));
          const matchesActor = !!(actorId && peerId && actorId === peerId);

          let matchesTarget = false;
          if (target) {
            // Direct match against route id or peer id
            if (target === id || target === peerId) {
              matchesTarget = true;
            } else {
              // Match against known peer address/id, when available
              const p = currentDetail || storedPeer;
              if (p && (p.address === target || p.id === target)) {
                matchesTarget = true;
              }
            }
          }

          return matchesActor || matchesTarget;
        })
        .sort((a, b) => {
          const ta = (a.object && a.object.created) || 0;
          const tb = (b.object && b.object.created) || 0;
          return ta - tb;
        })
        .slice(-100);

      setPeerChats(chats);

      // Derive inventory documents for this peer, if available (keyed by id or address).
      const invPeer = findPeerInGlobalPeers(peersById, id) || peersById[peerId] || storedPeer;
      const docs = invPeer && invPeer.inventory && Array.isArray(invPeer.inventory.documents)
        ? invPeer.inventory.documents
        : [];
      setInventoryDocs(docs);
    };

    const handler = (event) => {
      try {
        const globalState = event && event.detail && event.detail.globalState;
        if (!globalState) return;

        const stored = globalState.peers
          ? findPeerInGlobalPeers(globalState.peers, id)
          : null;
        if (stored) setDetail(stored);

        deriveChatsAndInventory(globalState, stored);
      } catch (e) {}
    };

    // Initial load from persisted/restored state (survives refresh)
    const bridgeInstance = props.bridgeRef && props.bridgeRef.current;
    const gs = bridgeInstance && typeof bridgeInstance.getGlobalState === 'function'
      ? bridgeInstance.getGlobalState()
      : null;
    if (gs) {
      const row = gs.peers ? findPeerInGlobalPeers(gs.peers, id) : null;
      deriveChatsAndInventory(gs, row);
    }

    window.addEventListener('globalStateUpdate', handler);
    return () => window.removeEventListener('globalStateUpdate', handler);
  }, [id, props.bridgeRef]);

  React.useEffect(() => {
    setPeerWorkspaceTab(0);
  }, [id]);

  const routeLooksLikeXpub = isLikelyBip32ExtendedKey(id);
  const xpubOnlyNoPeer = routeLooksLikeXpub && !peer;
  const [peerResolveSlow, setPeerResolveSlow] = React.useState(false);

  React.useEffect(() => {
    setPeerResolveSlow(false);
  }, [id]);

  React.useEffect(() => {
    if (hasPeerRow || !id || routeLooksLikeXpub) return undefined;
    const t = setTimeout(() => setPeerResolveSlow(true), 14000);
    return () => clearTimeout(t);
  }, [id, hasPeerRow, routeLooksLikeXpub]);
  const webrtcXpub = webrtcMeta && webrtcMeta.xpub && isLikelyBip32ExtendedKey(String(webrtcMeta.xpub))
    ? String(webrtcMeta.xpub).trim()
    : '';
  const bech32Headline = peer ? fabricPeerBech32Id(peer) : '';
  const title = (bech32Headline ? shortenPublicId(bech32Headline, 18, 14) : null)
    || (peer && (peer.nickname || peer.alias || peer.id || peer.address))
    || (webrtcXpub ? shortenPublicId(webrtcXpub, 14, 12) : null)
    || (routeLooksLikeXpub && id
      ? (id.length > 40 ? `${id.slice(0, 16)}…${id.slice(-14)}` : id)
      : id)
    || 'Peer';

  const resolvedAddress = (peer && peer.address) || id || '';
  let host = '';
  let port = '';
  if (peer && peer.connection && peer.connection.remoteAddress) {
    host = peer.connection.remoteAddress;
    port = peer.connection.remotePort != null ? String(peer.connection.remotePort) : '';
  } else if (resolvedAddress) {
    const lastColon = resolvedAddress.lastIndexOf(':');
    if (lastColon > 0) {
      host = resolvedAddress.slice(0, lastColon);
      port = resolvedAddress.slice(lastColon + 1);
    } else {
      host = resolvedAddress;
    }
  }

  const chatDest = (peer && peer.address) || id;
  const tcpKeyForFabricResync = (peer && peer.address) || (id && String(id).includes(':') ? id : '');
  const canRequestFabricResync = !!(
    isConnected &&
    tcpKeyForFabricResync &&
    !String(id).startsWith('fabric-bridge-')
  );
  const hasUnlockedIdentity = !!(current && typeof current.hasUnlockedIdentity === 'function' && current.hasUnlockedIdentity());
  const canSendPeerChat = !!chatDest && hasUnlockedIdentity;

  const handleSendPeerChat = (event) => {
    event.preventDefault();
    const text = (outgoingText || '').trim();
    if (!text || !canSendPeerChat) return;
    if (typeof props.onSendPeerMessage === 'function') {
      props.onSendPeerMessage(chatDest, text);
      setOutgoingText('');
    }
  };

  const gossipNeighbors = React.useMemo(() => {
    const gs = current && typeof current.getGlobalState === 'function' ? current.getGlobalState() : null;
    const g = gs && gs.peerTopologyGossip && gs.peerTopologyGossip.byReporter;
    if (!peer || !g || typeof g !== 'object') return null;
    const key = (peer.id && g[peer.id]) ? peer.id : (id && g[id] ? id : (peer.address && g[peer.address] ? peer.address : null));
    if (!key || !g[key] || !Array.isArray(g[key].neighbors)) return null;
    return g[key].neighbors;
  }, [current, peer, id, peerTopologyTick]);

  const neighborDot = React.useMemo(() => {
    const center = (peer && peer.id) || id;
    if (!center || !gossipNeighbors || gossipNeighbors.length === 0) return '';
    try {
      return peerNeighborhoodToDot(center, gossipNeighbors);
    } catch (_) {
      return '';
    }
  }, [peer, id, gossipNeighbors]);

  const sendInventoryRequest = (kind, opts) => {
    const invDest = (peer && peer.address) || id;
    if (!invDest || !bridgeRef || !bridgeRef.current || typeof bridgeRef.current.sendPeerInventoryRequest !== 'function') return;
    setInventoryRequestMeta({ at: Date.now(), kind: kind || 'documents', status: 'sent' });
    bridgeRef.current.sendPeerInventoryRequest(invDest, kind || 'documents', opts || {});
  };

  const openNicknameModal = React.useCallback(() => {
    setNickDraft((peer && peer.nickname) ? String(peer.nickname) : '');
    setNickModalOpen(true);
  }, [peer]);

  const submitNickname = React.useCallback(() => {
    if (typeof props.onSetPeerNickname !== 'function' || !id) {
      setNickModalOpen(false);
      return;
    }
    props.onSetPeerNickname(id, nickDraft);
    setNickModalOpen(false);
  }, [props, id, nickDraft]);

  const launchInviteNoteModal = React.useCallback(() => {
    setInviteNoteDraft('');
    setInviteNoteModalOpen(true);
  }, []);

  const submitInviteToContract = React.useCallback(async () => {
    const token = getAdminPeerToolsTokenFromProps(props);
    if (!token || !id) return;
    const note = inviteNoteDraft && String(inviteNoteDraft).trim()
      ? String(inviteNoteDraft).trim().slice(0, 500)
      : '';
    setInviteBusy(true);
    setInviteError(null);
    setInviteOk(null);
    try {
      const cid = (federationContractId || '').trim();
      const r = await hubJsonRpc('InvitePeerToFederationContract', [{
        peerId: id,
        contractId: cid || undefined,
        note: note || undefined,
        adminToken: token
      }]);
      if (r && r.status === 'error') {
        setInviteError(r.message || 'Invite failed');
        return;
      }
      if (r && r.status === 'success' && r.inviteId) {
        setInviteOk(`Invite sent (${r.inviteId.slice(0, 16)}…)`);
      } else {
        setInviteOk('Invite sent');
      }
      setInviteNoteModalOpen(false);
    } catch (e) {
      setInviteError(e && e.message ? e.message : String(e));
    } finally {
      setInviteBusy(false);
    }
  }, [props, id, inviteNoteDraft, federationContractId]);

  const hubAdminCollaborationToken = readHubAdminTokenFromBrowser();
  const fabricPeerIdForCollaborationContact = React.useMemo(() => {
    const fromPeer = peer && peer.id ? String(peer.id).trim() : '';
    const fromWebrtc = webrtcMeta && webrtcMeta.fabricPeerId ? String(webrtcMeta.fabricPeerId).trim() : '';
    const fp = fromPeer || fromWebrtc;
    if (!fp || isLikelyBip32ExtendedKey(fp)) return '';
    return fp;
  }, [peer, webrtcMeta]);

  const addPeerToCollaborationContacts = React.useCallback(async () => {
    const token = readHubAdminTokenFromBrowser();
    const fp = fabricPeerIdForCollaborationContact;
    if (!token) {
      setContactAddErr('Save the hub admin token to add contacts (Settings).');
      return;
    }
    if (!fp) {
      setContactAddErr('No Fabric peer id on this row yet.');
      return;
    }
    const bi = props.bridgeRef && props.bridgeRef.current;
    if (!bi || typeof bi.callHubJsonRpc !== 'function') {
      setContactAddErr('Bridge is not ready.');
      return;
    }
    setContactAddBusy(true);
    setContactAddErr(null);
    setContactAddOk(null);
    try {
      const out = await bi.callHubJsonRpc('AddCollaborationContact', {
        adminToken: token,
        fabricPeerId: fp,
        label: (peer && peer.nickname) ? String(peer.nickname).trim().slice(0, 200) : '',
        source: 'peer_detail'
      });
      if (out && out.error) {
        setContactAddErr(String(out.error));
        return;
      }
      const res = out && out.result;
      if (res && res.status === 'error') {
        setContactAddErr(res.message || 'Add contact failed');
        return;
      }
      setContactAddOk('Added to Collaboration contacts.');
    } catch (e) {
      setContactAddErr(e && e.message ? e.message : String(e));
    } finally {
      setContactAddBusy(false);
    }
  }, [fabricPeerIdForCollaborationContact, peer, props.bridgeRef]);

  return (
    <fabric-peer-detail class='fade-in'>
      <Segment>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '0.65rem',
            marginBottom: '0.35rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', minWidth: 0, flex: '1 1 16rem' }}>
            <Button
              basic
              size="small"
              as={Link}
              to="/peers"
              aria-label="Back to peers list"
            >
              <Icon name="arrow left" aria-hidden="true" />
              Peers
            </Button>
            <div style={{ minWidth: 0 }}>
              <Header as="h3" style={{ margin: 0, fontWeight: 600, lineHeight: 1.25 }}>
                {title}
              </Header>
              {resolvedAddress && (host || port) ? (
                <div style={{ fontSize: '0.82rem', color: '#767676', marginTop: '0.15rem' }}>
                  {host}{port ? `:${port}` : ''}
                </div>
              ) : null}
              {webrtcRegistration ? (
                <div style={{ fontSize: '0.78rem', color: '#555', marginTop: '0.25rem', maxWidth: '38rem' }}>
                  <Label size="mini" basic color="blue">WebRTC</Label>
                  {webrtcXpub ? (
                    <span style={{ marginLeft: '0.35rem' }} title={webrtcXpub}>
                      xpub {shortenPublicId(webrtcXpub, 14, 12)}
                    </span>
                  ) : null}
                  {webrtcMeta && webrtcMeta.fabricPeerId ? (
                    <div style={{ marginTop: '0.2rem', wordBreak: 'break-all' }}>
                      <code style={{ fontSize: '0.85em' }}>{String(webrtcMeta.fabricPeerId)}</code>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            {xpubOnlyNoPeer ? (
              <Label size="small" color="blue" title="BIP32 extended public key (not a TCP peer socket)">
                <Icon name="key" /> Identity ref
              </Label>
            ) : !hasPeerRow && webrtcRegistration ? (
              <Label size="small" color="blue" title="Registered for WebRTC signaling; TCP peer row not loaded yet">
                <Icon name="wifi" /> WebRTC
              </Label>
            ) : !hasPeerRow ? (
              <Label size="small" color="grey" title="Waiting for ListPeers / GetPeer data from the hub">
                <Icon name="clock outline" /> Resolving…
              </Label>
            ) : (
              <Label size="small" color={isConnected ? 'green' : 'grey'} title={status}>
                {isConnected ? (
                  <><Icon name="check circle" /> On</>
                ) : (
                  <><Icon name="minus circle" /> Off</>
                )}
              </Label>
            )}
          </div>
          {!xpubOnlyNoPeer && (
            <Button.Group size="small" basic style={{ flexShrink: 0 }}>
              <Button
                icon
                title="Refresh peer info"
                onClick={() => {
                  if (typeof props.onRefreshPeers === 'function') props.onRefreshPeers();
                  if (typeof props.onGetPeer === 'function' && id) props.onGetPeer(id);
                }}
              >
                <Icon name="refresh" />
              </Button>
              {hasPeerRow && id && !isConnected && typeof props.onAddPeer === 'function' && (peer && peer.address) && (
                <Button
                  icon
                  onClick={() => props.onAddPeer({ address: peer.address })}
                  title={`Reconnect to ${peer.address}`}
                >
                  <Icon name="plug" />
                </Button>
              )}
              {hasPeerRow && id && isConnected && typeof props.onDisconnectPeer === 'function' && (
                <Button
                  icon
                  color="red"
                  onClick={() => props.onDisconnectPeer(id)}
                  title={`Disconnect ${id}`}
                >
                  <Icon name="remove" />
                </Button>
              )}
              {hasPeerRow && canRequestFabricResync && typeof props.onFabricPeerResync === 'function' && (
                <Button
                  icon
                  title="Fabric chain resync (inventory + BitcoinBlock replay)"
                  onClick={() => props.onFabricPeerResync(tcpKeyForFabricResync)}
                >
                  <Icon name="sync" />
                </Button>
              )}
              {hasPeerRow && id && typeof props.onSetPeerNickname === 'function' && (
                <Button icon onClick={openNicknameModal} title="Set nickname">
                  <Icon name="tag" />
                </Button>
              )}
              {hubAdminCollaborationToken && fabricPeerIdForCollaborationContact && !xpubOnlyNoPeer ? (
                <Button
                  icon
                  loading={contactAddBusy}
                  disabled={contactAddBusy}
                  title="Add to contacts"
                  aria-label="Add to contacts"
                  onClick={() => void addPeerToCollaborationContacts()}
                >
                  <Icon name="address book" />
                </Button>
              ) : null}
            </Button.Group>
          )}
        </div>

        {!xpubOnlyNoPeer && hasPeerRow && id && isConnected && (
          (bridgeRef && bridgeRef.current && typeof bridgeRef.current.sendPeerInventoryRequest === 'function') ||
          adminTokenPresent
        ) ? (
          <Accordion styled fluid style={{ marginBottom: '0.65rem' }}>
            <Accordion.Title
              active={peerOpsAccordionOpen}
              index={0}
              onClick={() => setPeerOpsAccordionOpen(!peerOpsAccordionOpen)}
            >
              <Icon name="dropdown" />
              Inventory, HTLC, federation (advanced)
            </Accordion.Title>
            <Accordion.Content active={peerOpsAccordionOpen}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                {bridgeRef && bridgeRef.current && typeof bridgeRef.current.sendPeerInventoryRequest === 'function' ? (
                  <>
                    <Input
                      size="small"
                      placeholder="Relay: seller Fabric id (optional)"
                      title="When this connection is a relay, set the seller’s Fabric id so the hub forwards INVENTORY_REQUEST"
                      value={inventoryRelayTarget}
                      onChange={(e, { value }) => setInventoryRelayTarget(value)}
                      style={{ minWidth: '12em', maxWidth: '18rem', flex: '1 1 12em' }}
                    />
                    <Button
                      size="small"
                      basic
                      onClick={() => {
                        const t = (inventoryRelayTarget || '').trim();
                        const opts = t ? { inventoryTarget: t } : {};
                        sendInventoryRequest('documents', opts);
                      }}
                      title="Request document inventory from this peer"
                    >
                      <Icon name="list alternate outline" />
                      Docs
                    </Button>
                    {typeof bridgeRef.current.getHtlcRefundPublicKeyHex === 'function' && bridgeRef.current.getHtlcRefundPublicKeyHex() ? (
                      <Button
                        size="small"
                        basic
                        onClick={() => {
                          const refundPk = bridgeRef.current.getHtlcRefundPublicKeyHex();
                          const t = (inventoryRelayTarget || '').trim();
                          const opts = { buyerRefundPublicKey: refundPk };
                          if (t) opts.inventoryTarget = t;
                          sendInventoryRequest('documents', opts);
                        }}
                        title="Inventory with P2TR HTLC on priced items (your identity pubkey = refund path)"
                      >
                        <Icon name="bitcoin" />
                        Docs+HTLC
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {adminTokenPresent ? (
                  <>
                    <Input
                      size="small"
                      placeholder="Execution contract id (optional)"
                      value={federationContractId}
                      onChange={(e, { value }) => setFederationContractId(value)}
                      style={{ minWidth: '10em', maxWidth: '16rem', flex: '1 1 10em' }}
                      title="Optional execution contract id included in the invite (see Contracts)"
                    />
                    <Button
                      size="small"
                      basic
                      primary
                      loading={inviteBusy}
                      disabled={inviteBusy}
                      title="Admin: send federation / execution-contract invite"
                      onClick={launchInviteNoteModal}
                    >
                      <Icon name="users" />
                      Invite
                    </Button>
                  </>
                ) : null}
              </div>
            </Accordion.Content>
          </Accordion>
        ) : null}

        {inviteError ? (
          <Message negative size="small" onDismiss={() => setInviteError(null)} style={{ marginTop: '0.5em' }}>
            {inviteError}
          </Message>
        ) : null}
        {inviteOk ? (
          <Message success size="small" onDismiss={() => setInviteOk(null)} style={{ marginTop: '0.5em' }}>
            {inviteOk}
          </Message>
        ) : null}
        {contactAddErr ? (
          <Message negative size="small" onDismiss={() => setContactAddErr(null)} style={{ marginTop: '0.5em' }}>
            {contactAddErr}
          </Message>
        ) : null}
        {contactAddOk ? (
          <Message success size="small" onDismiss={() => setContactAddOk(null)} style={{ marginTop: '0.5em' }}>
            {contactAddOk}{' '}
            <Link to="/settings/collaboration">Open Collaboration</Link>
          </Message>
        ) : null}

        <Divider />

        <Menu pointing secondary compact style={{ margin: '0 0 0.65rem', flexWrap: 'wrap' }}>
          <Menu.Item active={peerWorkspaceTab === 0} onClick={() => setPeerWorkspaceTab(0)}>
            Overview
          </Menu.Item>
          <Menu.Item
            active={peerWorkspaceTab === 1}
            onClick={() => peer && setPeerWorkspaceTab(1)}
            disabled={!peer}
          >
            Chat{peer && peerChats.length > 0 ? ` (${peerChats.length})` : ''}
          </Menu.Item>
          <Menu.Item
            active={peerWorkspaceTab === 2}
            onClick={() => peer && setPeerWorkspaceTab(2)}
            disabled={!peer}
          >
            Inventory{peer && inventoryDocs.length > 0 ? ` (${inventoryDocs.length})` : ''}
          </Menu.Item>
        </Menu>

        {peerWorkspaceTab === 0 && (
          <Segment basic style={{ padding: 0, marginBottom: '0.75rem', boxShadow: 'none', border: 'none' }}>
            {peer ? (
              <>
                <Table compact definition striped size="small" style={{ marginBottom: '0.65rem' }}>
                  <Table.Body>
                    {(() => {
                      const connStr = typeof window !== 'undefined'
                        ? peerConnectionPubkeyAtHostPort(peer, window.location.host)
                        : peerConnectionPubkeyAtHostPort(peer, '');
                      if (!connStr) return null;
                      return (
                        <Table.Row>
                          <Table.Cell collapsing>Id @ endpoint</Table.Cell>
                          <Table.Cell>
                            <code style={{ wordBreak: 'break-all', fontSize: '0.86em' }}>{connStr}</code>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })()}
                    <Table.Row>
                      <Table.Cell collapsing>Bech32</Table.Cell>
                      <Table.Cell>
                        <code style={{ wordBreak: 'break-all', fontSize: '0.86em' }}>{fabricPeerBech32Id(peer) || '—'}</code>
                      </Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>Address</Table.Cell>
                      <Table.Cell>
                        <code style={{ fontSize: '0.86em' }}>{resolvedAddress || '—'}</code>
                        {(host || port) ? (
                          <span style={{ color: '#767676', fontSize: '0.82em', marginLeft: '0.5em' }}>
                            ({host}{port ? `:${port}` : ''})
                          </span>
                        ) : null}
                      </Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>Fabric id</Table.Cell>
                      <Table.Cell style={{ wordBreak: 'break-all', fontSize: '0.86em' }}>{(peer && peer.id) || '—'}</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>Nickname</Table.Cell>
                      <Table.Cell>{(peer && peer.nickname) || '—'}</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>Alias</Table.Cell>
                      <Table.Cell>{(peer && peer.alias) || '—'}</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>Score</Table.Cell>
                      <Table.Cell>{peer && peer.score != null ? String(peer.score) : '—'}</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>First seen</Table.Cell>
                      <Table.Cell>{formatMaybeDate(peer && peer.firstSeen) || '—'}</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>Last seen</Table.Cell>
                      <Table.Cell>{formatMaybeDate(peer && (peer.lastSeen || peer.lastMessage)) || '—'}</Table.Cell>
                    </Table.Row>
                    {peer && peer.connection ? (
                      <Table.Row>
                        <Table.Cell collapsing>Socket</Table.Cell>
                        <Table.Cell style={{ fontSize: '0.86em' }}>
                          {peer.connection.remoteAddress ? `${peer.connection.remoteAddress}:${peer.connection.remotePort || ''}` : 'connected'}
                          {peer.connection.lastMessage ? ` · last msg ${formatMaybeDate(peer.connection.lastMessage)}` : ''}
                          {peer.connection.failureCount != null ? ` · failures ${peer.connection.failureCount}` : ''}
                        </Table.Cell>
                      </Table.Row>
                    ) : null}
                  </Table.Body>
                </Table>
                {neighborDot ? (
                  <Segment secondary style={{ marginTop: '0.35rem' }}>
                    <Header as="h4" style={{ marginBottom: '0.35rem' }}>Gossip neighborhood</Header>
                    <p style={{ color: '#666', marginBottom: '0.5rem', fontSize: '0.9em', lineHeight: 1.45 }}>
                      Fabric ids from <code>P2P_PEER_GOSSIP</code>. Use <strong>Inventory</strong> tab → Docs (or the advanced panel) for <code>INVENTORY_REQUEST</code>.
                    </p>
                    <GraphDocumentPreview dotSource={neighborDot} skipIdentityGate />
                    <List relaxed size="small" style={{ marginTop: '0.5rem' }}>
                      {gossipNeighbors.map((nid) => {
                        const n = String(nid || '').trim();
                        if (!n) return null;
                        return (
                          <List.Item key={n}>
                            <List.Content>
                              <Link to={`/peers/${encodeURIComponent(n)}`} title="Open peer detail">
                                <code style={{ fontSize: '0.85em' }}>{n.length > 36 ? `${n.slice(0, 14)}…${n.slice(-10)}` : n}</code>
                              </Link>
                              <Button
                                size="mini"
                                basic
                                style={{ marginLeft: '0.35em' }}
                                type="button"
                                title="Set as inventory relay target"
                                onClick={() => setInventoryRelayTarget(n)}
                              >
                                Relay →
                              </Button>
                            </List.Content>
                          </List.Item>
                        );
                      })}
                    </List>
                    <details style={{ marginTop: '0.5rem' }}>
                      <summary style={{ cursor: 'pointer', color: '#555', fontSize: '0.88em' }}>DOT source</summary>
                      <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.72rem', background: '#f5f5f5', padding: '0.45rem', borderRadius: 4 }}>{neighborDot}</pre>
                    </details>
                  </Segment>
                ) : null}
              </>
            ) : routeLooksLikeXpub ? (
              <Message info style={{ margin: 0 }}>
                <Message.Header>Extended public key (BIP32)</Message.Header>
                <p style={{ margin: '0.35em 0 0' }}>
                  This URL uses an <code>xpub</code>/<code>tpub</code>-style identifier — often the display form of an
                  activity sender — not a Fabric TCP peer. Peer chat and inventory use a connected node
                  (<code>host:port</code> or Fabric id from <Link to="/peers">Peers</Link>).
                </p>
              </Message>
            ) : (
              <Segment placeholder basic style={{ padding: '1rem' }}>
                <Header as="h4">Waiting for peer record…</Header>
                <p style={{ color: '#666', margin: '0.35em 0 0.65em', fontSize: '0.92em' }}>
                  No matching entry in the hub snapshot yet. Use <strong>Refresh</strong>, or open{' '}
                  <Link to="/peers">Peers</Link> and add <code>host:port</code>. After <code>GetPeer</code> returns, details appear here.
                </p>
                <Loader active inline="centered" size="small" />
                {peerResolveSlow ? (
                  <Message warning style={{ marginTop: '0.85em', textAlign: 'left' }} size="small">
                    <Message.Header>Slow to resolve</Message.Header>
                    <p style={{ margin: '0.25em 0 0', fontSize: '0.9em' }}>
                      Check that the Bridge is connected. Add the peer from the list page, then reopen this link.
                    </p>
                  </Message>
                ) : null}
              </Segment>
            )}
          </Segment>
        )}

        {peerWorkspaceTab === 1 && peer && (
          <Segment style={{ marginTop: 0 }}>
            <Header as="h4" style={{ marginTop: 0 }}>Chat</Header>
            {!hasUnlockedIdentity && (
              <Message warning size="small" style={{ marginBottom: '0.75em' }}>
                <Message.Header>Identity locked</Message.Header>
                <p style={{ margin: 0, lineHeight: 1.45 }}>
                  Unlock your identity (local signing material) to send Fabric peer chat — top-bar <strong>Locked</strong> / identity menu, or{' '}
                  <Link to="/settings">Settings</Link> → <strong>Fabric identity</strong>. Received messages still appear here.
                </p>
              </Message>
            )}
            {hasUnlockedIdentity && !isConnected && (
              <Message info size="small" style={{ marginBottom: '0.75em' }}>
                Peer is offline — messages are <strong>queued</strong> and sent when the connection is up (same hub <code>SendPeerMessage</code> path).
              </Message>
            )}
            {peerChats.length > 0 ? (
              <List divided size="small">
                {peerChats.map((chat, index) => {
                  const created = (chat.object && chat.object.created) || Date.now();
                  const bridgeInstance = props.bridgeRef?.current || props.bridge?.current;
                  const rawActor = (chat.actor && (chat.actor.username || chat.actor.id)) || 'unknown';
                  const actor = (bridgeInstance && typeof bridgeInstance.getPeerDisplayName === 'function' && chat.actor?.id)
                    ? bridgeInstance.getPeerDisplayName(chat.actor.id)
                    : rawActor;
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
            {chatDest && typeof props.onSendPeerMessage === 'function' && (
              <ChatInput
                value={outgoingText}
                onChange={setOutgoingText}
                onSubmit={(text) => {
                  if (canSendPeerChat && typeof props.onSendPeerMessage === 'function') {
                    props.onSendPeerMessage(chatDest, text);
                    setOutgoingText('');
                  }
                }}
                placeholder={hasUnlockedIdentity ? 'Type a message…' : 'Unlock identity to send…'}
                title={`Send to ${chatDest} via hub (P2P_CHAT_MESSAGE / SendPeerMessage)`}
                disabled={!canSendPeerChat}
              />
            )}
          </Segment>
        )}

        {peerWorkspaceTab === 2 && peer && (
          <Segment style={{ marginTop: 0 }}>
            <Header as="h4" style={{ marginTop: 0 }}>Publisher inventory</Header>
            <p style={{ color: '#666', marginBottom: '0.65em', fontSize: '0.92em', lineHeight: 1.45 }}>
              Documents offered by this <strong>publisher</strong>
              {id ? <> (Fabric peer <code style={{ fontSize: '0.9em' }}>{id.length > 24 ? `${id.slice(0, 12)}…${id.slice(-8)}` : id}</code>)</> : ''}.
              <strong> Author</strong> is the creator&apos;s document id when known (lineage). Use <strong>Docs</strong> while connected to send <code>INVENTORY_REQUEST</code>; responses are merged under this peer&apos;s Fabric id and TCP address keys.
            </p>
            {inventoryRequestMeta && (
              <p style={{ fontSize: '0.85em', color: '#666', marginBottom: '0.65em' }}>
                Last inventory request: {formatMaybeDate(inventoryRequestMeta.at)}
                {inventoryRequestMeta.kind ? ` (${inventoryRequestMeta.kind})` : ''}
                {' — '}
                {inventoryDocs.length > 0 ? `${inventoryDocs.length} item(s) in client state.` : 'no items yet (wait for response or check relay target).'}
              </p>
            )}
            <div style={{ marginBottom: '0.75em' }}>
              <Checkbox
                toggle
                label="Debug: show raw inventory JSON"
                checked={inventoryDebugOpen}
                onChange={(_e, data) => setInventoryDebugOpen(!!(data && data.checked))}
              />
            </div>
            {inventoryDebugOpen && (
              <Segment secondary style={{ marginBottom: '0.75em', overflow: 'auto', maxHeight: '40vh' }}>
                <pre style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {JSON.stringify(inventoryDocs, null, 2)}
                </pre>
              </Segment>
            )}
            {htlcConfirmFeedback && (
              <Message
                positive={htlcConfirmFeedback.status === 'success'}
                negative={htlcConfirmFeedback.status === 'error'}
                onDismiss={() => setHtlcConfirmFeedback(null)}
                style={{ marginBottom: '1em', textAlign: 'left' }}
              >
                <Message.Header>
                  {htlcConfirmFeedback.status === 'success'
                    ? 'HTLC verified — document transfer'
                    : 'HTLC confirmation'}
                </Message.Header>
                {(htlcConfirmFeedback.message || htlcConfirmFeedback.funded) && (
                  <p>{htlcConfirmFeedback.message || (htlcConfirmFeedback.funded ? 'Funding accepted; fix connection or retry if needed.' : '')}</p>
                )}
                {htlcConfirmFeedback.documentId && (
                  <p style={{ fontSize: '0.9em' }}>Document <code>{htlcConfirmFeedback.documentId}</code></p>
                )}
                {htlcConfirmFeedback.txid && (
                  <p style={{ fontSize: '0.9em' }}>
                    Txid{' '}
                    {uf.bitcoinExplorer ? (
                      <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(htlcConfirmFeedback.txid).trim())}`}>
                        <code>{htlcConfirmFeedback.txid}</code>
                      </Link>
                    ) : (
                      <code title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility for the tx viewer">{htlcConfirmFeedback.txid}</code>
                    )}
                    <span style={{ color: '#666' }}> — mempool until confirmed on-chain</span>
                  </p>
                )}
              </Message>
            )}
            {inventoryDocs.length > 0 ? (
              <List divided relaxed size="small">
                {inventoryDocs.map((doc, index) => (
                  <List.Item key={(doc && doc.id) || index}>
                    <List.Content>
                      <List.Header>
                        {(doc && doc.name) || (doc && doc.id) || 'Document'}
                      </List.Header>
                      <List.Description style={{ color: '#666' }}>
                        {doc && doc.id && (<span>ID: <code>{doc.id}</code></span>)}
                        {doc && (doc.lineage || doc.id) && (
                          <> — author <code style={{ fontSize: '0.9em' }}>{String(doc.lineage || doc.id).length > 20 ? `${String(doc.lineage || doc.id).slice(0, 10)}…${String(doc.lineage || doc.id).slice(-6)}` : String(doc.lineage || doc.id)}</code></>
                        )}
                        {doc && doc.size != null && <> — {doc.size} bytes</>}
                        {doc && doc.published && <> — published</>}
                        {doc && doc.purchasePriceSats != null && <> — <strong>{formatSatsDisplay(doc.purchasePriceSats)} sats</strong></>}
                      </List.Description>
                      {doc && doc.htlc && doc.htlc.settlementId && (
                        <div style={{ marginTop: '0.75em', fontSize: '0.85em', textAlign: 'left' }}>
                          <Label color="orange" size="small">P2TR HTLC</Label>
                          <div style={{ marginTop: '0.35em' }}>
                            <strong>{formatSatsDisplay(doc.htlc.amountSats || 0)} sats</strong>
                            {doc.htlc.amountBtc && (
                              <> (<code>{doc.htlc.amountBtc}</code> BTC)</>
                            )}
                            {' '}→ <code style={{ wordBreak: 'break-all' }}>{doc.htlc.paymentAddress}</code>
                          </div>
                          {doc.htlc.bitcoinUri && (
                            <div style={{ marginTop: '0.5em', display: 'flex', flexWrap: 'wrap', gap: '0.75em', alignItems: 'flex-start' }}>
                              {htlcFundingQrBySettlement[doc.htlc.settlementId] && (
                                <img
                                  src={htlcFundingQrBySettlement[doc.htlc.settlementId]}
                                  alt="BIP21 funding QR"
                                  style={{ borderRadius: 4, border: '1px solid #ddd' }}
                                />
                              )}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35em' }}>
                                <Button
                                  size="mini"
                                  basic
                                  onClick={() => copyHtlcFunding(doc.htlc.bitcoinUri, `${doc.htlc.settlementId}:uri`)}
                                >
                                  <Icon name="copy" /> {htlcFundingCopied === `${doc.htlc.settlementId}:uri` ? 'Copied' : 'Copy BIP21 URI'}
                                </Button>
                                <Button
                                  size="mini"
                                  basic
                                  onClick={() => copyHtlcFunding(doc.htlc.paymentAddress, `${doc.htlc.settlementId}:addr`)}
                                >
                                  <Icon name="copy" /> {htlcFundingCopied === `${doc.htlc.settlementId}:addr` ? 'Copied' : 'Copy address'}
                                </Button>
                                {adminTokenPresent && doc.htlc.bitcoinUri && (
                                  <>
                                    <Button
                                      as="a"
                                      size="mini"
                                      primary
                                      href={String(doc.htlc.bitcoinUri).trim()}
                                      title="Open BIP21 URI in your default wallet"
                                    >
                                      <Icon name="bitcoin" /> Pay Now
                                    </Button>
                                    <Button
                                      size="mini"
                                      color="orange"
                                      loading={bridgePaySettlementId === doc.htlc.settlementId}
                                      disabled={bridgePaySettlementId === doc.htlc.settlementId}
                                      onClick={async () => {
                                        const token = getAdminPeerToolsTokenFromProps(props);
                                        const h = doc.htlc;
                                        if (!token || !h || !h.paymentAddress) return;
                                        setBridgePaySettlementId(h.settlementId);
                                        setHtlcConfirmFeedback(null);
                                        try {
                                          const upstream = loadUpstreamSettings();
                                          const res = await sendBridgePayment(upstream, {
                                            to: h.paymentAddress,
                                            amountSats: Math.round(Number(h.amountSats || 0)),
                                            memo: `HTLC ${h.settlementId}`
                                          }, token);
                                          const txid = res && res.payment && res.payment.txid
                                            ? String(res.payment.txid)
                                            : '';
                                          if (txid) {
                                            setHtlcTxids((prev) => ({ ...prev, [h.settlementId]: txid }));
                                            setHtlcConfirmFeedback({
                                              status: 'success',
                                              message: `Hub wallet sent transaction. Txid filled below — use Confirm when ready.`,
                                              txid
                                            });
                                          } else {
                                            setHtlcConfirmFeedback({
                                              status: 'error',
                                              message: (res && res.message) ? res.message : 'No txid returned from Hub wallet.'
                                            });
                                          }
                                        } catch (err) {
                                          setHtlcConfirmFeedback({
                                            status: 'error',
                                            message: err && err.message ? err.message : String(err)
                                          });
                                        } finally {
                                          setBridgePaySettlementId(null);
                                        }
                                      }}
                                      title="Spend from this Hub bitcoind wallet (requires admin token)"
                                    >
                                      <Icon name="server" /> Pay from Bridge
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                          <div style={{ marginTop: '0.35em', color: '#666' }}>
                            Hash <code>{String(doc.htlc.paymentHashHex || '').slice(0, 16)}…</code>
                            {' · '}refund CLTV height <code>{doc.htlc.refundLockHeight}</code>
                          </div>
                          <div style={{ marginTop: '0.5em', display: 'flex', gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
                            <Input
                              placeholder="Funding txid"
                              size="small"
                              style={{ flex: '1 1 10em', minWidth: '12em' }}
                              value={htlcTxids[doc.htlc.settlementId] || ''}
                              onChange={(e, { value }) => setHtlcTxids((prev) => ({ ...prev, [doc.htlc.settlementId]: value }))}
                            />
                            <Button
                              size="small"
                              primary
                              disabled={!(bridgeRef && bridgeRef.current && typeof bridgeRef.current.sendConfirmInventoryHtlcPayment === 'function') || !(htlcTxids[doc.htlc.settlementId] || '').trim()}
                              onClick={() => {
                                const tx = (htlcTxids[doc.htlc.settlementId] || '').trim();
                                if (bridgeRef && bridgeRef.current && tx) {
                                  bridgeRef.current.sendConfirmInventoryHtlcPayment(doc.htlc.settlementId, tx);
                                }
                              }}
                            >
                              Confirm HTLC &amp; receive
                            </Button>
                            {/^[a-fA-F0-9]{64}$/.test(String(htlcTxids[doc.htlc.settlementId] || '').trim()) && (
                              uf.bitcoinExplorer ? (
                                <Link
                                  style={{ fontSize: '0.85em', alignSelf: 'center' }}
                                  to={`/services/bitcoin/transactions/${encodeURIComponent(String(htlcTxids[doc.htlc.settlementId]).trim())}`}
                                >
                                  View funding tx
                                </Link>
                              ) : (
                                <code style={{ fontSize: '0.85em' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility for the tx viewer">
                                  {String(htlcTxids[doc.htlc.settlementId]).trim()}
                                </code>
                              )
                            )}
                          </div>
                        </div>
                      )}
                    </List.Content>
                  </List.Item>
                ))}
              </List>
            ) : (
              <p style={{ color: '#666' }}>No remote document inventory yet. Use <strong>Docs</strong> (when connected) to send <code>INVENTORY_REQUEST</code>.</p>
            )}
          </Segment>
        )}
        <Modal
          open={nickModalOpen}
          size="tiny"
          onClose={() => setNickModalOpen(false)}
          closeOnDimmerClick
          closeOnEscape
        >
          <Modal.Header>Set peer nickname</Modal.Header>
          <Modal.Content>
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                submitNickname();
              }}
            >
              <Form.Field>
                <label htmlFor="peer-nickname-input">Nickname (node-local)</label>
                <Input
                  id="peer-nickname-input"
                  value={nickDraft}
                  onChange={(e) => setNickDraft(e.target.value)}
                  placeholder={`Nickname for ${id}`}
                  maxLength={128}
                />
              </Form.Field>
            </Form>
          </Modal.Content>
          <Modal.Actions>
            <Button type="button" onClick={() => setNickModalOpen(false)}>Cancel</Button>
            <Button type="button" primary onClick={submitNickname}>
              <Icon name="tag" />
              Save nickname
            </Button>
          </Modal.Actions>
        </Modal>
        <Modal
          open={inviteNoteModalOpen}
          size="small"
          onClose={() => setInviteNoteModalOpen(false)}
          closeOnDimmerClick
          closeOnEscape
        >
          <Modal.Header>Invite peer to contract</Modal.Header>
          <Modal.Content>
            <Form
              onSubmit={async (e) => {
                e.preventDefault();
                await submitInviteToContract();
              }}
            >
              <Form.Field>
                <label htmlFor="peer-invite-note-input">Optional message for invitee</label>
                <Form.TextArea
                  id="peer-invite-note-input"
                  value={inviteNoteDraft}
                  onChange={(e) => setInviteNoteDraft(e.target.value)}
                  placeholder="Optional note..."
                  rows={4}
                  maxLength={500}
                />
              </Form.Field>
            </Form>
          </Modal.Content>
          <Modal.Actions>
            <Button type="button" onClick={() => setInviteNoteModalOpen(false)}>Cancel</Button>
            <Button type="button" primary loading={inviteBusy} disabled={inviteBusy} onClick={submitInviteToContract}>
              <Icon name="users" />
              Send invite
            </Button>
          </Modal.Actions>
        </Modal>
      </Segment>
    </fabric-peer-detail>
  );
}

module.exports = PeerDetail;
