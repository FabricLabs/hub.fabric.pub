'use strict';

const React = require('react');
const { Link, useParams } = require('react-router-dom');
const { Button, Header, Icon, Label, List, Loader, Message, Segment, Table } = require('semantic-ui-react');
const { fetchTransactionByHash, loadUpstreamSettings } = require('../functions/bitcoinClient');

const TXHASH_REGEX = /^[a-fA-F0-9]{64}$/;

function extractAddress (scriptPubKey) {
  if (!scriptPubKey || typeof scriptPubKey !== 'object') return null;
  if (scriptPubKey.address) return scriptPubKey.address;
  if (Array.isArray(scriptPubKey.addresses) && scriptPubKey.addresses.length > 0) {
    return scriptPubKey.addresses.join(', ');
  }
  return null;
}

function formatValue (value) {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return `${Number(value).toFixed(8)} BTC`;
}

function BitcoinTransactionView () {
  const { txhash } = useParams();
  const hash = (txhash || '').trim();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [tx, setTx] = React.useState(null);

  const loadTx = React.useCallback(() => {
    if (!hash) {
      setLoading(false);
      setError('Transaction hash is required.');
      setTx(null);
      return;
    }
    if (!TXHASH_REGEX.test(hash)) {
      setLoading(false);
      setError('Invalid transaction hash. Must be 64 hex characters.');
      setTx(null);
      return;
    }

    setLoading(true);
    setError(null);
    const upstream = loadUpstreamSettings();

    fetchTransactionByHash(upstream, hash)
      .then((data) => {
        if (data && data.status === 'error') {
          setError(data.message || 'Could not load transaction.');
          setTx(null);
          return;
        }
        if (!data || typeof data !== 'object') {
          setTx(null);
          setError(null);
          return;
        }
        setTx(data);
      })
      .catch((err) => {
        setError(err && err.message ? err.message : String(err));
        setTx(null);
      })
      .finally(() => setLoading(false));
  }, [hash]);

  React.useEffect(() => {
    loadTx();
  }, [loadTx]);

  const outputs = Array.isArray(tx && tx.vout) ? tx.vout : [];
  const inputs = Array.isArray(tx && tx.vin) ? tx.vin : [];
  const totalOut = outputs.reduce((sum, o) => sum + (Number(o.value) || 0), 0);
  const isMempool = !tx || (tx.blockhash == null || tx.blockhash === '');
  const confirmations = tx && tx.confirmations != null ? tx.confirmations : null;

  return (
    <div className='fade-in'>
      <Segment>
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.25em' }}
          role="banner"
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
            <Button as={Link} to="/services/bitcoin" basic size="small" aria-label="Back to Bitcoin dashboard" title="Bitcoin home (status, wallet, explorer, and tools)">
              <Icon name="arrow left" aria-hidden="true" />
              Bitcoin
            </Button>
            {TXHASH_REGEX.test(hash) && (
              <Button
                as={Link}
                to={`/services/bitcoin/resources?tx=${encodeURIComponent(hash)}`}
                basic
                size="small"
                title="Open L1 payment verification for this txid"
              >
                <Icon name="check circle outline" aria-hidden="true" />
                L1 verify
              </Button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
            <Header as="h2" style={{ margin: 0 }}>
              <Icon name="exchange" aria-hidden="true" />
              <Header.Content>Transaction</Header.Content>
            </Header>
            <span style={{ display: 'inline-flex', gap: '0.35em', flexWrap: 'wrap', alignItems: 'center' }} aria-hidden="true">
              {isMempool && tx && (
                <Label color="orange" size="small">
                  <Icon name="clock" aria-hidden="true" />
                  Unconfirmed
                </Label>
              )}
              {confirmations != null && confirmations > 0 && (
                <Label color="green" size="small">
                  <Icon name="check" aria-hidden="true" />
                  {confirmations} confirmations
                </Label>
              )}
            </span>
          </div>
        </div>
      </Segment>

      {!hash && (
        <Message warning>
          <Message.Header>Missing transaction hash</Message.Header>
          <p>Provide a valid 64-character hex transaction ID in the URL.</p>
        </Message>
      )}

      {!!hash && TXHASH_REGEX.test(hash) && loading && (
        <Segment>
          <Loader active inline="centered" />
          <p style={{ textAlign: 'center', marginTop: '1em', color: '#666' }}>Loading transaction…</p>
        </Segment>
      )}

      {!!hash && error && !loading && (
        <Message negative>
          <Message.Header>Failed to load transaction</Message.Header>
          <p>{error}</p>
          {TXHASH_REGEX.test(hash) ? (
            <div style={{ marginTop: '0.75em', display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button type="button" size="small" onClick={() => void loadTx()}>
                <Icon name="refresh" />
                Retry
              </Button>
              <Button
                as={Link}
                to="/services/bitcoin/blocks"
                size="small"
                basic
                title="Open block explorer (recent blocks and mempool)"
              >
                <Icon name="list" />
                Block Explorer
              </Button>
            </div>
          ) : null}
        </Message>
      )}

      {!!hash && TXHASH_REGEX.test(hash) && !loading && !error && !tx && (
        <Message warning>
          <Message.Header>Transaction not found</Message.Header>
          <p>
            This hub&apos;s Bitcoin node does not have this tx in the mempool or chain (wrong network, pruning, or txindex).
          </p>
          <div style={{ marginTop: '0.75em', display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
            <Button type="button" size="small" onClick={() => void loadTx()}>
              <Icon name="refresh" />
              Retry
            </Button>
            <Button
              as={Link}
              to="/services/bitcoin/blocks"
              size="small"
              basic
              title="Open block explorer (recent blocks and mempool)"
            >
              <Icon name="list" />
              Block Explorer
            </Button>
            <Button as={Link} to={`/services/bitcoin/resources?tx=${encodeURIComponent(hash)}`} size="small" basic>
              <Icon name="check circle outline" />
              L1 verify
            </Button>
          </div>
        </Message>
      )}

      {!loading && !error && tx && (
        <>
          {isMempool && (
            <Message warning icon>
              <Icon name="clock outline" />
              <Message.Content>
                <Message.Header>Waiting for confirmation</Message.Header>
                <p>This transaction is not in a block yet. It can be replaced or dropped while in the mempool; depth and inclusion depend on miners and fees.</p>
              </Message.Content>
            </Message>
          )}
          <Segment>
            <List divided>
              <List.Item>
                <List.Content>
                  <List.Header>Transaction ID</List.Header>
                  <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{tx.txid || hash}</code>
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Content>
                  <List.Header>Confirmations</List.Header>
                  {confirmations != null ? confirmations : (isMempool ? '0 (mempool)' : 'n/a')}
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Content>
                  <List.Header>Block</List.Header>
                  {tx.blockhash ? (
                    <Link to={`/services/bitcoin/blocks/${encodeURIComponent(tx.blockhash)}`}>
                      <code style={{ wordBreak: 'break-all' }}>{tx.blockhash}</code>
                    </Link>
                  ) : (
                    <span style={{ color: '#888' }}>Unconfirmed (in mempool)</span>
                  )}
                </List.Content>
              </List.Item>
              {tx.size != null && (
                <List.Item>
                  <List.Content>
                    <List.Header>Size</List.Header>
                    {tx.size} bytes
                  </List.Content>
                </List.Item>
              )}
            </List>
            <Button size="small" basic onClick={loadTx} style={{ marginTop: '0.5em' }}>
              <Icon name="refresh" />
              Refresh
            </Button>
          </Segment>

          {inputs.length > 0 && (
            <Segment>
              <Header as="h3">Inputs ({inputs.length})</Header>
              <Table compact="very" celled>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Previous output</Table.HeaderCell>
                    <Table.HeaderCell>Index</Table.HeaderCell>
                    <Table.HeaderCell>ScriptSig</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {inputs.map((inp, idx) => (
                    <Table.Row key={`${idx}:${inp.txid || ''}:${inp.vout}`}>
                      <Table.Cell>
                        {inp.txid ? (
                          <Link to={`/services/bitcoin/transactions/${encodeURIComponent(inp.txid)}`}>
                            <code style={{ fontSize: '0.85em' }}>{String(inp.txid).slice(0, 16)}…</code>
                          </Link>
                        ) : (
                          <span style={{ color: '#888' }}>Coinbase</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>{inp.vout != null ? inp.vout : '-'}</Table.Cell>
                      <Table.Cell>
                        <code style={{ fontSize: '0.8em', wordBreak: 'break-all' }}>
                          {(inp.scriptSig && inp.scriptSig.hex) ? `${inp.scriptSig.hex.slice(0, 32)}…` : '-'}
                        </code>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </Segment>
          )}

          <Segment>
            <Header as="h3">
              Outputs ({outputs.length})
              {totalOut > 0 && (
                <Header.Subheader style={{ fontWeight: 'normal', color: '#666' }}>
                  Total: {formatValue(totalOut)}
                </Header.Subheader>
              )}
            </Header>
            {outputs.length === 0 ? (
              <p style={{ color: '#666' }}>No outputs.</p>
            ) : (
              <Table compact="very" celled>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Index</Table.HeaderCell>
                    <Table.HeaderCell>Value</Table.HeaderCell>
                    <Table.HeaderCell>Address / Type</Table.HeaderCell>
                    <Table.HeaderCell>Script (scriptPubKey)</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {outputs.map((out, idx) => {
                    const addr = extractAddress(out && out.scriptPubKey);
                    const scriptType = out && out.scriptPubKey && out.scriptPubKey.type;
                    const spk = out && out.scriptPubKey;
                    const scriptAsm = spk && spk.asm ? spk.asm : null;
                    const scriptHex = spk && spk.hex ? spk.hex : null;
                    return (
                      <Table.Row key={`${idx}:${out && out.value}`}>
                        <Table.Cell>{idx}</Table.Cell>
                        <Table.Cell>{formatValue(out && out.value)}</Table.Cell>
                        <Table.Cell>
                          {addr ? (
                            <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{addr}</code>
                          ) : (
                            <span style={{ color: '#888' }}>{scriptType || 'non-standard'}</span>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          {scriptAsm ? (
                            <code style={{ fontSize: '0.8em', wordBreak: 'break-all', display: 'block' }} title={scriptHex || undefined}>
                              {scriptAsm}
                            </code>
                          ) : scriptHex ? (
                            <code style={{ fontSize: '0.75em', wordBreak: 'break-all', display: 'block' }}>{scriptHex}</code>
                          ) : (
                            <span style={{ color: '#888' }}>-</span>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table>
            )}
          </Segment>

          {tx.hex && (
            <Segment>
              <Header as="h3">Raw transaction</Header>
              <pre style={{ fontSize: '0.8em', wordBreak: 'break-all', overflow: 'auto', maxHeight: '20em', margin: 0 }}>
                <code>{tx.hex}</code>
              </pre>
            </Segment>
          )}
        </>
      )}
    </div>
  );
}

module.exports = BitcoinTransactionView;
