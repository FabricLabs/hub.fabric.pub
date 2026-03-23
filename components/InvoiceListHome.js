'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Form, Header, Icon, List, Message, Segment } = require('semantic-ui-react');
const { loadInvoices, createInvoice, deleteInvoice, addPaymentToInvoice } = require('../functions/invoiceStore');
const {
  getNextReceiveWalletContext,
  reserveNextReceiveAddress
} = require('../functions/bitcoinClient');
const Invoice = require('./Invoice');
const { formatSatsDisplay } = require('../functions/formatSats');
const { buildTabPayerDemoUrl } = require('../functions/tabPayerDemoUrl');
const HubRegtestAdminTokenPanel = require('./HubRegtestAdminTokenPanel');
const BitcoinWalletBranchBar = require('./BitcoinWalletBranchBar');

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
    this._onInvoicesHashChange = () => this._syncInvoicesHashScroll();
  }

  _syncInvoicesHashScroll () {
    if (typeof window === 'undefined') return;
    const raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(raw);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  componentDidMount () {
    this._syncInvoicesHashScroll();
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', this._onInvoicesHashChange);
    }
  }

  componentDidUpdate (prevProps) {
    const prevXpub = prevProps && prevProps.identity && prevProps.identity.xpub;
    const nextXpub = this.props && this.props.identity && this.props.identity.xpub;
    if (prevXpub !== nextXpub) this.forceUpdate();
  }

  componentWillUnmount () {
    if (typeof window !== 'undefined') {
      window.removeEventListener('hashchange', this._onInvoicesHashChange);
    }
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
    const wallet = getNextReceiveWalletContext(identity);
    const network = (this.props.bitcoin && this.props.bitcoin.network)
      ? String(this.props.bitcoin.network).toLowerCase()
      : 'regtest';

    if (!wallet.walletId || !wallet.xpub) {
      this.setState({ error: 'Unlock an identity with xpub to create invoices.' });
      return;
    }

    this.setState({ creating: true, error: null });
    try {
      const reserved = reserveNextReceiveAddress(wallet, { network, identity });
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
        }, () => this._syncInvoicesHashScroll());
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
    const identity = (this.props && this.props.identity) || {};
    const bitcoin = (this.props && this.props.bitcoin && typeof this.props.bitcoin === 'object')
      ? this.props.bitcoin
      : {};
    const network = (bitcoin.network && String(bitcoin.network).toLowerCase()) || 'regtest';
    const wallet = getNextReceiveWalletContext(identity);
    const hasWallet = !!(wallet.walletId && wallet.xpub);

    return (
      <div className='fade-in'>
        <Segment>
          <section aria-labelledby="invoices-page-heading" aria-describedby="invoices-page-summary">
            <div
              role="banner"
              style={{
                position: 'sticky',
                top: '6.5rem',
                zIndex: 12,
                background: '#fff',
                paddingBottom: '0.35em',
                marginBottom: '0.25em',
                boxShadow: '0 1px 0 rgba(34, 36, 38, 0.15)'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.5em' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                  <Button as={Link} to="/services/bitcoin" basic size="small" aria-label="Back to Bitcoin home">
                    <Icon name="arrow left" aria-hidden="true" />
                    Back
                  </Button>
                  <Header as="h2" id="invoices-page-heading" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.35em' }}>
                    <Icon name="file alternate outline" aria-hidden="true" />
                    <Header.Content>Invoices</Header.Content>
                  </Header>
                </div>
                <div role="toolbar" aria-label="Account-to-account shortcuts" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center' }}>
                  <Button as={Link} to="/services/bitcoin/payments#fabric-payments-tab-demo" basic size="small" title="Payer tab walkthrough">
                    <Icon name="credit card outline" aria-hidden="true" />
                    Payments
                  </Button>
                  <Button as={Link} to="/services/bitcoin#fabric-bitcoin-faucet" basic size="small" title="Regtest: fund an address from the Hub wallet">
                    <Icon name="tint" aria-hidden="true" />
                    Faucet
                  </Button>
                  <Button as={Link} to="/services/bitcoin/resources" basic size="small" title="L1 verify and HTTP resources">
                    <Icon name="sitemap" aria-hidden="true" />
                    Resources
                  </Button>
                  <Button as={Link} to="/services/bitcoin#fabric-bitcoin-crowdfunding" basic size="small" title="Taproot campaign, ACP PSBT, Payjoin deposit to vault">
                    <Icon name="heart outline" aria-hidden="true" />
                    Crowdfund
                  </Button>
                </div>
              </div>
            </div>
            <p id="invoices-page-summary" style={{ color: '#666' }}>
              Create payment requests and store them locally in your browser. Not published to global state.
            </p>
          </section>
          <Message info size="small" id="fabric-invoices-tab-demo" style={{ marginBottom: '1em' }}>
            <Message.Header>Two-tab invoice payment (production walkthrough)</Message.Header>
            <List ordered relaxed style={{ margin: '0.35em 0 0', color: '#333' }}>
              <List.Item>
                <strong>Regtest funds:</strong> The Hub node wallet pays invoices (Make Payment / Pay Now). On{' '}
                <Link to="/services/bitcoin#fabric-bitcoin-regtest-toolbar">Bitcoin</Link>
                , use <strong>Generate Block</strong> (admin) until the Hub has spendable balance. Optional: open{' '}
                <Link to="/services/bitcoin#fabric-bitcoin-faucet">Faucet</Link>
                {' '}on the Bitcoin page — <strong>Use my receive address</strong>, <strong>Request from faucet</strong>, then <strong>Generate Block</strong> so your client balance (BIP44 account 0 under your identity) shows confirmed test coins.
              </List.Item>
              <List.Item>
                <strong>Tab 1 (receiver):</strong> Invoices use the next external address on{' '}
                <Link to="/settings/bitcoin-wallet">BIP44 account 0</Link> under your Fabric identity. Create an invoice and copy the address (or leave this tab open).
              </List.Item>
              <List.Item>
                <strong>Tab 2 (payer):</strong> On the invoice row, click <strong>Open payer tab (prefilled)</strong> (adds <code>payTo</code> and <code>payAmountSats</code>, scrolls to Make Payment). Or open{' '}
                <Link to="/services/bitcoin/payments#fabric-payments-tab-demo">Payments (full walkthrough)</Link>
                {' '}or{' '}
                <Link to="/services/bitcoin/payments#fabric-btc-make-payment-h4">jump to Make Payment</Link>
                {' '}and paste address and amount. Spends and receives both use account 0 under the same identity. On-chain send uses the Hub node wallet and needs your setup <strong>admin token</strong> (if missing, use the yellow <strong>Regtest: Hub admin token</strong> panel below or on Payments).
              </List.Item>
              <List.Item>
                <strong>Confirm:</strong> Return here — on the invoice card use <strong>Confirm payment</strong> with the txid, or verify via{' '}
                <Link to="/services/bitcoin/resources">Resources → L1 payment verification</Link>. The invoice list lives in <code>localStorage</code> for this site, so both tabs see the same rows.
              </List.Item>
              <List.Item>
                <strong>Desktop / delegation:</strong> If you use <strong>Log in with Fabric Hub (desktop)</strong>, manage tokens and open per-token audit under{' '}
                <Link to="/settings/security">Security &amp; delegation</Link>
                {' '}(REST <code>/sessions</code>).
              </List.Item>
            </List>
          </Message>
          <HubRegtestAdminTokenPanel
            network={(bitcoin.network && String(bitcoin.network).toLowerCase()) || 'regtest'}
            adminTokenProp={this.props && this.props.adminToken}
          />
          <BitcoinWalletBranchBar identity={identity} />
          <p style={{ color: '#888', fontSize: '0.9em' }}>
            Each invoice uses the next unused external address from your wallet path; used indices stay in the browser store.
            {' '}
            <Link to="/services/bitcoin/resources">L1 payment verification</Link>
            {' '}
            (txid + address + amount) lives under Bitcoin resources.
          </p>
        </Segment>

        {!hasWallet && (
          <Message warning>
            <p style={{ margin: 0 }}>
              <strong>Identity required</strong>
            </p>
            <p style={{ margin: '0.35em 0 0' }}>
              Unlock an identity with an xpub to create invoices. Your receive addresses are derived from your wallet.
            </p>
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
                type="button"
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
              <Message negative style={{ marginTop: '1em' }}>
                <Message.Header>Could not create invoice</Message.Header>
                <p style={{ margin: '0.35em 0 0' }}>{this.state.error}</p>
              </Message>
            )}
          </Segment>
        )}

        <Segment>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5em', flexWrap: 'wrap', marginBottom: '0.35em' }}>
            <Header as='h3' style={{ margin: 0 }}>My invoices</Header>
            <Button
              type="button"
              size="small"
              basic
              icon
              labelPosition="left"
              onClick={() => this.refresh()}
              title="Reload list from localStorage (e.g. after another tab created an invoice)"
            >
              <Icon name="refresh" />
              Refresh list
            </Button>
          </div>
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
                        adminToken={this.props && this.props.adminToken}
                        compact
                        onPaid={(txid) => {
                          if (inv.id && txid) addPaymentToInvoice(inv.id, txid);
                          this.refresh();
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35em', alignItems: 'stretch' }}>
                      <Button
                        as="a"
                        href={buildTabPayerDemoUrl(inv.address, inv.amountSats)}
                        target="_blank"
                        rel="noopener noreferrer"
                        basic
                        color="blue"
                        size="small"
                        icon="external alternate"
                        content="Open payer tab (prefilled)"
                        title="Opens Payments in a new tab with payTo and payAmountSats prefilled"
                        aria-label="Open payer tab: Bitcoin Payments with address and amount prefilled"
                      />
                      <Button
                        basic
                        color='red'
                        size='small'
                        icon='trash'
                        onClick={() => this.handleDelete(inv.id)}
                        title='Delete invoice'
                      />
                    </div>
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
