'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Checkbox, Form, Header, Icon, Label, List, Message, Segment, Table } = require('semantic-ui-react');
const {
  broadcastRawTransaction,
  createPayjoinDeposit,
  decodeLightningInvoice,
  deriveAddressFromXpub,
  fetchLightningChannels,
  fetchLightningStatus,
  fetchPayments,
  fetchPayjoinCapabilities,
  fetchPayjoinSessions,
  fetchReceiveAddress,
  fetchTransactionHex,
  fetchUTXOs,
  fetchWalletSummary,
  fetchWalletTransactions,
  getSpendWalletContext,
  getNextReceiveWalletContext,
  loadUpstreamSettings,
  loadPayjoinPreferences,
  savePayjoinPreferences,
  payLightningInvoice,
  reserveNextReceiveAddress,
  sendPayment,
  submitPayjoinProposal,
  applyPayjoinAcpHubBoost
} = require('../functions/bitcoinClient');
const {
  parseBitcoinUriForPayjoin,
  extractFabricPayjoinSessionIdFromPjUrl,
  chainIndexFromDescriptor,
  buildOriginalSignedPayjoinPsbt,
  signOurPayjoinInputs,
  finalizeAndExtractHex,
  postPayjoinProposalWithDesktopFallback
} = require('../functions/payjoinBrowserWallet');
const { formatSatsDisplay } = require('../functions/formatSats');
const txContractLabels = require('../functions/txContractLabels');
const invoiceStore = require('../functions/invoiceStore');
const { copyToClipboard, pushUiNotification } = require('../functions/uiNotifications');
const QrScannerModal = require('./QrScannerModal');
const HubRegtestAdminTokenPanel = require('./HubRegtestAdminTokenPanel');
const BitcoinWalletBranchBar = require('./BitcoinWalletBranchBar');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { safeBriefMessage } = require('../functions/fabricSafeLog');
const { hasExternalSigningDelegation } = require('../functions/fabricDelegationLocal');

/**
 * When `refresh()` runs twice in one update (identity + query), Router props can be briefly empty;
 * the real URL still has payTo / payAmountSats — read as fallback so Make Payment prefills survive.
 */
function readPaymentsDeepLinkFromLocation () {
  try {
    if (typeof window === 'undefined') return {};
    const sp = new URLSearchParams(window.location.search);
    return {
      payTo: String(sp.get('payTo') || '').trim(),
      payAmountSats: sp.get('payAmountSats'),
      bitcoinUri: String(sp.get('bitcoinUri') || '').trim()
    };
  } catch (_) {
    return {};
  }
}

/**
 * Props + location → partial state for Make Payment (apply before async refresh so fields are not blank while loading).
 * Prefer `window.location` over Router props so stripping query after a successful send is visible immediately
 * (Router props can lag one frame behind `setSearchParams`).
 * @param {object} props - includes payToFromQuery, payAmountSatsFromQuery, bitcoinUriFromQuery
 * @returns {Record<string, unknown>}
 */
function computeMakePaymentDeepLinkPatch (props) {
  const loc = readPaymentsDeepLinkFromLocation();
  const qBitcoinUri = String(loc.bitcoinUri || '').trim() || String((props && props.bitcoinUriFromQuery) || '').trim();
  const qTo = String(loc.payTo || '').trim() || String((props && props.payToFromQuery) || '').trim();
  const rawAmtProp = props && props.payAmountSatsFromQuery;
  const qAmtRaw = (loc.payAmountSats != null && String(loc.payAmountSats).trim() !== '')
    ? loc.payAmountSats
    : rawAmtProp;
  const qAmtStr = qAmtRaw != null && String(qAmtRaw).trim() && Number.isFinite(Number(qAmtRaw)) && Number(qAmtRaw) > 0
    ? String(Math.round(Number(qAmtRaw)))
    : '';
  const patch = {};
  if (qBitcoinUri) {
    patch.to = qBitcoinUri;
    patch.lightningInvoice = '';
    patch.decodedInvoice = null;
  } else if (qTo) {
    patch.to = qTo;
    patch.lightningInvoice = '';
    patch.decodedInvoice = null;
  }
  if (qAmtStr && !qBitcoinUri) {
    patch.amountSats = qAmtStr;
  }
  return patch;
}

/** Monospace deposit-session table for Payjoin receiver operations. */
function buildPayjoinSessionAscii (sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const head = 'OFFER_ID        AMNT_SATS   STATUS      ADDR                N_PROP  EXPIRES';
  const sep = '--------------------------------------------------------------------------------';
  const lines = [head, sep];
  for (let i = 0; i < Math.min(list.length, 16); i++) {
    const s = list[i] || {};
    const oid = String(s.id || '-').replace(/\s+/g, ' ').slice(0, 14).padEnd(14);
    const amt = s.amountSats != null && Number(s.amountSats) > 0 ? String(Math.round(Number(s.amountSats))) : 'any';
    const amtf = amt.slice(0, 10).padStart(10);
    const st = String(s.status || '-').slice(0, 10).padEnd(10);
    const ad = String(s.address || '-').slice(0, 18).padEnd(18);
    const n = Array.isArray(s.proposals) ? s.proposals.length : 0;
    let ex = '-';
    try {
      if (s.expiresAt) {
        const d = new Date(s.expiresAt);
        if (!Number.isNaN(d.getTime())) ex = d.toISOString().slice(5, 16).replace('T', ' ');
      }
    } catch (e) {}
    ex = String(ex).slice(0, 11).padEnd(11);
    lines.push(`${oid}  ${amtf}  ${st}  ${ad}  ${String(n).padStart(4)}  ${ex}`);
  }
  if (list.length === 0) {
    lines.push('(no deposit sessions — use Request Payment above or POST /services/payjoin/sessions)');
  }
  return lines.join('\n');
}

class BitcoinPaymentsHome extends React.Component {
  constructor (props) {
    super(props);
    const pjPref = loadPayjoinPreferences();
    this.state = {
      loading: true,
      error: null,
      upstream: loadUpstreamSettings(),
      wallet: null,
      summary: {},
      receiveAddress: '',
      utxos: [],
      payments: [],
      to: '',
      amountSats: '',
      memo: '',
      result: null,
      payjoinSessions: [],
      payjoinSessionId: '',
      payjoinPsbt: '',
      payjoinResult: null,
      transactions: [],
      scanModalOpen: false,
      lightningInvoice: '',
      decodedInvoice: null,
      payjoinCapabilities: { available: false },
      payjoinPreferReceive: !!pjPref.paymentsReceive,
      payjoinPreferSend: !!pjPref.paymentsSend,
      receivePayjoinAmountSats: '',
      payjoinReceiveBusy: false,
      payjoinReceiveResult: null,
      localPayjoinBusy: false,
      localPayjoinResult: null,
      acpPayjoinBusy: false,
      acpPayjoinResult: null,
      lightningSummary: {},
      lightningChannels: [],
      lightningOutputs: []
    };
  }

  /** Compute Lightning managed funds from listfunds outputs. */
  getLightningBalanceFromOutputs (outputs = []) {
    let confirmed = 0;
    let unconfirmed = 0;
    let immature = 0;
    for (const o of outputs) {
      const sats = o && o.amount_msat != null
        ? Math.floor(Number(o.amount_msat) / 1000)
        : (o && o.amount_sat != null ? Number(o.amount_sat) : 0);
      const status = String((o && o.status) || '').toLowerCase();
      if (status === 'confirmed') confirmed += sats;
      else if (status === 'immature') immature += sats;
      else if (status === 'spent') {
        // ignore
      } else {
        unconfirmed += sats;
      }
    }
    return { confirmed, unconfirmed, immature };
  }

