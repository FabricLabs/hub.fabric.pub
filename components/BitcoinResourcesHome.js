'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Form,
  Header,
  Icon,
  Message,
  Segment,
  Table
} = require('semantic-ui-react');
const {
  getSpendWalletContext,
  loadUpstreamSettings,
  verifyL1Payment
} = require('../functions/bitcoinClient');
const BitcoinWalletBranchBar = require('./BitcoinWalletBranchBar');
const t = require('../locales/en');

const L = t.payments.resources;

/**
 * Same-origin only: browse JSON is for the local Hub, not arbitrary URLs.
 */
function normalizeBrowseJsonPath (raw) {
  let path = String(raw || '').trim() || '/services/bitcoin';
  if (path.startsWith('//')) {
    throw new Error(L.errors.protocolRelative);
  }
  if (/^https?:\/\//i.test(path)) {
    let u;
    try {
      u = new URL(path);
    } catch (_) {
      throw new Error(L.errors.invalidUrl);
    }
    if (typeof window !== 'undefined' && window.location && u.origin !== window.location.origin) {
      throw new Error(L.errors.crossOrigin);
    }
    return u.pathname + u.search + u.hash;
  }
  if (!path.startsWith('/')) return `/${path}`;
  return path;
}

/**
 * Operator view: canonical Bitcoin HTTP resources (GET) + L1 payment verification form.
 */
