'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const QRCode = require('qrcode');
const {
  Button,
  Icon,
  Input,
  Message
} = require('semantic-ui-react');
const {
  loadUpstreamSettings,
  getSpendWalletContext,
  sendPayment,
  verifyL1Payment
} = require('../functions/bitcoinClient');
const { formatSatsDisplay, formatBtcFromSats } = require('../functions/formatSats');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');

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
 */
function Invoice (props) {
  const [hubUiTick, setHubUiTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((t) => t + 1)), []);
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
    adminToken: adminTokenProp
  } = props;

  const [paying, setPaying] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [externalTxid, setExternalTxid] = React.useState('');
  const [error, setError] = React.useState(null);
  const [result, setResult] = React.useState(null);
  const [qrDataUrl, setQrDataUrl] = React.useState(null);
  const [copied, setCopied] = React.useState(false);
  const [chainStatus, setChainStatus] = React.useState(null);

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
    const btc = (Number(amountSats) / 100000000).toFixed(8);
    return `bitcoin:${address}?amount=${btc}`;
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

  const handlePay = React.useCallback(async () => {
    if (!address || !amountSats || amountSats <= 0) return;
    setPaying(true);
    setError(null);
    setResult(null);
    setChainStatus(null);
    const adminToken = readHubAdminTokenFromBrowser(adminTokenProp);
    if (!adminToken) {
      setPaying(false);
      setError('Admin token required to pay from the Hub wallet (setup token in local storage).');
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
        const errMsg = (res && res.error) || (res && res.message) || 'Payment completed but no txid returned.';
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
  }, [address, amountSats, memo, label, upstream, wallet, onPaid, onError, refreshChainStatus, adminTokenProp]);

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
        const msg = 'This transaction does not pay this address for at least the invoice amount, or the tx could not be loaded (txindex disabled / wrong network).';
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
    fontWeight: 600
  };

  const bodyStyle = {
    padding: compact ? '1em' : '1.5em',
    textAlign: 'center'
  };

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        {isConfirmed ? (
          <>
            <Icon name="check circle" /> Payment confirmed
          </>
        ) : isMempoolPaid ? (
          <>
            <Icon name="clock" /> Awaiting confirmation
          </>
        ) : headerWaiting ? (
          <>
            <Icon name="sync" /> Verifying payment…
          </>
        ) : isPaid ? (
          <>
            <Icon name="warning circle" /> Paid — confirmation pending
          </>
        ) : (
          <>
            <Icon name="bitcoin" /> Pay with Bitcoin
          </>
        )}
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
              alt="Bitcoin payment QR code"
              style={{ display: 'block', margin: '0 auto', borderRadius: 4 }}
            />
            <p style={{ fontSize: '0.8em', color: '#888', marginTop: '0.5em' }}>
              Scan with your wallet
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
          {amountFormatted} satoshis
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
            <strong>Second tab:</strong> use the blue <strong>Open payer tab (prefilled)</strong> control for this invoice (same origin, new tab; shown to the right of the card on wide layouts). It opens Payments with <code>payTo</code> and <code>payAmountSats</code>, and scrolls to Make Payment.
            {uf.bitcoinInvoices ? (
              <> See the walkthrough at the top of <Link to="/services/bitcoin/invoices#fabric-invoices-tab-demo">Invoices</Link>.</>
            ) : (
              <> Enable <strong>Bitcoin — Invoices</strong> in Admin → Feature visibility for a link to the walkthrough.</>
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
            {copied ? 'Copied!' : 'Copy address'}
          </Button>
          <Button
            size="small"
            basic
            onClick={() => handleCopy(`${address}\n${amountFormatted} sats`)}
          >
            <Icon name="copy" />
            Copy both
          </Button>
        </div>

        {network && (
          <div style={{ marginTop: '0.5em', fontSize: '0.8em', color: '#999' }}>
            {String(network).toLowerCase()}
          </div>
        )}

        {!isPaid && isMainnet && (
          <Message warning size="small" style={{ marginTop: '1em', textAlign: 'left' }}>
            Mainnet: pay with your own wallet from the QR or address above, then paste the transaction id below.
            The Hub will verify against its configured <code>bitcoind</code> (requires a node that can serve the tx).
          </Message>
        )}

        {!isPaid && (
          <div style={{ marginTop: '1em', textAlign: 'left' }}>
            <div style={{ fontSize: '0.85em', color: '#666', marginBottom: '0.35em' }}>
              Paid from another wallet? Paste txid:
            </div>
            <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
              <Input
                placeholder="abc123… (64 hex characters)"
                value={externalTxid}
                onChange={(e, { value }) => setExternalTxid(value != null ? String(value) : (e && e.target && e.target.value) || '')}
                onInput={(e) => {
                  const v = e && e.target && e.target.value != null ? String(e.target.value) : '';
                  if (v !== externalTxid) setExternalTxid(v);
                }}
                style={{ flex: '1 1 12em', minWidth: '10em' }}
                input={{
                  'aria-label': 'Bitcoin transaction id for external L1 payment verification'
                }}
              />
              <Button
                type="button"
                content="Confirm payment"
                icon="checkmark"
                aria-label="Confirm payment: verify pasted txid pays this invoice (L1)"
                loading={verifying}
                disabled={verifying || paying || !String(externalTxid || '').trim()}
                onClick={handleVerifyExternal}
              />
            </div>
          </div>
        )}

        {!isPaid && !isMainnet && (
          <Button
            type="button"
            primary
            style={{ marginTop: '1em', background: BITCOIN_ORANGE }}
            icon="bitcoin"
            content="Pay Now"
            aria-label="Pay invoice via hub Payments API (admin token required)"
            loading={paying}
            disabled={paying || verifying}
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
              <p style={{ margin: 0 }}>Checking mempool and block depth…</p>
            ) : isConfirmed ? (
              <p style={{ margin: 0 }}>
                {(() => {
                  const rawC = chainStatus && chainStatus.confirmations != null ? Number(chainStatus.confirmations) : 0;
                  const c = Number.isFinite(rawC) ? rawC : 0;
                  const label = c === 1 ? '1 confirmation' : `${c} confirmations`;
                  return (
                    <>
                      {label}.
                      {' '}
                      {uf.bitcoinExplorer ? (
                        <Link to={`/services/bitcoin/transactions/${encodeURIComponent(effectiveTxid)}`}>Open transaction</Link>
                      ) : (
                        <code style={{ fontSize: '0.9em', wordBreak: 'break-all' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility for the tx viewer">{effectiveTxid}</code>
                      )}
                    </>
                  );
                })()}
              </p>
            ) : chainStatus && chainStatus.verified ? (
              <p style={{ margin: 0 }}>
                Transaction is in the mempool or has zero confirmations; it will show as settled after the next block.
                {' '}
                {uf.bitcoinExplorer ? (
                  <Link to={`/services/bitcoin/transactions/${encodeURIComponent(effectiveTxid)}`}>View status</Link>
                ) : (
                  <code style={{ fontSize: '0.9em', wordBreak: 'break-all' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility for the tx viewer">{effectiveTxid}</code>
                )}
                {chainStatus.matchedSats != null && (
                  <span style={{ display: 'block', marginTop: '0.35em', color: '#666', fontSize: '0.9em' }}>
                    Matched {Number(chainStatus.matchedSats).toLocaleString()} sats to this invoice address.
                  </span>
                )}
              </p>
            ) : (
              <p style={{ margin: 0 }}>
                {chainStatus && chainStatus.error
                  ? `Could not verify yet (${chainStatus.error}). Retrying…`
                  : 'Waiting for the node to see this transaction…'}
                {' '}
                {uf.bitcoinExplorer ? (
                  <Link to={`/services/bitcoin/transactions/${encodeURIComponent(effectiveTxid)}`}>Transaction page</Link>
                ) : (
                  <code style={{ fontSize: '0.9em', wordBreak: 'break-all' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility for the tx viewer">{effectiveTxid}</code>
                )}
              </p>
            )}
          </Message>
        )}

        {isPaid && persistedTxids.length > 0 && (
          <Message positive size="small" style={{ marginTop: '1em', textAlign: 'left' }}>
            <strong>Payment{persistedTxids.length > 1 ? 's' : ''} ({persistedTxids.length}):</strong>
            <div style={{ marginTop: '0.25em' }}>
              {persistedTxids.map((txid) => (
                <div key={txid} style={{ marginTop: '0.25em' }}>
                  {uf.bitcoinExplorer ? (
                    <Link to={`/services/bitcoin/transactions/${encodeURIComponent(txid)}`} style={{ fontSize: '0.85em', wordBreak: 'break-all' }}>
                      {txid}
                    </Link>
                  ) : (
                    <code style={{ fontSize: '0.85em', wordBreak: 'break-all' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility for the tx viewer">{txid}</code>
                  )}
                </div>
              ))}
            </div>
          </Message>
        )}
      </div>
    </div>
  );
}

module.exports = Invoice;
