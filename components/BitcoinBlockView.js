'use strict';

const React = require('react');
const { Link, useParams } = require('react-router-dom');
const {
  Button,
  Divider,
  Grid,
  Header,
  Icon,
  Segment,
  Table,
  Message,
  Label
} = require('semantic-ui-react');
const { fetchBlockByHash, loadUpstreamSettings } = require('../functions/bitcoinClient');

function shortHash (h) {
  const s = String(h || '').trim();
  if (!s) return '—';
  if (s.length <= 18) return s;
  return `${s.slice(0, 10)}…${s.slice(-8)}`;
}

function blockLink (hash) {
  const h = String(hash || '').trim();
  if (!h) return null;
  return `/services/bitcoin/blocks/${encodeURIComponent(h)}`;
}

function fmtInt (n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString();
}

function fmtDifficulty (n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  if (x >= 1e12) return x.toExponential(4);
  if (x >= 1e6) return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return x.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

/**
 * @param {object} props
 * @param {string} props.label
 * @param {React.ReactNode} props.children
 */
function MetaRow ({ label, children }) {
  return (
    <Table.Row>
      <Table.Cell collapsing style={{ fontWeight: 600, color: '#666', width: '11rem' }}>{label}</Table.Cell>
      <Table.Cell style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.92em' }}>{children}</Table.Cell>
    </Table.Row>
  );
}

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
  const hash = (block && block.hash) || blockhash;
  const prev = block && block.previousblockhash ? String(block.previousblockhash).trim() : '';
  const next = block && block.nextblockhash ? String(block.nextblockhash).trim() : '';
  const prevPath = prev ? blockLink(prev) : null;
  const nextPath = next ? blockLink(next) : null;
  const height = block && block.height != null ? block.height : null;
  const timeSec = block && block.time != null ? Number(block.time) : null;
  const medianSec = block && block.mediantime != null ? Number(block.mediantime) : null;
  const nTxRpc = block && block.nTx != null ? block.nTx : txs.length;

  return (
    <div className='fade-in'>
      <Segment>
        <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
          <Button as={Link} to="/services/bitcoin" basic size='small'>
            <Icon name='arrow left' />
            Explorer
          </Button>
          <Icon name='cube' />
          <Header.Content>
            Block {height != null && Number.isFinite(Number(height))
              ? `#${fmtInt(height)}`
              : (hash ? shortHash(hash) : '')}
            <Header.Subheader style={{ marginTop: '0.35em' }}>
              {timeSec != null && Number.isFinite(timeSec) ? (
                <span title={`Unix ${timeSec}`}>{new Date(timeSec * 1000).toLocaleString()}</span>
              ) : (
                '—'
              )}
              {medianSec != null && Number.isFinite(medianSec) && medianSec !== timeSec && (
                <span style={{ marginLeft: '0.75em', color: '#888' }}>
                  (median {new Date(medianSec * 1000).toLocaleString()})
                </span>
              )}
            </Header.Subheader>
          </Header.Content>
        </Header>

        {!loading && !error && block && (prevPath || nextPath) && (
          <div style={{ marginTop: '1rem' }}>
            <Button.Group size='small'>
              {prevPath ? (
                <Button as={Link} to={prevPath} title={prev}>
                  <Icon name='arrow left' />
                  Parent block
                </Button>
              ) : (
                <Button disabled title='No parent (genesis or unknown)'>
                  <Icon name='arrow left' />
                  Parent block
                </Button>
              )}
              {nextPath ? (
                <Button as={Link} to={nextPath} title={next}>
                  Child block
                  <Icon name='arrow right' style={{ marginLeft: '0.5em' }} />
                </Button>
              ) : (
                <Button disabled title='No known descendant (chain tip on this node)'>
                  Child block
                  <Icon name='arrow right' style={{ marginLeft: '0.5em' }} />
                </Button>
              )}
            </Button.Group>
          </div>
        )}
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
            <Grid stackable>
              <Grid.Column width={16}>
                <Label.Group size='small'>
                  {block.confirmations != null && (
                    <Label color='blue' title='Confirmations on this node'>
                      <Icon name='check circle' />
                      {fmtInt(block.confirmations)} confirmations
                    </Label>
                  )}
                  <Label title='Transaction count'>
                    <Icon name='exchange' />
                    {fmtInt(nTxRpc)} txs
                  </Label>
                  {block.size != null && (
                    <Label title='Serialized block size'>
                      <Icon name='database' />
                      {fmtInt(block.size)} B
                    </Label>
                  )}
                  {block.weight != null && (
                    <Label title='BIP141 block weight'>
                      weight {fmtInt(block.weight)}
                    </Label>
                  )}
                  {block.strippedsize != null && block.strippedsize !== block.size && (
                    <Label title='Stripped size (witness discount)'>
                      stripped {fmtInt(block.strippedsize)} B
                    </Label>
                  )}
                </Label.Group>
              </Grid.Column>
            </Grid>

            <Divider />

            <Header as='h4' style={{ marginBottom: '0.75em' }}>Block details</Header>
            <Table basic='very' compact celled unstackable>
              <Table.Body>
                <MetaRow label='Hash'>
                  <span title={hash}><code>{hash}</code></span>
                </MetaRow>
                {height != null && (
                  <MetaRow label='Height'>
                    {fmtInt(height)}
                  </MetaRow>
                )}
                {prev ? (
                  <MetaRow label='Previous block'>
                    <Link to={prevPath} title={prev}>
                      <code>{shortHash(prev)}</code>
                    </Link>
                    <span style={{ marginLeft: '0.5em', color: '#888', fontSize: '0.85em' }}>(parent)</span>
                  </MetaRow>
                ) : null}
                {next ? (
                  <MetaRow label='Next block'>
                    <Link to={nextPath} title={next}>
                      <code>{shortHash(next)}</code>
                    </Link>
                  </MetaRow>
                ) : (
                  <MetaRow label='Next block'>
                    <span style={{ color: '#888' }}>— (chain tip)</span>
                  </MetaRow>
                )}
                {block.merkleroot ? (
                  <MetaRow label='Merkle root'>
                    <code title={block.merkleroot}>{shortHash(block.merkleroot)}</code>
                  </MetaRow>
                ) : null}
                {block.version != null && (
                  <MetaRow label='Version'>
                    {fmtInt(block.version)}
                    {block.versionHex ? (
                      <span style={{ marginLeft: '0.5em', color: '#888' }}>({block.versionHex})</span>
                    ) : null}
                  </MetaRow>
                )}
                {block.bits != null && (
                  <MetaRow label='Bits'>
                    <code>{String(block.bits)}</code>
                  </MetaRow>
                )}
                {block.difficulty != null && (
                  <MetaRow label='Difficulty'>
                    {fmtDifficulty(block.difficulty)}
                  </MetaRow>
                )}
                {block.nonce != null && (
                  <MetaRow label='Nonce'>
                    <code>{fmtInt(block.nonce)}</code>
                  </MetaRow>
                )}
                {block.chainwork != null && (
                  <MetaRow label='Chainwork'>
                    <code title={String(block.chainwork)}>{shortHash(String(block.chainwork))}</code>
                    <span style={{ marginLeft: '0.5em', color: '#888', fontSize: '0.85em' }}>(hex)</span>
                  </MetaRow>
                )}
              </Table.Body>
            </Table>
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