class BitcoinResourcesHome extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      upstream: loadUpstreamSettings(),
      wallet: null,
      verifyTxid: '',
      verifyAddress: '',
      verifyAmountSats: '',
      verifyResult: null,
      verifyLoading: false,
      fetchPath: '/services/bitcoin',
      fetchResult: null,
      fetchLoading: false,
      fetchError: null
    };
    this._regtestVerifyAmountPrimed = false;
  }

  componentDidMount () {
    const identity = (this.props && this.props.identity) || {};
    const networkRaw = this.props.bitcoin && this.props.bitcoin.network;
    const network = networkRaw != null && String(networkRaw).trim()
      ? String(networkRaw).toLowerCase()
      : null;
    const next = { wallet: getSpendWalletContext(identity) };
    if (network === 'regtest' && !this._regtestVerifyAmountPrimed) {
      this._regtestVerifyAmountPrimed = true;
      if (!String(this.state.verifyAmountSats || '').trim()) {
        next.verifyAmountSats = '10000';
      }
    }
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        const tx = new URLSearchParams(window.location.search).get('tx');
        if (tx && String(tx).trim()) next.verifyTxid = String(tx).trim();
      }
    } catch (_) {}
    this.setState(next);
  }

  componentDidUpdate (prevProps) {
    const prev = prevProps && prevProps.identity && prevProps.identity.xpub;
    const next = this.props && this.props.identity && this.props.identity.xpub;
    if (prev !== next) {
      const identity = (this.props && this.props.identity) || {};
      this.setState({ wallet: getSpendWalletContext(identity) });
    }
    const prevNet = prevProps && prevProps.bitcoin && prevProps.bitcoin.network;
    const nextNet = this.props && this.props.bitcoin && this.props.bitcoin.network;
    if (String(prevNet || '').toLowerCase() !== String(nextNet || '').toLowerCase()) {
      const network = nextNet != null && String(nextNet).trim() ? String(nextNet).toLowerCase() : null;
      if (network === 'regtest' && !String(this.state.verifyAmountSats || '').trim()) {
        this.setState({ verifyAmountSats: '10000' });
      }
    }
  }

  async handleVerify () {
    const upstream = this.state.upstream;
    const txid = String(this.state.verifyTxid || '').trim();
    const address = String(this.state.verifyAddress || '').trim();
    const amountSats = Number(this.state.verifyAmountSats || 0);
    this.setState({ verifyLoading: true, verifyResult: null });
    try {
      const res = await verifyL1Payment(upstream, { txid, address, amountSats });
      this.setState({ verifyLoading: false, verifyResult: res });
    } catch (e) {
      this.setState({
        verifyLoading: false,
        verifyResult: { error: e && e.message ? e.message : String(e) }
      });
    }
  }

  async handleFetchJson () {
    let path;
    try {
      path = normalizeBrowseJsonPath(this.state.fetchPath);
    } catch (err) {
      this.setState({
        fetchLoading: false,
        fetchResult: null,
        fetchError: err && err.message ? err.message : String(err)
      });
      return;
    }

    this.setState({ fetchLoading: true, fetchResult: null, fetchError: null });
    try {
      const headers = { Accept: 'application/json' };
      const token = String((this.state.upstream && this.state.upstream.apiToken) || '').trim();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(path, { method: 'GET', headers });
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch (_) {
        body = text;
      }
      if (!res.ok) {
        const msg = body && body.message ? body.message : `${res.status} ${res.statusText}`;
        throw new Error(msg);
      }
      this.setState({ fetchLoading: false, fetchResult: body });
    } catch (e) {
      this.setState({
        fetchLoading: false,
        fetchError: e && e.message ? e.message : String(e)
      });
    }
  }

  openPath (path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    window.open(p, '_blank', 'noopener,noreferrer');
  }

  render () {
    const w = this.state.wallet || {};
    const walletId = w.walletId || '';
    const E = L.endpoints;
    const rows = [
      { id: 'status', method: 'GET', path: '/services/bitcoin' },
      { id: 'blocks', method: 'GET', path: '/services/bitcoin/blocks' },
      { id: 'transactions', method: 'GET', path: '/services/bitcoin/transactions' },
      { id: 'wallets', method: 'GET', path: '/services/bitcoin/wallets' },
      { id: 'xpub', method: 'GET', path: '/services/bitcoin/xpub?xpub=' },
      { id: 'xpubUtxos', method: 'GET', path: '/services/bitcoin/xpub/utxos?xpub=' },
      { id: 'xpubTransactions', method: 'GET', path: '/services/bitcoin/xpub/transactions?xpub=&limit=&addresses=' },
      { id: 'wallet', method: 'GET', path: walletId ? `/services/bitcoin/wallets/${walletId}` : '/services/bitcoin/wallets/:walletId' },
      { id: 'walletUtxos', method: 'GET', path: walletId ? `/services/bitcoin/wallets/${walletId}/utxos` : '/services/bitcoin/wallets/:walletId/utxos' },
      { id: 'walletTransactions', method: 'GET', path: walletId ? `/services/bitcoin/wallets/${walletId}/transactions` : '/services/bitcoin/wallets/:walletId/transactions' },
      { id: 'addresses', method: 'GET', path: '/services/bitcoin/addresses' },
      { id: 'paymentsList', method: 'GET', path: '/payments' },
      { id: 'paymentsCreate', method: 'POST', path: '/payments' },
      { id: 'payjoin', method: 'GET', path: '/services/payjoin' },
      { id: 'payjoinSessions', method: 'GET', path: '/services/payjoin/sessions' },
      { id: 'payjoinCreate', method: 'POST', path: '/services/payjoin/sessions' },
      { id: 'payjoinProposal', method: 'POST', path: '/services/payjoin/sessions/:sessionId/proposals' },
      { id: 'payjoinContribute', method: 'POST', path: '/services/payjoin/sessions/:sessionId/contribute' },
      { id: 'coinjoin', method: 'GET', path: '/services/coinjoin' },
      { id: 'coinjoinOffers', method: 'GET', path: '/services/coinjoin/offers?amountSats=' },
      { id: 'coinjoinTerms', method: 'POST', path: '/services/coinjoin/offers' },
      { id: 'coinjoinRounds', method: 'GET', path: '/services/coinjoin/rounds' },
      { id: 'coinjoinStart', method: 'POST', path: '/services/coinjoin/rounds' },
      { id: 'bonds', method: 'GET', path: '/services/coinjoin/bonds' },
      { id: 'bondCreate', method: 'POST', path: '/services/coinjoin/bonds' },
      { id: 'bondRenew', method: 'POST', path: '/services/coinjoin/bonds/:bondId/certificate' },
      { id: 'bondRedeem', method: 'POST', path: '/services/coinjoin/bonds/:bondId/redeem' },
      { id: 'campaigns', method: 'GET', path: '/services/bitcoin/crowdfunding/campaigns' },
      { id: 'campaignCreate', method: 'POST', path: '/services/bitcoin/crowdfunding/campaigns' },
      { id: 'campaignDonationPsbt', method: 'GET', path: '/services/bitcoin/crowdfunding/campaigns/:id/acp-donation-psbt?amountSats=' },
      { id: 'campaign', method: 'GET', path: '/services/bitcoin/crowdfunding/campaigns/:id' },
      { id: 'campaignPayoutPsbt', method: 'GET', path: '/services/bitcoin/crowdfunding/campaigns/:id/payout-psbt?destination=&feeSats=' },
      { id: 'campaignArbiterSign', method: 'POST', path: '/services/bitcoin/crowdfunding/campaigns/:id/payout-sign-arbiter' },
      { id: 'campaignBroadcast', method: 'POST', path: '/services/bitcoin/crowdfunding/campaigns/:id/payout-broadcast' },
      { id: 'campaignRefund', method: 'POST', path: '/services/bitcoin/crowdfunding/campaigns/:id/refund-prepare' },
      { id: 'sessionCreate', method: 'POST', path: '/sessions' },
      { id: 'session', method: 'GET', path: '/sessions/:sessionId' },
      { id: 'sessionAudit', method: 'GET', path: '/sessions/:sessionId/delegation/audit' },
      { id: 'sessionRevoke', method: 'DELETE', path: '/sessions/:sessionId' },
      { id: 'sessionSign', method: 'POST', path: '/sessions/:sessionId/signatures' },
      { id: 'sessions', method: 'GET', path: '/sessions' },
      { id: 'rpc', method: 'POST', path: '/services/rpc' },
      { id: 'lightning', method: 'GET', path: '/services/lightning' },
      { id: 'lightningChannels', method: 'GET', path: '/services/lightning/channels' },
      { id: 'lightningClose', method: 'DELETE', path: '/services/lightning/channels/:channelId' },
      { id: 'lightningOpen', method: 'POST', path: '/services/lightning/channels' },
      { id: 'lightningInvoice', method: 'POST', path: '/services/lightning/invoices' },
      { id: 'lightningPay', method: 'POST', path: '/services/lightning/payments' },
      { id: 'lightningDecode', method: 'POST', path: '/services/lightning/decodes' },
      { id: 'paymentProof', method: 'GET', path: '/services/bitcoin/transactions/:txid?address=&amountSats=' },
      { id: 'manifest', method: 'GET', path: '/services/distributed/manifest' },
      { id: 'epoch', method: 'GET', path: '/services/distributed/epoch' },
      { id: 'vault', method: 'GET', path: '/services/distributed/vault' },
      { id: 'vaultUtxos', method: 'GET', path: '/services/distributed/vault/utxos' },
      { id: 'registry', method: 'GET', path: '/services/distributed/federation-registry' }
    ];
    const verifyResult = this.state.verifyResult;
    const verifyDetails = verifyResult && !verifyResult.error ? (
      <details className="hub-developer-details" style={{ marginTop: '0.5em' }}>
        <summary>{t.common.developerDetails}</summary>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
          {JSON.stringify(verifyResult, null, 2)}
        </pre>
      </details>
    ) : null;

    return (
      <div className='fade-in'>
        <Segment>
          <section aria-labelledby="btc-resources-page-heading" aria-describedby="btc-resources-page-summary">
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.25em' }}
            role="banner"
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
              <Button as={Link} to="/services/bitcoin" basic title={L.backTitle}>
                <Icon name="arrow left" aria-hidden="true" />
                {L.back}
              </Button>
              <Button as={Link} to="/payments" basic>
                <Icon name="credit card outline" aria-hidden="true" />
                {L.payments}
              </Button>
              <Button as={Link} to="/services/bitcoin/crowdfunds" basic>
                <Icon name="heart outline" aria-hidden="true" />
                {L.crowdfunds}
              </Button>
            </div>
            <Header as="h2" id="btc-resources-page-heading" style={{ margin: 0 }}>
              <Icon name="bitcoin" color="orange" aria-hidden="true" />
              <Header.Content>{L.title}</Header.Content>
            </Header>
            <p id="btc-resources-page-summary" style={{ margin: 0, color: '#666', maxWidth: '48rem', lineHeight: 1.45 }}>
              {L.summary}{' '}
              {L.beaconBefore}{' '}
              <Link to="/settings/admin/beacon-federation">{L.beaconLink}</Link>.
            </p>
          </div>
          <BitcoinWalletBranchBar identity={(this.props && this.props.identity) || {}} />
          </section>
        </Segment>

        <Segment>
          <section aria-labelledby="btc-resources-l1-h3" aria-describedby="btc-resources-l1-desc">
          <Header as="h3" id="btc-resources-l1-h3">{L.verifyTitle}</Header>
          <p id="btc-resources-l1-desc" style={{ color: '#666' }}>
            {L.verifyIntro}
          </p>
          <details className="hub-developer-details" style={{ marginBottom: '0.75em' }}>
            <summary>{t.common.developerDetails}</summary>
            <code>GET /services/bitcoin/transactions/&lt;txid&gt;?address=&amp;amountSats=</code>
          </details>
          <Form onSubmit={(e) => { e.preventDefault(); this.handleVerify(); }}>
            <Form.Group widths='equal'>
              <Form.Input
                id='btc-resources-verify-txid'
                label={L.txid}
                placeholder={L.txidPlaceholder}
                value={this.state.verifyTxid}
                onChange={(e, { value }) => this.setState({ verifyTxid: value })}
              />
              <Form.Input
                id='btc-resources-verify-address'
                label={L.address}
                placeholder={L.addressPlaceholder}
                value={this.state.verifyAddress}
                onChange={(e, { value }) => this.setState({ verifyAddress: value })}
              />
              <Form.Input
                id='btc-resources-verify-amount'
                label={L.minAmount}
                type='number'
                min={1}
                value={this.state.verifyAmountSats}
                onChange={(e, { value }) => this.setState({ verifyAmountSats: value })}
              />
            </Form.Group>
            <Button primary type='submit' loading={this.state.verifyLoading}>
              <Icon name='check circle outline' />
              {L.verify}
            </Button>
          </Form>
          {verifyResult && !verifyResult.error && verifyResult.verified === true && (
            <Message positive style={{ marginTop: '1em' }}>
              <Message.Header>{L.verified}</Message.Header>
              <p style={{ margin: '0.35em 0 0' }}>
                {L.proofSummary(verifyResult.matchedSats, verifyResult.confirmations, verifyResult.inMempool)}
              </p>
              {verifyDetails}
            </Message>
          )}
          {verifyResult && !verifyResult.error && verifyResult.verified === false && (
            <Message warning style={{ marginTop: '1em' }}>
              <Message.Header>{L.notVerified}</Message.Header>
              <p style={{ margin: '0.35em 0 0' }}>
                {L.notVerifiedHint}
              </p>
              {verifyDetails}
            </Message>
          )}
          {verifyResult && !verifyResult.error && verifyResult.verified !== true && verifyResult.verified !== false && (
            <Message info style={{ marginTop: '1em' }}>
              <Message.Header>{L.result}</Message.Header>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(verifyResult, null, 2)}
              </pre>
            </Message>
          )}
          {verifyResult && verifyResult.error && (
            <Message negative style={{ marginTop: '1em' }}>
              <Message.Header>{L.verifyFailed}</Message.Header>
              <p style={{ margin: '0.35em 0 0' }}>{verifyResult.error}</p>
              <Button
                type="button"
                size="small"
                style={{ marginTop: '0.75em' }}
                loading={this.state.verifyLoading}
                disabled={this.state.verifyLoading}
                onClick={() => void this.handleVerify()}
              >
                <Icon name="refresh" />
                {t.common.actions.retry}
              </Button>
            </Message>
          )}
          </section>
        </Segment>

        <Segment>
          <section aria-labelledby="btc-resources-fetch-h3" aria-describedby="btc-resources-fetch-desc">
          <Header as="h3" id="btc-resources-fetch-h3">{L.browseTitle}</Header>
          <p id="btc-resources-fetch-desc" style={{ color: '#666' }}>
            {L.browseIntro}
          </p>
          <Form onSubmit={(e) => { e.preventDefault(); this.handleFetchJson(); }}>
            <Form.Input
              id='btc-resources-fetch-path'
              label={L.path}
              value={this.state.fetchPath}
              onChange={(e, { value }) => this.setState({ fetchPath: value })}
              placeholder='/services/bitcoin'
            />
            <Button type='submit' loading={this.state.fetchLoading}>
              <Icon name='download' />
              {L.fetch}
            </Button>
          </Form>
          {this.state.fetchError && (
            <Message negative style={{ marginTop: '1em' }}>
              <Message.Header>{L.fetchFailed}</Message.Header>
              <p style={{ margin: '0.35em 0 0' }}>{this.state.fetchError}</p>
              <Button
                type="button"
                size="small"
                style={{ marginTop: '0.75em' }}
                loading={this.state.fetchLoading}
                disabled={this.state.fetchLoading}
                onClick={() => void this.handleFetchJson()}
              >
                <Icon name="refresh" />
                {t.common.actions.retry}
              </Button>
            </Message>
          )}
          {this.state.fetchResult != null && (
            <Message info style={{ marginTop: '1em' }}>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '24em', overflow: 'auto' }}>
                {typeof this.state.fetchResult === 'string'
                  ? this.state.fetchResult
                  : JSON.stringify(this.state.fetchResult, null, 2)}
              </pre>
            </Message>
          )}
          </section>
        </Segment>

        <Segment>
          <section aria-labelledby="btc-resources-quickopen-h3">
          <Header as="h3" id="btc-resources-quickopen-h3">{L.endpointsTitle}</Header>
          <Table compact celled aria-labelledby="btc-resources-quickopen-h3">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{L.colMethod}</Table.HeaderCell>
                <Table.HeaderCell>{L.colPath}</Table.HeaderCell>
                <Table.HeaderCell>{L.colDescription}</Table.HeaderCell>
                <Table.HeaderCell collapsing>{L.colOpen}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((r) => {
                const pathId = `btc-resources-path-${r.method.toLowerCase()}-${r.id}`;
                const needsId = r.path.includes(':');
                const getOnly = r.method !== 'GET';
                return (
                  <Table.Row key={`${r.method}:${r.id}`}>
                    <Table.Cell>{r.method}</Table.Cell>
                    <Table.Cell>
                      <code id={pathId} style={{ fontSize: '0.85em', wordBreak: 'break-all' }}>{r.path}</code>
                    </Table.Cell>
                    <Table.Cell>{E[r.id]}</Table.Cell>
                    <Table.Cell>
                      <Button
                        size='mini'
                        basic
                        type='button'
                        disabled={needsId || getOnly}
                        title={getOnly ? L.getOnly : (needsId ? L.needsId : undefined)}
                        onClick={() => this.openPath(r.path.split('?')[0])}
                        aria-describedby={pathId}
                      >
                        {L.open}
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
          </section>
        </Segment>
      </div>
    );
  }
}

module.exports = BitcoinResourcesHome;
