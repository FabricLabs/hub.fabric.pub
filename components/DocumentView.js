'use strict';

// Dependencies
const React = require('react');
const { Link, useParams, useLocation, useNavigate } = require('react-router-dom');

// Semantic UI
const {
  Button,
  Card,
  Divider,
  Header,
  Icon,
  Label,
  List,
  Loader,
  Message,
  Modal,
  Input,
  Segment,
  Form,
  Dropdown
} = require('semantic-ui-react');
const Invoice = require('./Invoice');
const GraphDocumentPreview = require('./GraphDocumentPreview');
const { formatSatsDisplay } = require('../functions/formatSats');
const { loadUpstreamSettings, fetchTransactionByHash, sendBridgePayment } = require('../functions/bitcoinClient');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const { hydrateHubNetworkStatusViaHttp } = require('../functions/hydrateHubNetworkStatusViaHttp');
const {
  classifyHubBrowserIdentity,
  fabricIdentityNeedFullKeyPlain
} = require('../functions/hubIdentityUiHints');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');

const DEFAULT_PUBLISH_PRICE_SATS = '25';
const TXID_HEX_64 = /^[a-fA-F0-9]{64}$/;

function shortHexId (value) {
  const s = String(value || '');
  if (!s) return '—';
  if (s.length <= 20) return s;
  return `${s.slice(0, 10)}…${s.slice(-8)}`;
}

/** Resolve a document from Bridge `globalState.documents` by route id or content hash (case-insensitive hex). */
function pickDocumentFromMap (documents, rawId) {
  if (!documents || rawId == null || rawId === '') return null;
  const id = String(rawId).trim();
  if (!id) return null;
  if (documents[id]) return documents[id];
  const lower = id.toLowerCase();
  if (documents[lower]) return documents[lower];
  for (const d of Object.values(documents)) {
    if (!d || typeof d !== 'object') continue;
    const did = d.id != null ? String(d.id) : '';
    const sha = d.sha256 != null ? String(d.sha256) : (d.sha != null ? String(d.sha) : '');
    if (did === id || sha === id) return d;
    if (did.toLowerCase() === lower || sha.toLowerCase() === lower) return d;
  }
  return null;
}

/** Fabric TCP peers from GetNetworkStatus (excludes bridge/WebRTC signaling rows). */
function fabricTcpPeersFromNetworkStatus (ns) {
  const peers = Array.isArray(ns && ns.peers) ? ns.peers : [];
  return peers.filter((p) => {
    if (!p || typeof p !== 'object') return false;
    const pid = String(p.id || '');
    const address = String(p.address || '');
    const hasWebRTCMetadata = !!(p.metadata && Array.isArray(p.metadata.capabilities));
    if (pid.startsWith('fabric-bridge-') || address.startsWith('fabric-bridge-')) return false;
    if (hasWebRTCMetadata && p.status === 'registered') return false;
    return true;
  });
}

function getAdminTokenFromProps (props) {
  const t = props && props.adminToken;
  if (t && String(t).trim()) return String(t).trim();
  return readHubAdminTokenFromBrowser();
}

