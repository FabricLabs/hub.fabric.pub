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

/**
 * Same-origin only: browse JSON is for the local Hub, not arbitrary URLs.
 */
function normalizeBrowseJsonPath (raw) {
  let path = String(raw || '').trim() || '/services/bitcoin';
  if (path.startsWith('//')) {
    throw new Error('Use a path starting with / (protocol-relative URLs are not allowed).');
  }
  if (/^https?:\/\//i.test(path)) {
    let u;
    try {
      u = new URL(path);
    } catch (_) {
      throw new Error('Invalid URL.');
    }
    if (typeof window !== 'undefined' && window.location && u.origin !== window.location.origin) {
      throw new Error('Cross-origin fetch is disabled. Use a path on this hub (e.g. /services/bitcoin).');
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
    const rows = [
      { method: 'GET', path: '/services/bitcoin', note: 'Status, health, beacon' },
      { method: 'GET', path: '/services/bitcoin/blocks', note: 'Recent blocks' },
      { method: 'GET', path: '/services/bitcoin/transactions', note: 'Recent transactions' },
      { method: 'GET', path: '/services/bitcoin/wallets', note: 'Wallet summaries' },
      { method: 'GET', path: walletId ? `/services/bitcoin/wallets/${walletId}` : '/services/bitcoin/wallets/:walletId', note: 'Client spend/balance + invoice receive wallet id (same BIP44 account 0 xpub under identity)' },
      { method: 'GET', path: walletId ? `/services/bitcoin/wallets/${walletId}/utxos` : '/services/bitcoin/wallets/:walletId/utxos', note: 'UTXOs' },
      { method: 'GET', path: walletId ? `/services/bitcoin/wallets/${walletId}/transactions` : '/services/bitcoin/wallets/:walletId/transactions', note: 'Wallet txs' },
      { method: 'GET', path: '/services/bitcoin/addresses', note: 'Receive address helper' },
      { method: 'GET', path: '/payments', note: 'Canonical outbound payments list (legacy GET /services/bitcoin/payments)' },
      { method: 'POST', path: '/payments', note: 'Canonical Hub-wallet spend POST (legacy POST /services/bitcoin/payments)' },
      { method: 'GET', path: '/services/payjoin', note: 'Payjoin capabilities (+ fabricProtocol); mirror: /payments/payjoin' },
      { method: 'GET', path: '/services/payjoin/sessions', note: 'List sessions' },
      { method: 'POST', path: '/services/payjoin/sessions', note: 'Create deposit session (body: walletId, amountSats, address?, receiveTemplate?, federationXOnlyHex?)' },
      { method: 'POST', path: '/services/payjoin/sessions/:sessionId/proposals', note: 'Submit Payjoin proposal (body: psbt / txhex)' },
      { method: 'POST', path: '/services/payjoin/sessions/:sessionId/acp-hub-boost', note: 'Admin Bearer: append+sign Hub wallet input on ANYONECANPAY|ALL payer PSBT (outputs unchanged)' },
      { method: 'GET', path: '/services/bitcoin/crowdfunding/campaigns', note: 'List Taproot crowdfunds (goal/min committed in tapscript; 2-of-2 payout)' },
      { method: 'POST', path: '/services/bitcoin/crowdfunding/campaigns', note: 'Create campaign (admin Bearer): beneficiaryPubkeyHex, goalSats, minContributionSats, refundAfterBlocks?, title?' },
      { method: 'GET', path: '/services/bitcoin/crowdfunding/campaigns/:id/acp-donation-psbt?amountSats=', note: 'Outputs-only PSBT (one output to vault); donors add inputs with SIGHASH_ALL|ANYONECANPAY' },
      { method: 'GET', path: '/services/bitcoin/crowdfunding/campaigns/:id', note: 'Campaign + scantxoutset balance, goalMet, vaultUtxos[{txid,vout,amountSats}]' },
      { method: 'GET', path: '/services/bitcoin/crowdfunding/campaigns/:id/payout-psbt?destination=&feeSats=', note: 'Unsigned payout PSBT when raised ≥ goal; each UTXO ≥ minContributionSats' },
      { method: 'POST', path: '/services/bitcoin/crowdfunding/campaigns/:id/payout-sign-arbiter', note: 'Admin: body psbtBase64 — Hub arbiter co-signs' },
      { method: 'POST', path: '/services/bitcoin/crowdfunding/campaigns/:id/payout-broadcast', note: 'body psbtBase64 — finalize 2-of-2 payout + sendrawtransaction' },
      { method: 'POST', path: '/services/bitcoin/crowdfunding/campaigns/:id/refund-prepare', note: 'Admin: after CLTV height — body destinationAddress, fundedTxid, vout?, feeSats?; returns signed arbiter refund hex' },
      { method: 'POST', path: '/sessions', note: 'Desktop login: create session (body: origin); off loopback, request must match that origin — Origin / Referer / Sec-Fetch-Site+Host' },
      { method: 'GET', path: '/sessions/:sessionId', note: 'Poll desktop login (pending/signed once then 404); delegation metadata public or Bearer; Electron should send Origin=hub from fabric:// `hub` when not loopback; localhost vs 127.0.0.1 same port counts as same origin' },
      { method: 'GET', path: '/sessions/:sessionId/delegation/audit', note: 'Delegation audit (Bearer must equal session id): pending queue, DELEGATION_* Fabric log slice, Hub verify pubkey' },
      { method: 'DELETE', path: '/sessions/:sessionId', note: 'Revoke delegation (loopback or Bearer matching id); 404 if token unknown' },
      { method: 'POST', path: '/sessions/:sessionId/signatures', note: 'Desktop completes login: loopback TCP or Origin/Referer/Host matching session (LAN hub); localhost ≡ 127.0.0.1 same port' },
      { method: 'GET', path: '/sessions', note: 'List delegation sessions + pendingDelegationMessages (Fabric message ids; loopback)' },
      { method: 'POST', path: '/services/rpc', note: 'JSON-RPC: PostDelegationSignatureMessage, GetDelegationSignatureMessage, ResolveDelegationSignatureMessage (delegation token / session id); list sessions GET /sessions is loopback-only; Fabric log DELEGATION_SIGNATURE_*' },
      { method: 'GET', path: '/services/lightning', note: 'Lightning status' },
      { method: 'GET', path: '/services/lightning/channels', note: 'Channels + listfunds outputs' },
      { method: 'DELETE', path: '/services/lightning/channels/:channelId', note: 'Close channel (CLN close RPC)' },
      { method: 'POST', path: '/services/lightning/channels', note: 'Open channel (body: peerId/remote, amountSats, …)' },
      { method: 'POST', path: '/services/lightning/invoices', note: 'Create invoice' },
      { method: 'POST', path: '/services/lightning/payments', note: 'Pay invoice' },
      { method: 'POST', path: '/services/lightning/decodes', note: 'Decode BOLT11' },
      { method: 'GET', path: '/services/bitcoin/transactions/:txid?address=&amountSats=', note: 'L1 payment proof (same resource as raw tx; query selects proof JSON)' },
      { method: 'GET', path: '/services/distributed/manifest', note: 'Distributed execution manifest; federation validator pubkeys and threshold' },
      { method: 'GET', path: '/services/distributed/epoch', note: 'Beacon epoch summary JSON (L1 height/hash; optional sidechain digest; witness metadata)' },
      { method: 'GET', path: '/services/distributed/vault', note: 'Federation Taproot vault address, tapscript hex, maturity policy' },
      { method: 'GET', path: '/services/distributed/vault/utxos', note: 'Vault UTXOs (scantxoutset) + per-UTXO maturity hint' },
      { method: 'GET', path: '/services/distributed/federation-registry', note: 'Fabric filesystem catalog: seeded federations + fabfed OP_RETURN discoveries (regtest scan default)' }
    ];

    return (
      <div className='fade-in'>
        <Segment>
          <section aria-labelledby="btc-resources-page-heading" aria-describedby="btc-resources-page-summary">
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.25em' }}
            role="banner"
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
              <Button as={Link} to="/services/bitcoin" basic aria-label="Back to Bitcoin dashboard" title="Bitcoin home (status, wallet, explorer, and tools)">
                <Icon name="arrow left" aria-hidden="true" />
                Bitcoin
              </Button>
              <Button as={Link} to="/payments" basic>
                <Icon name="credit card outline" aria-hidden="true" />
                Payments UI
              </Button>
              <Button as={Link} to="/services/bitcoin/crowdfunds" basic>
                <Icon name="heart outline" aria-hidden="true" />
                Crowdfunds
              </Button>
            </div>
            <Header as="h2" id="btc-resources-page-heading" style={{ margin: 0 }}>
              <Icon name="bitcoin" color="orange" aria-hidden="true" />
              <Header.Content>Bitcoin HTTP resources</Header.Content>
            </Header>
            <p id="btc-resources-page-summary" style={{ margin: 0, color: '#666', maxWidth: '48rem', lineHeight: 1.45 }}>
              REST on <code>/services/bitcoin</code> and <code>/services/lightning</code>: GET collections, POST to
              create or act, DELETE where removal is the semantics (e.g. close channel). Hub{' '}
              <code>POST /services/bitcoin</code> remains JSON-RPC for Fabric clients.
              {' '}
              <strong>Beacon / federation:</strong> public epoch and policy JSON lives under{' '}
              <code>/services/distributed/</code>
              {' '}(quick-open below). How to compare L1 tips and reproduce Schnorr witnesses is summarized on{' '}
              <Link to="/settings/admin/beacon-federation">Beacon Federation</Link>.
            </p>
          </div>
          <BitcoinWalletBranchBar identity={(this.props && this.props.identity) || {}} />
          </section>
        </Segment>

        <Segment>
          <section aria-labelledby="btc-resources-l1-h3" aria-describedby="btc-resources-l1-desc">
          <Header as="h3" id="btc-resources-l1-h3">L1 payment verification</Header>
          <p id="btc-resources-l1-desc" style={{ color: '#666' }}>
            Uses{' '}
            <code>GET /services/bitcoin/transactions/&lt;txid&gt;?address=&amp;amountSats=</code>
            .
          </p>
          <Form onSubmit={(e) => { e.preventDefault(); this.handleVerify(); }}>
            <Form.Group widths='equal'>
              <Form.Input
                label='Transaction id'
                placeholder='64-char hex txid'
                value={this.state.verifyTxid}
                onChange={(e, { value }) => this.setState({ verifyTxid: value })}
              />
              <Form.Input
                label='Destination address'
                placeholder='Invoice / expected receive address'
                value={this.state.verifyAddress}
                onChange={(e, { value }) => this.setState({ verifyAddress: value })}
              />
              <Form.Input
                label='Minimum amount (sats)'
                type='number'
                min={1}
                value={this.state.verifyAmountSats}
                onChange={(e, { value }) => this.setState({ verifyAmountSats: value })}
                input={{
                  'aria-label': 'Minimum amount in satoshis for L1 payment verification'
                }}
              />
            </Form.Group>
            <Button primary type='submit' loading={this.state.verifyLoading}>
              <Icon name='check circle outline' />
              Verify
            </Button>
          </Form>
          {this.state.verifyResult && !this.state.verifyResult.error && this.state.verifyResult.verified === true && (
            <Message positive style={{ marginTop: '1em' }}>
              <Message.Header>Payment verified</Message.Header>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(this.state.verifyResult, null, 2)}
              </pre>
            </Message>
          )}
          {this.state.verifyResult && !this.state.verifyResult.error && this.state.verifyResult.verified === false && (
            <Message warning style={{ marginTop: '1em' }}>
              <Message.Header>Not verified</Message.Header>
              <p style={{ marginBottom: '0.65em' }}>
                This transaction does not pay at least the requested amount to the given address, or the node could not load the tx (wrong network, txindex off, or tx not seen yet).
              </p>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                {JSON.stringify(this.state.verifyResult, null, 2)}
              </pre>
            </Message>
          )}
          {this.state.verifyResult && !this.state.verifyResult.error && this.state.verifyResult.verified !== true && this.state.verifyResult.verified !== false && (
            <Message info style={{ marginTop: '1em' }}>
              <Message.Header>Result</Message.Header>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(this.state.verifyResult, null, 2)}
              </pre>
            </Message>
          )}
          {this.state.verifyResult && this.state.verifyResult.error && (
            <Message negative style={{ marginTop: '1em' }}>
              <Message.Header>Verification request failed</Message.Header>
              <p style={{ margin: '0.35em 0 0' }}>{this.state.verifyResult.error}</p>
              <Button
                type="button"
                size="small"
                style={{ marginTop: '0.75em' }}
                loading={this.state.verifyLoading}
                disabled={this.state.verifyLoading}
                onClick={() => void this.handleVerify()}
              >
                <Icon name="refresh" />
                Retry
              </Button>
            </Message>
          )}
          </section>
        </Segment>

        <Segment>
          <section aria-labelledby="btc-resources-fetch-h3" aria-describedby="btc-resources-fetch-desc">
          <Header as="h3" id="btc-resources-fetch-h3">Browse JSON</Header>
          <p id="btc-resources-fetch-desc" style={{ color: '#666' }}>
            GET a path on <strong>this hub</strong> (default <code>/services/bitcoin</code>). Cross-origin and protocol-relative URLs are rejected.
          </p>
          <Form onSubmit={(e) => { e.preventDefault(); this.handleFetchJson(); }}>
            <Form.Input
              label='Path'
              value={this.state.fetchPath}
              onChange={(e, { value }) => this.setState({ fetchPath: value })}
              placeholder='/services/bitcoin'
            />
            <Button type='submit' loading={this.state.fetchLoading}>
              <Icon name='download' />
              Fetch
            </Button>
          </Form>
          {this.state.fetchError && (
            <Message negative style={{ marginTop: '1em' }}>
              <Message.Header>Request failed</Message.Header>
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
                Retry
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
          <Header as="h3" id="btc-resources-quickopen-h3">Quick open (new tab)</Header>
          <Table compact celled aria-label="Bitcoin and related HTTP endpoints">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Method</Table.HeaderCell>
                <Table.HeaderCell>Path</Table.HeaderCell>
                <Table.HeaderCell>Note</Table.HeaderCell>
                <Table.HeaderCell collapsing>Open</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((r) => (
                <Table.Row key={`${r.method}:${r.path}`}>
                  <Table.Cell>{r.method}</Table.Cell>
                  <Table.Cell>
                    <code style={{ fontSize: '0.85em' }}>{r.path}</code>
                  </Table.Cell>
                  <Table.Cell>{r.note}</Table.Cell>
                  <Table.Cell>
                    <Button
                      size='mini'
                      basic
                      type='button'
                      disabled={r.path.includes(':') || r.method !== 'GET'}
                      title={r.method !== 'GET' ? 'Quick open is GET-only; use curl or an API client for POST/DELETE.' : undefined}
                      onClick={() => this.openPath(r.path.split('?')[0])}
                      aria-label={`Open ${r.method} ${r.path.split('?')[0]} as JSON in new tab`}
                    >
                      JSON
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          </section>
        </Segment>
      </div>
    );
  }
}

module.exports = BitcoinResourcesHome;
