'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Checkbox,
  Form,
  Header,
  Icon,
  Input,
  List,
  Loader,
  Message,
  Modal,
  Segment,
  Table
} = require('semantic-ui-react');

const {
  clearBalanceCache,
  createLightningChannel,
  createLightningInvoice,
  createPayjoinDeposit,
  decodeLightningInvoice,
  deriveAndStoreReceiveAddress,
  fetchAddressBalance,
  fetchBitcoinStatus,
  fetchBitcoinPeers,
  fetchBitcoinNetworkSummary,
  broadcastRawTransaction,
  fetchExplorerData,
  fetchLightningChannels,
  fetchLightningStatus,
  fetchPayjoinCapabilities,
  fetchPayjoinSessions,
  fetchPayjoinSession,
  fetchReceiveAddress,
  fetchUTXOs,
  fetchWalletSummary,
  fetchWalletSummaryWithCache,
  getSpendWalletContext,
  getNextReceiveWalletContext,
  loadUpstreamSettings,
  loadPayjoinPreferences,
  savePayjoinPreferences,
  payLightningInvoice,
  reserveNextReceiveAddress,
  saveUpstreamSettings,
  sendPayment,
  generateBlock,
  requestFaucet
} = require('../functions/bitcoinClient');
const { formatBtcFromSats } = require('../functions/formatSats');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { copyToClipboard, pushUiNotification } = require('../functions/uiNotifications');
const { loadHubUiFeatureFlags, subscribeHubUiFeatureFlags } = require('../functions/hubUiFeatureFlags');
const { SATS_PER_BTC, UI_NUMBER_LOG_EXP_THRESHOLD } = require('../constants');
const HubRegtestAdminTokenPanel = require('./HubRegtestAdminTokenPanel');
const BitcoinWalletBranchBar = require('./BitcoinWalletBranchBar');
const t = require('../locales/en');

const c = t.bitcoin.home;
const shared = t.bitcoin.shared;
const health = t.bitcoin.health;

function bitcoinHealthState (status) {
  if (!status || typeof status !== 'object') return 'unknown';
  if (status.available === true) return 'ok';
  const code = String(status.status || '').toUpperCase();
  if (code === 'STARTING') return 'starting';
  if (code === 'UNAVAILABLE') return 'off';
  if (code) return 'unreachable';
  return 'unknown';
}

class BitcoinHome extends React.Component {
  constructor (props) {
    super(props);

    const upstream = loadUpstreamSettings();
    const payjoinPrefs = loadPayjoinPreferences();
    this.state = {
      loading: true,
      refreshing: false,
      error: null,
      advancedOpen: false,
      settingsOpen: false,
      upstreamDraft: { ...upstream },
      upstream,
      wallet: {
        walletId: '',
        fingerprint: '',
        xpub: '',
        hasPrivateKey: false,
        balanceSats: 0,
        confirmedSats: 0,
        unconfirmedSats: 0,
          address: '',
          receiveIndex: 0
      },
      blocks: [],
      transactions: [],
      utxos: [],
      paymentTo: '',
      paymentAmountSats: '',
      paymentMemo: '',
      invoiceAmountSats: '',
      invoiceMemo: '',
      invoiceInput: '',
      payjoinEnabled: !!payjoinPrefs.operatorDeposit,
      payjoinAmountSats: '',
      payjoinLabel: '',
      payjoinMemo: '',
      payjoinSessionId: '',
      payjoinResult: null,
      payjoinCapabilities: { available: false },
      payjoinSessionsSnapshot: null,
      bitcoinStatus: { available: false, status: 'STARTING' },
      lightningStatus: { available: false, status: 'UNAVAILABLE' },
      lightningChannels: [],
      lightningOutputs: [],
      channelCreateRemote: '',
      channelCreateAmountSats: '100000',
      channelCreatePushMsat: '',
      channelCreateResult: null,
      channelCreateLoading: false,
      paymentResult: null,
      lightningResult: null,
      faucetAddress: '',
      faucetAmountSats: '10000',
      faucetResult: null,
      lookupAddress: '',
      lookupResult: null,
      lookupLoading: false,
      nodePeers: [],
      nodeNetwork: {},
      rawTxHex: '',
      rawTxResult: null,
      txLookupId: '',
      txLookupError: null,
      hubUiFlagsRev: 0,
      bitcoinPeerSortColumn: 'bytes',
      bitcoinPeerSortDirection: 'descending'
    };
    this._onBitcoinHashChange = () => this._syncBitcoinHashScroll();
  }

  _syncBitcoinHashScroll () {
    if (typeof window === 'undefined') return;
    const raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(raw);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  componentDidMount () {
    this.refresh();
    this._onGlobalStateUpdate = this._onGlobalStateUpdate.bind(this);
    window.addEventListener('globalStateUpdate', this._onGlobalStateUpdate);
    this._syncBitcoinHashScroll();
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', this._onBitcoinHashChange);
      this._hubUiFlagsUnsub = subscribeHubUiFeatureFlags(() => {
        this.setState((s) => ({ hubUiFlagsRev: (s.hubUiFlagsRev || 0) + 1 }));
      });
    }
  }

  componentWillUnmount () {
    if (this._onGlobalStateUpdate) {
      window.removeEventListener('globalStateUpdate', this._onGlobalStateUpdate);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('hashchange', this._onBitcoinHashChange);
    }
    if (typeof this._hubUiFlagsUnsub === 'function') {
      this._hubUiFlagsUnsub();
      this._hubUiFlagsUnsub = null;
    }
  }

  _onGlobalStateUpdate (e) {
    const d = e && e.detail;
    if (!d || !d.operation || d.operation.path !== '/bitcoin' || !d.globalState || !d.globalState.bitcoin) return;
    this.setState({ bitcoinStatus: d.globalState.bitcoin });
    // Keep client wallet figures fresh whenever bitcoin status patches arrive.
    this._refreshClientBalanceFromHubStatus(d.globalState.bitcoin);
  }

  async _refreshClientBalanceFromHubStatus (bitcoinStatus = null) {
    if (this._refreshingClientBalance) return;
    this._refreshingClientBalance = true;
    try {
      const identity = this.getIdentity();
      const wallet = getSpendWalletContext(identity);
      const network = (bitcoinStatus && bitcoinStatus.network) ? String(bitcoinStatus.network).toLowerCase() : (this.state.bitcoinStatus && this.state.bitcoinStatus.network) ? String(this.state.bitcoinStatus.network).toLowerCase() : '';
      const summary = await fetchWalletSummaryWithCache(this.state.upstream, wallet, { network }).catch(() => ({}));
      if (!summary || typeof summary !== 'object') return;

      const balanceSats = Number(summary.balanceSats != null ? summary.balanceSats : (summary.balance || 0));
      const confirmedSats = Number(summary.confirmedSats != null ? summary.confirmedSats : balanceSats);
      const unconfirmedSats = Number(summary.unconfirmedSats || 0);

      this.setState((prev) => ({
        wallet: {
          ...prev.wallet,
          balanceSats,
          confirmedSats,
          unconfirmedSats
        }
      }));
    } finally {
      this._refreshingClientBalance = false;
    }
  }

  componentDidUpdate (prevProps, prevState) {
    const prevId = prevProps && prevProps.identity && prevProps.identity.wallet && prevProps.identity.wallet.segwit && prevProps.identity.wallet.segwit.xpub;
    const nextId = this.props && this.props.identity && this.props.identity.wallet && this.props.identity.wallet.segwit && this.props.identity.wallet.segwit.xpub;
    if (prevId !== nextId) this.refresh();
    if (prevState.refreshing && !this.state.refreshing) {
      this._syncBitcoinHashScroll();
    }
  }

  satsToBTC (value) {
    return formatBtcFromSats(value);
  }

  /** Compute Lightning balance from listfunds outputs (client-side fallback when status returns 0). */
  getLightningBalanceFromOutputs (outputs = []) {
    let confirmed = 0;
    let unconfirmed = 0;
    let immature = 0;
    for (const o of outputs) {
      const amt = o.amount_msat != null ? Math.floor(Number(o.amount_msat) / 1000) : (o.amount_sat != null ? Number(o.amount_sat) : 0);
      const status = String(o.status || '').toLowerCase();
      if (status === 'confirmed') confirmed += amt;
      else if (status === 'unconfirmed') unconfirmed += amt;
      else if (status === 'immature') immature += amt;
      else if (status !== 'spent') unconfirmed += amt;
    }
    return { confirmed, unconfirmed, immature };
  }

  trimHash (value = '', left = 8, right = 8) {
    const text = String(value || '');
    if (text.length <= left + right + 1) return text;
    return `${text.slice(0, left)}...${text.slice(-right)}`;
  }

  formatDifficulty (value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return t.common.none;
    if (n >= UI_NUMBER_LOG_EXP_THRESHOLD) return n.toExponential(4);
    return n.toLocaleString();
  }

  formatFeeRate (btcPerKvB) {
    const n = Number(btcPerKvB);
    if (!Number.isFinite(n)) return t.common.none;
    return c.console.feeRate((n * 100000).toLocaleString(undefined, { maximumFractionDigits: 3 }));
  }

  formatBytes (n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return t.common.none;
    if (v < 1024) return `${Math.round(v)} B`;
    if (v < 1048576) return `${(v / 1024).toFixed(1)} KiB`;
    return `${(v / 1048576).toFixed(2)} MiB`;
  }

  _bitcoinPeerSortValue (p, col) {
    switch (col) {
      case 'addr':
        return String((p && (p.addr || p.addrbind)) || '').toLowerCase();
      case 'direction':
        return p && p.inbound ? 0 : 1;
      case 'ping':
        return Number(p && p.pingtime) || 0;
      case 'bytes':
        return (Number(p && p.bytesrecv) || 0) + (Number(p && p.bytessent) || 0);
      case 'subver':
        return String((p && p.subver) || '').toLowerCase();
      case 'height':
        return Number(p && p.synced_headers) || 0;
      default:
        return 0;
    }
  }

