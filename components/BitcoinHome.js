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
  fetchAddressBalance,
  fetchBitcoinStatus,
  fetchBitcoinPeers,
  fetchBitcoinNetworkSummary,
  broadcastRawTransaction,
  fetchExplorerData,
  fetchLightningChannels,
  fetchLightningStatus,
  fetchPayjoinCapabilities,
  fetchPayjoinSession,
  fetchReceiveAddress,
  fetchUTXOs,
  fetchWalletSummary,
  fetchWalletSummaryWithCache,
  getWalletContextFromIdentity,
  loadUpstreamSettings,
  payLightningInvoice,
  reserveNextReceiveAddress,
  saveUpstreamSettings,
  sendPayment,
  generateBlock,
  requestFaucet
} = require('../functions/bitcoinClient');
const { formatSatsDisplay, formatBtcFromSats } = require('../functions/formatSats');

class BitcoinHome extends React.Component {
  constructor (props) {
    super(props);

    const upstream = loadUpstreamSettings();
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
      payjoinEnabled: false,
      payjoinAmountSats: '',
      payjoinLabel: '',
      payjoinMemo: '',
      payjoinSessionId: '',
      payjoinResult: null,
      payjoinCapabilities: { available: false },
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
      txLookupError: null
    };
  }

  componentDidMount () {
    this.refresh();
    this._onGlobalStateUpdate = this._onGlobalStateUpdate.bind(this);
    window.addEventListener('globalStateUpdate', this._onGlobalStateUpdate);
  }

  componentWillUnmount () {
    if (this._onGlobalStateUpdate) {
      window.removeEventListener('globalStateUpdate', this._onGlobalStateUpdate);
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
      const wallet = getWalletContextFromIdentity(identity);
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

  componentDidUpdate (prevProps) {
    const prevId = prevProps && prevProps.identity && prevProps.identity.xpub;
    const nextId = this.props && this.props.identity && this.props.identity.xpub;
    if (prevId !== nextId) this.refresh();
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
    const wallet = getWalletContextFromIdentity(identity);
    const upstream = this.state.upstream;

    this.setState({ loading: !this.state.wallet.walletId, refreshing: true, error: null });

    const network = (this.state.bitcoinStatus && this.state.bitcoinStatus.network) ? String(this.state.bitcoinStatus.network).toLowerCase() : '';
    const summaryTask = fetchWalletSummaryWithCache(upstream, wallet, { network }).catch(() => ({}));
    const explorerTask = fetchExplorerData(upstream).catch(() => ({ blocks: [], transactions: [] }));
    const bitcoinStatusTask = fetchBitcoinStatus(upstream).catch(() => ({ available: false, status: 'UNAVAILABLE' }));
    const lightningStatusTask = fetchLightningStatus(upstream).catch(() => ({ available: false, status: 'UNAVAILABLE' }));
    const lightningChannelsTask = fetchLightningChannels(upstream).catch(() => ({ channels: [], outputs: [] }));
    const utxoTask = fetchUTXOs(upstream, wallet).catch(() => []);
    const payjoinCapabilitiesTask = fetchPayjoinCapabilities(upstream).catch(() => ({ available: false }));
    const payjoinSessionTask = this.state.payjoinSessionId
      ? fetchPayjoinSession(upstream, this.state.payjoinSessionId).catch(() => null)
      : Promise.resolve(null);
    const nodePeersTask = fetchBitcoinPeers(upstream).catch(() => []);
    const nodeNetworkTask = fetchBitcoinNetworkSummary(upstream).catch(() => ({}));

    try {
      const [summary, explorer, bitcoinStatus, lightningStatus, lightningChannels, utxos, payjoinCapabilities, payjoinSession, nodePeers, nodeNetwork] = await Promise.all([
        summaryTask,
        explorerTask,
        bitcoinStatusTask,
        lightningStatusTask,
        lightningChannelsTask,
        utxoTask,
        payjoinCapabilitiesTask,
        payjoinSessionTask,
        nodePeersTask,
        nodeNetworkTask
      ]);
      const network = (bitcoinStatus && bitcoinStatus.network) ? String(bitcoinStatus.network).toLowerCase() : '';
      const address = await fetchReceiveAddress(upstream, wallet, { network }).catch(() => summary.address || '');
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

      this.setState({
        loading: false,
        refreshing: false,
        error: null,
        wallet: {
          ...wallet,
          balanceSats,
          confirmedSats,
          unconfirmedSats,
          address: address || summary.address || '',
          receiveIndex: Number(summary.receiveIndex || 0)
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
        payjoinResult: payjoinSession || this.state.payjoinResult,
        nodePeers: Array.isArray(nodePeers) ? nodePeers : [],
        nodeNetwork: nodeNetwork && typeof nodeNetwork === 'object' ? nodeNetwork : {}
      });
      if (typeof window !== 'undefined' && Number.isFinite(balanceSats)) {
        window.dispatchEvent(new CustomEvent('clientBalanceUpdate', {
          detail: { balanceSats, confirmedSats, unconfirmedSats }
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
    const next = reserveNextReceiveAddress(this.state.wallet, { network });
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

    try {
      const result = await sendPayment(this.state.upstream, this.state.wallet, {
        to: paymentTo,
        amountSats: paymentAmountSats,
        memo: this.state.paymentMemo
      });

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
      await this.refresh();
    } catch (error) {
      this.setState({ paymentResult: { error: error && error.message ? error.message : String(error) } });
    }
  }

  async handleCreatePayjoinDeposit () {
    if (!this.state.payjoinEnabled) {
      this.setState({ payjoinResult: { error: 'Enable Payjoin first to create an optional BIP77 deposit request.' } });
      return;
    }

    try {
      const session = await createPayjoinDeposit(this.state.upstream, this.state.wallet, {
        address: this.state.wallet.address,
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
    if (n === 'regtest') return 'bcrt1... or m/44\'/1\'/0\'/0/0';
    if (n === 'testnet' || n === 'signet') return 'tb1... or 2N...';
    if (n === 'mainnet' || n === 'main') return 'bc1... or 3...';
    return 'address for current network';
  }

  render () {
    const wallet = this.state.wallet;
    const hasUpstream = !!(this.state.upstream.explorerBaseUrl || this.state.upstream.paymentsBaseUrl || this.state.upstream.lightningBaseUrl);
    const bitcoinReady = !!(this.state.bitcoinStatus && this.state.bitcoinStatus.available);
    const bitcoinNetwork = String((this.state.bitcoinStatus && this.state.bitcoinStatus.network) || '').toLowerCase();
    const hasAdminToken = !!(this.props.adminToken);
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

    return (
      <div className='fade-in'>
        <Segment>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
            <Header as='h2' style={{ margin: 0 }}>
              <Icon name='bitcoin' color='orange' />
              <Header.Content>Bitcoin</Header.Content>
            </Header>
            <div>
              <Button basic icon onClick={() => this.setState({ settingsOpen: true, upstreamDraft: { ...this.state.upstream } })} title='Configure upstream APIs'>
                <Icon name='cog' />
              </Button>
              <Button primary loading={this.state.refreshing} onClick={() => this.refresh()}>
                <Icon name='refresh' />
                Refresh
              </Button>
              {canShowGenerateBlock && (
                <Button basic onClick={() => this.handleGenerateBlock()} title='Generate one regtest block'>
                  <Icon name='cube' />
                  Generate Block
                </Button>
              )}
              <Button as={Link} to="/services/bitcoin/payments" basic title='Open wallet payments manager'>
                <Icon name='credit card outline' />
                Payments
              </Button>
              <Button as={Link} to="/services/bitcoin/invoices" basic title='Create and manage invoices'>
                <Icon name='file alternate outline' />
                Invoices
              </Button>
              <Button as={Link} to="/services/bitcoin/resources" basic title='Browse Bitcoin HTTP resources (GET) and L1 verify'>
                <Icon name='sitemap' />
                Resources
              </Button>
            </div>
          </div>
          <p style={{ marginTop: '0.5em', color: '#666' }}>Bitcoin is a new form of money designed for the Internet.</p>
        </Segment>

        {!hasUpstream && (
          <Message warning>
            <Message.Header>Upstream APIs not configured</Message.Header>
            <p>Open the settings cog and add your explorer/payments/lightning endpoints to enable live data and transactions.</p>
          </Message>
        )}

        {this.state.error && (
          <Message negative>
            <Message.Header>Bitcoin data refresh failed</Message.Header>
            <p>{this.state.error}</p>
          </Message>
        )}

        <Segment loading={this.state.loading}>
          <Header as='h3'>Service Health</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge (Hub node):</strong> status, Hub wallet balance, Beacon, Lightning.</p>
          <div><strong>Bitcoin:</strong> {this.state.bitcoinStatus && this.state.bitcoinStatus.status ? this.state.bitcoinStatus.status : 'unknown'}{bitcoinNetwork ? ` (${bitcoinNetwork})` : ''}</div>
          <div style={{ color: '#666', marginBottom: '0.5em' }}>{this.state.bitcoinStatus && this.state.bitcoinStatus.message ? this.state.bitcoinStatus.message : ''}</div>
          {this.state.bitcoinStatus && this.state.bitcoinStatus.balance != null && (
            <div><strong>Hub wallet balance:</strong> {Number(this.state.bitcoinStatus.balance || 0).toFixed(8)} BTC (regtest block rewards go here)</div>
          )}
          {this.state.bitcoinStatus && this.state.bitcoinStatus.beacon && (
            <div><strong>Beacon core balance:</strong> {this.satsToBTC(this.state.bitcoinStatus.beacon.balanceSats || 0)} BTC (epoch {this.state.bitcoinStatus.beacon.clock || 0})</div>
          )}
          <div><strong>Lightning:</strong> {this.state.lightningStatus && this.state.lightningStatus.status === 'NOT_CONFIGURED'
            ? 'runs with regtest'
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
            <p style={{ color: '#666', marginBottom: '1em' }}>No peer list (Hub Bitcoin RPC offline or <code>GET /services/bitcoin/peers</code> unavailable).</p>
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
                <Button type='button' primary disabled={!bitcoinReady} onClick={() => this.handleTxLookup()}>
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
                      <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(this.state.rawTxResult.txid))}`}>
                        <code>{this.state.rawTxResult.txid}</code>
                      </Link>
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
            <strong>Client:</strong> identity fingerprint, xpub, receive index, and client balance. <strong>Bridge:</strong> receive address + funding rails.
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
          <div style={{ marginTop: '0.75em' }}>
            <Checkbox
              toggle
              checked={!!this.state.payjoinEnabled}
              onChange={(e, data) => this.setState({ payjoinEnabled: !!(data && data.checked) })}
              label='Use Payjoin (BIP77) for the next optional deposit flow'
              disabled={!(this.state.payjoinCapabilities && this.state.payjoinCapabilities.available)}
            />
          </div>
          <div style={{ marginTop: '0.25em', color: '#666' }}>
            Payjoin endpoint status:{' '}
            <strong>{this.state.payjoinCapabilities && this.state.payjoinCapabilities.available ? 'available' : 'unavailable'}</strong>
          </div>
        </Segment>

        <Segment>
          <Header as='h3'>Look Up Address Balance</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>
            <Icon name='search' /> Query balance for any on-chain address. <strong>Server does not hold keys</strong> — uses scantxoutset. Requires txindex.
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

        <Segment>
          <Header as='h3'>Payjoin Deposit (BIP77, optional)</Header>
          <p style={{ color: '#666' }}>
            This creates a BIP21 receive URI with a <code>pj</code> endpoint for sender-side Payjoin negotiation.
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
                  placeholder='payjoin test'
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
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(this.state.payjoinResult, null, 2)}</pre>
            </Message>
          )}
        </Segment>

        <Segment data-faucet-segment>
          <Header as='h3'>Faucet</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>
            <strong>Bridge:</strong> draws from Beacon/Hub wallet (regtest only). Max 1,000,000 sats per request.
            {bitcoinNetwork && <span> Use addresses for <strong>{bitcoinNetwork}</strong> (e.g. {addressPlaceholder}).</span>}
            {' '}Use <strong>Use my receive address</strong> so funds go to your wallet; otherwise balance will not update.
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
                          <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(txid))}`}>
                            View transaction
                          </Link>
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

        <Segment>
          <Header as='h3'>Send Payment (Layer 1)</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>
            <strong>Bridge:</strong> payment is executed by the Hub node wallet.
            {bitcoinNetwork && <span> Use addresses for <strong>{bitcoinNetwork}</strong>.</span>}
          </p>
          <Form>
            <Form.Field>
              <label>Recipient address ({bitcoinNetwork || 'any'})</label>
              <Input
                placeholder={addressPlaceholder}
                value={this.state.paymentTo}
                onChange={(e) => this.setState({ paymentTo: e.target.value })}
              />
            </Form.Field>
            <Form.Group widths='equal'>
              <Form.Field>
                <label>Amount (sats)</label>
                <Input
                  type='number'
                  min='1'
                  step='1'
                  placeholder='1000'
                  value={this.state.paymentAmountSats}
                  onChange={(e) => this.setState({ paymentAmountSats: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label>Memo (optional)</label>
                <Input
                  placeholder='debug payment'
                  value={this.state.paymentMemo}
                  onChange={(e) => this.setState({ paymentMemo: e.target.value })}
                />
              </Form.Field>
            </Form.Group>
            <Button primary onClick={() => this.handleSendPayment()}>
              <Icon name='send' />
              Send
            </Button>
          </Form>
          {this.state.paymentResult && (
            <Message
              style={{ marginTop: '1em' }}
              negative={!!this.state.paymentResult.error}
              positive={!this.state.paymentResult.error}
            >
              <Message.Header>{this.state.paymentResult.error ? 'Payment failed' : 'Payment response'}</Message.Header>
              {!this.state.paymentResult.error && (() => {
                const pr = this.state.paymentResult;
                const tid = (pr && pr.payment && pr.payment.txid) || (pr && pr.txid);
                return tid ? (
                  <p style={{ marginTop: '0.75em', marginBottom: '0.5em', color: '#555' }}>
                    On-chain sends often appear in the <strong>mempool</strong> first (0 confirmations).{' '}
                    <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(tid))}`}>Open this transaction</Link>
                    {' '}to watch depth; mine a block on regtest to confirm.
                  </p>
                ) : null;
              })()}
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(this.state.paymentResult, null, 2)}</pre>
            </Message>
          )}
        </Segment>

        <Segment>
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
                    {this.state.lightningChannels.map((ch, idx) => {
                      const chId = ch.channel_id || ch.funding_txid || idx;
                      const toUrl = `/services/bitcoin/channels/${encodeURIComponent(chId)}`;
                      return (
                        <Table.Row
                          key={chId}
                          style={{ cursor: 'pointer' }}
                          onClick={() => this.props.navigate ? this.props.navigate(toUrl) : (window.location.href = toUrl)}
                        >
                          <Table.Cell>
                            <code style={{ fontSize: '0.85em' }}>{this.trimHash(ch.peer_id || ch.funding_txid || '')}</code>
                          </Table.Cell>
                          <Table.Cell>{ch.state || '—'}</Table.Cell>
                          <Table.Cell>
                            {ch.amount_msat != null ? `${formatSatsDisplay(Math.floor(Number(ch.amount_msat) / 1000))} sats` : (ch.channel_sat != null ? `${formatSatsDisplay(ch.channel_sat)} sats` : '—')}
                          </Table.Cell>
                          <Table.Cell>
                            {ch.our_amount_msat != null ? `${formatSatsDisplay(Math.floor(Number(ch.our_amount_msat) / 1000))} sats` : '—'}
                          </Table.Cell>
                          <Table.Cell>
                            <code style={{ fontSize: '0.8em' }}>{ch.short_channel_id || '—'}</code>
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
                  placeholder='local lightning test'
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

        <Segment>
          <Header as='h3'>Explorer</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge (Hub node):</strong> blocks and mempool transactions.</p>
          <Header as='h4'>Recent Blocks</Header>
          {this.state.blocks.length === 0 ? (
            <p style={{ color: '#666' }}>No block data yet.</p>
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
                          <Link to={`/services/bitcoin/blocks/${encodeURIComponent(block.hash || block.id)}`}>
                            #{block.height != null ? block.height : 'n/a'} - {this.trimHash(block.hash || block.id || '')}
                          </Link>
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
            <p style={{ color: '#666' }}>No transaction data yet.</p>
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
                          <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(tid))}`}>
                            {this.trimHash(tid)}
                          </Link>
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
