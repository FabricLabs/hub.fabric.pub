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
  Loader,
  Modal,
  Input,
  Segment,
  Form,
  Dropdown
} = require('semantic-ui-react');
const Invoice = require('./Invoice');

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

  const [publishPriceSats, setPublishPriceSats] = React.useState('');
  const [purchaseOpen, setPurchaseOpen] = React.useState(false);
  const [purchaseInvoice, setPurchaseInvoice] = React.useState(null);
  const [purchaseTxid, setPurchaseTxid] = React.useState('');
  const [purchaseBusy, setPurchaseBusy] = React.useState(false);
  const [purchaseError, setPurchaseError] = React.useState(null);
  const [purchasedContent, setPurchasedContent] = React.useState(null);

  React.useEffect(() => {
    if (typeof props.onGetDocument === 'function' && id) props.onGetDocument(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Listen for pay-to-distribute invoice; show payment step when it matches this document
  React.useEffect(() => {
    const handler = (e) => {
      const detail = e && e.detail;
      if (!detail || !detail.documentId) return;
      const docId = detail.documentId;
      const sha = doc && doc.sha256;
      const match = docId === id || docId === sha;
      if (match) {
        setDistributeInvoice({
          address: detail.address,
          amountSats: detail.amountSats,
          config: detail.config,
          network: detail.network
        });
        setDistributeTxid('');
      }
    };
    window.addEventListener('distributeInvoiceReady', handler);
    return () => window.removeEventListener('distributeInvoiceReady', handler);
  }, [id, doc]);

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

  // Timeout fallback if storageContractBonded never arrives
  React.useEffect(() => {
    if (!distributeBusy || distributeSuccessContractId) return;
    const timeout = setTimeout(() => {
      setDistributeBusy(false);
      setDistributeError('Contract creation is taking longer than expected. Check the contract list or try again.');
    }, 15000);
    return () => clearTimeout(timeout);
  }, [distributeBusy, distributeSuccessContractId]);

  // Listen for HTLC purchase invoice
  React.useEffect(() => {
    const handler = (e) => {
      const detail = e && e.detail;
      if (!detail || !detail.documentId) return;
      const docId = detail.documentId;
      const sha = doc && doc.sha256;
      const match = docId === id || docId === sha;
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

  const [, setNetworkTick] = React.useState(0);
  React.useEffect(() => {
    const handler = (event) => {
      const gs = event && event.detail && event.detail.globalState;
      if (!gs || !gs.documents) return;
      const candidate = gs.documents[id];
      if (candidate) {
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
  React.useEffect(() => {
    const handler = () => setNetworkTick((n) => n + 1);
    window.addEventListener('networkStatusUpdate', handler);
    return () => window.removeEventListener('networkStatusUpdate', handler);
  }, []);

  // On mount, hydrate from existing Bridge globalState so locally-added documents
  // are immediately visible without waiting for another event.
  React.useEffect(() => {
    try {
      const bridgeRef = props.bridgeRef;
      const current = bridgeRef && bridgeRef.current;
      if (!current || typeof current.getGlobalState !== 'function') return;
      const gs = current.getGlobalState();
      if (!gs || !gs.documents) return;
      const candidate = gs.documents[id];
      if (candidate) {
        setDoc(candidate);
        setDecryptedContent(null);
        setUnlocked(false);
      }
    } catch (e) {}
  }, [id, props.bridgeRef]);

  // Stop "publishing…" state once the document has a published timestamp,
  // or after a safety timeout if the hub reports an error.
  React.useEffect(() => {
    const pub = doc?.published || (props.bridgeRef?.current?.networkStatus?.publishedDocuments?.[doc?.id] || (doc?.sha256 && props.bridgeRef?.current?.networkStatus?.publishedDocuments?.[doc?.sha256]));
    if (doc && pub) {
      setIsPublishing(false);
      return;
    }
    if (!isPublishing) return;
    const timeout = setTimeout(() => {
      setIsPublishing(false);
    }, 10000);
    return () => clearTimeout(timeout);
  }, [doc, doc?.published, doc?.id, doc?.sha256, isPublishing, props.bridgeRef]);

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

  const isEncrypted = !!(doc && doc.contentEncrypted);
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

  // Never expose decrypted content when we don't currently have a document key,
  // even if contentBase64 is still present on the doc from a prior unlock.
  const rawContentBase64 = doc && (doc.contentBase64 || decryptedContent);
  const contentBase64 = props.hasDocumentKey ? rawContentBase64 : null;
  let downloadHref = null;
  if (contentBase64) {
    downloadHref = `data:${mime};base64,${contentBase64}`;
  }

  // Basic type helpers
  const looksText = (mime && mime.startsWith('text/')) || /\.(md|txt|json|js|ts|html|css|log)$/i.test(name || '');
  const looksImage = (mime && mime.startsWith('image/')) || /\.(png|jpe?g|gif|webp|svg)$/i.test(name || '');

  // Text preview (only when it looks like text)
  let text = null;
  if (contentBase64 && looksText && props.hasDocumentKey) {
    try {
      text = atob(contentBase64);
    } catch (e) {}
  }

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

  return (
    <fabric-document-detail class='fade-in'>
      <Segment>
        <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
          <Button basic size='small' as={Link} to="/documents" title="Back to documents">
            <Icon name="arrow left" />
            Back
          </Button>
          <span>{name}</span>
          {isEncrypted && (
            <Label size="small" color="green" title="Encrypted with your key">
              <Icon name="lock" />
              Encrypted
            </Label>
          )}
          {doc && isPublishedInStore && (
            <Label size="small" color="blue" title={publishedAt ? `Published: ${publishedAt}` : 'Published'}>
              <Icon name="bullhorn" />
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
              <Icon name="cloud" />
              Distributed
            </Label>
          )}
        </Header>

        <Divider />

        <Card fluid>
          <Card.Content>
            <Card.Header>Document</Card.Header>
          <Card.Meta>{created}</Card.Meta>
            <Card.Description>
              <div><strong>ID:</strong> <code>{id}</code></div>
              <div><strong>MIME:</strong> {mime}</div>
              <div><strong>Size:</strong> {doc && doc.size != null ? `${doc.size} bytes` : ''}</div>
              {isEncrypted && !contentBase64 && (
                <div style={{ marginTop: '0.5em' }}>
                  <Button size="small" onClick={handleUnlock} title="Decrypt and show content">
                    <Icon name="unlock" />
                    Unlock
                  </Button>
                </div>
              )}
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
                  setIsPublishing(true);
                  const price = parseInt(publishPriceSats, 10);
                  props.onPublishDocument(id, price > 0 ? { purchasePriceSats: price } : undefined);
                }}
                disabled={!doc || isPublishing || !!isPublishedInStore}
                title={doc && isPublishedInStore ? 'Document is published' : 'Publish this document ID to the hub global store'}
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
                  title="Optional: set purchase price when publishing (HTLC)"
                />
              )}
              {canPurchase && (
                <Button
                  size="small"
                  color="orange"
                  icon
                  labelPosition="left"
                  onClick={() => {
                    setPurchaseOpen(true);
                    setPurchaseInvoice(null);
                    setPurchaseTxid('');
                    setPurchaseError(null);
                    setPurchasedContent(null);
                    if (typeof props.onRequestPurchaseInvoice === 'function') {
                      props.onRequestPurchaseInvoice(id);
                    }
                  }}
                  title="Purchase this document (HTLC: pay to unlock with sha256(sha256(content)))"
                >
                  <Icon name="bitcoin" />
                  Purchase ({docPurchasePriceSats} sats)
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
                  if (id) setDistributeOpen(true);
                }}
                disabled={!id}
                title={storageContractId ? 'View storage contract' : 'Distribute this document across other nodes'}
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
          </Card.Content>
        </Card>

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
          open={distributeOpen}
          onClose={() => {
            if (distributeBusy) return;
            setDistributeOpen(false);
            setDistributeError(null);
            setDistributeInvoice(null);
            setDistributeTxid('');
            setDistributeSuccessContractId(null);
          }}
        >
          <Header icon="cloud upload" content="Pay to distribute" />
          <Modal.Content>
            <p style={{ color: '#666' }}>
              Pay Bitcoin (L1) to have other nodes store this document under a long-term contract.
              By default, storage is requested for 4 years with periodic random challenges.
            </p>
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
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!id || distributeBusy) return;
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
                    setDistributeBusy(false);
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
                <Form.Field style={{ marginTop: '1em' }}>
                  <label>Or paste txid (if you paid from an external wallet)</label>
                  <Input
                    placeholder="txid from your wallet"
                    value={distributeTxid}
                    onChange={(e) => setDistributeTxid(e.target.value)}
                  />
                </Form.Field>
              </>
            )}
          </Modal.Content>
          <Modal.Actions>
            <Button
              basic
              onClick={() => {
                if (distributeBusy) return;
                setDistributeOpen(false);
                setDistributeError(null);
                setDistributeInvoice(null);
                setDistributeTxid('');
                setDistributeSuccessContractId(null);
              }}
            >
              {distributeSuccessContractId ? 'Close' : distributeInvoice ? 'Back' : 'Cancel'}
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
                loading={distributeBusy}
                disabled={distributeBusy}
                onClick={() => {
                  const node = document && document.activeElement;
                  if (node && node.form) {
                    node.form.requestSubmit();
                  } else {
                    const form = document.querySelector('form');
                    if (form) form.requestSubmit();
                  }
                }}
              >
                Request invoice
              </Button>
            ) : (
              <Button
                primary
                loading={distributeBusy}
                disabled={!distributeTxid.trim() || distributeBusy}
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
            if (purchaseBusy) return;
            setPurchaseOpen(false);
            setPurchaseInvoice(null);
            setPurchaseTxid('');
            setPurchaseError(null);
            setPurchasedContent(null);
          }}
        >
          <Header icon="bitcoin" content="Purchase document (HTLC)" />
          <Modal.Content>
            <p style={{ color: '#666' }}>
              Pay Bitcoin to unlock this document. The content is locked with sha256(sha256(content)); payment verification unlocks delivery.
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
              <p style={{ color: '#888' }}>Requesting invoice…</p>
            ) : (
              <>
                <Invoice
                  address={purchaseInvoice.address}
                  amountSats={purchaseInvoice.amountSats}
                  network={purchaseInvoice.network}
                  label="Document purchase (HTLC)"
                  identity={props.identity || {}}
                  compact
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
            <Button basic onClick={() => { if (!purchaseBusy) setPurchaseOpen(false); setPurchaseInvoice(null); setPurchaseTxid(''); setPurchaseError(null); setPurchasedContent(null); }}>
              {purchasedContent ? 'Close' : 'Cancel'}
            </Button>
            {!purchasedContent && purchaseInvoice && (
              <Button
                primary
                loading={purchaseBusy}
                disabled={!purchaseTxid.trim() || purchaseBusy}
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

        {!doc && (
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
                : 'Encrypted. Unlock your identity to view this document.'}
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
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: '0.75em', borderRadius: 6, maxHeight: 520, overflow: 'auto' }}>
              {text}
            </pre>
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
