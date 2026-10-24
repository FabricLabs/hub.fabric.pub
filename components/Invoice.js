'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const QRCode = require('qrcode');
const {
  Button,
  Divider,
  Form,
  Header,
  Icon,
  Input,
  Message,
  Modal
} = require('semantic-ui-react');
const {
  loadUpstreamSettings,
  getSpendWalletContext,
  getNextReceiveWalletContext,
  sendPayment,
  verifyL1Payment,
  createPayjoinDeposit,
  encodeBitcoinUri
} = require('../functions/bitcoinClient');
const { SATS_PER_BTC } = require('../constants');
const { buildTabPayerPayjoinUrl } = require('../functions/tabPayerDemoUrl');
const {
  loadJoinmarketPoolSizesBtc,
  saveJoinmarketPoolSizesBtc,
  poolLabels,
  btcToSats,
  DEFAULT_POOLS_BTC
} = require('../functions/joinmarketPoolPreferences');
const { formatSatsDisplay, formatBtcFromSats } = require('../functions/formatSats');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const { classifyHubBrowserIdentity } = require('../functions/hubIdentityUiHints');
const t = require('../locales/en');

const L = t.payments.invoice;

function identityHowTo (identity) {
  const state = classifyHubBrowserIdentity(identity);
  if (state === 'password_locked') return t.common.identity.howToUnlock;
  if (state === 'watch_only') return t.common.identity.howToImport;
  return t.common.identity.howToLogIn;
}

// BitPay circa 2016: Bitcoin orange accent
const BITCOIN_ORANGE = '#F7931A';

/**
 * The Invoice component provides a payment UI with QR code, address, and amount.
 * Pay button creates a transaction from the Hub wallet via the payments API.
 *
 * @param {Object} props
 * @param {string} [props.invoiceId] - Invoice id (for persisting payments)
 * @param {string} props.address - Destination Bitcoin address
 * @param {number} props.amountSats - Amount in satoshis
 * @param {string} [props.network] - Network name (regtest, testnet, mainnet) for display
 * @param {string} [props.label] - Optional label for the invoice
 * @param {string} [props.memo] - Optional memo to include with the payment
 * @param {string[]} [props.txids] - Array of txids for payments received (persisted on invoice)
 * @param {Object} [props.identity] - Identity for wallet context (xpub); Hub uses its wallet for regtest
 * @param {function} [props.onPaid] - Callback on success: (txid) => void
 * @param {function} [props.onError] - Callback on error: (error) => void
 * @param {boolean} [props.compact] - Use compact layout (e.g. inline in modals)
 * @param {boolean} [props.requireUnlockedIdentityForHubPay] - When true, disable “Pay Now” until `identityUnlocked` (hub still broadcasts a real tx; operator session must be unlocked).
 * @param {boolean} [props.identityUnlocked] - Paired with `requireUnlockedIdentityForHubPay` (default true when not required).
 */
