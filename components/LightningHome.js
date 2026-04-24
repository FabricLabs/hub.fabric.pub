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
      this.setState({ result: { error: 'Invoice amount must be greater than zero.' } });
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
    return (
      <div className="fade-in">
        <Segment loading={this.state.loading}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5em', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button as={Link} to="/services/bitcoin" basic size="small">
                <Icon name="arrow left" />
                Bitcoin
              </Button>
              <Header as="h2" style={{ margin: 0 }}>
                <Icon name="bolt" />
                <Header.Content>Lightning</Header.Content>
              </Header>
            </div>
            <Button basic size="small" onClick={() => this.refresh()}>
              <Icon name="refresh" />
              Refresh
            </Button>
          </div>
          <div style={{ marginTop: '0.6em' }}>
            <Label color={available ? 'green' : 'grey'} horizontal>{String(s.status || 'unavailable')}</Label>
            {s.node && s.node.alias ? <span style={{ color: '#666' }}>{s.node.alias}</span> : null}
          </div>
        </Segment>
        <Segment>
          <Header as="h3">Channels</Header>
          {this.state.channels.length === 0 ? (
            <p style={{ color: '#666' }}>No channels listed.</p>
          ) : (
            <Table compact="very" celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Peer</Table.HeaderCell>
                  <Table.HeaderCell>State</Table.HeaderCell>
                  <Table.HeaderCell>Capacity</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {this.state.channels.map((c, i) => (
                  <Table.Row key={`${c.short_channel_id || c.id || i}`}>
                    <Table.Cell><code>{String(c.peer_id || c.destination || '-').slice(0, 24)}</code></Table.Cell>
                    <Table.Cell>{c.state || c.status || '-'}</Table.Cell>
                    <Table.Cell>{c.capacity != null ? String(c.capacity) : '-'}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </Segment>
        <Segment>
          <Header as="h3">Invoices & Payments</Header>
          <Form>
            <Form.Group widths="equal">
              <Form.Field>
                <label>Create invoice amount (sats)</label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="500"
                  value={this.state.invoiceAmountSats}
                  onChange={(e) => this.setState({ invoiceAmountSats: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label>Invoice memo</label>
                <Input
                  placeholder="Shown to payer (optional)"
                  value={this.state.invoiceMemo}
                  onChange={(e) => this.setState({ invoiceMemo: e.target.value })}
                />
              </Form.Field>
            </Form.Group>
            <Button onClick={() => this.createInvoice()} disabled={!available}>
              <Icon name="add circle" />
              Create Invoice
            </Button>
            <Form.Field style={{ marginTop: '1em' }}>
              <label>Invoice (BOLT11)</label>
              <Form.TextArea
                rows={3}
                placeholder="lnbc..."
                value={this.state.invoiceInput}
                onChange={(e) => this.setState({ invoiceInput: e.target.value })}
              />
            </Form.Field>
            <Button basic onClick={() => this.decodeInvoice()} disabled={!available}>
              <Icon name="search" />
              Decode
            </Button>
            <Button color="green" onClick={() => this.payInvoice()} disabled={!available}>
              <Icon name="bolt" />
              Pay Invoice
            </Button>
          </Form>
          {this.state.result ? (
            <Message style={{ marginTop: '1em' }} negative={!!this.state.result.error} positive={!this.state.result.error}>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{JSON.stringify(this.state.result, null, 2)}</pre>
            </Message>
          ) : null}
        </Segment>
      </div>
    );
  }
}

module.exports = LightningHome;
