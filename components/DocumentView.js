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
const FabricDocumentRecord = require('./FabricDocumentRecord');
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
const { loadServerFeatureFlags } = require('../functions/hubServerFeatureFlags');
const t = require('../locales/en');

const dv = t.documents.view;
const tc = t.common;

// Smallest HTLC that settles on Bitcoin mainnet (@fabric/core HTLC_MINIMUM_SATS).
const DEFAULT_PUBLISH_PRICE_SATS = '716';
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
  const [agentNotice, setAgentNotice] = React.useState(null);
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
            if (!ok) fail(dv.load.http(status));
            return;
          }
          if (body.error) {
            const err = body.error;
            const msg = err && (err.message != null || err.data != null)
              ? String(err.message != null ? err.message : err.data)
              : dv.load.refused;
            fail(msg);
            return;
          }
          if (body.result == null) {
            if (!ok) fail(dv.load.http(status));
            return;
          }
          const applied = bridge.mergeGetDocumentRpcResult(body.result);
          if (!applied && body.result && body.result.type === 'GetDocumentResult') {
            fail(
              (body.result.message && String(body.result.message)) || dv.load.failed
            );
          }
        })
        .catch((err) => {
          if (cancelled) return;
          if (typeof window === 'undefined') return;
          window.dispatchEvent(new CustomEvent('documentLoadFailed', {
            detail: {
              documentId: String(id),
              message: (err && err.message) ? err.message : dv.load.network
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
      setLoadError(d.message || dv.load.notFound);
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
      setLoadError((prev) => prev || dv.load.timeout);
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
      setDistributeError(String(detail.message || dv.distribute.invoiceFailed));
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
      setDistributeError((prev) => prev || dv.distribute.invoiceTimeout);
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
      setDistributeError(detail.message || dv.distribute.contractFailed);
    };
    window.addEventListener('storageContractBondFailed', handler);
    return () => window.removeEventListener('storageContractBondFailed', handler);
  }, [id, doc, distributeOpen]);

  // Timeout fallback if storageContractBonded never arrives
  React.useEffect(() => {
    if (!distributeBusy || distributeSuccessContractId) return;
    const timeout = setTimeout(() => {
      setDistributeBusy(false);
      setDistributeError(dv.distribute.contractSlow);
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
      setPeerOfferSuccess(dv.distribute.offerSent(pid ? shortHexId(pid) : ''));
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
      setPeerOfferError(String(d.message || dv.distribute.offerFailed));
    };
    window.addEventListener('distributeProposalFailed', handler);
    return () => window.removeEventListener('distributeProposalFailed', handler);
  }, [id, doc]);

  React.useEffect(() => {
    if (!peerOfferBusy) return undefined;
    const t = setTimeout(() => {
      setPeerOfferBusy(false);
      setPeerOfferError((prev) => prev || dv.distribute.offerTimeout);
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
        setPurchaseError(String(detail.message || dv.purchase.invoiceFailed));
      }
    };
    window.addEventListener('purchaseInvoiceFailed', handler);
    return () => window.removeEventListener('purchaseInvoiceFailed', handler);
  }, [id, doc, purchaseOpen]);

  // If the hub never answers, avoid an infinite "Requesting invoice…" state.
  React.useEffect(() => {
    if (!purchaseOpen || purchaseInvoice || purchasedContent) return undefined;
    const t = setTimeout(() => {
      setPurchaseError((prev) => prev || dv.purchase.invoiceTimeout);
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
      setPublishError((prev) => prev || dv.actions.publishTimeout);
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
      setPublishError(String(d.message || dv.actions.publishFailed));
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
        setHtlcUnlockError((r && r.error) || dv.keyUnlock.failed);
      } else {
        setHtlcPreimageHex('');
        setUnlocked(false);
        setDecryptedContent(null);
      }
    } catch (e) {
      setHtlcUnlockError((e && e.message) || dv.keyUnlock.failed);
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
  const serverFlags = loadServerFeatureFlags(bridgeForWire);
  const distributeEnabled = !!serverFlags.distribute;
  const documentPurchaseEnabled = serverFlags.documentPurchase !== false;
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
      setTombstoneError(tc.errors.adminTokenRequired);
      return;
    }
    const bridge = props.bridgeRef && props.bridgeRef.current;
    if (!bridge || typeof bridge.emitTombstone !== 'function') {
      setTombstoneError(dv.unpublish.notConnected);
      return;
    }
    // Hub published catalog keys documents by content hash; URL may use lineage / actor id.
    const canonicalDocId = (doc && doc.sha256) ? String(doc.sha256).trim() : String(id).trim();
    setTombstoneBusy(true);
    setTombstoneError(null);
    try {
      const r = await bridge.emitTombstone({ documentId: canonicalDocId, adminToken: token });
      if (!r || !r.ok) {
        setTombstoneError((r && r.message) ? r.message : dv.unpublish.failed);
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
      setTombstoneError((e && e.message) ? e.message : dv.unpublish.failed);
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
            error: (body && body.message) || dv.contract.loadFailed
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
            error: data.message || dv.contract.txLoadFailed
          });
          return;
        }
        if (!data || typeof data !== 'object') {
          setContractPayTx({
            loading: false,
            txid,
            error: dv.contract.txNotFound
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
          setDistributeTxChain({ loading: false, error: data.message || dv.distribute.txNotFound });
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

  const cadenceOptions = ['hourly', 'daily', 'weekly', 'monthly']
    .map((value) => ({ key: value, value, text: dv.distribute.cadence[value] }));

  const deadlineOptions = ['1s', '5s', '10s', '30s', '60s', '10m', '60m']
    .map((value) => ({ key: value, value, text: dv.distribute.deadline[value] }));

  const hubAdminTokenPresent = !!getAdminTokenFromProps(props);

  const handlePayDistributeFromBridge = React.useCallback(async () => {
    if (!distributeInvoice || !id) return;
    if (!props.hasDocumentKey) {
      setDistributeError(dv.payment.needSigning(fabricIdentityNeedFullKeyPlain(props.identity || {})));
      return;
    }
    const token = getAdminTokenFromProps(props);
    if (!token) {
      setDistributeError(dv.payment.needsToken);
      return;
    }
    const to = String(distributeInvoice.address || '').trim();
    const amountSats = Math.round(Number(distributeInvoice.amountSats));
    if (!to || !Number.isFinite(amountSats) || amountSats <= 0) {
      setDistributeError(dv.payment.invalidInvoice);
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
        throw new Error((res && res.message) || dv.payment.noTxid);
      }
      setDistributeTxid(txid);
      if (typeof props.onDistributeDocument !== 'function') {
        throw new Error(dv.distribute.unavailable);
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
      setPurchaseError(dv.payment.needSigning(fabricIdentityNeedFullKeyPlain(props.identity || {})));
      return;
    }
    const token = getAdminTokenFromProps(props);
    if (!token) {
      setPurchaseError(dv.payment.needsToken);
      return;
    }
    const to = String(purchaseInvoice.address || '').trim();
    const amountSats = Math.round(Number(purchaseInvoice.amountSats));
    if (!to || !Number.isFinite(amountSats) || amountSats <= 0) {
      setPurchaseError(dv.payment.invalidInvoice);
      return;
    }
    if (typeof props.onClaimPurchase !== 'function') {
      setPurchaseError(dv.purchase.unavailable);
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
        throw new Error((res && res.message) || dv.payment.noTxid);
      }
      setPurchaseTxid(txid);
      setPurchaseBusy(true);
      const out = await Promise.resolve(props.onClaimPurchase(id, txid));
      if (out && out.document) {
        setPurchasedContent(out.document);
      } else {
        setPurchaseError((out && out.error) || dv.purchase.claimFailedAfterPay);
      }
    } catch (err) {
      setPurchaseError((err && err.message) ? err.message : String(err));
    } finally {
      setPurchaseBusy(false);
      setPurchaseBridgeBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseInvoice, id, props.onClaimPurchase, props.adminToken, props.hasDocumentKey, upstreamSettings]);

  const av = dv.availability;
  const dd = dv.distribute;
  const dp = dv.purchase;
  const headingText = doc ? (doc.name || id) : dv.headingFallback;
  const explorerOffTitle = av.explorerOff;
  const identityMode = classifyHubBrowserIdentity(props.identity || {});
  const identityHint = fabricIdentityNeedFullKeyPlain(props.identity || {});
  const identityTitle = identityMode === 'watch_only'
    ? dv.identityTitle.watchOnly
    : identityMode === 'password_locked'
      ? dv.identityTitle.locked
      : dv.identityTitle.none;
  const txLink = (txid, text) => (uf.bitcoinExplorer ? (
    <Link to={`/services/bitcoin/transactions/${encodeURIComponent(txid)}`}>
      {text}
    </Link>
  ) : (
    <code style={{ fontSize: '0.85em', wordBreak: 'break-all' }} title={explorerOffTitle}>
      {txid}
    </code>
  ));

  return (
    <fabric-document-detail class='fade-in'>
      <Segment>
        <div
          style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75em', flexWrap: 'wrap', marginBottom: '0.25em' }}
          role="banner"
        >
          <Button basic size="small" as={Link} to="/documents">
            <Icon name="arrow left" aria-hidden="true" />
            {dv.backToList}
          </Button>
          <Header
            as="h2"
            style={{ margin: 0, flex: '1 1 10rem', display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}
          >
            <Header.Content style={{ wordBreak: 'break-word' }}>
              {headingText}
              {!doc && id ? (
                <Header.Subheader style={{ wordBreak: 'break-all', color: '#888' }}>
                  <code>{id}</code>
                </Header.Subheader>
              ) : null}
            </Header.Content>
            {isEncrypted && (
              <Label size="small" color="green" title={dv.labels.encryptedTitle}>
                <Icon name="lock" aria-hidden="true" />
                {dv.labels.encrypted}
              </Label>
            )}
            {doc && isPublishedInStore && (
              <Label size="small" color="blue" title={publishedAt ? dv.labels.publishedAt(publishedAt) : dv.labels.published}>
                <Icon name="bullhorn" aria-hidden="true" />
                {dv.labels.published}
              </Label>
            )}
            {doc && doc.source === 'peer' && !isPublishedInStore && (
              <Label size="small" color="teal" title={dv.labels.peerOfferTitle}>
                <Icon name="share alternate" aria-hidden="true" />
                {dv.labels.peerOffer}
              </Label>
            )}
            {storageContractId && (
              <Label
                size="small"
                color="purple"
                title={dv.labels.distributedTitle}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  if (storageContractId) {
                    navigate(`/contracts/${encodeURIComponent(storageContractId)}`);
                  }
                }}
              >
                <Icon name="cloud" aria-hidden="true" />
                {dv.labels.distributed}
              </Label>
            )}
          </Header>
        </div>

        <Divider />

        {doc && (
          <Message info style={{ marginBottom: '1.25em' }}>
            <Message.Header>{av.title}</Message.Header>
            <p style={{ marginBottom: '0.75em', color: 'rgba(0,0,0,0.7)' }}>
              {av.intro}
              {distributeEnabled ? <>{' '}{av.introDistribute}</> : null}
            </p>
            <List relaxed>
              <List.Item>
                <List.Icon name="hdd" color="grey" verticalAlign="middle" />
                <List.Content>
                  <List.Header>{av.localTitle}</List.Header>
                  <List.Description>
                    {av.local(doc.sha256 ? String(doc.sha256).slice(0, 16) : '')}
                  </List.Description>
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Icon name="bullhorn" color={isPublishedInStore ? 'blue' : 'grey'} verticalAlign="middle" />
                <List.Content>
                  <List.Header>{av.publishedTitle}</List.Header>
                  <List.Description>
                    {isPublishedInStore
                      ? (publishedAt
                        ? av.publishedSince(publishedAt, fabricPeerId ? shortHexId(fabricPeerId) : '')
                        : av.publishedListed(fabricPeerId ? shortHexId(fabricPeerId) : ''))
                      : av.notPublished}
                  </List.Description>
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Icon name="cloud" color={storageContractId ? 'purple' : 'grey'} verticalAlign="middle" />
                <List.Content>
                  <List.Header>{av.storageTitle}</List.Header>
                  <List.Description>
                    {storageContractId ? (
                      <span>
                        {av.activeContract}{' '}
                        <code style={{ cursor: 'pointer', textDecoration: 'underline' }} role="button" tabIndex={0}
                          onClick={() => navigate(`/contracts/${encodeURIComponent(storageContractId)}`)}
                          onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/contracts/${encodeURIComponent(storageContractId)}`); }}
                        >
                          {String(storageContractId).slice(0, 12)}…
                        </code>
                        {' '}{av.activeContractSuffix}
                        {contractPayTx && (
                          <div style={{ marginTop: '0.5em' }}>
                            {contractPayTx.loading && (
                              <span style={{ color: '#666', fontSize: '0.92em' }}>{av.checkingPayment}</span>
                            )}
                            {!contractPayTx.loading && contractPayTx.txid && contractPayTx.tx
                              && (contractPayTx.tx.blockhash == null || contractPayTx.tx.blockhash === '')
                              && Number(contractPayTx.tx.confirmations || 0) === 0 && (
                              <div style={{ fontSize: '0.92em' }}>
                                <Label size="small" color="orange">
                                  <Icon name="clock" />
                                  {av.unconfirmed}
                                </Label>
                                {' '}
                                {txLink(contractPayTx.txid, av.paymentTx)}
                                <span style={{ color: '#666' }}> {av.awaitingConfirmation}</span>
                              </div>
                            )}
                            {!contractPayTx.loading && contractPayTx.txid && contractPayTx.tx
                              && contractPayTx.tx.confirmations != null && Number(contractPayTx.tx.confirmations) > 0 && (
                              <div style={{ fontSize: '0.92em' }}>
                                <Label size="small" color="green">
                                  <Icon name="check" />
                                  {av.confirmations(Number(contractPayTx.tx.confirmations))}
                                </Label>
                                {' '}
                                {txLink(contractPayTx.txid, av.viewPaymentTx)}
                              </div>
                            )}
                            {!contractPayTx.loading && contractPayTx.error && contractPayTx.txid && (
                              <div style={{ fontSize: '0.92em', color: '#666' }}>
                                {txLink(contractPayTx.txid, av.paymentTx)}
                                <span> — {contractPayTx.error}</span>
                              </div>
                            )}
                            {!contractPayTx.loading && contractPayTx.error && !contractPayTx.txid && (
                              <span style={{ fontSize: '0.92em', color: '#888' }}>{contractPayTx.error}</span>
                            )}
                            {!contractPayTx.loading && contractPayTx.txid === null && !contractPayTx.error && (
                              <span style={{ fontSize: '0.92em', color: '#888' }}>{av.noPaymentTx}</span>
                            )}
                          </div>
                        )}
                      </span>
                    ) : (
                      distributeEnabled ? av.noContractDistribute : av.noContract
                    )}
                  </List.Description>
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Icon name="bitcoin" color={docPurchasePriceSats > 0 ? 'orange' : 'grey'} verticalAlign="middle" />
                <List.Content>
                  <List.Header>{av.priceTitle}</List.Header>
                  <List.Description>
                    {docPurchasePriceSats > 0
                      ? av.price(tc.sats(docPurchasePriceSats))
                      : av.free}
                  </List.Description>
                </List.Content>
              </List.Item>
            </List>
            <details className="hub-developer-details" style={{ fontSize: '0.9em', color: '#666' }}>
              <summary>{tc.developerDetails}</summary>
              {av.devPricing}
            </details>
          </Message>
        )}

        {doc && FabricDocumentRecord.recordFromHubDocument(doc) && (
          <Segment>
            <Header as="h3">
              <Icon name="sitemap" />
              {dv.pieces.title}
            </Header>
            <p style={{ color: '#666', marginTop: 0 }}>
              {dv.pieces.intro}
            </p>
            <FabricDocumentRecord document={doc} />
            <Button
              size="mini"
              basic
              style={{ marginTop: '0.75em' }}
              title={dv.pieces.agentButtonTitle}
              onClick={async () => {
                const record = FabricDocumentRecord.recordFromHubDocument(doc);
                const token = getAdminTokenFromProps(props);
                if (!token) {
                  setAgentNotice(dv.pieces.agentNeedsToken);
                  return;
                }
                try {
                  const r = await fetch('/services/market/agent/wants', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ documentId: record.documentId, merkleRootHex: record.merkleRootHex, blobTotal: record.blobTotal })
                  });
                  const j = await r.json().catch(() => ({}));
                  if (r.status === 503) throw new Error(dv.pieces.agentDisabled);
                  if (!r.ok) throw new Error(j.error || dv.pieces.agentRefused);
                  setAgentNotice(dv.pieces.agentQueued(record.blobTotal));
                } catch (e) {
                  setAgentNotice(e.message);
                }
              }}
            >
              {dv.pieces.agentButton}
            </Button>
            {agentNotice && <p style={{ color: '#666', marginTop: '0.5em' }}>{agentNotice}</p>}
          </Segment>
        )}

        {doc && Array.isArray(doc.offers) && doc.offers.length > 0 && (
          <Segment>
            <Header as="h3">
              <Icon name="exchange" />
              {dv.offers.title}
            </Header>
            <p style={{ color: '#666', marginTop: 0 }}>
              {dv.offers.intro}
            </p>
            {doc.costBasisSats != null && (
              <p style={{ margin: '0 0 0.75em' }}>
                {dv.offers.costBasis} <strong>{tc.sats(doc.costBasisSats)}</strong>
                {docPurchasePriceSats > 0 ? ` · ${dv.offers.listedAt(tc.sats(docPurchasePriceSats))}` : ''}
              </p>
            )}
            <List divided relaxed>
              {doc.offers.map((offer, idx) => {
                const key = offer.id || `${offer.peerPubkey || offer.peerAddress || 'peer'}-${idx}`;
                const who = offer.local
                  ? (offer.peerAlias || dv.offers.thisHub)
                  : (offer.peerAlias || (offer.peerPubkey
                    ? `${String(offer.peerPubkey).slice(0, 8)}…${String(offer.peerPubkey).slice(-4)}`
                    : (offer.peerAddress || dv.offers.unknownPeer)));
                const offerSats = offer.purchasePriceSats != null ? Number(offer.purchasePriceSats) : null;
                return (
                  <List.Item key={key}>
                    <List.Icon name={offer.local ? 'home' : 'share alternate'} color={offer.local ? 'blue' : 'teal'} />
                    <List.Content>
                      <List.Header>
                        {who}
                        {idx === 0 ? (
                          <Label size="mini" color="olive" style={{ marginLeft: '0.5em' }}>{dv.offers.lowest}</Label>
                        ) : null}
                        {offer.local ? (
                          <Label size="mini" style={{ marginLeft: '0.35em' }}>{dv.offers.local}</Label>
                        ) : null}
                      </List.Header>
                      <List.Description>
                        {offerSats != null && Number.isFinite(offerSats)
                          ? (offerSats === 0 ? dv.offers.free : tc.sats(offerSats))
                          : dv.offers.noPrice}
                        {offer.peerAddress ? ` · ${offer.peerAddress}` : ''}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                );
              })}
            </List>
          </Segment>
        )}

        {doc && (
        <Card fluid>
          <Card.Content>
            <Card.Header>{dv.details.title}</Card.Header>
          <Card.Meta>{created}</Card.Meta>
            <Card.Description>
              <div><strong>{dv.details.id}</strong> <code>{id}</code></div>
              <div title={dv.details.authorTitle}>
                <strong>{dv.details.author}</strong> <code>{authorDocId || tc.none}</code>
              </div>
              <div title={dv.details.publisherTitle}>
                <strong>{dv.details.publisher}</strong>{' '}
                {isPublishedInStore && fabricPeerId
                  ? <code>{fabricPeerId}</code>
                  : <span style={{ color: '#888' }}>{dv.details.publisherNone}</span>}
              </div>
              <div><strong>{dv.details.type}</strong> {mime}</div>
              <div><strong>{dv.details.size}</strong> {doc && doc.size != null ? dv.details.sizeBytes(doc.size) : ''}</div>
              {isHtlcPendingDecrypt && (
                <Message info style={{ marginTop: '0.75em' }}>
                  <Message.Header>{dv.keyUnlock.title}</Message.Header>
                  <p style={{ margin: '0.5em 0 0.75em', fontSize: '0.95em' }}>
                    {dv.keyUnlock.body}
                  </p>
                  {doc.htlcPaymentHashHex && (
                    <div style={{ fontSize: '0.88em', marginBottom: '0.5em', wordBreak: 'break-all' }}>
                      <strong>{dv.keyUnlock.paymentHash}</strong> <code>{doc.htlcPaymentHashHex}</code>
                    </div>
                  )}
                  <label htmlFor="document-unlock-key" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35em' }}>
                    {dv.keyUnlock.keyLabel}
                  </label>
                  <Input
                    fluid
                    id="document-unlock-key"
                    placeholder={dv.keyUnlock.keyPlaceholder}
                    value={htlcPreimageHex}
                    onChange={(e, d) => setHtlcPreimageHex((d && d.value) != null ? d.value : e.target.value)}
                    style={{ marginBottom: '0.5em' }}
                  />
                  <Button
                    size="small"
                    primary
                    loading={htlcUnlockBusy}
                    disabled={!TXID_HEX_64.test(htlcPreimageHex.trim())}
                    title={dv.keyUnlock.buttonTitle}
                    onClick={handleHtlcPreimageUnlock}
                  >
                    <Icon name="key" />
                    {dv.keyUnlock.button}
                  </Button>
                  {htlcUnlockError && (
                    <div style={{ marginTop: '0.5em', color: '#9f3a38', fontSize: '0.9em' }} role="alert">{htlcUnlockError}</div>
                  )}
                  <details className="hub-developer-details" style={{ marginTop: '0.75em', fontSize: '0.9em', color: '#666' }}>
                    <summary>{tc.developerDetails}</summary>
                    <p style={{ margin: '0.35em 0' }}>{dv.keyUnlock.devIntro}</p>
                    <ul style={{ margin: '0 0 0.5em 1.25em', padding: 0 }}>
                      <li>{dv.keyUnlock.devSealed}</li>
                      <li>{dv.keyUnlock.devLegacy}</li>
                    </ul>
                    <p style={{ margin: 0 }}>{dv.keyUnlock.devHelpers}</p>
                  </details>
                </Message>
              )}
              {isEncrypted && !contentBase64 && (
                <div style={{ marginTop: '0.5em' }}>
                  <Button size="small" onClick={handleUnlock}>
                    <Icon name="unlock" />
                    {dv.contents.decrypt}
                  </Button>
                </div>
              )}
              {needsIdentityUnlock && (
                <Message info size="small" style={{ marginTop: '0.75em' }}>
                  <Message.Header>
                    {identityMode === 'watch_only'
                      ? dv.identity.titleWatchOnly
                      : identityMode === 'password_locked'
                        ? dv.identity.titleLocked
                        : dv.identity.titleNone}
                  </Message.Header>
                  <p style={{ margin: '0.35em 0 0.5em', fontSize: '0.95em' }}>
                    {identityHint} {dv.identity.signed}
                    {needsIdentityKeyForEncryptedBody ? ` ${dv.identity.encrypted}` : ''}
                  </p>
                  <p style={{ margin: '0 0 0.5em', fontSize: '0.95em' }}>
                    {dv.identity.payments}{' '}
                    <Link to="/settings/bitcoin-wallet">{dv.identity.walletLink}</Link> {dv.identity.walletSuffix}
                  </p>
                  {typeof props.onRequestUnlock === 'function' && (
                    <Button size="small" type="button" onClick={() => props.onRequestUnlock()}>
                      <Icon name="key" />
                      {identityMode === 'watch_only'
                        ? dv.identity.buttonWatchOnly
                        : identityMode === 'password_locked'
                          ? dv.identity.buttonLocked
                          : dv.identity.buttonNone}
                    </Button>
                  )}
                  <details className="hub-developer-details" style={{ marginTop: '0.5em', fontSize: '0.9em', color: '#666' }}>
                    <summary>{tc.developerDetails}</summary>
                    {dv.identity.devSigning}
                  </details>
                </Message>
              )}
            </Card.Description>
          </Card.Content>
          <Card.Content extra>
            <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
              <Button
                size="small"
                basic
                icon
                labelPosition="left"
                onClick={() => typeof props.onGetDocument === 'function' && props.onGetDocument(id)}
              >
                <Icon name="refresh" />
                {tc.actions.refresh}
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
                    ? identityHint
                    : (doc && isPublishedInStore ? dv.actions.publishedTitle : dv.actions.publishTitle)
                }
              >
                <Icon
                  name={isPublishing ? 'spinner' : (doc && isPublishedInStore ? 'check' : 'bullhorn')}
                  loading={isPublishing}
                />
                {isPublishing ? dv.actions.publishing : (doc && isPublishedInStore ? dv.actions.published : dv.actions.publish)}
              </Button>
              {!isPublishedInStore && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em' }}>
                  <label htmlFor="document-publish-price" style={{ fontSize: '0.9em', color: '#555' }}>
                    {dv.actions.priceLabel}
                  </label>
                  <Input
                    id="document-publish-price"
                    type="number"
                    min="0"
                    value={publishPriceSats}
                    onChange={(e) => setPublishPriceSats(e.target.value)}
                    style={{ width: 110 }}
                    disabled={needsIdentityUnlock}
                    title={needsIdentityUnlock ? identityHint : dv.actions.priceTitle(DEFAULT_PUBLISH_PRICE_SATS)}
                  />
                </span>
              )}
              {canPurchase && documentPurchaseEnabled && (
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
                  title={needsIdentityUnlock ? identityHint : dv.actions.buyTitle}
                >
                  <Icon name="bitcoin" />
                  {dv.actions.buy(tc.sats(docPurchasePriceSats))}
                </Button>
              )}
              {distributeEnabled || storageContractId ? (
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
                    if (!distributeEnabled) return;
                    if (id) {
                      setDistributeError(null);
                      setDistributeOpen(true);
                    }
                  }}
                  disabled={!id || needsIdentityUnlock || (!storageContractId && !distributeEnabled)}
                  title={
                    needsIdentityUnlock
                      ? identityHint
                      : (storageContractId ? dv.actions.viewContractTitle : dv.actions.distributeTitle)
                  }
                >
                  <Icon name={storageContractId ? 'cloud' : 'cloud upload'} />
                  {storageContractId ? dv.actions.distributed : dv.actions.distribute}
                </Button>
              ) : null}
              <Button
                size="small"
                basic
                icon
                labelPosition="left"
                onClick={() => id && setShareOpen(true)}
                disabled={!id}
                title={dv.actions.shareTitle}
              >
                <Icon name="share alternate" />
                {dv.actions.share}
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
                  title={needsIdentityUnlock ? identityHint : dv.actions.unpublishTitle}
                >
                  <Icon name="trash" />
                  {dv.actions.unpublish}
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
                  {dv.actions.download}
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
                <Message.Header>{dv.actions.publishErrorTitle}</Message.Header>
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
          <Header icon="share alternate" content={dv.share.title} />
          <Modal.Content>
            <p style={{ color: '#666' }}>
              {dv.share.body}
            </p>
            <label htmlFor="document-share-link" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35em' }}>
              {dv.share.linkLabel}
            </label>
            <Input
              fluid
              readOnly
              id="document-share-link"
              value={shareUrlHash}
              onFocus={(e) => e.target.select()}
              action={{
                icon: 'copy',
                title: dv.share.copy,
                'aria-label': dv.share.copy,
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
                {dv.share.permanent} <code>{shareUrlCanonical}</code>
              </p>
            )}
          </Modal.Content>
          <Modal.Actions>
            <Button basic onClick={() => setShareOpen(false)}>
              {tc.actions.close}
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
          <Header icon="trash" content={dv.unpublish.title} />
          <Modal.Content>
            <p style={{ color: '#666' }}>
              {dv.unpublish.body}
            </p>
            <p style={{ color: '#666' }}>
              <strong>{dv.unpublish.documentId}</strong> <code>{id}</code>
            </p>
            <details className="hub-developer-details" style={{ fontSize: '0.9em', color: '#666', marginBottom: '0.75em' }}>
              <summary>{tc.developerDetails}</summary>
              {dv.unpublish.devTombstone}
            </details>
            {tombstoneError && (
              <Message negative size="small">
                <p>{tombstoneError}</p>
              </Message>
            )}
          </Modal.Content>
          <Modal.Actions>
            <Button type="button" basic onClick={() => { if (!tombstoneBusy) { setTombstoneOpen(false); setTombstoneError(null); } }}>
              {tc.actions.cancel}
            </Button>
            <Button
              type="button"
              negative
              loading={tombstoneBusy}
              disabled={tombstoneBusy}
              onClick={handleConfirmTombstone}
            >
              <Icon name="trash" />
              {dv.unpublish.confirm}
            </Button>
          </Modal.Actions>
        </Modal>

        <Modal
          size="small"
          open={distributeEnabled && distributeOpen}
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
          <Header icon="cloud upload" content={dd.title} />
          <Modal.Content>
            <p style={{ color: '#666' }}>
              {dd.intro}
            </p>
            {needsIdentityUnlock && (
              <Message warning size="small" style={{ marginBottom: '1em' }}>
                <Message.Header>{identityTitle}</Message.Header>
                <p style={{ margin: '0.35em 0 0', color: '#333' }}>
                  {identityHint} {dd.needKeyThen}
                </p>
              </Message>
            )}
            {!!props.hasDocumentKey && distributeModalNoLocalWire && (
              <Message warning size="small" style={{ marginBottom: '1em' }}>
                <Message.Header>{dd.noLocalKeyTitle}</Message.Header>
                <p style={{ margin: '0.35em 0 0', color: '#333' }}>
                  {dd.noLocalKeyBody}{' '}
                  <Link to="/settings/security">{dd.securityLink}</Link>.
                </p>
              </Message>
            )}
            {/* Step indicator: 1 Request invoice, 2 Pay, 3 Confirm / Success */}
            <div style={{ display: 'flex', gap: '0.5em', marginBottom: '1em', flexWrap: 'wrap' }}>
              <Label
                color={!distributeInvoice && !distributeSuccessContractId ? 'blue' : 'grey'}
                size="small"
              >
                {dd.steps.request}
              </Label>
              <Label
                color={distributeInvoice && !distributeSuccessContractId ? 'blue' : 'grey'}
                size="small"
              >
                {dd.steps.pay}
              </Label>
              <Label
                color={distributeSuccessContractId ? 'green' : 'grey'}
                size="small"
              >
                {distributeSuccessContractId ? dd.steps.done : dd.steps.confirm}
              </Label>
            </div>
            {distributeSuccessContractId ? (
              <Segment color="green" style={{ textAlign: 'center' }}>
                <Icon name="check circle" size="big" color="green" />
                <Header as="h4" style={{ marginTop: '0.5em' }}>
                  {dd.successTitle}
                </Header>
                <p style={{ color: '#666', marginBottom: '1em' }}>
                  {dd.successBody}
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
                  {dd.viewContract}
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
                    setDistributeError(dd.amountInvalid);
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
                    setDistributeError(dd.unavailable);
                    setDistributeBusy(false);
                  }
                }}
              >
                <Form.Field>
                  <label htmlFor="document-distribute-amount">{dd.amountLabel}</label>
                  <Input
                    id="document-distribute-amount"
                    type="number"
                    min="1"
                    placeholder={dd.amountPlaceholder}
                    value={distributeAmountSats}
                    onChange={(e) => setDistributeAmountSats(e.target.value)}
                  />
                </Form.Field>
                <Form.Field>
                  <label htmlFor="document-distribute-copies">{dd.copiesLabel}</label>
                  <Input
                    id="document-distribute-copies"
                    type="number"
                    min="1"
                    max="100"
                    value={distributeDesiredCopies}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v) && v >= 1) setDistributeDesiredCopies(v);
                    }}
                  />
                </Form.Field>
                <Form.Field>
                  <label htmlFor="document-distribute-duration">{dd.durationLabel}</label>
                  <Input
                    id="document-distribute-duration"
                    type="number"
                    min="1"
                    max="10"
                    value={distributeDurationYears}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v)) setDistributeDurationYears(v);
                    }}
                    label={{ basic: true, content: dd.years }}
                    labelPosition="right"
                  />
                </Form.Field>
                <Form.Field>
                  <label id="document-distribute-cadence-label">{dd.cadenceLabel}</label>
                  <Dropdown
                    selection
                    aria-labelledby="document-distribute-cadence-label"
                    options={cadenceOptions}
                    value={distributeCadence}
                    onChange={(_, data) => setDistributeCadence(data.value)}
                  />
                </Form.Field>
                <Form.Field>
                  <label id="document-distribute-deadline-label">{dd.deadlineLabel}</label>
                  <Dropdown
                    selection
                    aria-labelledby="document-distribute-deadline-label"
                    options={deadlineOptions}
                    value={distributeDeadline}
                    onChange={(_, data) => setDistributeDeadline(data.value)}
                  />
                </Form.Field>
                <Divider section />
                <Message info size="small">
                  <Message.Header>{dd.peerTitle}</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#333' }}>
                    {dd.peerBody}{' '}
                    <Link to="/documents">{dd.peerBodyLink}</Link>.
                    {' '}{dd.peerBodyAfter}
                  </p>
                  {fabricPeerDropdownOptions.length === 0 ? (
                    <p style={{ margin: '0.75em 0 0', color: '#666' }}>
                      {dd.noPeersBefore}{' '}
                      <Link to="/peers">{dd.noPeersLink}</Link>.
                    </p>
                  ) : (
                    <>
                      <Form.Field style={{ marginTop: '0.75em' }}>
                        <label id="document-distribute-peer-label">{dd.peerLabel}</label>
                        <Dropdown
                          aria-labelledby="document-distribute-peer-label"
                          placeholder={dd.peerPlaceholder}
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
                            setPeerOfferError(dd.offerAmountInvalid);
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
                        {dd.sendOffer}
                      </Button>
                      {typeof props.onSendDistributeProposal !== 'function' && (
                        <p style={{ marginTop: '0.5em', color: '#888', fontSize: '0.9em' }}>
                          {dd.offerUnavailable}
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
                  <p style={{ marginTop: '0.75em', color: '#b00' }} role="alert">
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
                  label={dd.invoiceLabel}
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
                            (err && err.message) ? err.message : dd.failed
                          );
                        });
                    }
                  }}
                />
                {hubAdminTokenPresent && (
                  <div style={{ marginTop: '1em' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75em', alignItems: 'center' }}>
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
                        title={dd.payFromHubTitle}
                      >
                        <Icon name="server" />
                        {dd.payFromHub}
                      </Button>
                      <span style={{ color: '#666', fontSize: '0.9em', maxWidth: '28em' }}>
                        {dd.payFromHubNote}
                      </span>
                    </div>
                    <details className="hub-developer-details" style={{ marginTop: '0.5em', fontSize: '0.85em', color: '#666' }}>
                      <summary>{tc.developerDetails}</summary>
                      {dd.devPayFromHub}
                    </details>
                  </div>
                )}
                {distributeError && (
                  <Message negative size="small" style={{ marginTop: '1em' }} content={distributeError} />
                )}
                <Form.Field style={{ marginTop: '1em' }}>
                  <label htmlFor="document-distribute-txid">{dd.pasteTxidLabel}</label>
                  <Input
                    fluid
                    id="document-distribute-txid"
                    placeholder={dd.txidPlaceholder}
                    value={distributeTxid}
                    onChange={(e) => setDistributeTxid(e.target.value)}
                  />
                </Form.Field>
                {TXID_HEX_64.test(String(distributeTxid || '').trim()) && (
                  <div style={{ marginTop: '0.5em', fontSize: '0.9em' }}>
                    {txLink(String(distributeTxid).trim(), dd.openTx)}
                    <span style={{ color: '#666' }}>
                      {' '}{dd.mempoolNote}
                    </span>
                    {distributeTxChain && !distributeSuccessContractId && (
                      <div style={{ marginTop: '0.35em', color: '#555' }}>
                        {distributeTxChain.loading && <span>{dd.checking}</span>}
                        {!distributeTxChain.loading && distributeTxChain.tx
                          && (distributeTxChain.tx.blockhash == null || distributeTxChain.tx.blockhash === '')
                          && Number(distributeTxChain.tx.confirmations || 0) === 0 && (
                          <span><strong>{dd.unconfirmed}</strong> {dd.zeroConfirmations}</span>
                        )}
                        {!distributeTxChain.loading && distributeTxChain.tx
                          && Number(distributeTxChain.tx.confirmations || 0) > 0 && (
                          <span>{dd.confirmations(Number(distributeTxChain.tx.confirmations))}</span>
                        )}
                        {!distributeTxChain.loading && distributeTxChain.error && (
                          <span style={{ color: '#888' }}>{distributeTxChain.error}</span>
                        )}
                        {!distributeTxChain.loading && !distributeTxChain.tx && !distributeTxChain.error && (
                          <span style={{ color: '#888' }}>{dd.notSeen}</span>
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
              {distributeSuccessContractId ? tc.actions.close : tc.actions.cancel}
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
                {dd.viewContract}
              </Button>
            ) : !distributeInvoice ? (
              <Button
                primary
                type="submit"
                form="fabric-document-distribute-form"
                loading={distributeBusy}
                disabled={distributeBusy || peerOfferBusy || needsIdentityUnlock}
                title={needsIdentityUnlock ? identityHint : undefined}
              >
                {dd.request}
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
                        (err && err.message) ? err.message : dd.failed
                      );
                    });
                  // Success: storageContractBonded will fire and set distributeSuccessContractId
                }}
              >
                {dd.confirm}
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
          <Header icon="bitcoin" content={dp.title} />
          <Modal.Content>
            <p style={{ color: '#666' }}>
              {dp.intro}
            </p>
            <details className="hub-developer-details" style={{ fontSize: '0.85em', color: '#666' }}>
              <summary>{tc.developerDetails}</summary>
              {dp.devIntro}
            </details>
            {needsIdentityUnlock && (
              <Message warning size="small" style={{ marginTop: '0.75em' }}>
                <Message.Header>{identityTitle}</Message.Header>
                <p style={{ margin: '0.35em 0 0' }}>{identityHint} {dp.needKeyThen}</p>
              </Message>
            )}
            <p style={{ color: '#888', fontSize: '0.9em', marginTop: '0.35em' }}>
              {dp.confirmHelp}{' '}{dp.regtestBefore}{' '}
              <Link to="/services/bitcoin">{dp.regtestLink}</Link>.
              {uf.bitcoinResources ? (
                <>
                  {' '}{dp.resourcesBefore}{' '}
                  <Link to="/services/bitcoin/resources">{dp.resourcesLink}</Link>.
                </>
              ) : (
                <>
                  {' '}{dp.resourcesOff}
                </>
              )}
            </p>
            {purchasedContent ? (
              <Segment color="green">
                <Icon name="check circle" size="big" color="green" />
                <Header as="h4" style={{ marginTop: '0.5em' }}>{dp.successTitle}</Header>
                <p style={{ color: '#666', marginBottom: '1em' }}>{dp.successBody}</p>
                <Button
                  primary
                  as="a"
                  href={`data:${purchasedContent.mime || 'application/octet-stream'};base64,${purchasedContent.contentBase64}`}
                  download={purchasedContent.name || 'document'}
                >
                  <Icon name="download" />
                  {dp.download}
                </Button>
              </Segment>
            ) : !purchaseInvoice ? (
              <div style={{ marginTop: '0.5em' }}>
                {!purchaseError && <p style={{ color: '#888' }}>{dp.requesting}</p>}
                {purchaseError && (
                  <>
                    <Message negative>{purchaseError}</Message>
                    <p style={{ color: '#666', fontSize: '0.9em', marginTop: '0.75em' }}>
                      {dp.errorHelpBefore}{' '}
                      <Link to="/services/bitcoin">{dp.errorHelpLink}</Link>
                      {' '}{dp.errorHelpAfter}
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
                  label={dp.invoiceLabel}
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
                            setPurchaseError((res && res.error) || dp.claimFailed);
                          }
                        })
                        .catch((err) => setPurchaseError(err && err.message ? err.message : String(err)))
                        .finally(() => setPurchaseBusy(false));
                    }
                  }}
                />
                {hubAdminTokenPresent && (
                  <div style={{ marginTop: '1em' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75em', alignItems: 'center' }}>
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
                        title={dp.payFromHubTitle}
                      >
                        <Icon name="server" />
                        {dp.payFromHub}
                      </Button>
                      <span style={{ color: '#666', fontSize: '0.9em', maxWidth: '28em' }}>
                        {dp.payFromHubNote}
                      </span>
                    </div>
                    <details className="hub-developer-details" style={{ marginTop: '0.5em', fontSize: '0.85em', color: '#666' }}>
                      <summary>{tc.developerDetails}</summary>
                      {dp.devPayFromHub}
                    </details>
                  </div>
                )}
                <Form.Field style={{ marginTop: '1em' }}>
                  <label htmlFor="document-purchase-txid">{dp.pasteTxidLabel}</label>
                  <Input
                    fluid
                    id="document-purchase-txid"
                    placeholder={dp.txidPlaceholder}
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
              {purchasedContent ? tc.actions.close : tc.actions.cancel}
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
                      else setPurchaseError((res && res.error) || dp.claimFailed);
                    })
                    .catch((err) => setPurchaseError(err && err.message ? err.message : String(err)))
                    .finally(() => setPurchaseBusy(false));
                }}
              >
                {dp.claim}
              </Button>
            )}
          </Modal.Actions>
        </Modal>

        {!doc && loadError && (
          <Message negative style={{ marginTop: '1em' }}>
            <Message.Header>{dv.load.errorTitle}</Message.Header>
            <p>{loadError}</p>
            <Button as={Link} to="/documents" style={{ marginTop: '0.75em' }}>
              <Icon name="arrow left" aria-hidden="true" />
              {dv.backToList}
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
              {tc.actions.retry}
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
                {dv.load.title}
                <Header.Subheader>
                  {dv.load.subtitle}
                </Header.Subheader>
              </Header>
            </div>
          </Segment>
        )}

        {doc && isEncrypted && !contentBase64 && (
          <Segment secondary style={{ marginTop: '1em' }}>
            <Header as="h3">{dv.contents.title}</Header>
            <p style={{ color: '#666' }}>
              {props.hasDocumentKey
                ? dv.contents.encryptedWithKey
                : dv.contents.encryptedNoKey(identityHint)}
            </p>
          </Segment>
        )}

        {doc && imageSrc && (
          <Segment style={{ marginTop: '1em' }}>
            <Header as="h3">{dv.contents.preview}</Header>
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
            <Header as="h3">{dv.contents.title}</Header>
            {showGraphPreview ? (
              <>
                <GraphDocumentPreview dotSource={text} hasDocumentKey={props.hasDocumentKey} />
                <details style={{ marginTop: '0.75rem' }}>
                  <summary style={{ cursor: 'pointer', color: '#555' }}>{dv.contents.dotSource}</summary>
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
            <Header as="h3">{dv.contents.title}</Header>
            <p style={{ color: '#666' }}>
              {dv.contents.noPreview}
            </p>
          </Segment>
        )}
      </Segment>
    </fabric-document-detail>
  );
}

module.exports = DocumentDetail;
