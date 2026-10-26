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
  submitPayjoinProposal
} = require('../functions/bitcoinClient');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const {
  parseBitcoinUriForPayjoin,
  chainIndexFromDescriptor,
  buildOriginalSignedPayjoinPsbt,
  checkPayjoinProposal,
  signOurPayjoinInputs,
  finalizeAndExtractHex,
  postPayjoinProposalWithDesktopFallback
} = require('../functions/payjoinBrowserWallet');
const { formatSatsDisplay } = require('../functions/formatSats');
const { fabricIdentityNeedFullKeyPlain } = require('../functions/hubIdentityUiHints');
const txContractLabels = require('../functions/txContractLabels');
const invoiceStore = require('../functions/invoiceStore');
const { copyToClipboard, pushUiNotification } = require('../functions/uiNotifications');
const { SATS_PER_BTC } = require('../constants');
const QrScannerModal = require('./QrScannerModal');
const HubRegtestAdminTokenPanel = require('./HubRegtestAdminTokenPanel');
const BitcoinWalletBranchBar = require('./BitcoinWalletBranchBar');
const {
  loadFederationSpendingPrefs,
  mergePaymentMemoWithFederation
} = require('../functions/federationSpendingPrefs');
const { safeBriefMessage } = require('../functions/fabricSafeLog');
const { hasExternalSigningDelegation } = require('../functions/fabricDelegationLocal');
const t = require('../locales/en');