function Invoice (props) {
  const [hubUiTick, setHubUiTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((n) => n + 1)), []);
  void hubUiTick;
  const uf = loadHubUiFeatureFlags();

  const {
    invoiceId,
    address,
    amountSats,
    network = 'regtest',
    label,
    memo = '',
    txids = [],
    identity = {},
    onPaid,
    onError,
    compact = false,
    adminToken: adminTokenProp,
    requireUnlockedIdentityForHubPay = false,
    identityUnlocked = true
  } = props;

  const [paying, setPaying] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [externalTxid, setExternalTxid] = React.useState('');
  const [error, setError] = React.useState(null);
  const [result, setResult] = React.useState(null);
  const [qrDataUrl, setQrDataUrl] = React.useState(null);
  const [copied, setCopied] = React.useState(false);
  const [chainStatus, setChainStatus] = React.useState(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [poolBtc, setPoolBtc] = React.useState(() => [...DEFAULT_POOLS_BTC]);
  const [joinmarketBusy, setJoinmarketBusy] = React.useState(false);
  const [joinmarketErr, setJoinmarketErr] = React.useState(null);
  const [joinmarketUri, setJoinmarketUri] = React.useState('');

  const upstream = React.useMemo(() => loadUpstreamSettings(), []);
  const idXpub = identity && identity.xpub ? String(identity.xpub) : '';
  const idXprv = identity && identity.xprv ? String(identity.xprv) : '';
  const wallet = React.useMemo(
    () => getSpendWalletContext(identity),
    [idXpub, idXprv]
  );

  const refreshChainStatus = React.useCallback(async (txid) => {
    const id = String(txid || '').trim();
    if (!id || !address || !amountSats) return;
    setChainStatus((prev) => ({
      ...(prev && prev.txid === id ? prev : {}),
      loading: true,
      txid: id
    }));
    try {
      const res = await verifyL1Payment(upstream, {
        txid: id,
        address,
        amountSats: Number(amountSats)
      });
      setChainStatus({
        loading: false,
        txid: id,
        verified: !!res.verified,
        confirmations: res.confirmations != null ? Number(res.confirmations) : null,
        inMempool: !!res.inMempool,
        matchedSats: res.matchedSats
      });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      setChainStatus({
        loading: false,
        txid: id,
        verified: false,
        confirmations: null,
        inMempool: false,
        error: msg
      });
    }
  }, [upstream, address, amountSats]);

  // Payment URI for QR code (BIP 21)
  const paymentUri = React.useMemo(() => {
    if (!address || !amountSats || amountSats <= 0) return null;
    try {
      return encodeBitcoinUri({
        address,
        amount: Number(amountSats) / SATS_PER_BTC
      });
    } catch (_) {
      return null;
    }
  }, [address, amountSats]);

  // Generate QR code
  React.useEffect(() => {
    if (!paymentUri) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(paymentUri, {
      width: compact ? 140 : 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    }).then(setQrDataUrl).catch(() => setQrDataUrl(null));
  }, [paymentUri, compact]);

  const hubPayBlockedByIdentity = !!(requireUnlockedIdentityForHubPay && !identityUnlocked);

  const handlePay = React.useCallback(async () => {
    if (!address || !amountSats || amountSats <= 0) return;
    if (requireUnlockedIdentityForHubPay && !identityUnlocked) {
      setError(`${L.identityBlocked} ${identityHowTo(identity)}`);
      return;
    }
    setPaying(true);
    setError(null);
    setResult(null);
    setChainStatus(null);
    const adminToken = readHubAdminTokenFromBrowser(adminTokenProp);
    if (!adminToken) {
      setPaying(false);
      setError(t.common.errors.adminTokenRequired);
      return;
    }
    try {
      const res = await sendPayment(upstream, wallet, {
        to: address,
        amountSats: Number(amountSats),
        memo: memo || (label ? `Invoice: ${label}` : ''),
        adminToken
      });
      const txid = res && (res.payment && res.payment.txid) || res.txid;
      if (txid) {
        setResult({ txid, success: true });
        refreshChainStatus(txid);
        if (typeof onPaid === 'function') onPaid(txid);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('clientBalanceUpdate'));
        }
      } else {
        const errMsg = (res && res.error) || (res && res.message) || L.errors.noTxid;
        setError(errMsg);
        if (typeof onError === 'function') onError(new Error(errMsg));
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      setError(msg);
      if (typeof onError === 'function') onError(err);
    } finally {
      setPaying(false);
    }
  }, [address, amountSats, memo, label, upstream, wallet, onPaid, onError, refreshChainStatus, adminTokenProp, requireUnlockedIdentityForHubPay, identityUnlocked, identity]);

  const isMainnet = String(network || '').toLowerCase() === 'mainnet';

  const handleVerifyExternal = React.useCallback(async () => {
    const txid = String(externalTxid || '').trim();
    if (!txid || !address || !amountSats) return;
    setVerifying(true);
    setError(null);
    setResult(null);
    setChainStatus(null);
    try {
      const res = await verifyL1Payment(upstream, {
        txid,
        address,
        amountSats: Number(amountSats)
      });
      if (res && res.verified) {
        setResult({ txid, success: true });
        setExternalTxid('');
        setChainStatus({
          loading: false,
          txid,
          verified: true,
          confirmations: res.confirmations != null ? Number(res.confirmations) : null,
          inMempool: !!res.inMempool,
          matchedSats: res.matchedSats
        });
        if (typeof onPaid === 'function') onPaid(txid);
      } else {
        const msg = L.errors.notVerified;
        setError(msg);
        if (typeof onError === 'function') onError(new Error(msg));
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      setError(msg);
      if (typeof onError === 'function') onError(err);
    } finally {
      setVerifying(false);
    }
  }, [externalTxid, address, amountSats, upstream, onPaid, onError]);

  React.useEffect(() => {
    if (!advancedOpen) return;
    setPoolBtc(loadJoinmarketPoolSizesBtc());
    setJoinmarketErr(null);
    setJoinmarketUri('');
  }, [advancedOpen]);

  const handleSavePools = React.useCallback(() => {
    setPoolBtc(saveJoinmarketPoolSizesBtc(poolBtc));
  }, [poolBtc]);

  const handleCreateInvoicePayjoin = React.useCallback(async () => {
    setJoinmarketBusy(true);
    setJoinmarketErr(null);
    setJoinmarketUri('');
    try {
      const w = getNextReceiveWalletContext(identity);
      const session = await createPayjoinDeposit(upstream, w, {
        address,
        amountSats: Number(amountSats),
        label: label || 'Invoice Payjoin',
        memo: String(memo || `invoice-payjoin:${invoiceId || 'local'}`).slice(0, 200)
      });
      const uri = session && (session.bip21Uri || '');
      if (!uri || !/^bitcoin:/i.test(String(uri))) {
        throw new Error(L.errors.payjoinBadUri);
      }
      setJoinmarketUri(String(uri));
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      setJoinmarketErr(msg);
    } finally {
      setJoinmarketBusy(false);
    }
  }, [upstream, identity, address, amountSats, label, memo, invoiceId]);

  const handleCopy = React.useCallback((text) => {
    try {
      if (text && navigator && navigator.clipboard) {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch (err) {}
  }, []);

  const persistedTxids = Array.isArray(txids) ? txids : [];
  const effectiveTxid = (result && result.txid) || (persistedTxids[0] || '');
  const isPaidFlow = !!(effectiveTxid && (
    (result && result.success) ||
    persistedTxids.length > 0
  ));
  const donePolling = !!(chainStatus && chainStatus.verified && Number(chainStatus.confirmations) > 0);

  React.useEffect(() => {
    if (!isPaidFlow || !effectiveTxid || donePolling) return;
    if (!address || amountSats == null || amountSats <= 0) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refreshChainStatus(effectiveTxid);
    };
    tick();
    const iv = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [isPaidFlow, effectiveTxid, donePolling, address, amountSats, refreshChainStatus]);

  const l1ActivityUnconfirmedRef = React.useRef(false);
  const l1ActivityConfirmedRef = React.useRef(false);
  React.useEffect(() => {
    l1ActivityUnconfirmedRef.current = false;
    l1ActivityConfirmedRef.current = false;
  }, [effectiveTxid]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!chainStatus || !chainStatus.txid || !chainStatus.verified) return;
    const txid = chainStatus.txid;
    const conf = Number(chainStatus.confirmations || 0);
    if (conf === 0 && !l1ActivityUnconfirmedRef.current) {
      l1ActivityUnconfirmedRef.current = true;
      window.dispatchEvent(new CustomEvent('fabric:l1PaymentActivity', {
        detail: {
          kind: 'unconfirmed',
          txid,
          inMempool: !!chainStatus.inMempool,
          label: label || null
        }
      }));
    }
    if (conf > 0 && !l1ActivityConfirmedRef.current) {
      l1ActivityConfirmedRef.current = true;
      window.dispatchEvent(new CustomEvent('fabric:l1PaymentActivity', {
        detail: {
          kind: 'confirmed',
          txid,
          confirmations: conf,
          label: label || null
        }
      }));
    }
  }, [chainStatus, label]);

  if (!address || amountSats == null || amountSats <= 0) return null;

  const amountBtc = formatBtcFromSats(amountSats);
  const idSuffix = String(invoiceId || address).replace(/[^A-Za-z0-9_-]/g, '');
  const externalTxidInputId = `invoice-${idSuffix}-txid`;
  const poolInputPrefix = `invoice-${idSuffix}-pool`;
  const amountFormatted = formatSatsDisplay(amountSats);
  const isPaid = isPaidFlow;
  const isConfirmed = !!(chainStatus && chainStatus.verified && Number(chainStatus.confirmations) > 0);
  const isMempoolPaid = !!(chainStatus && chainStatus.verified && !isConfirmed);
  const headerWaiting = isPaid && (!chainStatus || chainStatus.loading);
  const borderColor = isConfirmed ? '#21ba45' : (isMempoolPaid || headerWaiting ? '#f2711c' : (isPaid ? '#f2711c' : BITCOIN_ORANGE));

  const cardStyle = {
    border: `2px solid ${borderColor}`,
    borderRadius: 8,
    overflow: 'hidden',
    maxWidth: compact ? 320 : 400,
    background: '#fff'
  };

  const headerStyle = {
    background: isConfirmed ? '#21ba45' : (isPaid ? '#f2711c' : BITCOIN_ORANGE),
    color: '#fff',
    padding: '0.75em 1em',
    fontSize: '0.95em',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5em'
  };

  const bodyStyle = {
    padding: compact ? '1em' : '1.5em',
    textAlign: 'center'
  };

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          {isConfirmed ? (
            <>
              <Icon name="check circle" /> {L.status.confirmed}
            </>
          ) : isMempoolPaid ? (
            <>
              <Icon name="clock" /> {L.status.mempool}
            </>
          ) : headerWaiting ? (
            <>
              <Icon name="sync" /> {L.status.verifying}
            </>
          ) : isPaid ? (
            <>
              <Icon name="warning circle" /> {L.status.paidPending}
            </>
          ) : (
            <>
              <Icon name="bitcoin" /> {L.status.unpaid}
            </>
          )}
        </div>
        <Button
          type="button"
          icon
          basic
          inverted
          compact
          size="small"
          aria-label={L.advanced}
          title={L.advanced}
          onClick={() => setAdvancedOpen(true)}
        >
          <Icon name="setting" />
        </Button>
      </div>

      <div style={bodyStyle}>
        {label && (
          <div style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.5em' }}>
            {label}
          </div>
        )}

        {!isPaid && qrDataUrl && (
          <div style={{ marginBottom: '1em' }}>
            <img
              src={qrDataUrl}
              alt={L.qrAlt}
              style={{ display: 'block', margin: '0 auto', borderRadius: 4 }}
            />
            <p style={{ fontSize: '0.8em', color: '#888', marginTop: '0.5em' }}>
              {L.scan}
            </p>
          </div>
        )}

        <div style={{
          fontSize: compact ? '1.1em' : '1.4em',
          fontWeight: 700,
          color: BITCOIN_ORANGE,
          marginBottom: '0.25em'
        }}>
          {amountBtc} BTC
        </div>
        <div style={{ color: '#666', fontSize: '0.9em', marginBottom: '1em' }}>
          {L.satsLine(amountFormatted)}
        </div>

        <div style={{
          background: '#f7f7f7',
          borderRadius: 4,
          padding: '0.6em 0.8em',
          fontFamily: 'monospace',
          fontSize: compact ? '0.75em' : '0.85em',
          wordBreak: 'break-all',
          textAlign: 'left',
          marginBottom: '0.75em'
        }}>
          {address}
        </div>

        {compact && !isPaid && !isMainnet && (
          <p style={{ fontSize: '0.78em', color: '#666', marginBottom: '0.65em', textAlign: 'left', lineHeight: 1.4 }}>
            <strong>{L.secondTabTitle}</strong> {L.secondTab}
            {uf.bitcoinInvoices ? (
              <> {L.walkthroughBefore} <Link to="/services/bitcoin/invoices#fabric-invoices-tab-demo">{L.walkthroughLink}</Link>.</>
            ) : (
              <> {L.walkthroughOff}</>
            )}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.5em', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button
            size="small"
            basic
            onClick={() => handleCopy(address)}
          >
            <Icon name="copy" />
            {copied ? t.common.actions.copied : L.copyAddress}
          </Button>
          <Button
            size="small"
            basic
            onClick={() => handleCopy(L.copyBothText(address, amountFormatted))}
          >
            <Icon name="copy" />
            {L.copyBoth}
          </Button>
        </div>

        {network && (
          <div style={{ marginTop: '0.5em', fontSize: '0.8em', color: '#999' }}>
            {String(network).toLowerCase()}
          </div>
        )}

        {!isPaid && isMainnet && (
          <Message warning size="small" style={{ marginTop: '1em', textAlign: 'left' }}>
            {L.mainnet}
          </Message>
        )}

        {!isPaid && (
          <div style={{ marginTop: '1em', textAlign: 'left' }}>
            <label htmlFor={externalTxidInputId} style={{ display: 'block', fontSize: '0.85em', color: '#666', marginBottom: '0.35em' }}>
              {L.externalLabel}
            </label>
            <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
              <Input
                id={externalTxidInputId}
                placeholder={L.externalPlaceholder}
                value={externalTxid}
                onChange={(e, { value }) => setExternalTxid(value != null ? String(value) : (e && e.target && e.target.value) || '')}
                onInput={(e) => {
                  const v = e && e.target && e.target.value != null ? String(e.target.value) : '';
                  if (v !== externalTxid) setExternalTxid(v);
                }}
                style={{ flex: '1 1 12em', minWidth: '10em' }}
              />
              <Button
                type="button"
                content={L.confirm}
                icon="checkmark"
                title={L.confirmTitle}
                loading={verifying}
                disabled={verifying || paying || !String(externalTxid || '').trim()}
                onClick={handleVerifyExternal}
              />
            </div>
          </div>
        )}

        {!isPaid && !isMainnet && hubPayBlockedByIdentity && (
          <Message info size="small" style={{ marginTop: '1em', textAlign: 'left' }}>
            {L.identityBlocked} {identityHowTo(identity)}
          </Message>
        )}

        {!isPaid && !isMainnet && (
          <Button
            type="button"
            primary
            style={{ marginTop: '1em', background: BITCOIN_ORANGE }}
            icon="bitcoin"
            content={L.pay}
            title={L.payTitle}
            loading={paying}
            disabled={paying || verifying || hubPayBlockedByIdentity}
            onClick={handlePay}
          />
        )}

        {error && (
          <Message negative size="small" style={{ marginTop: '1em', textAlign: 'left' }}>
            {error}
          </Message>
        )}

        {isPaid && effectiveTxid && (
          <Message
            info={isConfirmed}
            warning={!isConfirmed && !!chainStatus && chainStatus.verified}
            size="small"
            style={{ marginTop: '1em', textAlign: 'left' }}
          >
            {chainStatus && chainStatus.loading ? (
              <p style={{ margin: 0 }}>{L.checking}</p>
            ) : isConfirmed ? (
              <p style={{ margin: 0 }}>
                {(() => {
                  const rawC = chainStatus && chainStatus.confirmations != null ? Number(chainStatus.confirmations) : 0;
                  const c = Number.isFinite(rawC) ? rawC : 0;
                  return (
                    <>
                      {L.confirmations(c)}
                      {' '}
                      {uf.bitcoinExplorer ? (
                        <Link to={`/services/bitcoin/transactions/${encodeURIComponent(effectiveTxid)}`}>{L.openTransaction}</Link>
                      ) : (
                        <code style={{ fontSize: '0.9em', wordBreak: 'break-all' }} title={L.explorerOff}>{effectiveTxid}</code>
                      )}
                    </>
                  );
                })()}
              </p>
            ) : chainStatus && chainStatus.verified ? (
              <p style={{ margin: 0 }}>
                {L.mempoolNote}
                {' '}
                {uf.bitcoinExplorer ? (
                  <Link to={`/services/bitcoin/transactions/${encodeURIComponent(effectiveTxid)}`}>{L.viewStatus}</Link>
                ) : (
                  <code style={{ fontSize: '0.9em', wordBreak: 'break-all' }} title={L.explorerOff}>{effectiveTxid}</code>
                )}
                {chainStatus.matchedSats != null && (
                  <span style={{ display: 'block', marginTop: '0.35em', color: '#666', fontSize: '0.9em' }}>
                    {L.matched(chainStatus.matchedSats)}
                  </span>
                )}
              </p>
            ) : (
              <p style={{ margin: 0 }}>
                {chainStatus && chainStatus.error
                  ? L.notYet(chainStatus.error)
                  : L.waiting}
                {' '}
                {uf.bitcoinExplorer ? (
                  <Link to={`/services/bitcoin/transactions/${encodeURIComponent(effectiveTxid)}`}>{L.transactionPage}</Link>
                ) : (
                  <code style={{ fontSize: '0.9em', wordBreak: 'break-all' }} title={L.explorerOff}>{effectiveTxid}</code>
                )}
              </p>
            )}
          </Message>
        )}

        {isPaid && persistedTxids.length > 0 && (
          <Message positive size="small" style={{ marginTop: '1em', textAlign: 'left' }}>
            <strong>{L.payments(persistedTxids.length)}</strong>
            <div style={{ marginTop: '0.25em' }}>
              {persistedTxids.map((txid) => (
                <div key={txid} style={{ marginTop: '0.25em' }}>
                  {uf.bitcoinExplorer ? (
                    <Link to={`/services/bitcoin/transactions/${encodeURIComponent(txid)}`} style={{ fontSize: '0.85em', wordBreak: 'break-all' }}>
                      {txid}
                    </Link>
                  ) : (
                    <code style={{ fontSize: '0.85em', wordBreak: 'break-all' }} title={L.explorerOff}>{txid}</code>
                  )}
                </div>
              ))}
            </div>
          </Message>
        )}
      </div>

      <Modal
        closeIcon
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        size="small"
      >
        <Modal.Header>{L.modalTitle}</Modal.Header>
        <Modal.Content scrolling>
          <p style={{ color: '#555', fontSize: '0.9em', lineHeight: 1.45, marginBottom: '0.75em' }}>
            {L.poolsIntroBefore} <Link to="/services/coinjoin">{L.poolsIntroLink}</Link> {L.poolsIntroAfter}{' '}
            {L.payjoinIntro}
          </p>
          <Header as="h4" style={{ marginTop: 0 }}>{L.poolsTitle}</Header>
          <Form>
            {poolLabels().map((lbl, i) => (
              <Form.Field key={lbl}>
                <label htmlFor={`${poolInputPrefix}-${i}`}>{t.payments.coinjoin.poolLabels[i] || lbl}</label>
                <Input
                  id={`${poolInputPrefix}-${i}`}
                  type="number"
                  step="any"
                  min="1e-8"
                  value={poolBtc[i] != null ? String(poolBtc[i]) : ''}
                  onChange={(e, { value }) => {
                    const next = [...poolBtc];
                    next[i] = Number(value);
                    setPoolBtc(next);
                  }}
                />
                <span style={{ fontSize: '0.85em', color: '#888' }}>
                  {L.approxSats(btcToSats(poolBtc[i] != null ? poolBtc[i] : 0))}
                </span>
              </Form.Field>
            ))}
            <Button type="button" size="small" onClick={handleSavePools}>
              {L.savePools}
            </Button>
          </Form>

          <Divider />

          <Header as="h4">{L.payjoinTitle}</Header>
          <p style={{ color: '#555', fontSize: '0.88em' }}>
            {L.payjoinBody}
          </p>
          {!isPaid && (
            <Button
              type="button"
              color="violet"
              loading={joinmarketBusy}
              disabled={joinmarketBusy}
              onClick={handleCreateInvoicePayjoin}
            >
              {L.createPayjoin}
            </Button>
          )}
          {isPaid && (
            <Message info size="tiny">{L.alreadyPaid}</Message>
          )}
          {joinmarketErr && (
            <Message negative size="small" style={{ marginTop: '0.75em' }}>
              {joinmarketErr}
            </Message>
          )}
          {joinmarketUri && (
            <div style={{ marginTop: '0.75em' }}>
              <Message success size="small">
                <p style={{ margin: '0 0 0.5em', wordBreak: 'break-all', fontSize: '0.85em' }}>
                  <code>{joinmarketUri}</code>
                </p>
                <Button
                  type="button"
                  size="small"
                  basic
                  icon="copy"
                  content={L.copyLink}
                  onClick={() => handleCopy(joinmarketUri)}
                />
                <Button
                  as="a"
                  size="small"
                  primary
                  icon="external alternate"
                  content={L.openInPayments}
                  href={buildTabPayerPayjoinUrl(joinmarketUri)}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              </Message>
            </div>
          )}
        </Modal.Content>
        <Modal.Actions>
          <Button type="button" onClick={() => setAdvancedOpen(false)}>
            {t.common.actions.close}
          </Button>
        </Modal.Actions>
      </Modal>
    </div>
  );
}

module.exports = Invoice;
