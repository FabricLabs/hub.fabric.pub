'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Header, Icon, List, Segment } = require('semantic-ui-react');
const { fetchBitcoinStatus, fetchExplorerData, loadUpstreamSettings } = require('../functions/bitcoinClient');
const { formatSatsDisplay } = require('../functions/formatSats');

function trimHash (value) {
  const s = String(value || '');
  if (!s) return 'n/a';
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
      transactions: []
    };
  }

  async componentDidMount () {
    await this.refresh();
  }

  async refresh () {
    this.setState({ loading: true });
    try {
      const [data, status] = await Promise.all([
        fetchExplorerData(this.state.upstream).catch(() => ({})),
        fetchBitcoinStatus(this.state.upstream).catch(() => ({}))
      ]);
      const explorerBlocks = Array.isArray(data && data.blocks) ? data.blocks : [];
      const explorerTxs = Array.isArray(data && data.transactions) ? data.transactions : [];
      const statusBlocks = Array.isArray(status && status.blocks) ? status.blocks : [];
      const statusTxs = Array.isArray(status && status.transactions) ? status.transactions : [];
      this.setState({
        loading: false,
        blocks: explorerBlocks.length ? explorerBlocks : statusBlocks,
        transactions: explorerTxs.length ? explorerTxs : statusTxs
      });
    } catch (_) {
      this.setState({ loading: false, blocks: [], transactions: [] });
    }
  }

  render () {
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
                <Icon name="list" />
                <Header.Content>Explorer</Header.Content>
              </Header>
            </div>
            <Button basic size="small" onClick={() => this.refresh()}>
              <Icon name="refresh" />
              Refresh
            </Button>
          </div>
        </Segment>
        <Segment>
          <Header as="h3">Recent Blocks</Header>
          {this.state.blocks.length === 0 ? (
            <p style={{ color: '#666' }}>No block data yet.</p>
          ) : (
            <List divided relaxed>
              {this.state.blocks.map((block, idx) => (
                <List.Item key={block.hash || block.id || idx}>
                  <List.Content>
                    <List.Header>
                      {(block.hash || block.id)
                        ? <Link to={`/services/bitcoin/blocks/${encodeURIComponent(block.hash || block.id)}`}>#{block.height != null ? block.height : 'n/a'} - {trimHash(block.hash || block.id)}</Link>
                        : <span>#{block.height != null ? block.height : 'n/a'} - hash unavailable</span>}
                    </List.Header>
                    <List.Description>
                      {block.time ? new Date(Number(block.time) * 1000).toLocaleString() : 'time unavailable'}
                    </List.Description>
                  </List.Content>
                </List.Item>
              ))}
            </List>
          )}
        </Segment>
        <Segment>
          <Header as="h3">Mempool Transactions ({this.state.transactions.length})</Header>
          {this.state.transactions.length === 0 ? (
            <p style={{ color: '#666' }}>No transaction data yet.</p>
          ) : (
            <List divided relaxed>
              {this.state.transactions.map((tx, idx) => {
                const tid = tx.txid || tx.id || '';
                return (
                  <List.Item key={tid || idx}>
                    <List.Content>
                      <List.Header>
                        {tid ? <Link to={`/services/bitcoin/transactions/${encodeURIComponent(String(tid))}`}>{trimHash(tid)}</Link> : 'n/a'}
                      </List.Header>
                      <List.Description>
                        {tx.value != null ? `${tx.value} BTC` : (tx.amountSats != null ? `${formatSatsDisplay(tx.amountSats)} sats` : 'amount unavailable')}
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
