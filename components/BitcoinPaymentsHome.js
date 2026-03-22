'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Form, Header, Icon, Label, Message, Segment, Table } = require('semantic-ui-react');
const {
  decodeLightningInvoice,
  fetchPayments,
  fetchPayjoinSessions,
  fetchReceiveAddress,
  fetchUTXOs,
  fetchWalletSummary,
  fetchWalletTransactions,
  getWalletContextFromIdentity,
  loadUpstreamSettings,
  payLightningInvoice,
  reserveNextReceiveAddress,
  sendPayment,
  submitPayjoinProposal
} = require('../functions/bitcoinClient');
const { formatSatsDisplay } = require('../functions/formatSats');
const txContractLabels = require('../functions/txContractLabels');
const invoiceStore = require('../functions/invoiceStore');
const QrScannerModal = require('./QrScannerModal');

class BitcoinPaymentsHome extends React.Component {
  constructor (props) {
    super(props);
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
      decodedInvoice: null
    };
  }

  componentDidMount () {
    this.refresh();
  }

  componentDidUpdate (prevProps) {
    const prev = prevProps && prevProps.identity && prevProps.identity.xpub;
    const next = this.props && this.props.identity && this.props.identity.xpub;
    if (prev !== next) this.refresh();
  }

  async refresh () {
    const identity = (this.props && this.props.identity) || {};
    const wallet = getWalletContextFromIdentity(identity);
    const upstream = this.state.upstream;
    const network = (this.props.bitcoin && this.props.bitcoin.network) ? String(this.props.bitcoin.network).toLowerCase() : 'regtest';
    this.setState({ loading: true, error: null, wallet });

    try {
      const [summary, address, utxos, payments, payjoinSessions, transactions] = await Promise.all([
        fetchWalletSummary(upstream, wallet, { network }).catch(() => ({})),
        fetchReceiveAddress(upstream, wallet, { network }).catch(() => ''),
        fetchUTXOs(upstream, wallet).catch(() => []),
        fetchPayments(upstream, wallet, { limit: 50 }).catch(() => []),
        fetchPayjoinSessions(upstream, { limit: 50, includeExpired: true }).catch(() => []),
        fetchWalletTransactions(upstream, wallet, { limit: 50, network }).catch(() => [])
      ]);
      const invLabels = txContractLabels.buildInvoiceTxLabels(invoiceStore.loadInvoices());
      const txRows = Array.isArray(transactions)
        ? txContractLabels.mergeServerAndLocalLabels(transactions, invLabels)
        : [];

      this.setState({
        loading: false,
        summary,
        receiveAddress: address || summary.address || '',
        utxos: Array.isArray(utxos) ? utxos : [],
        payments: Array.isArray(payments) ? payments : [],
        payjoinSessions: Array.isArray(payjoinSessions) ? payjoinSessions : [],
        transactions: txRows
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

    try {
      const result = await sendPayment(this.state.upstream, wallet, {
        to,
        amountSats,
        memo: this.state.memo
      });
      this.setState({ result, amountSats: '', memo: '' });
      await this.refresh();
    } catch (error) {
      this.setState({ result: { error: error && error.message ? error.message : String(error) } });
    }
  }

  handleNextReceiveAddress () {
    const network = (this.props.bitcoin && this.props.bitcoin.network) ? String(this.props.bitcoin.network).toLowerCase() : 'regtest';
    const next = reserveNextReceiveAddress(this.state.wallet || {}, { network });
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

  async handleSubmitPayjoinProposal () {
    const sessionId = String(this.state.payjoinSessionId || '').trim();
    const psbt = String(this.state.payjoinPsbt || '').trim();
    if (!sessionId) return this.setState({ payjoinResult: { error: 'Payjoin session ID is required.' } });
    if (!psbt) return this.setState({ payjoinResult: { error: 'PSBT is required for a Payjoin proposal.' } });

    try {
      const result = await submitPayjoinProposal(this.state.upstream, sessionId, { psbt });
      this.setState({ payjoinResult: result, payjoinPsbt: '' });
      await this.refresh();
    } catch (error) {
      this.setState({ payjoinResult: { error: error && error.message ? error.message : String(error) } });
    }
  }

  render () {
    const wallet = this.state.wallet || {};
    const summary = this.state.summary || {};
    const balanceSats = summary && Number.isFinite(summary.balanceSats) ? summary.balanceSats : (summary && summary.summary && summary.summary.trusted != null ? Math.round(Number(summary.summary.trusted) * 100000000) : null);
    const balanceDisplay = balanceSats != null
      ? (balanceSats >= 100000000 ? `${(balanceSats / 100000000).toFixed(4)} BTC` : `${formatSatsDisplay(balanceSats)} sats`)
      : 'n/a';
    return (
      <div className='fade-in'>
        <Segment loading={this.state.loading}>
          <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
            <Button as={Link} to="/services/bitcoin" basic size="small">
              <Icon name="arrow left" />
              Back
            </Button>
            <Icon name='credit card outline' />
            <Header.Content>Bitcoin Payments</Header.Content>
            <Button as={Link} to="/services/bitcoin/invoices" basic size="small" style={{ marginLeft: '0.5em' }}>
              <Icon name='file alternate outline' />
              Invoices
            </Button>
            <Button as={Link} to="/services/bitcoin/resources" basic size="small" title="HTTP resources and L1 payment verification">
              <Icon name='sitemap' />
              Resources
            </Button>
          </Header>
          {this.state.error && <Message negative content={this.state.error} />}
          <div style={{ marginBottom: '1em' }}>
            <strong>Balance:</strong> {balanceDisplay}
            {' '}
            <span style={{ color: '#666', fontSize: '0.9em' }}>
              (Wallet: <code>{wallet.walletId ? `${String(wallet.walletId).slice(0, 12)}…` : 'unavailable'}</code>)
            </span>
          </div>

          <Header as='h3' dividing>Wallet Controls</Header>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5em', marginBottom: '1em' }}>
            <Segment>
              <Header as='h4'>
                <Icon name='qrcode' />
                Request Payment
              </Header>
              <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.5em' }}>Share your receive address to receive Bitcoin.</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                <code style={{ flex: '1 1 200px', wordBreak: 'break-all', fontSize: '0.85em' }} title={this.state.receiveAddress}>
                  {this.state.receiveAddress || '—'}
                </code>
                <Button size="small" icon="copy" title="Copy address" onClick={() => this.handleCopyAddress()} disabled={!this.state.receiveAddress} />
                <Button size="small" basic icon="refresh" title="New address" onClick={() => this.handleNextReceiveAddress()} disabled={!wallet.xpub} />
              </div>
              <Button as={Link} to="/services/bitcoin/invoices" basic size="small" style={{ marginTop: '0.5em' }}>
                <Icon name='file alternate outline' />
                Create Invoice
              </Button>
            </Segment>

            <Segment style={{ marginTop: 0 }}>
              <Header as='h4'>
                <Icon name='send' />
                Make Payment
              </Header>
              <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.5em' }}>
                Send Bitcoin on-chain or pay a Lightning invoice. Scan a QR code or paste address/invoice.
              </p>
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
                      icon="camera"
                      title="Scan QR code"
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
                {!this.state.lightningInvoice && (
                  <Form.Group widths='equal'>
                    <Form.Input label='Amount (sats)' type='number' min='1' step='1' placeholder='1000' value={this.state.amountSats} onChange={(e) => { this.setState({ amountSats: e.target.value, result: null }); }} />
                    <Form.Input label='Memo' placeholder='Optional' value={this.state.memo} onChange={(e) => this.setState({ memo: e.target.value })} />
                  </Form.Group>
                )}
                {this.state.lightningInvoice ? (
                  <Button primary onClick={() => this.handlePayLightning()}>
                    <Icon name='bolt' />
                    Pay Lightning
                  </Button>
                ) : (
                  <Button primary onClick={() => this.handleSend()} disabled={!this.state.to || !this.state.amountSats}>
                    <Icon name='send' />
                    Send On-Chain
                  </Button>
                )}
              </Form>
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
            </Segment>
          </div>
        </Segment>

        <Segment>
          <Header as='h3'>Transactions</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Client (xpub):</strong> transactions associated with your wallet.</p>
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
                      <Table.Cell>{amt != null ? `${Number(amt).toFixed(8)} BTC` : '-'}</Table.Cell>
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
        </Segment>

        <Segment>
          <Header as='h3'>Mempool Payments</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge (Hub node):</strong> mempool transactions.</p>
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
        </Segment>

        <Segment>
          <Header as='h3'>Payjoin Proposals (BIP77)</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge:</strong> Hub Payjoin service.</p>
          <p style={{ color: '#666' }}>
            Submit a sender PSBT against an active Payjoin session generated by the deposit flow.
          </p>
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
          <Header as='h4' style={{ marginTop: '1em' }}>Payjoin sessions &amp; proposals</Header>
          <p style={{ color: '#666', marginBottom: '0.75em' }}>
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
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          )}
        </Segment>

        <Segment>
          <Header as='h3'>UTXOs</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge (Hub node):</strong> unspent outputs for wallet.</p>
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
