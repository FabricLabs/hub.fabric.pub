'use strict';

const React = require('react');
const { Link, useParams } = require('react-router-dom');
const { Button, Header, Icon, List, Segment, Table, Message } = require('semantic-ui-react');
const { fetchBlockByHash, loadUpstreamSettings } = require('../functions/bitcoinClient');

function BitcoinBlockView () {
  const { blockhash } = useParams();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [block, setBlock] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    const upstream = loadUpstreamSettings();
    setLoading(true);
    setError(null);

    fetchBlockByHash(upstream, blockhash)
      .then((data) => {
        if (!alive) return;
        setBlock(data || null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err && err.message ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [blockhash]);

  const txs = Array.isArray(block && block.tx) ? block.tx : [];

  return (
    <div className='fade-in'>
      <Segment>
        <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.75em' }}>
          <Button as={Link} to="/services/bitcoin" basic size='small'>
            <Icon name='arrow left' />
            Back
          </Button>
          <Icon name='cube' />
          <Header.Content>Block</Header.Content>
        </Header>
      </Segment>

      {loading && (
        <Message info>
          <Message.Header>Loading block...</Message.Header>
        </Message>
      )}

      {error && (
        <Message negative>
          <Message.Header>Failed to load block</Message.Header>
          <p>{error}</p>
        </Message>
      )}

      {!loading && !error && !block && (
        <Message warning>
          <Message.Header>Block not found</Message.Header>
        </Message>
      )}

      {!loading && !error && block && (
        <>
          <Segment>
            <List>
              <List.Item><strong>Hash:</strong> <code>{block.hash || blockhash}</code></List.Item>
              <List.Item><strong>Height:</strong> {block.height != null ? block.height : 'n/a'}</List.Item>
              <List.Item><strong>Time:</strong> {block.time ? new Date(Number(block.time) * 1000).toLocaleString() : 'n/a'}</List.Item>
              <List.Item><strong>Transactions:</strong> {txs.length}</List.Item>
            </List>
          </Segment>

          <Segment>
            <Header as='h3'>Transactions</Header>
            {txs.length === 0 ? (
              <p style={{ color: '#666' }}>No transactions in this block payload.</p>
            ) : (
              <Table compact='very' celled>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Txid</Table.HeaderCell>
                    <Table.HeaderCell>Value</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {txs.slice(0, 200).map((tx, idx) => {
                    const txid = (tx && (tx.txid || tx.id)) || String(tx);
                    const value = tx && Array.isArray(tx.vout)
                      ? tx.vout.reduce((acc, v) => acc + Number(v.value || 0), 0)
                      : null;
                    return (
                      <Table.Row key={`${txid}:${idx}`}>
                        <Table.Cell>
                          <Link to={`/services/bitcoin/transactions/${encodeURIComponent(txid)}`}>
                            <code>{txid}</code>
                          </Link>
                        </Table.Cell>
                        <Table.Cell>{value != null ? `${value} BTC` : '-'}</Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table>
            )}
          </Segment>
        </>
      )}
    </div>
  );
}

module.exports = BitcoinBlockView;