function DocumentDetail (props) {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const encodedParam = params && params.id ? params.id : '';
  const hash = location && location.hash ? location.hash.replace(/^#/, '') : '';
  const rawId = encodedParam || hash;
  const id = rawId ? decodeURIComponent(rawId) : '';

  const [doc, setDoc] = React.useState(null);
  const [decryptedContent, setDecryptedContent] = React.useState(null);
  const [unlocked, setUnlocked] = React.useState(false);
  const [autoTriedDecrypt, setAutoTriedDecrypt] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [isPublishing, setIsPublishing] = React.useState(false);
  const [publishError, setPublishError] = React.useState(null);
  const [distributeOpen, setDistributeOpen] = React.useState(false);
  const [distributeBusy, setDistributeBusy] = React.useState(false);
  const [distributeAmountSats, setDistributeAmountSats] = React.useState('');
  const [distributeDesiredCopies, setDistributeDesiredCopies] = React.useState(1);
  const [distributeDurationYears, setDistributeDurationYears] = React.useState(4);
  const [distributeCadence, setDistributeCadence] = React.useState('daily');
  const [distributeDeadline, setDistributeDeadline] = React.useState('10s');
  const [distributeError, setDistributeError] = React.useState(null);

  const [distributeInvoice, setDistributeInvoice] = React.useState(null);
  const [distributeTxid, setDistributeTxid] = React.useState('');
  const [distributeSuccessContractId, setDistributeSuccessContractId] = React.useState(null);
  const [distributeTxChain, setDistributeTxChain] = React.useState(null);
  const [distributeBridgeBusy, setDistributeBridgeBusy] = React.useState(false);
  const [peerOfferKey, setPeerOfferKey] = React.useState('');
  const [peerOfferBusy, setPeerOfferBusy] = React.useState(false);
  const [peerOfferError, setPeerOfferError] = React.useState(null);
  const [peerOfferSuccess, setPeerOfferSuccess] = React.useState(null);
  const [peerListTick, setPeerListTick] = React.useState(0);

  const [publishPriceSats, setPublishPriceSats] = React.useState(DEFAULT_PUBLISH_PRICE_SATS);
  const [purchaseOpen, setPurchaseOpen] = React.useState(false);
  const [purchaseInvoice, setPurchaseInvoice] = React.useState(null);
  const [purchaseTxid, setPurchaseTxid] = React.useState('');
  const [purchaseBusy, setPurchaseBusy] = React.useState(false);
  const [purchaseBridgeBusy, setPurchaseBridgeBusy] = React.useState(false);
  const [purchaseError, setPurchaseError] = React.useState(null);
  const [purchasedContent, setPurchasedContent] = React.useState(null);
  const [contractPayTx, setContractPayTx] = React.useState(null);

  const [htlcPreimageHex, setHtlcPreimageHex] = React.useState('');
  const [htlcUnlockBusy, setHtlcUnlockBusy] = React.useState(false);
  const [htlcUnlockError, setHtlcUnlockError] = React.useState(null);
  const [tombstoneOpen, setTombstoneOpen] = React.useState(false);
  const [tombstoneBusy, setTombstoneBusy] = React.useState(false);
  const [tombstoneError, setTombstoneError] = React.useState(null);
  const [loadError, setLoadError] = React.useState(null);
  const [hubUiTick, setHubUiTick] = React.useState(0);
  const [upstreamRev, setUpstreamRev] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((t) => t + 1)), []);
  void hubUiTick;
  const uf = loadHubUiFeatureFlags();

  const upstreamSettings = React.useMemo(() => loadUpstreamSettings(), [upstreamRev]);

  React.useEffect(() => {
    const bump = () => setUpstreamRev((n) => n + 1);
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('fabricBitcoinUpstreamChanged', bump);
    const onStorage = (ev) => {
      if (ev && ev.key === 'fabric.bitcoin.upstream') bump();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('fabricBitcoinUpstreamChanged', bump);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  React.useEffect(() => {
    setLoadError(null);
  }, [id]);

  React.useEffect(() => {
    if (!id || typeof props.onGetDocument !== 'function') return undefined;
    // Defer until after other DocumentView effects (e.g. globalStateUpdate listener) have run.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) props.onGetDocument(id);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // If WebSocket GetDocument never merges into Bridge state, fall back to same-origin HTTP JSON-RPC (read-only).
  React.useEffect(() => {
    if (!id || doc) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const bridge = props.bridgeRef && props.bridgeRef.current;
      const gs = bridge && typeof bridge.getGlobalState === 'function' ? bridge.getGlobalState() : null;
      if (pickDocumentFromMap(gs && gs.documents, id)) return;
      const origin = typeof window !== 'undefined' && window.location && window.location.origin
        ? window.location.origin
        : '';
      if (!origin || !bridge || typeof bridge.mergeGetDocumentRpcResult !== 'function') return;
      fetch(`${origin}/services/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'GetDocument',
          params: [id]
        })
      })
        .then(async (r) => {
          let body = null;
          try {
            body = await r.json();
          } catch (_) {
            body = null;
          }
          return { ok: r.ok, status: r.status, body };
        })
        .then(({ ok, status, body }) => {
          if (cancelled) return;
          const fail = (message) => {
            if (typeof window === 'undefined') return;
            window.dispatchEvent(new CustomEvent('documentLoadFailed', {
              detail: { documentId: String(id), message }
            }));
          };
          if (!body || typeof body !== 'object') {
            if (!ok) fail(`Could not load document (HTTP ${status || 'error'}).`);
            return;
          }
          if (body.error) {
            const err = body.error;
            const msg = err && (err.message != null || err.data != null)
              ? String(err.message != null ? err.message : err.data)
              : 'Hub refused the document request.';
            fail(msg);
            return;
          }
          if (body.result == null) {
            if (!ok) fail(`Could not load document (HTTP ${status || 'error'}).`);
            return;
          }
          const applied = bridge.mergeGetDocumentRpcResult(body.result);
          if (!applied && body.result && body.result.type === 'GetDocumentResult') {
            fail(
              (body.result.message && String(body.result.message)) || 'Document could not be loaded from the hub.'
            );
          }
        })
        .catch((err) => {
          if (cancelled) return;
          if (typeof window === 'undefined') return;
          window.dispatchEvent(new CustomEvent('documentLoadFailed', {
            detail: {
              documentId: String(id),
              message: (err && err.message) ? err.message : 'Network error while loading document from hub.'
            }
          }));
        });
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, doc, props.bridgeRef]);

  React.useEffect(() => {
    const handler = (e) => {
      const d = e && e.detail;
      if (!d || d.documentId == null) return;
      const docId = String(d.documentId);
      const match = docId === String(id) || (doc && (doc.sha256 === docId || doc.sha === docId));
      if (!match) return;
      setLoadError(d.message || 'Document not found.');
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('documentLoadFailed', handler);
      return () => window.removeEventListener('documentLoadFailed', handler);
    }
    return undefined;
  }, [id, doc]);

  React.useEffect(() => {
    if (!id || doc) return undefined;
    const t = setTimeout(() => {
      setLoadError((prev) => prev || 'No response from hub while loading this document. Check your connection or try Refresh.');
    }, 22000);
    return () => clearTimeout(t);
  }, [id, doc]);

  React.useEffect(() => {
    setPublishPriceSats(DEFAULT_PUBLISH_PRICE_SATS);
    setPublishError(null);
  }, [id]);

  React.useEffect(() => {
    setPeerOfferKey('');
    setPeerOfferBusy(false);
    setPeerOfferError(null);
    setPeerOfferSuccess(null);
  }, [id]);

  React.useEffect(() => {
    setHtlcPreimageHex('');
    setHtlcUnlockError(null);
    setHtlcUnlockBusy(false);
  }, [id, doc?.htlcPendingDecrypt]);

  // Listen for pay-to-distribute invoice; show payment step when it matches this document
  React.useEffect(() => {
    const handler = (e) => {
      const detail = e && e.detail;
      if (!detail || !detail.documentId) return;
      const docId = detail.documentId;
      const match = docId === id || (doc && (doc.sha256 === docId || doc.sha === docId));
      if (match) {
        setDistributeInvoice({
          address: detail.address,
          amountSats: detail.amountSats,
          config: detail.config,
          network: detail.network
        });
        setDistributeTxid('');
        setDistributeBusy(false);
        setDistributeError(null);
      }
    };
    window.addEventListener('distributeInvoiceReady', handler);
    return () => window.removeEventListener('distributeInvoiceReady', handler);
  }, [id, doc]);

  React.useEffect(() => {
    const handler = (e) => {
      const detail = e && e.detail;
      if (!detail || !detail.documentId) return;
      const docId = detail.documentId;
      const match = docId === id || (doc && (doc.sha256 === docId || doc.sha === docId));
      if (!match) return;
      setDistributeBusy(false);
      setDistributeInvoice(null);
      setDistributeError(String(detail.message || 'Could not create distribute invoice'));
    };
    window.addEventListener('distributeInvoiceFailed', handler);
    return () => window.removeEventListener('distributeInvoiceFailed', handler);
  }, [id, doc]);

  // If CreateDistributeInvoice never returns over WebSocket, retry via same-origin HTTP JSON-RPC.
  React.useEffect(() => {
    if (!distributeOpen || distributeInvoice || distributeSuccessContractId || !distributeBusy) return undefined;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      const bridge = props.bridgeRef && props.bridgeRef.current;
      const backendId = (doc && doc.sha256) ? String(doc.sha256) : String(id);
      if (!bridge || typeof bridge.mergeCreateDistributeInvoiceRpcResult !== 'function' || !backendId) return;
      const amount = parseInt(distributeAmountSats, 10);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const origin = typeof window !== 'undefined' && window.location && window.location.origin
        ? window.location.origin
        : '';
      if (!origin) return;
      const config = {
        documentId: backendId,
        amountSats: amount,
        desiredCopies: Math.max(1, parseInt(distributeDesiredCopies, 10) || 1),
        durationYears: distributeDurationYears,
        challengeCadence: distributeCadence,
        responseDeadline: distributeDeadline
      };
      fetch(`${origin}/services/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'CreateDistributeInvoice',
          params: [config]
        })
      })
        .then((r) => r.json())
        .then((body) => {
          if (cancelled || !body || body.result == null) return;
          bridge.mergeCreateDistributeInvoiceRpcResult(body.result);
        })
        .catch(() => {});
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    distributeOpen,
    distributeInvoice,
    distributeSuccessContractId,
    distributeBusy,
    id,
    doc,
    distributeAmountSats,
    distributeDesiredCopies,
    distributeDurationYears,
    distributeCadence,
    distributeDeadline,
    props.bridgeRef
  ]);

  // Waiting for CreateDistributeInvoice (step 1) — avoid stuck loading if the hub never answers
  React.useEffect(() => {
    if (!distributeOpen || distributeInvoice || distributeSuccessContractId || !distributeBusy) return undefined;
    const t = setTimeout(() => {
      setDistributeBusy(false);
      setDistributeError((prev) => prev || 'Timed out waiting for a distribute invoice from the hub. Check Bitcoin and try Request invoice again.');
    }, 45000);
    return () => clearTimeout(t);
  }, [distributeOpen, distributeInvoice, distributeSuccessContractId, distributeBusy]);

  // When payment is bonded (contract created), show success in the distribute modal
  React.useEffect(() => {
    const handler = (e) => {
      const detail = e && e.detail;
      if (!detail || !detail.contractId || !detail.documentId) return;
      const docId = detail.documentId;
      const match = docId === id || (doc && (doc.sha256 === docId || doc.sha === docId));
      if (match && distributeOpen) {
        setDistributeSuccessContractId(detail.contractId);
        setDistributeBusy(false);
      }
    };
    window.addEventListener('storageContractBonded', handler);
    return () => window.removeEventListener('storageContractBonded', handler);
  }, [id, doc, distributeOpen]);

  React.useEffect(() => {
    const handler = (e) => {
      const detail = e && e.detail;
      if (!detail || !detail.documentId) return;
      const docId = detail.documentId;
      const match = docId === id || (doc && (doc.sha256 === docId || doc.sha === docId));
      if (!match || !distributeOpen) return;
      setDistributeBusy(false);
      setDistributeError(detail.message || 'Create storage contract failed.');
    };
    window.addEventListener('storageContractBondFailed', handler);
    return () => window.removeEventListener('storageContractBondFailed', handler);
  }, [id, doc, distributeOpen]);

  // Timeout fallback if storageContractBonded never arrives
  React.useEffect(() => {
    if (!distributeBusy || distributeSuccessContractId) return;
    const timeout = setTimeout(() => {
      setDistributeBusy(false);
      setDistributeError('Contract creation is taking longer than expected. Check the contract list or try again.');
    }, 15000);
    return () => clearTimeout(timeout);
  }, [distributeBusy, distributeSuccessContractId]);

  React.useEffect(() => {
    const bump = () => setPeerListTick((t) => t + 1);
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('networkStatusUpdate', bump);
    window.addEventListener('globalStateUpdate', bump);
    return () => {
      window.removeEventListener('networkStatusUpdate', bump);
      window.removeEventListener('globalStateUpdate', bump);
    };
  }, []);

  React.useEffect(() => {
    const handler = (e) => {
      const d = e && e.detail;
      if (!d || d.documentId == null) return;
      const docId = String(d.documentId);
      const match = docId === String(id) || (doc && (doc.sha256 === docId || doc.sha === docId));
      if (!match) return;
      setPeerOfferBusy(false);
      setPeerOfferError(null);
      const pid = d.proposalId ? String(d.proposalId) : '';
      setPeerOfferSuccess(
        pid
          ? `Hosting offer sent (${shortHexId(pid)}). When the peer accepts, pay their invoice to bond storage.`
          : 'Hosting offer sent. When the peer accepts, pay their invoice to bond storage.'
      );
    };
    window.addEventListener('distributeProposalSent', handler);
    return () => window.removeEventListener('distributeProposalSent', handler);
  }, [id, doc]);

  React.useEffect(() => {
    const handler = (e) => {
      const d = e && e.detail;
      if (!d || d.documentId == null) return;
      const docId = String(d.documentId);
      const match = docId === String(id) || (doc && (doc.sha256 === docId || doc.sha === docId));
      if (!match) return;
      setPeerOfferBusy(false);
      setPeerOfferSuccess(null);
      setPeerOfferError(String(d.message || 'Could not send hosting offer'));
    };
    window.addEventListener('distributeProposalFailed', handler);
    return () => window.removeEventListener('distributeProposalFailed', handler);
  }, [id, doc]);

  React.useEffect(() => {
    if (!peerOfferBusy) return undefined;
    const t = setTimeout(() => {
      setPeerOfferBusy(false);
      setPeerOfferError((prev) => prev || 'Timed out waiting for a response from the hub.');
    }, 45000);
    return () => clearTimeout(t);
  }, [peerOfferBusy]);

  // Listen for HTLC purchase invoice
  React.useEffect(() => {
    const handler = (e) => {
      const detail = e && e.detail;
      if (!detail || !detail.documentId) return;
      const docId = detail.documentId;
      const match = docId === id || (doc && (doc.sha256 === docId || doc.sha === docId));
      if (match && purchaseOpen) {
        setPurchaseInvoice({
          address: detail.address,
          amountSats: detail.amountSats,
          contentHash: detail.contentHash,
          network: detail.network
        });
        setPurchaseTxid('');
        setPurchaseError(null);
      }
    };
    window.addEventListener('purchaseInvoiceReady', handler);
    return () => window.removeEventListener('purchaseInvoiceReady', handler);
  }, [id, doc, purchaseOpen]);

  React.useEffect(() => {
    const handler = (e) => {
      const detail = e && e.detail;
      if (!detail || !detail.documentId) return;
      const docId = detail.documentId;
      const match = docId === id || (doc && (doc.sha256 === docId || doc.sha === docId));
      if (match && purchaseOpen) {
        setPurchaseInvoice(null);
        setPurchaseError(String(detail.message || 'Could not create purchase invoice'));
      }
    };
    window.addEventListener('purchaseInvoiceFailed', handler);
    return () => window.removeEventListener('purchaseInvoiceFailed', handler);
  }, [id, doc, purchaseOpen]);

  // If the hub never answers, avoid an infinite "Requesting invoice…" state.
  React.useEffect(() => {
    if (!purchaseOpen || purchaseInvoice || purchasedContent) return undefined;
    const t = setTimeout(() => {
      setPurchaseError((prev) => prev || 'Timed out waiting for a purchase invoice from the hub. Check Bitcoin, publish status, and list price, then close and try Purchase again.');
    }, 45000);
    return () => clearTimeout(t);
  }, [purchaseOpen, purchaseInvoice, purchasedContent]);

  React.useEffect(() => {
    const handler = (event) => {
      const gs = event && event.detail && event.detail.globalState;
      if (!gs || !gs.documents) return;
      const candidate = pickDocumentFromMap(gs.documents, id);
      if (candidate) {
        setLoadError(null);
        setDoc(candidate);
        setDecryptedContent(null);
        setUnlocked(false);
        if (candidate.published) {
          setIsPublishing(false);
        }
      }
    };
    window.addEventListener('globalStateUpdate', handler);
    return () => window.removeEventListener('globalStateUpdate', handler);
  }, [id]);

  // On mount, hydrate from existing Bridge globalState so locally-added documents
  // are immediately visible without waiting for another event.
  React.useEffect(() => {
    try {
      const bridgeRef = props.bridgeRef;
      const current = bridgeRef && bridgeRef.current;
      if (!current || typeof current.getGlobalState !== 'function') return;
      const gs = current.getGlobalState();
      if (!gs || !gs.documents) return;
      const candidate = pickDocumentFromMap(gs.documents, id);
      if (candidate) {
        setLoadError(null);
        setDoc(candidate);
        setDecryptedContent(null);
        setUnlocked(false);
      }
    } catch (e) {}
  }, [id, props.bridgeRef]);

  // Stop "publishing…" state once the document has a published timestamp,
  // or after a safety timeout if the hub reports an error.
  React.useEffect(() => {
    const bridge = props.bridgeRef && props.bridgeRef.current;
    const publishedDocs = bridge && (bridge.networkStatus?.publishedDocuments || bridge.lastNetworkStatus?.publishedDocuments);
    const pub = !!(doc && (doc.published || (publishedDocs && (publishedDocs[doc.id] || (doc.sha256 && publishedDocs[doc.sha256])))));
    if (doc && pub) {
      setIsPublishing(false);
      setPublishError(null);
      return;
    }
    if (!isPublishing) return;
    const timeout = setTimeout(() => {
      setIsPublishing(false);
      setPublishError((prev) => prev || 'No publish confirmation from the hub yet. Check your connection or try again.');
    }, 10000);
    return () => clearTimeout(timeout);
  }, [doc, doc?.published, doc?.id, doc?.sha256, isPublishing, props.bridgeRef, peerListTick]);

  // If the WebSocket drops the publish result, resync catalog + document row over HTTP (same-origin RPC).
  React.useEffect(() => {
    if (!isPublishing || !doc) return undefined;
    const backendId = String(doc.sha256 || doc.id || id || '').trim();
    if (!backendId) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const bridge = props.bridgeRef && props.bridgeRef.current;
      const origin = typeof window !== 'undefined' && window.location && window.location.origin
        ? window.location.origin
        : '';
      if (!bridge || !origin) return;
      (async () => {
        try {
          await hydrateHubNetworkStatusViaHttp(bridge, origin);
        } catch (_) {}
        if (cancelled) return;
        try {
          const r = await fetch(`${origin}/services/rpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: Date.now(),
              method: 'GetDocument',
              params: [backendId]
            })
          });
          const body = await r.json().catch(() => null);
          if (cancelled || !body || body.result == null || typeof bridge.mergeGetDocumentRpcResult !== 'function') return;
          bridge.mergeGetDocumentRpcResult(body.result);
        } catch (_) {}
      })();
    }, 3500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isPublishing, doc, id, props.bridgeRef]);

  React.useEffect(() => {
    const handler = (e) => {
      const d = e && e.detail;
      if (!d || d.documentId == null || String(d.documentId) === '') return;
      const docId = String(d.documentId);
      const match = docId === id || (doc && (doc.sha256 === docId || doc.sha === docId));
      if (!match) return;
      setIsPublishing(false);
      setPublishError(String(d.message || 'Publish failed'));
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('publishDocumentFailed', handler);
      return () => window.removeEventListener('publishDocumentFailed', handler);
    }
    return undefined;
  }, [id, doc]);

  // Decrypt only when user clicks Unlock (for encrypted docs)
  const handleUnlock = React.useCallback(() => {
    if (!doc || decryptedContent !== null) return;
    if (!props.hasDocumentKey) {
      if (typeof props.onRequestUnlock === 'function') {
        props.onRequestUnlock();
      }
      return;
    }
    const raw = doc.contentBase64 || (typeof props.onGetDecryptedContent === 'function' && props.onGetDecryptedContent(id));
    if (raw) setDecryptedContent(raw);
    setUnlocked(true);
  }, [doc, id, decryptedContent, props.hasDocumentKey, props.onGetDecryptedContent, props.onRequestUnlock]);

  const handleHtlcPreimageUnlock = React.useCallback(async () => {
    if (!doc || !doc.htlcPendingDecrypt || typeof props.onUnlockHtlcDocument !== 'function') return;
    setHtlcUnlockBusy(true);
    setHtlcUnlockError(null);
    try {
      const r = await props.onUnlockHtlcDocument(id, htlcPreimageHex.trim());
      if (!r || !r.ok) {
        setHtlcUnlockError((r && r.error) || 'Unlock failed.');
      } else {
        setHtlcPreimageHex('');
        setUnlocked(false);
        setDecryptedContent(null);
      }
    } catch (e) {
      setHtlcUnlockError((e && e.message) || 'Unlock failed.');
    } finally {
      setHtlcUnlockBusy(false);
    }
  }, [doc, id, htlcPreimageHex, props.onUnlockHtlcDocument]);

  const isEncrypted = !!(doc && doc.contentEncrypted);
  const isHtlcPendingDecrypt = !!(doc && doc.htlcPendingDecrypt);
  const name = (doc && doc.name) || id;
  const mime = (doc && doc.mime) || 'application/octet-stream';
  const created = doc && doc.created ? new Date(doc.created).toLocaleString() : '';
  // Published state: prefer hub global store (publishedDocuments) over doc.published
  const publishedDocs = props.bridgeRef?.current?.networkStatus?.publishedDocuments || props.bridgeRef?.current?.lastNetworkStatus?.publishedDocuments;
  const isPublishedInStore = !!(doc && (doc.published || (publishedDocs && (publishedDocs[id] || (doc.sha256 && publishedDocs[doc.sha256])))));
  const publishedTs = doc?.published || (publishedDocs && (publishedDocs[id] || (doc?.sha256 && publishedDocs[doc.sha256]))?.published);
  const publishedAt = publishedTs ? new Date(publishedTs).toLocaleString() : '';
  const storageContractId = doc && doc.storageContractId;
  const docPurchasePriceSats = doc && doc.purchasePriceSats;
  const canPurchase = !!(doc && isPublishedInStore && docPurchasePriceSats && docPurchasePriceSats > 0);
  /** Encrypted body (not HTLC preimage flow) requires an unlocked identity key to publish or decrypt. */
  const needsIdentityKeyForEncryptedBody = !!(doc && isEncrypted && !isHtlcPendingDecrypt && !props.hasDocumentKey);
  const fabricPeerId = props.bridgeRef?.current?.networkStatus?.fabricPeerId
    || props.bridgeRef?.current?.lastNetworkStatus?.fabricPeerId
    || null;
  const bridgeForWire = props.bridgeRef && props.bridgeRef.current;
  const distributeModalNoLocalWire = !!(bridgeForWire && typeof bridgeForWire.hasLocalWireSigningKey === 'function' && !bridgeForWire.hasLocalWireSigningKey());
  /** Publish / pay-to-distribute require an unlocked Fabric identity so JSON-RPC is Schnorr-signed and local bytes are available. */
  const needsIdentityUnlock = !props.hasDocumentKey;
  const authorDocId = doc && (doc.lineage || doc.id) ? String(doc.lineage || doc.id) : '';

  const fabricPeersForOffer = React.useMemo(() => {
    const cur = props.bridgeRef && props.bridgeRef.current;
    const ns = cur && (cur.networkStatus || cur.lastNetworkStatus);
    return fabricTcpPeersFromNetworkStatus(ns);
  }, [props.bridgeRef, peerListTick]);

  const fabricPeerDropdownOptions = React.useMemo(() => {
    return fabricPeersForOffer.map((p) => {
      const addr = String(p.address || '').trim();
      const pid = String(p.id || '').trim();
      const value = pid || addr;
      const text = (addr && pid && addr !== pid)
        ? `${addr} (${shortHexId(pid)})`
        : (addr || shortHexId(pid) || value);
      return { key: value, text, value };
    }).filter((o) => o.value);
  }, [fabricPeersForOffer]);

  const adminTokenResolved = String(
    readHubAdminTokenFromBrowser(props.adminToken)
  ).trim();
  const canAdminUnpublish = !!(adminTokenResolved && doc && isPublishedInStore && id);

  const handleConfirmTombstone = React.useCallback(async () => {
    if (!id) return;
    const token = String(
      readHubAdminTokenFromBrowser(props.adminToken)
    ).trim();
    if (!token) {
      setTombstoneError('Admin token required.');
      return;
    }
    const bridge = props.bridgeRef && props.bridgeRef.current;
    if (!bridge || typeof bridge.emitTombstone !== 'function') {
      setTombstoneError('Bridge is not ready.');
      return;
    }
    // Hub published catalog keys documents by content hash; URL may use lineage / actor id.
    const canonicalDocId = (doc && doc.sha256) ? String(doc.sha256).trim() : String(id).trim();
    setTombstoneBusy(true);
    setTombstoneError(null);
    try {
      const r = await bridge.emitTombstone({ documentId: canonicalDocId, adminToken: token });
      if (!r || !r.ok) {
        setTombstoneError((r && r.message) ? r.message : 'Unpublish failed. Check admin token and that the document is still in the hub published catalog.');
        return;
      }
      setTombstoneOpen(false);
      const refresh = () => {
        if (bridge && typeof bridge.sendNetworkStatusRequest === 'function') {
          bridge.sendNetworkStatusRequest();
        }
        if (typeof props.onGetDocument === 'function') props.onGetDocument(id);
      };
      setTimeout(refresh, 400);
    } catch (e) {
      setTombstoneError((e && e.message) ? e.message : 'Unpublish failed.');
    } finally {
      setTombstoneBusy(false);
    }
  }, [id, props.adminToken, props.bridgeRef, props.onGetDocument]);

  // Never expose decrypted content when we don't currently have a document key,
  // even if contentBase64 is still present on the doc from a prior unlock.
  const rawContentBase64 = doc && (doc.contentBase64 || decryptedContent);
  const contentBase64 = props.hasDocumentKey ? rawContentBase64 : null;
  let downloadHref = null;
  if (contentBase64) {
    downloadHref = `data:${mime};base64,${contentBase64}`;
  }

  // Basic type helpers
  const looksText = (mime && mime.startsWith('text/')) || /\.(md|txt|json|js|ts|html|css|log|dot|gv)$/i.test(name || '');
  const looksImage = (mime && mime.startsWith('image/')) || /\.(png|jpe?g|gif|webp|svg)$/i.test(name || '');

  // Text preview (only when it looks like text)
  let text = null;
  if (contentBase64 && looksText && props.hasDocumentKey) {
    try {
      text = atob(contentBase64);
    } catch (e) {}
  }

  const showGraphPreview = !!(text != null && props.hasDocumentKey &&
    typeof GraphDocumentPreview.looksLikeDotSource === 'function' &&
    GraphDocumentPreview.looksLikeDotSource(text, mime, name));

  // Image preview (data URL)
  const imageSrc = (contentBase64 && looksImage) ? `data:${mime};base64,${contentBase64}` : null;

  // If the application is already unlocked and Bridge can decrypt, try once automatically so
  // the user doesn't have to click "Unlock" again just to view a document.
  React.useEffect(() => {
    if (!doc) return;
    if (!isEncrypted) return;
    if (contentBase64) return; // already have cleartext
    if (decryptedContent !== null) return;
    if (autoTriedDecrypt) return;
    if (typeof props.onGetDecryptedContent !== 'function') return;

    setAutoTriedDecrypt(true);
    try {
      const raw = props.onGetDecryptedContent(id);
      if (raw) {
        setDecryptedContent(raw);
        setUnlocked(true);
      }
    } catch (e) {}
  }, [doc, id, isEncrypted, contentBase64, decryptedContent, autoTriedDecrypt, props.onGetDecryptedContent]);

  // When document key becomes unavailable (identity locked), drop any decrypted
  // content held in component state so the UI reflects the locked status.
  React.useEffect(() => {
    if (!props.hasDocumentKey) {
      setDecryptedContent(null);
      setAutoTriedDecrypt(false);
    }
  }, [props.hasDocumentKey]);

  // Storage contract L1 payment: load contract txid and mempool / confirmation depth
  React.useEffect(() => {
    const cid = doc && doc.storageContractId ? String(doc.storageContractId).trim() : '';
    if (!cid) {
      setContractPayTx(null);
      return;
    }
    let cancelled = false;
    setContractPayTx({ loading: true });
    (async () => {
      try {
        const res = await fetch(`/contracts/${encodeURIComponent(cid)}`, { method: 'GET' });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body || body.status === 'error') {
          setContractPayTx({
            loading: false,
            error: (body && body.message) || 'Could not load contract.'
          });
          return;
        }
        const c = body.contract || body.result || body;
        const txid = c && c.txid ? String(c.txid).trim() : '';
        if (!txid) {
          setContractPayTx({ loading: false, txid: null });
          return;
        }
        const data = await fetchTransactionByHash(upstreamSettings, txid);
        if (cancelled) return;
        if (data && data.status === 'error') {
          setContractPayTx({
            loading: false,
            txid,
            error: data.message || 'Could not load transaction.'
          });
          return;
        }
        if (!data || typeof data !== 'object') {
          setContractPayTx({
            loading: false,
            txid,
            error: 'Transaction not found on this hub (or not indexed yet).'
          });
          return;
        }
        setContractPayTx({ loading: false, txid, tx: data });
      } catch (e) {
        if (!cancelled) {
          setContractPayTx({
            loading: false,
            error: e && e.message ? e.message : String(e)
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [doc && doc.storageContractId, upstreamSettings]);

  // Distribute modal: poll funding tx depth while invoice step is open
  React.useEffect(() => {
    if (!distributeOpen || distributeSuccessContractId) {
      setDistributeTxChain(null);
      return;
    }
    const tx = String(distributeTxid || '').trim();
    if (!TXID_HEX_64.test(tx)) {
      setDistributeTxChain(null);
      return;
    }
    if (!distributeInvoice) {
      setDistributeTxChain(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchTransactionByHash(upstreamSettings, tx);
        if (cancelled) return;
        if (data && data.status === 'error') {
          setDistributeTxChain({ loading: false, error: data.message || 'Tx not found' });
          return;
        }
        setDistributeTxChain({ loading: false, tx: data });
      } catch (e) {
        if (!cancelled) {
          setDistributeTxChain({ loading: false, error: e && e.message ? e.message : String(e) });
        }
      }
    };
    setDistributeTxChain({ loading: true });
    tick();
    const iv = setInterval(tick, 12000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [distributeOpen, distributeInvoice, distributeTxid, distributeSuccessContractId, upstreamSettings]);

  // URLs for sharing: canonical (path param) and hash-only (keeps id client-side).
  let shareUrlHash = '';
  let shareUrlCanonical = '';
  if (id && typeof window !== 'undefined' && window.location) {
    const { origin } = window.location;
    shareUrlHash = `${origin}/documents#${encodeURIComponent(id)}`;
    shareUrlCanonical = `${origin}/documents/${encodeURIComponent(id)}`;
  }

  const cadenceOptions = [
    { key: 'hourly', value: 'hourly', text: 'Hourly' },
    { key: 'daily', value: 'daily', text: 'Daily' },
    { key: 'weekly', value: 'weekly', text: 'Weekly' },
    { key: 'monthly', value: 'monthly', text: 'Monthly' }
  ];

  const deadlineOptions = [
    { key: '1s', value: '1s', text: '1 second' },
    { key: '5s', value: '5s', text: '5 seconds' },
    { key: '10s', value: '10s', text: '10 seconds' },
    { key: '30s', value: '30s', text: '30 seconds' },
    { key: '60s', value: '60s', text: '60 seconds' },
    { key: '10m', value: '10m', text: '10 minutes' },
    { key: '60m', value: '60m', text: '60 minutes' }
  ];

  const hubAdminTokenPresent = !!getAdminTokenFromProps(props);

  const handlePayDistributeFromBridge = React.useCallback(async () => {
    if (!distributeInvoice || !id) return;
    if (!props.hasDocumentKey) {
      setDistributeError(
        `${fabricIdentityNeedFullKeyPlain(props.identity || {})} Distribute bonding from this browser needs an unlocked signing session.`
      );
      return;
    }
    const token = getAdminTokenFromProps(props);
    if (!token) {
      setDistributeError('Admin token required to pay from the hub wallet.');
      return;
    }
    const to = String(distributeInvoice.address || '').trim();
    const amountSats = Math.round(Number(distributeInvoice.amountSats));
    if (!to || !Number.isFinite(amountSats) || amountSats <= 0) {
      setDistributeError('Invalid distribute invoice (address or amount).');
      return;
    }
    setDistributeBridgeBusy(true);
    setDistributeError(null);
    try {
      const res = await sendBridgePayment(upstreamSettings, {
        to,
        amountSats,
        memo: `Distribute ${String(id).slice(0, 16)}`
      }, token);
      const txid = res && res.payment && res.payment.txid ? String(res.payment.txid).trim() : '';
      if (!txid) {
        throw new Error((res && res.message) || 'Hub wallet did not return a txid.');
      }
      setDistributeTxid(txid);
      if (typeof props.onDistributeDocument !== 'function') {
        throw new Error('Distribute is not available on this hub.');
      }
      setDistributeBusy(true);
      const config = {
        amountSats: distributeInvoice.amountSats,
        durationYears: distributeInvoice.config?.durationYears || distributeDurationYears,
        challengeCadence: distributeInvoice.config?.challengeCadence || distributeCadence,
        responseDeadline: distributeInvoice.config?.responseDeadline || distributeDeadline,
        txid
      };
      await Promise.resolve(props.onDistributeDocument(id, config));
    } catch (err) {
      setDistributeBusy(false);
      setDistributeError((err && err.message) ? err.message : String(err));
    } finally {
      setDistributeBridgeBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onDistributeDocument identity is stable enough for hub shell
  }, [
    distributeInvoice,
    id,
    distributeDurationYears,
    distributeCadence,
    distributeDeadline,
    props.onDistributeDocument,
    props.adminToken,
    props.hasDocumentKey,
    upstreamSettings
  ]);

  const handlePayPurchaseFromBridge = React.useCallback(async () => {
    if (!purchaseInvoice || !id) return;
    if (!props.hasDocumentKey) {
      setPurchaseError(
        `${fabricIdentityNeedFullKeyPlain(props.identity || {})} Purchase bonding from this browser needs an unlocked signing session.`
      );
      return;
    }
    const token = getAdminTokenFromProps(props);
    if (!token) {
      setPurchaseError('Admin token required to pay from the hub wallet.');
      return;
    }
    const to = String(purchaseInvoice.address || '').trim();
    const amountSats = Math.round(Number(purchaseInvoice.amountSats));
    if (!to || !Number.isFinite(amountSats) || amountSats <= 0) {
      setPurchaseError('Invalid purchase invoice (address or amount).');
      return;
    }
    if (typeof props.onClaimPurchase !== 'function') {
      setPurchaseError('Claim is not available on this hub.');
      return;
    }
    setPurchaseBridgeBusy(true);
    setPurchaseError(null);
    try {
      const res = await sendBridgePayment(upstreamSettings, {
        to,
        amountSats,
        memo: `Purchase ${String(id).slice(0, 16)}`
      }, token);
      const txid = res && res.payment && res.payment.txid ? String(res.payment.txid).trim() : '';
      if (!txid) {
        throw new Error((res && res.message) || 'Hub wallet did not return a txid.');
      }
      setPurchaseTxid(txid);
      setPurchaseBusy(true);
      const out = await Promise.resolve(props.onClaimPurchase(id, txid));
      if (out && out.document) {
        setPurchasedContent(out.document);
      } else {
        setPurchaseError((out && out.error) || 'Claim failed after hub wallet payment.');
      }
    } catch (err) {
      setPurchaseError((err && err.message) ? err.message : String(err));
    } finally {
      setPurchaseBusy(false);
      setPurchaseBridgeBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseInvoice, id, props.onClaimPurchase, props.adminToken, props.hasDocumentKey, upstreamSettings]);

  return (
    <fabric-document-detail class='fade-in'>
      <Segment>
        <div
          style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75em', flexWrap: 'wrap', marginBottom: '0.25em' }}
          role="banner"
        >
          <Button basic size="small" as={Link} to="/documents" aria-label="Back to documents list">
            <Icon name="arrow left" aria-hidden="true" />
            Documents
          </Button>
          <Header
            as="h2"
            style={{ margin: 0, flex: '1 1 10rem', display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}
          >
            <Header.Content style={{ wordBreak: 'break-word' }}>{name}</Header.Content>
            {isEncrypted && (
              <Label size="small" color="green" title="Encrypted with your key">
                <Icon name="lock" aria-hidden="true" />
                Encrypted
              </Label>
            )}
            {doc && isPublishedInStore && (
              <Label size="small" color="blue" title={publishedAt ? `Published: ${publishedAt}` : 'Published'}>
                <Icon name="bullhorn" aria-hidden="true" />
                Published
              </Label>
            )}
            {storageContractId && (
              <Label
                size="small"
                color="purple"
                title="This document has an active storage contract"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  if (storageContractId) {
                    navigate(`/contracts/${encodeURIComponent(storageContractId)}`);
                  }
                }}
              >
                <Icon name="cloud" aria-hidden="true" />
                Distributed
              </Label>
            )}
          </Header>
        </div>

        <Divider />

        {doc && (
          <Message info style={{ marginBottom: '1.25em' }}>
            <Message.Header>Storage &amp; availability</Message.Header>
            <p style={{ marginBottom: '0.75em', color: 'rgba(0,0,0,0.7)' }}>
              How this document exists on your node and on the hub. <strong>Author</strong> is the creator’s document id (lineage);
              <strong> publisher</strong> is the Fabric peer id of the hub that hosts the published listing.
              <strong> Publish</strong> advertises it; <strong> Distribute</strong> pays for multi-node storage contracts; <strong> Purchase</strong> uses L1 HTLC when a price is set.
            </p>
            <List relaxed>
              <List.Item>
                <List.Icon name="hdd" color="grey" verticalAlign="middle" />
                <List.Content>
                  <List.Header>Local copy</List.Header>
                  <List.Description>
                    This browser holds metadata{doc.sha256 ? ` (content hash ${String(doc.sha256).slice(0, 16)}…)` : ''}.
                  </List.Description>
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Icon name="bullhorn" color={isPublishedInStore ? 'blue' : 'grey'} verticalAlign="middle" />
                <List.Content>
                  <List.Header>Published to hub index</List.Header>
                  <List.Description>
                    {isPublishedInStore
                      ? (publishedAt
                        ? `Visible in the network store since ${publishedAt}.${fabricPeerId ? ` Publisher (Fabric peer): ${shortHexId(fabricPeerId)}.` : ''}`
                        : `Listed in the hub published index.${fabricPeerId ? ` Publisher: ${shortHexId(fabricPeerId)}.` : ''}`)
                      : 'Not published — only you see it until you publish.'}
                  </List.Description>
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Icon name="cloud" color={storageContractId ? 'purple' : 'grey'} verticalAlign="middle" />
                <List.Content>
                  <List.Header>Network storage contract</List.Header>
                  <List.Description>
                    {storageContractId ? (
                      <span>
                        Active contract{' '}
                        <code style={{ cursor: 'pointer', textDecoration: 'underline' }} role="button" tabIndex={0}
                          onClick={() => navigate(`/contracts/${encodeURIComponent(storageContractId)}`)}
                          onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/contracts/${encodeURIComponent(storageContractId)}`); }}
                        >
                          {String(storageContractId).slice(0, 12)}…
                        </code>
                        {' '}(pay-to-distribute bonded storage).
                        {contractPayTx && (
                          <div style={{ marginTop: '0.5em' }}>
                            {contractPayTx.loading && (
                              <span style={{ color: '#666', fontSize: '0.92em' }}>Checking L1 payment transaction…</span>
                            )}
                            {!contractPayTx.loading && contractPayTx.txid && contractPayTx.tx
                              && (contractPayTx.tx.blockhash == null || contractPayTx.tx.blockhash === '')
                              && Number(contractPayTx.tx.confirmations || 0) === 0 && (
                              <div style={{ fontSize: '0.92em' }}>
                                <Label size="small" color="orange">
                                  <Icon name="clock" />
                                  Mempool
                                </Label>
                                {' '}
                                {uf.bitcoinExplorer ? (
                                  <Link to={`/services/bitcoin/transactions/${encodeURIComponent(contractPayTx.txid)}`}>
                                    Payment transaction
                                  </Link>
                                ) : (
                                  <code style={{ fontSize: '0.85em', wordBreak: 'break-all' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility for the tx viewer">
                                    {contractPayTx.txid}
                                  </code>
                                )}
                                <span style={{ color: '#666' }}> — awaiting confirmation</span>
                              </div>
                            )}
                            {!contractPayTx.loading && contractPayTx.txid && contractPayTx.tx
                              && contractPayTx.tx.confirmations != null && Number(contractPayTx.tx.confirmations) > 0 && (
                              <div style={{ fontSize: '0.92em' }}>
                                <Label size="small" color="green">
                                  <Icon name="check" />
                                  {contractPayTx.tx.confirmations} confirmation{Number(contractPayTx.tx.confirmations) === 1 ? '' : 's'}
                                </Label>
                                {' '}
                                {uf.bitcoinExplorer ? (
                                  <Link to={`/services/bitcoin/transactions/${encodeURIComponent(contractPayTx.txid)}`}>
                                    View payment transaction
                                  </Link>
                                ) : (
                                  <code style={{ fontSize: '0.85em', wordBreak: 'break-all' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility for the tx viewer">
                                    {contractPayTx.txid}
                                  </code>
                                )}
                              </div>
                            )}
                            {!contractPayTx.loading && contractPayTx.error && contractPayTx.txid && (
                              <div style={{ fontSize: '0.92em', color: '#666' }}>
                                {uf.bitcoinExplorer ? (
                                  <Link to={`/services/bitcoin/transactions/${encodeURIComponent(contractPayTx.txid)}`}>
                                    Payment transaction
                                  </Link>
                                ) : (
                                  <code style={{ fontSize: '0.85em', wordBreak: 'break-all' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility for the tx viewer">
                                    {contractPayTx.txid}
                                  </code>
                                )}
                                <span> — {contractPayTx.error}</span>
                              </div>
                            )}
                            {!contractPayTx.loading && contractPayTx.error && !contractPayTx.txid && (
                              <span style={{ fontSize: '0.92em', color: '#888' }}>{contractPayTx.error}</span>
                            )}
                            {!contractPayTx.loading && contractPayTx.txid === null && !contractPayTx.error && (
                              <span style={{ fontSize: '0.92em', color: '#888' }}>No payment tx id on contract yet.</span>
                            )}
                          </div>
                        )}
                      </span>
                    ) : (
                      'No storage contract — use Distribute to bond L1 payment for replicated storage.'
                    )}
                  </List.Description>
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Icon name="bitcoin" color={docPurchasePriceSats > 0 ? 'orange' : 'grey'} verticalAlign="middle" />
                <List.Content>
                  <List.Header>Paid access (inventory HTLC)</List.Header>
                  <List.Description>
                    {docPurchasePriceSats > 0
                      ? `Buyers pay ${formatSatsDisplay(docPurchasePriceSats)} sats via P2TR HTLC to unlock content (Fabric protocol; not a Lightning invoice).`
                      : 'No list price — document is free to fetch once published.'}
                  </List.Description>
                </List.Content>
              </List.Item>
            </List>
          </Message>
        )}

        {doc && (
        <Card fluid>
          <Card.Content>
            <Card.Header>Document</Card.Header>
          <Card.Meta>{created}</Card.Meta>
            <Card.Description>
              <div><strong>ID:</strong> <code>{id}</code></div>
              <div title="Fabric document id for the content creator (original lineage)">
                <strong>Author:</strong> <code>{authorDocId || '—'}</code>
              </div>
              <div title="Fabric peer id of the hub hosting this document in its published index">
                <strong>Publisher:</strong>{' '}
                {isPublishedInStore && fabricPeerId
                  ? <code>{fabricPeerId}</code>
                  : <span style={{ color: '#888' }}>— (listed hub peer id when published)</span>}
              </div>
              <div><strong>MIME:</strong> {mime}</div>
              <div><strong>Size:</strong> {doc && doc.size != null ? `${doc.size} bytes` : ''}</div>
              {isHtlcPendingDecrypt && (
                <Message info style={{ marginTop: '0.75em' }}>
                  <Message.Header>HTLC-encrypted delivery</Message.Header>
                  <p style={{ margin: '0.5em 0 0.75em', fontSize: '0.95em' }}>
                    This file was sent after an inventory HTLC was funded. Use the same 32-byte preimage that appears in the seller&apos;s on-chain claim witness (Taproot hashlock). That preimage is <code>SHA256</code> of the canonical Fabric <code>DocumentPublish</code> message (AMP wire bytes) wrapping the stored document fields — the same binding as JSON-RPC <code>CreatePurchaseInvoice</code> <code>contentHash</code> (payment hash is <code>SHA256</code> of the preimage). Implemented in <code>@fabric/core/functions/publishedDocumentEnvelope</code>.
                  </p>
                  {doc.htlcPaymentHashHex && (
                    <div style={{ fontSize: '0.88em', marginBottom: '0.5em', wordBreak: 'break-all' }}>
                      <strong>Payment hash (verify on-chain / invoice):</strong> <code>{doc.htlcPaymentHashHex}</code>
                    </div>
                  )}
                  <Input
                    fluid
                    placeholder="Preimage (64 hex characters)"
                    value={htlcPreimageHex}
                    onChange={(e, d) => setHtlcPreimageHex((d && d.value) != null ? d.value : e.target.value)}
                    style={{ marginBottom: '0.5em' }}
                  />
                  <Button
                    size="small"
                    primary
                    loading={htlcUnlockBusy}
                    disabled={!TXID_HEX_64.test(htlcPreimageHex.trim())}
                    title="Preimage is 32 bytes (64 hex characters), same length as a txid"
                    onClick={handleHtlcPreimageUnlock}
                  >
                    <Icon name="key" />
                    Decrypt with preimage
                  </Button>
                  {htlcUnlockError && (
                    <div style={{ marginTop: '0.5em', color: '#9f3a38', fontSize: '0.9em' }}>{htlcUnlockError}</div>
                  )}
                </Message>
              )}
              {isEncrypted && !contentBase64 && (
                <div style={{ marginTop: '0.5em' }}>
                  <Button size="small" onClick={handleUnlock} title="Decrypt and show content">
                    <Icon name="unlock" />
                    Unlock
                  </Button>
                </div>
              )}
              {needsIdentityUnlock && (() => {
                const idMode = classifyHubBrowserIdentity(props.identity || {});
                const header = idMode === 'watch_only'
                  ? 'Signing key required'
                  : idMode === 'password_locked'
                    ? 'Unlock Fabric identity'
                    : 'Fabric identity required';
                return (
                  <Message info size="small" style={{ marginTop: '0.75em' }}>
                    <Message.Header>{header}</Message.Header>
                    <p style={{ margin: '0.35em 0 0.5em', fontSize: '0.95em' }}>
                      {idMode === 'watch_only' ? (
                        <>
                          This browser only has a <strong>watch-only</strong> identity (public key). <strong>Publish</strong>, <strong>Purchase</strong>, and <strong>Distribute</strong> need a full key: open the top-bar identity menu or{' '}
                          <Link to="/settings">Settings</Link>
                          {' → '}
                          <strong>Fabric identity</strong> to import a signing key or use desktop signing.
                        </>
                      ) : idMode === 'password_locked' ? (
                        <>
                          Use the top-bar <strong>Locked</strong> control (encryption password) or{' '}
                          <Link to="/settings">Settings</Link>
                          {' → '}
                          <strong>Fabric identity</strong>. <strong>Publish</strong>, <strong>Purchase</strong> (HTLC invoice/claim), and <strong>Distribute</strong> only run while unlocked so hub requests are Schnorr-signed and document bytes are available.
                        </>
                      ) : (
                        <>
                          Create or restore a key: <Link to="/settings">Settings</Link>
                          {' → '}
                          <strong>Fabric identity</strong>, or <strong>Log in</strong> in the top bar.
                          {' '}
                          <strong>Publish</strong>, <strong>Purchase</strong>, and <strong>Distribute</strong> require Schnorr signing from this browser when you use those flows here.
                        </>
                      )}
                      {' '}
                      Pay-to-distribute and hub-wallet <strong>Pay Now</strong> use <strong>real Bitcoin transactions</strong>: <strong>Pay Now</strong> and <strong>Pay from hub wallet</strong> broadcast via this hub&apos;s <code>bitcoind</code> (admin token where required); you can also pay from any external wallet and paste the txid.
                      {needsIdentityKeyForEncryptedBody ? ' Encrypted documents also need unlock to preview or download.' : ''}{' '}
                      <Link to="/settings/bitcoin-wallet">Bitcoin wallet &amp; derivation</Link> ties this identity to L1 receive/send paths.
                    </p>
                    {typeof props.onRequestUnlock === 'function' && (
                      <Button size="small" type="button" onClick={() => props.onRequestUnlock()}>
                        <Icon name="key" />
                        Open Fabric identity
                      </Button>
                    )}
                  </Message>
                );
              })()}
            </Card.Description>
          </Card.Content>
          <Card.Content extra>
            <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button
                size="small"
                basic
                icon
                labelPosition="left"
                onClick={() => typeof props.onGetDocument === 'function' && props.onGetDocument(id)}
              >
                <Icon name="refresh" />
                Refresh
              </Button>
              <Button
                size="small"
                basic={!doc || !isPublishedInStore}
                color={doc && isPublishedInStore ? 'blue' : undefined}
                icon
                labelPosition="left"
                onClick={() => {
                  if (doc && isPublishedInStore) return;
                  if (!id || typeof props.onPublishDocument !== 'function') return;
                  setPublishError(null);
                  setIsPublishing(true);
                  const price = parseInt(publishPriceSats, 10);
                  props.onPublishDocument(id, price > 0 ? { purchasePriceSats: price } : undefined);
                }}
                disabled={!doc || isPublishing || !!isPublishedInStore || needsIdentityUnlock}
                title={
                  needsIdentityUnlock
                    ? 'Unlock your identity to publish (signed hub request)'
                    : (doc && isPublishedInStore ? 'Document is published' : 'Publish this document ID to the hub global store')
                }
              >
                <Icon
                  name={isPublishing ? 'spinner' : (doc && isPublishedInStore ? 'check' : 'bullhorn')}
                  loading={isPublishing}
                />
                {isPublishing ? 'Publishing…' : (doc && isPublishedInStore ? 'Published' : 'Publish')}
              </Button>
              {!isPublishedInStore && (
                <Input
                  type="number"
                  min="0"
                  placeholder="Price (sats)"
                  value={publishPriceSats}
                  onChange={(e) => setPublishPriceSats(e.target.value)}
                  style={{ width: 110 }}
                  disabled={needsIdentityUnlock}
                  title={
                    needsIdentityUnlock
                      ? 'Unlock identity to set list price when publishing'
                      : `List price when publishing (default ${DEFAULT_PUBLISH_PRICE_SATS} sats; HTLC purchase)`
                  }
                />
              )}
              {canPurchase && (
                <Button
                  size="small"
                  color="orange"
                  icon
                  labelPosition="left"
                  disabled={needsIdentityUnlock}
                  onClick={() => {
                    if (needsIdentityUnlock) return;
                    setPurchaseOpen(true);
                    setPurchaseInvoice(null);
                    setPurchaseTxid('');
                    setPurchaseError(null);
                    setPurchasedContent(null);
                    if (typeof props.onRequestPurchaseInvoice === 'function') {
                      props.onRequestPurchaseInvoice(id);
                    }
                  }}
                  title={
                    needsIdentityUnlock
                      ? 'Unlock identity to request a purchase invoice (signed hub request)'
                      : 'Purchase this document (HTLC: pay to unlock with sha256(sha256(content)))'
                  }
                >
                  <Icon name="bitcoin" />
                  Purchase ({formatSatsDisplay(docPurchasePriceSats)} sats)
                </Button>
              )}
              <Button
                size="small"
                basic={!storageContractId}
                color={storageContractId ? 'purple' : undefined}
                icon
                labelPosition="left"
                onClick={() => {
                  if (storageContractId) {
                    navigate(`/contracts/${encodeURIComponent(storageContractId)}`);
                    return;
                  }
                  if (id) {
                    setDistributeError(null);
                    setDistributeOpen(true);
                  }
                }}
                disabled={!id || needsIdentityUnlock}
                title={
                  needsIdentityUnlock
                    ? 'Unlock your identity to start pay-to-distribute (signed requests, real L1 bond)'
                    : (storageContractId ? 'View storage contract' : 'Distribute this document across other nodes')
                }
              >
                <Icon name={storageContractId ? 'cloud' : 'cloud upload'} />
                {storageContractId ? 'Distributed' : 'Distribute'}
              </Button>
              <Button
                size="small"
                basic
                icon
                labelPosition="left"
                onClick={() => id && setShareOpen(true)}
                disabled={!id}
                title="Share a link to this document"
              >
                <Icon name="share alternate" />
                Share
              </Button>
              {canAdminUnpublish && (
                <Button
                  size="small"
                  color="red"
                  basic
                  icon
                  labelPosition="left"
                  onClick={() => {
                    if (needsIdentityUnlock) return;
                    setTombstoneError(null);
                    setTombstoneOpen(true);
                  }}
                  disabled={needsIdentityUnlock}
                  title={
                    needsIdentityUnlock
                      ? 'Unlock your identity before removing this document from the hub catalog'
                      : 'Remove this document from the hub published catalog (requires admin token)'
                  }
                >
                  <Icon name="trash" />
                  Unpublish
                </Button>
              )}
              {downloadHref && (
                <Button
                  size="small"
                  primary
                  as="a"
                  href={downloadHref}
                  download={name}
                >
                  <Icon name="download" />
                  Download
                </Button>
              )}
            </div>
            {publishError ? (
              <Message
                negative
                size="small"
                style={{ marginTop: '0.75em' }}
                onDismiss={() => setPublishError(null)}
              >
                <Message.Header>Publish did not complete</Message.Header>
                <p style={{ margin: '0.35em 0 0', fontSize: '0.95em' }}>{publishError}</p>
              </Message>
            ) : null}
          </Card.Content>
        </Card>
        )}

        <Modal
          size="small"
          open={shareOpen}
          onClose={() => setShareOpen(false)}
        >
          <Header icon="share alternate" content="Share document" />
          <Modal.Content>
            <p style={{ color: '#666' }}>
              This link keeps the document ID on the client side using the URL hash.
            </p>
            <Input
              fluid
              readOnly
              value={shareUrlHash}
              onFocus={(e) => e.target.select()}
              action={{
                icon: 'copy',
                title: 'Copy to clipboard',
                onClick: () => {
                  try {
                    if (shareUrlHash && navigator && navigator.clipboard) {
                      navigator.clipboard.writeText(shareUrlHash);
                    }
                  } catch (e) {}
                }
              }}
            />
            {shareUrlCanonical && (
              <p style={{ marginTop: '0.75em', fontSize: '0.85em', color: '#888' }}>
                Permanent URL: <code>{shareUrlCanonical}</code>
              </p>
            )}
          </Modal.Content>
          <Modal.Actions>
            <Button basic onClick={() => setShareOpen(false)}>
              Close
            </Button>
          </Modal.Actions>
        </Modal>

        <Modal
          size="small"
          open={tombstoneOpen}
          onClose={() => {
            if (tombstoneBusy) return;
            setTombstoneOpen(false);
            setTombstoneError(null);
          }}
        >
          <Header icon="trash" content="Unpublish document (admin)" />
          <Modal.Content>
            <p style={{ color: '#666' }}>
              This removes the document from the hub&apos;s <strong>published catalog</strong> so it no longer appears in the network index.
              The hub may still keep the stored file under <code>documents/</code>; this action is the same as{' '}
              <code>EmitTombstone</code> with <code>documentId</code>.
            </p>
            <p style={{ color: '#666' }}>
              <strong>Document id:</strong> <code>{id}</code>
            </p>
            {tombstoneError && (
              <Message negative size="small">
                <p>{tombstoneError}</p>
              </Message>
            )}
          </Modal.Content>
          <Modal.Actions>
            <Button type="button" basic onClick={() => { if (!tombstoneBusy) { setTombstoneOpen(false); setTombstoneError(null); } }}>
              Cancel
            </Button>
            <Button
              type="button"
              negative
              loading={tombstoneBusy}
              disabled={tombstoneBusy}
              onClick={handleConfirmTombstone}
            >
              <Icon name="trash" />
              Remove from hub index
            </Button>
          </Modal.Actions>
        </Modal>

        <Modal
          size="small"
          open={distributeOpen}
          onClose={() => {
            if (distributeBusy || distributeBridgeBusy || peerOfferBusy) return;
            setDistributeOpen(false);
            setDistributeError(null);
            setDistributeInvoice(null);
            setDistributeTxid('');
            setDistributeSuccessContractId(null);
            setDistributeBridgeBusy(false);
            setPeerOfferKey('');
            setPeerOfferBusy(false);
            setPeerOfferError(null);
            setPeerOfferSuccess(null);
          }}
        >
          <Header icon="cloud upload" content="Pay to distribute" />
          <Modal.Content>
            <p style={{ color: '#666' }}>
              Pay Bitcoin (L1) to have other nodes store this document under a long-term contract.
              By default, storage is requested for 4 years with periodic random challenges.
              Payment is a <strong>real on-chain transaction</strong> to the invoice address; the hub verifies it before recording the storage contract.
            </p>
            {needsIdentityUnlock && (
              <Message warning size="small" style={{ marginBottom: '1em' }}>
                <Message.Header>Identity locked</Message.Header>
                <p style={{ margin: '0.35em 0 0', color: '#333' }}>
                  Close this dialog, unlock your identity in the top bar, then open Distribute again.
                </p>
              </Message>
            )}
            {!!props.hasDocumentKey && distributeModalNoLocalWire && (
              <Message warning size="small" style={{ marginBottom: '1em' }}>
                <Message.Header>No local signing key in this browser</Message.Header>
                <p style={{ margin: '0.35em 0 0', color: '#333' }}>
                  Invoice and contract steps still reach the Hub over your session; pay the distribute address from any wallet you trust.
                  If you use desktop delegation, confirm prompts in the Hub app and revoke under{' '}
                  <Link to="/settings/security">Security &amp; delegation</Link> on shared computers.
                </p>
              </Message>
            )}
            {/* Step indicator: 1 Request invoice, 2 Pay, 3 Confirm / Success */}
            <div style={{ display: 'flex', gap: '0.5em', marginBottom: '1em', flexWrap: 'wrap' }}>
              <Label
                color={!distributeInvoice && !distributeSuccessContractId ? 'blue' : 'grey'}
                size="small"
              >
                1. Request invoice
              </Label>
              <Label
                color={distributeInvoice && !distributeSuccessContractId ? 'blue' : 'grey'}
                size="small"
              >
                2. Pay
              </Label>
              <Label
                color={distributeSuccessContractId ? 'green' : 'grey'}
                size="small"
              >
                3. {distributeSuccessContractId ? 'Done' : 'Confirm'}
              </Label>
            </div>
            {distributeSuccessContractId ? (
              <Segment color="green" style={{ textAlign: 'center' }}>
                <Icon name="check circle" size="big" color="green" />
                <Header as="h4" style={{ marginTop: '0.5em' }}>
                  Storage contract created
                </Header>
                <p style={{ color: '#666', marginBottom: '1em' }}>
                  Your payment has been bonded. The document is now distributed.
                </p>
                <Button
                  primary
                  as={Link}
                  to={`/contracts/${encodeURIComponent(distributeSuccessContractId)}`}
                  onClick={() => {
                    setDistributeOpen(false);
                    setDistributeSuccessContractId(null);
                    setDistributeInvoice(null);
                    setDistributeTxid('');
                  }}
                >
                  <Icon name="file alternate" />
                  View contract
                </Button>
              </Segment>
            ) : !distributeInvoice ? (
              <Form
                id="fabric-document-distribute-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!id || distributeBusy || peerOfferBusy || needsIdentityUnlock) return;
                  const amount = parseInt(distributeAmountSats, 10);
                  if (!Number.isFinite(amount) || amount <= 0) {
                    setDistributeError('Enter a positive amount in sats.');
                    return;
                  }
                  setDistributeError(null);
                  setDistributeBusy(true);
                  const config = {
                    amountSats: amount,
                    desiredCopies: Math.max(1, parseInt(distributeDesiredCopies, 10) || 1),
                    durationYears: distributeDurationYears,
                    challengeCadence: distributeCadence,
                    responseDeadline: distributeDeadline
                  };
                  if (typeof props.onRequestDistributeInvoice === 'function') {
                    props.onRequestDistributeInvoice(id, config);
                  } else {
                    setDistributeError('Distribute is not available on this hub.');
                    setDistributeBusy(false);
                  }
                }}
              >
                <Form.Field>
                  <label>Amount (sats)</label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="e.g. 100000"
                    value={distributeAmountSats}
                    onChange={(e) => setDistributeAmountSats(e.target.value)}
                  />
                </Form.Field>
                <Form.Field>
                  <label># of desired copies</label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={distributeDesiredCopies}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v) && v >= 1) setDistributeDesiredCopies(v);
                    }}
                    title="How many copies you want stored across the network"
                  />
                </Form.Field>
                <Form.Field>
                  <label>Duration</label>
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    value={distributeDurationYears}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v)) setDistributeDurationYears(v);
                    }}
                    label={{ basic: true, content: 'years' }}
                    labelPosition="right"
                  />
                </Form.Field>
                <Form.Field>
                  <label>Challenge frequency</label>
                  <Dropdown
                    selection
                    options={cadenceOptions}
                    value={distributeCadence}
                    onChange={(_, data) => setDistributeCadence(data.value)}
                  />
                </Form.Field>
                <Form.Field>
                  <label>Response deadline</label>
                  <Dropdown
                    selection
                    options={deadlineOptions}
                    value={distributeDeadline}
                    onChange={(_, data) => setDistributeDeadline(data.value)}
                  />
                </Form.Field>
                <Divider section />
                <Message info size="small">
                  <Message.Header>Offer a connected Fabric peer</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#333' }}>
                    Sends a private P2P hosting offer (same channel as incoming proposals on{' '}
                    <Link to="/documents">Documents</Link>). The peer accepts from their list and returns a Bitcoin invoice; you pay that invoice to bond storage.
                    The hub must already have the file under its content hash — create or open the document once so it is stored on the hub.
                  </p>
                  {fabricPeerDropdownOptions.length === 0 ? (
                    <p style={{ margin: '0.75em 0 0', color: '#666' }}>
                      No Fabric TCP peers in the latest hub snapshot. Connect a peer under{' '}
                      <Link to="/peers">Peers</Link>.
                    </p>
                  ) : (
                    <>
                      <Form.Field style={{ marginTop: '0.75em' }}>
                        <label>Peer</label>
                        <Dropdown
                          placeholder="Select peer (must be connected on the hub)"
                          selection
                          search
                          options={fabricPeerDropdownOptions}
                          value={peerOfferKey}
                          onChange={(e, { value }) => {
                            setPeerOfferKey(String(value || ''));
                            setPeerOfferError(null);
                            setPeerOfferSuccess(null);
                          }}
                        />
                      </Form.Field>
                      <Button
                        type="button"
                        basic
                        color="blue"
                        loading={peerOfferBusy}
                        disabled={
                          peerOfferBusy ||
                          distributeBusy ||
                          distributeBridgeBusy ||
                          needsIdentityUnlock ||
                          !peerOfferKey ||
                          typeof props.onSendDistributeProposal !== 'function'
                        }
                        onClick={() => {
                          const amount = parseInt(distributeAmountSats, 10);
                          if (!Number.isFinite(amount) || amount <= 0) {
                            setPeerOfferError('Enter a positive amount in sats above first.');
                            return;
                          }
                          const backendId = (doc && doc.sha256) ? String(doc.sha256) : String(id);
                          if (!backendId || typeof props.onSendDistributeProposal !== 'function') return;
                          setPeerOfferBusy(true);
                          setPeerOfferError(null);
                          setPeerOfferSuccess(null);
                          const config = {
                            desiredCopies: Math.max(1, parseInt(distributeDesiredCopies, 10) || 1),
                            durationYears: distributeDurationYears,
                            challengeCadence: distributeCadence,
                            responseDeadline: distributeDeadline,
                            actorId: (doc && doc.id) ? String(doc.id) : null
                          };
                          props.onSendDistributeProposal(peerOfferKey, {
                            documentId: backendId,
                            amountSats: amount,
                            config,
                            documentName: (doc && doc.name) || name,
                            document: doc
                              ? { id: doc.id, sha256: doc.sha256, name: doc.name, mime: doc.mime, size: doc.size }
                              : null
                          });
                        }}
                      >
                        <Icon name="send" />
                        Send hosting offer
                      </Button>
                      {typeof props.onSendDistributeProposal !== 'function' && (
                        <p style={{ marginTop: '0.5em', color: '#888', fontSize: '0.9em' }}>
                          This session does not expose peer proposals (bridge not ready).
                        </p>
                      )}
                      {peerOfferError && (
                        <Message negative size="small" style={{ marginTop: '0.75em' }} content={peerOfferError} />
                      )}
                      {peerOfferSuccess && (
                        <Message positive size="small" style={{ marginTop: '0.75em' }} content={peerOfferSuccess} />
                      )}
                    </>
                  )}
                </Message>
                {distributeError && (
                  <p style={{ marginTop: '0.75em', color: '#b00' }}>
                    {distributeError}
                  </p>
                )}
              </Form>
            ) : (
              <>
                <Invoice
                  address={distributeInvoice.address}
                  amountSats={distributeInvoice.amountSats}
                  network={distributeInvoice.network}
                  label="Storage contract payment"
                  identity={props.identity || {}}
                  compact
                  requireUnlockedIdentityForHubPay
                  identityUnlocked={!!props.hasDocumentKey}
                  onPaid={(txid) => {
                    setDistributeTxid(txid);
                    if (txid && id && typeof props.onDistributeDocument === 'function') {
                      setDistributeBusy(true);
                      const config = {
                        amountSats: distributeInvoice.amountSats,
                        durationYears: distributeInvoice.config?.durationYears || distributeDurationYears,
                        challengeCadence: distributeInvoice.config?.challengeCadence || distributeCadence,
                        responseDeadline: distributeInvoice.config?.responseDeadline || distributeDeadline,
                        txid
                      };
                      Promise.resolve(props.onDistributeDocument(id, config))
                        .catch((err) => {
                          setDistributeBusy(false);
                          setDistributeError(
                            (err && err.message) ? err.message : 'Distribution request failed.'
                          );
                        });
                    }
                  }}
                />
                {hubAdminTokenPresent && (
                  <div style={{ marginTop: '1em', display: 'flex', flexWrap: 'wrap', gap: '0.75em', alignItems: 'center' }}>
                    <Button
                      type="button"
                      color="orange"
                      loading={distributeBridgeBusy}
                      disabled={
                        distributeBridgeBusy ||
                        distributeBusy ||
                        !!distributeSuccessContractId ||
                        needsIdentityUnlock
                      }
                      onClick={handlePayDistributeFromBridge}
                      title="POST /services/bitcoin sendpayment — hub bitcoind broadcasts; admin token + unlocked identity required in this browser"
                    >
                      <Icon name="server" />
                      Pay from hub wallet & bond
                    </Button>
                    <span style={{ color: '#666', fontSize: '0.9em', maxWidth: '28em' }}>
                      {'One step: spend from this hub\'s bitcoind wallet, then call '}
                      <code>CreateStorageContract</code>
                      {' with the returned txid (same as Confirm below). Regtest: mine a block if verification is slow.'}
                    </span>
                  </div>
                )}
                <Form.Field style={{ marginTop: '1em' }}>
                  <label>Or paste txid (if you paid from an external wallet)</label>
                  <Input
                    placeholder="txid from your wallet"
                    value={distributeTxid}
                    onChange={(e) => setDistributeTxid(e.target.value)}
                  />
                </Form.Field>
                {TXID_HEX_64.test(String(distributeTxid || '').trim()) && (
                  <div style={{ marginTop: '0.5em', fontSize: '0.9em' }}>
                    {uf.bitcoinExplorer ? (
                      <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(distributeTxid).trim())}`}>
                        Open transaction
                      </Link>
                    ) : (
                      <code style={{ fontSize: '0.85em', wordBreak: 'break-all' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility for the tx viewer">
                        {String(distributeTxid).trim()}
                      </code>
                    )}
                    <span style={{ color: '#666' }}>
                      {' '}— on-chain sends often appear in the mempool first; mine a block on regtest to confirm.
                    </span>
                    {distributeTxChain && !distributeSuccessContractId && (
                      <div style={{ marginTop: '0.35em', color: '#555' }}>
                        {distributeTxChain.loading && <span>Checking depth…</span>}
                        {!distributeTxChain.loading && distributeTxChain.tx
                          && (distributeTxChain.tx.blockhash == null || distributeTxChain.tx.blockhash === '')
                          && Number(distributeTxChain.tx.confirmations || 0) === 0 && (
                          <span><strong>Mempool</strong> — 0 confirmations</span>
                        )}
                        {!distributeTxChain.loading && distributeTxChain.tx
                          && Number(distributeTxChain.tx.confirmations || 0) > 0 && (
                          <span>
                            <strong>{distributeTxChain.tx.confirmations}</strong> confirmation
                            {Number(distributeTxChain.tx.confirmations) === 1 ? '' : 's'}
                          </span>
                        )}
                        {!distributeTxChain.loading && distributeTxChain.error && (
                          <span style={{ color: '#888' }}>{distributeTxChain.error}</span>
                        )}
                        {!distributeTxChain.loading && !distributeTxChain.tx && !distributeTxChain.error && (
                          <span style={{ color: '#888' }}>Not visible on this hub yet — will retry.</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </Modal.Content>
          <Modal.Actions>
            <Button
              basic
              onClick={() => {
                if (distributeBusy || distributeBridgeBusy || peerOfferBusy) return;
                setDistributeOpen(false);
                setDistributeError(null);
                setDistributeInvoice(null);
                setDistributeTxid('');
                setDistributeSuccessContractId(null);
                setDistributeBridgeBusy(false);
                setPeerOfferKey('');
                setPeerOfferBusy(false);
                setPeerOfferError(null);
                setPeerOfferSuccess(null);
              }}
            >
              {distributeSuccessContractId ? 'Close' : distributeInvoice ? 'Previous' : 'Cancel'}
            </Button>
            {distributeSuccessContractId ? (
              <Button
                primary
                as={Link}
                to={`/contracts/${encodeURIComponent(distributeSuccessContractId)}`}
                onClick={() => {
                  setDistributeOpen(false);
                  setDistributeSuccessContractId(null);
                  setDistributeInvoice(null);
                  setDistributeTxid('');
                }}
              >
                <Icon name="file alternate" />
                View contract
              </Button>
            ) : !distributeInvoice ? (
              <Button
                primary
                type="submit"
                form="fabric-document-distribute-form"
                loading={distributeBusy}
                disabled={distributeBusy || peerOfferBusy || needsIdentityUnlock}
                title={needsIdentityUnlock ? 'Unlock identity to request a distribute invoice' : undefined}
              >
                Request invoice
              </Button>
            ) : (
              <Button
                primary
                loading={distributeBusy}
                disabled={!distributeTxid.trim() || distributeBusy || distributeBridgeBusy}
                onClick={() => {
                  const tx = distributeTxid.trim();
                  if (!tx || !id || typeof props.onDistributeDocument !== 'function') return;
                  setDistributeBusy(true);
                  const config = {
                    amountSats: distributeInvoice.amountSats,
                    durationYears: distributeInvoice.config?.durationYears || distributeDurationYears,
                    challengeCadence: distributeInvoice.config?.challengeCadence || distributeCadence,
                    responseDeadline: distributeInvoice.config?.responseDeadline || distributeDeadline,
                    txid: tx
                  };
                  Promise.resolve(props.onDistributeDocument(id, config))
                    .catch((err) => {
                      setDistributeBusy(false);
                      setDistributeError(
                        (err && err.message) ? err.message : 'Distribution request failed.'
                      );
                    });
                  // Success: storageContractBonded will fire and set distributeSuccessContractId
                }}
              >
                Confirm & Distribute
              </Button>
            )}
          </Modal.Actions>
        </Modal>

        <Modal
          size="small"
          open={purchaseOpen}
          onClose={() => {
            if (purchaseBusy || purchaseBridgeBusy) return;
            setPurchaseOpen(false);
            setPurchaseInvoice(null);
            setPurchaseTxid('');
            setPurchaseError(null);
            setPurchasedContent(null);
            setPurchaseBridgeBusy(false);
          }}
        >
          <Header icon="bitcoin" content="Purchase document (HTLC)" />
          <Modal.Content>
            <p style={{ color: '#666' }}>
              Pay the on-chain invoice (P2TR HTLC). The hub checks that your transaction pays this address for at least the listed amount, then returns ciphertext you can open; the binding matches the <strong>Paid access</strong> description on this page (Fabric <code>DocumentPublish</code> envelope / <code>CreatePurchaseInvoice</code>). Payment is a <strong>real L1 broadcast</strong> (mempool then confirmations).
            </p>
            {needsIdentityUnlock && (
              <Message warning size="small" style={{ marginTop: '0.75em' }}>
                Unlock your identity to complete this flow from this browser.
              </Message>
            )}
            <p style={{ color: '#888', fontSize: '0.9em', marginTop: '0.35em' }}>
              If <strong>Claim &amp; Unlock</strong> fails immediately after you broadcast, the payment may still be unconfirmed — on regtest use <strong>Generate Block</strong> on{' '}
              <Link to="/services/bitcoin">Bitcoin</Link>.
              {uf.bitcoinResources ? (
                <>
                  {' '}For a raw L1 proof (txid + address + sats), use{' '}
                  <Link to="/services/bitcoin/resources">Bitcoin → Resources</Link>.
                </>
              ) : (
                <>
                  {' '}Enable <strong>Bitcoin — HTTP resources</strong> in Admin for the interactive payment verifier.
                </>
              )}
            </p>
            {purchasedContent ? (
              <Segment color="green">
                <Icon name="check circle" size="big" color="green" />
                <Header as="h4" style={{ marginTop: '0.5em' }}>Document unlocked</Header>
                <p style={{ color: '#666', marginBottom: '1em' }}>Content hash verified. You can now view or download.</p>
                <Button
                  primary
                  as="a"
                  href={`data:${purchasedContent.mime || 'application/octet-stream'};base64,${purchasedContent.contentBase64}`}
                  download={purchasedContent.name || 'document'}
                >
                  <Icon name="download" />
                  Download
                </Button>
              </Segment>
            ) : !purchaseInvoice ? (
              <div style={{ marginTop: '0.5em' }}>
                {!purchaseError && <p style={{ color: '#888' }}>Requesting invoice…</p>}
                {purchaseError && (
                  <>
                    <Message negative>{purchaseError}</Message>
                    <p style={{ color: '#666', fontSize: '0.9em', marginTop: '0.75em' }}>
                      Typical causes: Bitcoin unavailable on the hub, document not published, or no list price / floor. Use <Link to="/services/bitcoin">Bitcoin</Link> and confirm this document shows <strong>Published</strong> with a purchase price.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <>
                <Invoice
                  address={purchaseInvoice.address}
                  amountSats={purchaseInvoice.amountSats}
                  network={purchaseInvoice.network}
                  label="Document purchase (HTLC)"
                  identity={props.identity || {}}
                  compact
                  requireUnlockedIdentityForHubPay
                  identityUnlocked={!!props.hasDocumentKey}
                  onPaid={(txid) => {
                    setPurchaseTxid(txid);
                    if (txid && id && typeof props.onClaimPurchase === 'function') {
                      setPurchaseBusy(true);
                      setPurchaseError(null);
                      Promise.resolve(props.onClaimPurchase(id, txid))
                        .then((res) => {
                          if (res && res.document) {
                            setPurchasedContent(res.document);
                          } else {
                            setPurchaseError((res && res.error) || 'Claim failed');
                          }
                        })
                        .catch((err) => setPurchaseError(err && err.message ? err.message : String(err)))
                        .finally(() => setPurchaseBusy(false));
                    }
                  }}
                />
                {hubAdminTokenPresent && (
                  <div style={{ marginTop: '1em', display: 'flex', flexWrap: 'wrap', gap: '0.75em', alignItems: 'center' }}>
                    <Button
                      type="button"
                      color="orange"
                      loading={purchaseBridgeBusy}
                      disabled={
                        purchaseBridgeBusy ||
                        purchaseBusy ||
                        !!purchasedContent ||
                        needsIdentityUnlock
                      }
                      onClick={handlePayPurchaseFromBridge}
                      title="POST /services/bitcoin sendpayment — hub bitcoind broadcasts; admin token + unlocked identity in this browser"
                    >
                      <Icon name="server" />
                      Pay from hub wallet & unlock
                    </Button>
                    <span style={{ color: '#666', fontSize: '0.9em', maxWidth: '28em' }}>
                      {'Spend from this hub\'s bitcoind wallet, then claim with the returned txid. Regtest: mine a block if verification is slow.'}
                    </span>
                  </div>
                )}
                <Form.Field style={{ marginTop: '1em' }}>
                  <label>Or paste txid (if you paid from an external wallet)</label>
                  <Input
                    placeholder="txid from your wallet"
                    value={purchaseTxid}
                    onChange={(e) => setPurchaseTxid(e.target.value)}
                  />
                </Form.Field>
                {purchaseError && <Message negative style={{ marginTop: '1em' }}>{purchaseError}</Message>}
              </>
            )}
          </Modal.Content>
          <Modal.Actions>
            <Button basic onClick={() => {
              if (purchaseBusy || purchaseBridgeBusy) return;
              setPurchaseOpen(false);
              setPurchaseInvoice(null);
              setPurchaseTxid('');
              setPurchaseError(null);
              setPurchasedContent(null);
              setPurchaseBridgeBusy(false);
            }}>
              {purchasedContent ? 'Close' : 'Cancel'}
            </Button>
            {!purchasedContent && purchaseInvoice && (
              <Button
                primary
                loading={purchaseBusy}
                disabled={!purchaseTxid.trim() || purchaseBusy || purchaseBridgeBusy}
                onClick={() => {
                  const tx = purchaseTxid.trim();
                  if (!tx || !id || typeof props.onClaimPurchase !== 'function') return;
                  setPurchaseBusy(true);
                  setPurchaseError(null);
                  Promise.resolve(props.onClaimPurchase(id, tx))
                    .then((res) => {
                      if (res && res.document) setPurchasedContent(res.document);
                      else setPurchaseError((res && res.error) || 'Claim failed');
                    })
                    .catch((err) => setPurchaseError(err && err.message ? err.message : String(err)))
                    .finally(() => setPurchaseBusy(false));
                }}
              >
                Claim & Unlock
              </Button>
            )}
          </Modal.Actions>
        </Modal>

        {!doc && loadError && (
          <Message negative style={{ marginTop: '1em' }}>
            <Message.Header>Could not load document</Message.Header>
            <p>{loadError}</p>
            <Button as={Link} to="/documents" style={{ marginTop: '0.75em' }} aria-label="Back to documents list">
              <Icon name="arrow left" aria-hidden="true" />
              Documents
            </Button>
            <Button
              basic
              style={{ marginTop: '0.75em', marginLeft: '0.5em' }}
              onClick={() => {
                setLoadError(null);
                if (typeof props.onGetDocument === 'function' && id) props.onGetDocument(id);
              }}
            >
              <Icon name="refresh" />
              Retry
            </Button>
          </Message>
        )}
        {!doc && !loadError && (
          <Segment
            placeholder
            secondary
            style={{ marginTop: '1em', minHeight: '20vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <div>
              <Loader active inline="centered" />
              <Header as="h4" style={{ marginTop: '1em', textAlign: 'center' }}>
                Loading document…
                <Header.Subheader>
                  Fetching document details from hub.
                </Header.Subheader>
              </Header>
            </div>
          </Segment>
        )}

        {doc && isEncrypted && !contentBase64 && (
          <Segment secondary style={{ marginTop: '1em' }}>
            <Header as="h3">Contents</Header>
            <p style={{ color: '#666' }}>
              {props.hasDocumentKey
                ? 'Encrypted. Click Unlock above to decrypt and view.'
                : (
                  <>
                    Encrypted. Unlock your identity to view this document (
                    <Link to="/settings">Settings</Link> → <strong>Fabric identity</strong> or the top-bar <strong>Locked</strong> control).
                  </>
                )}
            </p>
          </Segment>
        )}

        {doc && imageSrc && (
          <Segment style={{ marginTop: '1em' }}>
            <Header as="h3">Preview</Header>
            <div style={{ textAlign: 'center' }}>
              <img
                src={imageSrc}
                alt={name}
                style={{ maxWidth: '100%', maxHeight: 520, borderRadius: 6, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
              />
            </div>
          </Segment>
        )}

        {doc && text != null && (
          <Segment style={{ marginTop: '1em' }}>
            <Header as="h3">Contents</Header>
            {showGraphPreview ? (
              <>
                <GraphDocumentPreview dotSource={text} hasDocumentKey={props.hasDocumentKey} />
                <details style={{ marginTop: '0.75rem' }}>
                  <summary style={{ cursor: 'pointer', color: '#555' }}>DOT source</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: '0.75em', borderRadius: 6, maxHeight: 320, overflow: 'auto', marginTop: '0.5rem' }}>
                    {text}
                  </pre>
                </details>
              </>
            ) : (
              <pre style={{ whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: '0.75em', borderRadius: 6, maxHeight: 520, overflow: 'auto' }}>
                {text}
              </pre>
            )}
          </Segment>
        )}

        {doc && !imageSrc && text == null && contentBase64 && (
          <Segment secondary style={{ marginTop: '1em' }}>
            <Header as="h3">Contents</Header>
            <p style={{ color: '#666' }}>
              A preview is not available for this file type. Use the Download button above to view it with a native application.
            </p>
          </Segment>
        )}
      </Segment>
    </fabric-document-detail>
  );
}

module.exports = DocumentDetail;