const L = t.payments.home;

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
  const [cSession, cSats, cStatus, cAddress, cProps, cExpires] = L.boardColumns;
  const head = `${cSession.padEnd(14)}  ${cSats.padStart(10)}  ${cStatus.padEnd(10)}  ${cAddress.padEnd(18)}  ${cProps.padStart(5)}  ${cExpires}`;
  const sep = '-'.repeat(80);
  const lines = [head, sep];
  for (let i = 0; i < Math.min(list.length, 16); i++) {
    const s = list[i] || {};
    const oid = String(s.id || '-').replace(/\s+/g, ' ').slice(0, 14).padEnd(14);
    const amt = s.amountSats != null && Number(s.amountSats) > 0 ? String(Math.round(Number(s.amountSats))) : L.boardAny;
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
    lines.push(`${oid}  ${amtf}  ${st}  ${ad}  ${String(n).padStart(5)}  ${ex}`);
  }
  if (list.length === 0) {
    lines.push(L.boardEmpty);
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
      payjoinReceiveUseJoinmarket: pjPref.receiveTaprootJoinmarket !== false,
      receivePayjoinAmountSats: '',
      payjoinReceiveBusy: false,
      payjoinReceiveResult: null,
      localPayjoinBusy: false,
      localPayjoinResult: null,
      lightningSummary: {},
      lightningChannels: [],
      lightningOutputs: [],
      recordFederationPayment: false
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
    const upstream = {
      ...this.state.upstream,
      hubAdminToken: readHubAdminTokenFromBrowser(this.props && this.props.adminToken) || ''
    };
    const network = (this.props.bitcoin && this.props.bitcoin.network) ? String(this.props.bitcoin.network).toLowerCase() : 'regtest';
    const deepLinkPatch = computeMakePaymentDeepLinkPatch(this.props);
    this.setState({ loading: true, error: null, wallet, ...deepLinkPatch });

    try {
      const [summary, address, utxos, payments, payjoinSessions, transactions, payjoinCapabilities, lightningSummary, lightningChannels] = await Promise.all([
        fetchWalletSummary(upstream, wallet, { network }).catch(() => ({})),
        fetchReceiveAddress(upstream, nextReceive, { network, identity }).catch(() => ''),
        fetchUTXOs(upstream, wallet, { network }).catch(() => []),
        fetchPayments(upstream, wallet, { limit: 50, network }).catch(() => []),
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
                nextState.amountSats = String(Math.round(amountBtc * SATS_PER_BTC));
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
    if (!to) return this.setState({ result: { error: L.errors.recipient } });
    if (!Number.isFinite(amountSats) || amountSats <= 0) return this.setState({ result: { error: L.errors.amount } });

    const adminToken = this._adminTokenForBroadcast();
    if (!adminToken) {
      return this.setState({
        result: {
          error: t.common.errors.adminTokenRequired
        }
      });
    }

    try {
      const memo = mergePaymentMemoWithFederation(
        this.state.memo,
        loadFederationSpendingPrefs(),
        !!this.state.recordFederationPayment
      );
      const result = await sendPayment(this.state.upstream, wallet, {
        to,
        amountSats,
        memo,
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
    const useJm = !!this.state.payjoinReceiveUseJoinmarket;
    const addr = String(this.state.receiveAddress || '').trim();
    if (!useJm && !addr) {
      const id = (this.props && this.props.identity) || {};
      this.setState({
        payjoinReceiveResult: {
          error: L.errors.receiveAddress(fabricIdentityNeedFullKeyPlain(id))
        }
      });
      return;
    }
    this.setState({ payjoinReceiveBusy: true, payjoinReceiveResult: null });
    try {
      const receiveWallet = getNextReceiveWalletContext((this.props && this.props.identity) || {});
      const session = await createPayjoinDeposit(this.state.upstream, receiveWallet, {
        ...(useJm
          ? { receiveTemplate: 'hub_taproot_v2' }
          : { address: addr }),
        amountSats: Number(this.state.receivePayjoinAmountSats || 0),
        label: L.receiveLinkLabel,
        memo: ''
      });
      this.setState({ payjoinReceiveResult: session, payjoinReceiveBusy: false });
      try {
        const sid = String(session.id || '').trim();
        if (sid) {
          pushUiNotification({
            id: `payjoin-session-${sid}`,
            kind: 'payjoin',
            title: L.notices.receiveReady,
            subtitle: session.amountSats ? L.notices.receiveAmount(session.amountSats) : L.notices.receiveAny,
            href: `/payments?payjoinSession=${encodeURIComponent(sid)}`,
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
    if (!invoice) return this.setState({ result: { error: L.errors.lightningInvoice } });

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
      this.setState({
        localPayjoinResult: {
          error: L.errors.localKeys(fabricIdentityNeedFullKeyPlain(identity))
        }
      });
      return;
    }
    const parsed = parseBitcoinUriForPayjoin(this.state.to);
    if (!parsed || !parsed.pjUrl) {
      this.setState({ localPayjoinResult: { error: L.errors.noPayjoinLink } });
      return;
    }
    const sendAmountSats = parsed.amountSats != null
      ? parsed.amountSats
      : Math.round(Number(this.state.amountSats || 0));
    if (!Number.isFinite(sendAmountSats) || sendAmountSats <= 0) {
      this.setState({ localPayjoinResult: { error: L.errors.noAmount } });
      return;
    }
    const payAddress = String(parsed.address || '').trim();
    if (!payAddress) {
      this.setState({ localPayjoinResult: { error: L.errors.noPayee } });
      return;
    }

    const network = (this.props.bitcoin && this.props.bitcoin.network) ? String(this.props.bitcoin.network).toLowerCase() : 'regtest';
    const adminToken = this._adminTokenForBroadcast();
    if (!adminToken) {
      this.setState({
        localPayjoinResult: {
          error: L.errors.broadcastToken
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
      if (!changeAddress) throw new Error(L.errors.changeAddress);

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
        proposed = await postPayjoinProposalWithDesktopFallback(parsed.pjUrl, built.psbtBase64, { params: built.params });
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        const isDesk = typeof window !== 'undefined' && window.fabricDesktop && window.fabricDesktop.isDesktopShell;
        if (!isDesk && (/fetch/i.test(msg) || /Failed to fetch/i.test(msg) || /NetworkError/i.test(msg))) {
          throw new Error(L.errors.browserBlocked(msg));
        }
        if (!/Payjoin endpoint returned/.test(msg)) throw e;
        proposed = null;
        built.declined = msg;
      }

      let hex;
      if (proposed) {
        try {
          checkPayjoinProposal(built.psbtBase64, proposed, { networkName: network, payAddress, params: built.params });
          hex = finalizeAndExtractHex(signOurPayjoinInputs(proposed, built.ourInputs, xprv, xpub, network), network);
        } catch (e) {
          built.declined = L.errors.proposalRefused(e && e.message ? e.message : String(e));
        }
      }
      // BIP78: when the receiver declines or its proposal fails our checks, pay with the original.
      if (!hex) hex = finalizeAndExtractHex(built.psbtBase64, network);
      const out = await broadcastRawTransaction(this.state.upstream, hex, { adminToken });
      const txid = out && (out.txid || (out.result && out.result.txid));
      if (txid && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('clientBalanceUpdate'));
      }
      this.setState({
        localPayjoinBusy: false,
        localPayjoinResult: { ok: true, txid: txid || null, raw: out, fallback: built.declined || null }
      });
      await this.refresh();
    } catch (error) {
      this.setState({
        localPayjoinBusy: false,
        localPayjoinResult: { error: error && error.message ? error.message : String(error) }
      });
    }
  }

  async handleSubmitPayjoinProposal () {
    const sessionId = String(this.state.payjoinSessionId || '').trim();
    const psbt = String(this.state.payjoinPsbt || '').trim();
    if (!sessionId) return this.setState({ payjoinResult: { error: L.errors.sessionRequired } });
    if (!psbt) return this.setState({ payjoinResult: { error: L.errors.psbtRequired } });

    try {
      const result = await submitPayjoinProposal(this.state.upstream, sessionId, { psbt });
      this.setState({ payjoinResult: result, payjoinPsbt: '' });
      try {
        const err = result && (result.error || result.message);
        if (!err) {
          pushUiNotification({
            id: `payjoin-proposal-${sessionId}-${Date.now()}`,
            kind: 'payjoin_proposal',
            title: L.notices.proposalSubmitted,
            subtitle: sessionId,
            href: `/payments?payjoinSession=${encodeURIComponent(sessionId)}`,
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
    const balanceSats = summary && Number.isFinite(summary.balanceSats) ? summary.balanceSats : (summary && summary.summary && summary.summary.trusted != null ? Math.round(Number(summary.summary.trusted) * SATS_PER_BTC) : null);
    const balanceDisplay = balanceSats != null
      ? (balanceSats >= SATS_PER_BTC ? `${(balanceSats / SATS_PER_BTC).toFixed(4)} BTC` : t.common.sats(balanceSats))
      : t.common.none;
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
      : Math.round(Number(hubBitcoin && hubBitcoin.balance != null ? hubBitcoin.balance : 0) * SATS_PER_BTC));
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
                  <Button as={Link} to="/services/bitcoin" basic size="small" title={L.backTitle}>
                    <Icon name="arrow left" aria-hidden="true" />
                    {L.back}
                  </Button>
                  <Header as="h2" id="fabric-bitcoin-payments-h2" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.35em' }}>
                    <Icon name="credit card outline" aria-hidden="true" />
                    <Header.Content>{transactionsOnly ? L.titleTransactions : L.title}</Header.Content>
                  </Header>
                </div>
                <div role="toolbar" aria-label={L.shortcutsLabel} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center' }}>
                  <Button as={Link} to="/services/bitcoin/invoices#fabric-invoices-tab-demo" basic size="small" title={L.invoicesTitle}>
                    <Icon name="file alternate outline" aria-hidden="true" />
                    {L.invoices}
                  </Button>
                  {!transactionsOnly ? (
                    <Button as={Link} to="/services/bitcoin/faucet" basic size="small" title={L.faucetTitle}>
                      <Icon name="tint" aria-hidden="true" />
                      {L.faucet}
                    </Button>
                  ) : null}
                  <Button as={Link} to="/services/bitcoin/resources" basic size="small" title={L.resourcesTitle}>
                    <Icon name="sitemap" aria-hidden="true" />
                    {L.resources}
                  </Button>
                  <Button as={Link} to="/services/coinjoin" basic size="small" title={L.coinjoinTitle}>
                    <Icon name="random" aria-hidden="true" />
                    {L.coinjoin}
                  </Button>
                  <Button as={Link} to="/services/bitcoin/crowdfunds" basic size="small" title={L.crowdfundsTitle}>
                    <Icon name="heart outline" aria-hidden="true" />
                    {L.crowdfunds}
                  </Button>
                </div>
              </div>
            </div>
            {this.state.error && <Message negative content={this.state.error} />}
            {!transactionsOnly ? (
              <div id="fabric-bitcoin-payments-intro">
              <Message info>
                <p style={{ margin: 0, color: '#333' }}>
                  <strong>{L.introTitle}</strong>
                </p>
                <p style={{ margin: '0.35em 0 0', color: '#555' }}>{L.intro}</p>
              </Message>
              </div>
            ) : null}
          </section>
          <div style={{ marginBottom: '1em' }}>
            <strong>{L.balance}</strong> {balanceDisplay}
            {' '}
            <span style={{ color: '#666', fontSize: '0.9em' }}>
              ({L.walletLabel} <code>{wallet.walletId ? `${String(wallet.walletId).slice(0, 12)}…` : L.walletUnavailable}</code>)
            </span>
          </div>

          {!transactionsOnly ? (
            <BitcoinWalletBranchBar identity={(this.props && this.props.identity) || {}} />
          ) : null}

          {!transactionsOnly && (extSigning || btcWatchOnly) && (
            <Message warning size="small" style={{ marginBottom: '1em' }} id="fabric-payments-key-safety">
              <Message.Header>{L.keysTitle}</Message.Header>
              <p style={{ margin: '0.35em 0 0', color: '#333' }}>
                {L.keysBody}{' '}
                <Link to="/settings/bitcoin-wallet">{L.keysWallet}</Link>
                {' · '}
                <Link to="/settings/security">{L.keysSecurity}</Link>. {L.keysSecurityAfter}
              </p>
            </Message>
          )}

          {!transactionsOnly ? (
            <Message info size="small" id="fabric-payments-tab-demo" style={{ marginBottom: '1em' }}>
            <Message.Header>{L.walkthroughTitle}</Message.Header>
            <List ordered relaxed style={{ margin: '0.35em 0 0', color: '#333' }}>
              <List.Item>
                <strong>{L.steps.funds.title}</strong> {L.steps.funds.before}{' '}
                <Link to="/services/bitcoin#fabric-bitcoin-regtest-toolbar">{L.steps.funds.link}</Link>
                {L.steps.funds.after}
              </List.Item>
              <List.Item>
                <strong>{L.steps.receiver.title}</strong> {L.steps.receiver.body}
              </List.Item>
              <List.Item>
                <strong>{L.steps.payer.title}</strong> {L.steps.payer.before}{' '}
                <a href="#fabric-btc-make-payment-h4">{L.steps.payer.link}</a>
                {' '}{L.steps.payer.after}
              </List.Item>
              <List.Item>
                <strong>{L.steps.confirm.title}</strong> {L.steps.confirm.body}
              </List.Item>
              <List.Item>
                <strong>{L.steps.documents.title}</strong> {L.steps.documents.before}{' '}
                <Link to="/documents">{L.steps.documents.link}</Link>
                {L.steps.documents.after}
              </List.Item>
              <List.Item>
                <strong>{L.steps.crowdfund.title}</strong> {L.steps.crowdfund.body}
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
              {L.stackTitle}
            </Header>
            <p id="fabric-bitcoin-wealth-stack-summary" style={{ margin: '0 0 0.85em', opacity: 0.88, fontSize: '0.92em', lineHeight: 1.45 }}>
              {L.stackSummary}
            </p>
            {l1Height != null && (
              <p style={{ margin: '0 0 0.85em', opacity: 0.92, fontSize: '0.88em', lineHeight: 1.45, color: '#c8d0e0' }}>
                <strong style={{ color: '#f0d060' }}>{L.tipBefore}</strong>{' '}
                <Link to="/services/bitcoin" style={{ color: '#8ecfff' }}>{l1Height.toLocaleString()}</Link>
                {'. '}{L.tipAfter}
              </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid #3a4a3a', borderRadius: 6, padding: '0.65rem 0.75rem' }}>
                <div style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: '#8fdf8f', marginBottom: '0.35em', textTransform: 'uppercase' }}>{L.railFabric}</div>
                <div style={{ fontSize: '0.88em' }}>{L.railFabricBody}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', marginTop: '0.5em' }}>
                  <Button as={Link} to="/documents" size="small" basic inverted icon labelPosition="left">
                    <Icon name="file alternate outline" /> {L.documents}
                  </Button>
                  <Button as={Link} to="/contracts" size="small" basic inverted icon labelPosition="left">
                    <Icon name="file code" /> {L.contracts}
                  </Button>
                </div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid #5a5a32', borderRadius: 6, padding: '0.65rem 0.75rem' }}>
                <div style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: '#e8e070', marginBottom: '0.35em', textTransform: 'uppercase' }}>{L.railPayjoin}</div>
                <div style={{ fontSize: '0.88em' }}>{L.railPayjoinBody}</div>
                <div style={{ fontSize: '0.8em', color: '#aaa', marginTop: '0.35em' }}>
                  {L.receiver} {this.state.payjoinCapabilities && this.state.payjoinCapabilities.available ? <Label size="mini" color="green" horizontal>{L.receiverUp}</Label> : <Label size="mini" color="grey" horizontal>{L.receiverDown}</Label>}
                </div>
                <Button as={Link} to="/payments#wealth-payjoin-board" size="small" basic inverted style={{ marginTop: '0.5em' }} icon labelPosition="left">
                  <Icon name="shield alternate" /> {L.sessionBoard}
                </Button>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid #2a4a5a', borderRadius: 6, padding: '0.65rem 0.75rem' }}>
                <div style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: '#7ec8e8', marginBottom: '0.35em', textTransform: 'uppercase' }}>{L.railLightning}</div>
                <div style={{ fontSize: '0.88em' }}>
                  {lnActive ? L.lightningChannels(lnChans.length) : L.lightningStatus(ln.status)}
                </div>
                <Button as={Link} to="/services/bitcoin" size="small" basic inverted style={{ marginTop: '0.5em' }} icon labelPosition="left">
                  <Icon name="bolt" /> {L.bitcoinLightning}
                </Button>
              </div>
            </div>
            </section>
            </Segment>
          ) : null}

          {!transactionsOnly ? (
            <Segment style={{ marginBottom: '1.25em', borderColor: '#d9e2f3', background: '#f8fbff' }}>
            <Header as="h3" style={{ marginBottom: '0.35em' }}>{L.depositsTitle}</Header>
            <p style={{ color: '#4b5b73', marginBottom: '0.75em', lineHeight: 1.45 }}>{L.depositsIntro}</p>
            <Table compact celled unstackable size="small" style={{ marginBottom: '0.65em' }}>
              <Table.Body>
                <Table.Row>
                  <Table.Cell width={6}><strong>{L.clientWallet}</strong></Table.Cell>
                  <Table.Cell>{t.common.sats(Number(balanceSats || 0))}</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>{L.clientWalletNote}</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell><strong>{L.hubWallet}</strong></Table.Cell>
                  <Table.Cell>{t.common.sats(hubWalletSats)}</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>{L.hubWalletNote}</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell><strong>{L.lightningLiquidity}</strong></Table.Cell>
                  <Table.Cell>{t.common.sats(sharedSessionSats)}</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>
                    {L.lightningBreakdown(formatSatsDisplay(lnManaged.confirmed), formatSatsDisplay(lnManaged.unconfirmed), formatSatsDisplay(lnManaged.immature))}
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell><strong>{L.payjoinSessions}</strong></Table.Cell>
                  <Table.Cell>{L.openCount(payjoinOpenCount)}</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>{L.totalSessions(payjoinSessions.length)}</Table.Cell>
                </Table.Row>
              </Table.Body>
            </Table>
            <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button as={Link} to="/services/lightning" size="small" basic icon labelPosition="left">
                <Icon name="bolt" /> {L.lightningChannelsLink}
              </Button>
              <Button as={Link} to="/settings/bitcoin-wallet" size="small" basic icon labelPosition="left">
                <Icon name="key" /> {L.custodyLink}
              </Button>
            </div>
            </Segment>
          ) : null}

          <section aria-labelledby="fabric-bitcoin-wallet-controls-h3">
          <Header as='h3' id="fabric-bitcoin-wallet-controls-h3" dividing>{L.controlsTitle}</Header>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5em', marginBottom: '1em' }}>
            <Segment>
              <section aria-labelledby="fabric-btc-request-payment-h4" aria-describedby="fabric-btc-request-payment-desc">
              <Header as='h4' id="fabric-btc-request-payment-h4">
                <Icon name='qrcode' aria-hidden="true" />
                {L.requestTitle}
              </Header>
              <p id="fabric-btc-request-payment-desc" style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.5em' }}>
                {L.requestIntro}
              </p>
              <div style={{ marginBottom: '0.65em' }}>
                <Checkbox
                  toggle
                  id="payments-payjoin-receive"
                  checked={!!this.state.payjoinPreferReceive}
                  disabled={!(this.state.payjoinCapabilities && this.state.payjoinCapabilities.available)}
                  onChange={(e, data) => {
                    const v = !!(data && data.checked);
                    savePayjoinPreferences({ paymentsReceive: v });
                    this.setState({ payjoinPreferReceive: v });
                  }}
                  label={L.usePayjoinReceive}
                />
              </div>
              <div style={{ marginBottom: '0.65em' }}>
                <Checkbox
                  toggle
                  id="payments-taproot-receive"
                  checked={!!this.state.payjoinReceiveUseJoinmarket}
                  disabled={!(this.state.payjoinCapabilities && this.state.payjoinCapabilities.available)}
                  onChange={(e, data) => {
                    const v = !!(data && data.checked);
                    savePayjoinPreferences({ receiveTaprootJoinmarket: v });
                    this.setState({ payjoinReceiveUseJoinmarket: v, payjoinReceiveResult: null });
                  }}
                  label={L.useTaprootReceive}
                />
              </div>
              {this.state.payjoinPreferReceive && this.state.payjoinCapabilities && this.state.payjoinCapabilities.available && (
                <div style={{ marginBottom: '0.75em' }}>
                  <Form.Input
                    id="payments-payjoin-amount"
                    type="number"
                    min="0"
                    step="1"
                    label={L.payjoinAmount}
                    placeholder="0"
                    aria-describedby="payments-payjoin-amount-hint"
                    value={this.state.receivePayjoinAmountSats}
                    onChange={(e) => this.setState({ receivePayjoinAmountSats: e.target.value, payjoinReceiveResult: null })}
                  />
                  <p id="payments-payjoin-amount-hint" style={{ color: '#888', fontSize: '0.85em', margin: '-0.5em 0 0.5em' }}>{L.payjoinAmountHint}</p>
                  <Button
                    primary
                    type="button"
                    loading={this.state.payjoinReceiveBusy}
                    disabled={!this.state.payjoinReceiveUseJoinmarket && !this.state.receiveAddress}
                    onClick={() => this.handleCreatePayjoinReceiveLink()}
                  >
                    <Icon name="shield alternate" />
                    {L.createPayjoinLink}
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
                          <div style={{ marginBottom: '0.35em' }}><strong>{L.session}</strong> <code>{this.state.payjoinReceiveResult.id}</code></div>
                          <Button
                            size="mini"
                            basic
                            type="button"
                            disabled={!this.state.payjoinReceiveResult.bip21Uri}
                            onClick={() => copyToClipboard(this.state.payjoinReceiveResult.bip21Uri || '')}
                          >
                            <Icon name="copy outline" /> {L.copyPaymentLink}
                          </Button>
                          <Button as={Link} size="mini" primary to={this.state.payjoinReceiveResult.id ? `/payments?payjoinSession=${encodeURIComponent(this.state.payjoinReceiveResult.id)}` : '/payments'} style={{ marginLeft: '0.35em' }}>
                            {L.openProposalForm}
                          </Button>
                        </div>
                      )}
                    </Message>
                  )}
                </div>
              )}
              <p id="payments-receive-address-label" style={{ color: '#888', fontSize: '0.85em', marginBottom: '0.35em' }}>{L.receiveAddress}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                <code aria-labelledby="payments-receive-address-label" style={{ flex: '1 1 200px', wordBreak: 'break-all', fontSize: '0.85em' }} title={this.state.receiveAddress}>
                  {this.state.receiveAddress || t.common.none}
                </code>
                <Button
                  type="button"
                  size="small"
                  icon="copy"
                  title={L.copyReceiveAddress}
                  aria-label={L.copyReceiveAddress}
                  onClick={() => this.handleCopyAddress()}
                  disabled={!this.state.receiveAddress}
                />
                <Button
                  type="button"
                  size="small"
                  basic
                  icon="refresh"
                  title={L.newReceiveAddress}
                  aria-label={L.newReceiveAddress}
                  onClick={() => this.handleNextReceiveAddress()}
                  disabled={!wallet.xpub}
                />
              </div>
              </section>
            </Segment>

            <Segment style={{ marginTop: 0 }}>
              <section aria-labelledby="fabric-btc-make-payment-h4" aria-describedby="fabric-btc-make-payment-desc">
              <Header as='h4' id="fabric-btc-make-payment-h4">
                <Icon name='send' aria-hidden="true" />
                {L.payTitle}
              </Header>
              <div id="fabric-btc-make-payment-desc">
              <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.5em' }}>{L.payIntro}</p>
              {!hasAdmin ? (
                <Message warning size="small" style={{ marginBottom: '0.65em' }}>
                  <Message.Header>{L.adminTitle}</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    {L.adminBefore} <Link to="/settings/security">{L.adminLink}</Link>{L.adminAfter}
                  </p>
                </Message>
              ) : null}
              </div>
              <div style={{ marginBottom: '0.65em' }}>
                <Checkbox
                  toggle
                  id="payments-payjoin-send"
                  checked={!!this.state.payjoinPreferSend}
                  onChange={(e, data) => {
                    const v = !!(data && data.checked);
                    savePayjoinPreferences({ paymentsSend: v });
                    this.setState({ payjoinPreferSend: v });
                  }}
                  label={L.preferPayjoinSend}
                />
              </div>
              <div style={{ marginBottom: '0.65em' }}>
                <Checkbox
                  id="payments-federation-memo"
                  checked={!!this.state.recordFederationPayment}
                  onChange={(_, data) => this.setState({ recordFederationPayment: !!(data && data.checked) })}
                  label={
                    <label htmlFor="payments-federation-memo">
                      {L.federationMemoBefore}{' '}
                      <Link to="/services/bitcoin/transactions?scope=wallet#fabric-federation-wallet-panel">{L.federationMemoLink}</Link>{' '}
                      {L.federationMemoAfter}
                    </label>
                  }
                />
              </div>
              <Form>
                <Form.Field>
                  <label htmlFor="payments-send-to">{L.toLabel}</label>
                  <div style={{ display: 'flex', gap: '0.5em', alignItems: 'flex-start' }}>
                    <Form.Input
                      id="payments-send-to"
                      placeholder={L.toPlaceholder}
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
                      title={L.scanQr}
                      aria-label={L.scanQr}
                      onClick={() => this.setState({ scanModalOpen: true })}
                    />
                  </div>
                </Form.Field>
                {this.state.decodedInvoice && (
                  <Message info size="small">
                    {L.lightningInvoice(
                      this.state.decodedInvoice.num_satoshis ?? this.state.decodedInvoice.numSatoshis ?? L.unknownAmount,
                      this.state.decodedInvoice.description
                    )}
                  </Message>
                )}
                {!this.state.lightningInvoice && this.state.payjoinPreferSend && this.state.to && (
                  this.isLikelyPayjoinBip21(this.state.to) ? (
                    <Message positive size="small">
                      <p style={{ margin: '0 0 0.5em' }}>{L.payjoinDetected}</p>
                      {(this.state.wallet && this.state.wallet.xprv) ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
                          <Button
                            type="button"
                            color="green"
                            size="small"
                            loading={this.state.localPayjoinBusy}
                            disabled={this.state.localPayjoinBusy}
                            onClick={() => this.handleLocalPayjoinSend()}
                          >
                            {L.signLocally}
                          </Button>
                        </div>
                      ) : (
                        <span style={{ color: '#555', fontSize: '0.9em' }}>{L.unlockForPayjoin}</span>
                      )}
                      <p style={{ margin: '0.55em 0 0', fontSize: '0.88em', color: '#555' }}>{L.payjoinChecks}</p>
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
                              {L.broadcastOk}
                              {this.state.localPayjoinResult.txid ? (
                                <>
                                  {' '}
                                  <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(this.state.localPayjoinResult.txid))}`}>
                                    <code style={{ fontSize: '0.9em' }}>{this.state.localPayjoinResult.txid}</code>
                                  </Link>
                                </>
                              ) : null}
                              {this.state.localPayjoinResult.fallback ? (
                                <span style={{ display: 'block', marginTop: '0.35em', fontSize: '0.9em' }}>
                                  {L.sentPlain(this.state.localPayjoinResult.fallback)}
                                </span>
                              ) : null}
                            </span>
                          )}
                        </div>
                      )}
                    </Message>
                  ) : (
                    <Message warning size="small">{L.plainAddressWarning}</Message>
                  )
                )}
                {!this.state.lightningInvoice && (
                  <Form.Group widths='equal'>
                    <Form.Input id="payments-send-amount" label={L.amount} type='number' min='1' step='1' placeholder='1000' value={this.state.amountSats} onChange={(e) => { this.setState({ amountSats: e.target.value, result: null }); }} />
                    <Form.Input id="payments-send-memo" label={L.memo} placeholder={L.memoPlaceholder} value={this.state.memo} onChange={(e) => this.setState({ memo: e.target.value })} />
                  </Form.Group>
                )}
                {this.state.lightningInvoice ? (
                  <Button type="button" primary onClick={() => this.handlePayLightning()}>
                    <Icon name='bolt' />
                    {L.payLightning}
                  </Button>
                ) : (
                  <Button
                    primary
                    type="button"
                    onClick={() => this.handleSend()}
                    disabled={!canSendOnChain}
                  >
                    <Icon name='send' />
                    {this.state.payjoinPreferSend && !this.isLikelyPayjoinBip21(this.state.to) ? L.sendPlain : L.send}
                  </Button>
                )}
              </Form>
              {!this.state.lightningInvoice && !canSendOnChain && !this.state.result && (
                <Message size="small" info style={{ marginTop: '0.65em' }}>
                  {!hasAdmin
                    ? L.sendBlocked.admin
                    : sendTo.length === 0
                    ? L.sendBlocked.recipient
                    : L.sendBlocked.amount}
                </Message>
              )}
              {this.state.result && (
                <Message size="small" positive={!this.state.result.error} negative={!!this.state.result.error} style={{ marginTop: '0.5em' }}>
                  {this.state.result.error ? this.state.result.error : (
                    <>
                      {this.state.result.ok ? L.paymentDone : L.paymentSubmitted}
                      {(() => {
                        const r = this.state.result;
                        const tid = (r && r.payment && r.payment.txid) || (r && r.txid);
                        return tid ? (
                          <span style={{ display: 'block', marginTop: '0.5em' }}>
                            <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(tid))}`}>
                              {L.viewTransaction}
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
          <Header as='h3' id="fabric-btc-tx-client-h3">{L.activityTitle}</Header>
          <p id="fabric-btc-tx-client-desc" style={{ color: '#666', marginBottom: '0.5em' }}>{L.activityIntro}</p>
          {!hasAdmin ? (
            <Message info size="small" style={{ marginBottom: '0.75em' }}>{L.activityNoAdmin}</Message>
          ) : null}
          {this.state.transactions.length === 0 ? (
            <p style={{ color: '#666' }}>{L.noTransactions}</p>
          ) : (
            <Table compact='very' celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{L.colTransaction}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colContract}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colAmount}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colConfirmations}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colTime}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {this.state.transactions.map((tx, idx) => {
                  const amt = tx.ourAmount != null ? tx.ourAmount : tx.value;
                  const amtNum = Number(amt);
                  const isOutgoing = Number.isFinite(amtNum) ? amtNum < 0 : false;
                  const isIncoming = Number.isFinite(amtNum) ? amtNum > 0 : false;
                  const time = tx.blocktime != null ? tx.blocktime : tx.time;
                  const dateStr = time ? new Date(time * 1000).toLocaleString() : t.common.none;
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
                          <code>{t.common.none}</code>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {tx.fabricContract && tx.fabricContract.label ? (
                          <Label size="small" color="blue">
                            {tx.fabricContract.label}
                          </Label>
                        ) : (
                          <span style={{ color: '#999' }}>{t.common.none}</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {amt != null ? `${Number(amt).toFixed(8)} BTC` : t.common.none}
                        {isOutgoing ? <Label size="mini" color="orange" style={{ marginLeft: '0.35em' }}>{L.sent}</Label> : null}
                        {isIncoming ? <Label size="mini" color="green" style={{ marginLeft: '0.35em' }}>{L.received}</Label> : null}
                      </Table.Cell>
                      <Table.Cell>
                        {tx.confirmations != null ? (
                          <>
                            {tx.confirmations}
                            {Number(tx.confirmations) === 0 && (
                              <Label size="mini" color="orange" style={{ marginLeft: '0.35em' }}>
                                {L.unconfirmed}
                              </Label>
                            )}
                          </>
                        ) : t.common.none}
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
          <Header as='h3' id="fabric-btc-mempool-h3">{L.mempoolTitle}</Header>
          <p id="fabric-btc-mempool-desc" style={{ color: '#666', marginBottom: '0.5em' }}>{L.mempoolIntro}</p>
          {this.state.payments.length === 0 ? (
            <p style={{ color: '#666' }}>{L.noMempool}</p>
          ) : (
            <Table compact='very' celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{L.colTransaction}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colFee}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colValue}</Table.HeaderCell>
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
                            {L.unconfirmed}
                          </Label>
                        </span>
                      ) : (
                        <code>{t.common.none}</code>
                      )}
                    </Table.Cell>
                    <Table.Cell>{p.fee != null && Number.isFinite(Number(p.fee)) ? t.common.sats(Math.round(Math.abs(Number(p.fee)) * SATS_PER_BTC)) : t.common.none}</Table.Cell>
                    <Table.Cell>{p.value != null && Number.isFinite(Number(p.value)) ? t.common.sats(Math.round(Number(p.value) * SATS_PER_BTC)) : t.common.none}</Table.Cell>
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
          data-testid="hub-payjoin-board"
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
            {L.boardTitle}
          </Header>
          <p id="fabric-btc-jm-board-desc" style={{ color: '#7a9e7a', fontSize: '0.82rem', marginBottom: '0.65em' }}>
            {L.boardIntro}
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
          <Header as='h3' id="fabric-btc-pj-proposals-h3">{L.proposalsTitle}</Header>
          <div id="fabric-btc-pj-proposals-intro">
          <p style={{ color: '#666' }}>{L.proposalsIntro}</p>
          </div>
          <Form>
            <Form.Input
              id="payments-proposal-session"
              label={L.proposalSession}
              placeholder={L.proposalSessionPlaceholder}
              value={this.state.payjoinSessionId}
              onChange={(e) => this.setState({ payjoinSessionId: e.target.value })}
            />
            <Form.TextArea
              id="payments-proposal-psbt"
              label={L.proposalPsbt}
              rows={3}
              placeholder={L.proposalPsbtPlaceholder}
              value={this.state.payjoinPsbt}
              onChange={(e) => this.setState({ payjoinPsbt: e.target.value })}
            />
            <Button type="button" onClick={() => this.handleSubmitPayjoinProposal()}>
              <Icon name='exchange' />
              {L.submitProposal}
            </Button>
          </Form>
          {this.state.payjoinResult && (
            <Message positive={!this.state.payjoinResult.error} negative={!!this.state.payjoinResult.error} style={{ marginTop: '1em' }}>
              <p style={{ margin: 0 }}>{this.state.payjoinResult.error ? this.state.payjoinResult.error : L.proposalAccepted}</p>
              <details className="hub-developer-details" style={{ marginTop: '0.5em' }}>
                <summary>{t.common.developerDetails}</summary>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(this.state.payjoinResult, null, 2)}</pre>
              </details>
            </Message>
          )}
          <section aria-labelledby="fabric-btc-pj-sessions-h4" aria-describedby="fabric-btc-pj-sessions-desc" style={{ marginTop: '1em' }}>
          <Header as='h4' id="fabric-btc-pj-sessions-h4" style={{ marginTop: 0 }}>{L.sessionsTitle}</Header>
          <p id="fabric-btc-pj-sessions-desc" style={{ color: '#666', marginBottom: '0.75em' }}>{L.sessionsIntro}</p>
          {this.state.payjoinSessions.length === 0 ? (
            <p style={{ color: '#666' }}>{L.noSessions}</p>
          ) : (
            <Table compact='very' celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{L.colSession}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colStatus}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colLabel}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colAddress}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colSats}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colProposals}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colActions}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {this.state.payjoinSessions.map((s, idx) => {
                  const expired = s.expiresAt && new Date(s.expiresAt).getTime() <= Date.now();
                  const proposals = Array.isArray(s.proposals) ? s.proposals : [];
                  return (
                    <Table.Row key={`${s.id || 's'}:${idx}`}>
                      <Table.Cell>
                        <code style={{ fontSize: '0.85em' }}>{s.id || t.common.none}</code>
                        {expired && (
                          <Label size="mini" color="grey" style={{ marginLeft: '0.35em' }}>{L.expired}</Label>
                        )}
                      </Table.Cell>
                      <Table.Cell>{s.status || t.common.none}</Table.Cell>
                      <Table.Cell>
                        {(s.label || s.memo) ? (
                          <span>{[s.label, s.memo].filter(Boolean).join(' · ')}</span>
                        ) : (
                          <span style={{ color: '#999' }}>{t.common.none}</span>
                        )}
                      </Table.Cell>
                      <Table.Cell><code style={{ fontSize: '0.8em' }}>{s.address || t.common.none}</code></Table.Cell>
                      <Table.Cell>{s.amountSats != null && s.amountSats > 0 ? String(s.amountSats) : t.common.none}</Table.Cell>
                      <Table.Cell>
                        {proposals.length === 0 ? (
                          <span style={{ color: '#999' }}>0</span>
                        ) : (
                          <div style={{ maxWidth: '28em' }}>
                            {proposals.map((p, j) => (
                              <div key={p.id || j} style={{ marginBottom: '0.35em' }}>
                                <Label size="small" color="teal" style={{ marginRight: '0.35em' }}>
                                  {p.status || L.proposal}
                                </Label>
                                {p.proposalTxid ? (
                                  <Link to={`/services/bitcoin/transactions/${encodeURIComponent(p.proposalTxid)}`}>
                                    <code style={{ fontSize: '0.75em' }} title={p.proposalTxid}>
                                      {`${p.proposalTxid.slice(0, 10)}…${p.proposalTxid.slice(-8)}`}
                                    </code>
                                  </Link>
                                ) : (
                                  <span style={{ color: '#888', fontSize: '0.85em' }}>
                                    {p.hasPsbt || p.hasTxhex ? L.txidPending : t.common.none}
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
                            to={s.id ? `/payments?payjoinSession=${encodeURIComponent(s.id)}` : '/payments'}
                            title={L.useSessionTitle}
                          >
                            {L.useSession}
                          </Button>
                          <Button
                            basic
                            icon
                            type="button"
                            disabled={!s.bip21Uri}
                            title={L.copySessionLink}
                            aria-label={L.copySessionLink}
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
          <Header as='h3' id="fabric-btc-utxos-h3">{L.utxosTitle}</Header>
          <p id="fabric-btc-utxos-desc" style={{ color: '#666', marginBottom: '0.5em' }}>{L.utxosIntro}</p>
          {this.state.utxos.length === 0 ? (
            <p style={{ color: '#666' }}>{L.noUtxos}</p>
          ) : (
            <Table compact='very' celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{L.colTransaction}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colOutput}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colAmount}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {this.state.utxos.map((u, idx) => (
                  <Table.Row key={`${u.txid || 'u'}:${u.vout || 0}:${idx}`}>
                    <Table.Cell><code>{u.txid || t.common.none}</code></Table.Cell>
                    <Table.Cell>{u.vout != null ? u.vout : t.common.none}</Table.Cell>
                    <Table.Cell>{u.amount != null ? u.amount : (u.amountSats != null ? t.common.sats(u.amountSats) : t.common.none)}</Table.Cell>
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
