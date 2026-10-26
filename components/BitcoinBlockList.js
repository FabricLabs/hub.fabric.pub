'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Header, Icon, List, Segment } = require('semantic-ui-react');
const { fetchBitcoinStatus, fetchExplorerData, loadUpstreamSettings, getSpendWalletContext } = require('../functions/bitcoinClient');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { SATS_PER_BTC } = require('../constants');
const t = require('../locales/en');

const c = t.bitcoin.blockList;
const shared = t.bitcoin.shared;

function bitcoinHealthState (status) {
  if (!status || typeof status !== 'object') return 'unknown';
  if (status.available === true) return 'ok';
  const code = String(status.status || '').toUpperCase();
  if (code === 'STARTING') return 'starting';
  if (code === 'UNAVAILABLE') return 'off';
  if (code) return 'unreachable';
  return 'unknown';
}

function trimHash (value) {
  const s = String(value || '');
  if (!s) return shared.notAvailable;
  if (s.length <= 20) return s;
  return `${s.slice(0, 10)}...${s.slice(-10)}`;
}

class BitcoinBlockList extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: true,
      upstream: loadUpstreamSettings(),
      blocks: [],
      transactions: [],
      status: null
    };
  }

  async componentDidMount () {
    await this.refresh();
  }

  async refresh () {
    this.setState({ loading: true });
    try {
      const spend = getSpendWalletContext(this.props.identity || {});
      const net = (this.props.bitcoin && this.props.bitcoin.network)
        ? String(this.props.bitcoin.network).toLowerCase()
        : 'regtest';
      const adminTok = (this.props.adminToken != null && String(this.props.adminToken).trim())
        ? String(this.props.adminToken).trim()
        : '';
      const effectiveAdminTok = adminTok || readHubAdminTokenFromBrowser(null) || '';
      const upstreamAdmin = {
        ...this.state.upstream,
        hubAdminToken: effectiveAdminTok
      };
      const [data, status] = await Promise.all([
        fetchExplorerData(upstreamAdmin, spend, { network: net, adminToken: effectiveAdminTok }).catch(() => ({})),
        fetchBitcoinStatus(upstreamAdmin).catch(() => ({}))
      ]);
      const explorerBlocks = Array.isArray(data && data.blocks) ? data.blocks : [];
      const explorerTxs = Array.isArray(data && data.transactions) ? data.transactions : [];
      const statusBlocks = Array.isArray(status && status.blocks) ? status.blocks : [];
      const statusTxs = Array.isArray(status && status.transactions) ? status.transactions : [];
      this.setState({
        loading: false,
        blocks: explorerBlocks.length ? explorerBlocks : statusBlocks,
        transactions: explorerTxs.length ? explorerTxs : statusTxs,
        status: status && typeof status === 'object' ? status : null
      });
    } catch (_) {
      this.setState({ loading: false, blocks: [], transactions: [] });
    }
  }

  renderNoBlocks () {
    const status = this.state.status;
    const health = bitcoinHealthState(status);
    const network = String((status && status.network) || (this.props.bitcoin && this.props.bitcoin.network) || '').toLowerCase();
    let healthLine = null;
    if (health === 'off') healthLine = `${t.bitcoin.health.off}. ${t.bitcoin.health.offHint}`;
    else if (health === 'starting') healthLine = `${t.bitcoin.health.starting}. ${t.bitcoin.health.startingHint}`;
    else if (health === 'unreachable') healthLine = `${t.bitcoin.health.unreachable}. ${t.bitcoin.health.unreachableHint}`;
    return (
      <div style={{ color: '#666' }}>
        <p style={{ margin: '0 0 0.35em', fontWeight: 600, color: '#444' }}>{shared.noBlocks.title}</p>
        <p style={{ margin: '0 0 0.35em' }}>{shared.noBlocks.body}</p>
        {healthLine ? <p style={{ margin: '0 0 0.35em' }}>{healthLine}</p> : null}
        <p style={{ margin: '0 0 0.35em' }}>{shared.noBlocks.check}</p>
        {network === 'regtest' ? <p style={{ margin: 0 }}>{shared.noBlocks.regtest}</p> : null}
      </div>
    );
  }

  render () {
    return (
      <div className="fade-in">
        <Segment loading={this.state.loading}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5em', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button as={Link} to="/services/bitcoin" basic size="small" title={shared.backToBitcoinTitle}>
                <Icon name="arrow left" />
                {shared.backToBitcoin}
              </Button>
              <Header as="h2" style={{ margin: 0 }}>
                <Icon name="list" />
                <Header.Content>{c.title}</Header.Content>
              </Header>
            </div>
            <Button basic size="small" onClick={() => this.refresh()}>
              <Icon name="refresh" />
              {t.common.actions.refresh}
            </Button>
          </div>
        </Segment>
        <Segment>
          <Header as="h3">{c.recentBlocks}</Header>
          {this.state.blocks.length === 0 ? (
            this.state.loading ? (
              <p style={{ color: '#666' }}>{c.loading}</p>
            ) : this.renderNoBlocks()
          ) : (
            <List divided relaxed>
              {this.state.blocks.map((block, idx) => (
                <List.Item key={block.hash || block.id || idx}>
                  <List.Content>
                    <List.Header>
                      {(block.hash || block.id)
                        ? <Link to={`/services/bitcoin/blocks/${encodeURIComponent(block.hash || block.id)}`}>{shared.blockLine(block.height != null ? block.height : shared.notAvailable, trimHash(block.hash || block.id))}</Link>
                        : <span>{shared.blockLine(block.height != null ? block.height : shared.notAvailable, shared.hashUnavailable)}</span>}
                    </List.Header>
                    <List.Description>
                      {block.time ? new Date(Number(block.time) * 1000).toLocaleString() : shared.timeUnavailable}
                    </List.Description>
                  </List.Content>
                </List.Item>
              ))}
            </List>
          )}
        </Segment>
        <Segment>
          <Header as="h3">{c.mempool(this.state.transactions.length)}</Header>
          {this.state.transactions.length === 0 ? (
            <p style={{ color: '#666' }}>{shared.noMempool}</p>
          ) : (
            <List divided relaxed>
              {this.state.transactions.map((tx, idx) => {
                const tid = tx.txid || tx.id || '';
                return (
                  <List.Item key={tid || idx}>
                    <List.Content>
                      <List.Header>
                        {tid ? <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(tid))}`}>{trimHash(tid)}</Link> : shared.notAvailable}
                      </List.Header>
                      <List.Description>
                        {tx.amountSats != null ? t.common.sats(tx.amountSats) : (tx.value != null && Number.isFinite(Number(tx.value)) ? t.common.sats(Math.round(Number(tx.value) * SATS_PER_BTC)) : shared.amountUnavailable)}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                );
              })}
            </List>
          )}
        </Segment>
      </div>
    );
  }
}

module.exports = BitcoinBlockList;
