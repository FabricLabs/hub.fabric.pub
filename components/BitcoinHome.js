'use strict';

const React = require('react');
const {
  Button,
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
  createLightningInvoice,
  decodeLightningInvoice,
  fetchExplorerData,
  fetchReceiveAddress,
  fetchUTXOs,
  fetchWalletSummary,
  getWalletContextFromIdentity,
  loadUpstreamSettings,
  payLightningInvoice,
  reserveNextReceiveAddress,
  saveUpstreamSettings,
  sendPayment
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
      paymentResult: null,
      lightningResult: null
    };
  }

  componentDidMount () {
    this.refresh();
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

    const summaryTask = fetchWalletSummary(upstream, wallet).catch(() => ({}));
    const addressTask = fetchReceiveAddress(upstream, wallet).catch(() => '');
    const explorerTask = fetchExplorerData(upstream).catch(() => ({ blocks: [], transactions: [] }));
    const utxoTask = fetchUTXOs(upstream, wallet).catch(() => []);

    try {
      const [summary, address, explorer, utxos] = await Promise.all([summaryTask, addressTask, explorerTask, utxoTask]);
      const balanceSats = Number(summary.balanceSats != null ? summary.balanceSats : (summary.balance || 0));
      const confirmedSats = Number(summary.confirmedSats != null ? summary.confirmedSats : balanceSats);
      const unconfirmedSats = Number(summary.unconfirmedSats || 0);

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
        blocks: Array.isArray(explorer.blocks) ? explorer.blocks.slice(0, 10) : [],
        transactions: Array.isArray(explorer.transactions) ? explorer.transactions.slice(0, 10) : [],
        utxos: Array.isArray(utxos) ? utxos : []
      });
    } catch (error) {
      this.setState({
        loading: false,
        refreshing: false,
        error: error && error.message ? error.message : String(error)
      });
    }
  }

  handleNextReceiveAddress () {
    const next = reserveNextReceiveAddress(this.state.wallet);
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

  render () {
    const wallet = this.state.wallet;
    const hasUpstream = !!(this.state.upstream.explorerBaseUrl || this.state.upstream.paymentsBaseUrl || this.state.upstream.lightningBaseUrl);

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
          <Header as='h3'>Wallet</Header>
          <div><strong>Master wallet:</strong> <code>{wallet.walletId || 'not available'}</code></div>
          <div><strong>Identity fingerprint:</strong> <code>{wallet.fingerprint || 'not available'}</code></div>
          <div><strong>Private key in session:</strong> {wallet.hasPrivateKey ? 'yes' : 'no (watch-only mode)'}</div>
          <div style={{ marginTop: '0.75em' }}><strong>Balance:</strong> {this.satsToBTC(wallet.balanceSats)} BTC</div>
          <div><strong>Confirmed:</strong> {this.satsToBTC(wallet.confirmedSats)} BTC</div>
          <div><strong>Unconfirmed:</strong> {this.satsToBTC(wallet.unconfirmedSats)} BTC</div>
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
        </Segment>

        <Segment>
          <Header as='h3'>Send Payment (Layer 1)</Header>
          <Form>
            <Form.Field>
              <label>Recipient address</label>
              <Input
                placeholder='bc1...'
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
            <Button onClick={() => this.handleCreateLightningInvoice()}>
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
            <Button basic onClick={() => this.handleDecodeLightningInvoice()}>
              <Icon name='search' />
              Decode
            </Button>
            <Button color='green' onClick={() => this.handlePayLightningInvoice()}>
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
                        <a href={`/services/bitcoin/blocks/${encodeURIComponent(block.hash || block.id)}`}>
                          #{block.height != null ? block.height : 'n/a'} - {this.trimHash(block.hash || block.id || '')}
                        </a>
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

          <Header as='h4' style={{ marginTop: '1em' }}>Recent Transactions</Header>
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
                  placeholder='https://explorer.example.com'
                  value={this.state.upstreamDraft.explorerBaseUrl}
                  onChange={(e) => this.setState({ upstreamDraft: { ...this.state.upstreamDraft, explorerBaseUrl: e.target.value } })}
                />
              </Form.Field>
              <Form.Field>
                <label>Payments API base URL</label>
                <Input
                  placeholder='https://payments.example.com'
                  value={this.state.upstreamDraft.paymentsBaseUrl}
                  onChange={(e) => this.setState({ upstreamDraft: { ...this.state.upstreamDraft, paymentsBaseUrl: e.target.value } })}
                />
              </Form.Field>
              <Form.Field>
                <label>Lightning API base URL</label>
                <Input
                  placeholder='https://lightning.example.com'
                  value={this.state.upstreamDraft.lightningBaseUrl}
                  onChange={(e) => this.setState({ upstreamDraft: { ...this.state.upstreamDraft, lightningBaseUrl: e.target.value } })}
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
