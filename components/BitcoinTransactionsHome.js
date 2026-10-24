'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Form, Header, Icon, Input, Label, Message, Segment, Table } = require('semantic-ui-react');
const {
  fetchPayments,
  sendPayment,
  fetchWalletSummary,
  fetchWalletTransactions,
  getSpendWalletContext,
  loadUpstreamSettings
} = require('../functions/bitcoinClient');
const txContractLabels = require('../functions/txContractLabels');
const invoiceStore = require('../functions/invoiceStore');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const {
  loadFederationSpendingPrefs,
  mergePaymentMemoWithFederation,
  subscribeFederationSpendingPrefs
} = require('../functions/federationSpendingPrefs');
const FederationWalletMultisigPanel = require('./FederationWalletMultisigPanel');
const { SATS_PER_BTC } = require('../constants');
const t = require('../locales/en');

const c = t.bitcoin.transactions;

function btcText (value) {
  if (value == null || !Number.isFinite(Number(value))) return t.common.none;
  return t.common.sats(Math.round(Number(value) * SATS_PER_BTC));
}

class BitcoinTransactionsHome extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: true,
      error: null,
      upstream: loadUpstreamSettings(),
      wallet: {},
      summary: {},
      transactions: [],
      rawPayments: [],
      lastUpdatedAt: 0,
      paymentTo: '',
      paymentAmountSats: '',
      paymentMemo: '',
      paymentResult: null,
      recordFederationContext: false,
      spendingPrefsTick: 0
    };
    this._refreshTimer = null;
    this._fedPrefsUnsub = null;
  }

  async componentDidMount () {
    await this.refresh();
    this._refreshTimer = setInterval(() => {
      this.refresh().catch(() => {});
    }, 10000);
  }

  componentWillUnmount () {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  }

  async componentDidUpdate (prevProps) {
    const prevId = String(((prevProps && prevProps.identity) || {}).id || '');
    const nextId = String(((this.props && this.props.identity) || {}).id || '');
    if (prevId !== nextId) await this.refresh();
  }

  async refresh () {
    const identity = (this.props && this.props.identity) || {};
    const wallet = getSpendWalletContext(identity);
    const upstream = {
      ...this.state.upstream,
      hubAdminToken: readHubAdminTokenFromBrowser(this.props && this.props.adminToken) || ''
    };
    const network = (this.props && this.props.bitcoin && this.props.bitcoin.network)
      ? String(this.props.bitcoin.network).toLowerCase()
      : 'regtest';
    this.setState({ loading: true, error: null, wallet });

    try {
      const [summary, transactions, payments] = await Promise.all([
        fetchWalletSummary(upstream, wallet, { network }).catch(() => ({})),
        fetchWalletTransactions(upstream, wallet, { limit: 100, network }).catch(() => []),
        fetchPayments(upstream, wallet, { limit: 100, network }).catch(() => [])
      ]);
      const invLabels = txContractLabels.buildInvoiceTxLabels(invoiceStore.loadInvoices());
      const txRows = Array.isArray(transactions)
        ? txContractLabels.mergeServerAndLocalLabels(transactions, invLabels)
        : [];
      const paymentRows = Array.isArray(payments) ? payments : [];
      this.setState({
        loading: false,
        summary: summary && typeof summary === 'object' ? summary : {},
        transactions: txRows,
        rawPayments: paymentRows,
        lastUpdatedAt: Date.now()
      });
    } catch (error) {
      this.setState({
        loading: false,
        error: error && error.message ? error.message : String(error)
      });
    }
  }

  _hubAdminToken () {
    return readHubAdminTokenFromBrowser(this.props && this.props.adminToken);
  }

  async handleSendPayment () {
    const paymentTo = String(this.state.paymentTo || '').trim();
    const paymentAmountSats = Number(this.state.paymentAmountSats || 0);
    if (!paymentTo) {
      this.setState({ paymentResult: { error: t.bitcoin.home.errors.recipientRequired } });
      return;
    }
    if (!Number.isFinite(paymentAmountSats) || paymentAmountSats <= 0) {
      this.setState({ paymentResult: { error: t.bitcoin.home.errors.amountPositive } });
      return;
    }

    const adminToken = this._hubAdminToken();
    if (!adminToken) {
      this.setState({
        paymentResult: {
          error: t.bitcoin.home.errors.adminSpend
        }
      });
      return;
    }

    try {
      const prefs = loadFederationSpendingPrefs();
      const memo = mergePaymentMemoWithFederation(
        this.state.paymentMemo,
        prefs,
        !!this.state.recordFederationContext
      );
      const result = await sendPayment(this.state.upstream, this.state.wallet, {
        to: paymentTo,
        amountSats: paymentAmountSats,
        memo,
        adminToken
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

  render () {
    const summary = this.state.summary || {};
    const balanceSats = Number(summary.balanceSats != null ? summary.balanceSats : (summary.balance || 0));
    const confirmedSats = Number(summary.confirmedSats != null ? summary.confirmedSats : balanceSats);
    const unconfirmedSats = Number(summary.unconfirmedSats || 0);
    const lastUpdated = this.state.lastUpdatedAt
      ? new Date(this.state.lastUpdatedAt).toLocaleTimeString()
      : t.common.none;

    return (
      <div className="fade-in">
        <Segment loading={this.state.loading}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75em', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button as={Link} to="/services/bitcoin" basic size="small" title={t.bitcoin.shared.backToBitcoinTitle}>
                <Icon name="arrow left" />
                {t.bitcoin.shared.backToBitcoin}
              </Button>
              <Header as="h2" style={{ margin: 0 }}>
                <Icon name="exchange" />
                <Header.Content>{c.title}</Header.Content>
              </Header>
            </div>
            <Button basic size="small" onClick={() => this.refresh()}>
              <Icon name="refresh" />
              {t.common.actions.refresh}
            </Button>
          </div>

          {this.state.error ? <Message negative style={{ marginTop: '0.75em' }} content={this.state.error} /> : null}

          <Message info size="small" style={{ marginTop: '0.85em' }}>
            <div><strong>{c.yourWallet}</strong> {t.common.sats(balanceSats)}</div>
            <div style={{ marginTop: '0.2em', color: '#555' }}>
              {c.breakdown(t.common.sats(confirmedSats), t.common.sats(unconfirmedSats), lastUpdated)}
            </div>
          </Message>
        </Segment>

        <FederationWalletMultisigPanel
          adminToken={this.props.adminToken}
          recordFederationContext={this.state.recordFederationContext}
          onRecordFederationContextChange={(v) => this.setState({ recordFederationContext: !!v })}
          spendingPrefsTick={this.state.spendingPrefsTick}
        />

        <Segment>
          <Header as="h3">{c.sendTitle}</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>{c.sendIntro}</p>
          <Form>
            <Form.Group widths="equal">
              <Form.Field>
                <label htmlFor="tx-send-to">{c.recipient}</label>
                <Input
                  id="tx-send-to"
                  placeholder={c.recipientPlaceholder}
                  value={this.state.paymentTo}
                  onChange={(e) => this.setState({ paymentTo: e.target.value })}
                />
              </Form.Field>
              <Form.Field width={4}>
                <label htmlFor="tx-send-amount">{c.amount}</label>
                <Input
                  id="tx-send-amount"
                  type="number"
                  min="1"
                  step="1"
                  value={this.state.paymentAmountSats}
                  onChange={(e) => this.setState({ paymentAmountSats: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor="tx-send-memo">{c.memo}</label>
                <Input
                  id="tx-send-memo"
                  placeholder={c.memoPlaceholder}
                  value={this.state.paymentMemo}
                  onChange={(e) => this.setState({ paymentMemo: e.target.value })}
                />
              </Form.Field>
            </Form.Group>
            <Button primary onClick={() => this.handleSendPayment()}>
              <Icon name="send" />
              {c.send}
            </Button>
          </Form>
          {this.state.paymentResult ? (
            <Message
              style={{ marginTop: '1em' }}
              negative={!!this.state.paymentResult.error}
              positive={!this.state.paymentResult.error}
            >
              <Message.Header>{this.state.paymentResult.error ? c.sendFailed : c.sent}</Message.Header>
              {!this.state.paymentResult.error ? (() => {
                const pr = this.state.paymentResult;
                const txid = (pr && pr.payment && pr.payment.txid) || (pr && pr.txid);
                return txid ? (
                  <p style={{ marginTop: '0.5em' }}>
                    <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(txid))}`}>{t.bitcoin.shared.viewTransaction}</Link>
                  </p>
                ) : null;
              })() : null}
              {this.state.paymentResult.error ? <p>{this.state.paymentResult.error}</p> : null}
              <details className="hub-developer-details">
                <summary>{t.common.developerDetails}</summary>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(this.state.paymentResult, null, 2)}</pre>
              </details>
            </Message>
          ) : null}
        </Segment>

        <Segment>
          <Header as="h3" id="fabric-btc-tx-client-h3">{c.activityTitle}</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>{c.activityIntro}</p>
          {this.state.transactions.length === 0 ? (
            <p style={{ color: '#666' }}>{c.activityEmpty}</p>
          ) : (
            <Table compact="very" celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{c.txid}</Table.HeaderCell>
                  <Table.HeaderCell>{c.contract}</Table.HeaderCell>
                  <Table.HeaderCell>{c.amountHeader}</Table.HeaderCell>
                  <Table.HeaderCell>{c.confirmations}</Table.HeaderCell>
                  <Table.HeaderCell>{c.time}</Table.HeaderCell>
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
                              {`${tx.txid.slice(0, 8)}...${tx.txid.slice(-8)}`}
                            </code>
                          </Link>
                        ) : <code>{t.common.none}</code>}
                      </Table.Cell>
                      <Table.Cell>
                        {tx.fabricContract && tx.fabricContract.label ? (
                          <Label size="small" color="blue" title={JSON.stringify(tx.fabricContract.meta || {})}>
                            {tx.fabricContract.label}
                          </Label>
                        ) : <span style={{ color: '#999' }}>{t.common.none}</span>}
                      </Table.Cell>
                      <Table.Cell>
                        {amt != null ? btcText(amt) : t.common.none}
                        {isOutgoing ? <Label size="mini" color="orange" style={{ marginLeft: '0.35em' }}>{c.sentLabel}</Label> : null}
                        {isIncoming ? <Label size="mini" color="green" style={{ marginLeft: '0.35em' }}>{c.receivedLabel}</Label> : null}
                      </Table.Cell>
                      <Table.Cell>
                        {tx.confirmations != null ? (
                          <>
                            {tx.confirmations}
                            {Number(tx.confirmations) === 0 ? (
                              <Label size="mini" color="orange" style={{ marginLeft: '0.35em' }}>{t.bitcoin.shared.unconfirmed}</Label>
                            ) : null}
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
        </Segment>

        <Segment>
          <Header as="h3" id="fabric-btc-tx-live-h3">{c.liveTitle}</Header>
          <p style={{ color: '#666', marginBottom: '0.5em' }}>{c.liveIntro}</p>
          {this.state.rawPayments.length === 0 ? (
            <p style={{ color: '#666' }}>{c.liveEmpty}</p>
          ) : (
            <Table compact="very" celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{c.txid}</Table.HeaderCell>
                  <Table.HeaderCell>{c.fee}</Table.HeaderCell>
                  <Table.HeaderCell>{c.value}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {this.state.rawPayments.map((p, idx) => (
                  <Table.Row key={`${p.txid || 'tx'}:${idx}`}>
                    <Table.Cell>
                      {p.txid ? (
                        <Link to={`/services/bitcoin/transactions/${encodeURIComponent(p.txid)}`}>
                          <code style={{ fontSize: '0.85em' }} title={p.txid}>
                            {`${p.txid.slice(0, 8)}...${p.txid.slice(-8)}`}
                          </code>
                        </Link>
                      ) : <code>{t.common.none}</code>}
                    </Table.Cell>
                    <Table.Cell>{p.fee != null ? btcText(Math.abs(Number(p.fee))) : t.common.none}</Table.Cell>
                    <Table.Cell>{p.value != null ? btcText(p.value) : t.common.none}</Table.Cell>
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

module.exports = BitcoinTransactionsHome;
