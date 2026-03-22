'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Form, Header, Icon, Message, Segment } = require('semantic-ui-react');
const { loadInvoices, createInvoice, deleteInvoice, addPaymentToInvoice } = require('../functions/invoiceStore');
const { getWalletContextFromIdentity, reserveNextReceiveAddress } = require('../functions/bitcoinClient');
const Invoice = require('./Invoice');
const { formatSatsDisplay } = require('../functions/formatSats');

/**
 * InvoiceListHome: create invoices and store them in localStorage (not global state).
 * Each invoice gets a fresh receive address from the user's wallet.
 */
class InvoiceListHome extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      invoices: loadInvoices(),
      amountSats: '',
      memo: '',
      label: '',
      creating: false,
      error: null
    };
  }

  refresh () {
    this.setState({ invoices: loadInvoices() });
  }

  async handleCreate () {
    const amountSats = Number(this.state.amountSats || 0);
    const memo = String(this.state.memo || '').trim();
    const label = String(this.state.label || '').trim();
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      this.setState({ error: 'Amount must be greater than 0 sats.' });
      return;
    }

    const identity = (this.props && this.props.identity) || {};
    const wallet = getWalletContextFromIdentity(identity);
    const network = (this.props.bitcoin && this.props.bitcoin.network)
      ? String(this.props.bitcoin.network).toLowerCase()
      : 'regtest';

    if (!wallet.walletId || !wallet.xpub) {
      this.setState({ error: 'Unlock an identity with xpub to create invoices.' });
      return;
    }

    this.setState({ creating: true, error: null });
    try {
      const reserved = reserveNextReceiveAddress(wallet, { network });
      const address = reserved && reserved.currentAddress
        ? reserved.currentAddress
        : null;

      if (!address) {
        this.setState({ error: 'Could not derive receive address. Check xpub and network.', creating: false });
        return;
      }

      const invoice = createInvoice({
        address,
        amountSats,
        memo,
        label: label || memo || `Invoice ${formatSatsDisplay(amountSats)} sats`,
        network
      });

      if (invoice) {
        this.setState({
          amountSats: '',
          memo: '',
          label: '',
          invoices: loadInvoices(),
          creating: false,
          error: null
        });
      } else {
        this.setState({ error: 'Failed to save invoice.', creating: false });
      }
    } catch (err) {
      this.setState({
        error: err && err.message ? err.message : String(err),
        creating: false
      });
    }
  }

  handleDelete (id) {
    if (deleteInvoice(id)) this.refresh();
  }

  render () {
    const { identity = {}, bitcoin = {} } = this.props;
    const network = (bitcoin.network && String(bitcoin.network).toLowerCase()) || 'regtest';
    const wallet = getWalletContextFromIdentity(identity);
    const hasWallet = !!(wallet.walletId && wallet.xpub);

    return (
      <div className='fade-in'>
        <Segment>
          <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
            <Button as={Link} to="/services/bitcoin" basic size="small">
              <Icon name="arrow left" />
              Back
            </Button>
            <Icon name='file alternate outline' />
            <Header.Content>Invoices</Header.Content>
          </Header>
          <p style={{ color: '#666' }}>
            Create payment requests and store them locally in your browser. Not published to global state.
          </p>
          <p style={{ color: '#888', fontSize: '0.9em' }}>
            Each invoice gets a fresh receive address from your wallet. Funds go to your identity.
          </p>
        </Segment>

        {!hasWallet && (
          <Message warning>
            <Message.Header>Identity required</Message.Header>
            <p>Unlock an identity with an xpub to create invoices. Your receive addresses are derived from your wallet.</p>
          </Message>
        )}

        {hasWallet && (
          <Segment>
            <Header as='h3'>Create invoice</Header>
            <Form>
              <Form.Input
                label='Amount (sats)'
                type='number'
                min='1'
                step='1'
                placeholder='1000'
                value={this.state.amountSats}
                onChange={(e) => this.setState({ amountSats: e.target.value })}
              />
              <Form.Input
                label='Label'
                placeholder='e.g. Coffee payment'
                value={this.state.label}
                onChange={(e) => this.setState({ label: e.target.value })}
              />
              <Form.Input
                label='Memo'
                placeholder='Optional note'
                value={this.state.memo}
                onChange={(e) => this.setState({ memo: e.target.value })}
              />
              <Button
                primary
                onClick={() => this.handleCreate()}
                loading={this.state.creating}
                disabled={this.state.creating}
              >
                <Icon name='plus' />
                Create invoice
              </Button>
            </Form>
            {this.state.error && (
              <Message negative style={{ marginTop: '1em' }}>{this.state.error}</Message>
            )}
          </Segment>
        )}

        <Segment>
          <Header as='h3'>My invoices</Header>
          {this.state.invoices.length === 0 ? (
            <p style={{ color: '#666' }}>No invoices yet. Create one above.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5em' }}>
              {this.state.invoices.map((inv) => (
                <div key={inv.id} style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1em', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                      <Invoice
                        invoiceId={inv.id}
                        address={inv.address}
                        amountSats={inv.amountSats}
                        network={inv.network || network}
                        label={inv.label || inv.memo || `Invoice ${formatSatsDisplay(inv.amountSats)} sats`}
                        memo={inv.memo}
                        txids={inv.txids || []}
                        identity={identity}
                        compact
                        onPaid={(txid) => {
                          if (inv.id && txid) addPaymentToInvoice(inv.id, txid);
                          this.refresh();
                        }}
                      />
                    </div>
                    <Button
                      basic
                      color='red'
                      size='small'
                      icon='trash'
                      onClick={() => this.handleDelete(inv.id)}
                      title='Delete invoice'
                    />
                  </div>
                  <div style={{ fontSize: '0.8em', color: '#999', marginTop: '0.25em' }}>
                    Created {inv.createdAt ? new Date(inv.createdAt).toLocaleString() : '-'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Segment>
      </div>
    );
  }
}

module.exports = InvoiceListHome;
