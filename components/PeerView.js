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
  Button,
  Card,
  Divider,
  Header,
  Icon,
  Input,
  Label,
  List,
  Message,
  Segment,
  Loader
} = require('semantic-ui-react');

const ChatInput = require('./ChatInput');
const { formatSatsDisplay } = require('../functions/formatSats');
const { loadUpstreamSettings, sendBridgePayment } = require('../functions/bitcoinClient');

function getAdminTokenFromProps (props) {
  const t = props && props.adminToken;
  if (t && String(t).trim()) return String(t).trim();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const s = window.localStorage.getItem('fabric.hub.adminToken');
      if (s && String(s).trim()) return String(s).trim();
    }
  } catch (e) {}
  return '';
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

  const bridge = props.bridge;
  const bridgeRef = props.bridgeRef;
  const current = (bridgeRef && bridgeRef.current) || (bridge && bridge.current);
  const candidate = current && current.networkStatus;
  const fallback = current && current.lastNetworkStatus;
  const networkStatus = isNetworkStatus(candidate) ? candidate : (isNetworkStatus(fallback) ? fallback : null);
  const peers = Array.isArray(networkStatus && networkStatus.peers) ? networkStatus.peers : [];

  const peerFromStatus = peers.find((p) => p && (p.address === id || p.id === id)) || null;
  const peer = detail && (detail.id || detail.address) ? detail : peerFromStatus;
  const status = peer && peer.status ? peer.status : 'unknown';
  const isConnected = status === 'connected';
  const adminTokenPresent = !!getAdminTokenFromProps(props);

  React.useEffect(() => {
    if (typeof props.onRefreshPeers === 'function') props.onRefreshPeers();
    if (typeof props.onGetPeer === 'function' && id) props.onGetPeer(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
      const storedPeer = peersById[id];
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

      // Derive inventory documents for this peer, if available.
      const invPeer = peersById[peerId] || storedPeer;
      const docs = invPeer && invPeer.inventory && Array.isArray(invPeer.inventory.documents)
        ? invPeer.inventory.documents
        : [];
      setInventoryDocs(docs);
    };

    const handler = (event) => {
      try {
        const globalState = event && event.detail && event.detail.globalState;
        if (!globalState) return;

        if (globalState.peers) {
          const stored = globalState.peers[id];
          if (stored) setDetail(stored);
        }

        deriveChatsAndInventory(globalState, detail);
      } catch (e) {}
    };

    // Initial load from persisted/restored state (survives refresh)
    const bridgeInstance = props.bridgeRef && props.bridgeRef.current;
    const gs = bridgeInstance && typeof bridgeInstance.getGlobalState === 'function'
      ? bridgeInstance.getGlobalState()
      : null;
    if (gs) deriveChatsAndInventory(gs, detail);

    window.addEventListener('globalStateUpdate', handler);
    return () => window.removeEventListener('globalStateUpdate', handler);
  }, [id, bridge, props.bridgeRef, detail]);

  const title = (peer && (peer.nickname || peer.alias || peer.id || peer.address)) || id || 'Peer';

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

  const handleSendPeerChat = (event) => {
    event.preventDefault();
    const text = (outgoingText || '').trim();
    if (!text) return;
    if (id && typeof props.onSendPeerMessage === 'function') {
      props.onSendPeerMessage(id, text);
      setOutgoingText('');
    }
  };

  const isPeerLoaded = !!peer;

  return (
    <fabric-peer-detail class='fade-in'>
      <Segment>
        <Header
          as='h2'
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75em',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
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
            <div>
              <div>{title}</div>
              {resolvedAddress && (
                <div style={{ fontSize: '0.85em', color: '#666' }}>
                  {host && <span>{host}</span>}
                  {port && <span>{host ? ':' : ''}{port}</span>}
                </div>
              )}
            </div>
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
          </div>
          <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
            <Button
              size="small"
              icon
              title="Refresh peer info"
              basic
              onClick={() => typeof props.onRefreshPeers === 'function' && props.onRefreshPeers()}
            >
              <Icon name="refresh" />
            </Button>
            {id && !isConnected && typeof props.onAddPeer === 'function' && (peer && peer.address) && (
              <Button
                size="small"
                basic
                onClick={() => props.onAddPeer({ address: peer.address })}
                title={`Reconnect to ${peer.address}`}
              >
                <Icon name="plug" />
                Reconnect
              </Button>
            )}
            {id && isConnected && typeof props.onDisconnectPeer === 'function' && (
              <Button
                size="small"
                basic
                color="red"
                onClick={() => props.onDisconnectPeer(id)}
                title={`Disconnect ${id}`}
              >
                <Icon name="remove" />
                Disconnect
              </Button>
            )}
            {id && isConnected && bridgeRef && bridgeRef.current && typeof bridgeRef.current.sendPeerInventoryRequest === 'function' && (
              <>
                <Input
                  size="small"
                  placeholder="Relay: seller Fabric ID (optional)"
                  title="When this connection is a relay, set the seller’s Fabric id so the hub forwards INVENTORY_REQUEST"
                  value={inventoryRelayTarget}
                  onChange={(e, { value }) => setInventoryRelayTarget(value)}
                  style={{ minWidth: '10em', maxWidth: '14em' }}
                />
                <Button
                  size="small"
                  basic
                  onClick={() => {
                    const t = (inventoryRelayTarget || '').trim();
                    const opts = t ? { inventoryTarget: t } : {};
                    bridgeRef.current.sendPeerInventoryRequest(id, 'documents', opts);
                  }}
                  title="Request document inventory from this peer"
                >
                  <Icon name="list alternate outline" />
                  Docs
                </Button>
                {typeof bridgeRef.current.getHtlcRefundPublicKeyHex === 'function' && bridgeRef.current.getHtlcRefundPublicKeyHex() && (
                  <Button
                    size="small"
                    basic
                    onClick={() => {
                      const refundPk = bridgeRef.current.getHtlcRefundPublicKeyHex();
                      const t = (inventoryRelayTarget || '').trim();
                      const opts = { buyerRefundPublicKey: refundPk };
                      if (t) opts.inventoryTarget = t;
                      bridgeRef.current.sendPeerInventoryRequest(id, 'documents', opts);
                    }}
                    title="Inventory with P2TR HTLC on priced items (your identity pubkey = refund path)"
                  >
                    <Icon name="bitcoin" />
                    Docs+HTLC
                  </Button>
                )}
              </>
            )}
            {id && typeof props.onSetPeerNickname === 'function' && (
              <Button
                size="small"
                basic
                onClick={() => {
                  const currentNick = (peer && peer.nickname) || '';
                  const value = window.prompt(`Node-local nickname for ${id}:`, currentNick);
                  if (value == null) return;
                  props.onSetPeerNickname(id, value);
                }}
                title={`Set node-local nickname for ${id}`}
              >
                <Icon name="tag" />
                Nick
              </Button>
            )}
          </div>
        </Header>

        <Divider />

        <Card fluid>
          <Card.Content>
            <Card.Header>Peer Details</Card.Header>
            <Card.Description>
              {isPeerLoaded ? (
                <List divided relaxed size="small">
                  <List.Item>
                    <List.Content>
                      <List.Header>Address</List.Header>
                      <List.Description>{resolvedAddress || 'unknown'}</List.Description>
                    </List.Content>
                  </List.Item>
                  <List.Item>
                    <List.Content>
                      <List.Header>Host</List.Header>
                      <List.Description>{host || 'unknown'}</List.Description>
                    </List.Content>
                  </List.Item>
                  <List.Item>
                    <List.Content>
                      <List.Header>Port</List.Header>
                      <List.Description>{port || '—'}</List.Description>
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
              ) : (
                <Segment
                  placeholder
                  basic
                  style={{ minHeight: '20vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <div>
                    <Loader active inline="centered" />
                    <Header as="h4" style={{ marginTop: '1em', textAlign: 'center' }}>
                      Loading peer details…
                      <Header.Subheader>
                        Fetching latest status from hub.
                      </Header.Subheader>
                    </Header>
                  </div>
                </Segment>
              )}
            </Card.Description>
          </Card.Content>
          <Card.Content extra>
            <Button
              size="small"
              basic
              onClick={() => navigate('/peers')}
              title="Back to list"
            >
              <Icon name="list" />
              Peers list
            </Button>
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
            {id && typeof props.onSendPeerMessage === 'function' && (
              <ChatInput
                value={outgoingText}
                onChange={setOutgoingText}
                onSubmit={(text) => {
                  if (id && typeof props.onSendPeerMessage === 'function') {
                    props.onSendPeerMessage(id, text);
                    setOutgoingText('');
                  }
                }}
                placeholder="Type a message…"
                title={`Send message to ${id} (queued if offline)`}
              />
            )}
          </Segment>
        )}

        {peer && (
          <Segment style={{ marginTop: '1em' }}>
            <Header as="h3">Publisher inventory</Header>
            <p style={{ color: '#666', marginBottom: '0.75em' }}>
              Documents offered by this <strong>publisher</strong>
              {id ? <> (Fabric peer <code style={{ fontSize: '0.9em' }}>{id.length > 24 ? `${id.slice(0, 12)}…${id.slice(-8)}` : id}</code>)</> : ''}.
              <strong> Author</strong> is the creator&apos;s document id when known (lineage).
            </p>
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
                    <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(htlcConfirmFeedback.txid).trim())}`}>
                      <code>{htlcConfirmFeedback.txid}</code>
                    </Link>
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
                                        const token = getAdminTokenFromProps(props);
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
                              <Link
                                style={{ fontSize: '0.85em', alignSelf: 'center' }}
                                to={`/services/bitcoin/transactions/${encodeURIComponent(String(htlcTxids[doc.htlc.settlementId]).trim())}`}
                              >
                                View funding tx
                              </Link>
                            )}
                          </div>
                        </div>
                      )}
                    </List.Content>
                  </List.Item>
                ))}
              </List>
            ) : (
              <p style={{ color: '#666' }}>No remote document inventory yet. Use "Fetch documents" to request it.</p>
            )}
          </Segment>
        )}
      </Segment>
    </fabric-peer-detail>
  );
}

module.exports = PeerDetail;
