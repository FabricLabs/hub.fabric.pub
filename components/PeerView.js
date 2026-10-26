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
const { loadUpstreamSettings, sendBridgePayment } = require('../functions/bitcoinClient');
const { peerNeighborhoodToDot } = require('../functions/peerTopologyDot');
const GraphDocumentPreview = require('./GraphDocumentPreview');
const { isHubNetworkStatusShape } = require('../functions/hubNetworkStatus');
const { isLikelyBip32ExtendedKey } = require('../functions/isLikelyBip32ExtendedKey');
const {
  shortenPublicId,
  fabricPeerBech32Id,
  peerNativePeeringString,
  peerPeeringEndpointIsSignaling
} = require('../functions/peerIdentity');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const {
  classifyHubBrowserIdentity,
  fabricIdentityPeerDisabledReasonPlain
} = require('../functions/hubIdentityUiHints');
const strings = require('../locales/en');

const common = strings.common;
const net = strings.network;
const pv = net.peerView;

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
    throw new Error(pv.rpc.unreadable);
  }
  if (!res.ok || body.error) {
    throw new Error((body.error && body.error.message) || pv.rpc.http(res.status));
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
  const [peeringCopied, setPeeringCopied] = React.useState(false);

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
  React.useEffect(() => {
    const onInv = (ev) => {
      const d = ev && ev.detail;
      if (!d || typeof d !== 'object') return;
      if (d.status === 'error' && d.message) {
        setInventoryRequestMeta((m) => (
          m ? { ...m, status: 'error', hubMessage: String(d.message) } : m
        ));
        return;
      }
      if (d.status === 'success') {
        const viaTag = (d.via !== undefined && d.via !== null && String(d.via).trim() !== '')
          ? String(d.via).trim()
          : '';
        setInventoryRequestMeta((m) => (
          m ? {
            ...m,
            status: 'accepted',
            hubMessage: '',
            requestVia: viaTag
          } : m
        ));
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('fabric:peerInventoryRequestResult', onInv);
      return () => window.removeEventListener('fabric:peerInventoryRequestResult', onInv);
    }
    return undefined;
  }, []);
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
  const title = (peer && peer.alias && String(peer.alias).trim())
    || (bech32Headline ? shortenPublicId(bech32Headline, 18, 14) : null)
    || (peer && (peer.nickname || peer.id || peer.address))
    || (webrtcXpub ? shortenPublicId(webrtcXpub, 14, 12) : null)
    || (routeLooksLikeXpub && id
      ? (id.length > 40 ? `${id.slice(0, 16)}…${id.slice(-14)}` : id)
      : id)
    || pv.fallbackTitle;

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

  const hostLine = host ? `${host}${port ? `:${port}` : ''}` : '';
  const showHostLine = !!(peer && hostLine && hostLine !== title);

  const chatDest = (peer && peer.address) || id;
  const tcpKeyForFabricResync = (peer && peer.address) || (id && String(id).includes(':') ? id : '');
  const canRequestFabricResync = !!(
    isConnected &&
    tcpKeyForFabricResync &&
    !String(id).startsWith('fabric-bridge-')
  );
  const hasUnlockedIdentity = !!(current && typeof current.hasUnlockedIdentity === 'function' && current.hasUnlockedIdentity());
  const canSendPeerChat = !!chatDest && hasUnlockedIdentity;
  const identityClass = classifyHubBrowserIdentity(props.auth);
  const chatIdentityHeading = identityClass === 'watch_only'
    ? pv.chat.watchOnlyHeading
    : (identityClass === 'none' ? pv.chat.noIdentityHeading : pv.chat.lockedHeading);
  const chatIdentityReason = identityClass === 'unlocked'
    ? `${common.identity.peerLocked} ${common.identity.howToUnlock}`
    : fabricIdentityPeerDisabledReasonPlain(props.auth);
  const chatPlaceholder = hasUnlockedIdentity
    ? pv.chat.placeholder
    : (identityClass === 'watch_only'
      ? pv.chat.placeholderWatchOnly
      : (identityClass === 'none' ? pv.chat.placeholderNoIdentity : pv.chat.placeholderLocked));

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

  const sendInventoryRequest = (kind, optsIn) => {
    // Prefer both id + address when present so hub _resolvePeerAddress / TCP map matches ListPeers rows.
    const invDest = (peer && peer.address && peer.id)
      ? { address: peer.address, id: peer.id }
      : ((peer && peer.address) || (peer && peer.id) || id);
    if (!invDest || !bridgeRef || !bridgeRef.current || typeof bridgeRef.current.sendPeerInventoryRequest !== 'function') return;
    const opts = optsIn && typeof optsIn === 'object' ? { ...optsIn } : {};
    try {
      const bi = bridgeRef.current;
      if (bi && typeof bi.getHtlcRefundPublicKeyHex === 'function') {
        const pk = bi.getHtlcRefundPublicKeyHex();
        if (pk && !opts.buyerRefundPublicKey) opts.buyerRefundPublicKey = pk;
      }
    } catch (_) {}
    setInventoryRequestMeta({ at: Date.now(), kind: kind || 'documents', status: 'sent' });
    bridgeRef.current.sendPeerInventoryRequest(invDest, kind || 'documents', opts);
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
        setInviteError(r.message || pv.invite.failed);
        return;
      }
      if (r && r.status === 'success' && r.inviteId) {
        setInviteOk(pv.invite.sent(r.inviteId.slice(0, 16)));
      } else {
        setInviteOk(pv.invite.sentPlain);
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
      setContactAddErr(pv.contact.noToken);
      return;
    }
    if (!fp) {
      setContactAddErr(pv.contact.noPeerId);
      return;
    }
    const bi = props.bridgeRef && props.bridgeRef.current;
    if (!bi || typeof bi.callHubJsonRpc !== 'function') {
      setContactAddErr(pv.contact.notReady);
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
        setContactAddErr(res.message || pv.contact.failed);
        return;
      }
      setContactAddOk(pv.contact.added);
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
            >
              <Icon name="arrow left" aria-hidden="true" />
              {pv.back}
            </Button>
            <div style={{ minWidth: 0 }}>
              <Header as="h2" id="peer-detail-heading" style={{ margin: 0, fontWeight: 600, lineHeight: 1.25, fontSize: '1.28rem', wordBreak: 'break-all' }}>
                {title}
              </Header>
              {showHostLine ? (
                <div style={{ fontSize: '0.82rem', color: '#767676', marginTop: '0.15rem' }}>
                  {hostLine}
                </div>
              ) : null}
              <div
                role="status"
                aria-live="polite"
                id="peer-detail-status"
                style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}
              >
                <span>{pv.status.label}:</span>
                {xpubOnlyNoPeer ? (
                  <Label size="small" color="blue" title={pv.status.publicKeyTitle}>
                    <Icon name="key" aria-hidden="true" /> {pv.status.publicKey}
                  </Label>
                ) : !hasPeerRow && webrtcRegistration ? (
                  <Label size="small" color="blue" title={pv.status.browserTitle}>
                    <Icon name="wifi" aria-hidden="true" /> {pv.status.browser}
                  </Label>
                ) : !hasPeerRow ? (
                  <Label size="small" color="grey" title={pv.status.resolvingTitle}>
                    <Icon name="clock outline" aria-hidden="true" /> {pv.status.resolving}
                  </Label>
                ) : (
                  <Label size="small" color={isConnected ? 'green' : 'grey'} title={status}>
                    {isConnected ? (
                      <><Icon name="check circle" aria-hidden="true" /> {pv.status.connected}</>
                    ) : (
                      <><Icon name="minus circle" aria-hidden="true" /> {pv.status.disconnected}</>
                    )}
                  </Label>
                )}
              </div>
              {webrtcRegistration ? (
                <div style={{ fontSize: '0.78rem', color: '#555', marginTop: '0.25rem', maxWidth: '38rem' }}>
                  <Label size="mini" basic color="blue">{pv.browserTag}</Label>
                  {webrtcXpub ? (
                    <span style={{ marginLeft: '0.35rem' }} title={webrtcXpub}>
                      {pv.publicKeyPrefix} <code>{shortenPublicId(webrtcXpub, 14, 12)}</code>
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
          </div>
          {!xpubOnlyNoPeer && (
            <Button.Group size="small" basic style={{ flexShrink: 0 }}>
              <Button
                icon
                title={pv.actions.refresh}
                aria-label={pv.actions.refresh}
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
                  title={pv.actions.reconnect(peer.address)}
                  aria-label={pv.actions.reconnect(peer.address)}
                >
                  <Icon name="plug" />
                </Button>
              )}
              {hasPeerRow && id && isConnected && typeof props.onDisconnectPeer === 'function' && (
                <Button
                  icon
                  color="red"
                  onClick={() => props.onDisconnectPeer(id)}
                  title={pv.actions.disconnect}
                  aria-label={pv.actions.disconnect}
                >
                  <Icon name="remove" />
                </Button>
              )}
              {hasPeerRow && canRequestFabricResync && typeof props.onFabricPeerResync === 'function' && (
                <Button
                  icon
                  title={pv.actions.resync}
                  aria-label={pv.actions.resync}
                  onClick={() => props.onFabricPeerResync(tcpKeyForFabricResync)}
                >
                  <Icon name="sync" />
                </Button>
              )}
              {hasPeerRow && id && typeof props.onSetPeerNickname === 'function' && (
                <Button icon onClick={openNicknameModal} title={pv.actions.nickname} aria-label={pv.actions.nickname}>
                  <Icon name="tag" />
                </Button>
              )}
              {hubAdminCollaborationToken && fabricPeerIdForCollaborationContact && !xpubOnlyNoPeer ? (
                <Button
                  icon
                  loading={contactAddBusy}
                  disabled={contactAddBusy}
                  title={pv.actions.addContact}
                  aria-label={pv.actions.addContact}
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
              {pv.advanced.title}
            </Accordion.Title>
            <Accordion.Content active={peerOpsAccordionOpen}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
                {bridgeRef && bridgeRef.current && typeof bridgeRef.current.sendPeerInventoryRequest === 'function' ? (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: '12em', maxWidth: '18rem', flex: '1 1 12em' }}>
                      <label htmlFor="peer-inventory-relay" style={{ fontSize: '0.85em', fontWeight: 600 }}>{pv.advanced.relayLabel}</label>
                      <Input
                        id="peer-inventory-relay"
                        size="small"
                        placeholder={pv.advanced.relayPlaceholder}
                        title={pv.advanced.relayTitle}
                        value={inventoryRelayTarget}
                        onChange={(e, { value }) => setInventoryRelayTarget(value)}
                      />
                    </div>
                    <Button
                      size="small"
                      basic
                      onClick={() => {
                        const t = (inventoryRelayTarget || '').trim();
                        const opts = t ? { inventoryTarget: t } : {};
                        sendInventoryRequest('documents', opts);
                      }}
                      title={pv.advanced.requestDocumentsTitle}
                    >
                      <Icon name="list alternate outline" />
                      {pv.advanced.requestDocuments}
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
                        title={pv.advanced.requestWithHtlcTitle}
                      >
                        <Icon name="bitcoin" />
                        {pv.advanced.requestWithHtlc}
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {adminTokenPresent ? (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: '10em', maxWidth: '16rem', flex: '1 1 10em' }}>
                      <label htmlFor="peer-invite-contract" style={{ fontSize: '0.85em', fontWeight: 600 }}>{pv.advanced.contractLabel}</label>
                      <Input
                        id="peer-invite-contract"
                        size="small"
                        value={federationContractId}
                        onChange={(e, { value }) => setFederationContractId(value)}
                        title={pv.advanced.contractTitle}
                      />
                    </div>
                    <Button
                      size="small"
                      basic
                      primary
                      loading={inviteBusy}
                      disabled={inviteBusy}
                      title={pv.advanced.inviteTitle}
                      onClick={launchInviteNoteModal}
                    >
                      <Icon name="users" />
                      {pv.advanced.invite}
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
            <Link to="/settings/collaboration">{pv.contact.open}</Link>
          </Message>
        ) : null}

        <Divider />

        <Menu pointing secondary compact style={{ margin: '0 0 0.65rem', flexWrap: 'wrap' }}>
          <Menu.Item active={peerWorkspaceTab === 0} onClick={() => setPeerWorkspaceTab(0)}>
            {pv.tabs.overview}
          </Menu.Item>
          <Menu.Item
            active={peerWorkspaceTab === 1}
            onClick={() => peer && setPeerWorkspaceTab(1)}
            disabled={!peer}
          >
            {pv.tabs.chat(peer ? peerChats.length : 0)}
          </Menu.Item>
          <Menu.Item
            active={peerWorkspaceTab === 2}
            onClick={() => peer && setPeerWorkspaceTab(2)}
            disabled={!peer}
          >
            {pv.tabs.documents(peer ? inventoryDocs.length : 0)}
          </Menu.Item>
        </Menu>

        {peerWorkspaceTab === 0 && (
          <Segment basic style={{ padding: 0, marginBottom: '0.75rem', boxShadow: 'none', border: 'none' }}>
            {peer ? (
              <>
                <Table compact definition striped size="small" style={{ marginBottom: '0.65rem' }}>
                  <Table.Body>
                    {(() => {
                      const sigHost = typeof window !== 'undefined' ? window.location.host : '';
                      const connStr = peerNativePeeringString(peer, sigHost);
                      if (!connStr) return null;
                      const signaling = peerPeeringEndpointIsSignaling(peer);
                      const copyPeering = () => {
                        try {
                          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(connStr);
                          } else if (typeof document !== 'undefined') {
                            const ta = document.createElement('textarea');
                            ta.value = connStr;
                            ta.style.position = 'fixed';
                            ta.style.opacity = '0';
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                          }
                          setPeeringCopied(true);
                          window.setTimeout(() => setPeeringCopied(false), 1500);
                        } catch (e) { /* ignore */ }
                      };
                      return (
                        <Table.Row>
                          <Table.Cell collapsing>{pv.details.connection}</Table.Cell>
                          <Table.Cell>
                            <code style={{ wordBreak: 'break-all', fontSize: '0.86em' }}>{connStr}</code>
                            {' '}
                            <Button
                              size="mini"
                              basic
                              icon
                              labelPosition="left"
                              type="button"
                              onClick={copyPeering}
                              title={pv.details.copyTitle}
                              style={{ marginLeft: '0.35em', verticalAlign: 'middle' }}
                            >
                              <Icon name="copy" />
                              {peeringCopied ? common.actions.copied : pv.details.copy}
                            </Button>
                            <div style={{ color: '#767676', fontSize: '0.82em', marginTop: '0.35em' }}>
                              {signaling ? pv.details.signalingNote : pv.details.directNote}
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })()}
                    <Table.Row>
                      <Table.Cell collapsing>{pv.details.peerId}</Table.Cell>
                      <Table.Cell>
                        <code style={{ wordBreak: 'break-all', fontSize: '0.86em' }}>{fabricPeerBech32Id(peer) || common.none}</code>
                      </Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>{pv.details.address}</Table.Cell>
                      <Table.Cell>
                        <code style={{ fontSize: '0.86em' }}>{resolvedAddress || common.none}</code>
                        {(host || port) ? (
                          <span style={{ color: '#767676', fontSize: '0.82em', marginLeft: '0.5em' }}>
                            ({host}{port ? `:${port}` : ''})
                          </span>
                        ) : null}
                      </Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>{pv.details.publicKey}</Table.Cell>
                      <Table.Cell style={{ wordBreak: 'break-all', fontSize: '0.86em' }}><code>{(peer && peer.id) || common.none}</code></Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>{pv.details.nickname}</Table.Cell>
                      <Table.Cell>{(peer && peer.nickname) || common.none}</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>{pv.details.alias}</Table.Cell>
                      <Table.Cell>{(peer && peer.alias) || common.none}</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>{pv.details.trust}</Table.Cell>
                      <Table.Cell>{peer && peer.score != null ? String(peer.score) : common.none}</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>{pv.details.data}</Table.Cell>
                      <Table.Cell>
                        {(() => {
                          const inn = peer && peer.bytesIn;
                          const out = peer && peer.bytesOut;
                          const used = peer && Number.isFinite(Number(peer.windowBytes))
                            ? Number(peer.windowBytes)
                            : ((Number(peer && peer.windowBytesIn) || 0) + (Number(peer && peer.windowBytesOut) || 0));
                          const budget = peer && Number(peer.budgetBytes);
                          const fmt = (n) => {
                            const v = Number(n);
                            if (!Number.isFinite(v) || v < 0) return common.none;
                            if (v < 1024) return `${Math.round(v)} B`;
                            if (v < 1048576) return `${(v / 1024).toFixed(1)} KiB`;
                            return `${(v / 1048576).toFixed(2)} MiB`;
                          };
                          if (inn == null && out == null && !used) return common.none;
                          const budgetLabel = Number.isFinite(budget) && budget > 0 ? fmt(budget) : '32 KiB';
                          return (
                            <span>
                              {pv.details.dataTotals(fmt(inn), fmt(out))}
                              <span style={{ color: peer && peer.overBudget ? '#9f3a38' : '#767676', marginLeft: '0.65em' }}>
                                {pv.details.dataWindow(fmt(used), budgetLabel)}
                              </span>
                            </span>
                          );
                        })()}
                      </Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>{pv.details.firstSeen}</Table.Cell>
                      <Table.Cell>{formatMaybeDate(peer && peer.firstSeen) || common.none}</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell collapsing>{pv.details.lastSeen}</Table.Cell>
                      <Table.Cell>{formatMaybeDate(peer && (peer.lastSeen || peer.lastMessage)) || common.none}</Table.Cell>
                    </Table.Row>
                    {peer && peer.connection ? (
                      <Table.Row>
                        <Table.Cell collapsing>{pv.details.socket}</Table.Cell>
                        <Table.Cell style={{ fontSize: '0.86em' }}>
                          {peer.connection.remoteAddress ? `${peer.connection.remoteAddress}:${peer.connection.remotePort || ''}` : pv.details.socketConnected}
                          {peer.connection.lastMessage ? ` · ${pv.details.lastMessage(formatMaybeDate(peer.connection.lastMessage))}` : ''}
                          {peer.connection.failureCount != null ? ` · ${pv.details.failures(peer.connection.failureCount)}` : ''}
                        </Table.Cell>
                      </Table.Row>
                    ) : null}
                  </Table.Body>
                </Table>
                {neighborDot ? (
                  <Segment secondary style={{ marginTop: '0.35rem' }}>
                    <Header as="h4" style={{ marginBottom: '0.35rem' }}>{pv.neighbors.heading}</Header>
                    <p style={{ color: '#666', marginBottom: '0.5rem', fontSize: '0.9em', lineHeight: 1.45 }}>
                      {pv.neighbors.description}
                    </p>
                    <GraphDocumentPreview dotSource={neighborDot} skipIdentityGate />
                    <List relaxed size="small" style={{ marginTop: '0.5rem' }}>
                      {gossipNeighbors.map((nid) => {
                        const n = String(nid || '').trim();
                        if (!n) return null;
                        return (
                          <List.Item key={n}>
                            <List.Content>
                              <Link to={`/peers/${encodeURIComponent(n)}`} title={pv.neighbors.openTitle}>
                                <code style={{ fontSize: '0.85em' }}>{n.length > 36 ? `${n.slice(0, 14)}…${n.slice(-10)}` : n}</code>
                              </Link>
                              <Button
                                size="mini"
                                basic
                                style={{ marginLeft: '0.35em' }}
                                type="button"
                                title={pv.neighbors.useAsRelayTitle}
                                onClick={() => setInventoryRelayTarget(n)}
                              >
                                {pv.neighbors.useAsRelay}
                              </Button>
                            </List.Content>
                          </List.Item>
                        );
                      })}
                    </List>
                    <details className="hub-developer-details" style={{ marginTop: '0.5rem' }}>
                      <summary style={{ cursor: 'pointer', color: '#555', fontSize: '0.88em' }}>{net.dotSource}</summary>
                      <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.72rem', background: '#f5f5f5', padding: '0.45rem', borderRadius: 4 }}>{neighborDot}</pre>
                    </details>
                  </Segment>
                ) : null}
              </>
            ) : routeLooksLikeXpub ? (
              <Message info style={{ margin: 0 }}>
                <Message.Header>{pv.publicKeyRoute.heading}</Message.Header>
                <p style={{ margin: '0.35em 0 0' }}>
                  {pv.publicKeyRoute.bodyBefore} <Link to="/peers">{pv.publicKeyRoute.peersLink}</Link> {pv.publicKeyRoute.bodyAfter}
                </p>
              </Message>
            ) : (
              <Segment placeholder basic style={{ padding: '1rem' }}>
                <Header as="h4">{pv.waiting.heading}</Header>
                <p style={{ color: '#666', margin: '0.35em 0 0.65em', fontSize: '0.92em' }}>
                  {pv.waiting.bodyBefore} <Link to="/peers">{pv.waiting.peersLink}</Link> {pv.waiting.bodyAfter}
                </p>
                <Loader active inline="centered" size="small" />
                {peerResolveSlow ? (
                  <Message warning style={{ marginTop: '0.85em', textAlign: 'left' }} size="small">
                    <Message.Header>{pv.waiting.slowHeading}</Message.Header>
                    <p style={{ margin: '0.25em 0 0', fontSize: '0.9em' }}>
                      {pv.waiting.slowBody}
                    </p>
                  </Message>
                ) : null}
              </Segment>
            )}
          </Segment>
        )}

        {peerWorkspaceTab === 1 && peer && (
          <Segment style={{ marginTop: 0 }}>
            <Header as="h4" style={{ marginTop: 0 }}>{pv.chat.heading}</Header>
            {!hasUnlockedIdentity && (
              <Message warning size="small" style={{ marginBottom: '0.75em' }}>
                <Message.Header>{chatIdentityHeading}</Message.Header>
                <p style={{ margin: 0, lineHeight: 1.45 }}>
                  {chatIdentityReason} {pv.chat.received}
                </p>
              </Message>
            )}
            {hasUnlockedIdentity && !isConnected && (
              <Message info size="small" style={{ marginBottom: '0.75em' }}>
                {pv.chat.offline}
              </Message>
            )}
            {peerChats.length > 0 ? (
              <List divided size="small">
                {peerChats.map((chat, index) => {
                  const created = (chat.object && chat.object.created) || Date.now();
                  const bridgeInstance = props.bridgeRef?.current || props.bridge?.current;
                  const rawActor = (chat.actor && (chat.actor.username || chat.actor.id)) || pv.chat.unknownSender;
                  const actor = (bridgeInstance && typeof bridgeInstance.getPeerDisplayName === 'function' && chat.actor?.id)
                    ? bridgeInstance.getPeerDisplayName(chat.actor.id)
                    : rawActor;
                  const content = (chat.object && (chat.object.content || chat.object.body || chat.object.text)) || '';
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
                            {isPending && ` (${pv.chat.sending})`}
                            {isQueued && (
                              <Icon
                                name="exclamation circle"
                                color="grey"
                                style={{ marginLeft: '0.35em' }}
                                title={pv.chat.queuedTitle}
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
              <p style={{ color: '#666' }}>{pv.chat.empty}</p>
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
                placeholder={chatPlaceholder}
                title={pv.chat.sendTitle(chatDest)}
                disabled={!canSendPeerChat}
              />
            )}
          </Segment>
        )}

        {peerWorkspaceTab === 2 && peer && (
          <Segment style={{ marginTop: 0 }}>
            <Header as="h4" style={{ marginTop: 0 }}>{pv.documents.heading}</Header>
            <p style={{ color: '#666', marginBottom: '0.65em', fontSize: '0.92em', lineHeight: 1.45 }}>
              {pv.documents.introBefore}
              {id ? <> (<code style={{ fontSize: '0.9em' }}>{id.length > 24 ? `${id.slice(0, 12)}…${id.slice(-8)}` : id}</code>)</> : ''}.
              {' '}{pv.documents.introAfter}
            </p>
            {inventoryRequestMeta && (
              <p style={{ fontSize: '0.85em', color: inventoryRequestMeta.status === 'error' ? '#9f3a38' : inventoryRequestMeta.status === 'accepted' ? '#276749' : '#666', marginBottom: '0.65em' }}>
                {pv.documents.lastRequest(formatMaybeDate(inventoryRequestMeta.at))}
                {inventoryRequestMeta.kind ? ` (${inventoryRequestMeta.kind})` : ''}
                {inventoryRequestMeta.requestVia === 'http' ? ` · ${pv.documents.viaHttp}` : ''}
                {inventoryRequestMeta.requestVia === 'ws' ? ` · ${pv.documents.viaWebSocket}` : ''}
                {'. '}
                {inventoryRequestMeta.hubMessage
                  ? inventoryRequestMeta.hubMessage
                  : inventoryRequestMeta.status === 'accepted'
                    ? pv.documents.accepted
                    : (inventoryDocs.length > 0
                      ? pv.documents.received(inventoryDocs.length)
                      : pv.documents.none)}
              </p>
            )}
            <div style={{ marginBottom: '0.75em' }}>
              <Checkbox
                toggle
                label={pv.documents.rawToggle}
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
                    ? pv.htlc.verifiedHeading
                    : pv.htlc.heading}
                </Message.Header>
                {(htlcConfirmFeedback.message || htlcConfirmFeedback.funded) && (
                  <p>{htlcConfirmFeedback.message || (htlcConfirmFeedback.funded ? pv.htlc.funded : '')}</p>
                )}
                {htlcConfirmFeedback.documentId && (
                  <p style={{ fontSize: '0.9em' }}>{pv.htlc.document} <code>{htlcConfirmFeedback.documentId}</code></p>
                )}
                {htlcConfirmFeedback.txid && (
                  <p style={{ fontSize: '0.9em' }}>
                    {pv.htlc.transaction}{' '}
                    {uf.bitcoinExplorer ? (
                      <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(htlcConfirmFeedback.txid).trim())}`}>
                        <code>{htlcConfirmFeedback.txid}</code>
                      </Link>
                    ) : (
                      <code title={net.explorerOff}>{htlcConfirmFeedback.txid}</code>
                    )}
                    <span style={{ color: '#666' }}> ({pv.htlc.unconfirmed})</span>
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
                        {(doc && doc.name) || (doc && doc.id) || pv.documents.fallbackName}
                      </List.Header>
                      <List.Description style={{ color: '#666' }}>
                        {doc && doc.id && (<span>{pv.documents.id} <code>{doc.id}</code></span>)}
                        {doc && (doc.lineage || doc.id) && (
                          <> · {pv.documents.author} <code style={{ fontSize: '0.9em' }}>{String(doc.lineage || doc.id).length > 20 ? `${String(doc.lineage || doc.id).slice(0, 10)}…${String(doc.lineage || doc.id).slice(-6)}` : String(doc.lineage || doc.id)}</code></>
                        )}
                        {doc && doc.size != null && <> · {pv.documents.size(doc.size)}</>}
                        {doc && doc.published && <> · {pv.documents.published}</>}
                        {doc && doc.purchasePriceSats != null && <> · <strong>{common.sats(doc.purchasePriceSats)}</strong></>}
                      </List.Description>
                      {doc && doc.htlc && doc.htlc.settlementId && (
                        <div
                          data-testid="peer-inventory-htlc"
                          data-settlement-id={doc.htlc.settlementId}
                          style={{ marginTop: '0.75em', fontSize: '0.85em', textAlign: 'left' }}
                        >
                          <Label color="orange" size="small">{pv.htlc.tag}</Label>
                          <div style={{ marginTop: '0.35em' }}>
                            <strong>{common.sats(doc.htlc.amountSats || 0)}</strong>
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
                                  alt={pv.htlc.qrAlt}
                                  style={{ borderRadius: 4, border: '1px solid #ddd' }}
                                />
                              )}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35em' }}>
                                <Button
                                  size="mini"
                                  basic
                                  onClick={() => copyHtlcFunding(doc.htlc.bitcoinUri, `${doc.htlc.settlementId}:uri`)}
                                >
                                  <Icon name="copy" /> {htlcFundingCopied === `${doc.htlc.settlementId}:uri` ? common.actions.copied : pv.htlc.copyLink}
                                </Button>
                                <Button
                                  size="mini"
                                  basic
                                  onClick={() => copyHtlcFunding(doc.htlc.paymentAddress, `${doc.htlc.settlementId}:addr`)}
                                >
                                  <Icon name="copy" /> {htlcFundingCopied === `${doc.htlc.settlementId}:addr` ? common.actions.copied : pv.htlc.copyAddress}
                                </Button>
                                {adminTokenPresent && doc.htlc.bitcoinUri && (
                                  <>
                                    <Button
                                      as="a"
                                      size="mini"
                                      primary
                                      href={String(doc.htlc.bitcoinUri).trim()}
                                      title={pv.htlc.payNowTitle}
                                    >
                                      <Icon name="bitcoin" /> {pv.htlc.payNow}
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
                                              message: pv.htlc.hubSent,
                                              txid
                                            });
                                          } else {
                                            setHtlcConfirmFeedback({
                                              status: 'error',
                                              message: (res && res.message) ? res.message : pv.htlc.noTxid
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
                                      title={pv.htlc.payFromHubTitle}
                                    >
                                      <Icon name="server" /> {pv.htlc.payFromHub}
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                          <div style={{ marginTop: '0.35em', color: '#666' }}>
                            {pv.htlc.hashLine(String(doc.htlc.paymentHashHex || '').slice(0, 16), doc.htlc.refundLockHeight)}
                          </div>
                          <label
                            htmlFor={`peer-htlc-txid-${doc.htlc.settlementId}`}
                            style={{ display: 'block', marginTop: '0.5em', fontWeight: 600 }}
                          >
                            {pv.htlc.txidLabel}
                          </label>
                          <div style={{ marginTop: '0.25em', display: 'flex', gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
                            <Input
                              id={`peer-htlc-txid-${doc.htlc.settlementId}`}
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
                              {pv.htlc.confirm}
                            </Button>
                            {/^[a-fA-F0-9]{64}$/.test(String(htlcTxids[doc.htlc.settlementId] || '').trim()) && (
                              uf.bitcoinExplorer ? (
                                <Link
                                  style={{ fontSize: '0.85em', alignSelf: 'center' }}
                                  to={`/services/bitcoin/transactions/${encodeURIComponent(String(htlcTxids[doc.htlc.settlementId]).trim())}`}
                                >
                                  {pv.htlc.viewTx}
                                </Link>
                              ) : (
                                <code style={{ fontSize: '0.85em' }} title={net.explorerOff}>
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
              <p style={{ color: '#666' }}>{pv.documents.empty}</p>
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
          <Modal.Header>{pv.nicknameModal.title}</Modal.Header>
          <Modal.Content>
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                submitNickname();
              }}
            >
              <Form.Field>
                <label htmlFor="peer-nickname-input">{pv.nicknameModal.label}</label>
                <Input
                  id="peer-nickname-input"
                  value={nickDraft}
                  onChange={(e) => setNickDraft(e.target.value)}
                  maxLength={128}
                />
              </Form.Field>
            </Form>
          </Modal.Content>
          <Modal.Actions>
            <Button type="button" onClick={() => setNickModalOpen(false)}>{common.actions.cancel}</Button>
            <Button type="button" primary onClick={submitNickname}>
              <Icon name="tag" />
              {pv.nicknameModal.save}
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
          <Modal.Header>{pv.invite.modalTitle}</Modal.Header>
          <Modal.Content>
            <Form
              onSubmit={async (e) => {
                e.preventDefault();
                await submitInviteToContract();
              }}
            >
              <Form.Field>
                <label htmlFor="peer-invite-note-input">{pv.invite.noteLabel}</label>
                <Form.TextArea
                  id="peer-invite-note-input"
                  value={inviteNoteDraft}
                  onChange={(e) => setInviteNoteDraft(e.target.value)}
                  rows={4}
                  maxLength={500}
                />
              </Form.Field>
            </Form>
          </Modal.Content>
          <Modal.Actions>
            <Button type="button" onClick={() => setInviteNoteModalOpen(false)}>{common.actions.cancel}</Button>
            <Button type="button" primary loading={inviteBusy} disabled={inviteBusy} onClick={submitInviteToContract}>
              <Icon name="users" />
              {pv.invite.send}
            </Button>
          </Modal.Actions>
        </Modal>
      </Segment>
    </fabric-peer-detail>
  );
}

module.exports = PeerDetail;
