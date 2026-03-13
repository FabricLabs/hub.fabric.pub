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
  createLightningInvoice,
  createPayjoinDeposit,
  decodeLightningInvoice,
  fetchAddressBalance,
  fetchBitcoinStatus,
  fetchExplorerData,
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
      paymentResult: null,
      lightningResult: null,
      faucetAddress: '',
      faucetAmountSats: '10000',
      faucetResult: null,
      lookupAddress: '',
      lookupResult: null,
      lookupLoading: false
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
    const sats = Number(value || 0);
    return (sats / 100000000).toFixed(8);
  }

  trimHash (value = '', left = 8, right = 8) {
    const text = String(value || '');
    if (text.length <= left + right + 1) return text;
    return `${text.slice(0, left)}...${text.slice(-right)}`;
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
    const utxoTask = fetchUTXOs(upstream, wallet).catch(() => []);
    const payjoinCapabilitiesTask = fetchPayjoinCapabilities(upstream).catch(() => ({ available: false }));
    const payjoinSessionTask = this.state.payjoinSessionId
      ? fetchPayjoinSession(upstream, this.state.payjoinSessionId).catch(() => null)
      : Promise.resolve(null);

    try {
      const [summary, explorer, bitcoinStatus, lightningStatus, utxos, payjoinCapabilities, payjoinSession] = await Promise.all([
        summaryTask,
        explorerTask,
        bitcoinStatusTask,
        lightningStatusTask,
        utxoTask,
        payjoinCapabilitiesTask,
        payjoinSessionTask
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
        utxos: Array.isArray(utxos) ? utxos : [],
        payjoinCapabilities: payjoinCapabilities && typeof payjoinCapabilities === 'object'
          ? payjoinCapabilities
          : { available: false },
        payjoinResult: payjoinSession || this.state.payjoinResult
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

  async handleGenerateBlock () {
    try {
      // Block generation always uses the Hub's wallet; no address is sent so coinbase goes to the Hub.
      const result = await generateBlock(this.state.upstream, { count: 1 });
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
    const canGenerateBlocks = bitcoinReady && bitcoinNetwork === 'regtest';
    const lightningAvailable = !!(this.state.lightningStatus && this.state.lightningStatus.available);
    const addressPlaceholder = this.getAddressPlaceholder(bitcoinNetwork);

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
              <Button basic onClick={() => this.handleGenerateBlock()} title='Generate one regtest block' disabled={!canGenerateBlocks}>
                <Icon name='cube' />
                Generate Block
              </Button>
              <Button as={Link} to="/services/bitcoin/payments" basic title='Open wallet payments manager'>
                <Icon name='credit card outline' />
                Payments
              </Button>
            </div>
          </div>
          <p style={{ marginTop: '0.5em', color: '#666' }}>
            Simple payment flow first. Advanced UTXO controls are tucked behind additional interaction.
          </p>
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
            ? 'optional (not configured)'
            : (this.state.lightningStatus && this.state.lightningStatus.status === 'STUB')
              ? 'stub (UI testing)'
              : (this.state.lightningStatus && this.state.lightningStatus.status ? this.state.lightningStatus.status : 'unknown')}</div>
          <div style={{ color: '#666' }}>{this.state.lightningStatus && this.state.lightningStatus.message ? this.state.lightningStatus.message : ''}</div>
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
                  <div><strong>Balance:</strong> {this.satsToBTC(this.state.lookupResult.balanceSats || 0)} BTC ({Number(this.state.lookupResult.balanceSats || 0).toLocaleString()} sats)</div>
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

        <Segment>
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
                (Beacon: {Number(this.state.bitcoinStatus.beacon.balanceSats || 0).toLocaleString()} sats)
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
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(this.state.faucetResult, null, 2)}</pre>
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
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(this.state.paymentResult, null, 2)}</pre>
            </Message>
          )}
        </Segment>

        <Segment>
          <Header as='h3'>Lightning Debug & Testing (Layer 2)</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge:</strong> create invoice, decode, and pay go through the Hub or external Lightning API.</p>
          {!lightningAvailable && (
            <Message info>
              <Message.Header>Lightning optional</Message.Header>
              <p>{(this.state.lightningStatus && this.state.lightningStatus.message) || 'Lightning is not configured on this Hub. Use Settings to add an external Lightning API URL if needed.'}</p>
            </Message>
          )}
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
              {this.state.blocks.map((block, idx) => (
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
                    <List.Description>{block.time ? new Date(Number(block.time) * 1000).toLocaleString() : 'time unavailable'}</List.Description>
                  </List.Content>
                </List.Item>
              ))}
            </List>
          )}

          <Header as='h4' style={{ marginTop: '1em' }}>Mempool Transactions ({this.state.transactions.length})</Header>
          {this.state.transactions.length === 0 ? (
            <p style={{ color: '#666' }}>No transaction data yet.</p>
          ) : (
            <List divided relaxed>
              {this.state.transactions.map((tx, idx) => (
                <List.Item key={tx.txid || tx.id || idx}>
                  <List.Content>
                    <List.Header>{this.trimHash(tx.txid || tx.id || '')}</List.Header>
                    <List.Description>
                      {tx.value != null ? `${tx.value} BTC` : (tx.amountSats != null ? `${tx.amountSats} sats` : 'amount unavailable')}
                    </List.Description>
                  </List.Content>
                </List.Item>
              ))}
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
                        <Table.Cell>{utxo.amount != null ? utxo.amount : (utxo.amountSats != null ? `${utxo.amountSats} sats` : '-')}</Table.Cell>
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
                  placeholder='https://hub.fabric.pub/services/bitcoin/payjoin'
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
