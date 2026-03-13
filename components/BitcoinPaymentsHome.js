'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Form, Header, Icon, Message, Segment, Table } = require('semantic-ui-react');
const {
  fetchPayments,
  fetchPayjoinSessions,
  fetchUTXOs,
  fetchWalletSummary,
  fetchWalletTransactions,
  getWalletContextFromIdentity,
  loadUpstreamSettings,
  sendPayment,
  submitPayjoinProposal
} = require('../functions/bitcoinClient');

class BitcoinPaymentsHome extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: true,
      error: null,
      upstream: loadUpstreamSettings(),
      wallet: null,
      summary: {},
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
      transactions: []
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
      const [summary, utxos, payments, payjoinSessions, transactions] = await Promise.all([
        fetchWalletSummary(upstream, wallet, { network }).catch(() => ({})),
        fetchUTXOs(upstream, wallet).catch(() => []),
        fetchPayments(upstream, wallet, { limit: 50 }).catch(() => []),
        fetchPayjoinSessions(upstream, { limit: 25 }).catch(() => []),
        fetchWalletTransactions(upstream, wallet, { limit: 50, network }).catch(() => [])
      ]);
      this.setState({
        loading: false,
        summary,
        utxos: Array.isArray(utxos) ? utxos : [],
        payments: Array.isArray(payments) ? payments : [],
        payjoinSessions: Array.isArray(payjoinSessions) ? payjoinSessions : [],
        transactions: Array.isArray(transactions) ? transactions : []
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
    return (
      <div className='fade-in'>
        <Segment loading={this.state.loading}>
          <Header as='h2'>
            <Icon name='credit card outline' />
            <Header.Content>Bitcoin Payments</Header.Content>
          </Header>
          <p>Manage payments for the currently unlocked identity wallet.</p>
          <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Client:</strong> wallet id, fingerprint. <strong>Bridge:</strong> balance, payments, UTXOs (Hub node).</p>
          {this.state.error && <Message negative content={this.state.error} />}
          <div><strong>Wallet ID:</strong> <code>{wallet.walletId || 'unavailable'}</code></div>
          <div><strong>Fingerprint:</strong> <code>{wallet.fingerprint || 'unavailable'}</code></div>
          <div><strong>Balance:</strong> {summary && summary.summary && summary.summary.trusted != null ? `${summary.summary.trusted} BTC` : 'n/a'}</div>
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
                      <Table.Cell>{amt != null ? `${Number(amt).toFixed(8)} BTC` : '-'}</Table.Cell>
                      <Table.Cell>{tx.confirmations != null ? tx.confirmations : '-'}</Table.Cell>
                      <Table.Cell>{dateStr}</Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          )}
        </Segment>

        <Segment>
          <Header as='h3'>Send Payment</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}><strong>Bridge:</strong> executed by Hub node wallet.</p>
          <Form>
            <Form.Input label='Recipient' value={this.state.to} onChange={(e) => this.setState({ to: e.target.value })} placeholder='bcrt1...' />
            <Form.Group widths='equal'>
              <Form.Input label='Amount (sats)' type='number' min='1' step='1' value={this.state.amountSats} onChange={(e) => this.setState({ amountSats: e.target.value })} />
              <Form.Input label='Memo' value={this.state.memo} onChange={(e) => this.setState({ memo: e.target.value })} />
            </Form.Group>
            <Button primary onClick={() => this.handleSend()}>
              <Icon name='send' />
              Send
            </Button>
          </Form>
          {this.state.result && (
            <Message positive={!this.state.result.error} negative={!!this.state.result.error} style={{ marginTop: '1em' }}>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(this.state.result, null, 2)}</pre>
            </Message>
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
                    <Table.Cell><code>{p.txid || '-'}</code></Table.Cell>
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
          <Header as='h4' style={{ marginTop: '1em' }}>Active Payjoin Sessions</Header>
          {this.state.payjoinSessions.length === 0 ? (
            <p style={{ color: '#666' }}>No active Payjoin sessions discovered.</p>
          ) : (
            <Table compact='very' celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Session</Table.HeaderCell>
                  <Table.HeaderCell>Status</Table.HeaderCell>
                  <Table.HeaderCell>Address</Table.HeaderCell>
                  <Table.HeaderCell>Proposals</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {this.state.payjoinSessions.map((s, idx) => (
                  <Table.Row key={`${s.id || 's'}:${idx}`}>
                    <Table.Cell><code>{s.id || '-'}</code></Table.Cell>
                    <Table.Cell>{s.status || '-'}</Table.Cell>
                    <Table.Cell><code>{s.address || '-'}</code></Table.Cell>
                    <Table.Cell>{s.proposalCount != null ? s.proposalCount : '-'}</Table.Cell>
                  </Table.Row>
                ))}
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
                    <Table.Cell>{u.amount != null ? u.amount : (u.amountSats != null ? `${u.amountSats} sats` : '-')}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </Segment>
      </div>
    );
  }
}

module.exports = BitcoinPaymentsHome;
