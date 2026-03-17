'use strict';

const React = require('react');
const QRCode = require('qrcode');
const {
  Button,
  Icon,
  Message
} = require('semantic-ui-react');
const {
  loadUpstreamSettings,
  getWalletContextFromIdentity,
  sendPayment
} = require('../functions/bitcoinClient');

// BitPay circa 2016: Bitcoin orange accent
const BITCOIN_ORANGE = '#F7931A';

/**
 * The Invoice component provides a payment UI with QR code, address, and amount.
 * Pay button creates a transaction from the Hub wallet via the payments API.
 *
 * @param {Object} props
 * @param {string} props.address - Destination Bitcoin address
 * @param {number} props.amountSats - Amount in satoshis
 * @param {string} [props.network] - Network name (regtest, testnet, mainnet) for display
 * @param {string} [props.label] - Optional label for the invoice
 * @param {string} [props.memo] - Optional memo to include with the payment
 * @param {Object} [props.identity] - Identity for wallet context (xpub); Hub uses its wallet for regtest
 * @param {function} [props.onPaid] - Callback on success: (txid) => void
 * @param {function} [props.onError] - Callback on error: (error) => void
 * @param {boolean} [props.compact] - Use compact layout (e.g. inline in modals)
 */
function Invoice (props) {
  const {
    address,
    amountSats,
    network = 'regtest',
    label,
    memo = '',
    identity = {},
    onPaid,
    onError,
    compact = false
  } = props;

  const [paying, setPaying] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [result, setResult] = React.useState(null);
  const [qrDataUrl, setQrDataUrl] = React.useState(null);
  const [copied, setCopied] = React.useState(false);

  const upstream = React.useMemo(() => loadUpstreamSettings(), []);
  const wallet = React.useMemo(() => getWalletContextFromIdentity(identity), [identity]);

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
    try {
      const res = await sendPayment(upstream, wallet, {
        to: address,
        amountSats: Number(amountSats),
        memo: memo || (label ? `Invoice: ${label}` : '')
      });
      const txid = res && (res.payment && res.payment.txid) || res.txid;
      if (txid) {
        setResult({ txid, success: true });
        if (typeof onPaid === 'function') onPaid(txid);
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
  }, [address, amountSats, memo, label, upstream, wallet, onPaid, onError]);

  const handleCopy = React.useCallback((text) => {
    try {
      if (text && navigator && navigator.clipboard) {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch (err) {}
  }, []);

  if (!address || amountSats == null || amountSats <= 0) return null;

  const amountBtc = (Number(amountSats) / 100000000).toFixed(8);
  const amountFormatted = Number(amountSats).toLocaleString();
  const isPaid = result && result.success;

  const cardStyle = {
    border: `2px solid ${isPaid ? '#21ba45' : BITCOIN_ORANGE}`,
    borderRadius: 8,
    overflow: 'hidden',
    maxWidth: compact ? 320 : 400,
    background: '#fff'
  };

  const headerStyle = {
    background: isPaid ? '#21ba45' : BITCOIN_ORANGE,
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
        {isPaid ? (
          <>
            <Icon name="check circle" /> Payment Complete
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
            onClick={() => handleCopy(`${address}\n${amountSats} sats`)}
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

        {!isPaid && (
          <Button
            primary
            style={{ marginTop: '1em', background: BITCOIN_ORANGE }}
            icon="bitcoin"
            content="Pay Now"
            loading={paying}
            disabled={paying}
            onClick={handlePay}
          />
        )}

        {error && (
          <Message negative size="small" style={{ marginTop: '1em', textAlign: 'left' }}>
            {error}
          </Message>
        )}

        {isPaid && result && (
          <Message positive size="small" style={{ marginTop: '1em', textAlign: 'left' }}>
            <strong>Txid:</strong> <code style={{ fontSize: '0.85em', wordBreak: 'break-all' }}>{result.txid}</code>
          </Message>
        )}
      </div>
    </div>
  );
}

module.exports = Invoice;