  componentDidMount () {
    this.refresh();
    const sid = String((this.props && this.props.payjoinSessionFromQuery) || '').trim();
    if (sid) this.setState({ payjoinSessionId: sid });
    this._syncPaymentsHashScroll();
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', this._onPaymentsHashChange);
    }
  }

  componentWillUnmount () {
    if (typeof window !== 'undefined') {
      window.removeEventListener('hashchange', this._onPaymentsHashChange);
    }
  }

  _onPaymentsHashChange = () => {
    this._syncPaymentsHashScroll();
  };

  componentDidUpdate (prevProps, prevState) {
    const prev = prevProps && prevProps.identity && prevProps.identity.xpub;
    const next = this.props && this.props.identity && this.props.identity.xpub;
    const identityWalletChanged = prev !== next;
    const pq = String((prevProps && prevProps.payjoinSessionFromQuery) || '').trim();
    const nq = String((this.props && this.props.payjoinSessionFromQuery) || '').trim();
    if (nq && nq !== pq) this.setState({ payjoinSessionId: nq });
    const pPay = String((prevProps && prevProps.payToFromQuery) || '').trim();
    const nPay = String((this.props && this.props.payToFromQuery) || '').trim();
    const pAmt = prevProps && prevProps.payAmountSatsFromQuery;
    const nAmt = this.props && this.props.payAmountSatsFromQuery;
    const pBc = String((prevProps && prevProps.bitcoinUriFromQuery) || '').trim();
    const nBc = String((this.props && this.props.bitcoinUriFromQuery) || '').trim();
    const queryChanged = nPay !== pPay || nAmt !== pAmt || nBc !== pBc;
    if (identityWalletChanged || queryChanged) this.refresh();
    if (prevState.loading && !this.state.loading) {
      this._syncPaymentsHashScroll();
    }
  }

  /** Scroll to hash targets after navigation (SPA + new tab with #fragment). */
  _syncPaymentsHashScroll () {
    if (typeof window === 'undefined') return;
    const raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw) return;
    requestAnimationFrame(() => {
      if (raw === 'wealth-payjoin-board') {
        const el = document.getElementById('wealth-payjoin-board');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const el = document.getElementById(raw);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async refresh () {
    const identity = (this.props && this.props.identity) || {};
    const wallet = getSpendWalletContext(identity);
    const nextReceive = getNextReceiveWalletContext(identity);
    const upstream = this.state.upstream;
    const network = (this.props.bitcoin && this.props.bitcoin.network) ? String(this.props.bitcoin.network).toLowerCase() : 'regtest';
    const deepLinkPatch = computeMakePaymentDeepLinkPatch(this.props);
    this.setState({ loading: true, error: null, wallet, ...deepLinkPatch });

    try {
      const [summary, address, utxos, payments, payjoinSessions, transactions, payjoinCapabilities, lightningSummary, lightningChannels] = await Promise.all([
        fetchWalletSummary(upstream, wallet, { network }).catch(() => ({})),
        fetchReceiveAddress(upstream, nextReceive, { network, identity }).catch(() => ''),
        fetchUTXOs(upstream, wallet, { network }).catch(() => []),
        fetchPayments(upstream, wallet, { limit: 50 }).catch(() => []),
        fetchPayjoinSessions(upstream, { limit: 50, includeExpired: true }).catch(() => []),
        fetchWalletTransactions(upstream, wallet, { limit: 50, network }).catch(() => []),
        fetchPayjoinCapabilities(upstream).catch(() => ({ available: false })),
        fetchLightningStatus(upstream).catch(() => ({})),
        fetchLightningChannels(upstream).catch(() => [])
      ]);
      const invLabels = txContractLabels.buildInvoiceTxLabels(invoiceStore.loadInvoices());
      const txRows = Array.isArray(transactions)
        ? txContractLabels.mergeServerAndLocalLabels(transactions, invLabels)
        : [];

      const lightningChannelsList = Array.isArray(lightningChannels)
        ? lightningChannels
        : (lightningChannels && Array.isArray(lightningChannels.channels) ? lightningChannels.channels : []);
      const lightningOutputsList = lightningChannels && Array.isArray(lightningChannels.outputs)
        ? lightningChannels.outputs
        : [];

      const nextState = {
        loading: false,
        summary,
        receiveAddress: address || '',
        utxos: Array.isArray(utxos) ? utxos : [],
        payments: Array.isArray(payments) ? payments : [],
        payjoinSessions: Array.isArray(payjoinSessions) ? payjoinSessions : [],
        transactions: txRows,
        payjoinCapabilities: payjoinCapabilities && typeof payjoinCapabilities === 'object'
          ? payjoinCapabilities
          : { available: false },
        lightningSummary: lightningSummary && typeof lightningSummary === 'object' ? lightningSummary : {},
        lightningChannels: lightningChannelsList,
        lightningOutputs: lightningOutputsList
      };
      const loc = readPaymentsDeepLinkFromLocation();
      const qBitcoinUri = String(loc.bitcoinUri || '').trim() || String((this.props && this.props.bitcoinUriFromQuery) || '').trim();
      const qTo = String(loc.payTo || '').trim() || String((this.props && this.props.payToFromQuery) || '').trim();
      const rawAmtProp = this.props && this.props.payAmountSatsFromQuery;
      const qAmtRaw = (loc.payAmountSats != null && String(loc.payAmountSats).trim() !== '')
        ? loc.payAmountSats
        : rawAmtProp;
      const qAmtStr = qAmtRaw != null && String(qAmtRaw).trim() && Number.isFinite(Number(qAmtRaw)) && Number(qAmtRaw) > 0
        ? String(Math.round(Number(qAmtRaw)))
        : '';

      const prevBc = this._lastBitcoinUriApplied !== undefined && this._lastBitcoinUriApplied != null
        ? String(this._lastBitcoinUriApplied).trim()
        : '';
      const prevPayTo = this._lastPayToApplied !== undefined && this._lastPayToApplied !== null
        ? String(this._lastPayToApplied).trim()
        : '';
      const prevPayAmt = this._lastPayAmtApplied !== undefined && this._lastPayAmtApplied !== null
        ? String(this._lastPayAmtApplied).trim()
        : '';
      if (prevBc && !qBitcoinUri) {
        const curTo = String(this.state.to || '').trim();
        if (curTo === prevBc) {
          nextState.to = '';
          nextState.lightningInvoice = '';
          nextState.decodedInvoice = null;
        }
      }
      if (prevPayTo && !qTo && !qBitcoinUri) {
        const curTo = String(this.state.to || '').trim();
        if (curTo === prevPayTo) {
          nextState.to = '';
          nextState.lightningInvoice = '';
          nextState.decodedInvoice = null;
        }
      }
      if (prevPayAmt && !qAmtStr && !qBitcoinUri) {
        const curAmt = String(this.state.amountSats || '').trim();
        if (curAmt === prevPayAmt) {
          nextState.amountSats = '';
        }
      }
      if (qBitcoinUri) {
        nextState.to = qBitcoinUri;
        nextState.lightningInvoice = '';
        nextState.decodedInvoice = null;
        const pj = parseBitcoinUriForPayjoin(qBitcoinUri);
        if (pj && pj.amountSats != null && Number(pj.amountSats) > 0) {
          nextState.amountSats = String(Math.round(Number(pj.amountSats)));
        } else {
          try {
            const bu = new URL(qBitcoinUri);
            if (bu.protocol === 'bitcoin:') {
              const amountStr = bu.searchParams.get('amount');
              const amountBtc = amountStr != null ? Number(amountStr) : NaN;
              if (Number.isFinite(amountBtc) && amountBtc > 0) {
                nextState.amountSats = String(Math.round(amountBtc * 1e8));
              }
            }
          } catch (_) { /* ignore */ }
        }
      } else if (qTo) {
        nextState.to = qTo;
        nextState.lightningInvoice = '';
        nextState.decodedInvoice = null;
      }
      if (qAmtStr && !qBitcoinUri) {
        nextState.amountSats = qAmtStr;
      }
      this._lastBitcoinUriApplied = qBitcoinUri;
      this._lastPayToApplied = qTo;
      this._lastPayAmtApplied = qAmtStr;
      /* Regtest: prefill amount once so L1 send isn’t stuck disabled behind an empty number field (placeholder ≠ value). */
      if (network === 'regtest' && !this._regtestSendAmountPrimed) {
        this._regtestSendAmountPrimed = true;
        const finalAmt = String(nextState.amountSats != null ? nextState.amountSats : this.state.amountSats || '').trim();
        if (!finalAmt) nextState.amountSats = '10000';
      }
      this.setState(nextState, () => {
        if (typeof window === 'undefined') return;
        const balanceSats = Number(summary.balanceSats != null ? summary.balanceSats : (summary.balance || 0));
        const confirmedSats = Number(summary.confirmedSats != null ? summary.confirmedSats : balanceSats);
        const unconfirmedSats = Number(summary.unconfirmedSats || 0);
        if (Number.isFinite(balanceSats)) {
          window.dispatchEvent(new CustomEvent('clientBalanceUpdate', {
            detail: {
              walletId: wallet.walletId,
              balanceSats,
              confirmedSats,
              unconfirmedSats
            }
          }));
        }
      });
    } catch (error) {
      this.setState({ loading: false, error: error && error.message ? error.message : String(error) });
    }
  }

  async handleSend () {
    const wallet = this.state.wallet || {};
    const to = String(this.state.to || '').trim();
    const amountSats = Number(this.state.amountSats || 0);
    if (!to) return this.setState({ result: { error: 'Recipient address is required.' } });
    if (!Number.isFinite(amountSats) || amountSats <= 0) return this.setState({ result: { error: 'Amount must be > 0 sats.' } });

    const adminToken = this._adminTokenForBroadcast();
    if (!adminToken) {
      return this.setState({
        result: {
          error: 'Admin token required. Payments from this screen spend the Hub node wallet; paste your setup token in local storage (fabric.hub.adminToken) or complete first-time setup.'
        }
      });
    }

    try {
      const result = await sendPayment(this.state.upstream, wallet, {
        to,
        amountSats,
        memo: this.state.memo,
        adminToken
      });
      const paidTxid = (result && result.payment && result.payment.txid) || (result && result.txid);
      const paid = !!paidTxid;
      if (paid && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('clientBalanceUpdate'));
      }
      if (paid && typeof this.props.paymentsSetSearchParams === 'function') {
        try {
          const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
          let changed = false;
          for (const k of ['payTo', 'payAmountSats', 'bitcoinUri']) {
            if (sp.has(k)) {
              sp.delete(k);
              changed = true;
            }
          }
          if (changed) this.props.paymentsSetSearchParams(sp, { replace: true });
        } catch (_) { /* ignore */ }
      }
      this.setState({ result, amountSats: '', memo: '' });
      await this.refresh();
    } catch (error) {
      this.setState({ result: { error: error && error.message ? error.message : String(error) } });
    }
  }

  handleNextReceiveAddress () {
    const network = (this.props.bitcoin && this.props.bitcoin.network) ? String(this.props.bitcoin.network).toLowerCase() : 'regtest';
    const id = (this.props && this.props.identity) || {};
    const receiveWallet = getNextReceiveWalletContext(id);
    const next = reserveNextReceiveAddress(receiveWallet, { network, identity: id });
    if (!next || !next.currentAddress) return;
    this.setState({ receiveAddress: next.currentAddress });
  }

  handleCopyAddress () {
    const addr = this.state.receiveAddress;
    if (!addr) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(addr);
      }
    } catch (e) {}
  }

  isLightningInvoice (text) {
    const s = String(text || '').trim();
    return s.startsWith('lnbc') || s.startsWith('lntb') || s.startsWith('lnbcrt');
  }

  handleScanResult (decodedText) {
    const text = String(decodedText || '').trim();
    if (!text) return;
    this.setState({ scanModalOpen: false });
    if (this.isLightningInvoice(text)) {
      this.setState({ lightningInvoice: text, to: '', amountSats: '' });
      this.handleDecodeInvoice(text);
    } else {
      this.setState({ to: text, lightningInvoice: '', decodedInvoice: null });
    }
  }

  async handleDecodeInvoice (invoice) {
    const inv = String(invoice || this.state.lightningInvoice || '').trim();
    if (!inv) return;
    try {
      const decoded = await decodeLightningInvoice(this.state.upstream, inv);
      const d = decoded && (decoded.decoded || decoded);
      const amountSats = d && (d.num_satoshis ?? d.numSatoshis ?? d.amount);
      this.setState({
        decodedInvoice: d,
        amountSats: amountSats != null ? String(amountSats) : this.state.amountSats
      });
    } catch (e) {
      this.setState({ decodedInvoice: null });
    }
  }

  isLikelyPayjoinBip21 (text) {
    const s = String(text || '').trim();
    const lower = s.toLowerCase();
    if (!lower.startsWith('bitcoin:')) return false;
    return /[?&]pj=/.test(s) || lower.includes('pj=');
  }

  async handleCreatePayjoinReceiveLink () {
    const addr = String(this.state.receiveAddress || '').trim();
    if (!addr) {
      this.setState({
        payjoinReceiveResult: {
          error: 'Receive address is required. Unlock identity (Settings → Fabric identity or top-bar Locked) or refresh.'
        }
      });
      return;
    }
    this.setState({ payjoinReceiveBusy: true, payjoinReceiveResult: null });
    try {
      const receiveWallet = getNextReceiveWalletContext((this.props && this.props.identity) || {});
      const session = await createPayjoinDeposit(this.state.upstream, receiveWallet, {
        address: addr,
        amountSats: Number(this.state.receivePayjoinAmountSats || 0),
        label: 'Payments receive',
        memo: ''
      });
      this.setState({ payjoinReceiveResult: session, payjoinReceiveBusy: false });
      try {
        const sid = String(session.id || '').trim();
        if (sid) {
          pushUiNotification({
            id: `payjoin-session-${sid}`,
            kind: 'payjoin',
            title: 'Payjoin receive link ready',
            subtitle: session.amountSats ? `${session.amountSats} sats` : 'BIP21 + pj',
            href: `/services/bitcoin/payments?payjoinSession=${encodeURIComponent(sid)}`,
            copyText: session.bip21Uri || session.proposalURL || sid
          });
        }
      } catch (e) { /* ignore */ }
      await this.refresh();
    } catch (error) {
      this.setState({
        payjoinReceiveBusy: false,
        payjoinReceiveResult: { error: error && error.message ? error.message : String(error) }
      });
    }
  }

  async handlePayLightning () {
    const invoice = String(this.state.lightningInvoice || '').trim();
    if (!invoice) return this.setState({ result: { error: 'Lightning invoice is required.' } });

    try {
      const result = await payLightningInvoice(this.state.upstream, this.state.wallet || {}, invoice);
      this.setState({
        result: result && result.error ? result : { ok: true },
        lightningInvoice: '',
        decodedInvoice: null
      });
      await this.refresh();
    } catch (error) {
      this.setState({ result: { error: error && error.message ? error.message : String(error) } });
    }
  }

  _adminTokenForBroadcast () {
    return readHubAdminTokenFromBrowser(this.props && this.props.adminToken);
  }

  async handleLocalPayjoinSend () {
    const identity = (this.props && this.props.identity) || {};
    const w = this.state.wallet || getSpendWalletContext(identity);
    const xprv = String(w.xprv || '').trim();
    const xpub = String(w.xpub || '').trim();
    if (!xprv || !xpub) {
      this.setState({ localPayjoinResult: { error: 'Unlock your identity (local signing material) to pay Payjoin in the app. Keys are not sent to the Hub.' } });
      return;
    }
    const parsed = parseBitcoinUriForPayjoin(this.state.to);
    if (!parsed || !parsed.pjUrl) {
      this.setState({ localPayjoinResult: { error: 'Paste a bitcoin: URI that includes pj= (Payjoin endpoint).' } });
      return;
    }
    const sendAmountSats = parsed.amountSats != null
      ? parsed.amountSats
      : Math.round(Number(this.state.amountSats || 0));
    if (!Number.isFinite(sendAmountSats) || sendAmountSats <= 0) {
      this.setState({ localPayjoinResult: { error: 'Set an amount in the URI or in the Amount (sats) field.' } });
      return;
    }
    const payAddress = String(parsed.address || '').trim();
    if (!payAddress) {
      this.setState({ localPayjoinResult: { error: 'URI is missing the payee address.' } });
      return;
    }

    const network = (this.props.bitcoin && this.props.bitcoin.network) ? String(this.props.bitcoin.network).toLowerCase() : 'regtest';
    const adminToken = this._adminTokenForBroadcast();
    if (!adminToken) {
      this.setState({
        localPayjoinResult: {
          error: 'Broadcasting requires the Hub admin token (setup token). The signed transaction is built locally; only the final hex is sent to your Hub for sendrawtransaction.'
        }
      });
      return;
    }

    this.setState({ localPayjoinBusy: true, localPayjoinResult: null });

    try {
      let utxos = Array.isArray(this.state.utxos) ? this.state.utxos : [];
      if (utxos.length === 0) {
        utxos = await fetchUTXOs(this.state.upstream, this.state.wallet || {}, { network });
      }
      let maxChangeIdx = -1;
      for (const u of utxos) {
        const ci = chainIndexFromDescriptor(u.desc);
        if (ci && ci.chain === 1) maxChangeIdx = Math.max(maxChangeIdx, ci.index);
      }
      const changeIndex = maxChangeIdx + 1;
      const changeAddress = deriveAddressFromXpub(xpub, 1, changeIndex, network);
      if (!changeAddress) throw new Error('Could not derive a change address.');

      const getPrevTxHex = (txid) => fetchTransactionHex(this.state.upstream, txid);

      const built = await buildOriginalSignedPayjoinPsbt({
        xprv,
        xpub,
        networkName: network,
        utxos,
        payAddress,
        sendAmountSats,
        changeAddress,
        getPrevTxHex
      });

      let proposed;
      try {
        proposed = await postPayjoinProposalWithDesktopFallback(parsed.pjUrl, built.psbtBase64);
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        const isDesk = typeof window !== 'undefined' && window.fabricDesktop && window.fabricDesktop.isDesktopShell;
        if (!isDesk && (/fetch/i.test(msg) || /Failed to fetch/i.test(msg) || /NetworkError/i.test(msg))) {
          throw new Error(`${msg} Browsers often block cross-origin Payjoin POST. Use the Fabric desktop app, or pay with an external wallet.`);
        }
        throw e;
      }

      const signedTwice = signOurPayjoinInputs(proposed, built.ourInputIndices, xprv, xpub, network);
      const hex = finalizeAndExtractHex(signedTwice, network);
      const out = await broadcastRawTransaction(this.state.upstream, hex, { adminToken });
      const txid = out && (out.txid || (out.result && out.result.txid));
      if (txid && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('clientBalanceUpdate'));
      }
      this.setState({
        localPayjoinBusy: false,
        localPayjoinResult: { ok: true, txid: txid || null, raw: out }
      });
      await this.refresh();
    } catch (error) {
      this.setState({
        localPayjoinBusy: false,
        localPayjoinResult: { error: error && error.message ? error.message : String(error) }
      });
    }
  }

  /**
   * Fabric Payjoin deposit URI + SIGHASH_ALL|ANYONECANPAY + Hub wallet co-input (admin).
   * BIP21 `pj=` must target this Hub’s `/services/payjoin/sessions/<id>/proposals`.
   */
  async handleAcpHubBoostPayjoin () {
    const identity = (this.props && this.props.identity) || {};
    const w = this.state.wallet || getSpendWalletContext(identity);
    const xprv = String(w.xprv || '').trim();
    const xpub = String(w.xpub || '').trim();
    if (!xprv || !xpub) {
      this.setState({ acpPayjoinResult: { error: 'Unlock your identity to sign locally (xprv never leaves the browser).' } });
      return;
    }
    const parsed = parseBitcoinUriForPayjoin(this.state.to);
    if (!parsed || !parsed.pjUrl) {
      this.setState({ acpPayjoinResult: { error: 'Paste a bitcoin: URI that includes pj=.' } });
      return;
    }
    const sessionId = extractFabricPayjoinSessionIdFromPjUrl(parsed.pjUrl);
    if (!sessionId) {
      this.setState({
        acpPayjoinResult: {
          error: 'For this flow, pj= must be this Hub’s payjoin proposals URL (…/payjoin/sessions/<id>/proposals). Create a session under Request Payment and paste its BIP21 URI.'
        }
      });
      return;
    }
    const sendAmountSats = parsed.amountSats != null
      ? parsed.amountSats
      : Math.round(Number(this.state.amountSats || 0));
    if (!Number.isFinite(sendAmountSats) || sendAmountSats <= 0) {
      this.setState({ acpPayjoinResult: { error: 'Set an amount in the URI or Amount (sats).' } });
      return;
    }
    const payAddress = String(parsed.address || '').trim();
    if (!payAddress) {
      this.setState({ acpPayjoinResult: { error: 'URI is missing the payee address.' } });
      return;
    }
    const network = (this.props.bitcoin && this.props.bitcoin.network) ? String(this.props.bitcoin.network).toLowerCase() : 'regtest';
    const adminToken = this._adminTokenForBroadcast();
    if (!adminToken) {
      this.setState({
        acpPayjoinResult: { error: 'Admin token required: Hub signs an extra wallet input and you broadcast via the Hub.' }
      });
      return;
    }

    this.setState({ acpPayjoinBusy: true, acpPayjoinResult: null });
    try {
      let utxos = Array.isArray(this.state.utxos) ? this.state.utxos : [];
      if (utxos.length === 0) {
        utxos = await fetchUTXOs(this.state.upstream, this.state.wallet || {}, { network });
      }
      let maxChangeIdx = -1;
      for (const u of utxos) {
        const ci = chainIndexFromDescriptor(u.desc);
        if (ci && ci.chain === 1) maxChangeIdx = Math.max(maxChangeIdx, ci.index);
      }
      const changeIndex = maxChangeIdx + 1;
      const changeAddress = deriveAddressFromXpub(xpub, 1, changeIndex, network);
      if (!changeAddress) throw new Error('Could not derive a change address.');
      const getPrevTxHex = (txid) => fetchTransactionHex(this.state.upstream, txid);

      const built = await buildOriginalSignedPayjoinPsbt({
        xprv,
        xpub,
        networkName: network,
        utxos,
        payAddress,
        sendAmountSats,
        changeAddress,
        getPrevTxHex,
        anyoneCanPayAll: true
      });

      await submitPayjoinProposal(this.state.upstream, sessionId, { psbt: built.psbtBase64 });

      const boosted = await applyPayjoinAcpHubBoost(
        this.state.upstream,
        sessionId,
        adminToken,
        { psbt: built.psbtBase64 }
      );
      if (!boosted || boosted.status !== 'success' || !boosted.psbtBase64) {
        const msg = (boosted && (boosted.message || boosted.error)) || 'ACP Hub boost failed';
        throw new Error(safeBriefMessage(msg, 'ACP Hub boost failed'));
      }

      const hex = finalizeAndExtractHex(boosted.psbtBase64, network);
      const out = await broadcastRawTransaction(this.state.upstream, hex, { adminToken });
      const txid = out && (out.txid || (out.result && out.result.txid));
      if (txid && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('clientBalanceUpdate'));
      }
      this.setState({
        acpPayjoinBusy: false,
        acpPayjoinResult: {
          ok: true,
          txid: txid || null,
          addedOutpoint: boosted.addedOutpoint,
          addedValueSats: boosted.addedValueSats,
          raw: out
        }
      });
      await this.refresh();
    } catch (error) {
      this.setState({
        acpPayjoinBusy: false,
        acpPayjoinResult: { error: error && error.message ? error.message : String(error) }
      });
    }
  }

  async handleSubmitPayjoinProposal () {
    const sessionId = String(this.state.payjoinSessionId || '').trim();
    const psbt = String(this.state.payjoinPsbt || '').trim();
    if (!sessionId) return this.setState({ payjoinResult: { error: 'Payjoin session ID is required.' } });
    if (!psbt) return this.setState({ payjoinResult: { error: 'PSBT is required for a Payjoin proposal.' } });

    try {
      const result = await submitPayjoinProposal(this.state.upstream, sessionId, { psbt });
      this.setState({ payjoinResult: result, payjoinPsbt: '' });
      try {
        const err = result && (result.error || result.message);
        if (!err) {
          pushUiNotification({
            id: `payjoin-proposal-${sessionId}-${Date.now()}`,
            kind: 'payjoin_proposal',
            title: 'Payjoin proposal submitted',
            subtitle: sessionId,
            href: `/services/bitcoin/payments?payjoinSession=${encodeURIComponent(sessionId)}`,
            copyText: sessionId
          });
        }
      } catch (e) { /* ignore */ }
      await this.refresh();
    } catch (error) {
      this.setState({ payjoinResult: { error: error && error.message ? error.message : String(error) } });
    }
  }

  render () {
    const transactionsOnly = !!(this.props && this.props.transactionsOnly);
    const wallet = this.state.wallet || {};
    const hasAdmin = !!readHubAdminTokenFromBrowser(this.props && this.props.adminToken);
    const summary = this.state.summary || {};
    const balanceSats = summary && Number.isFinite(summary.balanceSats) ? summary.balanceSats : (summary && summary.summary && summary.summary.trusted != null ? Math.round(Number(summary.summary.trusted) * 100000000) : null);
    const balanceDisplay = balanceSats != null
      ? (balanceSats >= 100000000 ? `${(balanceSats / 100000000).toFixed(4)} BTC` : `${formatSatsDisplay(balanceSats)} sats`)
      : 'n/a';
    const ln = this.state.lightningSummary || {};
    const lnChans = Array.isArray(this.state.lightningChannels) ? this.state.lightningChannels : [];
    const lnOutputs = Array.isArray(this.state.lightningOutputs) ? this.state.lightningOutputs : [];
    const lnManaged = this.getLightningBalanceFromOutputs(lnOutputs);
    const lnActive = !!(ln && (ln.available === true || ln.status === 'OK' || ln.status === 'STUB' || ln.status === 'RUNNING'));
    const sendTo = String(this.state.to || '').trim();
    const sendAmt = Number(this.state.amountSats);
    const canSendOnChainBase = !this.state.lightningInvoice && sendTo.length > 0 && Number.isFinite(sendAmt) && sendAmt > 0;
    const canSendOnChain = canSendOnChainBase && hasAdmin;
    const hubBitcoin = (this.props && this.props.bitcoin) || {};
    const hubWalletSats = Number(hubBitcoin && hubBitcoin.balanceSats != null
      ? hubBitcoin.balanceSats
      : Math.round(Number(hubBitcoin && hubBitcoin.balance != null ? hubBitcoin.balance : 0) * 1e8));
    const sharedSessionSats = Number(lnManaged.confirmed || 0) + Number(lnManaged.unconfirmed || 0) + Number(lnManaged.immature || 0);
    const payjoinSessions = Array.isArray(this.state.payjoinSessions) ? this.state.payjoinSessions : [];
    const payjoinOpenCount = payjoinSessions.filter((s) => {
      const status = String((s && s.status) || '').toLowerCase();
      return status !== 'expired' && status !== 'success';
    }).length;
    const l1Height = hubBitcoin.available && hubBitcoin.height != null && Number.isFinite(Number(hubBitcoin.height))
      ? Number(hubBitcoin.height)
      : null;
    const identityForWallet = (this.props && this.props.identity) || {};
    const walletCtx = getSpendWalletContext(identityForWallet);
    const btcWatchOnly = !!(walletCtx && walletCtx.xpub && !walletCtx.xprv);
    const extSigning = hasExternalSigningDelegation();
    return (
      <div className='fade-in'>
        <Segment loading={this.state.loading}>
          <section aria-labelledby="fabric-bitcoin-payments-h2" aria-describedby="fabric-bitcoin-payments-intro">
            <div
              role="banner"
              style={{
                position: 'sticky',
                top: '6.5rem',
                zIndex: 12,
                background: '#fff',
                paddingBottom: '0.35em',
                marginBottom: '0.25em',
                boxShadow: '0 1px 0 rgba(34, 36, 38, 0.15)',
                scrollMarginTop: '6.5rem'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.5em' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                  <Button as={Link} to="/services/bitcoin" basic size="small" aria-label="Back to Bitcoin explorer">
                    <Icon name="arrow left" aria-hidden="true" />
                    Explorer
                  </Button>
                  <Header as="h2" id="fabric-bitcoin-payments-h2" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.35em' }}>
                    <Icon name="credit card outline" aria-hidden="true" />
                    <Header.Content>{transactionsOnly ? 'Bitcoin Transactions' : 'Bitcoin Payments'}</Header.Content>
                  </Header>
                </div>
                <div role="toolbar" aria-label="Related Bitcoin pages" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center' }}>
                  <Button as={Link} to="/services/bitcoin/invoices#fabric-invoices-tab-demo" basic size="small" title="Receiver tab and walkthrough">
                    <Icon name="file alternate outline" aria-hidden="true" />
                    Invoices
                  </Button>
                  {!transactionsOnly ? (
                    <Button as={Link} to="/services/bitcoin/faucet" basic size="small" title="Regtest: fund an address from the Hub wallet">
                      <Icon name="tint" aria-hidden="true" />
                      Faucet
                    </Button>
                  ) : null}
                  <Button as={Link} to="/services/bitcoin/resources" basic size="small" title="HTTP resources and L1 payment verification">
                    <Icon name="sitemap" aria-hidden="true" />
                    Resources
                  </Button>
                  <Button as={Link} to="/services/bitcoin/crowdfunds" basic size="small" title="Taproot campaign vault, ACP PSBT, Payjoin deposit to vault">
                    <Icon name="heart outline" aria-hidden="true" />
                    Crowdfunds
                  </Button>
                </div>
              </div>
            </div>
            {this.state.error && <Message negative content={this.state.error} />}
            {!transactionsOnly ? (
              <div id="fabric-bitcoin-payments-intro">
              <Message info>
                <p style={{ margin: 0, color: '#333' }}>
                  <strong>Single Payjoin receiver &amp; Lightning path</strong>
                </p>
                <p style={{ margin: '0.35em 0 0', color: '#555' }}>
                  This Hub exposes one <strong>Payjoin</strong> endpoint (BIP77 deposit sessions; <code>pj=</code> is a standard BIP78 receiver URL for compatible wallets). <strong>Lightning</strong> uses the Hub&apos;s managed node.
                  On-chain <strong>receive</strong> and <strong>send</strong> default to Payjoin-oriented flows below; turn either off with the toggles when you want a plain address or a simple broadcast.
                </p>
              </Message>
              </div>
            ) : null}
          </section>
          <div style={{ marginBottom: '1em' }}>
            <strong>Balance:</strong> {balanceDisplay}
            {' '}
            <span style={{ color: '#666', fontSize: '0.9em' }}>
              (Wallet: <code>{wallet.walletId ? `${String(wallet.walletId).slice(0, 12)}…` : 'unavailable'}</code>)
            </span>
          </div>

          {!transactionsOnly ? (
            <BitcoinWalletBranchBar identity={(this.props && this.props.identity) || {}} />
          ) : null}

          {!transactionsOnly && (extSigning || btcWatchOnly) && (
            <Message warning size="small" style={{ marginBottom: '1em' }} id="fabric-payments-key-safety">
              <Message.Header>Keys and this screen</Message.Header>
              <p style={{ margin: '0.35em 0 0', color: '#333' }}>
                Receive addresses and header balance use your Fabric identity <strong>xpub</strong> (BIP44 account 0).{' '}
                <strong>Make Payment</strong> spends the <strong>Hub node wallet</strong> with the setup admin token, not private keys stored in this browser.
                In-browser <strong>Payjoin</strong> signing needs a fully unlocked local identity (xprv in this tab).{' '}
                <Link to="/settings/bitcoin-wallet">Bitcoin wallet &amp; derivation</Link>
                {' · '}
                <Link to="/settings/security">Security &amp; delegation</Link> — revoke desktop delegation on shared machines.
              </p>
            </Message>
          )}

          {!transactionsOnly ? (
            <Message info size="small" id="fabric-payments-tab-demo" style={{ marginBottom: '1em' }}>
            <Message.Header>Two-tab invoice payment (production walkthrough)</Message.Header>
            <List ordered relaxed style={{ margin: '0.35em 0 0', color: '#333' }}>
              <List.Item>
                <strong>Regtest funds:</strong> Fund the Hub wallet with <strong>Generate Block</strong> on{' '}
                <Link to="/services/bitcoin#fabric-bitcoin-regtest-toolbar">Bitcoin</Link>
                . Optionally use{' '}
                <Link to="/services/bitcoin/faucet">Faucet</Link>
                {' '}with <strong>Use my receive address</strong> on Bitcoin (next external address on BIP44 account 0 under your identity). Header balance uses the same account.
              </List.Item>
              <List.Item>
                Receiver tab:{' '}
                <Link to="/services/bitcoin/invoices#fabric-invoices-tab-demo">Invoices</Link>
                {' '}(same walkthrough banner). Create an invoice; receives use BIP44 account <strong>0</strong> under your Fabric identity.
              </List.Item>
              <List.Item>
                With <strong>Open payer tab (prefilled)</strong>, address and amount come from <code>payTo</code> / <code>payAmountSats</code> and the hash scrolls to Make Payment. Otherwise{' '}
                <a href="#fabric-btc-make-payment-h4">jump to Make Payment</a>
                {' '}and paste the invoice details (admin token required for Hub wallet broadcast).
              </List.Item>
              <List.Item>
                On the Invoices tab, use <strong>Confirm payment</strong> with the txid on the invoice card, or verify via{' '}
                <Link to="/services/bitcoin/resources">Resources</Link>.
              </List.Item>
              <List.Item>
                <strong>Documents:</strong>{' '}
                <Link to="/documents">Documents</Link>
                {' '}— <strong>Purchase</strong> (HTLC) and <strong>Distribute</strong> (storage contract) both settle on L1; the purchase modal accepts your paying txid or <strong>Pay from hub wallet</strong> (admin token). Same verifier as above if you need txid + address + amount.
              </List.Item>
              <List.Item>
                <strong>Optional — crowdfund:</strong>{' '}
                <Link to="/services/bitcoin/crowdfunds">Bitcoin → Crowdfunds</Link>
                {' '}creates a Taproot vault, copies an ACP outputs-only PSBT, or opens a Payjoin session that pays the vault (then pay here with the BIP21 link).
              </List.Item>
            </List>
            </Message>
          ) : null}
          {!transactionsOnly ? (
            <HubRegtestAdminTokenPanel
            network={(hubBitcoin && hubBitcoin.network) || 'regtest'}
            adminTokenProp={this.props && this.props.adminToken}
            />
          ) : null}

          {!transactionsOnly ? (
            <Segment
            style={{
              marginBottom: '1.25em',
              background: 'linear-gradient(160deg, #1b1d22 0%, #252830 55%, #1e2229 100%)',
              color: '#e4e6eb',
              border: '1px solid #3d424d',
              boxShadow: 'inset 0 1px 0 rgba(255,215,0,0.04)'
            }}
          >
            <section aria-labelledby="fabric-bitcoin-wealth-stack-h3" aria-describedby="fabric-bitcoin-wealth-stack-summary">
            <Header as="h3" id="fabric-bitcoin-wealth-stack-h3" style={{ color: '#f0d060', fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 500, marginBottom: '0.35em' }}>
              Bitcoin wealth stack
            </Header>
            <p id="fabric-bitcoin-wealth-stack-summary" style={{ margin: '0 0 0.85em', opacity: 0.88, fontSize: '0.92em', lineHeight: 1.45 }}>
              Three rails for accumulating and routing value: <strong style={{ color: '#9fd89f' }}>Fabric</strong> contracts and document exchange,
              {' '}Payjoin deposit coordination (BIP77 deposits + BIP78 <code>pj=</code>),
              and <strong style={{ color: '#7ec8e8' }}>Lightning</strong> channels on the Hub node.
              As the network grows, each rail can move real sats: documents tie to distribute / inventory flows; Payjoin sessions aggregate deposits; Lightning routes instant settlement.
            </p>
            {l1Height != null && (
              <p style={{ margin: '0 0 0.85em', opacity: 0.92, fontSize: '0.88em', lineHeight: 1.45, color: '#c8d0e0' }}>
                <strong style={{ color: '#f0d060' }}>L1 chain tip</strong> (this Hub&apos;s <code>bitcoind</code>):{' '}
                <Link to="/services/bitcoin" style={{ color: '#8ecfff' }}>height {l1Height.toLocaleString()}</Link>
                {' · '}new tips appear in <strong>Activity</strong> and are relayed to connected Fabric peers as a signed <code>BitcoinBlock</code> wire message.
              </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid #3a4a3a', borderRadius: 6, padding: '0.65rem 0.75rem' }}>
                <div style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: '#8fdf8f', marginBottom: '0.35em' }}>① FABRIC</div>
                <div style={{ fontSize: '0.88em' }}>Contracts, publish / distribute, peer inventory.</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', marginTop: '0.5em' }}>
                  <Button as={Link} to="/documents" size="small" basic inverted icon labelPosition="left">
                    <Icon name="file alternate outline" /> Documents
                  </Button>
                  <Button as={Link} to="/contracts" size="small" basic inverted icon labelPosition="left">
                    <Icon name="file code" /> Contracts
                  </Button>
                </div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid #5a5a32', borderRadius: 6, padding: '0.65rem 0.75rem' }}>
                <div style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: '#e8e070', marginBottom: '0.35em' }}>② COORDINATION</div>
                <div style={{ fontSize: '0.88em' }}>Payjoin sessions (BIP77) with live receiver state and proposal activity.</div>
                <div style={{ fontSize: '0.8em', color: '#aaa', marginTop: '0.35em' }}>
                  Receiver: {this.state.payjoinCapabilities && this.state.payjoinCapabilities.available ? <Label size="mini" color="green" horizontal>up</Label> : <Label size="mini" color="grey" horizontal>down</Label>}
                </div>
                <Button as={Link} to="/services/bitcoin/payments#wealth-payjoin-board" size="small" basic inverted style={{ marginTop: '0.5em' }} icon labelPosition="left">
                  <Icon name="shield alternate" /> Session board
                </Button>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid #2a4a5a', borderRadius: 6, padding: '0.65rem 0.75rem' }}>
                <div style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: '#7ec8e8', marginBottom: '0.35em' }}>③ LIGHTNING</div>
                <div style={{ fontSize: '0.88em' }}>
                  {lnActive ? (
                    <span>Hub LN · <strong>{lnChans.length}</strong> channel{lnChans.length === 1 ? '' : 's'} listed</span>
                  ) : (
                    <span>LN status: <code style={{ fontSize: '0.85em' }}>{ln.status || 'n/a'}</code></span>
                  )}
                </div>
                <Button as={Link} to="/services/bitcoin" size="small" basic inverted style={{ marginTop: '0.5em' }} icon labelPosition="left">
                  <Icon name="bolt" /> Bitcoin / LN
                </Button>
              </div>
            </div>
            </section>
            </Segment>
          ) : null}

          {!transactionsOnly ? (
            <Segment style={{ marginBottom: '1.25em', borderColor: '#d9e2f3', background: '#f8fbff' }}>
            <Header as="h3" style={{ marginBottom: '0.35em' }}>Deposits Under Management</Header>
            <p style={{ color: '#4b5b73', marginBottom: '0.75em', lineHeight: 1.45 }}>
              Non-admin users keep private keys in-browser. The Hub operator manages shared sessions (Payjoin receiver and Lightning/LSP channels) and may sign contract/session messages without taking custody of client keys.
            </p>
            <Table compact celled unstackable size="small" style={{ marginBottom: '0.65em' }}>
              <Table.Body>
                <Table.Row>
                  <Table.Cell width={6}><strong>Client wallet (self-custody)</strong></Table.Cell>
                  <Table.Cell>{formatSatsDisplay(Number(balanceSats || 0))} sats</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>Keys stay with the user in this browser.</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell><strong>Hub wallet (operator)</strong></Table.Cell>
                  <Table.Cell>{formatSatsDisplay(hubWalletSats)} sats</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>Hub node spend authority; admin token controls this surface.</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell><strong>Lightning managed liquidity</strong></Table.Cell>
                  <Table.Cell>{formatSatsDisplay(sharedSessionSats)} sats</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>
                    confirmed {formatSatsDisplay(lnManaged.confirmed)} · unconfirmed {formatSatsDisplay(lnManaged.unconfirmed)} · immature {formatSatsDisplay(lnManaged.immature)}
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell><strong>Payjoin sessions (shared)</strong></Table.Cell>
                  <Table.Cell>{payjoinOpenCount} open</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>{payjoinSessions.length} total sessions tracked.</Table.Cell>
                </Table.Row>
              </Table.Body>
            </Table>
            <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button as={Link} to="/services/lightning" size="small" basic icon labelPosition="left">
                <Icon name="bolt" /> Lightning channels
              </Button>
              <Button as={Link} to="/services/bitcoin/payments#wealth-payjoin-board" size="small" basic icon labelPosition="left">
                <Icon name="shield alternate" /> Payjoin sessions
              </Button>
              <Button as={Link} to="/settings/bitcoin-wallet" size="small" basic icon labelPosition="left">
                <Icon name="key" /> Wallet custody boundary
              </Button>
            </div>
            </Segment>
          ) : null}

          <section aria-labelledby="fabric-bitcoin-wallet-controls-h3">
          <Header as='h3' id="fabric-bitcoin-wallet-controls-h3" dividing>Wallet Controls</Header>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5em', marginBottom: '1em' }}>
            <Segment>
              <section aria-labelledby="fabric-btc-request-payment-h4" aria-describedby="fabric-btc-request-payment-desc">
              <Header as='h4' id="fabric-btc-request-payment-h4">
                <Icon name='qrcode' aria-hidden="true" />
                Request Payment
              </Header>
              <p id="fabric-btc-request-payment-desc" style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.5em' }}>
                Default: offer a <strong>Payjoin</strong> BIP21 link (BIP78-compatible). Plain address stays available for legacy wallets.
              </p>
              <div style={{ marginBottom: '0.65em' }}>
                <Checkbox
                  toggle
                  checked={!!this.state.payjoinPreferReceive}
                  disabled={!(this.state.payjoinCapabilities && this.state.payjoinCapabilities.available)}
                  onChange={(e, data) => {
                    const v = !!(data && data.checked);
                    savePayjoinPreferences({ paymentsReceive: v });
                    this.setState({ payjoinPreferReceive: v });
                  }}
                  label="Use Payjoin for this receive (on by default)"
                />
              </div>
              {this.state.payjoinPreferReceive && this.state.payjoinCapabilities && this.state.payjoinCapabilities.available && (
                <div style={{ marginBottom: '0.75em' }}>
                  <Form.Input
                    type="number"
                    min="0"
                    step="1"
                    label="Optional amount (sats) for BIP21"
                    placeholder="0 = any amount"
                    value={this.state.receivePayjoinAmountSats}
                    onChange={(e) => this.setState({ receivePayjoinAmountSats: e.target.value, payjoinReceiveResult: null })}
                  />
                  <Button
                    primary
                    loading={this.state.payjoinReceiveBusy}
                    disabled={!this.state.receiveAddress}
                    onClick={() => this.handleCreatePayjoinReceiveLink()}
                  >
                    <Icon name="shield alternate" />
                    Create Payjoin receive (BIP21 + pj)
                  </Button>
                  {this.state.payjoinReceiveResult && (
                    <Message
                      size="small"
                      style={{ marginTop: '0.5em' }}
                      negative={!!this.state.payjoinReceiveResult.error}
                      positive={!this.state.payjoinReceiveResult.error}
                    >
                      {this.state.payjoinReceiveResult.error ? (
                        <span>{this.state.payjoinReceiveResult.error}</span>
                      ) : (
                        <div>
                          <div style={{ marginBottom: '0.35em' }}><strong>Session</strong> <code>{this.state.payjoinReceiveResult.id}</code></div>
                          <Button
                            size="mini"
                            basic
                            type="button"
                            disabled={!this.state.payjoinReceiveResult.bip21Uri}
                            onClick={() => copyToClipboard(this.state.payjoinReceiveResult.bip21Uri || '')}
                          >
                            <Icon name="copy outline" /> Copy BIP21
                          </Button>
                          <Button as={Link} size="mini" primary to={this.state.payjoinReceiveResult.id ? `/services/bitcoin/payments?payjoinSession=${encodeURIComponent(this.state.payjoinReceiveResult.id)}` : '/services/bitcoin/payments'} style={{ marginLeft: '0.35em' }}>
                            Open PSBT panel
                          </Button>
                        </div>
                      )}
                    </Message>
                  )}
                </div>
              )}
              <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '0.35em' }}>Plain on-chain address</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                <code style={{ flex: '1 1 200px', wordBreak: 'break-all', fontSize: '0.85em' }} title={this.state.receiveAddress}>
                  {this.state.receiveAddress || '—'}
                </code>
                <Button
                  type="button"
                  size="small"
                  icon="copy"
                  title="Copy address"
                  aria-label="Copy receive address"
                  onClick={() => this.handleCopyAddress()}
                  disabled={!this.state.receiveAddress}
                />
                <Button
                  type="button"
                  size="small"
                  basic
                  icon="refresh"
                  title="New address"
                  aria-label="New receive address"
                  onClick={() => this.handleNextReceiveAddress()}
                  disabled={!wallet.xpub}
                />
              </div>
              <Button as={Link} to="/services/bitcoin/invoices#fabric-invoices-tab-demo" basic size="small" style={{ marginTop: '0.5em' }} title="Invoices walkthrough">
                <Icon name='file alternate outline' />
                Create Invoice
              </Button>
              </section>
            </Segment>

            <Segment style={{ marginTop: 0 }}>
              <section aria-labelledby="fabric-btc-make-payment-h4" aria-describedby="fabric-btc-make-payment-desc">
              <Header as='h4' id="fabric-btc-make-payment-h4">
                <Icon name='send' aria-hidden="true" />
                Make Payment
              </Header>
              <div id="fabric-btc-make-payment-desc">
              <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.5em' }}>
                On-chain send uses the <strong>Hub node wallet</strong> (same as Bitcoin home “Send Payment”); your <strong>setup admin token</strong> is required. For self-custody Payjoin, paste a <code>bitcoin:</code> URI with <code>pj=</code> and use local signing when your identity is unlocked.
              </p>
              <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.5em' }}>
                Send on-chain (default: prefer a <code>bitcoin:</code> URI that includes <code>pj=</code> for Payjoin) or pay Lightning.
              </p>
              {!hasAdmin ? (
                <Message warning size="small" style={{ marginBottom: '0.65em' }}>
                  <Message.Header>Hub-wallet send is admin-gated</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    You can still use this page for receive/history, but <strong>Send On-Chain</strong> requires the setup admin token.
                    Open <Link to="/settings/security">Security &amp; delegation</Link> to confirm session identity, then add/refresh the admin token in settings.
                  </p>
                </Message>
              ) : null}
              </div>
              <div style={{ marginBottom: '0.65em' }}>
                <Checkbox
                  toggle
                  checked={!!this.state.payjoinPreferSend}
                  onChange={(e, data) => {
                    const v = !!(data && data.checked);
                    savePayjoinPreferences({ paymentsSend: v });
                    this.setState({ payjoinPreferSend: v });
                  }}
                  label="Prefer Payjoin-compatible outgoing (on by default)"
                />
              </div>
              <Form>
                <Form.Field>
                  <label>Address or Lightning invoice</label>
                  <div style={{ display: 'flex', gap: '0.5em', alignItems: 'flex-start' }}>
                    <Form.Input
                      placeholder="bcrt1... or lnbc..."
                      value={this.state.lightningInvoice || this.state.to}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) {
                          this.setState({ result: null, to: '', lightningInvoice: '', decodedInvoice: null });
                        } else if (this.isLightningInvoice(v)) {
                          this.setState({ result: null, lightningInvoice: v, to: '' });
                          this.handleDecodeInvoice(v);
                        } else {
                          this.setState({ result: null, to: v, lightningInvoice: '', decodedInvoice: null });
                        }
                      }}
                      style={{ flex: 1 }}
                    />
                    <Button
                      type="button"
                      icon="camera"
                      title="Scan QR code"
                      aria-label="Scan QR code for address or Lightning invoice"
                      onClick={() => this.setState({ scanModalOpen: true })}
                    />
                  </div>
                </Form.Field>
                {this.state.decodedInvoice && (
                  <Message info size="small">
                    <strong>Lightning invoice:</strong> {this.state.decodedInvoice.num_satoshis ?? this.state.decodedInvoice.numSatoshis ?? '?'} sats
                    {this.state.decodedInvoice.description && ` — ${this.state.decodedInvoice.description}`}
                  </Message>
                )}
                {!this.state.lightningInvoice && this.state.payjoinPreferSend && this.state.to && (
                  this.isLikelyPayjoinBip21(this.state.to) ? (
                    <Message positive size="small">
                      <p style={{ margin: '0 0 0.5em' }}>
                        Detected a <code>bitcoin:</code> URI with <code>pj=</code>. You can pay in a Payjoin-capable external wallet, coordinate PSBT manually below, or — if your identity is unlocked — sign locally in the app (P2WPKH UTXOs from this Hub&apos;s scan; PSBT goes to the receiver&apos;s <code>pj=</code> URL only).
                      </p>
                      {(this.state.wallet && this.state.wallet.xprv) ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
                          <Button
                            type="button"
                            color="green"
                            size="small"
                            loading={this.state.localPayjoinBusy}
                            disabled={this.state.localPayjoinBusy || this.state.acpPayjoinBusy}
                            onClick={() => this.handleLocalPayjoinSend()}
                          >
                            Payjoin (sign locally)
                          </Button>
                          {extractFabricPayjoinSessionIdFromPjUrl((parseBitcoinUriForPayjoin(this.state.to) || {}).pjUrl || '') ? (
                            <Button
                              type="button"
                              color="violet"
                              size="small"
                              title="SIGHASH_ALL|ANYONECANPAY: Hub appends a wallet UTXO (admin token) without changing outputs — extra sats go to fee."
                              loading={this.state.acpPayjoinBusy}
                              disabled={this.state.acpPayjoinBusy || this.state.localPayjoinBusy}
                              onClick={() => this.handleAcpHubBoostPayjoin()}
                            >
                              ACP + Hub boost
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <span style={{ color: '#555', fontSize: '0.9em' }}>Unlock identity for local signing, or use an external wallet / desktop app if the payjoin host blocks browser CORS.</span>
                      )}
                      <p style={{ margin: '0.55em 0 0', fontSize: '0.88em', color: '#555' }}>
                        <strong>ACP + Hub boost</strong> appears when <code>pj=</code> targets this Hub&apos;s payjoin session. You sign with{' '}
                        <code>ANYONECANPAY|ALL</code>; the Hub (admin) adds and signs a hot-wallet input so the same outputs absorb more fee — payjoin-style privacy plus 2013-style input stitching.
                      </p>
                      {this.state.acpPayjoinResult && (
                        <div
                          style={{
                            marginTop: '0.65em',
                            padding: '0.5em 0.65em',
                            borderRadius: 4,
                            background: this.state.acpPayjoinResult.error ? '#fff6f6' : '#f3e5f5',
                            border: `1px solid ${this.state.acpPayjoinResult.error ? '#e0b4b4' : '#c6a1d8'}`,
                            color: '#333',
                            fontSize: '0.95em'
                          }}
                        >
                          {this.state.acpPayjoinResult.error ? (
                            <span>{this.state.acpPayjoinResult.error}</span>
                          ) : (
                            <span>
                              ACP payjoin broadcast
                              {this.state.acpPayjoinResult.txid ? (
                                <>
                                  {' '}
                                  <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(this.state.acpPayjoinResult.txid))}`}>
                                    <code style={{ fontSize: '0.9em' }}>{this.state.acpPayjoinResult.txid}</code>
                                  </Link>
                                </>
                              ) : null}
                              {this.state.acpPayjoinResult.addedOutpoint ? (
                                <span style={{ display: 'block', marginTop: '0.35em', fontSize: '0.9em' }}>
                                  Hub added input <code>{this.state.acpPayjoinResult.addedOutpoint}</code>
                                  {this.state.acpPayjoinResult.addedValueSats != null
                                    ? ` (${formatSatsDisplay(this.state.acpPayjoinResult.addedValueSats)} sats)`
                                    : null}
                                </span>
                              ) : null}
                            </span>
                          )}
                        </div>
                      )}
                      {this.state.localPayjoinResult && (
                        <div
                          style={{
                            marginTop: '0.65em',
                            padding: '0.5em 0.65em',
                            borderRadius: 4,
                            background: this.state.localPayjoinResult.error ? '#fff6f6' : '#fcfff5',
                            border: `1px solid ${this.state.localPayjoinResult.error ? '#e0b4b4' : '#a3c293'}`,
                            color: '#333',
                            fontSize: '0.95em'
                          }}
                        >
                          {this.state.localPayjoinResult.error ? (
                            <span>{this.state.localPayjoinResult.error}</span>
                          ) : (
                            <span>
                              Broadcast ok
                              {this.state.localPayjoinResult.txid ? (
                                <>
                                  {' '}
                                  <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(this.state.localPayjoinResult.txid))}`}>
                                    <code style={{ fontSize: '0.9em' }}>{this.state.localPayjoinResult.txid}</code>
                                  </Link>
                                </>
                              ) : null}
                            </span>
                          )}
                        </div>
                      )}
                    </Message>
                  ) : (
                    <Message warning size="small">
                      Payjoin preference is <strong>on</strong>: a bare on-chain address uses a <strong>standard</strong> Hub payment (no payjoin). For Payjoin, paste a BIP21 URI that includes <code>pj=</code>, or turn this toggle off for intentional plain sends.
                    </Message>
                  )
                )}
                {!this.state.lightningInvoice && (
                  <Form.Group widths='equal'>
                    <Form.Input label='Amount (sats)' type='number' min='1' step='1' placeholder='1000' value={this.state.amountSats} onChange={(e) => { this.setState({ amountSats: e.target.value, result: null }); }} />
                    <Form.Input label='Memo' placeholder='Optional' value={this.state.memo} onChange={(e) => this.setState({ memo: e.target.value })} />
                  </Form.Group>
                )}
                {this.state.lightningInvoice ? (
                  <Button type="button" primary aria-label="Pay Lightning invoice from Hub node" onClick={() => this.handlePayLightning()}>
                    <Icon name='bolt' />
                    Pay Lightning
                  </Button>
                ) : (
                  <Button
                    primary
                    type="button"
                    aria-label={
                      this.state.payjoinPreferSend && !this.isLikelyPayjoinBip21(this.state.to)
                        ? 'Send on-chain standard transaction from Hub wallet'
                        : 'Send on-chain from Hub wallet'
                    }
                    onClick={() => this.handleSend()}
                    disabled={!canSendOnChain}
                  >
                    <Icon name='send' />
                    {this.state.payjoinPreferSend && !this.isLikelyPayjoinBip21(this.state.to) ? 'Send On-Chain (standard)' : 'Send On-Chain'}
                  </Button>
                )}
              </Form>
              {!this.state.lightningInvoice && !canSendOnChain && !this.state.result && (
                <Message size="small" info style={{ marginTop: '0.65em' }}>
                  {!hasAdmin
                    ? 'Admin token required to send from the Hub wallet. You can still request payment and inspect wallet history.'
                    : sendTo.length === 0
                    ? 'Enter a recipient on-chain address or paste a bitcoin: URI (with optional pj= for Payjoin).'
                    : 'Set a positive amount in sats to enable send.'}
                </Message>
              )}
              {this.state.result && (
                <Message size="small" positive={!this.state.result.error} negative={!!this.state.result.error} style={{ marginTop: '0.5em' }}>
                  {this.state.result.error ? this.state.result.error : (
                    <>
                      {this.state.result.ok ? 'Payment successful.' : 'Payment submitted.'}
                      {(() => {
                        const r = this.state.result;
                        const tid = (r && r.payment && r.payment.txid) || (r && r.txid);
                        return tid ? (
                          <span style={{ display: 'block', marginTop: '0.5em' }}>
                            <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(tid))}`}>
                              View transaction
                            </Link>
                          </span>
                        ) : null;
                      })()}
                    </>
                  )}
                </Message>
              )}
              </section>
            </Segment>
          </div>
          </section>
        </Segment>

        <Segment>
          <section aria-labelledby="fabric-btc-tx-client-h3" aria-describedby="fabric-btc-tx-client-desc">
          <Header as='h3' id="fabric-btc-tx-client-h3">My Wallet Activity</Header>
          <p id="fabric-btc-tx-client-desc" style={{ color: '#666', marginBottom: '0.5em' }}>
            <strong>Client (xpub):</strong> this is your wallet history. Open any txid to inspect full details in the built-in explorer.
          </p>
          {!hasAdmin ? (
            <Message info size="small" style={{ marginBottom: '0.75em' }}>
              Non-admin mode: use this page like a normal Bitcoin wallet dashboard (balance + history). Hub-wallet send/broadcast actions remain admin-gated.
            </Message>
          ) : null}
          {this.state.transactions.length === 0 ? (
            <p style={{ color: '#666' }}>No transactions found for this wallet.</p>
          ) : (
            <Table compact='very' celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Txid</Table.HeaderCell>
                  <Table.HeaderCell>Contract</Table.HeaderCell>
                  <Table.HeaderCell>Amount</Table.HeaderCell>
                  <Table.HeaderCell>Confirmations</Table.HeaderCell>
                  <Table.HeaderCell>Time</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {this.state.transactions.map((tx, idx) => {
                  const amt = tx.ourAmount != null ? tx.ourAmount : tx.value;
                  const amtNum = Number(amt);
                  const isOutgoing = Number.isFinite(amtNum) ? amtNum < 0 : false;
                  const isIncoming = Number.isFinite(amtNum) ? amtNum > 0 : false;
                  const time = tx.blocktime != null ? tx.blocktime : tx.time;
                  const dateStr = time ? new Date(time * 1000).toLocaleString() : '-';
                  return (
                    <Table.Row key={`${tx.txid || 'tx'}:${idx}`}>
                      <Table.Cell>
                        {tx.txid ? (
                          <Link to={`/services/bitcoin/transactions/${encodeURIComponent(tx.txid)}`}>
                            <code style={{ fontSize: '0.85em' }} title={tx.txid}>
                              {`${tx.txid.slice(0, 8)}…${tx.txid.slice(-8)}`}
                            </code>
                          </Link>
                        ) : (
                          <code>-</code>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {tx.fabricContract && tx.fabricContract.label ? (
                          <Label size="small" color="blue" title={JSON.stringify(tx.fabricContract.meta || {})}>
                            {tx.fabricContract.label}
                          </Label>
                        ) : (
                          <span style={{ color: '#999' }}>—</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {amt != null ? `${Number(amt).toFixed(8)} BTC` : '-'}
                        {isOutgoing ? <Label size="mini" color="orange" style={{ marginLeft: '0.35em' }}>sent</Label> : null}
                        {isIncoming ? <Label size="mini" color="green" style={{ marginLeft: '0.35em' }}>received</Label> : null}
                      </Table.Cell>
                      <Table.Cell>
                        {tx.confirmations != null ? (
                          <>
                            {tx.confirmations}
                            {Number(tx.confirmations) === 0 && (
                              <Label size="mini" color="orange" style={{ marginLeft: '0.35em' }}>
                                mempool
                              </Label>
                            )}
                          </>
                        ) : '-'}
                      </Table.Cell>
                      <Table.Cell>{dateStr}</Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          )}
          </section>
        </Segment>

        {!transactionsOnly ? (
          <Segment>
          <section aria-labelledby="fabric-btc-mempool-h3" aria-describedby="fabric-btc-mempool-desc">
          <Header as='h3' id="fabric-btc-mempool-h3">Mempool Payments</Header>
          <p id="fabric-btc-mempool-desc" style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge (Hub node):</strong> mempool transactions.</p>
          {this.state.payments.length === 0 ? (
            <p style={{ color: '#666' }}>No mempool payments visible.</p>
          ) : (
            <Table compact='very' celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Txid</Table.HeaderCell>
                  <Table.HeaderCell>Fee</Table.HeaderCell>
                  <Table.HeaderCell>Value</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {this.state.payments.map((p, idx) => (
                  <Table.Row key={`${p.txid || 'tx'}:${idx}`}>
                    <Table.Cell>
                      {p.txid ? (
                        <span>
                          <Link to={`/services/bitcoin/transactions/${encodeURIComponent(p.txid)}`}>
                            <code style={{ fontSize: '0.85em' }} title={p.txid}>
                              {`${p.txid.slice(0, 8)}…${p.txid.slice(-8)}`}
                            </code>
                          </Link>
                          <Label size="mini" color="orange" style={{ marginLeft: '0.35em' }}>
                            unconfirmed
                          </Label>
                        </span>
                      ) : (
                        <code>-</code>
                      )}
                    </Table.Cell>
                    <Table.Cell>{p.fee != null ? p.fee : '-'}</Table.Cell>
                    <Table.Cell>{p.value != null ? `${p.value} BTC` : '-'}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
          </section>
          </Segment>
        ) : null}

        {!transactionsOnly ? (
          <Segment
          id="wealth-payjoin-board"
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            background: '#0c0c0e',
            color: '#b6e7b6',
            border: '1px solid #2e2e32',
            boxShadow: 'inset 0 0 40px rgba(0,40,0,0.15)',
            scrollMarginTop: '4.5rem'
          }}
        >
          <section aria-labelledby="fabric-btc-jm-board-h4" aria-describedby="fabric-btc-jm-board-desc">
          <Header as="h4" id="fabric-btc-jm-board-h4" style={{ fontFamily: 'inherit', color: '#f5e6a6', marginBottom: '0.5em' }}>
            Payjoin deposit session dashboard (BIP77)
          </Header>
          <p id="fabric-btc-jm-board-desc" style={{ color: '#7a9e7a', fontSize: '0.82rem', marginBottom: '0.65em' }}>
            Each row is a receiver deposit endpoint with current status, amount target, and proposal activity (<code>N_PROP</code>).
            Share the BIP21 + <code>pj=</code> URI from Request Payment to collect deposits.
          </p>
          <pre
            style={{
              margin: 0,
              padding: '0.65rem 0.75rem',
              background: '#080809',
              border: '1px solid #1f2228',
              borderRadius: 4,
              fontSize: '0.72rem',
              lineHeight: 1.5,
              overflow: 'auto',
              maxHeight: '22rem',
              color: '#c8e6c9'
            }}
          >
            {buildPayjoinSessionAscii(this.state.payjoinSessions)}
          </pre>
          </section>
          </Segment>
        ) : null}

        {!transactionsOnly ? (
          <Segment>
          <section aria-labelledby="fabric-btc-pj-proposals-h3" aria-describedby="fabric-btc-pj-proposals-intro">
          <Header as='h3' id="fabric-btc-pj-proposals-h3">Payjoin Proposals (BIP77)</Header>
          <div id="fabric-btc-pj-proposals-intro">
          <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge:</strong> Hub Payjoin service.</p>
          <p style={{ color: '#666' }}>
            Submit a sender PSBT against an active Payjoin session generated by the deposit flow.
          </p>
          </div>
          <Form>
            <Form.Input
              label='Payjoin Session ID'
              placeholder='session id'
              value={this.state.payjoinSessionId}
              onChange={(e) => this.setState({ payjoinSessionId: e.target.value })}
            />
            <Form.TextArea
              label='PSBT (base64)'
              rows={3}
              placeholder='cHNidP8...'
              value={this.state.payjoinPsbt}
              onChange={(e) => this.setState({ payjoinPsbt: e.target.value })}
            />
            <Button onClick={() => this.handleSubmitPayjoinProposal()}>
              <Icon name='exchange' />
              Submit Payjoin Proposal
            </Button>
          </Form>
          {this.state.payjoinResult && (
            <Message positive={!this.state.payjoinResult.error} negative={!!this.state.payjoinResult.error} style={{ marginTop: '1em' }}>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(this.state.payjoinResult, null, 2)}</pre>
            </Message>
          )}
          <section aria-labelledby="fabric-btc-pj-sessions-h4" aria-describedby="fabric-btc-pj-sessions-desc" style={{ marginTop: '1em' }}>
          <Header as='h4' id="fabric-btc-pj-sessions-h4" style={{ marginTop: 0 }}>Payjoin sessions &amp; proposals</Header>
          <p id="fabric-btc-pj-sessions-desc" style={{ color: '#666', marginBottom: '0.75em' }}>
            Includes expired sessions (append <code>?includeExpired=false</code> on the API to hide them). Each row lists proposal contracts (txid when derivable from PSBT / raw tx).
          </p>
          {this.state.payjoinSessions.length === 0 ? (
            <p style={{ color: '#666' }}>No Payjoin sessions found.</p>
          ) : (
            <Table compact='very' celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Session</Table.HeaderCell>
                  <Table.HeaderCell>Status</Table.HeaderCell>
                  <Table.HeaderCell>Label / memo</Table.HeaderCell>
                  <Table.HeaderCell>Address</Table.HeaderCell>
                  <Table.HeaderCell>Amount (sats)</Table.HeaderCell>
                  <Table.HeaderCell>Proposals</Table.HeaderCell>
                  <Table.HeaderCell>Actions</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {this.state.payjoinSessions.map((s, idx) => {
                  const expired = s.expiresAt && new Date(s.expiresAt).getTime() <= Date.now();
                  const proposals = Array.isArray(s.proposals) ? s.proposals : [];
                  return (
                    <Table.Row key={`${s.id || 's'}:${idx}`}>
                      <Table.Cell>
                        <code style={{ fontSize: '0.85em' }}>{s.id || '-'}</code>
                        {expired && (
                          <Label size="mini" color="grey" style={{ marginLeft: '0.35em' }}>expired</Label>
                        )}
                      </Table.Cell>
                      <Table.Cell>{s.status || '-'}</Table.Cell>
                      <Table.Cell>
                        {(s.label || s.memo) ? (
                          <span>{[s.label, s.memo].filter(Boolean).join(' · ')}</span>
                        ) : (
                          <span style={{ color: '#999' }}>—</span>
                        )}
                      </Table.Cell>
                      <Table.Cell><code style={{ fontSize: '0.8em' }}>{s.address || '-'}</code></Table.Cell>
                      <Table.Cell>{s.amountSats != null && s.amountSats > 0 ? String(s.amountSats) : '—'}</Table.Cell>
                      <Table.Cell>
                        {proposals.length === 0 ? (
                          <span style={{ color: '#999' }}>0</span>
                        ) : (
                          <div style={{ maxWidth: '28em' }}>
                            {proposals.map((p, j) => (
                              <div key={p.id || j} style={{ marginBottom: '0.35em' }}>
                                <Label size="small" color="teal" style={{ marginRight: '0.35em' }}>
                                  {p.status || 'proposal'}
                                </Label>
                                {p.proposalTxid ? (
                                  <Link to={`/services/bitcoin/transactions/${encodeURIComponent(p.proposalTxid)}`}>
                                    <code style={{ fontSize: '0.75em' }} title={p.proposalTxid}>
                                      {`${p.proposalTxid.slice(0, 10)}…${p.proposalTxid.slice(-8)}`}
                                    </code>
                                  </Link>
                                ) : (
                                  <span style={{ color: '#888', fontSize: '0.85em' }}>
                                    {p.hasPsbt || p.hasTxhex ? 'txid pending / partial PSBT' : '—'}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Button.Group size="small">
                          <Button
                            as={Link}
                            primary
                            disabled={!s.id}
                            to={s.id ? `/services/bitcoin/payments?payjoinSession=${encodeURIComponent(s.id)}` : '/services/bitcoin/payments'}
                            title="Fill the proposal form with this session"
                          >
                            Use for PSBT
                          </Button>
                          <Button
                            basic
                            icon
                            disabled={!s.bip21Uri}
                            title="Copy BIP21 URI"
                            onClick={() => s.bip21Uri && copyToClipboard(s.bip21Uri)}
                          >
                            <Icon name="copy outline" />
                          </Button>
                        </Button.Group>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          )}
          </section>
          </section>
          </Segment>
        ) : null}

        <Segment>
          <section aria-labelledby="fabric-btc-utxos-h3" aria-describedby="fabric-btc-utxos-desc">
          <Header as='h3' id="fabric-btc-utxos-h3">UTXOs</Header>
          <p id="fabric-btc-utxos-desc" style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge (Hub node):</strong> unspent outputs for wallet.</p>
          {this.state.utxos.length === 0 ? (
            <p style={{ color: '#666' }}>No UTXOs found for this wallet.</p>
          ) : (
            <Table compact='very' celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Txid</Table.HeaderCell>
                  <Table.HeaderCell>Vout</Table.HeaderCell>
                  <Table.HeaderCell>Amount</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {this.state.utxos.map((u, idx) => (
                  <Table.Row key={`${u.txid || 'u'}:${u.vout || 0}:${idx}`}>
                    <Table.Cell><code>{u.txid || '-'}</code></Table.Cell>
                    <Table.Cell>{u.vout != null ? u.vout : '-'}</Table.Cell>
                    <Table.Cell>{u.amount != null ? u.amount : (u.amountSats != null ? `${formatSatsDisplay(u.amountSats)} sats` : '-')}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
          </section>
        </Segment>

        <QrScannerModal
          open={this.state.scanModalOpen}
          onClose={() => this.setState({ scanModalOpen: false })}
          onScan={(text) => this.handleScanResult(text)}
        />
      </div>
    );
  }
}

module.exports = BitcoinPaymentsHome;
