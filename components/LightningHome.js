'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Form, Header, Icon, Input, Label, Message, Segment, Table } = require('semantic-ui-react');
const {
  createLightningInvoice,
  decodeLightningInvoice,
  fetchLightningChannels,
  fetchLightningStatus,
  loadUpstreamSettings,
  payLightningInvoice
} = require('../functions/bitcoinClient');
const t = require('../locales/en');

const c = t.bitcoin.lightning;

class LightningHome extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: true,
      upstream: loadUpstreamSettings(),
      status: {},
      channels: [],
      invoiceAmountSats: '',
      invoiceMemo: '',
      invoiceInput: '',
      result: null
    };
  }

  async componentDidMount () {
    await this.refresh();
  }

  async refresh () {
    this.setState({ loading: true });
    const [status, channels] = await Promise.all([
      fetchLightningStatus(this.state.upstream).catch(() => ({})),
      fetchLightningChannels(this.state.upstream).catch(() => [])
    ]);
    const channelList = Array.isArray(channels) ? channels : (channels && Array.isArray(channels.channels) ? channels.channels : []);
    this.setState({ loading: false, status: status || {}, channels: channelList });
  }

  async createInvoice () {
    const amountSats = Math.round(Number(this.state.invoiceAmountSats || 0));
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      this.setState({ result: { error: c.invoiceAmountPositive } });
      return;
    }
    const identity = (this.props && this.props.identity) || {};
    try {
      const out = await createLightningInvoice(this.state.upstream, identity, { amountSats, memo: this.state.invoiceMemo });
      const bolt11 = String((out && (out.payment_request || out.invoice || out.bolt11)) || '').trim();
      this.setState({ result: out || {}, invoiceInput: bolt11 || this.state.invoiceInput });
      await this.refresh();
    } catch (error) {
      this.setState({ result: { error: error && error.message ? error.message : String(error) } });
    }
  }

  async decodeInvoice () {
    const invoice = String(this.state.invoiceInput || '').trim();
    if (!invoice) return;
    try {
      const out = await decodeLightningInvoice(this.state.upstream, invoice);
      this.setState({ result: out || {} });
    } catch (error) {
      this.setState({ result: { error: error && error.message ? error.message : String(error) } });
    }
  }

  async payInvoice () {
    const invoice = String(this.state.invoiceInput || '').trim();
    if (!invoice) return;
    const identity = (this.props && this.props.identity) || {};
    try {
      const out = await payLightningInvoice(this.state.upstream, identity, invoice);
      this.setState({ result: out || {} });
      await this.refresh();
    } catch (error) {
      this.setState({ result: { error: error && error.message ? error.message : String(error) } });
    }
  }

  render () {
    const s = this.state.status || {};
    const available = !!(s.available === true || s.status === 'OK' || s.status === 'RUNNING' || s.status === 'STUB');
    const statusText = s.status
      ? (c.statusLabels[String(s.status)] || String(s.status))
      : t.common.states.unavailable;
    return (
      <div className="fade-in">
        <Segment loading={this.state.loading}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5em', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button as={Link} to="/services/bitcoin" basic size="small" title={t.bitcoin.shared.backToBitcoinTitle}>
                <Icon name="arrow left" />
                {t.bitcoin.shared.backToBitcoin}
              </Button>
              <Header as="h2" style={{ margin: 0 }}>
                <Icon name="bolt" />
                <Header.Content>{c.title}</Header.Content>
              </Header>
            </div>
            <Button basic size="small" onClick={() => this.refresh()}>
              <Icon name="refresh" />
              {t.common.actions.refresh}
            </Button>
          </div>
          <div style={{ marginTop: '0.6em' }}>
            <Label color={available ? 'green' : 'grey'} horizontal>{statusText}</Label>
            {s.node && s.node.alias ? <span style={{ color: '#666' }}>{s.node.alias}</span> : null}
          </div>
        </Segment>
        <Segment>
          <Header as="h3">{c.channels}</Header>
          {this.state.channels.length === 0 ? (
            <p style={{ color: '#666' }}>{c.noChannels}</p>
          ) : (
            <Table compact="very" celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{c.peer}</Table.HeaderCell>
                  <Table.HeaderCell>{c.state}</Table.HeaderCell>
                  <Table.HeaderCell>{c.capacity}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {this.state.channels.map((ch, i) => (
                  <Table.Row key={`${ch.short_channel_id || ch.id || i}`}>
                    <Table.Cell><code>{String(ch.peer_id || ch.destination || t.common.none).slice(0, 24)}</code></Table.Cell>
                    <Table.Cell>{ch.state || ch.status || t.common.none}</Table.Cell>
                    <Table.Cell>{ch.capacity != null ? String(ch.capacity) : t.common.none}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </Segment>
        <Segment>
          <Header as="h3">{c.invoicesTitle}</Header>
          <Form>
            <Form.Group widths="equal">
              <Form.Field>
                <label htmlFor="lightning-invoice-amount">{c.invoiceAmount}</label>
                <Input
                  id="lightning-invoice-amount"
                  type="number"
                  min="1"
                  step="1"
                  value={this.state.invoiceAmountSats}
                  onChange={(e) => this.setState({ invoiceAmountSats: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor="lightning-invoice-memo">{c.invoiceMemo}</label>
                <Input
                  id="lightning-invoice-memo"
                  placeholder={c.invoiceMemoPlaceholder}
                  value={this.state.invoiceMemo}
                  onChange={(e) => this.setState({ invoiceMemo: e.target.value })}
                />
              </Form.Field>
            </Form.Group>
            <Button onClick={() => this.createInvoice()} disabled={!available}>
              <Icon name="add circle" />
              {c.createInvoice}
            </Button>
            <Form.Field style={{ marginTop: '1em' }}>
              <label htmlFor="lightning-invoice-bolt11">{c.invoiceInput}</label>
              <Form.TextArea
                id="lightning-invoice-bolt11"
                rows={3}
                placeholder="lnbc…"
                value={this.state.invoiceInput}
                onChange={(e) => this.setState({ invoiceInput: e.target.value })}
              />
            </Form.Field>
            <Button basic onClick={() => this.decodeInvoice()} disabled={!available}>
              <Icon name="search" />
              {c.decode}
            </Button>
            <Button color="green" onClick={() => this.payInvoice()} disabled={!available}>
              <Icon name="bolt" />
              {c.pay}
            </Button>
          </Form>
          {this.state.result ? (
            <Message style={{ marginTop: '1em' }} negative={!!this.state.result.error} positive={!this.state.result.error}>
              <Message.Header>{this.state.result.error ? c.failed : c.response}</Message.Header>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{JSON.stringify(this.state.result, null, 2)}</pre>
            </Message>
          ) : null}
        </Segment>
      </div>
    );
  }
}

module.exports = LightningHome;
