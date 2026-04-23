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
const { formatSatsDisplay, formatBtcFromSats } = require('../functions/formatSats');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { copyToClipboard, pushUiNotification } = require('../functions/uiNotifications');
const { loadHubUiFeatureFlags, subscribeHubUiFeatureFlags } = require('../functions/hubUiFeatureFlags');
const { SATS_PER_BTC } = require('../constants');
const HubRegtestAdminTokenPanel = require('./HubRegtestAdminTokenPanel');
const BitcoinWalletBranchBar = require('./BitcoinWalletBranchBar');

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
      hubUiFlagsRev: 0
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
    const prevId = prevProps && prevProps.identity && prevProps.identity.xpub;
    const nextId = this.props && this.props.identity && this.props.identity.xpub;
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
    if (!Number.isFinite(n)) return '—';
    if (n >= 1e12) return n.toExponential(4);
    return n.toLocaleString();
  }

  formatBytes (n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return '—';
    if (v < 1024) return `${Math.round(v)} B`;
    if (v < 1048576) return `${(v / 1024).toFixed(1)} KiB`;
    return `${(v / 1048576).toFixed(2)} MiB`;
  }

  async handleBroadcastRawTx () {
    const token = this.props.adminToken;
    if (!token) {
      this.setState({ rawTxResult: { error: 'Admin token required. Complete node setup or refresh your session.' } });
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
      this.setState({ txLookupError: 'Enter a 64-character transaction id (hex).' });
      return;
    }
    const f = loadHubUiFeatureFlags();
    if (!f.bitcoinExplorer) {
      this.setState({
        txLookupError: 'Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility to open the transaction view.'
      });
      return;
    }
    this.setState({ txLookupError: null });
    const nav = this.props.navigate;
    if (typeof nav === 'function') nav(`/services/bitcoin/transactions/${encodeURIComponent(id)}`);
    else if (typeof window !== 'undefined') window.location.assign(`/services/bitcoin/transactions/${encodeURIComponent(id)}`);
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

    this.setState({ loading: !spendWallet.walletId, refreshing: true, error: null });

    const network = (this.state.bitcoinStatus && this.state.bitcoinStatus.network) ? String(this.state.bitcoinStatus.network).toLowerCase() : '';
    const summaryTask = fetchWalletSummaryWithCache(upstream, spendWallet, { network }).catch(() => ({}));
    const explorerTask = fetchExplorerData(upstream).catch(() => ({ blocks: [], transactions: [] }));
    const bitcoinStatusTask = fetchBitcoinStatus(upstream).catch(() => ({ available: false, status: 'UNAVAILABLE' }));
    const lightningStatusTask = fetchLightningStatus(upstream).catch(() => ({ available: false, status: 'UNAVAILABLE' }));
    const lightningChannelsTask = fetchLightningChannels(upstream).catch(() => ({ channels: [], outputs: [] }));
    const utxoTask = fetchUTXOs(upstream, spendWallet).catch(() => []);
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
      this.setState({ paymentResult: { error: 'Unable to derive next receive address from xpub.' } });
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
      this.setState({ paymentResult: { error: 'Recipient is required.' } });
      return;
    }
    if (!Number.isFinite(paymentAmountSats) || paymentAmountSats <= 0) {
      this.setState({ paymentResult: { error: 'Amount (sats) must be greater than zero.' } });
      return;
    }

    const adminToken = this._hubAdminToken();
    if (!adminToken) {
      this.setState({
        paymentResult: {
          error: 'Admin token required. Hub wallet spends use the setup token (same as Generate Block / broadcast).'
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
      this.setState({ lookupResult: { error: 'Address is required.' } });
      return;
    }
    this.setState({ lookupLoading: true, lookupResult: null });
    try {
      const result = await fetchAddressBalance(this.state.upstream, address);
      this.setState({ lookupResult: result || { error: 'No balance data returned.' }, lookupLoading: false });
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
      this.setState({ faucetResult: { error: 'Address is required.' } });
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
      this.setState({ lightningResult: { error: 'Invoice amount (sats) must be greater than zero.' } });
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
      this.setState({ lightningResult: { error: 'Paste a Lightning invoice to decode.' } });
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
      this.setState({ lightningResult: { error: 'Paste a Lightning invoice to pay.' } });
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
      this.setState({ channelCreateResult: { error: 'Remote (id@ip:port) is required.' } });
      return;
    }
    if (!remote.includes('@')) {
      this.setState({ channelCreateResult: { error: 'Remote must be id@ip:port (e.g. 03abc...@192.168.50.5:9735).' } });
      return;
    }
    if (!Number.isFinite(amountSats) || amountSats < 10000) {
      this.setState({ channelCreateResult: { error: 'Amount must be at least 10000 sats.' } });
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
          ? `${Number.isFinite(n) && n > 1 ? `${n} blocks · ` : ''}Tip ${tip.slice(0, 14)}…`
          : 'Chain tip updated — check Bitcoin dashboard';
        pushUiNotification({
          id: `regtest-block-${Date.now()}`,
          kind: 'bitcoin_block',
          title: 'New block (regtest)',
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
      this.setState({ payjoinResult: { error: 'Enable Payjoin first to create an optional payjoin deposit request.' } });
      return;
    }

    try {
      const receiveWallet = getNextReceiveWalletContext(this.getIdentity());
      const pjPref = loadPayjoinPreferences();
      const useJm = pjPref.receiveTaprootJoinmarket !== false;
      const session = await createPayjoinDeposit(this.state.upstream, receiveWallet, {
        ...(useJm
          ? { receiveTemplate: 'joinmarket_taproot_v1' }
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
          ? `${session.amountSats} sats`
          : 'amount optional';
        if (sid) {
          pushUiNotification({
            id: `payjoin-session-${sid}`,
            kind: 'payjoin',
            title: 'Payjoin deposit session ready',
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
    if (n === 'regtest') return 'bcrt1... or m/44\'/0\'/0\'/0/0';
    if (n === 'testnet' || n === 'signet') return 'tb1... or 2N...';
    if (n === 'mainnet' || n === 'main') return 'bc1... or 3...';
    return 'address for current network';
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
                <Header.Content>Bitcoin</Header.Content>
              </Header>
              <div id="fabric-bitcoin-regtest-toolbar" aria-label="Regtest: refresh, generate block, shortcuts" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center' }}>
                <Button basic icon onClick={() => this.setState({ settingsOpen: true, upstreamDraft: { ...this.state.upstream } })} title="Configure upstream APIs" aria-label="Configure upstream APIs">
                  <Icon name="cog" aria-hidden="true" />
                </Button>
                <Button primary loading={this.state.refreshing} onClick={() => this.refresh()}>
                  <Icon name="refresh" aria-hidden="true" />
                  Refresh
                </Button>
                {canShowGenerateBlock && (
                  <Button
                    basic
                    onClick={() => this.handleGenerateBlock()}
                    title="Mine one block: coinbase pays this node’s Hub bitcoind wallet only — not your browser wallet chip. Use Faucet to send from the Hub to your receive address, then mine again to confirm."
                  >
                    <Icon name="cube" aria-hidden="true" />
                    Generate Block
                  </Button>
                )}
                {canGenerateBlocks ? (
                  <Button
                    as={Link}
                    to="/services/bitcoin/faucet"
                    basic
                    title="Request regtest coins from the Hub wallet to your Fabric receive address (updates the top-bar balance after a confirm block)"
                  >
                    <Icon name="tint" aria-hidden="true" />
                    Faucet
                  </Button>
                ) : null}
                {hubUi.bitcoinPayments ? (
                  <Button as={Link} to="/payments" basic title="Open wallet payments manager">
                    <Icon name="credit card outline" aria-hidden="true" />
                    Payments
                  </Button>
                ) : null}
                {hubUi.bitcoinInvoices ? (
                  <Button as={Link} to="/services/bitcoin/invoices#fabric-invoices-tab-demo" basic title="Create and manage invoices">
                    <Icon name="file alternate outline" aria-hidden="true" />
                    Invoices
                  </Button>
                ) : null}
                {hubUi.bitcoinResources ? (
                  <Button as={Link} to="/services/bitcoin/resources" basic title="Browse Bitcoin HTTP resources (GET) and L1 verify">
                    <Icon name="sitemap" aria-hidden="true" />
                    Resources
                  </Button>
                ) : null}
                {hubUi.bitcoinCrowdfund ? (
                  <Button as={Link} to="/services/bitcoin/crowdfunds" basic title="Taproot crowdfund vault, ACP donation PSBT, Payjoin to campaign address">
                    <Icon name="heart outline" aria-hidden="true" />
                    Crowdfunds
                  </Button>
                ) : null}
                {hubUi.bitcoinLightning ? (
                  <Button as={Link} to="/services/lightning" basic title="Dedicated Lightning page">
                    <Icon name="bolt" aria-hidden="true" />
                    Lightning
                  </Button>
                ) : null}
                {hubUi.bitcoinExplorer ? (
                  <Button as={Link} to="/services/bitcoin/blocks" basic title="Dedicated Explorer page">
                    <Icon name="search" aria-hidden="true" />
                    Explorer
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          <p
            id="bitcoin-home-summary"
            style={{ marginTop: '0.5em', color: '#666', marginBottom: '0.5em', maxWidth: '42rem', lineHeight: 1.45 }}
          >
            <strong>Your browser wallet</strong> (Fabric identity) powers invoices, client-signed sends, and the balance chip — see{' '}
            <Link to="/settings/bitcoin-wallet">Bitcoin wallet &amp; derivation</Link>.
            <strong> Hub wallet</strong> is this node&apos;s <code>bitcoind</code>{' '}
            ({isRegtest ? 'mining on regtest, ' : ''}admin spends, Payjoin); it is not your identity&apos;s key.
            {isRegtest ? (
              <>
                {' '}
                <strong>Regtest:</strong> <strong>Generate Block</strong> only increases the Hub wallet; it does not credit your browser balance.
                Use the <Link to="/services/bitcoin/faucet">Faucet</Link> (or a paid invoice / Payjoin / peer payment) to move value to your receive address, then mine a block so it confirms.
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
            <span id="bitcoin-home-wealth-heading" style={{ fontWeight: 600, color: '#3d3a33', fontSize: '0.95em' }}>Wealth stack</span>
            <span style={{ color: '#5c574c', fontSize: '0.85em', maxWidth: '36rem', lineHeight: 1.4 }}>
              Fabric contracts &amp; docs · Payjoin deposit coordination · Lightning channels
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
              <Button as={Link} to="/documents" size="small" basic icon labelPosition="left">
                <Icon name="file alternate outline" /> Documents
              </Button>
              {hubUi.peers ? (
                <Button as={Link} to="/peers" size="small" basic icon labelPosition="left">
                  <Icon name="users" /> Peers
                </Button>
              ) : null}
            </div>
          </div>
          </section>
        </Segment>

        <Segment style={{ marginTop: '-1px', borderColor: '#d9e2f3', background: '#f8fbff' }}>
          <section aria-labelledby="operator-managed-deposits-heading">
            <Header as="h3" id="operator-managed-deposits-heading" style={{ marginBottom: '0.35em' }}>
              Deposits Under Management
            </Header>
            <p style={{ color: '#4b5b73', marginBottom: '0.75em', maxWidth: '54rem', lineHeight: 1.45 }}>
              Custody boundary: non-admin user keys stay in the browser wallet; the Hub manages shared-session flows (Lightning node channels and Payjoin receiver sessions) and may sign contract messages for coordinated settlement.
            </p>
            <Table compact celled unstackable size="small" style={{ marginBottom: '0.5em' }}>
              <Table.Body>
                <Table.Row>
                  <Table.Cell width={5}><strong>Client wallet (self-custody)</strong></Table.Cell>
                  <Table.Cell>{formatSatsDisplay(clientWalletSats)} sats</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>Private keys remain with user clients.</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell><strong>Hub wallet (operator)</strong></Table.Cell>
                  <Table.Cell>{formatSatsDisplay(hubWalletSats)} sats</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>Node operations ({isRegtest ? 'regtest mining/' : ''}admin spends/settlement staging).</Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell><strong>Shared sessions (managed)</strong></Table.Cell>
                  <Table.Cell>{formatSatsDisplay(sharedSessionsSats)} sats</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>
                    Lightning listfunds total across confirmed/unconfirmed/immature outputs.
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell><strong>Payjoin sessions</strong></Table.Cell>
                  <Table.Cell>{Number(payjoinSnapshot.activeNotExpired || 0)} active</Table.Cell>
                  <Table.Cell style={{ color: '#666' }}>
                    {Number(payjoinSnapshot.awaitingCompletion || 0)} awaiting completion.
                  </Table.Cell>
                </Table.Row>
              </Table.Body>
            </Table>
            <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button as={Link} to="/services/lightning" size="small" basic icon labelPosition="left">
                <Icon name="bolt" /> Manage Lightning channels
              </Button>
              <Button as={Link} to="/payments#wealth-payjoin-board" size="small" basic icon labelPosition="left">
                <Icon name="shield alternate" /> Manage Payjoin sessions
              </Button>
              <Button as={Link} to="/settings/bitcoin-wallet" size="small" basic icon labelPosition="left">
                <Icon name="key" /> Client wallet boundary
              </Button>
            </div>
          </section>
        </Segment>

        {!hasUpstream && (
          <Message warning>
            <Message.Header>Upstream APIs not configured</Message.Header>
            <p>Open the settings cog and add your explorer/payments/lightning endpoints to enable live data and transactions.</p>
          </Message>
        )}

        {hasUpstream && !this.state.loading && !this.state.refreshing && !bitcoinReady && (
          <Message info>
            <Message.Header>Hub Bitcoin backend unavailable</Message.Header>
            <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', lineHeight: 1.45 }}>
              Explorer lists and the Hub wallet balance stay empty until this Hub can reach <code>bitcoind</code>
              {isRegtest ? ' (or enable managed regtest).' : '.'}{' '}
              Your <strong>identity wallet</strong> may still show receive addresses when the Payments API is up. Check server logs and{' '}
              <Link to="/settings/admin">Admin</Link>.
            </p>
          </Message>
        )}

        {hasUpstream && bitcoinReady && (
          <Message size="small" style={{ marginBottom: '0.75em' }}>
            <Message.Header>Operator deposits checklist</Message.Header>
            <List bulleted style={{ margin: '0.35em 0 0', fontSize: '0.88em', color: '#555' }}>
              <List.Item>
                Save the <strong>admin token</strong> (first-time setup / Settings → Admin) for{' '}
                {isRegtest ? 'regtest block tools and ' : ''}hub-wallet sends{isRegtest ? '' : ' and other admin RPC actions'}.
              </List.Item>
              <List.Item>
                <strong>Payjoin:</strong> ensure <code>GET /services/payjoin</code> reports available (mirror: <code>/payments/payjoin</code>); create sessions below when <strong>Bitcoin → Payments</strong> is enabled in feature flags. Capabilities include <code>fabricProtocol</code> (BIP78 receiver today; BIP77 async roadmap).
              </List.Item>
              <List.Item>
                <strong>Lightning:</strong> Service Health should show L2 when Core Lightning is configured (or stub in dev).
              </List.Item>
            </List>
          </Message>
        )}

        {this.state.error && (
          <Message negative>
            <Message.Header>Bitcoin data refresh failed</Message.Header>
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
              Retry
            </Button>
          </Message>
        )}

        <Segment loading={this.state.loading}>
          <Header as='h3'>Service Health</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge (Hub node):</strong> status, Hub wallet balance, Beacon, Lightning.</p>
          <p style={{ fontSize: '0.88em', color: '#666', margin: '0 0 0.65em', lineHeight: 1.45 }}>
            <strong>Beacon / federation provability:</strong>{' '}
            <Link to="/settings/admin/beacon-federation">Beacon Federation</Link>
            {' · '}
            <a href="/services/distributed/epoch" target="_blank" rel="noopener noreferrer">GET epoch</a>
            {' · '}
            <a href="/services/distributed/manifest" target="_blank" rel="noopener noreferrer">GET manifest</a>
          </p>
          <div><strong>Bitcoin (RPC):</strong>{' '}
            {this.state.loading || this.state.refreshing
              ? 'Checking…'
              : bitcoinReady
                ? `${this.state.bitcoinStatus && this.state.bitcoinStatus.status ? this.state.bitcoinStatus.status : 'available'}${bitcoinNetwork ? ` (${bitcoinNetwork})` : ''}`
                : `unavailable${(this.state.bitcoinStatus && this.state.bitcoinStatus.status) ? ` — ${this.state.bitcoinStatus.status}` : ''}`}
          </div>
          <div style={{ color: '#666', marginBottom: '0.5em', lineHeight: 1.45 }}>
            {bitcoinReady && this.state.bitcoinStatus && this.state.bitcoinStatus.message
              ? this.state.bitcoinStatus.message
              : null}
            {!bitcoinReady && !this.state.loading && !this.state.refreshing ? (
              <span>
                The hub is not serving live chain data until <code>bitcoind</code> is reachable (or managed regtest is enabled). Balances below may be stale or zero.
              </span>
            ) : null}
          </div>
          {bitcoinReady && this.state.bitcoinStatus && this.state.bitcoinStatus.balance != null && (
            <div>
              <strong>Hub wallet balance:</strong> {Number(this.state.bitcoinStatus.balance || 0).toFixed(8)} BTC{' '}
              {isRegtest ? '(regtest block rewards go here)' : '(on-chain wallet balance)'}
            </div>
          )}
          {bitcoinReady && this.state.bitcoinStatus && this.state.bitcoinStatus.beacon && (
            <div><strong>Beacon core balance:</strong> {this.satsToBTC(this.state.bitcoinStatus.beacon.balanceSats || 0)} BTC (epoch {this.state.bitcoinStatus.beacon.clock || 0})</div>
          )}
          <div><strong>Lightning:</strong> {this.state.lightningStatus && this.state.lightningStatus.status === 'NOT_CONFIGURED'
            ? (isRegtest ? 'runs with regtest' : 'not configured')
            : (this.state.lightningStatus && this.state.lightningStatus.status === 'STUB')
              ? 'stub (UI testing)'
              : (this.state.lightningStatus && this.state.lightningStatus.status ? this.state.lightningStatus.status : 'unknown')}</div>
          <div style={{ color: '#666' }}>{this.state.lightningStatus && this.state.lightningStatus.message ? this.state.lightningStatus.message : ''}</div>
        </Segment>

        <Segment loading={this.state.loading}>
          <Header as='h3'>Node console</Header>
          <p style={{ color: '#666', marginBottom: '0.75em' }}>
            Data comes from this Hub&apos;s Bitcoin Core RPC.
          </p>

          <Header as='h4'>Dashboard</Header>
          <Table compact celled unstackable size='small' style={{ marginBottom: '1em' }}>
            <Table.Body>
              <Table.Row>
                <Table.Cell><strong>Chain height</strong></Table.Cell>
                <Table.Cell>{bc && bc.blocks != null ? bc.blocks : (this.state.bitcoinStatus.height != null ? this.state.bitcoinStatus.height : '—')}</Table.Cell>
                <Table.Cell><strong>Headers</strong></Table.Cell>
                <Table.Cell>{bc && bc.headers != null ? bc.headers : '—'}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell><strong>Verification</strong></Table.Cell>
                <Table.Cell>
                  {bc && bc.verificationprogress != null
                    ? `${(Number(bc.verificationprogress) * 100).toFixed(2)}%`
                    : '—'}
                  {bc && bc.initialblockdownload ? ' (IBD)' : ''}
                </Table.Cell>
                <Table.Cell><strong>Difficulty</strong></Table.Cell>
                <Table.Cell>{bc ? this.formatDifficulty(bc.difficulty) : '—'}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell><strong>Chain</strong></Table.Cell>
                <Table.Cell>{bc && bc.chain ? String(bc.chain) : '—'}</Table.Cell>
                <Table.Cell><strong>Median time</strong></Table.Cell>
                <Table.Cell>
                  {bc && bc.mediantime
                    ? new Date(Number(bc.mediantime) * 1000).toLocaleString()
                    : '—'}
                </Table.Cell>
              </Table.Row>
              {(this.state.bitcoinStatus.bitcoinPruned || (bc && bc.pruned)) ? (
                <Table.Row>
                  <Table.Cell><strong>Prune</strong></Table.Cell>
                  <Table.Cell colSpan={3} style={{ fontSize: '0.92em', lineHeight: 1.45 }}>
                    Pruned <code>bitcoind</code> — block files below height{' '}
                    <strong>
                      {this.state.bitcoinStatus.bitcoinPruneHeight != null
                        ? this.state.bitcoinStatus.bitcoinPruneHeight
                        : (bc && bc.pruneheight != null ? bc.pruneheight : '—')}
                    </strong>{' '}
                    are not available over RPC. This hub removes matching Bitcoin block/tx documents from its <em>local</em> published catalog only; Fabric <code>BitcoinBlock</code> / Beacon epochs still track the chain tip, and peers can offer older blocks via inventory.
                  </Table.Cell>
                </Table.Row>
              ) : null}
            </Table.Body>
          </Table>

          <Header as='h4'>Mempool</Header>
          <Table compact celled unstackable size='small' style={{ marginBottom: '1em' }}>
            <Table.Body>
              <Table.Row>
                <Table.Cell><strong>Transactions</strong></Table.Cell>
                <Table.Cell>
                  {this.state.bitcoinStatus.mempoolTxCount != null
                    ? this.state.bitcoinStatus.mempoolTxCount
                    : (mp && mp.size != null ? mp.size : '—')}
                </Table.Cell>
                <Table.Cell><strong>Memory usage</strong></Table.Cell>
                <Table.Cell>{mp && mp.usage != null ? this.formatBytes(mp.usage) : '—'}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell><strong>Total vsize (mempool)</strong></Table.Cell>
                <Table.Cell>{mp && mp.bytes != null ? this.formatBytes(mp.bytes) : '—'}</Table.Cell>
                <Table.Cell><strong>Total fees (est.)</strong></Table.Cell>
                <Table.Cell>
                  {this.state.bitcoinStatus.mempoolFeeSats != null
                    ? (
                      <>
                        {this.satsToBTC(this.state.bitcoinStatus.mempoolFeeSats)} BTC
                        {' '}
                        <span style={{ color: '#888' }}>({formatSatsDisplay(this.state.bitcoinStatus.mempoolFeeSats)} sats)</span>
                      </>
                      )
                    : '—'}
                  {this.state.bitcoinStatus.mempoolFeesTruncated
                    ? <span style={{ color: '#b60' }}> (partial sum)</span>
                    : null}
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell><strong>Min relay fee</strong></Table.Cell>
                <Table.Cell>{mp && mp.minrelaytxfee != null ? `${mp.minrelaytxfee} BTC/kvB` : '—'}</Table.Cell>
                <Table.Cell><strong>Mempool min fee</strong></Table.Cell>
                <Table.Cell>{mp && mp.mempoolminfee != null ? `${mp.mempoolminfee} BTC/kvB` : '—'}</Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table>

          <Header as='h4'>Network</Header>
          <Table compact celled unstackable size='small' style={{ marginBottom: '1em' }}>
            <Table.Body>
              <Table.Row>
                <Table.Cell><strong>Connections</strong></Table.Cell>
                <Table.Cell>
                  {ni
                    ? `${ni.connections != null ? ni.connections : '—'} total (${ni.connections_in != null ? ni.connections_in : 0} in / ${ni.connections_out != null ? ni.connections_out : 0} out)`
                    : '—'}
                </Table.Cell>
                <Table.Cell><strong>Relay fee</strong></Table.Cell>
                <Table.Cell>{ni && ni.relayfee != null ? `${ni.relayfee} BTC/kvB` : '—'}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell><strong>User agent</strong></Table.Cell>
                <Table.Cell colSpan='3'>{ni && ni.subversion ? String(ni.subversion) : '—'}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell><strong>Protocol / version</strong></Table.Cell>
                <Table.Cell colSpan='3'>
                  {ni
                    ? `protocol ${ni.protocolversion != null ? ni.protocolversion : '—'} · version ${ni.version != null ? ni.version : '—'}`
                    : '—'}
                </Table.Cell>
              </Table.Row>
              {Array.isArray(this.state.bitcoinStatus.p2pAddNodeTargets) && this.state.bitcoinStatus.p2pAddNodeTargets.length > 0 && (
                <Table.Row>
                  <Table.Cell><strong>Playnet P2P</strong></Table.Cell>
                  <Table.Cell colSpan='3'>
                    <span style={{ color: '#555' }}>Bitcoin Core </span>
                    <code>addnode</code>
                    <span style={{ color: '#555' }}> targets (L1 sync): </span>
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

          <Header as='h4'>Consensus deployments</Header>
          {deploymentEntries.length === 0 ? (
            <p style={{ color: '#666', marginBottom: '1em' }}>No deployment data (requires <code>getdeploymentinfo</code> on your Core version).</p>
          ) : (
            <Table compact celled unstackable size='small' style={{ marginBottom: '1em' }}>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Deployment</Table.HeaderCell>
                  <Table.HeaderCell>Status</Table.HeaderCell>
                  <Table.HeaderCell>Height / bit</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {deploymentEntries.map(([name, info]) => {
                  const row = info && typeof info === 'object' ? info : {};
                  const active = row.active === true ? 'active' : (row.active === false ? 'inactive' : '—');
                  const h = row.height != null ? row.height : (row.min_activation_height != null ? row.min_activation_height : '—');
                  const bit = row.bip9 && row.bip9.bit != null ? row.bip9.bit : row.bit;
                  return (
                    <Table.Row key={name}>
                      <Table.Cell><code>{name}</code></Table.Cell>
                      <Table.Cell>{active}{row.type ? ` · ${row.type}` : ''}</Table.Cell>
                      <Table.Cell>{h}{bit != null && bit !== '' ? ` · bit ${bit}` : ''}</Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          )}

          <Header as='h4'>Peers ({nodePeers.length})</Header>
          {nodePeers.length === 0 ? (
            <div style={{ marginBottom: '1em' }}>
              <p style={{ color: '#666', margin: '0 0 0.5em' }}>
                {bitcoinReady
                  ? (
                    <>
                      {ni && Number(ni.connections) > 0
                        ? (
                          <span>
                            <code>getnetworkinfo</code> reports {Number(ni.connections)} P2P connection(s), but the peer table did not load
                            (<code>GET /services/bitcoin/peers</code> may have failed in this browser tab). Try <strong>Refresh peer list</strong> or your regular browser.
                          </span>
                          )
                        : (
                          <span>
                            No Bitcoin P2P peers in <code>getpeerinfo</code>.
                            {isRegtest
                              ? (
                                <>
                                  {' '}
                                  On managed regtest with <code>listen=0</code> this is usual until an outbound peer connects; use the <strong>Playnet P2P</strong>{' '}
                                  <code>addnode</code> targets above or <code>npm run bitcoin:addnode</code>.
                                  {' '}
                                  After you have peers, you can pull regtest coins from another operator&apos;s hub wallet — e.g. open{' '}
                                  <a href="https://hub.fabric.pub/services/bitcoin/faucet" target="_blank" rel="noopener noreferrer">hub.fabric.pub/services/bitcoin/faucet</a>
                                  {' '}and paste your receive address, then <strong>Generate block</strong> here to confirm.
                                </>
                                )
                              : ' Check connectivity, firewall, and addnode/connect settings on this Core node.'}
                          </span>
                          )}
                    </>
                    )
                  : (
                    <>
                      Could not load peers (Bitcoin RPC offline or <code>GET /services/bitcoin/peers</code> failed). Fix Bitcoin status first.
                    </>
                    )}
              </p>
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
                {bitcoinReady ? 'Refresh peer list' : 'Retry'}
              </Button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', marginBottom: '1em' }}>
              <Table compact celled unstackable size='small'>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Address</Table.HeaderCell>
                    <Table.HeaderCell>Direction</Table.HeaderCell>
                    <Table.HeaderCell>Ping (ms)</Table.HeaderCell>
                    <Table.HeaderCell>Bytes in / out</Table.HeaderCell>
                    <Table.HeaderCell>User agent</Table.HeaderCell>
                    <Table.HeaderCell>Height</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {nodePeers.slice(0, 40).map((p, i) => (
                    <Table.Row key={`${p.id != null ? p.id : i}-${p.addr || i}`}>
                      <Table.Cell><code style={{ fontSize: '0.85em' }}>{p.addr || p.addrbind || '—'}</code></Table.Cell>
                      <Table.Cell>{p.inbound ? 'inbound' : 'outbound'}</Table.Cell>
                      <Table.Cell>{p.pingtime != null ? Number(p.pingtime).toFixed(0) : '—'}</Table.Cell>
                      <Table.Cell>
                        {p.bytesrecv != null || p.bytessent != null
                          ? `${p.bytesrecv != null ? this.formatBytes(p.bytesrecv) : '—'} / ${p.bytessent != null ? this.formatBytes(p.bytessent) : '—'}`
                          : '—'}
                      </Table.Cell>
                      <Table.Cell style={{ maxWidth: '14em', wordBreak: 'break-word', fontSize: '0.85em' }}>
                        {p.subver || '—'}
                      </Table.Cell>
                      <Table.Cell>
                        {p.synced_headers != null
                          ? p.synced_headers
                          : (p.synced_blocks != null ? p.synced_blocks : (p.startingheight != null ? p.startingheight : '—'))}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
          )}

          <Header as='h4'>Search &amp; tools</Header>
          <Form style={{ marginBottom: '0.75em' }}>
            <Form.Group widths='equal'>
              <Form.Field>
                <label>Open transaction by txid</label>
                <Input
                  placeholder='64-char hex txid'
                  value={this.state.txLookupId}
                  onChange={(e) => this.setState({ txLookupId: e.target.value, txLookupError: null })}
                />
              </Form.Field>
              <Form.Field style={{ alignSelf: 'flex-end' }}>
                <Button
                  type='button'
                  primary
                  disabled={!bitcoinReady || !hubUi.bitcoinExplorer}
                  title={!hubUi.bitcoinExplorer ? 'Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility' : undefined}
                  onClick={() => this.handleTxLookup()}
                >
                  <Icon name='search' />
                  Open
                </Button>
              </Form.Field>
            </Form.Group>
            {this.state.txLookupError && (
              <Message negative size='small'>{this.state.txLookupError}</Message>
            )}
          </Form>

          <p style={{ color: '#666', marginBottom: '0.35em' }}>
            <strong>Broadcast raw transaction</strong> — <code>sendrawtransaction</code>. Requires admin token (same as Generate Block).
          </p>
          <Form>
            <Form.TextArea
              rows={4}
              placeholder='Paste hex (no spaces required)'
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
              Broadcast
            </Button>
          </Form>
          {this.state.rawTxResult && (
            <Message
              style={{ marginTop: '0.75em' }}
              negative={!!this.state.rawTxResult.error}
              positive={!this.state.rawTxResult.error}
            >
              <Message.Header>{this.state.rawTxResult.error ? 'Broadcast failed' : 'Broadcast accepted'}</Message.Header>
              {this.state.rawTxResult.error ? (
                <p>{this.state.rawTxResult.error}</p>
              ) : (
                <p>
                  txid{' '}
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
                    : '—'}
                </p>
              )}
            </Message>
          )}
        </Segment>

        <Segment loading={this.state.loading}>
          <Header as='h3'>Wallet</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>
            <strong>Client:</strong> identity fingerprint, xpub, receive index, and client balance (matches the top-bar chip). <strong>Bridge:</strong> Hub node wallet —{' '}
            {isRegtest ? 'regtest block rewards, ' : 'on-chain balance, '}optional admin spends, Payjoin receiver. <strong>Documents:</strong> publishing is free; paid <Link to="/documents">distribute</Link> uses L1 invoices tied to your identity.
            {(hubUi.bitcoinPayments || hubUi.bitcoinLightning) ? (
              <span>
                {' '}This Hub runs{' '}
                {hubUi.bitcoinPayments ? (
                  <><strong>one Payjoin receiver</strong> (BIP78-shaped HTTP POST; <code>pj=</code> in BIP21; <code>asyncPayjoinRoadmap: BIP77</code> in JSON capabilities)</>
                ) : null}
                {hubUi.bitcoinPayments && hubUi.bitcoinLightning ? ' and ' : null}
                {hubUi.bitcoinLightning ? <><strong>one Lightning</strong> service path</> : null}
                {hubUi.bitcoinPayments && !hubUi.bitcoinLightning ? '.' : null}
                {hubUi.bitcoinLightning ? '.' : null}
              </span>
            ) : (
              <span>
                {' '}Turn on <strong>Bitcoin — Payments</strong> and/or <strong>Lightning</strong> in Admin → Feature visibility for Payjoin deposit tooling and L2 controls on this page.
              </span>
            )}
            {!wallet.hasPrivateKey && wallet.walletId && (
              <span style={{ display: 'block', marginTop: '0.25em', color: '#0a6' }}>
                <Icon name='eye' /> Watch-only: server never holds your keys. Balance is derived from xpub via scantxoutset.
              </span>
            )}
          </p>
          <div><strong>Master wallet:</strong> <code>{wallet.walletId || 'not available'}</code></div>
          <div><strong>Identity fingerprint:</strong> <code>{wallet.fingerprint || 'not available'}</code></div>
          <div><strong>Keys on server:</strong> {wallet.hasPrivateKey ? 'yes (signing capable)' : 'no (watch-only, keys never leave your device)'}</div>
          <div style={{ marginTop: '0.75em' }}><strong>Client wallet balance:</strong> {this.satsToBTC(wallet.balanceSats)} BTC</div>
          <div><strong>Confirmed:</strong> {this.satsToBTC(wallet.confirmedSats)} BTC</div>
          <div><strong>Unconfirmed:</strong> {this.satsToBTC(wallet.unconfirmedSats)} BTC</div>
          {wallet.balanceSats === 0 && bitcoinNetwork === 'regtest' && (
            <div style={{ marginTop: '0.5em', color: '#0a6', fontSize: '0.9em' }}>
              <Icon name='info circle' /> Just received funds? Use <strong>Generate Block</strong> to confirm — balance shows only confirmed UTXOs. If you used a custom faucet address instead of <strong>Use my receive address</strong>, funds went elsewhere and will not appear here.
            </div>
          )}
          <div style={{ marginTop: '0.5em' }}>
            <strong>Receive address:</strong>{' '}
            <code>{wallet.address || 'address unavailable'}</code>
            {wallet.address ? (
              <Button
                basic
                size='mini'
                style={{ marginLeft: '0.5em' }}
                onClick={() => this.handleNextReceiveAddress()}
                title='Derive next external payment address'
              >
                <Icon name='plus' />
                Next
              </Button>
            ) : null}
          </div>
          <div><strong>Receive derivation index:</strong> {wallet.receiveIndex}</div>
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
                  label='Use Payjoin for operator deposit sessions (on by default)'
                  disabled={!(this.state.payjoinCapabilities && this.state.payjoinCapabilities.available)}
                />
              </div>
              <div style={{ marginTop: '0.25em', color: '#666' }}>
                Payjoin endpoint status:{' '}
                <strong>{this.state.payjoinCapabilities && this.state.payjoinCapabilities.available ? 'available' : 'unavailable'}</strong>
              </div>
            </React.Fragment>
          ) : null}
        </Segment>

        <Segment>
          <Header as='h3'>Look Up Address Balance</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>
            <Icon name='search' /> Query balance for any on-chain address. <strong>Server does not hold keys</strong> — uses <code>scantxoutset</code> (UTXO scan). Works on pruned nodes; does not require <code>txindex</code>.
          </p>
          <Form>
            <Form.Field>
              <label>Address ({bitcoinNetwork || 'any'})</label>
              <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
                <Input
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
                    title='Use your current receive address'
                  >
                    Use my address
                  </Button>
                )}
                <Button
                  primary
                  loading={this.state.lookupLoading}
                  onClick={() => this.handleLookupAddress()}
                  disabled={!bitcoinReady || !(this.state.lookupAddress || '').trim()}
                >
                  <Icon name='search' />
                  Look Up
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
                {this.state.lookupResult.error ? 'Lookup failed' : 'Address balance (no keys on server)'}
              </Message.Header>
              {this.state.lookupResult.error ? (
                <p>{this.state.lookupResult.error}</p>
              ) : (
                <div>
                  <div><strong>Balance:</strong> {this.satsToBTC(this.state.lookupResult.balanceSats || 0)} BTC ({formatSatsDisplay(this.state.lookupResult.balanceSats || 0)} sats)</div>
                  {this.state.lookupResult.network && <div><strong>Network:</strong> {this.state.lookupResult.network}</div>}
                </div>
              )}
            </Message>
          )}
        </Segment>

        {hubUi.bitcoinCrowdfund ? (
          <Segment id="fabric-bitcoin-crowdfunding">
            <Message info>
              <Message.Header>Crowdfunds</Message.Header>
              <p style={{ margin: '0.35em 0 0' }}>
                Taproot campaign vaults, ACP donation PSBTs, Payjoin to vault, payout, and refund flows live on{' '}
                <Link to="/services/bitcoin/crowdfunds">Crowdfunds</Link>
                {' '}(bookmark <code>/services/bitcoin/crowdfunds</code> or <code>/crowdfunds</code>).
              </p>
            </Message>
          </Segment>
        ) : null}

        {hubUi.bitcoinPayments ? (
        <Segment id="fabric-bitcoin-payjoin">
          <Header as='h3'>Payjoin deposit</Header>
          {this.state.payjoinSessionsSnapshot ? (
            <Message
              id="fabric-bitcoin-payjoin-sessions-strip"
              size="small"
              info
              style={{ marginTop: '0.25rem', marginBottom: '1rem' }}
            >
              <Icon name="list alternate outline" />
              <strong>Hub deposit sessions</strong>
              {' '}(not expired): {this.state.payjoinSessionsSnapshot.activeNotExpired}
              {this.state.payjoinSessionsSnapshot.awaitingCompletion > 0 ? (
                <> — {this.state.payjoinSessionsSnapshot.awaitingCompletion} still in progress</>
              ) : null}
              .{' '}
              <Link to="/payments">Payments</Link>
              {' '}lists sessions and payer tools.
            </Message>
          ) : null}
          <p style={{ color: '#666' }}>
            Creates a BIP21 URI with <code>pj=</code> pointing at this Hub&apos;s single Payjoin endpoint for BIP78-compatible payjoin clients.
          </p>
          <Form>
            <Form.Group widths='equal'>
              <Form.Field>
                <label>Requested amount (sats, optional)</label>
                <Input
                  type='number'
                  min='0'
                  step='1'
                  placeholder='25000'
                  value={this.state.payjoinAmountSats}
                  onChange={(e) => this.setState({ payjoinAmountSats: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label>Label (optional)</label>
                <Input
                  placeholder='Initial hub deposit'
                  value={this.state.payjoinLabel}
                  onChange={(e) => this.setState({ payjoinLabel: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label>Memo (optional)</label>
                <Input
                  placeholder='Shown in wallet (optional)'
                  value={this.state.payjoinMemo}
                  onChange={(e) => this.setState({ payjoinMemo: e.target.value })}
                />
              </Form.Field>
            </Form.Group>
            <Button primary onClick={() => this.handleCreatePayjoinDeposit()} disabled={!this.state.payjoinEnabled}>
              <Icon name='shield alternate' />
              Create Payjoin Deposit Request
            </Button>
            <Button basic onClick={() => this.handleRefreshPayjoinSession()} disabled={!this.state.payjoinSessionId}>
              <Icon name='refresh' />
              Refresh Session
            </Button>
          </Form>
          {this.state.payjoinResult && (
            <Message
              style={{ marginTop: '1em' }}
              negative={!!this.state.payjoinResult.error}
              positive={!this.state.payjoinResult.error}
            >
              <Message.Header>{this.state.payjoinResult.error ? 'Payjoin request failed' : 'Payjoin session'}</Message.Header>
              {!this.state.payjoinResult.error && (this.state.payjoinResult.id || this.state.payjoinResult.bip21Uri) && (
                <div style={{ marginBottom: '0.75em', display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
                  <Button
                    size="small"
                    basic
                    type="button"
                    disabled={!this.state.payjoinResult.bip21Uri}
                    onClick={() => copyToClipboard(this.state.payjoinResult.bip21Uri || '')}
                    title="Copy BIP21 URI for wallet paste"
                  >
                    <Icon name="copy outline" />
                    Copy BIP21
                  </Button>
                  <Button
                    size="small"
                    basic
                    type="button"
                    disabled={!this.state.payjoinResult.id}
                    onClick={() => copyToClipboard(String(this.state.payjoinResult.id || ''))}
                    title="Copy session id"
                  >
                    <Icon name="copy outline" />
                    Copy session ID
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
                    Open Payments (submit PSBT)
                  </Button>
                </div>
              )}
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(this.state.payjoinResult, null, 2)}</pre>
            </Message>
          )}
        </Segment>
        ) : null}

        {isFaucetPage ? (
        <Segment data-faucet-segment id="fabric-bitcoin-faucet">
          <Header as='h3'>Faucet</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>
            <strong>Bridge:</strong> draws from Beacon/Hub wallet (regtest only). Max 1,000,000 sats per request.
            {bitcoinNetwork && <span> Use addresses for <strong>{bitcoinNetwork}</strong> (e.g. {addressPlaceholder}).</span>}
            {' '}Choose <strong>Use my receive address</strong> so funds go to your wallet; otherwise balance will not update.
            {' '}
            <strong>Note:</strong> mining with <strong>Generate Block</strong> tops up the Hub wallet, not your browser chip — this flow is how you transfer from Hub to identity.
          </p>
          <div style={{ marginBottom: '0.5em' }}>
            <strong>Network:</strong> {bitcoinNetwork || 'unknown'}
          </div>
          <div style={{ marginBottom: '1em' }}>
            <strong>Hub available balance:</strong>{' '}
            {Number(this.state.bitcoinStatus && this.state.bitcoinStatus.balance != null ? this.state.bitcoinStatus.balance : 0).toFixed(8)} BTC
            {this.state.bitcoinStatus && this.state.bitcoinStatus.beacon && (
              <span style={{ marginLeft: '1em', color: '#666' }}>
                (Beacon: {formatSatsDisplay(this.state.bitcoinStatus.beacon.balanceSats || 0)} sats)
              </span>
            )}
          </div>
          <Form>
            <Form.Field>
              <label>Send to address ({bitcoinNetwork || 'any'})</label>
              <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
                <Input
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
                    title='Fill with your current receive address (same network as Hub)'
                  >
                    Use my receive address
                  </Button>
                )}
              </div>
            </Form.Field>
            <Form.Field>
              <label>Amount (sats)</label>
              <Input
                type='number'
                min='1'
                max='1000000'
                step='1'
                placeholder='10000'
                value={this.state.faucetAmountSats}
                onChange={(e) => this.setState({ faucetAmountSats: e.target.value })}
              />
            </Form.Field>
            <Button
              primary
              onClick={() => this.handleRequestFaucet()}
              disabled={!canGenerateBlocks || !(this.state.faucetAddress || '').trim()}
              title={!canGenerateBlocks ? 'Bitcoin must be available (regtest) to use faucet' : !(this.state.faucetAddress || '').trim() ? `Enter a ${bitcoinNetwork || 'regtest'} address (e.g. ${addressPlaceholder})` : 'Send test coins to this address'}
            >
              <Icon name='tint' />
              Request from faucet
            </Button>
          </Form>
          {this.state.faucetResult && (
            <Message style={{ marginTop: '1em' }} positive={!this.state.faucetResult.error} negative={!!this.state.faucetResult.error}>
              <Message.Header>{this.state.faucetResult.error ? 'Faucet failed' : 'Faucet'}</Message.Header>
              {!this.state.faucetResult.error && (() => {
                const fr = this.state.faucetResult;
                const faucet = fr && fr.faucet;
                const txid = faucet && faucet.txid;
                const amountSats = faucet && faucet.amountSats;
                const dest = faucet && faucet.destination;
                if (txid || amountSats) {
                  return (
                    <p style={{ marginTop: '0.5em', marginBottom: '0.5em' }}>
                      {amountSats ? `Sent ${Number(amountSats).toLocaleString()} sats` : 'Sent'}
                      {dest ? ` to ${dest.slice(0, 12)}…${dest.slice(-8)}` : ''}.
                      {txid ? (
                        <span style={{ display: 'block', marginTop: '0.35em' }}>
                          {hubUi.bitcoinExplorer ? (
                            <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(txid))}`}>
                              View transaction
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
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '0.5em' }}>{JSON.stringify(this.state.faucetResult, null, 2)}</pre>
            </Message>
          )}
        </Segment>
        ) : null}

        {hubUi.bitcoinPayments ? (
        <Segment>
          <Header as='h3'>Send Payment (Layer 1)</Header>
          <p style={{ color: '#666', marginBottom: 0 }}>
            This section moved to the dedicated wallet transactions screen (includes federation multisig vault tools).
            {' '}
            <Link to="/services/bitcoin/transactions?scope=wallet#fabric-federation-wallet-panel">Open wallet &amp; federation</Link>.
          </p>
        </Segment>
        ) : null}

        {hubUi.bitcoinLightning && isLightningPage ? (
        <Segment id="fabric-bitcoin-lightning">
          <Header as='h3'>Lightning Node (Layer 2)</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge:</strong> create invoice, decode, and pay go through the Hub or external Lightning API.</p>
          {lightningAvailable && this.state.lightningStatus && this.state.lightningStatus.status === 'RUNNING' && (
            <>
              <Message positive style={{ marginBottom: '1em' }}>
                <Message.Header>
                  <Icon name='bolt' />
                  Lightning node running
                  {this.state.lightningStatus.node && this.state.lightningStatus.node.alias
                    ? ` — ${this.state.lightningStatus.node.alias}`
                    : ''}
                </Message.Header>
                <p>
                  {this.state.lightningChannels.length} channel(s).
                </p>
              </Message>
              {this.state.lightningStatus.node && (this.state.lightningStatus.node.id || this.state.lightningStatus.node.address || this.state.lightningStatus.node.binding) && (
                <Segment style={{ padding: '0.75em', marginBottom: '1em', background: 'rgba(0,0,0,0.03)' }}>
                  <Header as='h5' style={{ margin: '0 0 0.5em 0' }}>Share with other peers</Header>
                  {this.state.lightningStatus.node.id && (
                    <div style={{ marginBottom: '0.5em' }}>
                      <strong>Peer ID:</strong>{' '}
                      <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{this.state.lightningStatus.node.id}</code>
                    </div>
                  )}
                  {(this.state.lightningStatus.node.address || this.state.lightningStatus.node.binding) && (
                    <div style={{ marginBottom: '0.5em' }}>
                      <strong>IP:PORT:</strong>{' '}
                      <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{this.state.lightningStatus.node.address || this.state.lightningStatus.node.binding}</code>
                    </div>
                  )}
                  {this.state.lightningStatus.node.id && (this.state.lightningStatus.node.address || this.state.lightningStatus.node.binding) && (
                    <div style={{ marginBottom: '0.5em' }}>
                      <strong>Connect string (for Create channel):</strong>{' '}
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
                      title='Copy Lightning peer ID and address'
                    >
                      <Icon name='copy' />
                      Copy to clipboard
                    </Button>
                  )}
                </Segment>
              )}
            </>
          )}
          {!lightningAvailable && (
            <Message info>
              <Message.Header>Lightning</Message.Header>
              <p>{(this.state.lightningStatus && this.state.lightningStatus.message) || 'Lightning runs automatically with regtest. Use regtest for local development.'}</p>
            </Message>
          )}

          {lightningAvailable && this.state.lightningStatus && this.state.lightningStatus.status === 'RUNNING' && (
            <Segment style={{ padding: '0.75em', marginBottom: '1em', background: 'rgba(0,0,0,0.02)' }}>
              <Header as='h5' style={{ margin: '0 0 0.5em 0' }}>Fund Lightning node</Header>
              <p style={{ color: '#666', marginBottom: '0.5em', fontSize: '0.95em' }}>
                Send on-chain Bitcoin to this address to fund the Lightning node. You need funds before creating channels. Use the Faucet below (regtest) or Send Payment.
              </p>
              {this.state.lightningStatus.node && this.state.lightningStatus.node.depositAddress && (
                <div style={{ marginBottom: '0.5em' }}>
                  <strong>Deposit address:</strong>{' '}
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
                    title='Copy deposit address'
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
                    title='Use this address in the Faucet below'
                  >
                    <Icon name='tint' />
                    Use in Faucet
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
                  <strong>On-chain balance:</strong>{' '}
                  {formatSatsDisplay(bal.confirmed)} sats confirmed
                  {bal.unconfirmed > 0 && (
                    <span style={{ marginLeft: '0.5em' }}>
                      + {formatSatsDisplay(bal.unconfirmed)} unconfirmed
                    </span>
                  )}
                  {bal.immature > 0 && (
                    <span style={{ marginLeft: '0.5em' }}>
                      + {formatSatsDisplay(bal.immature)} immature
                    </span>
                  )}
                  {total > 0 && (bal.unconfirmed > 0 || bal.immature > 0) && (
                    <span style={{ marginLeft: '0.5em', fontWeight: 600 }}>
                      = {formatSatsDisplay(total)} sats total
                    </span>
                  )}
                  {total < 10000 && (
                    <span style={{ marginLeft: '0.5em', color: '#b00' }}>(need at least 10,000 sats for channels)</span>
                  )}
                  {(this.state.bitcoinStatus && this.state.bitcoinStatus.network === 'regtest') && (
                    <p style={{ fontSize: '0.85em', color: '#666', marginTop: '0.25em', marginBottom: 0 }}>
                      On regtest: generate blocks after sending to confirm. Click refresh to update.
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
                  Channels ({this.state.lightningChannels.length})
                </Link>
              </Header>
              {this.state.lightningChannels.length === 0 ? (
                <p style={{ color: '#666' }}>No channels yet. Create one below to connect to another Lightning node.</p>
              ) : (
                <Table celled compact size='small'>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Peer</Table.HeaderCell>
                      <Table.HeaderCell>State</Table.HeaderCell>
                      <Table.HeaderCell>Capacity</Table.HeaderCell>
                      <Table.HeaderCell>Our balance</Table.HeaderCell>
                      <Table.HeaderCell>Short channel ID</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {this.state.lightningChannels.map((channel, idx) => {
                      const channelId = channel.channel_id || channel.funding_txid || idx;
                      const toUrl = `/services/bitcoin/channels/${encodeURIComponent(channelId)}`;
                      return (
                        <Table.Row
                          key={channelId}
                          style={{ cursor: 'pointer' }}
                          onClick={() => this.props.navigate ? this.props.navigate(toUrl) : (window.location.href = toUrl)}
                        >
                          <Table.Cell>
                            <code style={{ fontSize: '0.85em' }}>{this.trimHash(channel.peer_id || channel.funding_txid || '')}</code>
                          </Table.Cell>
                          <Table.Cell>{channel.state || '—'}</Table.Cell>
                          <Table.Cell>
                            {channel.amount_msat != null ? `${formatSatsDisplay(Math.floor(Number(channel.amount_msat) / 1000))} sats` : (channel.channel_sat != null ? `${formatSatsDisplay(channel.channel_sat)} sats` : '—')}
                          </Table.Cell>
                          <Table.Cell>
                            {channel.our_amount_msat != null ? `${formatSatsDisplay(Math.floor(Number(channel.our_amount_msat) / 1000))} sats` : '—'}
                          </Table.Cell>
                          <Table.Cell>
                            <code style={{ fontSize: '0.8em' }}>{channel.short_channel_id || '—'}</code>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table>
              )}

              <Header as='h4' style={{ marginTop: '1.5em' }}>Create channel</Header>
              <p style={{ color: '#666', marginBottom: '0.5em' }}>
                Connect to a peer and open a channel. Paste the <strong>connect string (id@ip:port)</strong> from the other node&apos;s Share section above.
              </p>
              <Form>
                <Form.Group widths='equal'>
                  <Form.Field>
                    <label>Remote (id@ip:port)</label>
                    <Input
                      placeholder='03abc123...@192.168.50.5:9735'
                      value={this.state.channelCreateRemote}
                      onChange={(e) => this.setState({ channelCreateRemote: e.target.value })}
                    />
                  </Form.Field>
                </Form.Group>
                <Form.Group widths='equal'>
                  <Form.Field>
                    <label>Amount (sats, min 10000)</label>
                    <Input
                      type='number'
                      min='10000'
                      placeholder='100000'
                      value={this.state.channelCreateAmountSats}
                      onChange={(e) => this.setState({ channelCreateAmountSats: e.target.value })}
                    />
                  </Form.Field>
                  <Form.Field>
                    <label>Push to peer (msat, optional)</label>
                    <Input
                      type='number'
                      min='0'
                      placeholder='0'
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
                  Create channel
                </Button>
              </Form>
              {this.state.channelCreateResult && (
                <Message
                  style={{ marginTop: '1em' }}
                  negative={!!this.state.channelCreateResult.error}
                  positive={!this.state.channelCreateResult.error}
                >
                  <Message.Header>{this.state.channelCreateResult.error ? 'Channel creation failed' : 'Channel created'}</Message.Header>
                  {this.state.channelCreateResult.error && (
                    <p style={{ marginBottom: '0.5em' }}>
                      {this.state.channelCreateResult.error}
                      {this.state.channelCreateResult.detail && ` — ${this.state.channelCreateResult.detail}`}
                    </p>
                  )}
                  {this.state.channelCreateResult.error && /connect|peer|connection/i.test(this.state.channelCreateResult.error) && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginTop: '0.5em' }}>
                      Ensure the <strong>Remote (id@ip:port)</strong> field is filled with the other node&apos;s connect string from their Share section. The other node must be running and reachable (use the host&apos;s IP, not 127.0.0.1, when connecting across machines).
                    </p>
                  )}
                  {this.state.channelCreateResult.error && /wrong key|handshake/i.test(this.state.channelCreateResult.error) && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginTop: '0.5em' }}>
                      <strong>Wrong key / handshake failed</strong> means the node ID doesn&apos;t match the node at that address. Use the <strong>other</strong> node&apos;s connect string — not your own. If you&apos;re on the same machine, ensure you&apos;re not connecting this Hub to itself.
                    </p>
                  )}
                  {this.state.channelCreateResult.error && /bad file descriptor/i.test(this.state.channelCreateResult.error) && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginTop: '0.5em' }}>
                      <strong>Bad file descriptor</strong> often indicates a CLN resource issue. Try: restart the Lightning node; check <code>ulimit -n</code> (file descriptor limit); verify the remote is listening with <code>nc -zv host 9735</code>.
                    </p>
                  )}
                  {this.state.channelCreateResult.error && /Unsupported feature|feature 44|WIRE_WARNING|peer_disconnected/i.test(
                    [this.state.channelCreateResult.error, this.state.channelCreateResult.detail].filter(Boolean).join(' ')
                  ) && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginTop: '0.5em' }}>
                      <strong>Unsupported feature 44</strong> means the remote node does not support BOLT 9 channel_type. Upgrade the remote Lightning node (LND, CLN, or Eclair) to a version from 2021 or later.
                    </p>
                  )}
                  {this.state.channelCreateResult.hint && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginTop: '0.5em' }}>
                      {this.state.channelCreateResult.hint}
                    </p>
                  )}
                  {this.state.channelCreateResult.status && (
                    <p style={{ fontSize: '0.85em', color: '#555', marginTop: '0.5em' }}>
                      <strong>Status:</strong> {this.state.channelCreateResult.status.peerCount != null ? `${this.state.channelCreateResult.status.peerCount} peers` : '—'} {this.state.channelCreateResult.status.idleDisconnected != null ? `(${this.state.channelCreateResult.status.idleDisconnected} idle disconnected)` : ''}
                    </p>
                  )}
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '0.5em' }}>{JSON.stringify(this.state.channelCreateResult, null, 2)}</pre>
                </Message>
              )}
            </>
          )}

          <Header as='h4' style={{ marginTop: '1.5em' }}>Invoices & payments</Header>
          <p style={{ fontSize: '0.88em', color: '#666', margin: '0 0 0.75em' }}>
            Below is <strong>Lightning (BOLT11)</strong>. For <strong>on-chain payment requests</strong> stored in the browser (account-to-account walkthrough), use{' '}
            {hubUi.bitcoinInvoices ? (
              <Link to="/services/bitcoin/invoices#fabric-invoices-tab-demo">Invoices</Link>
            ) : (
              <strong>Invoices</strong>
            )}.
          </p>
          <Form>
            <Form.Group widths='equal'>
              <Form.Field>
                <label>Create invoice amount (sats)</label>
                <Input
                  type='number'
                  min='1'
                  step='1'
                  placeholder='500'
                  value={this.state.invoiceAmountSats}
                  onChange={(e) => this.setState({ invoiceAmountSats: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label>Invoice memo</label>
                <Input
                  placeholder='Shown to payer (optional)'
                  value={this.state.invoiceMemo}
                  onChange={(e) => this.setState({ invoiceMemo: e.target.value })}
                />
              </Form.Field>
            </Form.Group>
            <Button onClick={() => this.handleCreateLightningInvoice()} disabled={!lightningAvailable}>
              <Icon name='add circle' />
              Create Invoice
            </Button>
            <Form.Field style={{ marginTop: '1em' }}>
              <label>Invoice (BOLT11)</label>
              <Form.TextArea
                rows={3}
                placeholder='lnbc...'
                value={this.state.invoiceInput}
                onChange={(e) => this.setState({ invoiceInput: e.target.value })}
              />
            </Form.Field>
            <Button basic onClick={() => this.handleDecodeLightningInvoice()} disabled={!lightningAvailable}>
              <Icon name='search' />
              Decode
            </Button>
            <Button color='green' onClick={() => this.handlePayLightningInvoice()} disabled={!lightningAvailable}>
              <Icon name='bolt' />
              Pay Invoice
            </Button>
          </Form>
          {this.state.lightningResult && (
            <Message
              style={{ marginTop: '1em' }}
              negative={!!this.state.lightningResult.error}
              positive={!this.state.lightningResult.error}
            >
              <Message.Header>{this.state.lightningResult.error ? 'Lightning action failed' : 'Lightning response'}</Message.Header>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(this.state.lightningResult, null, 2)}</pre>
            </Message>
          )}
        </Segment>
        ) : null}

        {isExplorerPage ? (
        <Segment id="bitcoin-explorer">
          <Header as='h3'>Explorer</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge (Hub node):</strong> blocks and mempool transactions.</p>
          {!hubUi.bitcoinExplorer && (this.state.blocks.length > 0 || this.state.transactions.length > 0) ? (
            <Message info size="small" style={{ marginBottom: '0.75em' }}>
              Enable <strong>Bitcoin — Block &amp; transaction detail routes</strong> in Admin → Feature visibility to open block and tx pages from the lists below.
            </Message>
          ) : null}
          <Header as='h4'>Recent Blocks</Header>
          {this.state.blocks.length === 0 ? (
            explorerDataPending ? (
              <p style={{ color: '#666' }}>
                <Loader inline active size="small" /> Loading block list from the Hub…
              </p>
            ) : (
              <p style={{ color: '#666' }}>No block data yet.</p>
            )
          ) : (
            <List divided relaxed>
              {this.state.blocks.map((block, idx) => {
                const txCount = block.txCount != null
                  ? Number(block.txCount)
                  : (block.tx_count != null ? Number(block.tx_count) : null);
                const rewardSats = block.rewardSats != null ? Number(block.rewardSats) : null;
                const totalOutSats = block.totalOutSats != null ? Number(block.totalOutSats) : null;
                const txPart = Number.isFinite(txCount)
                  ? `${txCount} tx${txCount === 1 ? '' : 's'}`
                  : null;
                const rewardPart = Number.isFinite(rewardSats) && rewardSats >= 0
                  ? `reward ${this.satsToBTC(rewardSats)} BTC`
                  : null;
                const volumePart = Number.isFinite(totalOutSats) && totalOutSats >= 0
                  ? `volume ${this.satsToBTC(totalOutSats)} BTC`
                  : null;
                const metaBits = [txPart, rewardPart, volumePart].filter(Boolean);
                const meta = metaBits.length ? ` · ${metaBits.join(' · ')}` : '';
                return (
                  <List.Item key={block.hash || block.id || idx}>
                    <List.Content>
                      <List.Header>
                        {block.hash || block.id ? (
                          hubUi.bitcoinExplorer ? (
                            <Link to={`/services/bitcoin/blocks/${encodeURIComponent(block.hash || block.id)}`}>
                              #{block.height != null ? block.height : 'n/a'} - {this.trimHash(block.hash || block.id || '')}
                            </Link>
                          ) : (
                            <span>#{block.height != null ? block.height : 'n/a'} - {this.trimHash(block.hash || block.id || '')}</span>
                          )
                        ) : (
                          <span>#{block.height != null ? block.height : 'n/a'} - hash unavailable</span>
                        )}
                      </List.Header>
                      <List.Description>
                        {block.time ? new Date(Number(block.time) * 1000).toLocaleString() : 'time unavailable'}
                        {meta}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                );
              })}
            </List>
          )}

          <Header as='h4' style={{ marginTop: '1em' }}>Mempool Transactions ({this.state.transactions.length})</Header>
          {this.state.transactions.length === 0 ? (
            explorerDataPending ? (
              <p style={{ color: '#666' }}>
                <Loader inline active size="small" /> Loading mempool transactions…
              </p>
            ) : (
              <p style={{ color: '#666' }}>No transaction data yet.</p>
            )
          ) : (
            <List divided relaxed>
              {this.state.transactions.map((tx, idx) => {
                const tid = tx.txid || tx.id || '';
                const unconfirmed = tx.confirmations != null ? Number(tx.confirmations) === 0 : true;
                return (
                  <List.Item key={tid || idx}>
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
                          <span style={{ marginLeft: '0.5em', fontSize: '0.85em', color: '#f2711c' }}>(mempool)</span>
                        )}
                      </List.Header>
                      <List.Description>
                        {tx.value != null ? `${tx.value} BTC` : (tx.amountSats != null ? `${formatSatsDisplay(tx.amountSats)} sats` : 'amount unavailable')}
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
            {this.state.advancedOpen ? 'Hide' : 'Show'} advanced UTXO controls
          </Button>
          {this.state.advancedOpen && (
            <div style={{ marginTop: '0.75em' }}>
              <Header as='h4'>UTXO detail (advanced)</Header>
              <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge (Hub node):</strong> UTXOs from upstream payments API.</p>
              {this.state.utxos.length === 0 ? (
                <p style={{ color: '#666' }}>No UTXO data returned by upstream payments API.</p>
              ) : (
                <Table compact='very' celled>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Txid</Table.HeaderCell>
                      <Table.HeaderCell>Vout</Table.HeaderCell>
                      <Table.HeaderCell>Amount</Table.HeaderCell>
                      <Table.HeaderCell>Confirmations</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {this.state.utxos.map((utxo, idx) => (
                      <Table.Row key={`${utxo.txid || idx}:${utxo.vout || 0}`}>
                        <Table.Cell><code>{this.trimHash(utxo.txid || utxo.id || '')}</code></Table.Cell>
                        <Table.Cell>{utxo.vout != null ? utxo.vout : '-'}</Table.Cell>
                        <Table.Cell>{utxo.amount != null ? utxo.amount : (utxo.amountSats != null ? `${formatSatsDisplay(utxo.amountSats)} sats` : '-')}</Table.Cell>
                        <Table.Cell>{utxo.confirmations != null ? utxo.confirmations : '-'}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              )}
            </div>
          )}
        </Segment>

        <Modal open={this.state.settingsOpen} onClose={() => this.setState({ settingsOpen: false })} size='small'>
          <Modal.Header>Bitcoin Upstream Settings</Modal.Header>
          <Modal.Content>
            <Form>
              <Form.Field>
                <label>Explorer API base URL</label>
                <Input
                  placeholder='https://explorer.fabric.pub'
                  value={this.state.upstreamDraft.explorerBaseUrl}
                  onChange={(e) => this.setState({ upstreamDraft: { ...this.state.upstreamDraft, explorerBaseUrl: e.target.value } })}
                />
              </Form.Field>
              <Form.Field>
                <label>Payments API base URL</label>
                <Input
                  placeholder='https://payments.fabric.pub'
                  value={this.state.upstreamDraft.paymentsBaseUrl}
                  onChange={(e) => this.setState({ upstreamDraft: { ...this.state.upstreamDraft, paymentsBaseUrl: e.target.value } })}
                />
              </Form.Field>
              <Form.Field>
                <label>Lightning API base URL</label>
                <Input
                  placeholder='https://lightning.fabric.pub'
                  value={this.state.upstreamDraft.lightningBaseUrl}
                  onChange={(e) => this.setState({ upstreamDraft: { ...this.state.upstreamDraft, lightningBaseUrl: e.target.value } })}
                />
              </Form.Field>
              <Form.Field>
                <label>Payjoin API base URL</label>
                <Input
                  placeholder='https://hub.fabric.pub/services/payjoin'
                  value={this.state.upstreamDraft.payjoinBaseUrl || ''}
                  onChange={(e) => this.setState({ upstreamDraft: { ...this.state.upstreamDraft, payjoinBaseUrl: e.target.value } })}
                />
              </Form.Field>
              <Form.Field>
                <label>API token (optional)</label>
                <Input
                  type='password'
                  placeholder='Bearer token'
                  value={this.state.upstreamDraft.apiToken}
                  onChange={(e) => this.setState({ upstreamDraft: { ...this.state.upstreamDraft, apiToken: e.target.value } })}
                />
              </Form.Field>
            </Form>
          </Modal.Content>
          <Modal.Actions>
            <Button onClick={() => this.setState({ settingsOpen: false })}>Cancel</Button>
            <Button
              primary
              onClick={() => {
                const saved = saveUpstreamSettings(this.state.upstreamDraft);
                this.setState({ upstream: saved, settingsOpen: false }, () => this.refresh());
              }}
            >
              Save
            </Button>
          </Modal.Actions>
        </Modal>
      </div>
    );
  }
}

module.exports = BitcoinHome;
