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
  Label,
  Loader
} = require('semantic-ui-react');
const { fetchBlockByHash, fetchBlockWindow, loadUpstreamSettings } = require('../functions/bitcoinClient');
const { SATS_PER_BTC, UI_NUMBER_LOG_EXP_THRESHOLD, UI_NUMBER_COMPACT_FRACTION_THRESHOLD } = require('../constants');
const BitcoinBlockScroller = require('./BitcoinBlockScroller');
const t = require('../locales/en');

const c = t.bitcoin.block;

const BLOCK_HASH_REGEX = /^[a-fA-F0-9]{64}$/;

function shortHash (h) {
  const s = String(h || '').trim();
  if (!s) return t.common.none;
  if (s.length <= 18) return s;
  return `${s.slice(0, 10)}…${s.slice(-8)}`;
}

function blockLink (hash) {
  const h = String(hash || '').trim();
  if (!h) return null;
  return `/services/bitcoin/blocks/${encodeURIComponent(h)}`;
}

function fmtInt (n) {
  if (n == null || n === '') return t.common.none;
  const x = Number(n);
  if (!Number.isFinite(x)) return t.common.none;
  return x.toLocaleString();
}

function fmtDifficulty (n) {
  if (n == null || n === '') return t.common.none;
  const x = Number(n);
  if (!Number.isFinite(x)) return t.common.none;
  if (x >= UI_NUMBER_LOG_EXP_THRESHOLD) return x.toExponential(4);
  if (x >= UI_NUMBER_COMPACT_FRACTION_THRESHOLD) return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
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
  const { blockhash: blockhashParam } = useParams();
  const rawHash = (blockhashParam || '').trim();
  const [loading, setLoading] = React.useState(!!rawHash);
  const [error, setError] = React.useState(null);
  const [block, setBlock] = React.useState(null);
  const [scrollerBlocks, setScrollerBlocks] = React.useState([]);
  const [scrollerLoading, setScrollerLoading] = React.useState(false);

  const loadBlock = React.useCallback(() => {
    if (!rawHash) {
      setLoading(false);
      setError(null);
      setBlock(null);
      return;
    }
    if (!BLOCK_HASH_REGEX.test(rawHash)) {
      setLoading(false);
      setError(c.invalidHash);
      setBlock(null);
      return;
    }

    setLoading(true);
    setError(null);
    const upstream = loadUpstreamSettings();

    fetchBlockByHash(upstream, rawHash)
      .then((data) => {
        setBlock(data || null);
      })
      .catch((err) => {
        setBlock(null);
        setError(err && err.message ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [rawHash]);

  React.useEffect(() => {
    loadBlock();
  }, [loadBlock]);

  const blockHeight = block && block.height != null ? Number(block.height) : null;
  const blockHashKey = block && block.hash ? String(block.hash) : '';

  React.useEffect(() => {
    if (blockHeight == null || !Number.isFinite(blockHeight) || blockHeight < 0) {
      setScrollerBlocks([]);
      setScrollerLoading(false);
      return undefined;
    }
    let cancelled = false;
    setScrollerLoading(true);
    const upstream = loadUpstreamSettings();
    fetchBlockWindow(upstream, { around: blockHeight, before: 12, after: 3 })
      .then((rows) => {
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows.slice() : [];
        list.sort((a, b) => Number(a && a.height) - Number(b && b.height));
        setScrollerBlocks(list);
      })
      .catch(() => {
        if (!cancelled) setScrollerBlocks([]);
      })
      .finally(() => {
        if (!cancelled) setScrollerLoading(false);
      });
    return () => { cancelled = true; };
  }, [blockHeight, blockHashKey]);

  const txs = Array.isArray(block && block.tx) ? block.tx : [];
  const hash = (block && block.hash) || rawHash;
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
        <div
          style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75em', flexWrap: 'wrap', marginBottom: '0.25em' }}
          role="banner"
        >
          <Button as={Link} to="/services/bitcoin" basic size="small" title={t.bitcoin.shared.backToBitcoinTitle}>
            <Icon name="arrow left" aria-hidden="true" />
            {t.bitcoin.shared.backToBitcoin}
          </Button>
          <Header as="h2" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.35em', flexWrap: 'wrap' }}>
            <Icon name="cube" aria-hidden="true" />
            <Header.Content>
              {c.title(height != null && Number.isFinite(Number(height))
                ? `#${fmtInt(height)}`
                : (hash ? shortHash(hash) : ''))}
              <Header.Subheader style={{ marginTop: '0.35em' }}>
                {timeSec != null && Number.isFinite(timeSec) ? (
                  <span title={c.unixTitle(timeSec)}>{new Date(timeSec * 1000).toLocaleString()}</span>
                ) : (
                  t.common.none
                )}
                {medianSec != null && Number.isFinite(medianSec) && medianSec !== timeSec && (
                  <span style={{ marginLeft: '0.75em', color: '#888' }}>
                    {c.median(new Date(medianSec * 1000).toLocaleString())}
                  </span>
                )}
              </Header.Subheader>
            </Header.Content>
          </Header>
        </div>

        {(scrollerLoading || scrollerBlocks.length > 0) && (
          <BitcoinBlockScroller
            blocks={scrollerBlocks}
            selectedHash={hash}
            selectedHeight={height}
            loading={scrollerLoading && scrollerBlocks.length === 0}
          />
        )}

        {!loading && !error && block && (prevPath || nextPath) && (
          <div style={{ marginTop: '1rem' }}>
            <Button.Group size='small'>
              {prevPath ? (
                <Button as={Link} to={prevPath} title={prev}>
                  <Icon name='arrow left' />
                  {c.previous}
                </Button>
              ) : (
                <Button disabled title={c.noPrevious}>
                  <Icon name='arrow left' />
                  {c.previous}
                </Button>
              )}
              {nextPath ? (
                <Button as={Link} to={nextPath} title={next}>
                  {c.next}
                  <Icon name='arrow right' style={{ marginLeft: '0.5em' }} />
                </Button>
              ) : (
                <Button disabled title={c.noNext}>
                  {c.next}
                  <Icon name='arrow right' style={{ marginLeft: '0.5em' }} />
                </Button>
              )}
            </Button.Group>
          </div>
        )}
      </Segment>

      {!rawHash && (
        <Message warning>
          <Message.Header>{c.missingTitle}</Message.Header>
          <p>{c.missingBody}</p>
          <Button
            as={Link}
            to="/services/bitcoin/blocks"
            primary
            style={{ marginTop: '0.75em' }}
            title={t.bitcoin.shared.openExplorerTitle}
          >
            <Icon name="bitcoin" />
            {t.bitcoin.shared.openExplorer}
          </Button>
        </Message>
      )}

      {!!rawHash && loading && (
        <Segment>
          <Loader active inline="centered" />
          <p style={{ textAlign: 'center', marginTop: '1em', color: '#666' }}>{c.loading}</p>
        </Segment>
      )}

      {!!rawHash && error && !loading && (
        <Message negative>
          <Message.Header>{c.loadFailed}</Message.Header>
          <p>{error}</p>
          {BLOCK_HASH_REGEX.test(rawHash) ? (
            <div style={{ marginTop: '0.75em', display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button type="button" size="small" onClick={() => void loadBlock()}>
                <Icon name="refresh" />
                {t.common.actions.retry}
              </Button>
              <Button
                as={Link}
                to="/services/bitcoin/blocks"
                size="small"
                basic
                title={t.bitcoin.shared.openExplorerTitle}
              >
                <Icon name="list" />
                {t.bitcoin.shared.openExplorer}
              </Button>
            </div>
          ) : null}
        </Message>
      )}

      {!!rawHash && !loading && !error && !block && (
        <Message warning>
          <Message.Header>{c.notFoundTitle}</Message.Header>
          <p>{c.notFoundBody}</p>
          {BLOCK_HASH_REGEX.test(rawHash) ? (
            <div style={{ marginTop: '0.75em', display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button type="button" size="small" onClick={() => void loadBlock()}>
                <Icon name="refresh" />
                {t.common.actions.retry}
              </Button>
              <Button
                as={Link}
                to="/services/bitcoin/blocks"
                size="small"
                basic
                title={t.bitcoin.shared.openExplorerTitle}
              >
                <Icon name="list" />
                {t.bitcoin.shared.openExplorer}
              </Button>
            </div>
          ) : null}
        </Message>
      )}

      {!loading && !error && block && (
        <>
          <Segment>
            <Grid stackable>
              <Grid.Column width={16}>
                <Label.Group size='small'>
                  {block.confirmations != null && (
                    <Label color='blue' title={c.confirmationsTitle}>
                      <Icon name='check circle' />
                      {t.bitcoin.shared.confirmations(block.confirmations)}
                    </Label>
                  )}
                  <Label title={c.txCountTitle}>
                    <Icon name='exchange' />
                    {t.bitcoin.shared.transactions(nTxRpc)}
                  </Label>
                  {block.size != null && (
                    <Label title={c.sizeTitle}>
                      <Icon name='database' />
                      {t.bitcoin.shared.bytes(fmtInt(block.size))}
                    </Label>
                  )}
                  {block.weight != null && (
                    <Label title={c.weightTitle}>
                      {c.weight(fmtInt(block.weight))}
                    </Label>
                  )}
                  {block.strippedsize != null && block.strippedsize !== block.size && (
                    <Label title={c.strippedTitle}>
                      {c.stripped(fmtInt(block.strippedsize))}
                    </Label>
                  )}
                </Label.Group>
              </Grid.Column>
            </Grid>

            <Divider />

            <Header as='h4' style={{ marginBottom: '0.75em' }}>{c.details}</Header>
            <Table basic='very' compact celled unstackable>
              <Table.Body>
                <MetaRow label={c.hash}>
                  <span title={hash}><code>{hash}</code></span>
                </MetaRow>
                {height != null && (
                  <MetaRow label={c.height}>
                    {fmtInt(height)}
                  </MetaRow>
                )}
                {prev ? (
                  <MetaRow label={c.previous}>
                    <Link to={prevPath} title={prev}>
                      <code>{shortHash(prev)}</code>
                    </Link>
                  </MetaRow>
                ) : null}
                {next ? (
                  <MetaRow label={c.next}>
                    <Link to={nextPath} title={next}>
                      <code>{shortHash(next)}</code>
                    </Link>
                  </MetaRow>
                ) : (
                  <MetaRow label={c.next}>
                    <span style={{ color: '#888' }}>{c.chainTip}</span>
                  </MetaRow>
                )}
                {block.merkleroot ? (
                  <MetaRow label={c.merkleRoot}>
                    <code title={block.merkleroot}>{shortHash(block.merkleroot)}</code>
                  </MetaRow>
                ) : null}
                {block.version != null && (
                  <MetaRow label={c.version}>
                    {fmtInt(block.version)}
                    {block.versionHex ? (
                      <span style={{ marginLeft: '0.5em', color: '#888' }}>({block.versionHex})</span>
                    ) : null}
                  </MetaRow>
                )}
                {block.bits != null && (
                  <MetaRow label={c.bits}>
                    <code>{String(block.bits)}</code>
                  </MetaRow>
                )}
                {block.difficulty != null && (
                  <MetaRow label={c.difficulty}>
                    {fmtDifficulty(block.difficulty)}
                  </MetaRow>
                )}
                {block.nonce != null && (
                  <MetaRow label={c.nonce}>
                    <code>{fmtInt(block.nonce)}</code>
                  </MetaRow>
                )}
                {block.chainwork != null && (
                  <MetaRow label={c.chainwork}>
                    <code title={String(block.chainwork)}>{shortHash(String(block.chainwork))}</code>
                    <span style={{ marginLeft: '0.5em', color: '#888', fontSize: '0.85em' }}>{c.hex}</span>
                  </MetaRow>
                )}
              </Table.Body>
            </Table>
          </Segment>

          <Segment>
            <Header as='h3'>{c.transactions}</Header>
            {txs.length === 0 ? (
              <p style={{ color: '#666' }}>{c.noTransactions}</p>
            ) : (
              <Table compact='very' celled>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>{c.txid}</Table.HeaderCell>
                    <Table.HeaderCell>{c.value}</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {txs.slice(0, 200).map((tx, idx) => {
                    const txid = (tx && (tx.txid || tx.id)) || String(tx);
                    const valueSats = tx && Array.isArray(tx.vout)
                      ? tx.vout.reduce((acc, v) => acc + Math.round(Number((v && v.value) || 0) * SATS_PER_BTC), 0)
                      : null;
                    return (
                      <Table.Row key={`${txid}:${idx}`}>
                        <Table.Cell>
                          <Link
                            to={`/services/bitcoin/transactions/${encodeURIComponent(txid)}`}
                            title={txid}
                          >
                            <code>{shortHash(txid)}</code>
                          </Link>
                        </Table.Cell>
                        <Table.Cell>{valueSats != null && Number.isFinite(valueSats) ? t.common.sats(valueSats) : t.common.none}</Table.Cell>
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
