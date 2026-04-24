'use strict';

// Dependencies
const React = require('react');
const { Link, useNavigate } = require('react-router-dom');

// Semantic UI
const {
  Button,
  Divider,
  Form,
  Header,
  Icon,
  Input,
  Label,
  List,
  Loader,
  Message,
  Segment
} = require('semantic-ui-react');

const { sha256: sha256Hash } = require('@noble/hashes/sha2.js');

// Fabric Types
const Actor = require('@fabric/core/types/actor');
const DistributeProposalsList = require('./DistributeProposalsList');
const { formatSatsDisplay } = require('../functions/formatSats');
const { isHubNetworkStatusShape, bridgeWebSocketLoadingHint } = require('../functions/hubNetworkStatus');
const { hydrateHubNetworkStatusViaHttp } = require('../functions/hydrateHubNetworkStatusViaHttp');
const { classifyHubBrowserIdentity } = require('../functions/hubIdentityUiHints');
const HubPagination = require('./HubPagination');
const { useHubListPagination } = require('../functions/hubListPagination');
const { compareDocumentsByHostOfferThenPurchasePrice } = require('../functions/sortDocumentsByHostOfferThenPrice');

function shortHexId (value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 20) return s;
  return `${s.slice(0, 10)}…${s.slice(-8)}`;
}

