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
const { isHubNetworkStatusShape, bridgeWebSocketLoadingHint } = require('../functions/hubNetworkStatus');
const { hydrateHubNetworkStatusViaHttp } = require('../functions/hydrateHubNetworkStatusViaHttp');
const {
  classifyHubBrowserIdentity,
  fabricIdentityNeedFullKeyPlain
} = require('../functions/hubIdentityUiHints');
const { loadServerFeatureFlags } = require('../functions/hubServerFeatureFlags');
const HubPagination = require('./HubPagination');
const { useHubListPagination } = require('../functions/hubListPagination');
const { compareDocumentsByHostOfferThenPurchasePrice } = require('../functions/sortDocumentsByHostOfferThenPrice');
const {
  collectInventoryDocuments,
  mergeInventoryDocumentsIntoMap
} = require('../functions/documentInventoryList');
const { useHubHttpAvailable, useHubMeshAvailable } = require('./hubUiRuntime');
const t = require('../locales/en');

const dl = t.documents.list;
const lb = dl.labels;
const rw = dl.row;

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
  if (!err || typeof err !== 'object') return dl.catalogErrors.refusedFallback;
  if (err.message != null) return String(err.message);
  if (err.data != null) return String(err.data);
  return dl.catalogErrors.refusedFallback;
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
  const [peersState, setPeersState] = React.useState({});
  const [distributeProposalsState, setDistributeProposalsState] = React.useState({});
  const hubHttpAvailable = useHubHttpAvailable();
  const meshAvailable = useHubMeshAvailable();
  const inventoryCatalog = !!(props.inventoryCatalog || (meshAvailable && !hubHttpAvailable));

  const navigate = useNavigate();

  React.useEffect(() => {
    const bump = () => setNetworkStatusTick((n) => n + 1);
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
  const documentMarket = networkStatus && networkStatus.documentMarket && typeof networkStatus.documentMarket === 'object'
    ? networkStatus.documentMarket
    : null;
  const documentMarketAccumulate = !!(documentMarket && documentMarket.accumulatePeerInventories);
  const serverFlags = loadServerFeatureFlags(current);
  const distributeEnabled = !!serverFlags.distribute;

  const documentsLoadingSubtext = !current
    ? dl.loadingConnecting
    : (inventoryCatalog
      ? dl.loadingInventories
      : (bridgeWebSocketLoadingHint(current) || dl.loadingCatalog));

  React.useEffect(() => {
    const handler = (event) => {
      const gs = event && event.detail && event.detail.globalState;
      if (gs && gs.documents) setDocsState(gs.documents);
      if (gs && gs.peers) setPeersState(gs.peers);
    };
    window.addEventListener('globalStateUpdate', handler);
    return () => window.removeEventListener('globalStateUpdate', handler);
  }, []);

  React.useEffect(() => {
    const bridgeInstance = bridgeRef && bridgeRef.current;
    if (bridgeInstance && bridgeInstance.globalState && bridgeInstance.globalState.documents) {
      setDocsState(bridgeInstance.globalState.documents);
    }
    if (bridgeInstance && bridgeInstance.globalState && bridgeInstance.globalState.peers) {
      setPeersState(bridgeInstance.globalState.peers);
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

  // When WebSocket snapshots are slow, hydrate catalog + hub document index via HTTP.
  React.useEffect(() => {
    if (hasNetworkSnapshot || inventoryCatalog) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
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
          if (listErr) parts.push(dl.catalogErrors.listRefused(jsonRpcErrText(listErr)));
          if (!listErr && list && !list.ok) parts.push(dl.catalogErrors.listHttp(list.status));
          if (!nsApplied && !listApplied) {
            parts.push(dl.catalogErrors.status);
          }
          if (parts.length) {
            setCatalogHttpFallbackError(parts.join(' · '));
          } else if (!listErr && listBody && !listApplied && listBody.result == null) {
            setCatalogHttpFallbackError(
              httpBad
                ? dl.catalogErrors.noResults
                : dl.catalogErrors.emptyResults
            );
          } else if (!listErr && !listApplied && listBody && listBody.result != null) {
            setCatalogHttpFallbackError(dl.catalogErrors.unreadable);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setCatalogHttpFallbackError(
            (err && err.message) ? err.message : t.common.errors.network
          );
        });
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasNetworkSnapshot, inventoryCatalog, props.bridgeRef]);

  // Unified model: all docs in documents store; hub index = published refs
  const allDocs = Object.values(docsState || {}).filter((d) => d && d.id);
  const docsById = {};

  // Start with all local documents (private by default).
  for (const d of allDocs) {
    docsById[d.id] = {
      ...d,
      isLocal: d.source === 'peer' ? false : (d.local !== false)
    };
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

  mergeInventoryDocumentsIntoMap(docsById, collectInventoryDocuments(peersState));

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
      const name = (createDocName || dl.add.defaultName).trim() || dl.add.defaultName;
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
          <Button basic size="small" as={Link} to="/">
            <Icon name="arrow left" aria-hidden="true" />
            {dl.home}
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
              {dl.title}
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
              {dl.countSr(docs.length)}
            </span>
            <Label
              size="small"
              title={dl.countTitle}
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
            <Message.Header>{dl.catalogErrorTitle}</Message.Header>
            <p style={{ margin: '0.35em 0 0', color: '#333' }}>{catalogHttpFallbackError}</p>
            <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', color: '#666' }}>
              {dl.catalogErrorHint}
            </p>
            <details className="hub-developer-details" style={{ marginTop: '0.35em', fontSize: '0.9em' }}>
              <summary>{t.common.developerDetails}</summary>
              {dl.catalogErrorEndpoint} <code style={{ fontSize: '0.85em' }}>/services/rpc</code>
            </details>
          </Message>
        )}

        {!hasEncryptionKey && (() => {
          const identity = props.identity || {};
          const idMode = classifyHubBrowserIdentity(identity);
          const title = idMode === 'watch_only'
            ? dl.identity.titleWatchOnly
            : idMode === 'password_locked'
              ? dl.identity.titleLocked
              : dl.identity.titleNone;
          return (
            <Message info style={{ marginBottom: '1em' }}>
              <Message.Header>{title}</Message.Header>
              <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                {dl.identity.intro} {fabricIdentityNeedFullKeyPlain(identity)}
              </p>
              <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                <Link to="/settings/bitcoin-wallet">{dl.identity.walletLink}</Link> {dl.identity.walletSuffix}
              </p>
              <details className="hub-developer-details" style={{ marginTop: '0.5em', fontSize: '0.9em' }}>
                <summary>{t.common.developerDetails}</summary>
                <p style={{ margin: '0.35em 0 0' }}>
                  {dl.identity.devSeedIntro} <code>window.FABRIC_DEV_BROWSER_SEED</code> {dl.identity.devSeedIn} <code>assets/config.local.js</code>.
                  {' '}{dl.identity.devSeedPassphrase} <code>window.FABRIC_DEV_BROWSER_PASSPHRASE</code>.
                </p>
                <p style={{ margin: '0.35em 0 0' }}>
                  {dl.identity.devSeedPush} <code>FABRIC_DEV_PUSH_BROWSER_IDENTITY=1</code>.
                </p>
                <p style={{ margin: '0.35em 0 0' }}>
                  {dl.identity.devAutomation} <code>npm run test:e2e-document-purchase</code>.
                </p>
              </details>
            </Message>
          );
        })()}

        {hasEncryptionKey && (
          <Segment loading={busy}>
            <Header as="h3">{dl.add.title}</Header>
            <p style={{ color: '#666' }}>
              {dl.add.intro}
              {distributeEnabled ? (
                <>
                  {' '}{dl.add.distributeBefore}{' '}
                  <Link to="/services/bitcoin">{dl.add.distributeLink}</Link>.
                </>
              ) : null}
            </p>
            <details className="hub-developer-details" style={{ marginBottom: '0.75em', fontSize: '0.9em', color: '#666' }}>
              <summary>{t.common.developerDetails}</summary>
              {dl.add.devPricing}
            </details>
            <Button
              size="small"
              basic
              icon
              labelPosition="left"
              onClick={() => setShowCreateDoc((v) => !v)}
              style={{ marginBottom: showCreateDoc ? '1em' : 0 }}
              aria-expanded={showCreateDoc}
            >
              <Icon name={showCreateDoc ? 'minus' : 'plus'} />
              {dl.add.newText}
            </Button>
            {showCreateDoc && (
              <Form style={{ marginTop: '0.75em', maxWidth: 560 }}>
                <Form.Field>
                  <label htmlFor="documents-create-name">{dl.add.nameLabel}</label>
                  <Input
                    id="documents-create-name"
                    placeholder={dl.add.namePlaceholder}
                    value={createDocName}
                    onChange={(e) => setCreateDocName(e.target.value)}
                  />
                </Form.Field>
                <Form.Field>
                  <label htmlFor="documents-create-content">{dl.add.contentLabel}</label>
                  <Form.TextArea
                    id="documents-create-content"
                    placeholder={dl.add.contentPlaceholder}
                    value={createDocContent}
                    onChange={(e) => setCreateDocContent(e.target.value)}
                    rows={6}
                    style={{ fontFamily: 'monospace' }}
                  />
                </Form.Field>
                <Button size="small" primary onClick={onCreateDocument} disabled={!createDocContent.trim()}>
                  <Icon name="save" />
                  {dl.add.create}
                </Button>
                <Button size="small" basic type="button" onClick={() => { setShowCreateDoc(false); setCreateDocName(''); setCreateDocContent(''); }}>
                  {t.common.actions.cancel}
                </Button>
              </Form>
            )}
            <div style={{ marginTop: showCreateDoc ? '1em' : 0 }}>
              <label htmlFor="documents-add-file" style={{ display: 'block', marginBottom: '0.5em', color: '#666' }}>{dl.add.fileLabel}</label>
              <Input
                id="documents-add-file"
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
                <Message.Header>{dl.add.errorTitle}</Message.Header>
                <p style={{ margin: '0.35em 0 0' }}>{error}</p>
              </Message>
            )}
          </Segment>
        )}

        {distributeEnabled ? (
          <Segment>
            <DistributeProposalsList bridgeRef={props.bridgeRef} embedded />
          </Segment>
        ) : null}

        <Segment>
          <Header as="h3" id="documents-catalog-heading" style={{ marginBottom: '0.25em' }}>{dl.catalog.title}</Header>
          <p style={{ color: '#666', marginTop: 0 }}>{dl.catalog.summary}</p>
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
            {t.common.actions.refresh}
          </Button>
          {(documentMarketAccumulate || inventoryCatalog || meshAvailable) && (
            <Button
              type="button"
              size="small"
              icon
              labelPosition="left"
              basic
              onClick={() => {
                const bridge = props.bridgeRef && props.bridgeRef.current;
                if (bridge && typeof bridge.sendRefreshDocumentMarketRequest === 'function') {
                  bridge.sendRefreshDocumentMarketRequest();
                }
                if (bridge && typeof bridge.requestConnectedPeerInventories === 'function') {
                  bridge.requestConnectedPeerInventories();
                }
              }}
              disabled={busy}
              title={dl.catalog.askPeersTitle}
            >
              <Icon name="exchange" />
              {dl.catalog.askPeers}
            </Button>
          )}
          {inventoryCatalog && (
            <Message info size="small" style={{ marginTop: '1em' }} data-testid="hub-inventory-catalog">
              <Message.Header>{dl.catalog.peerFilesTitle}</Message.Header>
              <p style={{ margin: '0.35em 0 0' }}>
                {dl.catalog.peerFilesBody}
              </p>
            </Message>
          )}
          {documentMarketAccumulate && (
            <Message info size="small" style={{ marginTop: '1em' }}>
              <Message.Header>{dl.catalog.marketTitle}</Message.Header>
              <p style={{ margin: '0.35em 0 0' }}>
                {dl.catalog.market({
                  resell: !!documentMarket.republishWithMarkup,
                  markupPercent: Number(documentMarket.markupBps) / 100,
                  markupSats: Number(documentMarket.markupSats) || 0,
                  offerCount: documentMarket.offerCount != null ? Number(documentMarket.offerCount) : null
                })}
              </p>
            </Message>
          )}
          {(!hasNetworkSnapshot && !inventoryCatalog && allDocs.length === 0 && docs.length === 0) ? (
            <Segment
              placeholder
              style={{ marginTop: '1em', minHeight: '20vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <div>
                <Loader active inline="centered" />
                <Header as="h4" style={{ marginTop: '1em', textAlign: 'center' }}>
                  {dl.loadingTitle}
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
                      title={lb.publishedTitle}
                    >
                      <Icon name="bullhorn" />
                      {lb.published}
                    </Label>
                  );
                } else if (doc.isLocal) {
                  labels.push(
                    <Label
                      key="local"
                      size="mini"
                      color="grey"
                      style={{ marginLeft: '0.5em' }}
                      title={lb.privateTitle}
                    >
                      <Icon name="lock" />
                      {lb.private}
                    </Label>
                  );
                } else if (doc.isInventory) {
                  labels.push(
                    <Label
                      key="inventory"
                      size="mini"
                      color="teal"
                      style={{ marginLeft: '0.5em' }}
                      title={lb.peerFileTitle}
                    >
                      <Icon name="exchange" />
                      {lb.peerFile}
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
                      title={lb.encryptedTitle}
                    >
                      <Icon name="shield" />
                      {lb.encrypted}
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
                      title={lb.bitcoinBlockTitle}
                    >
                      <Icon name="cube" />
                      {lb.bitcoinBlock}
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
                      title={lb.bitcoinTxTitle}
                    >
                      <Icon name="exchange" />
                      {lb.bitcoinTx}
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
                      title={lb.storageTitle}
                    >
                      <Icon name="cloud" />
                      {lb.storage}
                    </Label>
                  );
                }

                if (doc.storageContractId && doc.storageL1Status && typeof doc.storageL1Status === 'object') {
                  const st = doc.storageL1Status;
                  const conf = st.confirmations != null ? Number(st.confirmations) : null;
                  let payColor = 'grey';
                  let payText = '';
                  let payTitle = lb.storagePaymentTitle;
                  if (conf != null && !Number.isNaN(conf) && conf > 0) {
                    payColor = 'green';
                    payText = lb.confirmations(conf);
                  } else if (st.inMempool || conf === 0) {
                    payColor = 'yellow';
                    payText = lb.unconfirmed;
                    payTitle = lb.unconfirmedTitle;
                  } else {
                    payText = lb.paymentUnknown;
                    payTitle = lb.paymentUnknownTitle;
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

                if (doc.source === 'peer' && !doc.isPublished && !doc.isLocal) {
                  labels.push(
                    <Label
                      key="peer-offer"
                      size="mini"
                      color="teal"
                      style={{ marginLeft: '0.25em' }}
                      title={lb.peerOfferTitle}
                    >
                      <Icon name="share alternate" />
                      {lb.peerOffer}
                    </Label>
                  );
                }

                if (doc.bestPeerPriceSats != null && Number(doc.bestPeerPriceSats) >= 0 && doc.source !== 'peer') {
                  labels.push(
                    <Label
                      key="peer-price"
                      size="mini"
                      basic
                      style={{ marginLeft: '0.25em' }}
                      title={lb.peerPriceTitle}
                    >
                      <Icon name="exchange" />
                      {lb.peerPrice(t.common.sats(doc.bestPeerPriceSats))}
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
                      title={lb.priceTitle}
                    >
                      <Icon name="bitcoin" />
                      {t.common.sats(doc.purchasePriceSats)}
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
                        {doc.mime || 'application/octet-stream'}
                        {doc.size != null ? ` · ${rw.sizeBytes(doc.size)}` : ''}
                        {doc.created ? ` · ${new Date(doc.created).toLocaleString()}` : ''}
                        {(doc.lineage || doc.id) && (
                          <span title={rw.authorTitle}>
                            {' · '}{rw.author} <code style={{ fontSize: '0.92em' }}>{shortHexId(doc.lineage || doc.id)}</code>
                          </span>
                        )}
                        {doc.isPublished && fabricPeerId && (
                          <span title={rw.publisherTitle}>
                            {' · '}{rw.publisher} <code style={{ fontSize: '0.92em' }}>{shortHexId(fabricPeerId)}</code>
                          </span>
                        )}
                        {!doc.storageContractId && doc.isPublished && (
                          <span title={rw.notReplicatedTitle}>{' · '}{rw.notReplicated}</span>
                        )}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                );
              })}
              {docs.length === 0 && (
                <List.Item>
                  <List.Content>
                    <List.Description style={{ color: '#666' }}>{dl.catalog.empty}</List.Description>
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
                  {dl.catalog.showing(docsRangeFrom, docsRangeTo, docsListTotal)}
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