  _sortedBitcoinNodePeers (nodePeers) {
    const col = this.state.bitcoinPeerSortColumn || 'bytes';
    const dir = this.state.bitcoinPeerSortDirection === 'ascending' ? 1 : -1;
    const arr = Array.isArray(nodePeers) ? nodePeers.slice() : [];
    arr.sort((a, b) => {
      const va = this._bitcoinPeerSortValue(a, col);
      const vb = this._bitcoinPeerSortValue(b, col);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb)) * dir;
      }
      if (va !== vb) return va > vb ? dir : -dir;
      return String((a && a.addr) || '').localeCompare(String((b && b.addr) || ''));
    });
    return arr;
  }

  _handleBitcoinPeerSort (col) {
    this.setState((s) => {
      if (s.bitcoinPeerSortColumn === col) {
        return {
          bitcoinPeerSortDirection: s.bitcoinPeerSortDirection === 'ascending' ? 'descending' : 'ascending'
        };
      }
      const numeric = col === 'ping' || col === 'bytes' || col === 'height' || col === 'direction';
      return {
        bitcoinPeerSortColumn: col,
        bitcoinPeerSortDirection: numeric ? 'descending' : 'ascending'
      };
    });
  }

  async handleBroadcastRawTx () {
    const token = this.props.adminToken;
    if (!token) {
      this.setState({ rawTxResult: { error: t.common.errors.adminTokenRequired } });
      return;
    }
    const settings = { ...this.state.upstream, apiToken: token };
    try {
      const r = await broadcastRawTransaction(settings, this.state.rawTxHex);
      const err = r && (r.error || r.message);
      if (err) {
        this.setState({ rawTxResult: { error: String(err) } });
        return;
      }
      this.setState({ rawTxResult: r, rawTxHex: '' });
      await this.refresh();
    } catch (error) {
      this.setState({ rawTxResult: { error: error && error.message ? error.message : String(error) } });
    }
  }

  handleTxLookup () {
    const id = String(this.state.txLookupId || '').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(id)) {
      this.setState({ txLookupError: c.tools.txidInvalid });
      return;
    }
    const f = loadHubUiFeatureFlags();
    if (!f.bitcoinExplorer) {
      this.setState({
        txLookupError: shared.explorerRoutesOff
      });
      return;
    }
    this.setState({ txLookupError: null });
    const nav = this.props.navigate;
    if (typeof nav === 'function') nav(`/services/bitcoin/transactions/${encodeURIComponent(id)}`);
    else if (typeof window !== 'undefined') window.location.assign(`/services/bitcoin/transactions/${encodeURIComponent(id)}`);
  }

  /**
   * Navigate to a relative Hub path (must start with `/`). Keeps row click navigation off
   * `Array#map` index parameters that some static rules treat as tainted for `window` location.
   * @param {string} path
   */
  navigateInternalPath (path) {
    const p = String(path || '');
    if (!p.startsWith('/') || p.includes('//')) return;
    const nav = this.props.navigate;
    if (typeof nav === 'function') nav(p);
    else if (typeof window !== 'undefined') window.location.assign(p);
  }

  getIdentity () {
    const identity = (this.props && this.props.identity) || (this.props && this.props.auth) || null;
    return identity || {};
  }

  async refresh () {
    const identity = this.getIdentity();
    const spendWallet = getSpendWalletContext(identity);
    const nextReceive = getNextReceiveWalletContext(identity);
    const upstream = this.state.upstream;
    const upstreamAdmin = {
      ...upstream,
      hubAdminToken: this._hubAdminToken() || ''
    };

    this.setState({ loading: !spendWallet.walletId, refreshing: true, error: null });

    const network = (this.state.bitcoinStatus && this.state.bitcoinStatus.network) ? String(this.state.bitcoinStatus.network).toLowerCase() : '';
    const summaryTask = fetchWalletSummaryWithCache(upstreamAdmin, spendWallet, { network }).catch(() => ({}));
    const explorerTask = fetchExplorerData(upstreamAdmin, spendWallet, {
      network,
      adminToken: this._hubAdminToken() || ''
    }).catch(() => ({ blocks: [], transactions: [] }));
    const bitcoinStatusTask = fetchBitcoinStatus(upstreamAdmin).catch(() => ({ available: false, status: 'UNAVAILABLE' }));
    const lightningStatusTask = fetchLightningStatus(upstream).catch(() => ({ available: false, status: 'UNAVAILABLE' }));
    const lightningChannelsTask = fetchLightningChannels(upstream).catch(() => ({ channels: [], outputs: [] }));
    const utxoTask = fetchUTXOs(upstreamAdmin, spendWallet).catch(() => []);
    const payjoinCapabilitiesTask = fetchPayjoinCapabilities(upstream).catch(() => ({ available: false }));
    const payjoinSessionsTask = fetchPayjoinSessions(upstream, { limit: 25, includeExpired: false }).catch(() => []);
    const payjoinSessionTask = this.state.payjoinSessionId
      ? fetchPayjoinSession(upstream, this.state.payjoinSessionId).catch(() => null)
      : Promise.resolve(null);
    const nodePeersTask = fetchBitcoinPeers(upstream).catch(() => []);
    const nodeNetworkTask = fetchBitcoinNetworkSummary(upstream).catch(() => ({}));

    try {
      const [summary, explorer, bitcoinStatus, lightningStatus, lightningChannels, utxos, payjoinCapabilities, payjoinSessionsList, payjoinSession, nodePeers, nodeNetwork] = await Promise.all([
        summaryTask,
        explorerTask,
        bitcoinStatusTask,
        lightningStatusTask,
        lightningChannelsTask,
        utxoTask,
        payjoinCapabilitiesTask,
        payjoinSessionsTask,
        payjoinSessionTask,
        nodePeersTask,
        nodeNetworkTask
      ]);
      const network = (bitcoinStatus && bitcoinStatus.network) ? String(bitcoinStatus.network).toLowerCase() : '';
      const address = await fetchReceiveAddress(upstream, nextReceive, { network, identity }).catch(() => '');
      const localRecv = deriveAndStoreReceiveAddress(nextReceive, { network, identity });
      const receiveIndex = localRecv && localRecv.currentIndex != null
        ? Number(localRecv.currentIndex)
        : 0;
      const balanceSats = Number(summary.balanceSats != null ? summary.balanceSats : (summary.balance || 0));
      const confirmedSats = Number(summary.confirmedSats != null ? summary.confirmedSats : balanceSats);
      const unconfirmedSats = Number(summary.unconfirmedSats || 0);
      const explorerBlocks = Array.isArray(explorer.blocks) ? explorer.blocks.slice(0, 10) : [];
      const explorerTransactions = Array.isArray(explorer.transactions) ? explorer.transactions.slice(0, 10) : [];
      const statusBlocks = (bitcoinStatus && Array.isArray(bitcoinStatus.recentBlocks))
        ? bitcoinStatus.recentBlocks.slice(0, 10)
        : [];
      const statusTransactions = (bitcoinStatus && Array.isArray(bitcoinStatus.recentTransactions))
        ? bitcoinStatus.recentTransactions.slice(0, 10)
        : [];

      let payjoinSessionsSnapshot = null;
      const hubUi = loadHubUiFeatureFlags();
      if (hubUi && hubUi.bitcoinPayments) {
        if (Array.isArray(payjoinSessionsList)) {
          const activeNotExpired = payjoinSessionsList.length;
          const awaitingCompletion = payjoinSessionsList.filter((s) => String((s && s.status) || '') !== 'success').length;
          payjoinSessionsSnapshot = { activeNotExpired, awaitingCompletion };
        }
      }

      this.setState({
        loading: false,
        refreshing: false,
        error: null,
        wallet: {
          ...spendWallet,
          balanceSats,
          confirmedSats,
          unconfirmedSats,
          address: address || '',
          receiveIndex
        },
        blocks: explorerBlocks.length ? explorerBlocks : statusBlocks,
        transactions: explorerTransactions.length ? explorerTransactions : statusTransactions,
        bitcoinStatus: bitcoinStatus && typeof bitcoinStatus === 'object'
          ? bitcoinStatus
          : { available: false, status: 'UNAVAILABLE' },
        lightningStatus: lightningStatus && typeof lightningStatus === 'object'
          ? lightningStatus
          : { available: false, status: 'UNAVAILABLE' },
        lightningChannels: lightningChannels && Array.isArray(lightningChannels.channels) ? lightningChannels.channels : [],
        lightningOutputs: lightningChannels && Array.isArray(lightningChannels.outputs) ? lightningChannels.outputs : [],
        utxos: Array.isArray(utxos) ? utxos : [],
        payjoinCapabilities: payjoinCapabilities && typeof payjoinCapabilities === 'object'
          ? payjoinCapabilities
          : { available: false },
        payjoinSessionsSnapshot,
        payjoinResult: payjoinSession || this.state.payjoinResult,
        nodePeers: Array.isArray(nodePeers) ? nodePeers : [],
        nodeNetwork: nodeNetwork && typeof nodeNetwork === 'object' ? nodeNetwork : {}
      });
      if (typeof window !== 'undefined' && Number.isFinite(balanceSats)) {
        window.dispatchEvent(new CustomEvent('clientBalanceUpdate', {
          detail: {
            walletId: spendWallet.walletId,
            balanceSats,
            confirmedSats,
            unconfirmedSats
          }
        }));
      }
    } catch (error) {
      this.setState({
        loading: false,
        refreshing: false,
        error: error && error.message ? error.message : String(error)
      });
    }
  }

  handleNextReceiveAddress () {
    const network = (this.state.bitcoinStatus && this.state.bitcoinStatus.network)
      ? String(this.state.bitcoinStatus.network).toLowerCase()
      : '';
    const receiveWallet = getNextReceiveWalletContext(this.getIdentity());
    const next = reserveNextReceiveAddress(receiveWallet, { network, identity: this.getIdentity() });
    if (!next || !next.currentAddress) {
      this.setState({ paymentResult: { error: c.wallet.nextAddressFailed } });
      return;
    }
    this.setState((prev) => ({
      wallet: {
        ...prev.wallet,
        address: next.currentAddress,
        receiveIndex: Number(next.currentIndex || 0)
      }
    }));
  }

  _hubAdminToken () {
    return readHubAdminTokenFromBrowser(this.props && this.props.adminToken);
  }

  async handleSendPayment () {
    const paymentTo = String(this.state.paymentTo || '').trim();
    const paymentAmountSats = Number(this.state.paymentAmountSats || 0);
    if (!paymentTo) {
      this.setState({ paymentResult: { error: c.errors.recipientRequired } });
      return;
    }
    if (!Number.isFinite(paymentAmountSats) || paymentAmountSats <= 0) {
      this.setState({ paymentResult: { error: c.errors.amountPositive } });
      return;
    }

    const adminToken = this._hubAdminToken();
    if (!adminToken) {
      this.setState({
        paymentResult: {
          error: c.errors.adminSpend
        }
      });
      return;
    }

    try {
      const result = await sendPayment(this.state.upstream, this.state.wallet, {
        to: paymentTo,
        amountSats: paymentAmountSats,
        memo: this.state.paymentMemo,
        adminToken
      });

      const paidTxid = (result && result.payment && result.payment.txid) || (result && result.txid);
      if (paidTxid && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('clientBalanceUpdate'));
      }

      this.setState({
        paymentResult: result || { status: 'submitted' },
        paymentAmountSats: '',
        paymentMemo: ''
      });
      await this.refresh();
    } catch (error) {
      this.setState({ paymentResult: { error: error && error.message ? error.message : String(error) } });
    }
  }

  async handleLookupAddress () {
    const address = String(this.state.lookupAddress || '').trim();
    if (!address) {
      this.setState({ lookupResult: { error: c.faucet.addressRequired } });
      return;
    }
    this.setState({ lookupLoading: true, lookupResult: null });
    try {
      const result = await fetchAddressBalance(this.state.upstream, address);
      this.setState({ lookupResult: result || { error: c.lookup.noData }, lookupLoading: false });
    } catch (error) {
      this.setState({
        lookupResult: { error: error && error.message ? error.message : String(error) },
        lookupLoading: false
      });
    }
  }

  async handleRequestFaucet () {
    const address = String(this.state.faucetAddress || '').trim();
    if (!address) {
      this.setState({ faucetResult: { error: c.faucet.addressRequired } });
      return;
    }
    const amountSats = Math.max(1, Math.min(1000000, Number(this.state.faucetAmountSats || 10000) || 10000));
    this.setState({ faucetResult: null });
    try {
      const result = await requestFaucet(this.state.upstream, { address, amountSats });
      this.setState({ faucetResult: result });
      if (!result.error && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('clientBalanceUpdate'));
      }
      if (!result.error && this.state.wallet && this.state.wallet.walletId) {
        clearBalanceCache(this.state.wallet.walletId);
      }
      await this.refresh();
    } catch (error) {
      this.setState({ faucetResult: { error: error && error.message ? error.message : String(error) } });
    }
  }

  async handleCreateLightningInvoice () {
    const amountSats = Number(this.state.invoiceAmountSats || 0);
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      this.setState({ lightningResult: { error: c.lightning.invoiceAmountPositive } });
      return;
    }
    try {
      const result = await createLightningInvoice(this.state.upstream, this.state.wallet, {
        amountSats,
        memo: this.state.invoiceMemo
      });
      const invoice = result.invoice || result.bolt11 || result.request || '';
      this.setState({
        lightningResult: result,
        invoiceInput: invoice || this.state.invoiceInput
      });
    } catch (error) {
      this.setState({ lightningResult: { error: error && error.message ? error.message : String(error) } });
    }
  }

  async handleDecodeLightningInvoice () {
    const invoice = String(this.state.invoiceInput || '').trim();
    if (!invoice) {
      this.setState({ lightningResult: { error: c.lightning.pasteToDecode } });
      return;
    }
    try {
      const result = await decodeLightningInvoice(this.state.upstream, invoice);
      this.setState({ lightningResult: result });
    } catch (error) {
      this.setState({ lightningResult: { error: error && error.message ? error.message : String(error) } });
    }
  }

  async handlePayLightningInvoice () {
    const invoice = String(this.state.invoiceInput || '').trim();
    if (!invoice) {
      this.setState({ lightningResult: { error: c.lightning.pasteToPay } });
      return;
    }
    try {
      const result = await payLightningInvoice(this.state.upstream, this.state.wallet, invoice);
      this.setState({ lightningResult: result });
      await this.refresh();
    } catch (error) {
      this.setState({ lightningResult: { error: error && error.message ? error.message : String(error) } });
    }
  }

  async handleCreateChannel () {
    const remote = String(this.state.channelCreateRemote || '').trim();
    const amountSats = Number(this.state.channelCreateAmountSats || 0);
    if (!remote) {
      this.setState({ channelCreateResult: { error: c.lightning.remoteRequired } });
      return;
    }
    if (!remote.includes('@')) {
      this.setState({ channelCreateResult: { error: c.lightning.remoteFormat } });
      return;
    }
    if (!Number.isFinite(amountSats) || amountSats < 10000) {
      this.setState({ channelCreateResult: { error: c.lightning.amountMin(10000) } });
      return;
    }
    this.setState({ channelCreateLoading: true, channelCreateResult: null });
    try {
      const result = await createLightningChannel(this.state.upstream, {
        remote,
        amountSats,
        pushMsat: this.state.channelCreatePushMsat ? Number(this.state.channelCreatePushMsat) : undefined
      });
      const hasError = result && (result.error || result.detail);
      this.setState({
        channelCreateResult: result,
        channelCreateLoading: false,
        ...(hasError ? {} : { channelCreateRemote: '', channelCreatePushMsat: '' })
      });
      if (!hasError) await this.refresh();
    } catch (error) {
      this.setState({
        channelCreateResult: { error: error && error.message ? error.message : String(error) },
        channelCreateLoading: false
      });
    }
  }

  async handleGenerateBlock () {
    try {
      // Block generation always uses the Hub's wallet; no address is sent so coinbase goes to the Hub.
      // Admin token required for block generation.
      const settings = { ...this.state.upstream, apiToken: this.props.adminToken || this.state.upstream.apiToken };
      const result = await generateBlock(settings, { count: 1 });
      this.setState({ paymentResult: { generatedBlock: result } });
      if (this.state.wallet && this.state.wallet.walletId) {
        clearBalanceCache(this.state.wallet.walletId);
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('clientBalanceUpdate'));
      }
      try {
        const hashes = result && Array.isArray(result.blockHashes) ? result.blockHashes : [];
        const tip = hashes.length ? String(hashes[hashes.length - 1]) : '';
        const n = result && result.count != null ? Number(result.count) : hashes.length;
        const sub = tip
          ? c.notify.blockSubtitle(Number.isFinite(n) ? n : 1, tip.slice(0, 14))
          : c.notify.blockFallback;
        pushUiNotification({
          id: `regtest-block-${Date.now()}`,
          kind: 'bitcoin_block',
          title: c.notify.blockTitle,
          subtitle: sub,
          href: tip ? `/services/bitcoin/blocks/${encodeURIComponent(tip)}` : '/services/bitcoin',
          copyText: tip || undefined
        });
      } catch (e) { /* ignore */ }
      await this.refresh();
    } catch (error) {
      this.setState({ paymentResult: { error: error && error.message ? error.message : String(error) } });
    }
  }

  async handleCreatePayjoinDeposit () {
    if (!this.state.payjoinEnabled) {
      this.setState({ payjoinResult: { error: c.payjoin.turnOnFirst } });
      return;
    }

    try {
      const receiveWallet = getNextReceiveWalletContext(this.getIdentity());
      const pjPref = loadPayjoinPreferences();
      const useJm = pjPref.receiveTaprootJoinmarket !== false;
      const session = await createPayjoinDeposit(this.state.upstream, receiveWallet, {
        ...(useJm
          ? { receiveTemplate: 'hub_taproot_v2' }
          : { address: this.state.wallet.address }),
        amountSats: Number(this.state.payjoinAmountSats || 0),
        label: this.state.payjoinLabel,
        memo: this.state.payjoinMemo
      });
      this.setState({
        payjoinSessionId: session.id || '',
        payjoinResult: session,
        payjoinAmountSats: '',
        payjoinLabel: '',
        payjoinMemo: ''
      });
      try {
        const sid = String(session.id || '').trim();
        const amt = session.amountSats != null && Number(session.amountSats) > 0
          ? t.common.sats(session.amountSats)
          : c.payjoin.notifyAnyAmount;
        if (sid) {
          pushUiNotification({
            id: `payjoin-session-${sid}`,
            kind: 'payjoin',
            title: c.payjoin.notifyTitle,
            subtitle: amt,
            href: `/payments?payjoinSession=${encodeURIComponent(sid)}`,
            copyText: session.bip21Uri || session.proposalURL || sid
          });
        }
      } catch (e) { /* ignore */ }
      await this.refresh();
    } catch (error) {
      this.setState({ payjoinResult: { error: error && error.message ? error.message : String(error) } });
    }
  }

  async handleRefreshPayjoinSession () {
    const sessionId = String(this.state.payjoinSessionId || '').trim();
    if (!sessionId) return;
    try {
      const session = await fetchPayjoinSession(this.state.upstream, sessionId);
      this.setState({ payjoinResult: session || this.state.payjoinResult });
    } catch (error) {
      this.setState({ payjoinResult: { error: error && error.message ? error.message : String(error) } });
    }
  }

  /** Placeholder and hint for address inputs based on Hub Bitcoin network. */
  getAddressPlaceholder (network) {
    const n = String(network || '').toLowerCase();
    if (n === 'regtest') return c.addressPlaceholder.regtest;
    if (n === 'testnet' || n === 'signet') return c.addressPlaceholder.test;
    if (n === 'mainnet' || n === 'main') return c.addressPlaceholder.main;
    return c.addressPlaceholder.other;
  }

  render () {
    const wallet = this.state.wallet;
    const hasUpstream = !!(this.state.upstream.explorerBaseUrl || this.state.upstream.paymentsBaseUrl || this.state.upstream.lightningBaseUrl);
    const bitcoinReady = !!(this.state.bitcoinStatus && this.state.bitcoinStatus.available);
    const bitcoinNetwork = String((this.state.bitcoinStatus && this.state.bitcoinStatus.network) || '').toLowerCase();
    const isRegtest = bitcoinNetwork === 'regtest';
    const hasAdminToken = !!readHubAdminTokenFromBrowser(this.props.adminToken);
    const canGenerateBlocks = bitcoinReady && bitcoinNetwork === 'regtest';
    const canShowGenerateBlock = canGenerateBlocks && hasAdminToken;
    const lightningAvailable = !!(this.state.lightningStatus && this.state.lightningStatus.available);
    const addressPlaceholder = this.getAddressPlaceholder(bitcoinNetwork);

    const bc = this.state.bitcoinStatus && this.state.bitcoinStatus.blockchain;
    const mp = this.state.bitcoinStatus && this.state.bitcoinStatus.mempoolInfo;
    const nodePeers = Array.isArray(this.state.nodePeers) ? this.state.nodePeers : [];
    const sortedNodePeers = this._sortedBitcoinNodePeers(nodePeers);
    const nn = this.state.nodeNetwork && typeof this.state.nodeNetwork === 'object' ? this.state.nodeNetwork : {};
    const ni = nn.networkInfo && typeof nn.networkInfo === 'object' ? nn.networkInfo : null;
    const depRoot = nn.deployments && typeof nn.deployments === 'object' ? nn.deployments : null;
    const deploymentsInner = depRoot && depRoot.deployments && typeof depRoot.deployments === 'object'
      ? depRoot.deployments
      : null;
    const deploymentEntries = deploymentsInner
      ? Object.entries(deploymentsInner)
      : (depRoot ? Object.entries(depRoot).filter(([k]) => k !== 'deployments') : []);

    void this.state.hubUiFlagsRev;
    const hubUi = loadHubUiFeatureFlags();
    const bitcoinPage = this.props && this.props.bitcoinPage ? String(this.props.bitcoinPage).toLowerCase() : 'dashboard';
    const isDashboardPage = bitcoinPage === 'dashboard';
    const isFaucetPage = bitcoinPage === 'faucet';
    const isLightningPage = bitcoinPage === 'lightning';
    const isExplorerPage = bitcoinPage === 'explorer';
    const payjoinSnapshot = this.state.payjoinSessionsSnapshot && typeof this.state.payjoinSessionsSnapshot === 'object'
      ? this.state.payjoinSessionsSnapshot
      : { activeNotExpired: 0, awaitingCompletion: 0 };
    const lightningFunds = this.getLightningBalanceFromOutputs(this.state.lightningOutputs || []);
    const hubWalletSats = Number(this.state.bitcoinStatus && this.state.bitcoinStatus.balanceSats != null
      ? this.state.bitcoinStatus.balanceSats
      : Math.round(Number(this.state.bitcoinStatus && this.state.bitcoinStatus.balance != null ? this.state.bitcoinStatus.balance : 0) * SATS_PER_BTC));
    const clientWalletSats = Number(wallet && wallet.balanceSats != null ? wallet.balanceSats : 0);
    const sharedSessionsSats = Number(lightningFunds.confirmed || 0) + Number(lightningFunds.unconfirmed || 0) + Number(lightningFunds.immature || 0);
    /** Avoid showing “No data yet” on first paint before refresh() resolves or while a refresh is in flight. */
    const explorerDataPending =
      this.state.refreshing ||
      (this.state.loading && this.state.blocks.length === 0 && this.state.transactions.length === 0);
    const bitcoinHealth = bitcoinHealthState(this.state.bitcoinStatus);
    const bitcoinHealthLabel = bitcoinHealth === 'ok'
      ? health.running(bitcoinNetwork)
      : bitcoinHealth === 'starting'
        ? health.starting
        : bitcoinHealth === 'off'
          ? health.off
          : health.unreachable;
    const bitcoinHealthHint = bitcoinHealth === 'starting'
      ? health.startingHint
      : bitcoinHealth === 'off'
        ? health.offHint
        : health.unreachableHint;
    const bitcoinStatusCode = this.state.bitcoinStatus && this.state.bitcoinStatus.status
      ? String(this.state.bitcoinStatus.status)
      : '';

    return (
      <div className='fade-in'>
        <Segment>
          <section aria-labelledby="bitcoin-home-heading" aria-describedby="bitcoin-home-summary">
          <div
            style={{
              position: 'sticky',
              top: '6.5rem',
              zIndex: 12,
              background: '#fff',
              paddingBottom: '0.35em',
              marginBottom: '0.35em',
              boxShadow: '0 1px 0 rgba(34, 36, 38, 0.15)'
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.5em' }}>
              <Header as="h2" id="bitcoin-home-heading" style={{ margin: 0 }}>
                <Icon name="bitcoin" color="orange" aria-hidden="true" />
                <Header.Content>{c.title}</Header.Content>
              </Header>
              <div id="fabric-bitcoin-regtest-toolbar" role="toolbar" aria-label={c.toolbarLabel} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center' }}>
                <Button basic icon onClick={() => this.setState({ settingsOpen: true, upstreamDraft: { ...this.state.upstream } })} title={c.upstreamSettings} aria-label={c.upstreamSettings}>
                  <Icon name="cog" aria-hidden="true" />
                </Button>
                <Button primary loading={this.state.refreshing} onClick={() => this.refresh()}>
                  <Icon name="refresh" aria-hidden="true" />
                  {t.common.actions.refresh}
                </Button>
                {canShowGenerateBlock && (
                  <Button
                    basic
                    onClick={() => this.handleGenerateBlock()}
                    title={c.generateBlockTitle}
                  >
                    <Icon name="cube" aria-hidden="true" />
                    {c.generateBlock}
                  </Button>
                )}
                {canGenerateBlocks ? (
                  <Button
                    as={Link}
                    to="/services/bitcoin/faucet"
                    basic
                    title={c.faucetTitle}
                  >
                    <Icon name="tint" aria-hidden="true" />
                    {c.faucetButton}
                  </Button>
                ) : null}
                {hubUi.bitcoinPayments ? (
                  <Button as={Link} to="/payments" basic title={c.paymentsTitle}>
                    <Icon name="credit card outline" aria-hidden="true" />
                    {c.payments}
                  </Button>
                ) : null}
                {hubUi.bitcoinInvoices ? (
                  <Button as={Link} to="/services/bitcoin/invoices#fabric-invoices-tab-demo" basic title={c.invoicesTitle}>
                    <Icon name="file alternate outline" aria-hidden="true" />
                    {c.invoices}
                  </Button>
                ) : null}
                {hubUi.bitcoinResources ? (
                  <Button as={Link} to="/services/bitcoin/resources" basic title={c.resourcesTitle}>
                    <Icon name="sitemap" aria-hidden="true" />
                    {c.resources}
                  </Button>
                ) : null}
                {hubUi.bitcoinCrowdfund ? (
                  <Button as={Link} to="/services/bitcoin/crowdfunds" basic title={c.crowdfundsTitle}>
                    <Icon name="heart outline" aria-hidden="true" />
                    {c.crowdfundsButton}
                  </Button>
                ) : null}
                {hubUi.bitcoinLightning ? (
                  <Button as={Link} to="/services/lightning" basic title={c.lightningTitle}>
                    <Icon name="bolt" aria-hidden="true" />
                    {c.lightningButton}
                  </Button>
                ) : null}
                {hubUi.bitcoinExplorer ? (
                  <Button as={Link} to="/services/bitcoin/blocks" basic title={c.explorerTitle}>
                    <Icon name="search" aria-hidden="true" />
                    {c.explorer}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          <p
            id="bitcoin-home-summary"
            style={{ marginTop: '0.5em', color: '#666', marginBottom: '0.5em', maxWidth: '42rem', lineHeight: 1.45 }}
          >
            <strong>{c.summary.yours}</strong> {c.summary.yoursBody}{' '}
            <Link to="/settings/bitcoin-wallet">{c.summary.walletSettings}</Link>.{' '}
            <strong>{c.summary.hub}</strong> {c.summary.hubBody(isRegtest)}
            {isRegtest ? (
              <>
                {' '}
                <strong>{c.summary.regtestLead}</strong> {c.summary.regtestBefore}{' '}
                <Link to="/services/bitcoin/faucet">{c.summary.faucetLink}</Link> {c.summary.regtestAfter}
              </>
            ) : null}
          </p>
          <HubRegtestAdminTokenPanel
            network={bitcoinNetwork || 'mainnet'}
            adminTokenProp={this.props && this.props.adminToken}
          />
          <BitcoinWalletBranchBar identity={(this.props && this.props.identity) || {}} />
          </section>
        </Segment>

        <Segment
          style={{
            marginTop: '-1px',
            padding: '0.75em 1em',
            background: 'linear-gradient(92deg, #f7f5ef 0%, #ebe6d8 45%, #e8e4d6 100%)',
            borderColor: '#d4cfc0'
          }}
        >
          <section aria-labelledby="bitcoin-home-wealth-heading">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.65rem', justifyContent: 'space-between' }}>
            <span id="bitcoin-home-wealth-heading" style={{ fontWeight: 600, color: '#3d3a33', fontSize: '0.95em' }}>{c.wealth.title}</span>
            <span style={{ color: '#5c574c', fontSize: '0.85em', maxWidth: '36rem', lineHeight: 1.4 }}>
              {c.wealth.body}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
              <Button as={Link} to="/documents" size="small" basic icon labelPosition="left">
                <Icon name="file alternate outline" /> {c.wealth.documents}
              </Button>
              {hubUi.peers ? (
                <Button as={Link} to="/peers" size="small" basic icon labelPosition="left">
                  <Icon name="users" /> {c.wealth.peers}
                </Button>
              ) : null}
            </div>
          </div>
          </section>
        </Segment>

        <Segment style={{ marginTop: '-1px', borderColor: '#d9e2f3', background: '#f8fbff' }}>
          <section aria-labelledby="operator-managed-deposits-heading">
            <Header as="h3" id="operator-managed-deposits-heading" style={{ marginBottom: '0.35em' }}>
              {c.deposits.title}
            </Header>
            <p style={{ color: '#4b5b73', marginBottom: '0.75em', maxWidth: '54rem', lineHeight: 1.45 }}>
              {c.deposits.body}
            </p>
            <Table compact celled unstackable size="small" style={{ marginBottom: '0.5em' }}>
              <Table.Body>
                <Table.Row>
                  <Table.Cell width={5}><strong>{c.deposits.client}</strong></Table.Cell>
                  <Table.Cell>{t.common.sats(clientWalletSats)}</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>{c.deposits.clientNote}</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell><strong>{c.deposits.hub}</strong></Table.Cell>
                  <Table.Cell>{t.common.sats(hubWalletSats)}</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>{c.deposits.hubNote(isRegtest)}</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell><strong>{c.deposits.shared}</strong></Table.Cell>
                  <Table.Cell>{t.common.sats(sharedSessionsSats)}</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>{c.deposits.sharedNote}</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell><strong>{c.deposits.payjoin}</strong></Table.Cell>
                  <Table.Cell>{c.deposits.payjoinActive(Number(payjoinSnapshot.activeNotExpired || 0))}</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>
                    {c.deposits.payjoinAwaiting(Number(payjoinSnapshot.awaitingCompletion || 0))}
                  </Table.Cell>
                </Table.Row>
              </Table.Body>
            </Table>
            <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button as={Link} to="/services/lightning" size="small" basic icon labelPosition="left">
                <Icon name="bolt" /> {c.deposits.manageLightning}
              </Button>
              <Button as={Link} to="/payments#wealth-payjoin-board" size="small" basic icon labelPosition="left">
                <Icon name="shield alternate" /> {c.deposits.managePayjoin}
              </Button>
              <Button as={Link} to="/settings/bitcoin-wallet" size="small" basic icon labelPosition="left">
                <Icon name="key" /> {c.deposits.walletBoundary}
              </Button>
            </div>
          </section>
        </Segment>

        {!hasUpstream && (
          <Message warning>
            <Message.Header>{c.upstreamMissing.title}</Message.Header>
            <p>{c.upstreamMissing.body}</p>
          </Message>
        )}

        {hasUpstream && !this.state.loading && !this.state.refreshing && !bitcoinReady && (
          <Message info>
            <Message.Header>{bitcoinHealthLabel}</Message.Header>
            <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', lineHeight: 1.45 }}>
              {bitcoinHealthHint}
              {bitcoinHealth === 'off' ? ` ${health.regtestHint}` : null}{' '}
              {c.unavailable.identityNote}{' '}
              <Link to="/settings/admin">{c.unavailable.admin}</Link>.
            </p>
          </Message>
        )}

        {hasUpstream && bitcoinReady && (
          <Message size="small" style={{ marginBottom: '0.75em' }}>
            <Message.Header>{c.checklist.title}</Message.Header>
            <List bulleted style={{ margin: '0.35em 0 0', fontSize: '0.88em', color: '#555' }}>
              <List.Item>{c.checklist.adminToken(isRegtest)}</List.Item>
              <List.Item>
                <strong>{c.checklist.payjoinLead}</strong> {c.checklist.payjoin}
                <details className="hub-developer-details">
                  <summary>{t.common.developerDetails}</summary>
                  {c.checklist.payjoinDeveloper}
                </details>
              </List.Item>
              <List.Item>
                <strong>{c.checklist.lightningLead}</strong> {c.checklist.lightning}
              </List.Item>
            </List>
          </Message>
        )}

        {this.state.error && (
          <Message negative>
            <Message.Header>{c.refreshFailed}</Message.Header>
            <p style={{ margin: '0.35em 0 0' }}>{this.state.error}</p>
            <Button
              type="button"
              size="small"
              style={{ marginTop: '0.75em' }}
              loading={this.state.refreshing}
              disabled={this.state.refreshing}
              onClick={() => this.refresh()}
            >
              <Icon name="refresh" />
              {t.common.actions.retry}
            </Button>
          </Message>
        )}

        <Segment loading={this.state.loading}>
          <Header as='h3'>{c.serviceHealth.title}</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>{c.serviceHealth.intro}</p>
          <p style={{ fontSize: '0.88em', color: '#666', margin: '0 0 0.65em', lineHeight: 1.45 }}>
            <strong>{c.serviceHealth.beacon}</strong>{' '}
            <Link to="/settings/admin/beacon-federation">{c.serviceHealth.beaconFederation}</Link>
          </p>
          <details className="hub-developer-details" style={{ fontSize: '0.88em', color: '#666', margin: '0 0 0.65em' }}>
            <summary>{t.common.developerDetails}</summary>
            <a href="/services/distributed/epoch" target="_blank" rel="noopener noreferrer">{c.serviceHealth.epochJson}</a>
            {' · '}
            <a href="/services/distributed/manifest" target="_blank" rel="noopener noreferrer">{c.serviceHealth.manifestJson}</a>
          </details>
          <div><strong>{c.serviceHealth.bitcoin}</strong>{' '}
            {this.state.loading || this.state.refreshing ? health.checking : bitcoinHealthLabel}
          </div>
          <div style={{ color: '#666', marginBottom: '0.5em', lineHeight: 1.45 }}>
            {bitcoinReady && this.state.bitcoinStatus && this.state.bitcoinStatus.message
              ? this.state.bitcoinStatus.message
              : null}
            {!bitcoinReady && !this.state.loading && !this.state.refreshing && bitcoinStatusCode ? (
              <details className="hub-developer-details">
                <summary>{t.common.developerDetails}</summary>
                {health.detail([bitcoinStatusCode, this.state.bitcoinStatus && this.state.bitcoinStatus.message].filter(Boolean).join(' · '))}
              </details>
            ) : null}
          </div>
          {bitcoinReady && this.state.bitcoinStatus && this.state.bitcoinStatus.balance != null && (
            <div>
              <strong>{c.serviceHealth.hubBalance}</strong> {t.common.sats(hubWalletSats)}{' '}
              {c.serviceHealth.hubBalanceNote(isRegtest)}
            </div>
          )}
          {bitcoinReady && this.state.bitcoinStatus && this.state.bitcoinStatus.beacon && (
            <div><strong>{c.serviceHealth.beaconBalance}</strong> {t.common.sats(this.state.bitcoinStatus.beacon.balanceSats || 0)} {c.serviceHealth.beaconEpoch(this.state.bitcoinStatus.beacon.clock || 0)}</div>
          )}
          <div><strong>{c.serviceHealth.lightning}</strong> {this.state.lightningStatus && this.state.lightningStatus.status === 'NOT_CONFIGURED'
            ? c.serviceHealth.lightningNotConfigured(isRegtest)
            : (this.state.lightningStatus && this.state.lightningStatus.status === 'STUB')
              ? c.serviceHealth.lightningStub
              : (this.state.lightningStatus && this.state.lightningStatus.status
                ? (t.bitcoin.lightning.statusLabels[String(this.state.lightningStatus.status)] || this.state.lightningStatus.status)
                : c.serviceHealth.lightningUnknown)}</div>
          <div style={{ color: '#666' }}>{this.state.lightningStatus && this.state.lightningStatus.message ? this.state.lightningStatus.message : ''}</div>
        </Segment>

        <Segment loading={this.state.loading}>
          <Header as='h3'>{c.console.title}</Header>
          <p style={{ color: '#666', marginBottom: '0.75em' }}>
            {c.console.intro}
            {bitcoinHealth !== 'ok' && !this.state.loading && !this.state.refreshing ? ` ${bitcoinHealthLabel}.` : null}
          </p>

          <Header as='h4'>{c.console.chain}</Header>
          <Table compact celled unstackable size='small' style={{ marginBottom: '1em' }}>
            <Table.Body>
              <Table.Row>
                <Table.Cell><strong>{c.console.chainHeight}</strong></Table.Cell>
                <Table.Cell>{bc && bc.blocks != null ? bc.blocks : (this.state.bitcoinStatus.height != null ? this.state.bitcoinStatus.height : t.common.none)}</Table.Cell>
                <Table.Cell><strong>{c.console.headers}</strong></Table.Cell>
                <Table.Cell>{bc && bc.headers != null ? bc.headers : t.common.none}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell><strong>{c.console.verification}</strong></Table.Cell>
                <Table.Cell>
                  {bc && bc.verificationprogress != null
                    ? `${(Number(bc.verificationprogress) * 100).toFixed(2)}%`
                    : t.common.none}
                  {bc && bc.initialblockdownload ? ` ${c.console.initialSync}` : ''}
                </Table.Cell>
                <Table.Cell><strong>{c.console.difficulty}</strong></Table.Cell>
                <Table.Cell>{bc ? this.formatDifficulty(bc.difficulty) : t.common.none}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell><strong>{c.console.network}</strong></Table.Cell>
                <Table.Cell>{bc && bc.chain ? String(bc.chain) : t.common.none}</Table.Cell>
                <Table.Cell><strong>{c.console.medianTime}</strong></Table.Cell>
                <Table.Cell>
                  {bc && bc.mediantime
                    ? new Date(Number(bc.mediantime) * 1000).toLocaleString()
                    : t.common.none}
                </Table.Cell>
              </Table.Row>
              {(this.state.bitcoinStatus.bitcoinPruned || (bc && bc.pruned)) ? (
                <Table.Row>
                  <Table.Cell><strong>{c.console.pruning}</strong></Table.Cell>
                  <Table.Cell colSpan={3} style={{ fontSize: '0.92em', lineHeight: 1.45 }}>
                    {c.console.prunedBefore}{' '}
                    <strong>
                      {this.state.bitcoinStatus.bitcoinPruneHeight != null
                        ? this.state.bitcoinStatus.bitcoinPruneHeight
                        : (bc && bc.pruneheight != null ? bc.pruneheight : t.common.none)}
                    </strong>{' '}
                    {c.console.prunedAfter}
                  </Table.Cell>
                </Table.Row>
              ) : null}
            </Table.Body>
          </Table>

          <Header as='h4'>{c.console.mempool}</Header>
          <Table compact celled unstackable size='small' style={{ marginBottom: '1em' }}>
            <Table.Body>
              <Table.Row>
                <Table.Cell><strong>{c.console.mempoolTxs}</strong></Table.Cell>
                <Table.Cell>
                  {this.state.bitcoinStatus.mempoolTxCount != null
                    ? this.state.bitcoinStatus.mempoolTxCount
                    : (mp && mp.size != null ? mp.size : t.common.none)}
                </Table.Cell>
                <Table.Cell><strong>{c.console.memoryUsage}</strong></Table.Cell>
                <Table.Cell>{mp && mp.usage != null ? this.formatBytes(mp.usage) : t.common.none}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell><strong>{c.console.mempoolSize}</strong></Table.Cell>
                <Table.Cell>{mp && mp.bytes != null ? this.formatBytes(mp.bytes) : t.common.none}</Table.Cell>
                <Table.Cell><strong>{c.console.mempoolFees}</strong></Table.Cell>
                <Table.Cell>
                  {this.state.bitcoinStatus.mempoolFeeSats != null
                    ? (
                      <>{t.common.sats(this.state.bitcoinStatus.mempoolFeeSats)}</>
                      )
                    : t.common.none}
                  {this.state.bitcoinStatus.mempoolFeesTruncated
                    ? <span style={{ color: '#b60' }}> {c.console.partialSum}</span>
                    : null}
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell><strong>{c.console.minRelayFee}</strong></Table.Cell>
                <Table.Cell>{mp && mp.minrelaytxfee != null ? this.formatFeeRate(mp.minrelaytxfee) : t.common.none}</Table.Cell>
                <Table.Cell><strong>{c.console.mempoolMinFee}</strong></Table.Cell>
                <Table.Cell>{mp && mp.mempoolminfee != null ? this.formatFeeRate(mp.mempoolminfee) : t.common.none}</Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table>

          <Header as='h4'>{c.console.networkTitle}</Header>
          <Table compact celled unstackable size='small' style={{ marginBottom: '1em' }}>
            <Table.Body>
              <Table.Row>
                <Table.Cell><strong>{c.console.connections}</strong></Table.Cell>
                <Table.Cell>
                  {ni
                    ? c.console.connectionsValue(ni.connections != null ? ni.connections : t.common.none, ni.connections_in != null ? ni.connections_in : 0, ni.connections_out != null ? ni.connections_out : 0)
                    : t.common.none}
                </Table.Cell>
                <Table.Cell><strong>{c.console.relayFee}</strong></Table.Cell>
                <Table.Cell>{ni && ni.relayfee != null ? this.formatFeeRate(ni.relayfee) : t.common.none}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell><strong>{c.console.userAgent}</strong></Table.Cell>
                <Table.Cell colSpan='3'>{ni && ni.subversion ? String(ni.subversion) : t.common.none}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell><strong>{c.console.protocol}</strong></Table.Cell>
                <Table.Cell colSpan='3'>
                  {ni
                    ? c.console.protocolValue(ni.protocolversion != null ? ni.protocolversion : t.common.none, ni.version != null ? ni.version : t.common.none)
                    : t.common.none}
                </Table.Cell>
              </Table.Row>
              {Array.isArray(this.state.bitcoinStatus.p2pAddNodeTargets) && this.state.bitcoinStatus.p2pAddNodeTargets.length > 0 && (
                <Table.Row>
                  <Table.Cell><strong>{c.console.playnet}</strong></Table.Cell>
                  <Table.Cell colSpan='3'>
                    <span style={{ color: '#555' }}>{c.console.playnetLead} </span>
                    {this.state.bitcoinStatus.p2pAddNodeTargets.map((h, i) => (
                      <span key={String(h) + i}>
                        {i > 0 ? ', ' : ''}
                        <code>{h}</code>
                      </span>
                    ))}
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table>

          <Header as='h4'>{c.console.deployments}</Header>
          {deploymentEntries.length === 0 ? (
            <p style={{ color: '#666', marginBottom: '1em' }}>{c.console.deploymentsEmpty}</p>
          ) : (
            <Table compact celled unstackable size='small' style={{ marginBottom: '1em' }}>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{c.console.deployment}</Table.HeaderCell>
                  <Table.HeaderCell>{c.console.status}</Table.HeaderCell>
                  <Table.HeaderCell>{c.console.heightBit}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {deploymentEntries.map(([name, info]) => {
                  const row = info && typeof info === 'object' ? info : {};
                  const active = row.active === true ? c.console.active : (row.active === false ? c.console.inactive : t.common.none);
                  const h = row.height != null ? row.height : (row.min_activation_height != null ? row.min_activation_height : t.common.none);
                  const bit = row.bip9 && row.bip9.bit != null ? row.bip9.bit : row.bit;
                  return (
                    <Table.Row key={name}>
                      <Table.Cell><code>{name}</code></Table.Cell>
                      <Table.Cell>{active}{row.type ? ` · ${row.type}` : ''}</Table.Cell>
                      <Table.Cell>{h}{bit != null && bit !== '' ? c.console.bit(bit) : ''}</Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          )}

          <Header as='h4'>{c.console.peers(nodePeers.length)}</Header>
          {nodePeers.length === 0 ? (
            <div style={{ marginBottom: '1em' }}>
              <p style={{ color: '#666', margin: '0 0 0.5em' }}>
                {bitcoinReady
                  ? (
                    <>
                      {ni && Number(ni.connections) > 0
                        ? (
                          <span>{c.console.peersTableFailed(Number(ni.connections))}</span>
                          )
                        : (
                          <span>
                            {c.console.noPeers}
                            {isRegtest
                              ? (
                                <>
                                  {' '}{c.console.noPeersRegtest}{' '}
                                  {c.console.noPeersFaucetBefore}{' '}
                                  <a href="https://hub.fabric.pub/services/bitcoin/faucet" target="_blank" rel="noopener noreferrer">{c.console.noPeersFaucetLink}</a>
                                  {c.console.noPeersFaucetAfter}
                                </>
                                )
                              : ` ${c.console.noPeersMainnet}`}
                          </span>
                          )}
                    </>
                    )
                  : (
                    <>{bitcoinHealthLabel}. {c.console.peersOffline}</>
                    )}
              </p>
              {bitcoinReady && isRegtest && !(ni && Number(ni.connections) > 0) ? (
                <details className="hub-developer-details" style={{ margin: '0 0 0.5em', color: '#666' }}>
                  <summary>{t.common.developerDetails}</summary>
                  {c.console.noPeersDeveloper}
                </details>
              ) : null}
              <Button
                type="button"
                size="small"
                basic
                icon
                labelPosition="left"
                loading={this.state.refreshing}
                disabled={this.state.refreshing}
                onClick={() => this.refresh()}
              >
                <Icon name="refresh" />
                {bitcoinReady ? c.console.refreshPeers : t.common.actions.retry}
              </Button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', marginBottom: '1em' }}>
              <Table compact celled unstackable sortable size='small'>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell
                      sorted={this.state.bitcoinPeerSortColumn === 'addr' ? this.state.bitcoinPeerSortDirection : null}
                      onClick={() => this._handleBitcoinPeerSort('addr')}
                    >
                      {c.console.address}
                    </Table.HeaderCell>
                    <Table.HeaderCell
                      sorted={this.state.bitcoinPeerSortColumn === 'direction' ? this.state.bitcoinPeerSortDirection : null}
                      onClick={() => this._handleBitcoinPeerSort('direction')}
                    >
                      {c.console.direction}
                    </Table.HeaderCell>
                    <Table.HeaderCell
                      sorted={this.state.bitcoinPeerSortColumn === 'ping' ? this.state.bitcoinPeerSortDirection : null}
                      onClick={() => this._handleBitcoinPeerSort('ping')}
                    >
                      {c.console.ping}
                    </Table.HeaderCell>
                    <Table.HeaderCell
                      sorted={this.state.bitcoinPeerSortColumn === 'bytes' ? this.state.bitcoinPeerSortDirection : null}
                      onClick={() => this._handleBitcoinPeerSort('bytes')}
                    >
                      {c.console.traffic}
                    </Table.HeaderCell>
                    <Table.HeaderCell
                      sorted={this.state.bitcoinPeerSortColumn === 'subver' ? this.state.bitcoinPeerSortDirection : null}
                      onClick={() => this._handleBitcoinPeerSort('subver')}
                    >
                      {c.console.userAgent}
                    </Table.HeaderCell>
                    <Table.HeaderCell
                      sorted={this.state.bitcoinPeerSortColumn === 'height' ? this.state.bitcoinPeerSortDirection : null}
                      onClick={() => this._handleBitcoinPeerSort('height')}
                    >
                      {c.console.height}
                    </Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {sortedNodePeers.slice(0, 40).map((p, i) => (
                    <Table.Row key={`${p.id != null ? p.id : i}-${p.addr || i}`}>
                      <Table.Cell><code style={{ fontSize: '0.85em' }}>{p.addr || p.addrbind || t.common.none}</code></Table.Cell>
                      <Table.Cell>{p.inbound ? 'inbound' : 'outbound'}</Table.Cell>
                      <Table.Cell>{p.pingtime != null ? Number(p.pingtime).toFixed(0) : t.common.none}</Table.Cell>
                      <Table.Cell>
                        {p.bytesrecv != null || p.bytessent != null
                          ? `${p.bytesrecv != null ? this.formatBytes(p.bytesrecv) : t.common.none} / ${p.bytessent != null ? this.formatBytes(p.bytessent) : t.common.none}`
                          : t.common.none}
                      </Table.Cell>
                      <Table.Cell style={{ maxWidth: '14em', wordBreak: 'break-word', fontSize: '0.85em' }}>
                        {p.subver || t.common.none}
                      </Table.Cell>
                      <Table.Cell>
                        {p.synced_headers != null
                          ? p.synced_headers
                          : (p.synced_blocks != null ? p.synced_blocks : (p.startingheight != null ? p.startingheight : t.common.none))}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
          )}

          <Header as='h4'>{c.tools.title}</Header>
          <Form style={{ marginBottom: '0.75em' }}>
            <Form.Group widths='equal'>
              <Form.Field>
                <label htmlFor='bitcoin-tx-lookup'>{c.tools.txidLabel}</label>
                <Input
                  id='bitcoin-tx-lookup'
                  placeholder={c.tools.txidPlaceholder}
                  value={this.state.txLookupId}
                  onChange={(e) => this.setState({ txLookupId: e.target.value, txLookupError: null })}
                />
              </Form.Field>
              <Form.Field style={{ alignSelf: 'flex-end' }}>
                <Button
                  type='button'
                  primary
                  disabled={!bitcoinReady || !hubUi.bitcoinExplorer}
                  title={!hubUi.bitcoinExplorer ? shared.explorerRoutesOff : undefined}
                  onClick={() => this.handleTxLookup()}
                >
                  <Icon name='search' />
                  {c.tools.openTransaction}
                </Button>
              </Form.Field>
            </Form.Group>
            {this.state.txLookupError && (
              <Message negative size='small'>{this.state.txLookupError}</Message>
            )}
          </Form>

          <p style={{ color: '#666', marginBottom: '0.35em' }}>
            <strong>{c.tools.broadcastTitle}</strong> {c.tools.broadcastIntro}
          </p>
          <Form>
            <Form.TextArea
              id='bitcoin-broadcast-hex'
              label={c.tools.broadcastLabel}
              rows={4}
              placeholder={c.tools.broadcastPlaceholder}
              value={this.state.rawTxHex}
              onChange={(e) => this.setState({ rawTxHex: e.target.value, rawTxResult: null })}
              disabled={!hasAdminToken}
            />
            <Button
              type='button'
              color='orange'
              style={{ marginTop: '0.5em' }}
              disabled={!bitcoinReady || !hasAdminToken || !(this.state.rawTxHex || '').trim()}
              onClick={() => this.handleBroadcastRawTx()}
            >
              <Icon name='send' />
              {c.tools.broadcast}
            </Button>
          </Form>
          {this.state.rawTxResult && (
            <Message
              style={{ marginTop: '0.75em' }}
              negative={!!this.state.rawTxResult.error}
              positive={!this.state.rawTxResult.error}
            >
              <Message.Header>{this.state.rawTxResult.error ? c.tools.broadcastFailed : c.tools.broadcastOk}</Message.Header>
              {this.state.rawTxResult.error ? (
                <p>{this.state.rawTxResult.error}</p>
              ) : (
                <p>
                  {c.tools.txidLead}{' '}
                  {this.state.rawTxResult.txid
                    ? (
                      hubUi.bitcoinExplorer ? (
                        <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(this.state.rawTxResult.txid))}`}>
                          <code>{this.state.rawTxResult.txid}</code>
                        </Link>
                      ) : (
                        <code>{this.state.rawTxResult.txid}</code>
                      )
                      )
                    : t.common.none}
                </p>
              )}
            </Message>
          )}
        </Segment>

        <Segment loading={this.state.loading}>
          <Header as='h3'>{c.wallet.title}</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>
            <strong>{c.wallet.yoursLead}</strong> {c.wallet.yours}{' '}
            <strong>{c.wallet.hubLead}</strong> {c.wallet.hub(isRegtest)}{' '}
            <strong>{c.wallet.documentsLead}</strong> {c.wallet.documentsBefore} <Link to="/documents">{c.wallet.distribute}</Link> {c.wallet.documentsAfter}
            {' '}
            {(hubUi.bitcoinPayments || hubUi.bitcoinLightning)
              ? c.wallet.hubRuns(!!hubUi.bitcoinPayments, !!hubUi.bitcoinLightning)
              : c.wallet.turnOnFeatures}
            {!wallet.hasPrivateKey && wallet.walletId && (
              <span style={{ display: 'block', marginTop: '0.25em', color: '#0a6' }}>
                <Icon name='eye' /> {c.wallet.watchOnly}
              </span>
            )}
          </p>
          <div><strong>{c.wallet.walletId}</strong> <code>{wallet.walletId || shared.notAvailable}</code></div>
          <div><strong>{c.wallet.fingerprint}</strong> <code>{wallet.fingerprint || shared.notAvailable}</code></div>
          <div><strong>{c.wallet.keysOnHub}</strong> {wallet.hasPrivateKey ? c.wallet.keysYes : c.wallet.keysNo}</div>
          <div style={{ marginTop: '0.75em' }}><strong>{c.wallet.balance}</strong> {t.common.sats(wallet.balanceSats)}</div>
          <div><strong>{c.wallet.confirmed}</strong> {t.common.sats(wallet.confirmedSats)}</div>
          <div><strong>{c.wallet.unconfirmed}</strong> {t.common.sats(wallet.unconfirmedSats)}</div>
          {wallet.balanceSats === 0 && bitcoinNetwork === 'regtest' && (
            <div style={{ marginTop: '0.5em', color: '#0a6', fontSize: '0.9em' }}>
              <Icon name='info circle' /> {c.wallet.regtestZero}
            </div>
          )}
          <div style={{ marginTop: '0.5em' }}>
            <strong>{c.wallet.receiveAddress}</strong>{' '}
            <code>{wallet.address || shared.notAvailable}</code>
            {wallet.address ? (
              <Button
                basic
                size='mini'
                style={{ marginLeft: '0.5em' }}
                onClick={() => this.handleNextReceiveAddress()}
                title={c.wallet.nextAddressTitle}
              >
                <Icon name='plus' />
                {c.wallet.nextAddress}
              </Button>
            ) : null}
          </div>
          <div><strong>{c.wallet.receiveIndex}</strong> {wallet.receiveIndex}</div>
          {hubUi.bitcoinPayments ? (
            <React.Fragment>
              <div style={{ marginTop: '0.75em' }}>
                <Checkbox
                  toggle
                  checked={!!this.state.payjoinEnabled}
                  onChange={(e, data) => {
                    const v = !!(data && data.checked);
                    savePayjoinPreferences({ operatorDeposit: v });
                    this.setState({ payjoinEnabled: v });
                  }}
                  label={c.wallet.payjoinToggle}
                  disabled={!(this.state.payjoinCapabilities && this.state.payjoinCapabilities.available)}
                />
              </div>
              <div style={{ marginTop: '0.25em', color: '#666' }}>
                {c.wallet.payjoinStatus}{' '}
                <strong>{this.state.payjoinCapabilities && this.state.payjoinCapabilities.available ? c.wallet.payjoinAvailable : t.common.states.unavailable}</strong>
              </div>
            </React.Fragment>
          ) : null}
        </Segment>

        <Segment>
          <Header as='h3'>{c.lookup.title}</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>
            <Icon name='search' /> {c.lookup.intro}
          </p>
          <Form>
            <Form.Field>
              <label htmlFor='bitcoin-lookup-address'>{c.lookup.label(bitcoinNetwork)}</label>
              <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
                <Input
                  id='bitcoin-lookup-address'
                  placeholder={addressPlaceholder}
                  value={this.state.lookupAddress}
                  onChange={(e) => this.setState({ lookupAddress: e.target.value })}
                  style={{ flex: '1 1 16em', minWidth: '14em' }}
                />
                {wallet.address && (
                  <Button
                    type='button'
                    basic
                    onClick={() => this.setState({ lookupAddress: wallet.address })}
                    title={c.lookup.useMineTitle}
                  >
                    {c.lookup.useMine}
                  </Button>
                )}
                <Button
                  primary
                  loading={this.state.lookupLoading}
                  onClick={() => this.handleLookupAddress()}
                  disabled={!bitcoinReady || !(this.state.lookupAddress || '').trim()}
                >
                  <Icon name='search' />
                  {c.lookup.submit}
                </Button>
              </div>
            </Form.Field>
          </Form>
          {this.state.lookupResult && (
            <Message
              style={{ marginTop: '1em' }}
              negative={!!this.state.lookupResult.error}
              positive={!this.state.lookupResult.error}
            >
              <Message.Header>
                {this.state.lookupResult.error ? c.lookup.failed : c.lookup.ok}
              </Message.Header>
              {this.state.lookupResult.error ? (
                <p>{this.state.lookupResult.error}</p>
              ) : (
                <div>
                  <div><strong>{c.lookup.balance}</strong> {t.common.sats(this.state.lookupResult.balanceSats || 0)}</div>
                  {this.state.lookupResult.network && <div><strong>{c.lookup.network}</strong> {this.state.lookupResult.network}</div>}
                </div>
              )}
            </Message>
          )}
        </Segment>

        {hubUi.bitcoinCrowdfund ? (
          <Segment id="fabric-bitcoin-crowdfunding">
            <Message info>
              <Message.Header>{c.crowdfunds.title}</Message.Header>
              <p style={{ margin: '0.35em 0 0' }}>
                {c.crowdfunds.before}{' '}
                <Link to="/services/bitcoin/crowdfunds">{c.crowdfunds.link}</Link> {c.crowdfunds.after}
              </p>
            </Message>
          </Segment>
        ) : null}

        {hubUi.bitcoinPayments ? (
        <Segment id="fabric-bitcoin-payjoin" data-testid="hub-payjoin-deposit">
          <Header as='h3'>{c.payjoin.title}</Header>
          {this.state.payjoinSessionsSnapshot ? (
            <Message
              id="fabric-bitcoin-payjoin-sessions-strip"
              size="small"
              info
              style={{ marginTop: '0.25rem', marginBottom: '1rem' }}
            >
              <Icon name="list alternate outline" />
              {c.payjoin.sessions(
                Number(this.state.payjoinSessionsSnapshot.activeNotExpired || 0),
                Number(this.state.payjoinSessionsSnapshot.awaitingCompletion || 0)
              )}{' '}
              {c.payjoin.sessionsSee}{' '}
              <Link to="/payments">{c.payjoin.sessionsPayments}</Link>
              {' '}{c.payjoin.sessionsAfter}
            </Message>
          ) : null}
          <p style={{ color: '#666' }}>{c.payjoin.intro}</p>
          <Form>
            <Form.Group widths='equal'>
              <Form.Field>
                <label htmlFor='bitcoin-payjoin-amount'>{c.payjoin.amount}</label>
                <Input
                  id='bitcoin-payjoin-amount'
                  type='number'
                  min='0'
                  step='1'
                  placeholder={c.payjoin.amountPlaceholder}
                  value={this.state.payjoinAmountSats}
                  onChange={(e) => this.setState({ payjoinAmountSats: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor='bitcoin-payjoin-label'>{c.payjoin.label}</label>
                <Input
                  id='bitcoin-payjoin-label'
                  placeholder={c.payjoin.labelPlaceholder}
                  value={this.state.payjoinLabel}
                  onChange={(e) => this.setState({ payjoinLabel: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor='bitcoin-payjoin-memo'>{c.payjoin.memo}</label>
                <Input
                  id='bitcoin-payjoin-memo'
                  placeholder={c.payjoin.memoPlaceholder}
                  value={this.state.payjoinMemo}
                  onChange={(e) => this.setState({ payjoinMemo: e.target.value })}
                />
              </Form.Field>
            </Form.Group>
            <Button primary onClick={() => this.handleCreatePayjoinDeposit()} disabled={!this.state.payjoinEnabled}>
              <Icon name='shield alternate' />
              {c.payjoin.create}
            </Button>
            <Button basic onClick={() => this.handleRefreshPayjoinSession()} disabled={!this.state.payjoinSessionId}>
              <Icon name='refresh' />
              {c.payjoin.refresh}
            </Button>
          </Form>
          {this.state.payjoinResult && (
            <Message
              style={{ marginTop: '1em' }}
              negative={!!this.state.payjoinResult.error}
              positive={!this.state.payjoinResult.error}
            >
              <Message.Header>{this.state.payjoinResult.error ? c.payjoin.failed : c.payjoin.session}</Message.Header>
              {!this.state.payjoinResult.error && (this.state.payjoinResult.id || this.state.payjoinResult.bip21Uri) && (
                <div style={{ marginBottom: '0.75em', display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
                  <Button
                    size="small"
                    basic
                    type="button"
                    disabled={!this.state.payjoinResult.bip21Uri}
                    onClick={() => copyToClipboard(this.state.payjoinResult.bip21Uri || '')}
                    title={c.payjoin.copyLinkTitle}
                  >
                    <Icon name="copy outline" />
                    {c.payjoin.copyLink}
                  </Button>
                  <Button
                    size="small"
                    basic
                    type="button"
                    disabled={!this.state.payjoinResult.id}
                    onClick={() => copyToClipboard(String(this.state.payjoinResult.id || ''))}
                  >
                    <Icon name="copy outline" />
                    {c.payjoin.copySession}
                  </Button>
                  <Button
                    as={Link}
                    size="small"
                    primary
                    to={this.state.payjoinResult.id
                      ? `/payments?payjoinSession=${encodeURIComponent(this.state.payjoinResult.id)}`
                      : '/payments'}
                  >
                    <Icon name="credit card outline" />
                    {c.payjoin.openPayments}
                  </Button>
                </div>
              )}
              {this.state.payjoinResult.error ? <p>{this.state.payjoinResult.error}</p> : null}
              <details className="hub-developer-details">
                <summary>{t.common.developerDetails}</summary>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(this.state.payjoinResult, null, 2)}</pre>
              </details>
            </Message>
          )}
        </Segment>
        ) : null}

        {isFaucetPage ? (
        <Segment data-faucet-segment id="fabric-bitcoin-faucet">
          <Header as='h3'>{c.faucet.title}</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>
            {c.faucet.intro(1000000)}
            {bitcoinNetwork ? ` ${c.faucet.useNetwork(bitcoinNetwork, addressPlaceholder)}` : null}
            {' '}{c.faucet.useMineHint}
            {' '}{c.faucet.blockNote}
          </p>
          <div style={{ marginBottom: '0.5em' }}>
            <strong>{c.faucet.network}</strong> {bitcoinNetwork || c.faucet.unknownNetwork}
          </div>
          <div style={{ marginBottom: '1em' }}>
            <strong>{c.faucet.hubBalance}</strong>{' '}
            {t.common.sats(hubWalletSats)}
            {this.state.bitcoinStatus && this.state.bitcoinStatus.beacon && (
              <span style={{ marginLeft: '1em', color: '#666' }}>
                {c.faucet.beaconBalance(t.common.sats(this.state.bitcoinStatus.beacon.balanceSats || 0))}
              </span>
            )}
          </div>
          <Form>
            <Form.Field>
              <label htmlFor='bitcoin-faucet-address'>{c.faucet.addressLabel(bitcoinNetwork)}</label>
              <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
                <Input
                  id='bitcoin-faucet-address'
                  placeholder={addressPlaceholder}
                  value={this.state.faucetAddress}
                  onChange={(e) => this.setState({ faucetAddress: e.target.value })}
                  style={{ flex: '1 1 12em', minWidth: '14em' }}
                />
                {wallet.address && canGenerateBlocks && (
                  <Button
                    type='button'
                    basic
                    onClick={() => this.setState({ faucetAddress: wallet.address })}
                    title={c.faucet.useMineTitle}
                  >
                    {c.faucet.useMine}
                  </Button>
                )}
              </div>
            </Form.Field>
            <Form.Field>
              <label htmlFor='bitcoin-faucet-amount'>{c.faucet.amount}</label>
              <Input
                id='bitcoin-faucet-amount'
                type='number'
                min='1'
                max='1000000'
                step='1'
                value={this.state.faucetAmountSats}
                onChange={(e) => this.setState({ faucetAmountSats: e.target.value })}
              />
            </Form.Field>
            <Button
              primary
              onClick={() => this.handleRequestFaucet()}
              disabled={!canGenerateBlocks || !(this.state.faucetAddress || '').trim()}
              title={!canGenerateBlocks ? c.faucet.needsRegtest : !(this.state.faucetAddress || '').trim() ? c.faucet.needsAddress(bitcoinNetwork, addressPlaceholder) : c.faucet.submitTitle}
            >
              <Icon name='tint' />
              {c.faucet.submit}
            </Button>
          </Form>
          {this.state.faucetResult && (
            <Message style={{ marginTop: '1em' }} positive={!this.state.faucetResult.error} negative={!!this.state.faucetResult.error}>
              <Message.Header>{this.state.faucetResult.error ? c.faucet.failed : c.faucet.ok}</Message.Header>
              {!this.state.faucetResult.error && (() => {
                const fr = this.state.faucetResult;
                const faucet = fr && fr.faucet;
                const txid = faucet && faucet.txid;
                const amountSats = faucet && faucet.amountSats;
                const dest = faucet && faucet.destination;
                if (txid || amountSats) {
                  return (
                    <p style={{ marginTop: '0.5em', marginBottom: '0.5em' }}>
                      {c.faucet.sent(amountSats ? Number(amountSats) : 0, dest ? `${dest.slice(0, 12)}…${dest.slice(-8)}` : '')}
                      {txid ? (
                        <span style={{ display: 'block', marginTop: '0.35em' }}>
                          {hubUi.bitcoinExplorer ? (
                            <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(txid))}`}>
                              {shared.viewTransaction}
                            </Link>
                          ) : (
                            <code style={{ fontSize: '0.9em' }}>{String(txid)}</code>
                          )}
                        </span>
                      ) : null}
                    </p>
                  );
                }
                return null;
              })()}
              {this.state.faucetResult.error ? <p>{this.state.faucetResult.error}</p> : null}
              <details className="hub-developer-details">
                <summary>{t.common.developerDetails}</summary>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '0.5em' }}>{JSON.stringify(this.state.faucetResult, null, 2)}</pre>
              </details>
            </Message>
          )}
        </Segment>
        ) : null}

        {hubUi.bitcoinPayments ? (
        <Segment>
          <Header as='h3'>{c.sendMoved.title}</Header>
          <p style={{ color: '#666', marginBottom: 0 }}>
            {c.sendMoved.body}{' '}
            <Link to="/services/bitcoin/transactions?scope=wallet#fabric-federation-wallet-panel">{c.sendMoved.link}</Link>.
          </p>
        </Segment>
        ) : null}

        {hubUi.bitcoinLightning && isLightningPage ? (
        <Segment id="fabric-bitcoin-lightning">
          <Header as='h3'>{c.lightning.title}</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>{c.lightning.intro}</p>
          {lightningAvailable && this.state.lightningStatus && this.state.lightningStatus.status === 'RUNNING' && (
            <>
              <Message positive style={{ marginBottom: '1em' }}>
                <Message.Header>
                  <Icon name='bolt' />
                  {c.lightning.running}
                  {this.state.lightningStatus.node && this.state.lightningStatus.node.alias
                    ? ` — ${this.state.lightningStatus.node.alias}`
                    : ''}
                </Message.Header>
                <p>
                  {c.lightning.channels(this.state.lightningChannels.length)}
                </p>
              </Message>
              {this.state.lightningStatus.node && (this.state.lightningStatus.node.id || this.state.lightningStatus.node.address || this.state.lightningStatus.node.binding) && (
                <Segment style={{ padding: '0.75em', marginBottom: '1em', background: 'rgba(0,0,0,0.03)' }}>
                  <Header as='h5' style={{ margin: '0 0 0.5em 0' }}>{c.lightning.share}</Header>
                  {this.state.lightningStatus.node.id && (
                    <div style={{ marginBottom: '0.5em' }}>
                      <strong>{c.lightning.nodeId}</strong>{' '}
                      <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{this.state.lightningStatus.node.id}</code>
                    </div>
                  )}
                  {(this.state.lightningStatus.node.address || this.state.lightningStatus.node.binding) && (
                    <div style={{ marginBottom: '0.5em' }}>
                      <strong>{c.lightning.address}</strong>{' '}
                      <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{this.state.lightningStatus.node.address || this.state.lightningStatus.node.binding}</code>
                    </div>
                  )}
                  {this.state.lightningStatus.node.id && (this.state.lightningStatus.node.address || this.state.lightningStatus.node.binding) && (
                    <div style={{ marginBottom: '0.5em' }}>
                      <strong>{c.lightning.connect}</strong>{' '}
                      <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{this.state.lightningStatus.node.id}@{this.state.lightningStatus.node.address || this.state.lightningStatus.node.binding}</code>
                    </div>
                  )}
                  {(this.state.lightningStatus.node.id || this.state.lightningStatus.node.address || this.state.lightningStatus.node.binding) && (
                    <Button
                      size='small'
                      basic
                      icon
                      labelPosition='left'
                      onClick={() => {
                        const node = this.state.lightningStatus.node;
                        const hostPort = node.address || node.binding;
                        const parts = [];
                        if (node.id) parts.push(node.id);
                        if (hostPort) parts.push(hostPort);
                        if (node.id && hostPort) parts.push(`${node.id}@${hostPort}`);
                        const text = parts.join('\n');
                        try {
                          if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(text);
                          } else {
                            const ta = document.createElement('textarea');
                            ta.value = text;
                            ta.style.position = 'fixed';
                            ta.style.opacity = '0';
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                          }
                        } catch (e) {}
                      }}
                      title={c.lightning.copyNodeTitle}
                    >
                      <Icon name='copy' />
                      {c.lightning.copyNode}
                    </Button>
                  )}
                </Segment>
              )}
            </>
          )}
          {!lightningAvailable && (
            <Message info>
              <Message.Header>{c.lightning.unavailableTitle}</Message.Header>
              <p>{(this.state.lightningStatus && this.state.lightningStatus.message) || c.lightning.unavailable}</p>
            </Message>
          )}

          {lightningAvailable && this.state.lightningStatus && this.state.lightningStatus.status === 'RUNNING' && (
            <Segment style={{ padding: '0.75em', marginBottom: '1em', background: 'rgba(0,0,0,0.02)' }}>
              <Header as='h5' style={{ margin: '0 0 0.5em 0' }}>{c.lightning.fundTitle}</Header>
              <p style={{ color: '#666', marginBottom: '0.5em', fontSize: '0.95em' }}>{c.lightning.fundIntro}</p>
              {this.state.lightningStatus.node && this.state.lightningStatus.node.depositAddress && (
                <div style={{ marginBottom: '0.5em' }}>
                  <strong>{c.lightning.depositAddress}</strong>{' '}
                  <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{this.state.lightningStatus.node.depositAddress}</code>
                  <Button
                    size='mini'
                    basic
                    icon
                    style={{ marginLeft: '0.25em' }}
                    onClick={() => {
                      const addr = this.state.lightningStatus.node.depositAddress;
                      try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                          navigator.clipboard.writeText(addr);
                        } else {
                          const ta = document.createElement('textarea');
                          ta.value = addr;
                          ta.style.position = 'fixed';
                          ta.style.opacity = '0';
                          document.body.appendChild(ta);
                          ta.select();
                          document.execCommand('copy');
                          document.body.removeChild(ta);
                        }
                      } catch (e) {}
                    }}
                    title={c.lightning.copyDeposit}
                    aria-label={c.lightning.copyDeposit}
                  >
                    <Icon name='copy' />
                  </Button>
                  <Button
                    size='mini'
                    basic
                    icon
                    style={{ marginLeft: '0.25em' }}
                    onClick={() => {
                      this.setState({ faucetAddress: this.state.lightningStatus.node.depositAddress });
                      const faucetSegment = document.querySelector('[data-faucet-segment]');
                      if (faucetSegment) faucetSegment.scrollIntoView({ behavior: 'smooth' });
                    }}
                    title={c.lightning.useInFaucetTitle}
                  >
                    <Icon name='tint' />
                    {c.lightning.useInFaucet}
                  </Button>
                </div>
              )}
              {this.state.lightningStatus.node && (() => {
                const node = this.state.lightningStatus.node;
                const fromStatus = {
                  confirmed: Number(node.balanceSats ?? 0),
                  unconfirmed: Number(node.balanceUnconfirmedSats ?? 0),
                  immature: Number(node.balanceImmatureSats ?? 0)
                };
                const fromOutputs = this.getLightningBalanceFromOutputs(this.state.lightningOutputs);
                const statusTotal = fromStatus.confirmed + fromStatus.unconfirmed + fromStatus.immature;
                const outputsTotal = fromOutputs.confirmed + fromOutputs.unconfirmed + fromOutputs.immature;
                const bal = outputsTotal > statusTotal ? fromOutputs : fromStatus;
                const total = bal.confirmed + bal.unconfirmed + bal.immature;
                return (
                <div style={{ marginBottom: '0.5em' }}>
                  <strong>{c.lightning.onChain}</strong>{' '}
                  {c.lightning.confirmed(t.common.sats(bal.confirmed))}
                  {bal.unconfirmed > 0 && (
                    <span style={{ marginLeft: '0.5em' }}>
                      {c.lightning.plusUnconfirmed(t.common.sats(bal.unconfirmed))}
                    </span>
                  )}
                  {bal.immature > 0 && (
                    <span style={{ marginLeft: '0.5em' }}>
                      {c.lightning.plusImmature(t.common.sats(bal.immature))}
                    </span>
                  )}
                  {total > 0 && (bal.unconfirmed > 0 || bal.immature > 0) && (
                    <span style={{ marginLeft: '0.5em', fontWeight: 600 }}>
                      {c.lightning.total(t.common.sats(total))}
                    </span>
                  )}
                  {total < 10000 && (
                    <span style={{ marginLeft: '0.5em', color: '#b00' }}>{c.lightning.needMin(10000)}</span>
                  )}
                  {(this.state.bitcoinStatus && this.state.bitcoinStatus.network === 'regtest') && (
                    <p style={{ fontSize: '0.85em', color: '#666', marginTop: '0.25em', marginBottom: 0 }}>
                      {c.lightning.regtestConfirm}
                    </p>
                  )}
                </div>
                );
              })()}
            </Segment>
          )}

          {lightningAvailable && (
            <>
              <Header as='h4' style={{ marginTop: '1em' }}>
                <Link to="/contracts" style={{ color: 'inherit' }}>
                  {c.lightning.channelsTitle(this.state.lightningChannels.length)}
                </Link>
              </Header>
              {this.state.lightningChannels.length === 0 ? (
                <p style={{ color: '#666' }}>{c.lightning.noChannels}</p>
              ) : (
                <Table celled compact size='small'>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>{c.lightning.peer}</Table.HeaderCell>
                      <Table.HeaderCell>{c.lightning.state}</Table.HeaderCell>
                      <Table.HeaderCell>{c.lightning.capacity}</Table.HeaderCell>
                      <Table.HeaderCell>{c.lightning.ourBalance}</Table.HeaderCell>
                      <Table.HeaderCell>{c.lightning.shortChannelId}</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {this.state.lightningChannels.map((lnChannel, listIndex) => {
                      const idForPath = lnChannel.channel_id || lnChannel.funding_txid;
                      const path = (idForPath != null && String(idForPath).trim() !== '')
                        ? `/services/bitcoin/channels/${encodeURIComponent(String(idForPath).trim())}`
                        : null;
                      const rowKey = path != null ? path : `ln-ch-${listIndex}`;
                      return (
                        <Table.Row
                          key={rowKey}
                          style={{ cursor: 'pointer' }}
                          onClick={path ? () => this.navigateInternalPath(path) : undefined}
                        >
                          <Table.Cell>
                            <code style={{ fontSize: '0.85em' }}>{this.trimHash(lnChannel.peer_id || lnChannel.funding_txid || '')}</code>
                          </Table.Cell>
                          <Table.Cell>{lnChannel.state || t.common.none}</Table.Cell>
                          <Table.Cell>
                            {lnChannel.amount_msat != null ? t.common.sats(Math.floor(Number(lnChannel.amount_msat) / 1000)) : (lnChannel.channel_sat != null ? t.common.sats(lnChannel.channel_sat) : t.common.none)}
                          </Table.Cell>
                          <Table.Cell>
                            {lnChannel.our_amount_msat != null ? t.common.sats(Math.floor(Number(lnChannel.our_amount_msat) / 1000)) : t.common.none}
                          </Table.Cell>
                          <Table.Cell>
                            <code style={{ fontSize: '0.8em' }}>{lnChannel.short_channel_id || t.common.none}</code>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table>
              )}

              <Header as='h4' style={{ marginTop: '1.5em' }}>{c.lightning.createTitle}</Header>
              <p style={{ color: '#666', marginBottom: '0.5em' }}>{c.lightning.createIntro}</p>
              <Form>
                <Form.Group widths='equal'>
                  <Form.Field>
                    <label htmlFor='bitcoin-ln-remote'>{c.lightning.remote}</label>
                    <Input
                      id='bitcoin-ln-remote'
                      placeholder='03abc123…@192.168.50.5:9735'
                      value={this.state.channelCreateRemote}
                      onChange={(e) => this.setState({ channelCreateRemote: e.target.value })}
                    />
                  </Form.Field>
                </Form.Group>
                <Form.Group widths='equal'>
                  <Form.Field>
                    <label htmlFor='bitcoin-ln-amount'>{c.lightning.channelAmount(10000)}</label>
                    <Input
                      id='bitcoin-ln-amount'
                      type='number'
                      min='10000'
                      value={this.state.channelCreateAmountSats}
                      onChange={(e) => this.setState({ channelCreateAmountSats: e.target.value })}
                    />
                  </Form.Field>
                  <Form.Field>
                    <label htmlFor='bitcoin-ln-push'>{c.lightning.push}</label>
                    <Input
                      id='bitcoin-ln-push'
                      type='number'
                      min='0'
                      value={this.state.channelCreatePushMsat}
                      onChange={(e) => this.setState({ channelCreatePushMsat: e.target.value })}
                    />
                  </Form.Field>
                </Form.Group>
                <Button
                  primary
                  loading={this.state.channelCreateLoading}
                  disabled={!lightningAvailable || this.state.channelCreateLoading}
                  onClick={() => this.handleCreateChannel()}
                >
                  <Icon name='plug' />
                  {c.lightning.create}
                </Button>
              </Form>
              {this.state.channelCreateResult && (
                <Message
                  style={{ marginTop: '1em' }}
                  negative={!!this.state.channelCreateResult.error}
                  positive={!this.state.channelCreateResult.error}
                >
                  <Message.Header>{this.state.channelCreateResult.error ? c.lightning.createFailed : c.lightning.created}</Message.Header>
                  {this.state.channelCreateResult.error && (
                    <p style={{ marginBottom: '0.5em' }}>
                      {this.state.channelCreateResult.error}
                      {this.state.channelCreateResult.detail && ` — ${this.state.channelCreateResult.detail}`}
                    </p>
                  )}
                  {this.state.channelCreateResult.error && /connect|peer|connection/i.test(this.state.channelCreateResult.error) && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginTop: '0.5em' }}>
                      {c.lightning.hintConnect}
                    </p>
                  )}
                  {this.state.channelCreateResult.error && /wrong key|handshake/i.test(this.state.channelCreateResult.error) && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginTop: '0.5em' }}>
                      {c.lightning.hintWrongKey}
                    </p>
                  )}
                  {this.state.channelCreateResult.error && /bad file descriptor/i.test(this.state.channelCreateResult.error) && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginTop: '0.5em' }}>
                      {c.lightning.hintBadFd}
                    </p>
                  )}
                  {this.state.channelCreateResult.error && /Unsupported feature|feature 44|WIRE_WARNING|peer_disconnected/i.test(
                    [this.state.channelCreateResult.error, this.state.channelCreateResult.detail].filter(Boolean).join(' ')
                  ) && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginTop: '0.5em' }}>
                      {c.lightning.hintFeature44}
                    </p>
                  )}
                  {this.state.channelCreateResult.hint && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginTop: '0.5em' }}>
                      {this.state.channelCreateResult.hint}
                    </p>
                  )}
                  {this.state.channelCreateResult.status && (
                    <p style={{ fontSize: '0.85em', color: '#555', marginTop: '0.5em' }}>
                      <strong>{c.lightning.statusLead}</strong> {this.state.channelCreateResult.status.peerCount != null ? c.lightning.statusPeers(this.state.channelCreateResult.status.peerCount) : t.common.none} {this.state.channelCreateResult.status.idleDisconnected != null ? c.lightning.statusIdle(this.state.channelCreateResult.status.idleDisconnected) : ''}
                    </p>
                  )}
                  <details className="hub-developer-details">
                    <summary>{t.common.developerDetails}</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '0.5em' }}>{JSON.stringify(this.state.channelCreateResult, null, 2)}</pre>
                  </details>
                </Message>
              )}
            </>
          )}

          <Header as='h4' style={{ marginTop: '1.5em' }}>{c.lightning.invoicesTitle}</Header>
          <p style={{ fontSize: '0.88em', color: '#666', margin: '0 0 0.75em' }}>
            {c.lightning.invoicesBefore}{' '}
            {hubUi.bitcoinInvoices ? (
              <Link to="/services/bitcoin/invoices#fabric-invoices-tab-demo">{c.lightning.invoicesLink}</Link>
            ) : (
              <strong>{c.lightning.invoicesLink}</strong>
            )}.
          </p>
          <Form>
            <Form.Group widths='equal'>
              <Form.Field>
                <label htmlFor='bitcoin-ln-invoice-amount'>{c.lightning.invoiceAmount}</label>
                <Input
                  id='bitcoin-ln-invoice-amount'
                  type='number'
                  min='1'
                  step='1'
                  value={this.state.invoiceAmountSats}
                  onChange={(e) => this.setState({ invoiceAmountSats: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor='bitcoin-ln-invoice-memo'>{c.lightning.invoiceMemo}</label>
                <Input
                  id='bitcoin-ln-invoice-memo'
                  placeholder={c.lightning.invoiceMemoPlaceholder}
                  value={this.state.invoiceMemo}
                  onChange={(e) => this.setState({ invoiceMemo: e.target.value })}
                />
              </Form.Field>
            </Form.Group>
            <Button onClick={() => this.handleCreateLightningInvoice()} disabled={!lightningAvailable}>
              <Icon name='add circle' />
              {c.lightning.createInvoice}
            </Button>
            <Form.Field style={{ marginTop: '1em' }}>
              <label htmlFor='bitcoin-ln-invoice'>{c.lightning.invoiceInput}</label>
              <Form.TextArea
                id='bitcoin-ln-invoice'
                rows={3}
                placeholder='lnbc…'
                value={this.state.invoiceInput}
                onChange={(e) => this.setState({ invoiceInput: e.target.value })}
              />
            </Form.Field>
            <Button basic onClick={() => this.handleDecodeLightningInvoice()} disabled={!lightningAvailable}>
              <Icon name='search' />
              {c.lightning.decode}
            </Button>
            <Button color='green' onClick={() => this.handlePayLightningInvoice()} disabled={!lightningAvailable}>
              <Icon name='bolt' />
              {c.lightning.pay}
            </Button>
          </Form>
          {this.state.lightningResult && (
            <Message
              style={{ marginTop: '1em' }}
              negative={!!this.state.lightningResult.error}
              positive={!this.state.lightningResult.error}
            >
              <Message.Header>{this.state.lightningResult.error ? c.lightning.failed : c.lightning.response}</Message.Header>
              {this.state.lightningResult.error ? <p>{this.state.lightningResult.error}</p> : null}
              <details className="hub-developer-details">
                <summary>{t.common.developerDetails}</summary>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(this.state.lightningResult, null, 2)}</pre>
              </details>
            </Message>
          )}
        </Segment>
        ) : null}

        {isExplorerPage ? (
        <Segment id="bitcoin-explorer">
          <Header as='h3'>{c.explorerSection.title}</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>{c.explorerSection.intro}</p>
          {!hubUi.bitcoinExplorer && (this.state.blocks.length > 0 || this.state.transactions.length > 0) ? (
            <Message info size="small" style={{ marginBottom: '0.75em' }}>
              {shared.explorerRoutesOff}
            </Message>
          ) : null}
          <Header as='h4'>{c.explorerSection.recentBlocks}</Header>
          {this.state.blocks.length === 0 ? (
            explorerDataPending ? (
              <p style={{ color: '#666' }}>
                <Loader inline active size="small" /> {c.explorerSection.loadingBlocks}
              </p>
            ) : (
              <div style={{ color: '#666' }}>
                <p style={{ margin: '0 0 0.35em', fontWeight: 600, color: '#444' }}>{shared.noBlocks.title}</p>
                <p style={{ margin: '0 0 0.35em' }}>{shared.noBlocks.body}</p>
                {bitcoinHealth !== 'ok' ? <p style={{ margin: '0 0 0.35em' }}>{bitcoinHealthLabel}. {bitcoinHealthHint}</p> : null}
                <p style={{ margin: '0 0 0.35em' }}>{shared.noBlocks.check}</p>
                {isRegtest ? <p style={{ margin: 0 }}>{shared.noBlocks.regtest}</p> : null}
              </div>
            )
          ) : (
            <List divided relaxed>
              {this.state.blocks.map((block, listIndex) => {
                const txCount = block.txCount != null
                  ? Number(block.txCount)
                  : (block.tx_count != null ? Number(block.tx_count) : null);
                const rewardSats = block.rewardSats != null ? Number(block.rewardSats) : null;
                const totalOutSats = block.totalOutSats != null ? Number(block.totalOutSats) : null;
                const txPart = Number.isFinite(txCount)
                  ? c.explorerSection.txCount(txCount)
                  : null;
                const rewardPart = Number.isFinite(rewardSats) && rewardSats >= 0
                  ? c.explorerSection.reward(t.common.sats(rewardSats))
                  : null;
                const volumePart = Number.isFinite(totalOutSats) && totalOutSats >= 0
                  ? c.explorerSection.volume(t.common.sats(totalOutSats))
                  : null;
                const metaBits = [txPart, rewardPart, volumePart].filter(Boolean);
                const meta = metaBits.length ? ` · ${metaBits.join(' · ')}` : '';
                return (
                  <List.Item key={block.hash || block.id || listIndex}>
                    <List.Content>
                      <List.Header>
                        {block.hash || block.id ? (
                          hubUi.bitcoinExplorer ? (
                            <Link to={`/services/bitcoin/blocks/${encodeURIComponent(block.hash || block.id)}`}>
                              {shared.blockLine(block.height != null ? block.height : shared.notAvailable, this.trimHash(block.hash || block.id || ''))}
                            </Link>
                          ) : (
                            <span>{shared.blockLine(block.height != null ? block.height : shared.notAvailable, this.trimHash(block.hash || block.id || ''))}</span>
                          )
                        ) : (
                          <span>{shared.blockLine(block.height != null ? block.height : shared.notAvailable, shared.hashUnavailable)}</span>
                        )}
                      </List.Header>
                      <List.Description>
                        {block.time ? new Date(Number(block.time) * 1000).toLocaleString() : shared.timeUnavailable}
                        {meta}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                );
              })}
            </List>
          )}

          <Header as='h4' style={{ marginTop: '1em' }}>{c.explorerSection.mempool(this.state.transactions.length)}</Header>
          {this.state.transactions.length === 0 ? (
            explorerDataPending ? (
              <p style={{ color: '#666' }}>
                <Loader inline active size="small" /> {c.explorerSection.loadingMempool}
              </p>
            ) : (
              <p style={{ color: '#666' }}>{shared.noMempool}</p>
            )
          ) : (
            <List divided relaxed>
              {this.state.transactions.map((tx, listIndex) => {
                const tid = tx.txid || tx.id || '';
                const unconfirmed = tx.confirmations != null ? Number(tx.confirmations) === 0 : true;
                return (
                  <List.Item key={tid || listIndex}>
                    <List.Content>
                      <List.Header>
                        {tid ? (
                          hubUi.bitcoinExplorer ? (
                            <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(tid))}`}>
                              {this.trimHash(tid)}
                            </Link>
                          ) : (
                            <span>{this.trimHash(tid)}</span>
                          )
                        ) : (
                          this.trimHash(tid)
                        )}
                        {unconfirmed && (
                          <span style={{ marginLeft: '0.5em', fontSize: '0.85em', color: '#f2711c' }}>{shared.unconfirmed}</span>
                        )}
                      </List.Header>
                      <List.Description>
                        {tx.amountSats != null ? t.common.sats(tx.amountSats) : (tx.value != null && Number.isFinite(Number(tx.value)) ? t.common.sats(Math.round(Number(tx.value) * SATS_PER_BTC)) : shared.amountUnavailable)}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                );
              })}
            </List>
          )}
        </Segment>
        ) : null}

        <Segment>
          <Button basic size='small' onClick={() => this.setState({ advancedOpen: !this.state.advancedOpen })}>
            <Icon name='cogs' />
            {this.state.advancedOpen ? c.utxos.hide : c.utxos.show}
          </Button>
          {this.state.advancedOpen && (
            <div style={{ marginTop: '0.75em' }}>
              <Header as='h4'>{c.utxos.title}</Header>
              <p style={{ color: '#666', marginBottom: '0.5em' }}>{c.utxos.intro}</p>
              {this.state.utxos.length === 0 ? (
                <p style={{ color: '#666' }}>{c.utxos.empty}</p>
              ) : (
                <Table compact='very' celled>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>{c.utxos.txid}</Table.HeaderCell>
                      <Table.HeaderCell>{c.utxos.vout}</Table.HeaderCell>
                      <Table.HeaderCell>{c.utxos.amount}</Table.HeaderCell>
                      <Table.HeaderCell>{c.utxos.confirmations}</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {this.state.utxos.map((utxo, listIndex) => (
                      <Table.Row key={`${utxo.txid || listIndex}:${utxo.vout || 0}`}>
                        <Table.Cell><code>{this.trimHash(utxo.txid || utxo.id || '')}</code></Table.Cell>
                        <Table.Cell>{utxo.vout != null ? utxo.vout : t.common.none}</Table.Cell>
                        <Table.Cell>{utxo.amountSats != null ? t.common.sats(utxo.amountSats) : (utxo.amount != null && Number.isFinite(Number(utxo.amount)) ? t.common.sats(Math.round(Number(utxo.amount) * SATS_PER_BTC)) : t.common.none)}</Table.Cell>
                        <Table.Cell>{utxo.confirmations != null ? utxo.confirmations : t.common.none}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              )}
            </div>
          )}
        </Segment>

        <Modal open={this.state.settingsOpen} onClose={() => this.setState({ settingsOpen: false })} size='small'>
          <Modal.Header>{c.upstream.title}</Modal.Header>
          <Modal.Content>
            <Form>
              <Form.Field>
                <label htmlFor='bitcoin-upstream-explorer'>{c.upstream.explorer}</label>
                <Input
                  id='bitcoin-upstream-explorer'
                  placeholder='https://explorer.fabric.pub'
                  value={this.state.upstreamDraft.explorerBaseUrl}
                  onChange={(e) => this.setState({ upstreamDraft: { ...this.state.upstreamDraft, explorerBaseUrl: e.target.value } })}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor='bitcoin-upstream-payments'>{c.upstream.payments}</label>
                <Input
                  id='bitcoin-upstream-payments'
                  placeholder='https://payments.fabric.pub'
                  value={this.state.upstreamDraft.paymentsBaseUrl}
                  onChange={(e) => this.setState({ upstreamDraft: { ...this.state.upstreamDraft, paymentsBaseUrl: e.target.value } })}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor='bitcoin-upstream-lightning'>{c.upstream.lightning}</label>
                <Input
                  id='bitcoin-upstream-lightning'
                  placeholder='https://lightning.fabric.pub'
                  value={this.state.upstreamDraft.lightningBaseUrl}
                  onChange={(e) => this.setState({ upstreamDraft: { ...this.state.upstreamDraft, lightningBaseUrl: e.target.value } })}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor='bitcoin-upstream-payjoin'>{c.upstream.payjoin}</label>
                <Input
                  id='bitcoin-upstream-payjoin'
                  placeholder='https://hub.fabric.pub/services/payjoin'
                  value={this.state.upstreamDraft.payjoinBaseUrl || ''}
                  onChange={(e) => this.setState({ upstreamDraft: { ...this.state.upstreamDraft, payjoinBaseUrl: e.target.value } })}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor='bitcoin-upstream-token'>{c.upstream.token}</label>
                <Input
                  id='bitcoin-upstream-token'
                  type='password'
                  placeholder={c.upstream.tokenPlaceholder}
                  value={this.state.upstreamDraft.apiToken}
                  onChange={(e) => this.setState({ upstreamDraft: { ...this.state.upstreamDraft, apiToken: e.target.value } })}
                />
              </Form.Field>
            </Form>
          </Modal.Content>
          <Modal.Actions>
            <Button onClick={() => this.setState({ settingsOpen: false })}>{t.common.actions.cancel}</Button>
            <Button
              primary
              onClick={() => {
                const saved = saveUpstreamSettings(this.state.upstreamDraft);
                this.setState({ upstream: saved, settingsOpen: false }, () => this.refresh());
              }}
            >
              {t.common.actions.save}
            </Button>
          </Modal.Actions>
        </Modal>
      </div>
    );
  }
}

module.exports = BitcoinHome;
