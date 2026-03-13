'use strict';

const React = require('react');
const { Link, useParams } = require('react-router-dom');
const { Button, Header, Icon, List, Message, Segment, Table } = require('semantic-ui-react');
const { fetchTransactionByHash, loadUpstreamSettings } = require('../functions/bitcoinClient');

function BitcoinTransactionView () {
  const { txhash } = useParams();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [tx, setTx] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    const upstream = loadUpstreamSettings();
    setLoading(true);
    setError(null);

    fetchTransactionByHash(upstream, txhash)
      .then((data) => {
        if (!alive) return;
        setTx(data || null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err && err.message ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [txhash]);

  const outputs = Array.isArray(tx && tx.vout) ? tx.vout : [];

  return (
    <div className='fade-in'>
      <Segment>
        <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.75em' }}>
          <Button as={Link} to="/services/bitcoin" basic size='small'>
            <Icon name='arrow left' />
            Back
          </Button>
          <Icon name='exchange' />
          <Header.Content>Transaction</Header.Content>
        </Header>
      </Segment>

      {loading && <Message info content='Loading transaction...' />}
      {error && <Message negative content={error} />}
      {!loading && !error && !tx && <Message warning content='Transaction not found.' />}

      {!loading && !error && tx && (
        <>
          <Segment>
            <List>
              <List.Item><strong>Txid:</strong> <code>{tx.txid || txhash}</code></List.Item>
              <List.Item><strong>Confirmations:</strong> {tx.confirmations != null ? tx.confirmations : 'n/a'}</List.Item>
              <List.Item><strong>Block:</strong> {tx.blockhash ? <code>{tx.blockhash}</code> : 'mempool'}</List.Item>
            </List>
          </Segment>
          <Segment>
            <Header as='h3'>Outputs</Header>
            {outputs.length === 0 ? (
              <p style={{ color: '#666' }}>No outputs in this payload.</p>
            ) : (
              <Table compact='very' celled>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Index</Table.HeaderCell>
                    <Table.HeaderCell>Value</Table.HeaderCell>
                    <Table.HeaderCell>Address</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {outputs.map((out, idx) => {
                    const addresses = out && out.scriptPubKey && Array.isArray(out.scriptPubKey.addresses)
                      ? out.scriptPubKey.addresses
                      : [];
                    return (
                      <Table.Row key={`${idx}:${out && out.value}`}>
                        <Table.Cell>{idx}</Table.Cell>
                        <Table.Cell>{out && out.value != null ? `${out.value} BTC` : '-'}</Table.Cell>
                        <Table.Cell>{addresses.length ? addresses.join(', ') : '-'}</Table.Cell>
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

module.exports = BitcoinTransactionView;
