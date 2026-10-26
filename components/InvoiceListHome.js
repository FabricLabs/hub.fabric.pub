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
const { classifyHubBrowserIdentity } = require('../functions/hubIdentityUiHints');
const t = require('../locales/en');

const L = t.payments.invoiceList;

/**
 * InvoiceListHome: create invoices and store them in the browser Fabric state store.
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
    const prevXpub = prevProps && prevProps.identity && prevProps.identity.wallet && prevProps.identity.wallet.segwit && prevProps.identity.wallet.segwit.xpub;
    const nextXpub = this.props && this.props.identity && this.props.identity.wallet && this.props.identity.wallet.segwit && this.props.identity.wallet.segwit.xpub;
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
      this.setState({ error: L.errors.amount });
      return;
    }

    const identity = (this.props && this.props.identity) || {};
    const wallet = getNextReceiveWalletContext(identity);
    const network = (this.props.bitcoin && this.props.bitcoin.network)
      ? String(this.props.bitcoin.network).toLowerCase()
      : 'regtest';

    if (!wallet.walletId || !wallet.xpub) {
      this.setState({ error: `${L.identityBody} ${t.common.identity.howToLogIn}` });
      return;
    }

    this.setState({ creating: true, error: null });
    try {
      const reserved = reserveNextReceiveAddress(wallet, { network, identity });
      const address = reserved && reserved.currentAddress
        ? reserved.currentAddress
        : null;

      if (!address) {
        this.setState({ error: L.errors.noAddress, creating: false });
        return;
      }

      const invoice = createInvoice({
        address,
        amountSats,
        memo,
        label: label || memo || L.defaultLabel(formatSatsDisplay(amountSats)),
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
        this.setState({ error: L.errors.saveFailed, creating: false });
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
    const identityHowTo = classifyHubBrowserIdentity(identity) === 'password_locked'
      ? t.common.identity.howToUnlock
      : t.common.identity.howToLogIn;
    const steps = [
      { id: 'funds', to: '/services/bitcoin#fabric-bitcoin-regtest-toolbar' },
      { id: 'receiver', to: '/settings/bitcoin-wallet' },
      { id: 'payer', to: '/payments#fabric-btc-make-payment-h4' },
      { id: 'advanced', to: '/services/coinjoin' },
      { id: 'confirm', to: '/services/bitcoin/resources' },
      { id: 'desktop', to: '/settings/security' }
    ];

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
                  <Button as={Link} to="/services/bitcoin" basic size="small" title={L.backTitle}>
                    <Icon name="arrow left" aria-hidden="true" />
                    {L.back}
                  </Button>
                  <Header as="h2" id="invoices-page-heading" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.35em' }}>
                    <Icon name="file alternate outline" aria-hidden="true" />
                    <Header.Content>{L.title}</Header.Content>
                  </Header>
                </div>
                <div role="toolbar" aria-label={L.shortcutsLabel} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center' }}>
                  <Button as={Link} to="/payments#fabric-payments-tab-demo" basic size="small" title={L.paymentsTitle}>
                    <Icon name="credit card outline" aria-hidden="true" />
                    {L.payments}
                  </Button>
                  <Button as={Link} to="/services/bitcoin#fabric-bitcoin-faucet" basic size="small" title={L.faucetTitle}>
                    <Icon name="tint" aria-hidden="true" />
                    {L.faucet}
                  </Button>
                  <Button as={Link} to="/services/bitcoin/resources" basic size="small" title={L.resourcesTitle}>
                    <Icon name="sitemap" aria-hidden="true" />
                    {L.resources}
                  </Button>
                  <Button as={Link} to="/services/bitcoin/crowdfunds" basic size="small" title={L.crowdfundsTitle}>
                    <Icon name="heart outline" aria-hidden="true" />
                    {L.crowdfunds}
                  </Button>
                </div>
              </div>
            </div>
            <p id="invoices-page-summary" style={{ color: '#666' }}>
              {L.summary}
            </p>
          </section>
          <Message info size="small" id="fabric-invoices-tab-demo" style={{ marginBottom: '1em' }}>
            <Message.Header>{L.walkthroughTitle}</Message.Header>
            <List ordered relaxed style={{ margin: '0.35em 0 0', color: '#333' }}>
              {steps.map((step) => {
                const s = L.steps[step.id];
                return (
                  <List.Item key={step.id}>
                    <strong>{s.title}</strong> {s.before}{' '}
                    <Link to={step.to}>{s.link}</Link>
                    {/^[.,;]/.test(s.after) ? s.after : ` ${s.after}`}
                  </List.Item>
                );
              })}
            </List>
          </Message>
          <HubRegtestAdminTokenPanel
            network={(bitcoin.network && String(bitcoin.network).toLowerCase()) || 'regtest'}
            adminTokenProp={this.props && this.props.adminToken}
          />
          <BitcoinWalletBranchBar identity={identity} />
          <p style={{ color: '#888', fontSize: '0.9em' }}>
            {L.addressNote}
          </p>
        </Segment>

        {!hasWallet && (
          <Message warning>
            <p style={{ margin: 0 }}>
              <strong>{L.identityTitle}</strong>
            </p>
            <p style={{ margin: '0.35em 0 0' }}>
              {L.identityBody} {identityHowTo}
            </p>
          </Message>
        )}

        {hasWallet && (
          <Segment>
            <Header as='h3'>{L.createTitle}</Header>
            <Form>
              <Form.Input
                id='invoice-create-amount'
                label={L.amount}
                type='number'
                min='1'
                step='1'
                placeholder={L.amountPlaceholder}
                value={this.state.amountSats}
                onChange={(e) => this.setState({ amountSats: e.target.value })}
              />
              <Form.Input
                id='invoice-create-label'
                label={L.label}
                placeholder={L.labelPlaceholder}
                value={this.state.label}
                onChange={(e) => this.setState({ label: e.target.value })}
              />
              <Form.Input
                id='invoice-create-memo'
                label={L.memo}
                placeholder={L.memoPlaceholder}
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
                {L.create}
              </Button>
            </Form>
            {this.state.error && (
              <Message negative style={{ marginTop: '1em' }}>
                <Message.Header>{L.createFailed}</Message.Header>
                <p style={{ margin: '0.35em 0 0' }}>{this.state.error}</p>
              </Message>
            )}
          </Segment>
        )}

        <Segment>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5em', flexWrap: 'wrap', marginBottom: '0.35em' }}>
            <Header as='h3' style={{ margin: 0 }}>{L.listTitle}</Header>
            <Button
              type="button"
              size="small"
              basic
              icon
              labelPosition="left"
              onClick={() => this.refresh()}
              title={L.refreshTitle}
            >
              <Icon name="refresh" />
              {L.refresh}
            </Button>
          </div>
          {this.state.invoices.length === 0 ? (
            <p style={{ color: '#666' }}>{L.empty}</p>
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
                        label={inv.label || inv.memo || L.defaultLabel(formatSatsDisplay(inv.amountSats))}
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
                        content={L.openPayerTab}
                        title={L.openPayerTabTitle}
                      />
                      <Button
                        basic
                        color='red'
                        size='small'
                        icon='trash'
                        onClick={() => this.handleDelete(inv.id)}
                        title={L.deleteInvoice}
                        aria-label={L.deleteInvoice}
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: '0.8em', color: '#999', marginTop: '0.25em' }}>
                    {L.created(inv.createdAt ? new Date(inv.createdAt).toLocaleString() : t.common.none)}
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