function base64FromArrayBuffer (buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function sha256Hex (buffer) {
  const bytes = sha256Hash(new Uint8Array(buffer));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function textToBase64 (str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function jsonRpcErrText (err) {
  if (!err || typeof err !== 'object') return 'rejected';
  if (err.message != null) return String(err.message);
  if (err.data != null) return String(err.data);
  return 'rejected';
}

function DocumentsPage (props) {
  const [file, setFile] = React.useState(null);
  const [meta, setMeta] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [createDocName, setCreateDocName] = React.useState('');
  const [createDocContent, setCreateDocContent] = React.useState('');
  const [showCreateDoc, setShowCreateDoc] = React.useState(false);
  const [recentDocId, setRecentDocId] = React.useState(null);
  const [, setNetworkStatusTick] = React.useState(0);
  const [catalogHttpFallbackError, setCatalogHttpFallbackError] = React.useState(null);
  const [docsState, setDocsState] = React.useState({});
  const [distributeProposalsState, setDistributeProposalsState] = React.useState({});

  const navigate = useNavigate();

  React.useEffect(() => {
    const bump = () => setNetworkStatusTick((t) => t + 1);
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('networkStatusUpdate', bump);
    return () => window.removeEventListener('networkStatusUpdate', bump);
  }, []);

  // Pull published index from hub networkStatus (global store = source of truth for published state).
  const bridgeRef = props.bridgeRef;
  const current = bridgeRef && bridgeRef.current;
  const hasEncryptionKey = !!(current && typeof current.hasDocumentEncryptionKey === 'function' && current.hasDocumentEncryptionKey());
  const networkStatus = current && (current.networkStatus || current.lastNetworkStatus);
  const hasNetworkSnapshot = isHubNetworkStatusShape(networkStatus);

  React.useEffect(() => {
    if (hasNetworkSnapshot) setCatalogHttpFallbackError(null);
  }, [hasNetworkSnapshot]);
  const publishedRaw = networkStatus && networkStatus.publishedDocuments;
  const indexed = !hasNetworkSnapshot
    ? null
    : (publishedRaw && typeof publishedRaw === 'object' ? publishedRaw : {});
  const fabricPeerId = networkStatus && networkStatus.fabricPeerId ? String(networkStatus.fabricPeerId) : null;

  const documentsLoadingSubtext = !current
    ? 'Connecting to the hub (WebSocket bridge)…'
    : (bridgeWebSocketLoadingHint(current) || 'Waiting for network status from the hub (published catalog).');

  React.useEffect(() => {
    const handler = (event) => {
      const gs = event && event.detail && event.detail.globalState;
      if (gs && gs.documents) setDocsState(gs.documents);
    };
    window.addEventListener('globalStateUpdate', handler);
    return () => window.removeEventListener('globalStateUpdate', handler);
  }, []);

  React.useEffect(() => {
    const bridgeInstance = bridgeRef && bridgeRef.current;
    if (bridgeInstance && bridgeInstance.globalState && bridgeInstance.globalState.documents) {
      setDocsState(bridgeInstance.globalState.documents);
    }
  }, [bridgeRef]);

  // Briefly highlight the most recently added document.
  React.useEffect(() => {
    if (!recentDocId) return;
    const timer = setTimeout(() => setRecentDocId(null), 1500);
    return () => clearTimeout(timer);
  }, [recentDocId]);

  React.useEffect(() => {
    if (typeof props.onListDocuments !== 'function') return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) props.onListDocuments();
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When WebSocket snapshots are slow, hydrate catalog + hub document index via HTTP (same origin).
  React.useEffect(() => {
    if (hasNetworkSnapshot) return undefined;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      const bridge = props.bridgeRef && props.bridgeRef.current;
      const origin = typeof window !== 'undefined' && window.location && window.location.origin
        ? window.location.origin
        : '';
      if (!bridge || !origin) return;
      if (
        typeof bridge.applyHubNetworkStatusPayload !== 'function' ||
        typeof bridge.mergeListDocumentsRpcResult !== 'function'
      ) {
        return;
      }
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      const parseRpc = (r) => r.json().catch(() => null);
      Promise.all([
        hydrateHubNetworkStatusViaHttp(bridge, origin).then((applied) => ({ appliedViaHydrate: applied })),
        fetch(`${origin}/services/rpc`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ListDocuments', params: [] })
        }).then(async (r) => ({ ok: r.ok, status: r.status, body: await parseRpc(r) }))
      ])
        .then(([ns, list]) => {
          if (cancelled) return;
          const nsApplied = !!(ns && ns.appliedViaHydrate);
          const listBody = list && list.body;
          let listApplied = false;
          if (listBody && listBody.result && typeof bridge.mergeListDocumentsRpcResult === 'function') {
            listApplied = !!bridge.mergeListDocumentsRpcResult(listBody.result);
          }
          const listErr = listBody && listBody.error;
          const httpBad = !list || !list.ok;
          const parts = [];
          if (listErr) parts.push(`Document list: ${jsonRpcErrText(listErr)}`);
          if (!listErr && list && !list.ok) parts.push(`Document list: HTTP ${list.status}`);
          if (!nsApplied && !listApplied) {
            parts.push('Network status: could not hydrate via HTTP (hub down or unexpected GetNetworkStatus shape)');
          }
          if (parts.length) {
            setCatalogHttpFallbackError(parts.join(' · '));
          } else if (!listErr && listBody && !listApplied && listBody.result == null) {
            setCatalogHttpFallbackError(
              httpBad
                ? 'Hub did not return JSON-RPC results for catalog hydration. Check /services/rpc.'
                : 'Hub returned empty responses for the document list.'
            );
          } else if (!listErr && !listApplied && listBody && listBody.result != null) {
            setCatalogHttpFallbackError('Document list response could not be merged (unexpected shape).');
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setCatalogHttpFallbackError(
            (err && err.message) ? err.message : 'Network error while loading catalog from hub.'
          );
        });
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [hasNetworkSnapshot, props.bridgeRef]);

  // Unified model: all docs in documents store; hub index = published refs
  const allDocs = Object.values(docsState || {}).filter((d) => d && d.id);
  const docsById = {};

  // Start with all local documents (private by default).
  for (const d of allDocs) {
    docsById[d.id] = { ...d, isLocal: true };
  }

  // Merge in published index entries and mark them as published.
  // Prefer existing local Actor IDs (opaque ids) that share the same sha256,
  // so the same document doesn't appear twice (once by Actor id, once by sha).
  if (indexed && typeof indexed === 'object') {
    for (const value of Object.values(indexed)) {
      if (!value || !value.id) continue;
      const sha = value.sha256 || value.id;

      let targetId = value.id;

      if (sha) {
        const localMatch = allDocs.find((d) => {
          const dSha = d.sha256 || d.sha || d.id;
          return dSha === sha;
        });
        if (localMatch && localMatch.id) {
          targetId = localMatch.id;
        }
      }

      const existing = docsById[targetId] || {};
      docsById[targetId] = { ...existing, ...value, id: targetId, isPublished: true };
    }
  }

  const docs = Object.values(docsById)
    .filter((d) => d && d.id)
    .sort((a, b) => compareDocumentsByHostOfferThenPurchasePrice(a, b, distributeProposalsState));

  const docsResetKey = `${docs.length}:${docs[0] && docs[0].id}:${docs[docs.length - 1] && docs[docs.length - 1].id}`;
  const {
    slice: docsSlice,
    page: docsListActivePage,
    totalPages: docsTotalPages,
    rangeFrom: docsRangeFrom,
    rangeTo: docsRangeTo,
    total: docsListTotal,
    setPage: setDocsListPage
  } = useHubListPagination(docs, docsResetKey);

  const onPickFile = async (f) => {
    setError(null);
    setFile(f);
    setMeta(null);
    if (!f || !hasEncryptionKey) return;
    try {
      setBusy(true);
      const buffer = await f.arrayBuffer();
      const sha256 = sha256Hex(buffer);
      const contentBase64 = base64FromArrayBuffer(buffer);
      // Wrap file metadata in a Fabric Actor so the public document ID
      // is an opaque Actor id, not the raw sha256 hash.
      const payload = {
        sha256,
        name: f.name,
        mime: f.type || 'application/octet-stream',
        size: f.size
      };
      const actor = new Actor({ content: payload });
      const meta = {
        id: actor.id,
        sha256,
        name: payload.name,
        mime: payload.mime,
        size: payload.size,
        contentBase64
      };
      if (typeof props.onAddLocalDocument === 'function') {
        props.onAddLocalDocument(meta);
      }
      if (typeof props.onCreateDocument === 'function') {
        props.onCreateDocument(meta);
      }
      setRecentDocId(meta.id);
      setFile(null);
      // Navigate directly to the new document detail view
      navigate(`/documents/${encodeURIComponent(meta.id)}`);
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCreateDocument = () => {
    if (!hasEncryptionKey || !createDocContent.trim()) return;
    setError(null);
    try {
      const text = createDocContent.trim();
      const encoder = new TextEncoder();
      const buffer = encoder.encode(text);
      const sha256 = sha256Hex(buffer);
      const contentBase64 = textToBase64(text);
      const name = (createDocName || 'Untitled').trim() || 'Untitled';
      const payload = {
        sha256,
        name,
        mime: 'text/plain',
        size: buffer.length
      };
      const actor = new Actor({ content: payload });
      const meta = {
        id: actor.id,
        sha256,
        name: payload.name,
        mime: payload.mime,
        size: payload.size,
        contentBase64
      };
      if (typeof props.onAddLocalDocument === 'function') {
        props.onAddLocalDocument(meta);
      }
      if (typeof props.onCreateDocument === 'function') {
        props.onCreateDocument(meta);
      }
      setRecentDocId(meta.id);
      setCreateDocName('');
      setCreateDocContent('');
      setShowCreateDoc(false);
      // Navigate directly to the new document detail view
      navigate(`/documents/${encodeURIComponent(meta.id)}`);
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    }
  };

  return (
    <fabric-documents class='fade-in'>
      <Segment>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap', marginBottom: '0.25em' }}
          role="banner"
        >
          <Button basic size="small" as={Link} to="/" aria-label="Back to home">
            <Icon name="arrow left" aria-hidden="true" />
            Home
          </Button>
          <div
            style={{
              position: 'relative',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5em',
              flexWrap: 'wrap'
            }}
          >
            <Header as="h2" id="documents-page-heading" style={{ margin: 0 }}>
              Documents
            </Header>
            <span
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                padding: 0,
                margin: -1,
                overflow: 'hidden',
                clip: 'rect(0, 0, 0, 0)',
                whiteSpace: 'nowrap',
                border: 0
              }}
            >
              {docs.length} documents in this hub node
            </span>
            <Label
              size="small"
              title="Documents in this hub node"
              style={{ verticalAlign: 'middle' }}
              aria-hidden="true"
            >
              {docs.length}
            </Label>
          </div>
        </div>

        <Divider />

        {catalogHttpFallbackError && !hasNetworkSnapshot && (
          <Message
            warning
            size="small"
            style={{ marginBottom: '1em' }}
            onDismiss={() => setCatalogHttpFallbackError(null)}
          >
            <Message.Header>Could not fully load hub catalog over HTTP</Message.Header>
            <p style={{ margin: '0.35em 0 0', color: '#333' }}>{catalogHttpFallbackError}</p>
            <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', color: '#666' }}>
              The WebSocket session may still sync in a moment — or reload the page. JSON-RPC:{' '}
              <code style={{ fontSize: '0.85em' }}>/services/rpc</code>
            </p>
          </Message>
        )}

        {!hasEncryptionKey && (() => {
          const idMode = classifyHubBrowserIdentity(props.identity || {});
          const title = idMode === 'watch_only'
            ? 'Signing key not loaded (watch-only)'
            : idMode === 'password_locked'
              ? 'Private key not loaded'
              : 'Private key not loaded';
          return (
            <Message info style={{ marginBottom: '1em' }}>
              <p style={{ margin: 0, fontWeight: 600, color: '#333' }}>{title}</p>
              <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                {idMode === 'watch_only' ? (
                  <>
                    This browser only has a public key. To create or upload <strong>encrypted</strong> documents, import a full key: top-bar identity menu or <Link to="/settings">Settings</Link> → <strong>Fabric identity</strong>.{' '}
                  </>
                ) : idMode === 'password_locked' ? (
                  <>
                    Use the top-bar <strong>Locked</strong> control (encryption password) or <Link to="/settings">Settings</Link> → <strong>Fabric identity</strong>, then <strong>Unlock private key</strong>, to create or upload encrypted documents.{' '}
                  </>
                ) : (
                  <>
                    Create or restore a key: <Link to="/settings">Settings</Link> → <strong>Fabric identity</strong> or <strong>Log in</strong> in the top bar. Then you can create or upload encrypted documents.{' '}
                  </>
                )}
                <Link to="/settings/bitcoin-wallet">Bitcoin wallet &amp; derivation</Link> explains how the same identity drives Hub L1 addresses.
                For local dev use the same phrase as the hub (<code>FABRIC_SEED</code> if set, else <code>FABRIC_MNEMONIC</code>): <code>window.FABRIC_DEV_BROWSER_SEED</code> in <code>assets/config.local.js</code>, optional <code>window.FABRIC_DEV_BROWSER_PASSPHRASE</code> for BIP39 extension, or hub <code>FABRIC_DEV_PUSH_BROWSER_IDENTITY=1</code> (never on exposed hosts). For RPC-only automation see <code>npm run test:e2e-document-purchase</code>.
              </p>
            </Message>
          );
        })()}

        {hasEncryptionKey && (
          <Segment loading={busy}>
            <Header as="h3">Add content</Header>
            <p style={{ color: '#666' }}>
              Select a file or create a document from text. <strong>Publish</strong> adds the doc to the hub catalog (free).
              <strong> Distribute</strong> (long-term storage contracts) needs an on-chain invoice — open a document and follow <strong>Distribute</strong>, then pay from{' '}
              <Link to="/services/bitcoin">Bitcoin</Link> (or <Link to="/payments">Payments</Link> when enabled in Admin).
            </p>
            <Button
              size="small"
              basic
              icon
              labelPosition="left"
              onClick={() => setShowCreateDoc((v) => !v)}
              style={{ marginBottom: showCreateDoc ? '1em' : 0 }}
            >
              <Icon name={showCreateDoc ? 'minus' : 'plus'} />
              Create Document
            </Button>
            {showCreateDoc && (
              <Form style={{ marginTop: '0.75em', maxWidth: 560 }}>
                <Form.Field>
                  <label>Name</label>
                  <Input
                    placeholder="Document name"
                    value={createDocName}
                    onChange={(e) => setCreateDocName(e.target.value)}
                  />
                </Form.Field>
                <Form.Field>
                  <label>Content</label>
                  <Form.TextArea
                    placeholder="Enter your text here…"
                    value={createDocContent}
                    onChange={(e) => setCreateDocContent(e.target.value)}
                    rows={6}
                    style={{ fontFamily: 'monospace' }}
                  />
                </Form.Field>
                <Button size="small" primary onClick={onCreateDocument} disabled={!createDocContent.trim()}>
                  <Icon name="save" />
                  Create
                </Button>
                <Button size="small" basic onClick={() => { setShowCreateDoc(false); setCreateDocName(''); setCreateDocContent(''); }}>
                  Cancel
                </Button>
              </Form>
            )}
            <div style={{ marginTop: showCreateDoc ? '1em' : 0 }}>
              <label style={{ display: 'block', marginBottom: '0.5em', color: '#666' }}>Or add a file:</label>
                <Input
                type="file"
                onChange={(e) => onPickFile(e && e.target && e.target.files ? e.target.files[0] : null)}
                disabled={busy || !hasEncryptionKey}
              />
            </div>
            {error && (
              <Message
                negative
                style={{ marginTop: '1em' }}
                onDismiss={() => setError(null)}
              >
                <Message.Header>Could not add document</Message.Header>
                <p style={{ margin: '0.35em 0 0' }}>{error}</p>
              </Message>
            )}
          </Segment>
        )}

        <Segment>
          <Header as="h3">
            <Icon name="gift" />
            Offers
          </Header>
          <DistributeProposalsList bridgeRef={props.bridgeRef} embedded />
        </Segment>

        <Segment>
          <Header as="h3">Documents</Header>
          <Button
            type="button"
            size="small"
            icon
            labelPosition="left"
            basic
            onClick={() => typeof props.onListDocuments === 'function' && props.onListDocuments()}
            disabled={busy}
          >
            <Icon name="refresh" />
            Refresh
          </Button>
          {(!hasNetworkSnapshot && allDocs.length === 0) ? (
            <Segment
              placeholder
              style={{ marginTop: '1em', minHeight: '20vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <div>
                <Loader active inline="centered" />
                <Header as="h4" style={{ marginTop: '1em', textAlign: 'center' }}>
                  Loading documents…
                  <Header.Subheader>
                    {documentsLoadingSubtext}
                  </Header.Subheader>
                </Header>
              </div>
            </Segment>
          ) : (
            <>
            <List divided relaxed style={{ marginTop: '1em' }}>
              {docsSlice.map((doc) => {
                const labels = [];
                if (doc.isPublished) {
                  labels.push(
                    <Label
                      key="published"
                      size="mini"
                      color="blue"
                      style={{ marginLeft: '0.5em' }}
                      title="Published to hub"
                    >
                      <Icon name="bullhorn" />
                      Published
                    </Label>
                  );
                } else if (doc.isLocal) {
                  labels.push(
                    <Label
                      key="local"
                      size="mini"
                      color="grey"
                      style={{ marginLeft: '0.5em' }}
                      title="Private (local to this browser)"
                    >
                      <Icon name="lock" />
                      Private
                    </Label>
                  );
                }

                if (doc.contentEncrypted) {
                  labels.push(
                    <Label
                      key="encrypted"
                      size="mini"
                      color="green"
                      style={{ marginLeft: '0.25em' }}
                      title="Encrypted with your key"
                    >
                      <Icon name="shield" />
                      Encrypted
                    </Label>
                  );
                }

                const isBitcoinBlockDoc = doc.mime === 'application/x-fabric-bitcoin-block+json'
                  || String(doc.name || '').startsWith('Bitcoin block ');
                if (isBitcoinBlockDoc) {
                  labels.push(
                    <Label
                      key="bitcoin-block"
                      size="mini"
                      color="orange"
                      style={{ marginLeft: '0.25em' }}
                      title="Auto-published L1 block summary from this hub"
                    >
                      <Icon name="cube" />
                      L1 block
                    </Label>
                  );
                }

                const isBitcoinTxDoc = doc.mime === 'application/x-fabric-bitcoin-transaction+json'
                  || String(doc.name || '').startsWith('Bitcoin tx ');
                if (isBitcoinTxDoc) {
                  labels.push(
                    <Label
                      key="bitcoin-tx"
                      size="mini"
                      color="orange"
                      style={{ marginLeft: '0.25em' }}
                      title="Auto-published L1 transaction from an indexed block (optional; pruned nodes may drop from local inventory)"
                    >
                      <Icon name="exchange" />
                      L1 tx
                    </Label>
                  );
                }

                if (doc.storageContractId) {
                  labels.push(
                    <Label
                      key="storage"
                      as={Link}
                      to={`/contracts/${encodeURIComponent(doc.storageContractId)}`}
                      size="mini"
                      color="purple"
                      style={{ marginLeft: '0.25em' }}
                      title="Pay-to-distribute storage contract (L1 bonded)"
                    >
                      <Icon name="cloud" />
                      Storage
                    </Label>
                  );
                }

                if (doc.storageContractId && doc.storageL1Status && typeof doc.storageL1Status === 'object') {
                  const st = doc.storageL1Status;
                  const conf = st.confirmations != null ? Number(st.confirmations) : null;
                  let payColor = 'grey';
                  let payText = '';
                  let payTitle = 'Storage contract funding tx (from hub / bitcoind)';
                  if (conf != null && !Number.isNaN(conf) && conf > 0) {
                    payColor = 'green';
                    payText = `${conf} confirmation${conf === 1 ? '' : 's'}`;
                  } else if (st.inMempool) {
                    payColor = 'yellow';
                    payText = 'Mempool';
                    payTitle = 'Funding tx in mempool (0 confirmations)';
                  } else if (conf === 0) {
                    payColor = 'yellow';
                    payText = '0 confirmations';
                  } else {
                    payText = 'L1 n/a';
                    payTitle = 'Could not load tx from Bitcoin RPC';
                  }
                  labels.push(
                    <Label
                      key="storage-l1"
                      size="mini"
                      color={payColor}
                      style={{ marginLeft: '0.25em' }}
                      title={payTitle}
                    >
                      <Icon name="bitcoin" />
                      {payText}
                    </Label>
                  );
                }

                if (doc.isPublished && doc.purchasePriceSats != null && Number(doc.purchasePriceSats) > 0) {
                  labels.push(
                    <Label
                      key="priced"
                      size="mini"
                      color="orange"
                      style={{ marginLeft: '0.25em' }}
                      title="Listed L1 price (inventory HTLC)"
                    >
                      <Icon name="bitcoin" />
                      {formatSatsDisplay(doc.purchasePriceSats)} sats
                    </Label>
                  );
                }

                const isRecent = recentDocId && recentDocId === doc.id;
                const itemStyle = isRecent
                  ? {
                      background: '#f5f8ff',
                      transform: 'scale(1.01)',
                      transition: 'background 0.4s ease, transform 0.2s ease'
                    }
                  : {
                      transition: 'background 0.4s ease, transform 0.2s ease'
                    };

                return (
                  <List.Item key={doc.id} style={itemStyle}>
                    <List.Content>
                      <List.Header>
                        <Link to={`/documents/${encodeURIComponent(doc.id)}`}>{doc.name || doc.id}</Link>
                        {labels}
                      </List.Header>
                      <List.Description style={{ color: '#666' }}>
                        {doc.mime || 'application/octet-stream'} — {doc.size != null ? `${doc.size} bytes` : ''}
                        {doc.created ? ` — ${new Date(doc.created).toLocaleString()}` : ''}
                        {(doc.lineage || doc.id) && (
                          <span title="Fabric document id for the content creator (lineage)">
                            {' — '}author <code style={{ fontSize: '0.92em' }}>{shortHexId(doc.lineage || doc.id)}</code>
                          </span>
                        )}
                        {doc.isPublished && fabricPeerId && (
                          <span title="Fabric peer id of the hub hosting the published index">
                            {' — '}publisher <code style={{ fontSize: '0.92em' }}>{shortHexId(fabricPeerId)}</code>
                          </span>
                        )}
                        {!doc.storageContractId && doc.isPublished && (
                          <span title="Published but no bonded storage contract yet"> — not replicated</span>
                        )}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                );
              })}
              {docs.length === 0 && (
                <List.Item>
                  <List.Content>
                    <List.Description style={{ color: '#666' }}>No documents yet.</List.Description>
                  </List.Content>
                </List.Item>
              )}
            </List>
            {docsListTotal > 0 && (
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
                  Showing {docsRangeFrom}–{docsRangeTo} of {docsListTotal}
                </span>
                <HubPagination
                  activePage={docsListActivePage}
                  totalPages={docsTotalPages}
                  onPageChange={(e, d) => setDocsListPage(d.activePage)}
                  disabled={busy}
                  style={{ marginTop: 0, flex: '1 1 auto', minWidth: 0 }}
                />
              </div>
            )}
            </>
          )}
        </Segment>
      </Segment>
    </fabric-documents>
  );
}

module.exports = DocumentsPage;
